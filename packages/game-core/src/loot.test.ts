import { describe, expect, it } from 'vitest';
import { AMMO, BOT_KIT, CHEST_LOOT, CHEST_REGIONS, CHEST_SPOTS, CONSUMABLES, ITEMS, ITEM_IDS, LOOT_RULES, PLANET, STARTING_KIT, WEAPONS, type ItemId } from '@graao/game-data';
import { ChestState, LootReject, v3angle, v3dot, v3normalize, type GameEvent, type Vec3 } from '@graao/shared';
import { CharacterMotor, createCharacterState, newInput } from './character';
import { decodePos, groundAt, pickChestSpots, resolveChestSpots, scatterOnGround } from './chests';
import { newVitals } from './combat';
import { addAmmo, addConsumable, finishReload, freeSlot, newInventory, putWeapon, reloadAmount, rollChest, rollMatchLoot, takeAll } from './loot';
import { GRALootSystem, type LootActor, type LootHost } from './lootSystem';
import { GROUPS_PROP_QUERY, addChestCollider, refreshQueries, removeChestCollider } from './physics';
import { mulberry32 } from './rng';
import { createGameWorld } from './world';

const world = await createGameWorld({ includeVisual: false });
const spots = resolveChestSpots(world);
const kindOf = (id: ItemId) => ITEMS[id].kind;

describe('GRALootTable', () => {
  it('rolls 2–3 rewards per chest, deterministically, never the same weapon twice, a weapon with its own ammunition', () => {
    for (let seed = 0; seed < 400; seed++) {
      const a = rollChest(mulberry32(seed));
      expect(rollChest(mulberry32(seed))).toEqual(a);
      expect(a.length).toBeGreaterThanOrEqual(2);
      expect(a.length).toBeLessThanOrEqual(3);
      const weapons = a.filter((d) => kindOf(d.item) === 'weapon');
      expect(new Set(weapons.map((d) => d.item)).size).toBe(weapons.length);
      if (kindOf(a[0]!.item) === 'weapon') expect(a[1]!.item).toBe(`ammo_${WEAPONS[ITEMS[a[0]!.item].weapon!].ammo}`);
      for (const d of a) {
        expect(d.qty).toBeGreaterThanOrEqual(ITEMS[d.item].min);
        // The same consumable rolled twice is one stack (up to what a player can carry).
        const def = ITEMS[d.item];
        expect(d.qty).toBeLessThanOrEqual(def.kind === 'consumable' ? Math.max(def.max, CONSUMABLES[def.consumable!].maxStack) : def.max);
      }
      // One ammunition pack per chest.
      expect(a.filter((d) => kindOf(d.item) === 'ammo').length).toBeLessThanOrEqual(1);
    }
  });

  it('keeps every match fair: enough weapon chests, few epics, no long dry streaks (1000 simulated matches)', () => {
    const n = LOOT_RULES.chestsPerMatch;
    let dryPairs = 0;
    const byRarity = new Map<string, number>();
    for (let m = 0; m < 1000; m++) {
      const chests = rollMatchLoot(m * 2654435761, n);
      expect(chests).toHaveLength(n);
      const withWeapon = chests.filter((c) => c.some((d) => kindOf(d.item) === 'weapon')).length;
      expect(withWeapon).toBeGreaterThanOrEqual(Math.ceil(n * CHEST_LOOT.minWeaponShare));
      const epics = chests.flat().filter((d) => ITEMS[d.item].rarity === 'epic').length;
      expect(epics).toBeLessThanOrEqual(CHEST_LOOT.maxEpicPerMatch);
      for (const d of chests.flat()) if (kindOf(d.item) === 'weapon') byRarity.set(ITEMS[d.item].rarity, (byRarity.get(ITEMS[d.item].rarity) ?? 0) + 1);
      // Two random chests without a single weapon between them.
      const order = [...chests].sort(() => 0).slice(0, 2);
      if (order.every((c) => !c.some((d) => kindOf(d.item) === 'weapon'))) dryPairs++;
    }
    // Opening two chests and still having no weapon should be rare (< 15% of matches).
    expect(dryPairs / 1000).toBeLessThan(0.15);
    // Every rarity of weapon shows up; epics are the rarest.
    for (const r of ['common', 'uncommon', 'rare', 'epic']) expect(byRarity.get(r) ?? 0).toBeGreaterThan(0);
    expect(byRarity.get('epic')!).toBeLessThan(byRarity.get('rare')!);
  });
});

