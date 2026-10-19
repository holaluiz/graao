/**
 * LootDirector (client): mirrors the server's chests and ground items, picks what the player can interact with, turns
 * F / E / Q / Z / X / C into INTERACT and USE_ITEM intents, and presents what the server decided (lids, rewards,
 * pickups, uses) through the LootView, the LootHud, VFX and sound. It never decides loot: contents, takes, swaps and
 * consumable effects all come from the server; a pickup is only shown as taken once the server says so.
 *
 * Response stack (BODY · WORLD · FX · CAMERA · AUDIO · UI), scaled to the event: a chest opening is the big one (body
 * reach, squash and lid, flash and sparks, rising chime, rewards jumping out); a pickup is a short pop and a feed line;
 * a refusal is a notice and a dull bonk. The camera is never shaken by loot.
 */
import * as THREE from 'three';
import { GROUPS_WORLD_QUERY, newPassiveRuntime, passiveModifiers, addChestCollider, chestBasis, decodeDir, decodePos, refreshQueries, removeChestCollider } from '@graao/game-core';
import { AMMO, AMMO_TYPES, ATTRIBUTES, CONSUMABLES, CONSUMABLE_ORDER, ITEMS, ITEM_IDS, LOOT_RULES, RARITY_ORDER, WEAPONS, type ItemId, type Rarity } from '@graao/game-data';
import { ChestState, LootAction, LootReject, type ChestTuple, type GameEvent, type ItemTuple, type LootDevMsg, type LootResultMsg, type LootStateMsg, type SelfStatusMsg } from '@graao/shared';
import type { GraaoApp } from '../app/GraaoApp';
import { Shape } from '../render/vfx/GRAVFXSystem';
import { CONSUMABLE_NAME, LootHud, type LabelView } from '../ui/LootHud';
import { LootView } from '../world/LootView';
import { keyLabel } from './KeyBindings';

interface ChestClient {
  id: number;
  pos: THREE.Vector3;
  up: THREE.Vector3;
  forward: THREE.Vector3;
  state: ChestState;
  region: number;
  /** performance.now() when we saw it start opening (rewards then jump out of it). */
  openedAt: number;
}

interface ItemClient {
  id: number;
  item: ItemId;
  qty: number;
  pos: THREE.Vector3;
  src: number;
}

type Target = { kind: 0; chest: ChestClient } | { kind: 1; item: ItemClient };

const CONSUMABLE_STAT = { health: 'VIDA', shield: 'ESCUDO', mana: 'MANA' } as const;
const CONSUMABLE_FX = { health: { color: '#ff6f84', shape: Shape.DOT }, shield: { color: '#6fbaff', shape: Shape.SHARD }, mana: { color: '#b49bff', shape: Shape.SPARK } } as const;

export class LootDirector {
  private pickupRange(): number {
    const me = this.app.combat.roomPlayers.find((p) => p.index === this.app.net?.myIndex);
    return LOOT_RULES.itemRange * passiveModifiers(me?.loadout ?? [], newPassiveRuntime(), Date.now(), this.app.combat.alive).pickupRange;
  }
  readonly view = new LootView();
  readonly hud = new LootHud();
  gen = -1;
  private readonly chests = new Map<number, ChestClient>();
  private readonly items = new Map<number, ItemClient>();
  /** Chest colliders in the local physics world (prediction bumps into them like the server does). */
  private colliders: number[] = [];
  /** Consumables carried (CONSUMABLE_ORDER) and the use in progress, from SELF. */
  private counts = [0, 0, 0];
  private useUntil = 0;
  private useStart = 0;
  private useItem = -1;
  private seq = 0;
  private sentAt = -1e9;
  private pendingSeq = -1;
  private target: Target | null = null;
  /** Weapon replacement card open for this item. */
  private choice: ItemClient | null = null;
  /** Chests that already played their "something is here" shimmer this generation. */
  private readonly noticed = new Set<number>();
  /** Dev: labels on every chest (id, region, state, contents) and every authored spot. */
  debug = false;
  private devInfo: LootDevMsg | null = null;
  private readonly debugLayer = document.createElement('div');
  private duplicates = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly tmp3 = new THREE.Vector3();

