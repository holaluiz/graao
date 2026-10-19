/**
 * GRALootSystem: the authoritative chests and ground items of one room (GRAChestSystem + GRAPickupSystem), with the
 * room as its host (like GRAAbilitySystem).
 *
 * - A loot generation: the spawner picks the match's chest spots from a seed, the loot table rolls every chest at once
 *   (contents stay on the server until a chest opens) and each chest gets a collider for this room's characters.
 * - Chest states CLOSED → OPENING → OPEN → EMPTY. The first valid INTERACT unlatches a closed chest; anyone else gets
 *   GONE. After `openMs` its rewards appear on the ground in front of it. A chest never rolls twice in a generation.
 * - Taking is one synchronous transaction in the room's message order: the item is checked, moved into the inventory
 *   and removed (or its quantity reduced) before the next message runs, so two players can never both get it.
 * - Consumables: USE_ITEM starts a short use (hands busy); the effect lands at the end if the player is still alive.
 * - A fallen player's inventory goes to the ground through the same items (death drops); a replaced weapon too.
 *
 * Every request is validated here (sequence, rate, phase via the host, generation, state, distance, line of sight,
 * capacity). Clients only ever see chest positions and states, never what a closed chest holds.
 */
import { AMMO, ATTRIBUTES, CONSUMABLES, CONSUMABLE_ORDER, ITEMS, LOOT_RULES, WEAPONS, type ItemId } from '@graao/game-data';
import { newPassiveRuntime, passiveModifiers } from './passives';
import {
  ChestState,
  LootAction,
  LootReject,
  type ChestTuple,
  type GameEvent,
  type InteractMsg,
  type ItemTuple,
  type LootDevMsg,
  type LootResultMsg,
  type LootStateMsg,
  type UseItemMsg,
  type Vec3,
} from '@graao/shared';
import { quantDir, quantPos, scatterOnGround, pickChestSpots, type ChestSpot } from './chests';
import type { Vitals } from './combat';
import { addAmmo, addConsumable, freeSlot, itemIndex, putWeapon, rollMatchLoot, takeAll, type Inventory, type LootDrop } from './loot';
import { GROUPS_WORLD_QUERY, addChestCollider, refreshQueries, removeChestCollider, type GamePhysics } from './physics';
import { mulberry32 } from './rng';

export interface LootActor {
  loadout?: readonly string[];
  readonly index: number;
  vitals: Vitals;
  inv: Inventory;
  state: { pos: Vec3; facing: Vec3 };
  /** Server time when the consumable in use takes effect (0 = none) and which one (CONSUMABLE_ORDER index, -1). */
  useUntil: number;
  useItem: number;
  /** Per consumable: server time until it may be used again. */
  useReadyAt: number[];
  /** Last INTERACT / USE_ITEM sequence handled, and when (rate limit). */
  lootSeq: number;
  lootAt: number;
}

export interface LootHost {
  physics: GamePhysics;
  actors(): Iterable<LootActor>;
  /** OK when this player may loot right now (alive, the right phase, on the ground); else the reason. */
  gate(a: LootActor, now: number): LootReject;
  emit(e: GameEvent): void;
  /** The player's inventory changed: its SELF must go out (and the public weapons when `weapons`). */
  changed(a: LootActor, weapons: boolean): void;
  /** A picked-up weapon went into `slot`: make it the equipped one (the host applies its equip delay). */
  equip(a: LootActor, slot: number, now: number): void;
}

interface ChestRuntime {
  id: number;
  spot: ChestSpot;
  state: ChestState;
  by: number;
  openAt: number;
  contents: LootDrop[];
  /** Ground items that came out of it and are still there. */
  items: Set<number>;
  collider: number;
}

export interface WorldItem {
  id: number;
  item: ItemId;
  qty: number;
  /** Weapons: rounds in the magazine. */
  ammo: number;
  pos: Vec3;
  /** Chest id, -1 death drop, -2 weapon swap. */
  src: number;
}

/** Feet to target distance and a clear line from chest height to it. */
const UP_EYE = 1.1;