describe('GRAInventory', () => {
  it('caps reserves and stacks and reports exactly what moved', () => {
    const inv = newInventory(STARTING_KIT);
    expect(inv.slots[0]).toEqual({ id: 'sunbeam', ammo: WEAPONS.sunbeam.magazine });
    expect(inv.slots[1]).toBeNull();
    expect(freeSlot(inv)).toBe(1);
    expect(addAmmo(inv, 'solar', 1000)).toBe(AMMO.solar.max - STARTING_KIT.reserve.solar);
    expect(addAmmo(inv, 'solar', 5)).toBe(0);
    expect(addConsumable(inv, 'health', 2)).toBe(2);
    expect(addConsumable(inv, 'health', 5)).toBe(CONSUMABLES.health.maxStack - 2);
    expect(inv.consumables.health).toBe(CONSUMABLES.health.maxStack);
  });

  it('reloads from the reserve of the weapon’s own ammunition, never past it', () => {
    const inv = newInventory({ ...STARTING_KIT, reserve: { solar: 5, petal: 0, heavy: 0 } });
    inv.slots[0]!.ammo = 0;
    expect(reloadAmount(inv, 0)).toBe(5);
    expect(finishReload(inv, 0)).toBe(5);
    expect(inv.slots[0]!.ammo).toBe(5);
    expect(inv.reserve.solar).toBe(0);
    expect(reloadAmount(inv, 0)).toBe(0);
    // The shotgun uses petal cartridges: none in the reserve, nothing to reload.
    expect(putWeapon(inv, 1, { id: 'petal', ammo: 1 })).toBeNull();
    expect(reloadAmount(inv, 1)).toBe(0);
    // Bots never run dry.
    const bot = newInventory(BOT_KIT, true);
    bot.slots[0]!.ammo = 0;
    expect(finishReload(bot, 0)).toBe(WEAPONS.sunbeam.magazine);
    expect(bot.reserve.solar).toBe(BOT_KIT.reserve.solar);
  });

  it('swaps a weapon out and empties the inventory into ground items on death (nothing duplicated)', () => {
    const inv = newInventory(STARTING_KIT);
    putWeapon(inv, 1, { id: 'ak47', ammo: 30 });
    const old = putWeapon(inv, 0, { id: 'sniper', ammo: 5 });
    expect(old).toEqual({ id: 'sunbeam', ammo: WEAPONS.sunbeam.magazine });
    addConsumable(inv, 'shield', 2);
    addAmmo(inv, 'heavy', 50);
    const drops = takeAll(inv);
    expect(drops.map((d) => d.item).sort()).toEqual(['ammo_heavy', 'ammo_solar', 'shield_cell', 'weapon_ak47', 'weapon_sniper'].sort());
    expect(drops.find((d) => d.item === 'weapon_ak47')!.ammo).toBe(30);
    expect(drops.find((d) => d.item === 'ammo_heavy')!.qty).toBe(Math.min(50, LOOT_RULES.deathAmmoCap));
    expect(inv.slots).toEqual([null, null]);
    expect(Object.values(inv.reserve).every((n) => n === 0)).toBe(true);
    expect(Object.values(inv.consumables).every((n) => n === 0)).toBe(true);
    expect(takeAll(inv)).toEqual([]);
  });
});