  constructor(private readonly app: GraaoApp) {
    app.r.scene.add(this.view.group);
    app.hud.el.append(this.hud.el, this.hud.labels);
    this.debugLayer.className = 'loot-debug';
    app.hud.el.append(this.debugLayer);
  }

  /** A consumable is being used right now (hands busy: no shots or casts). */
  get using(): boolean {
    return this.useItem >= 0 && this.useUntil > this.serverNow();
  }

  private serverNow(): number {
    return this.app.net ? this.app.net.serverNow() : Date.now();
  }

  private get me(): number {
    return this.app.net?.myIndex ?? -1;
  }

  /** Leaving the room (or offline): nothing on the planet, nothing in the pockets. */
  reset(): void {
    this.gen = -1;
    this.chests.clear();
    this.items.clear();
    this.dropColliders();
    this.view.clear();
    this.hud.clear();
    this.counts = [0, 0, 0];
    this.useItem = -1;
    this.useUntil = 0;
    this.target = null;
    this.choice = null;
    this.devInfo = null;
    this.debugLayer.innerHTML = '';
  }

  // ------------------------------------------------------------------------------------------------ server state

  onState(m: LootStateMsg): void {
    if (m.gen !== this.gen) {
      // A new generation: new chests (and colliders), nothing on the ground.
      this.gen = m.gen;
      this.chests.clear();
      this.items.clear();
      this.noticed.clear();
      this.choice = null;
      this.view.clear();
      for (const t of m.chests) this.chests.set(t[0], chestOf(t));
      this.view.setChests([...this.chests.values()].map((c) => ({ id: c.id, pos: c.pos, up: c.up, forward: c.forward, state: c.state })));
      this.rebuildColliders();
    } else {
      for (const t of m.chests) {
        const c = this.chests.get(t[0]);
        if (c && c.state !== t[10]) {
          c.state = t[10] as ChestState;
          this.view.setChestState(c.id, c.state, false);
        }
      }
    }
    // Items: exactly the server's list (a reconnect may have missed takes and drops).
    const seen = new Set<number>();
    for (const t of m.items) {
      seen.add(t[0]);
      const it = this.items.get(t[0]);
      if (it) it.qty = t[2];
      else this.addItem(t, -2, null, 0);
    }
    for (const id of [...this.items.keys()]) {
      if (seen.has(id)) continue;
      this.items.delete(id);
      this.view.removeItem(id, false);
    }
  }

  private rebuildColliders(): void {
    this.dropColliders();
    const physics = this.app.world.physics;
    for (const c of this.chests.values()) this.colliders.push(addChestCollider(physics, c.pos, c.up, c.forward));
    refreshQueries(physics);
  }

  private dropColliders(): void {
    if (!this.colliders.length) return;
    const physics = this.app.world.physics;
    for (const h of this.colliders) removeChestCollider(physics, h);
    this.colliders = [];
    refreshQueries(physics);
  }

  private addItem(t: ItemTuple, src: number, from: THREE.Vector3 | null, delay: number): void {
    const item = ITEM_IDS[t[1]];
    if (!item) return;
    if (this.items.has(t[0])) {
      this.duplicates++;
      return;
    }
    const it: ItemClient = { id: t[0], item, qty: t[2], pos: new THREE.Vector3(t[3] / 1000, t[4] / 1000, t[5] / 1000), src };
    // Two items on exactly the same spot would be a server bug (a duplicated drop): count it for the dev overlay.
    for (const o of this.items.values()) if (o.pos.distanceToSquared(it.pos) < 1e-6) this.duplicates++;
    this.items.set(it.id, it);
    this.view.addItem(it.id, item, it.pos, from, delay);
  }

  onEvent(e: GameEvent): void {
    switch (e.e) {
      case 'chest':
        this.onChest(e.id, e.st, e.by);
        break;
      case 'items':
        this.onItems(e.src, e.by, e.it);
        break;
      case 'take':
        this.onTake(e.id, e.by, e.left);
        break;
      case 'use':
        this.onUse(e.by, e.c, e.ph);
        break;
    }
  }