export class GRALootSystem {
  gen = 0;
  seed = 0;
  readonly chests: ChestRuntime[] = [];
  readonly items = new Map<number, WorldItem>();
  /** This room's chest colliders (the character motor collides with these only). */
  readonly colliders = new Set<number>();
  private nextItem = 1;

  constructor(
    private readonly host: LootHost,
    readonly spots: ChestSpot[],
  ) {}

  // ------------------------------------------------------------------------------------------------ generations

  /** A new generation: the match's chests from `seed` (`forced` spot ids first: dev/tests), rolled at once, nothing on the ground. */
  generate(seed: number, count: number = LOOT_RULES.chestsPerMatch, forced: string[] = []): void {
    this.clear();
    this.gen++;
    this.seed = seed >>> 0;
    const chosen = pickChestSpots(this.spots, count, mulberry32(this.seed), LOOT_RULES.minChestSpacingDeg, forced);
    // The first chest of each region is a starter: it always holds a weapon (everyone lands unarmed).
    const seen = new Set<number>();
    const starters = chosen.map((s) => !seen.has(s.region) && !!seen.add(s.region));
    const contents = rollMatchLoot(this.seed, chosen.length, starters);
    chosen.forEach((spot, i) => {
      const collider = addChestCollider(this.host.physics, spot.pos, spot.up, spot.forward);
      this.colliders.add(collider);
      this.chests.push({ id: i, spot, state: ChestState.CLOSED, by: -1, openAt: 0, contents: contents[i]!, items: new Set(), collider });
    });
    refreshQueries(this.host.physics);
  }

  /** Removes every chest (and its collider) and every item. */
  clear(): void {
    if (this.chests.length) {
      for (const c of this.chests) removeChestCollider(this.host.physics, c.collider);
      refreshQueries(this.host.physics);
    }
    this.chests.length = 0;
    this.colliders.clear();
    this.items.clear();
  }

  view(): LootStateMsg {
    return { gen: this.gen, chests: this.chests.map(chestTuple), items: [...this.items.values()].map(itemTuple) };
  }

  // ------------------------------------------------------------------------------------------------ requests

  /** INTERACT: open a chest (k = 0) or take an item (k = 1). Always answers. */
  interact(a: LootActor, m: InteractMsg, now: number): LootResultMsg {
    const action = m.k === 0 ? LootAction.OPEN : LootAction.TAKE;
    const no = (r: LootReject): LootResultMsg => ({ s: m.s, a: action, ok: false, r, id: m.id });
    const pre = this.admit(a, m.s, now);
    if (pre !== LootReject.OK) return no(pre);
    const g = this.host.gate(a, now);
    if (g !== LootReject.OK) return no(g);
    if (m.g !== this.gen) return no(LootReject.GONE);
    return m.k === 0 ? this.open(a, m, now) : this.take(a, m, now);
  }

  /** USE_ITEM: start using a consumable. Always answers. */
  use(a: LootActor, m: UseItemMsg, now: number): LootResultMsg {
    const no = (r: LootReject): LootResultMsg => ({ s: m.s, a: LootAction.USE, ok: false, r, id: m.c });
    const pre = this.admit(a, m.s, now);
    if (pre !== LootReject.OK) return no(pre);
    const g = this.host.gate(a, now);
    if (g !== LootReject.OK) return no(g);
    const c = CONSUMABLE_ORDER[m.c];
    if (!c || a.inv.consumables[c] <= 0) return no(LootReject.NO_ITEM);
    if (a.useUntil > now) return no(LootReject.BUSY);
    if (now < (a.useReadyAt[m.c] ?? 0)) return no(LootReject.COOLDOWN);
    const def = CONSUMABLES[c];
    if (statFull(a.vitals, def.stat)) return no(LootReject.FULL);
    a.useUntil = now + def.useMs;
    a.useItem = m.c;
    this.host.emit({ e: 'use', by: a.index, c: m.c, ph: 0 });
    this.host.changed(a, false);
    return { s: m.s, a: LootAction.USE, ok: true, r: LootReject.OK, id: m.c };
  }