describe('GRALootSpawner on the sphere', () => {
  it('resolves every authored spot onto the real ground: dry, gentle, uncovered and free of props', () => {
    expect(spots).toHaveLength(CHEST_SPOTS.length);
    for (const s of spots) {
      expect(s.ok, `${s.def.id}: ${s.reason}`).toBe(true);
      const r = Math.hypot(s.pos.x, s.pos.y, s.pos.z);
      // On the collision trimesh itself (not at an assumed radius or the analytic height) and above the sea.
      const ground = groundAt(world.physics, s.pos)!.pos;
      expect(Math.abs(r - Math.hypot(ground.x, ground.y, ground.z))).toBeLessThan(0.01);
      expect(r).toBeGreaterThan(PLANET.radius + PLANET.seaLevel + 0.3);
      expect(v3angle(s.up, v3normalize(s.pos))).toBeLessThan((18 * Math.PI) / 180);
      expect(Math.abs(v3dot(s.up, s.forward))).toBeLessThan(1e-3);
      expect(s.moved).toBeLessThanOrEqual(4);
    }
  });

  it('spreads each match’s chests over every region, kept apart', () => {
    for (let m = 0; m < 100; m++) {
      const chosen = pickChestSpots(spots, LOOT_RULES.chestsPerMatch, mulberry32(m));
      expect(chosen).toHaveLength(LOOT_RULES.chestsPerMatch);
      expect(new Set(chosen).size).toBe(chosen.length);
      for (const [ri, r] of CHEST_REGIONS.entries()) expect(chosen.filter((c) => c.region === ri).length).toBeGreaterThanOrEqual(r.min);
      for (let i = 0; i < chosen.length; i++) {
        for (let j = i + 1; j < chosen.length; j++) {
          expect(v3angle(v3normalize(chosen[i]!.pos), v3normalize(chosen[j]!.pos))).toBeGreaterThanOrEqual(((LOOT_RULES.minChestSpacingDeg - 1e-6) * Math.PI) / 180);
        }
      }
    }
    expect(pickChestSpots(spots, 3, mulberry32(1), LOOT_RULES.minChestSpacingDeg, ['lasca-sombra'])[0]!.def.id).toBe('lasca-sombra');
  });

  it('lays rewards on the ground in front of a chest, on its tangent plane, never inside a prop or under water', () => {
    for (const s of spots) {
      const pts = scatterOnGround(world.physics, s.pos, s.forward, 3);
      for (const p of pts) {
        const up = v3normalize(s.pos);
        const d = { x: p.x - s.pos.x, y: p.y - s.pos.y, z: p.z - s.pos.z };
        // Near the chest along the surface, roughly in front of it.
        expect(Math.hypot(d.x, d.y, d.z)).toBeLessThan(2.4);
        expect(Math.abs(v3dot(d, up))).toBeLessThan(1.2);
        // Resting on the trimesh (or on top of a prop), never under it.
        const g = groundAt(world.physics, p)!.pos;
        expect(Math.hypot(p.x, p.y, p.z)).toBeGreaterThan(Math.hypot(g.x, g.y, g.z) - 0.005);
        expect(Math.hypot(p.x, p.y, p.z)).toBeGreaterThan(PLANET.radius + PLANET.seaLevel);
        expect(world.physics.ballOverlaps({ x: p.x + up.x * 0.3, y: p.y + up.y * 0.3, z: p.z + up.z * 0.3 }, 0.15, GROUPS_PROP_QUERY)).toBe(false);
      }
    }
  });
});