  private onChest(id: number, st: ChestState, by: number): void {
    const c = this.chests.get(id);
    if (!c || c.state === st) return;
    const prev = c.state;
    c.state = st;
    this.view.setChestState(id, st, prev === ChestState.CLOSED);
    const app = this.app;
    const top = this.tmp.copy(c.pos).addScaledVector(c.up, 0.75);
    if (st === ChestState.OPENING) {
      c.openedAt = performance.now();
      // BODY: whoever opened it reaches in.
      this.reach(by);
      this.play('loot.open', top, 1);
    } else if (st === ChestState.OPEN && prev === ChestState.OPENING) {
      // The reveal: a brief light, sparks in the colour of the best reward, a rising chime.
      const best = this.bestRarity(id);
      const color = rarityColor(best);
      app.vfx.flash(top, '#fff4cf', 1.1, 0.14);
      app.vfx.burst(top, c.up, { color, count: 14 + RARITY_ORDER.indexOf(best) * 4, speed: 3.6, size: 0.12, life: 0.7, gravity: 3, drag: 2.4, spread: 1.1, shape: Shape.SPARK, category: 'CombatBurst' });
      app.vfx.burst(top, c.up, { color: '#ffe7a3', count: 8, speed: 2.2, size: 0.09, life: 0.9, gravity: 1, drag: 2, spread: 1.4, shape: Shape.DOT, category: 'Environment' });
      app.vfx.ring(this.tmp2.copy(c.pos).addScaledVector(c.up, 0.05), color, 2.2, 0.45);
      this.play('loot.reveal', top, 0.9, 0.9 + RARITY_ORDER.indexOf(best) * 0.08);
    }
  }

  private onItems(src: number, by: number, list: ItemTuple[]): void {
    const c = src >= 0 ? this.chests.get(src) : undefined;
    // Rewards seen live jump out of the chest's mouth one after another; others just appear.
    const live = c && performance.now() - c.openedAt < 3000;
    const mouth = c ? new THREE.Vector3().copy(c.pos).addScaledVector(c.up, 0.55).addScaledVector(c.forward, 0.15) : null;
    let from: THREE.Vector3 | null = live ? mouth : null;
    if (src === -1 && by >= 0) {
      // A fallen player's things burst out of where they fell.
      const p = by === this.me ? this.app.local.state.pos : this.app.net?.remote(by)?.pos;
      if (p) from = new THREE.Vector3(p.x, p.y, p.z).addScaledVector(new THREE.Vector3(p.x, p.y, p.z).normalize(), 0.9);
    }
    list.forEach((t, k) => this.addItem(t, src, from, from ? k * 0.08 : 0));
  }

  private onTake(id: number, by: number, left: number): void {
    const it = this.items.get(id);
    if (!it) return;
    if (left > 0) {
      it.qty = left;
      return;
    }
    const at = this.view.itemDrawPos(id, this.tmp) ?? this.tmp.copy(it.pos);
    this.items.delete(id);
    this.view.removeItem(id, true);
    if (this.choice?.id === id) this.closeChoice();
    // WORLD/FX: a small puff where it was (everyone sees it go).
    const up = this.tmp2.copy(at).normalize();
    this.app.vfx.burst(at, up, { color: rarityColor(ITEMS[it.item].rarity), count: 6, speed: 1.8, size: 0.08, life: 0.35, drag: 4, shape: Shape.DOT, category: 'Environment' });
    if (by >= 0 && by !== this.me) {
      this.reach(by);
      this.play('loot.pickup', at, 0.55);
    }
  }

  private onUse(by: number, c: number, ph: 0 | 1 | 2): void {
    const id = CONSUMABLE_ORDER[c];
    if (!id) return;
    const mine = by === this.me;
    const feet = mine ? this.app.local.state.pos : this.app.net?.remote(by)?.pos;
    if (!feet) return;
    const up = this.tmp2.set(feet.x, feet.y, feet.z).normalize();
    const chest = this.tmp.set(feet.x, feet.y, feet.z).addScaledVector(up, 1.0);
    if (ph === 0) {
      this.reach(by);
      if (mine) this.app.audio.play('loot.use');
      else this.play('loot.use', chest, 0.5);
    } else if (ph === 1) {
      const fx = CONSUMABLE_FX[id];
      this.app.vfx.burst(chest, up, { color: fx.color, count: 12, speed: 2.4, size: 0.12, life: 0.6, gravity: -2.5, drag: 2.5, spread: 1.3, shape: fx.shape, category: 'CombatBurst' });
      this.app.vfx.ring(this.tmp3.set(feet.x, feet.y, feet.z).addScaledVector(up, 0.08), fx.color, 1.6, 0.4);
      if (mine) {
        this.app.audio.play('loot.useDone', { pitch: id === 'mana' ? 1.15 : id === 'shield' ? 0.92 : 1 });
        this.hud.pickup(`+${CONSUMABLES[id].amount} ${CONSUMABLE_STAT[id] === 'VIDA' ? 'Vida' : CONSUMABLE_STAT[id] === 'ESCUDO' ? 'Escudo' : 'Mana'}`, null, CONSUMABLE_NAME[id]);
      } else this.play('loot.useDone', chest, 0.45);
    }
  }