  /** Stops a use in progress (death, a shot, a cast): nothing is consumed. */
  cancelUse(a: LootActor): void {
    if (a.useUntil <= 0) return;
    this.host.emit({ e: 'use', by: a.index, c: a.useItem, ph: 2 });
    a.useUntil = 0;
    a.useItem = -1;
    this.host.changed(a, false);
  }

  /** Sequence (no replays) and rate (no spam) for both request kinds. */
  private admit(a: LootActor, seq: number, now: number): LootReject {
    if (a.lootSeq >= 0 && !seqGreater(seq, a.lootSeq)) return LootReject.STALE;
    a.lootSeq = seq;
    if (now - a.lootAt < LOOT_RULES.requestIntervalMs) return LootReject.RATE;
    a.lootAt = now;
    return LootReject.OK;
  }

  private open(a: LootActor, m: InteractMsg, now: number): LootResultMsg {
    const no = (r: LootReject): LootResultMsg => ({ s: m.s, a: LootAction.OPEN, ok: false, r, id: m.id });
    const c = this.chests[m.id];
    if (!c || c.state !== ChestState.CLOSED) return no(LootReject.GONE);
    const center = offset(c.spot.pos, c.spot.up, 0.35);
    const r = this.reach(a, center, LOOT_RULES.chestRange, offset(c.spot.pos, c.spot.up, 0.5));
    if (r !== LootReject.OK) return no(r);
    c.state = ChestState.OPENING;
    c.by = a.index;
    c.openAt = now + LOOT_RULES.openMs;
    this.host.emit({ e: 'chest', id: c.id, st: c.state, by: a.index });
    return { s: m.s, a: LootAction.OPEN, ok: true, r: LootReject.OK, id: c.id };
  }

  private take(a: LootActor, m: InteractMsg, now: number): LootResultMsg {
    const no = (r: LootReject): LootResultMsg => ({ s: m.s, a: LootAction.TAKE, ok: false, r, id: m.id });
    const it = this.items.get(m.id);
    if (!it) return no(LootReject.GONE);
    const passive = passiveModifiers(a.loadout ?? [], newPassiveRuntime(), now, a.vitals.alive);
    const r = this.reach(a, it.pos, LOOT_RULES.itemRange * passive.pickupRange, offset(it.pos, unit(it.pos), 0.25));
    if (r !== LootReject.OK) return no(r);
    const def = ITEMS[it.item];
    const ok = (n: number, w?: number): LootResultMsg => ({ s: m.s, a: LootAction.TAKE, ok: true, r: LootReject.OK, id: m.id, d: itemIndex(it.item), n, ...(w !== undefined ? { w } : {}) });
    if (def.kind === 'weapon') {
      let slot = freeSlot(a.inv);
      if (slot < 0) {
        if (m.w === undefined) return no(LootReject.SLOTS_FULL);
        slot = m.w;
      }
      const old = putWeapon(a.inv, slot, { id: def.weapon!, ammo: it.ammo });
      this.remove(it, a.index);
      // The weapon it replaced lands where the new one was (same pickup system; nothing is created or lost).
      if (old) this.spawn([{ item: `weapon_${old.id}` as ItemId, qty: 1, ammo: old.ammo }], [it.pos], -2, a.index);
      this.host.equip(a, slot, now);
      this.host.changed(a, true);
      return ok(1, slot);
    }
    const ammoRoom = def.kind === 'ammo' ? AMMO[def.ammo!].max - a.inv.reserve[def.ammo!] : 0;
    const consumed = def.kind === 'ammo' ? Math.min(it.qty, Math.ceil(ammoRoom / (1 + passive.ammoBonus))) : 0;
    const n = def.kind === 'ammo' ? addAmmo(a.inv, def.ammo!, Math.floor(consumed * (1 + passive.ammoBonus) + 1e-8)) : addConsumable(a.inv, def.consumable!, it.qty);
    if (n <= 0) return no(LootReject.FULL);
    it.qty -= def.kind === 'ammo' ? consumed : n;
    if (it.qty <= 0) this.remove(it, a.index);
    else this.host.emit({ e: 'take', id: it.id, by: a.index, left: it.qty });
    this.host.changed(a, false);
    return ok(n);
  }