describe('chest colliders per room (the server world is shared)', () => {
  it('stops a character at its own room’s chest and lets another room’s characters through', () => {
    const s = spots.find((x) => x.def.id === 'lago-margem-norte')!;
    const handle = addChestCollider(world.physics, s.pos, s.up, s.forward);
    refreshQueries(world.physics);
    try {
      const run = (filter: Set<number>) => {
        const motor = new CharacterMotor(world.physics);
        motor.chestFilter = filter;
        // Start 3 m in front of the chest and run straight at it for 1.5 s.
        const start = { x: s.pos.x + s.forward.x * 3, y: s.pos.y + s.forward.y * 3, z: s.pos.z + s.forward.z * 3 };
        const g = world.terrain.surfaceAt(v3normalize(start));
        const back = { x: -s.forward.x, y: -s.forward.y, z: -s.forward.z };
        const st = createCharacterState({ x: g.x + s.up.x * 0.1, y: g.y + s.up.y * 0.1, z: g.z + s.up.z * 0.1 }, back);
        const body = motor.createBody(st);
        const inp = newInput();
        inp.wish = { ...back };
        for (let i = 0; i < 90; i++) motor.step(body, st, inp, 1 / 60);
        body.dispose();
        const d = { x: st.pos.x - s.pos.x, y: st.pos.y - s.pos.y, z: st.pos.z - s.pos.z };
        return v3dot(d, s.forward);
      };
      // Own chest: the runner stops at its front face (≈ half depth + capsule radius).
      expect(run(new Set([handle]))).toBeGreaterThan(0.45);
      // Another room's chest: not there for this runner.
      expect(run(new Set())).toBeLessThan(0);
    } finally {
      removeChestCollider(world.physics, handle);
      refreshQueries(world.physics);
    }
  });
});