  /** BODY: a short reach with the hands (no interaction clip in the pack: the spell's opening gesture). */
  private reach(by: number): void {
    if (by < 0) return;
    const ch = by === this.me ? this.app.character : this.app.net?.remote(by)?.character;
    ch?.anim.playUpper('castEnter', 1.7);
  }

  onSelf(s: SelfStatusMsg): void {
    this.counts = [...(s.inv ?? [0, 0, 0])];
    if (s.useItem !== this.useItem || s.useUntil !== this.useUntil) {
      if (s.useItem >= 0 && s.useUntil > 0) this.useStart = s.useUntil - CONSUMABLES[CONSUMABLE_ORDER[s.useItem]!].useMs;
      this.useItem = s.useUntil > 0 ? s.useItem : -1;
      this.useUntil = s.useUntil;
    }
  }

  onResult(r: LootResultMsg): void {
    if (r.s === this.pendingSeq) this.pendingSeq = -1;
    const app = this.app;
    if (r.ok) {
      if (r.a !== LootAction.TAKE || r.d === undefined) return;
      const item = ITEM_IDS[r.d]!;
      const def = ITEMS[item];
      if (def.kind === 'weapon') {
        this.hud.pickup(def.name, def.rarity, `arma ${r.w === 1 ? 'Q' : 'E'}`);
        app.audio.play('loot.equip');
      } else if (def.kind === 'ammo') {
        this.hud.pickup(`+${r.n} ${def.name}`, null, `${WEAPON_NAMES_FOR(def.ammo!)}`);
        app.audio.play('loot.ammo');
      } else {
        this.hud.pickup(`+${r.n} ${def.name}`, def.rarity, `[${CONSUMABLES[def.consumable!].key}] usar`);
        app.audio.play('loot.pickup');
      }
      return;
    }
    switch (r.r) {
      case LootReject.SLOTS_FULL: {
        const it = this.items.get(r.id);
        if (it) this.openChoice(it);
        return;
      }
      case LootReject.STALE:
      case LootReject.RATE:
      case LootReject.COOLDOWN:
        return;
      case LootReject.FULL: {
        const it = r.a === LootAction.TAKE ? this.items.get(r.id) : null;
        const def = it ? ITEMS[it.item] : null;
        const c = r.a === LootAction.USE ? CONSUMABLE_ORDER[r.id] : def?.consumable;
        app.hud.notice(r.a === LootAction.USE && c ? `${CONSUMABLE_STAT[c]} CHEIA` : def?.kind === 'ammo' ? `RESERVA CHEIA · ${def.name}` : c ? `LIMITE DE ${CONSUMABLE_NAME[c].toUpperCase()} (${CONSUMABLES[c].maxStack})` : 'SEM ESPAÇO', 1.4);
        app.audio.play('loot.full');
        return;
      }
      default:
        app.hud.notice(REJECT_TEXT[r.r] ?? 'NÃO DEU', 1.2);
        app.audio.play('loot.full', { volume: 0.7 });
    }
  }

  onDev(m: LootDevMsg): void {
    this.devInfo = m;
  }

  /** Dev console helper: `__graao.loot.dev('regen' | 'open_all' | 'reveal' | 'give', arg)`. */
  dev(op: 'regen' | 'open_all' | 'reveal' | 'give', arg?: number | string): void {
    this.app.net?.sendDevLoot({ op, ...(typeof arg === 'number' ? { seed: arg } : typeof arg === 'string' ? { item: arg } : {}) });
  }