  /** Within reach of the feet (plus latency slack) and nothing solid between the player and the target. */
  private reach(a: LootActor, target: Vec3, range: number, sight: Vec3): LootReject {
    const p = a.state.pos;
    if (Math.hypot(target.x - p.x, target.y - p.y, target.z - p.z) > range + LOOT_RULES.slack) return LootReject.TOO_FAR;
    const eye = offset(p, unit(p), UP_EYE);
    const d = { x: sight.x - eye.x, y: sight.y - eye.y, z: sight.z - eye.z };
    const len = Math.hypot(d.x, d.y, d.z);
    if (len > 0.3) {
      const hit = this.host.physics.castRay(eye, { x: d.x / len, y: d.y / len, z: d.z / len }, len - 0.25, GROUPS_WORLD_QUERY);
      if (hit) return LootReject.BLOCKED;
    }
    return LootReject.OK;
  }

  // ------------------------------------------------------------------------------------------------ time

  /** Lids that finished opening release their rewards; uses that finished take effect. */
  update(now: number): void {
    for (const c of this.chests) {
      if (c.state !== ChestState.OPENING || now < c.openAt) continue;
      const pos = scatterOnGround(this.host.physics, c.spot.pos, c.spot.forward, c.contents.length);
      const ids = this.spawn(c.contents.map((d) => ({ ...d, ammo: weaponMagazine(d.item) })), pos, c.id, c.by);
      for (const id of ids) c.items.add(id);
      c.state = ids.length ? ChestState.OPEN : ChestState.EMPTY;
      this.host.emit({ e: 'chest', id: c.id, st: c.state, by: c.by });
    }
    for (const a of this.host.actors()) {
      if (a.useUntil <= 0 || now < a.useUntil) continue;
      const ci = a.useItem;
      const id = CONSUMABLE_ORDER[ci];
      if (!id || !a.vitals.alive || a.inv.consumables[id] <= 0) {
        this.cancelUse(a);
        continue;
      }
      const def = CONSUMABLES[id];
      a.inv.consumables[id] -= 1;
      restore(a.vitals, def.stat, def.amount);
      a.useUntil = 0;
      a.useItem = -1;
      a.useReadyAt[ci] = now + def.cooldownMs;
      this.host.emit({ e: 'use', by: a.index, c: ci, ph: 1 });
      this.host.changed(a, false);
    }
  }

  // ------------------------------------------------------------------------------------------------ drops

  /** A fallen player's whole inventory goes to the ground around them (and is no longer carried). */
  dropAll(a: LootActor): void {
    this.cancelUse(a);
    const list = takeAll(a.inv);
    this.host.changed(a, true);
    if (!list.length) return;
    const pos = scatterOnGround(this.host.physics, a.state.pos, a.state.facing, list.length, { ring: true, radius: 1.1 });
    this.spawn(list, pos, -1, a.index);
  }

  private spawn(list: { item: ItemId; qty: number; ammo?: number }[], pos: Vec3[], src: number, by: number): number[] {
    const out: WorldItem[] = list.map((d, i) => ({ id: this.nextItem++, item: d.item, qty: d.qty, ammo: d.ammo ?? 0, pos: pos[i]!, src }));
    for (const it of out) this.items.set(it.id, it);
    if (out.length) this.host.emit({ e: 'items', src, by, it: out.map(itemTuple) });
    this.trim();
    return out.map((it) => it.id);
  }

  /** Too many things on the ground: the oldest drops (never a chest's rewards) are cleared. */
  private trim(): void {
    if (this.items.size <= LOOT_RULES.maxItems) return;
    for (const it of this.items.values()) {
      if (this.items.size <= LOOT_RULES.maxItems) break;
      if (it.src < 0) this.remove(it, -1);
    }
  }