describe('GRALootSystem (authoritative chests and pickups)', () => {
  type Actor = LootActor & { weapon: number };
  function setup() {
    const events: GameEvent[] = [];
    const actors: Actor[] = [];
    let gate = LootReject.OK as LootReject;
    const host: LootHost = {
      physics: world.physics,
      actors: () => actors,
      gate: (a) => (a.vitals.alive ? gate : LootReject.DEAD),
      emit: (e) => events.push(e),
      changed: () => {},
      equip: (a, slot) => ((a as Actor).weapon = slot),
    };
    const sys = new GRALootSystem(host, spots);
    sys.generate(1234, 4, ['vila-poco']);
    const chest = sys.chests[0]!;
    const near = (k: number): Vec3 => {
      const p = { x: chest.spot.pos.x + chest.spot.forward.x * 1.6 + k * 0.3, y: chest.spot.pos.y + chest.spot.forward.y * 1.6, z: chest.spot.pos.z + chest.spot.forward.z * 1.6 };
      return world.terrain.surfaceAt(v3normalize(p));
    };
    const actor = (index: number, pos: Vec3): Actor => {
      const a: Actor = { index, vitals: newVitals(), inv: newInventory(STARTING_KIT), state: { pos, facing: chest.spot.forward }, useUntil: 0, useItem: -1, useReadyAt: [0, 0, 0], lootSeq: -1, lootAt: -1e9, weapon: 0 };
      actors.push(a);
      return a;
    };
    return { sys, events, chest, near, actor, setGate: (g: LootReject) => (gate = g) };
  }

  it('opens a chest once: the first valid request wins, the second is refused, rewards appear in front after openMs', () => {
    const { sys, events, chest, near, actor } = setup();
    const a = actor(0, near(0));
    const b = actor(1, near(1));
    const far = actor(2, world.terrain.surfaceAt(v3normalize({ x: chest.spot.pos.x + chest.spot.forward.x * 20, y: chest.spot.pos.y + chest.spot.forward.y * 20, z: chest.spot.pos.z + chest.spot.forward.z * 20 })));
    let t = 1000;
    expect(sys.interact(far, { s: 1, k: 0, id: chest.id, g: sys.gen }, t).r).toBe(LootReject.TOO_FAR);
    expect(sys.interact(a, { s: 1, k: 0, id: chest.id, g: sys.gen - 1 }, t).r).toBe(LootReject.GONE);
    expect(sys.interact(a, { s: 2, k: 0, id: chest.id, g: sys.gen }, (t += 200)).ok).toBe(true);
    // Same tick, the other player: already opening.
    expect(sys.interact(b, { s: 1, k: 0, id: chest.id, g: sys.gen }, t).r).toBe(LootReject.GONE);
    // A replayed request.
    expect(sys.interact(a, { s: 2, k: 0, id: chest.id, g: sys.gen }, (t += 200)).r).toBe(LootReject.STALE);
    sys.update(t + LOOT_RULES.openMs - 300);
    expect(chest.state).toBe(ChestState.OPENING);
    sys.update(t + LOOT_RULES.openMs);
    expect(chest.state).toBe(ChestState.OPEN);
    expect(sys.items.size).toBe(chest.contents.length);
    const spawned = events.find((e) => e.e === 'items');
    expect(spawned && spawned.e === 'items' && spawned.src).toBe(chest.id);
    for (const it of sys.items.values()) {
      const d = { x: it.pos.x - chest.spot.pos.x, y: it.pos.y - chest.spot.pos.y, z: it.pos.z - chest.spot.pos.z };
      expect(v3dot(d, chest.spot.forward)).toBeGreaterThan(-0.2);
    }
    // Opening again rolls nothing new.
    expect(sys.interact(b, { s: 2, k: 0, id: chest.id, g: sys.gen }, t + 1000).r).toBe(LootReject.GONE);
  });

  it('gives a disputed item to exactly one player and empties the chest when its last reward is taken', () => {
    const { sys, events, chest, near, actor } = setup();
    const a = actor(0, near(0));
    const b = actor(1, near(1));
    let t = 1000;
    sys.interact(a, { s: 1, k: 0, id: chest.id, g: sys.gen }, t);
    sys.update((t += LOOT_RULES.openMs));
    const ids = [...sys.items.keys()];
    let seq = 10;
    for (const id of ids) {
      // Move both next to it, both ask in the same tick.
      const it = sys.items.get(id)!;
      a.state.pos = { ...it.pos };
      b.state.pos = { ...it.pos };
      t += 500;
      const ra = sys.interact(a, { s: seq++, k: 1, id, g: sys.gen, w: 1 }, t);
      const rb = sys.interact(b, { s: seq++, k: 1, id, g: sys.gen, w: 1 }, t);
      expect(ra.ok).toBe(true);
      // B either finds it gone or (ammo/consumables with something left) takes the remainder: never the same units.
      if (rb.ok) expect((ra.n ?? 0) + (rb.n ?? 0)).toBeLessThanOrEqual(ITEMS[ITEM_IDS[ra.d!]!].max);
      else expect(rb.r).toBe(LootReject.GONE);
    }
    expect(sys.items.size).toBe(0);
    expect(chest.state).toBe(ChestState.EMPTY);
    expect(events.filter((e) => e.e === 'chest' && e.st === ChestState.EMPTY)).toHaveLength(1);
  });

  it('weapons: a free slot is filled and equipped; with both full the request must name a slot and the old one drops', () => {
    const { sys, near, actor } = setup();
    const a = actor(0, near(0));
    const give = (item: ItemId) => {
      sys.devGive(a, item);
      return [...sys.items.values()].find((x) => x.item === item)!;
    };
    let t = 1000;
    const ak = give('weapon_ak47');
    let r = sys.interact(a, { s: 1, k: 1, id: ak.id, g: sys.gen }, t);
    expect(r).toMatchObject({ ok: true, w: 1 });
    expect(a.inv.slots[1]).toEqual({ id: 'ak47', ammo: WEAPONS.ak47.magazine });
    expect(a.weapon).toBe(1);
    const sn = give('weapon_sniper');
    r = sys.interact(a, { s: 2, k: 1, id: sn.id, g: sys.gen }, (t += 200));
    expect(r.r).toBe(LootReject.SLOTS_FULL);
    expect(sys.items.has(sn.id)).toBe(true);
    r = sys.interact(a, { s: 3, k: 1, id: sn.id, g: sys.gen, w: 0 }, t + 200);
    expect(r).toMatchObject({ ok: true, w: 0 });
    expect(a.inv.slots.map((s) => s?.id)).toEqual(['sniper', 'ak47']);
    // The Raio de Sol that was in E is on the ground now, with its magazine.
    const dropped = [...sys.items.values()].filter((x) => x.item === 'weapon_sunbeam');
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.ammo).toBe(WEAPONS.sunbeam.magazine);
  });

  it('ammunition and consumables: partial takes leave the rest, full is refused with FULL', () => {
    const { sys, near, actor } = setup();
    const a = actor(0, near(0));
    a.inv.reserve.petal = AMMO.petal.max - 3;
    sys.devGive(a, 'ammo_petal');
    const it = [...sys.items.values()].find((x) => x.item === 'ammo_petal')!;
    const before = it.qty;
    let r = sys.interact(a, { s: 1, k: 1, id: it.id, g: sys.gen }, 1000);
    expect(r).toMatchObject({ ok: true, n: 3 });
    expect(sys.items.get(it.id)!.qty).toBe(before - 3);
    r = sys.interact(a, { s: 2, k: 1, id: it.id, g: sys.gen }, 1200);
    expect(r.r).toBe(LootReject.FULL);
  });

  it('consumables restore their vital after the use time, clamped to the maximum; a death cancels the use', () => {
    const { sys, near, actor } = setup();
    const a = actor(0, near(0));
    a.inv.consumables.health = 2;
    a.vitals.health = 80;
    let t = 1000;
    expect(sys.use(a, { s: 1, c: 0 }, t).ok).toBe(true);
    expect(sys.use(a, { s: 2, c: 0 }, (t += 100)).r).toBe(LootReject.BUSY);
    sys.update(t + CONSUMABLES.health.useMs);
    expect(a.vitals.health).toBe(100);
    expect(a.inv.consumables.health).toBe(1);
    // Full Health: refused, nothing spent.
    expect(sys.use(a, { s: 3, c: 0 }, (t += 5000)).r).toBe(LootReject.FULL);
    a.vitals.shield = 10;
    expect(sys.use(a, { s: 5, c: 1 }, (t += 200)).r).toBe(LootReject.NO_ITEM);
    a.inv.consumables.shield = 1;
    expect(sys.use(a, { s: 6, c: 1 }, (t += 200)).ok).toBe(true);
    a.vitals.alive = false;
    sys.update(t + CONSUMABLES.shield.useMs);
    expect(a.vitals.shield).toBe(10);
    expect(a.inv.consumables.shield).toBe(1);
    expect(a.useUntil).toBe(0);
  });

  it('drops a fallen player’s inventory through the same pickups and clears a generation cleanly', () => {
    const { sys, near, actor } = setup();
    const a = actor(0, near(0));
    a.inv.consumables.mana = 2;
    sys.dropAll(a);
    const items = [...sys.items.values()];
    expect(items.map((x) => x.item).sort()).toEqual(['ammo_solar', 'mana_crystal', 'weapon_sunbeam']);
    expect(items.every((x) => x.src === -1)).toBe(true);
    expect(a.inv.slots.every((s) => !s)).toBe(true);
    const handles = [...sys.colliders];
    expect(handles.every((h) => world.physics.chestHandles.has(h))).toBe(true);
    const gen = sys.gen;
    sys.generate(99, 3);
    expect(sys.gen).toBe(gen + 1);
    expect(sys.items.size).toBe(0);
    expect(handles.some((h) => world.physics.chestHandles.has(h))).toBe(false);
    const last = [...sys.colliders];
    sys.clear();
    expect(last.some((h) => world.physics.chestHandles.has(h))).toBe(false);
    // Wire form decodes back to the same points.
    const v = sys.view();
    expect(v.chests).toHaveLength(0);
    expect(decodePos([1000, 2000, 3000])).toEqual({ x: 1, y: 2, z: 3 });
  });
});