  // ------------------------------------------------------------------------------------------------ frame

  /** Input → intents, interaction target, prompt, labels and belt. Runs before the CombatDirector (E/Q may be ours). */
  update(dt: number, time: number): void {
    const app = this.app;
    const allowed = !!app.net && app.phase === 'MATCH' && app.combat.lootAllowed;
    const input = app.input;
    if (this.choice) {
      // The replacement card owns E and Q while it is open.
      const it = this.items.get(this.choice.id);
      if (!it || !allowed || this.distanceTo(it.pos) > this.pickupRange() + 0.6) this.closeChoice();
      else if (input.consume('weapon1')) this.sendInteract(1, it.id, 0, true);
      else if (input.consume('weapon2')) this.sendInteract(1, it.id, 1, true);
      else if (input.consume('interact')) this.closeChoice();
    } else if (input.consume('interact')) {
      const t = allowed ? this.target : null;
      if (t?.kind === 0) this.sendInteract(0, t.chest.id);
      else if (t?.kind === 1) {
        const full = ITEMS[t.item.item].kind === 'weapon' && app.combat.weapon.ids.every((x) => x);
        if (full) this.openChoice(t.item);
        else this.sendInteract(1, t.item.id);
      } else if (app.phase === 'MATCH') app.interactives.use();
    }
    for (const [k, key] of (['item1', 'item2', 'item3'] as const).entries()) if (input.consume(key) && allowed) this.tryUse(k);

    this.target = allowed && input.locked ? this.findTarget() : null;
    this.updatePrompt();
    this.updateLabels();
    this.noticeChests();
    const now = this.serverNow();
    const using = this.using ? this.useItem : -1;
    const total = this.useUntil - this.useStart;
    this.hud.setBelt(this.counts, using, using >= 0 && total > 0 ? Math.min(1, Math.max(0, (now - this.useStart) / total)) : 0);
    this.view.update(dt, time);
    if (this.debug) this.updateDebug();
    else if (this.debugLayer.childElementCount) this.debugLayer.innerHTML = '';
  }

  private sendInteract(k: 0 | 1, id: number, w?: number, force = false): void {
    const now = performance.now();
    // One request in flight (or a short gap), like the server's rate limit.
    if (!force && this.pendingSeq >= 0 && now - this.sentAt < 400) return;
    if (now - this.sentAt < LOOT_RULES.requestIntervalMs + 15) return;
    this.seq = (this.seq + 1) & 0x7fffffff;
    this.pendingSeq = this.seq;
    this.sentAt = now;
    this.app.net?.sendInteract({ s: this.seq, k, id, g: this.gen, ...(w !== undefined ? { w } : {}) });
    if (w !== undefined) this.closeChoice();
  }

  private tryUse(k: number): void {
    const app = this.app;
    const id = CONSUMABLE_ORDER[k]!;
    if (this.using) return;
    if ((this.counts[k] ?? 0) <= 0) {
      app.hud.notice(`SEM ${CONSUMABLE_NAME[id].toUpperCase()}`, 1.1);
      app.audio.play('loot.full', { volume: 0.6 });
      return;
    }
    const c = app.combat;
    const full = id === 'health' ? c.health >= ATTRIBUTES.maxHealth : id === 'shield' ? c.shield >= ATTRIBUTES.maxShield : c.mana >= ATTRIBUTES.maxMana;
    if (full) {
      app.hud.notice(`${CONSUMABLE_STAT[id]} CHEIA`, 1.1);
      app.audio.play('loot.full', { volume: 0.6 });
      return;
    }
    const now = performance.now();
    if (now - this.sentAt < LOOT_RULES.requestIntervalMs + 15) return;
    this.seq = (this.seq + 1) & 0x7fffffff;
    this.sentAt = now;
    app.net?.sendUseItem({ s: this.seq, c: k });
  }

  private openChoice(it: ItemClient): void {
    const c = this.app.combat.weapon;
    const def = ITEMS[it.item];
    this.choice = it;
    this.hud.setChoice({
      item: def.name,
      rarity: def.rarity,
      slots: [0, 1].map((i) => {
        const id = c.ids[i];
        const wi = id ? (`weapon_${id}` as ItemId) : null;
        return { key: keyLabel(this.app.input.keyFor(i === 0 ? 'weapon1' : 'weapon2')), name: id ? WEAPONS[id].name : 'vazio', ...(wi && ITEMS[wi] ? { rarity: ITEMS[wi].rarity } : {}) };
      }),
    });
    this.app.audio.play('ui.click');
  }