  private remove(it: WorldItem, by: number): void {
    this.items.delete(it.id);
    this.host.emit({ e: 'take', id: it.id, by, left: 0 });
    const c = it.src >= 0 ? this.chests[it.src] : undefined;
    if (c && c.items.delete(it.id) && c.items.size === 0 && c.state === ChestState.OPEN) {
      c.state = ChestState.EMPTY;
      this.host.emit({ e: 'chest', id: c.id, st: c.state, by });
    }
  }

  // ------------------------------------------------------------------------------------------------ dev

  /** Dev: everything the server knows (contents of closed chests included) and how each authored spot resolved. */
  devView(): LootDevMsg {
    return {
      gen: this.gen,
      seed: this.seed,
      chests: this.chests.map((c) => ({ id: c.id, spot: c.spot.def.id, region: c.spot.def.region, state: c.state, items: c.contents.map((d) => [d.item, d.qty] as [string, number]) })),
      spots: this.spots.map((s) => ({ id: s.def.id, region: s.def.region, ok: s.ok, moved: s.moved, reason: s.reason, x: s.pos.x, y: s.pos.y, z: s.pos.z })),
    };
  }

  /** Dev: every closed chest starts opening now (as if someone unlatched it). */
  devOpenAll(now: number): void {
    for (const c of this.chests) {
      if (c.state !== ChestState.CLOSED) continue;
      c.state = ChestState.OPENING;
      c.openAt = now + LOOT_RULES.openMs;
      this.host.emit({ e: 'chest', id: c.id, st: c.state, by: -1 });
    }
  }

  /** Dev: drops one item at a player's feet. */
  devGive(a: LootActor, item: ItemId): void {
    const def = ITEMS[item];
    this.spawn([{ item, qty: def.max, ammo: weaponMagazine(item) }], scatterOnGround(this.host.physics, a.state.pos, a.state.facing, 1, { radius: 1.2 }), -2, a.index);
  }
}

// ------------------------------------------------------------------------------------------------ helpers

function chestTuple(c: ChestRuntime): ChestTuple {
  const p = quantPos(c.spot.pos);
  const u = quantDir(c.spot.up);
  const f = quantDir(c.spot.forward);
  return [c.id, p[0], p[1], p[2], u[0], u[1], u[2], f[0], f[1], f[2], c.state, c.spot.region];
}

function itemTuple(it: WorldItem): ItemTuple {
  const p = quantPos(it.pos);
  return [it.id, itemIndex(it.item), it.qty, p[0], p[1], p[2]];
}

const weaponMagazine = (item: ItemId): number => {
  const d = ITEMS[item];
  return d.kind === 'weapon' ? WEAPONS[d.weapon!].magazine : 0;
};

/** The maximum of a vital for these vitals (in-match attributes raise Health and Mana). */
const maxOf = (v: Vitals, stat: 'health' | 'shield' | 'mana'): number =>
  stat === 'health' ? (v.maxHealth ?? ATTRIBUTES.maxHealth) : stat === 'mana' ? (v.maxMana ?? ATTRIBUTES.maxMana) : ATTRIBUTES.maxShield;
const statFull = (v: Vitals, stat: 'health' | 'shield' | 'mana'): boolean => v[stat] >= maxOf(v, stat) - 0.5;
function restore(v: Vitals, stat: 'health' | 'shield' | 'mana', amount: number): void {
  v[stat] = Math.min(maxOf(v, stat), v[stat] + amount);
}

const unit = (p: Vec3): Vec3 => {
  const l = Math.hypot(p.x, p.y, p.z) || 1;
  return { x: p.x / l, y: p.y / l, z: p.z / l };
};
const offset = (p: Vec3, d: Vec3, s: number): Vec3 => ({ x: p.x + d.x * s, y: p.y + d.y * s, z: p.z + d.z * s });

/** a > b with 31-bit wraparound. */
const seqGreater = (a: number, b: number) => a !== b && ((a - b) & 0x7fffffff) < 0x40000000;