  private closeChoice(): void {
    this.choice = null;
    this.hud.setChoice(null);
  }

  private distanceTo(p: THREE.Vector3): number {
    const f = this.app.local.state.pos;
    return Math.hypot(p.x - f.x, p.y - f.y, p.z - f.z);
  }

  /** The closest chest or item in reach, favouring what the camera looks at, with nothing solid in between. */
  private findTarget(): Target | null {
    const feet = this.app.local.state.pos;
    const up = this.tmp.set(feet.x, feet.y, feet.z).normalize();
    const look = this.app.camera.frame.forward;
    const flatLook = this.tmp2.copy(look).addScaledVector(up, -look.dot(up)).normalize();
    const score = (p: THREE.Vector3, range: number): number => {
      const d = this.distanceTo(p);
      if (d > range) return Infinity;
      const to = this.tmp3.set(p.x - feet.x, p.y - feet.y, p.z - feet.z);
      to.addScaledVector(up, -to.dot(up));
      const ang = to.lengthSq() > 1e-4 ? Math.acos(THREE.MathUtils.clamp(to.normalize().dot(flatLook), -1, 1)) : 0;
      return d + ang * 1.1;
    };
    const cands: { t: Target; s: number; at: THREE.Vector3 }[] = [];
    for (const c of this.chests.values()) {
      if (c.state !== ChestState.CLOSED) continue;
      const center = c.pos.clone().addScaledVector(c.up, 0.35);
      const s = score(center, LOOT_RULES.chestRange);
      if (s < Infinity) cands.push({ t: { kind: 0, chest: c }, s, at: center.addScaledVector(c.up, 0.15) });
    }
    for (const it of this.items.values()) {
      if (!this.view.hasItem(it.id)) continue;
      const s = score(it.pos, this.pickupRange());
      if (s < Infinity) cands.push({ t: { kind: 1, item: it }, s: s - 0.15, at: it.pos.clone().addScaledVector(it.pos.clone().normalize(), 0.25) });
    }
    cands.sort((a, b) => a.s - b.s);
    const eye = new THREE.Vector3(feet.x, feet.y, feet.z).addScaledVector(up, 1.1);
    for (const c of cands.slice(0, 3)) {
      const d = c.at.clone().sub(eye);
      const len = d.length();
      if (len < 0.3 || !this.app.world.physics.castRay(eye, d.divideScalar(len), len - 0.25, GROUPS_WORLD_QUERY)) return c.t;
    }
    return null;
  }

  private updatePrompt(): void {
    const t = this.target;
    if (this.choice || !t) {
      // Nothing to loot: F works the door ahead, if any.
      this.hud.setPrompt(this.choice ? null : this.app.interactives.prompt());
      return;
    }
    if (t.kind === 0) {
      this.hud.setPrompt({ action: 'Abrir baú' });
      return;
    }
    const def = ITEMS[t.item.item];
    const w = this.app.combat.weapon;
    if (def.kind === 'weapon') {
      const free = w.ids.findIndex((x) => !x);
      const weaponKeys = (['weapon1', 'weapon2'] as const).map((action) => keyLabel(this.app.input.keyFor(action)));
      this.hud.setPrompt({ action: free < 0 ? 'Trocar de arma' : 'Pegar arma', item: def.name, rarity: def.rarity, note: free < 0 ? `escolha ${weaponKeys[0]} ou ${weaponKeys[1]}` : `vai para ${weaponKeys[free]}` });
    } else if (def.kind === 'ammo') {
      const full = w.reserve[def.ammo!] >= AMMO[def.ammo!].max;
      const mine = w.ids.find((id) => id && WEAPONS[id].ammo === def.ammo);
      this.hud.setPrompt({ action: 'Coletar munição', item: def.name, qty: t.item.qty, note: full ? 'reserva cheia' : mine ? `para ${WEAPONS[mine].name}` : 'nenhuma arma sua usa' });
    } else {
      const k = CONSUMABLE_ORDER.indexOf(def.consumable!);
      const full = (this.counts[k] ?? 0) >= CONSUMABLES[def.consumable!].maxStack;
      const action = (['item1', 'item2', 'item3'] as const)[k]!;
      this.hud.setPrompt({ action: 'Coletar', item: def.name, rarity: def.rarity, qty: t.item.qty, note: full ? 'limite atingido' : `usar com ${keyLabel(this.app.input.keyFor(action))}` });
    }
  }

  /** Labels over the nearest items in view (DOM, pooled), hidden behind walls and the planet's curve. */
  private updateLabels(): void {
    const app = this.app;
    if (app.phase !== 'MATCH' || !this.items.size) {
      this.hud.setLabels([]);
      return;
    }
    const cam = app.r.camera;
    const near: { it: ItemClient; d: number }[] = [];
    for (const it of this.items.values()) {
      const d = cam.position.distanceTo(it.pos);
      if (d < 13 && this.view.hasItem(it.id)) near.push({ it, d });
    }
    near.sort((a, b) => a.d - b.d);
    const out: LabelView[] = [];
    const w = window.innerWidth;
    const h = window.innerHeight;
    const target = this.target?.kind === 1 ? this.target.item.id : -1;
    for (const { it, d } of near.slice(0, 8)) {
      const at = this.view.itemDrawPos(it.id, this.tmp);
      if (!at) continue;
      at.addScaledVector(this.tmp2.copy(at).normalize(), 0.35);
      const dir = this.tmp3.copy(at).sub(cam.position);
      const len = dir.length();
      if (app.world.physics.castRay(cam.position, dir.divideScalar(len), len - 0.4, GROUPS_WORLD_QUERY)) continue;
      const p = at.project(cam);
      if (p.z > 1 || Math.abs(p.x) > 1.1 || Math.abs(p.y) > 1.1) continue;
      const def = ITEMS[it.item];
      out.push({ x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h, name: def.name, qty: def.kind === 'weapon' ? 1 : it.qty, rarity: def.rarity, target: it.id === target, alpha: THREE.MathUtils.clamp(1.25 - d / 13, 0.35, 1) });
    }
    this.hud.setLabels(out);
  }

  /** WORLD/AUDIO: the first time a closed chest comes into view nearby, a faint shimmer points it out. */
  private noticeChests(): void {
    if (!this.app.net || this.app.phase !== 'MATCH') return;
    const cam = this.app.r.camera;
    const look = this.app.camera.frame.forward;
    for (const c of this.chests.values()) {
      if (c.state !== ChestState.CLOSED || this.noticed.has(c.id)) continue;
      const d = this.tmp.copy(c.pos).sub(cam.position);
      const len = d.length();
      if (len > 22 || d.divideScalar(len).dot(look) < 0.55) continue;
      if (this.app.world.physics.castRay(cam.position, d, len - 0.6, GROUPS_WORLD_QUERY)) continue;
      this.noticed.add(c.id);
      this.play('loot.near', c.pos, 0.6);
    }
  }

  /** A loot sound at a world point: panned and attenuated by distance (silent beyond 45 m). */
  private play(cue: Parameters<GraaoApp['audio']['play']>[0], at: THREE.Vector3 | { x: number; y: number; z: number }, volume: number, pitch = 1): void {
    const cam = this.app.r.camera;
    const d = this.tmp3.set(at.x - cam.position.x, at.y - cam.position.y, at.z - cam.position.z);
    const dist = d.length();
    if (dist > 45) return;
    const pan = dist > 0.01 ? d.dot(this.app.camera.frame.right) / dist : 0;
    this.app.audio.play(cue, { volume: volume / (1 + dist / 12), pan, muffle: Math.min(0.7, dist / 70), pitch });
  }

  private bestRarity(chestId: number): Rarity {
    let best = 0;
    for (const it of this.items.values()) if (it.src === chestId) best = Math.max(best, RARITY_ORDER.indexOf(ITEMS[it.item].rarity));
    return RARITY_ORDER[best]!;
  }

  // ------------------------------------------------------------------------------------------------ dev

  private updateDebug(): void {
    const cam = this.app.r.camera;
    const rows: { at: THREE.Vector3; text: string; cls: string }[] = [];
    for (const c of this.chests.values()) {
      const info = this.devInfo?.chests.find((x) => x.id === c.id);
      const state = ['FECHADO', 'ABRINDO', 'ABERTO', 'VAZIO'][c.state];
      const items = info?.items.map(([id, n]) => `${ITEMS[id as ItemId]?.name ?? id}${n > 1 ? ` ×${n}` : ''}`).join(', ') ?? '(F3: __graao.loot.dev("reveal"))';
      rows.push({ at: c.pos.clone().addScaledVector(c.up, 1.4), text: `#${c.id} ${info?.spot ?? ''} · ${state}\n${info?.region ?? ''}\n${items}`, cls: 'chest' });
    }
    for (const s of this.devInfo?.spots ?? []) rows.push({ at: new THREE.Vector3(s.x, s.y, s.z).multiplyScalar(1.0005), text: `${s.ok ? '◇' : '✕'} ${s.id}${s.ok ? (s.moved ? ` (+${s.moved.toFixed(1)} m)` : '') : ` · ${s.reason}`}`, cls: s.ok ? 'spot' : 'spot bad' });
    while (this.debugLayer.childElementCount < rows.length) this.debugLayer.appendChild(document.createElement('pre'));
    const els = [...this.debugLayer.children] as HTMLElement[];
    els.forEach((e, i) => {
      const r = rows[i];
      const p = r ? r.at.clone().project(cam) : null;
      const vis = !!r && !!p && p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1 && cam.position.distanceTo(r.at) < 120;
      e.style.display = vis ? 'block' : 'none';
      if (!vis || !r || !p) return;
      e.className = r.cls;
      if (e.textContent !== r.text) e.textContent = r.text;
      e.style.transform = `translate(${(((p.x + 1) / 2) * window.innerWidth).toFixed(0)}px, ${(((1 - p.y) / 2) * window.innerHeight).toFixed(0)}px) translate(-50%, -100%)`;
    });
  }

  /** F3 overlay line. */
  stats(): string {
    const s = this.view.stats();
    const by = [0, 0, 0, 0];
    for (const c of this.chests.values()) by[c.state] = (by[c.state] ?? 0) + 1;
    const [closed = 0, opening = 0, open = 0, empty = 0] = by;
    return `ger. ${this.gen} · baús ${s.chests} (${closed} fechados, ${opening + open} abertos, ${empty} vazios) · itens ${s.items} · ${s.drawCalls} draw calls · ${s.triangles} tris${this.duplicates ? ` · DUPLICADOS ${this.duplicates}` : ''}`;
  }
}

// ------------------------------------------------------------------------------------------------ helpers

function chestOf(t: ChestTuple): ChestClient {
  const up = decodeDir(t, 4);
  const b = chestBasis(up, decodeDir(t, 7));
  const p = decodePos(t, 1);
  return { id: t[0], pos: new THREE.Vector3(p.x, p.y, p.z), up: new THREE.Vector3(up.x, up.y, up.z), forward: new THREE.Vector3(b.forward.x, b.forward.y, b.forward.z), state: t[10] as ChestState, region: t[11], openedAt: -1e9 };
}

const rarityColor = (r: Rarity): string => ({ common: '#fff1c9', uncommon: '#8fe07a', rare: '#6fc0ff', epic: '#d29cff' })[r];

/** Which weapons an ammunition type feeds (prompt and feed hint). */
function WEAPON_NAMES_FOR(type: (typeof AMMO_TYPES)[number]): string {
  return (Object.values(WEAPONS) as { ammo: string; name: string }[]).filter((w) => w.ammo === type).map((w) => w.name).slice(0, 3).join(', ');
}

const REJECT_TEXT: Partial<Record<LootReject, string>> = {
  [LootReject.DEAD]: 'FORA DE COMBATE',
  [LootReject.PHASE]: 'AGORA NÃO',
  [LootReject.TOO_FAR]: 'CHEGUE MAIS PERTO',
  [LootReject.BLOCKED]: 'ALGO NO CAMINHO',
  [LootReject.GONE]: 'ALGUÉM CHEGOU PRIMEIRO',
  [LootReject.BUSY]: 'MÃOS OCUPADAS',
  [LootReject.NO_ITEM]: 'VOCÊ NÃO TEM ESSE ITEM',
};
