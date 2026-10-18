/**
 * Integration: chests, loot, pickups, weapons, ammunition and consumables through the real graao server with two
 * Colyseus SDK clients (two players in one room on this machine, not two PCs).
 *
 * Both players stand at the same chest (forced spot, fixed seed). They race to open it and to take the same weapon;
 * the winner swaps weapons with both slots full, fires the weapon it found, picks up ammunition; the other uses a
 * consumable; an elimination drops an inventory; a new match brings fresh chests; a leaver's opening completes.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import { AMMO, CONSUMABLES, DEFAULT_APPEARANCE, ITEM_IDS, LOOT_RULES, WEAPONS, randomAppearance } from '@graao/game-data';
import { dirToLatLon } from '@graao/game-core';
import {
  C2S,
  CLIENT_VERSION,
  ChestState,
  LootAction,
  LootReject,
  MatchPhase,
  PROTOCOL_VERSION,
  ROOM_NAME,
  S2C,
  type EventsMsg,
  type GameEvent,
  type LootResultMsg,
  type LootStateMsg,
  type RoomStateMsg,
  type SelfStatusMsg,
  type SnapshotMsg,
  type WelcomeMsg,
} from '@graao/shared';
import { createGraaoServer } from '../apps/server/src/app';
import { setAuthVerifier } from '../apps/server/src/auth/SupabaseAuth';
import { setMatchStore } from '../apps/server/src/persistence/MatchStore';
import { getChestSpots, getWorld } from '../apps/server/src/world';

const PORT = 2950 + Math.floor(Math.random() * 40);
const server = createGraaoServer();
const url = `ws://127.0.0.1:${PORT}`;

beforeAll(async () => {
  setAuthVerifier(null);
  setMatchStore({ name: 'none', record: async () => null });
  await getWorld();
  await server.listen(PORT);
}, 30000);

afterAll(async () => {
  await server.gracefullyShutdown(false).catch(() => {});
});

const opts = (name: string) => ({ legacyWarmup: true, protocol: PROTOCOL_VERSION, client: CLIENT_VERSION, name, appearance: name === 'A' ? DEFAULT_APPEARANCE : randomAppearance(() => 0.42) });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function inbox<T>(room: Room, type: number) {
  const all: T[] = [];
  const waiters: { pred: (m: T) => boolean; resolve: (m: T) => void }[] = [];
  room.onMessage(type, (m: T) => {
    all.push(m);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i]!.pred(m)) {
        waiters[i]!.resolve(m);
        waiters.splice(i, 1);
      }
    }
  });
  return {
    all,
    latest: () => all[all.length - 1],
    until(pred: (m: T) => boolean, ms = 5000): Promise<T> {
      for (let i = all.length - 1; i >= 0; i--) if (pred(all[i]!)) return Promise.resolve(all[i]!);
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`timeout waiting for message ${type}`)), ms);
        waiters.push({ pred, resolve: (m) => (clearTimeout(t), resolve(m)) });
      });
    },
    /** The next message matching `pred` that arrives after this call. */
    next(pred: (m: T) => boolean, ms = 5000): Promise<T> {
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`timeout waiting for message ${type}`)), ms);
        waiters.push({ pred, resolve: (m) => (clearTimeout(t), resolve(m)) });
      });
    },
  };
}

/** Everything a client sees, with helpers to wait for events. */
function watch(room: Room) {
  const events = inbox<EventsMsg>(room, S2C.EVENTS);
  return {
    loot: inbox<LootStateMsg>(room, S2C.LOOT_STATE),
    results: inbox<LootResultMsg>(room, S2C.LOOT_RESULT),
    self: inbox<SelfStatusMsg>(room, S2C.SELF),
    rooms: inbox<RoomStateMsg>(room, S2C.ROOM_STATE),
    snaps: inbox<SnapshotMsg>(room, S2C.SNAPSHOT),
    events,
    /** The first event matching `pred` (already received or arriving). */
    async event<E extends GameEvent>(pred: (e: GameEvent) => e is E, ms = 5000): Promise<E> {
      const m = await events.until((x) => x.ev.some(pred), ms);
      return m.ev.find(pred)!;
    },
    /** Every event so far matching `pred`. */
    seen(pred: (e: GameEvent) => boolean): GameEvent[] {
      return events.all.flatMap((m) => m.ev.filter(pred));
    },
  };
}

/** Lat/lon of a point `along` m in front of a chest spot and `side` m to its side (where a player can stand). */
async function standAt(spotId: string, along: number, side: number): Promise<{ lat: number; lon: number }> {
  const s = getChestSpots(await getWorld()).find((x) => x.def.id === spotId)!;
  const sx = { x: s.up.y * s.forward.z - s.up.z * s.forward.y, y: s.up.z * s.forward.x - s.up.x * s.forward.z, z: s.up.x * s.forward.y - s.up.y * s.forward.x };
  return dirToLatLon({ x: s.pos.x + s.forward.x * along + sx.x * side, y: s.pos.y + s.forward.y * along + sx.y * side, z: s.pos.z + s.forward.z * along + sx.z * side });
}

/** Aims a shot from `from`'s head at `to`'s chest (latest snapshot), from weapon slot `w`. */
async function fireAt(room: Room, snaps: ReturnType<typeof inbox<SnapshotMsg>>, from: number, to: number, seq: number, w: number) {
  const s = await snaps.next((m) => m.p.length >= 2);
  const pa = s.p.find((p) => p[0] === from)!;
  const pb = s.p.find((p) => p[0] === to)!;
  const A = { x: pa[1] / 1000, y: pa[2] / 1000, z: pa[3] / 1000 };
  const B = { x: pb[1] / 1000, y: pb[2] / 1000, z: pb[3] / 1000 };
  const ua = Math.hypot(A.x, A.y, A.z);
  const ub = Math.hypot(B.x, B.y, B.z);
  const head = { x: A.x * (1 + 1.6 / ua), y: A.y * (1 + 1.6 / ua), z: A.z * (1 + 1.6 / ua) };
  const chest = { x: B.x * (1 + 1.0 / ub), y: B.y * (1 + 1.0 / ub), z: B.z * (1 + 1.0 / ub) };
  const d = { x: chest.x - head.x, y: chest.y - head.y, z: chest.z - head.z };
  const l = Math.hypot(d.x, d.y, d.z);
  room.send(C2S.FIRE, { s: seq, w, o: [Math.round(head.x * 1000), Math.round(head.y * 1000), Math.round(head.z * 1000)], d: [Math.round((d.x / l) * 10000), Math.round((d.y / l) * 10000), Math.round((d.z / l) * 10000)], a: 1 });
}

const isChest = (st: number) => (e: GameEvent): e is Extract<GameEvent, { e: 'chest' }> => e.e === 'chest' && e.st === st;
const isItems = (src: number) => (e: GameEvent): e is Extract<GameEvent, { e: 'items' }> => e.e === 'items' && e.src === src;
const itemOf = (name: string) => ITEM_IDS.indexOf(name as (typeof ITEM_IDS)[number]);

describe('chests and loot through the authoritative server (two clients)', () => {
  it('one opening, one winner per item, swaps, ammunition, consumables, death drops and fresh chests next match', async () => {
    const chestsBefore = (await getWorld()).physics.chestHandles.size;
    const [sa, sb] = await Promise.all([standAt('lago-margem-norte', 1.45, -0.45), standAt('lago-margem-norte', 1.45, 0.75)]);
    const a = await new Client(url).create(ROOM_NAME, { ...opts('A'), maxPlayers: 2, countdownMs: 100, resultsMs: 6000, skipDraft: true, skipUfo: true, tormentaOff: true, matchSpawns: [sa, sb], lootSeed: 777, lootSpots: ['lago-margem-norte'], chestCount: 6 });
    const A = watch(a);
    const ia = (await waitWelcome(a)).index;
    const b = await new Client(url).joinById((await A.rooms.until((m) => m.players.length === 1)).code, opts('B'));
    const B = watch(b);
    const ib = (await waitWelcome(b)).index;
    try {
      // The room already has a generation in the warmup; contents never travel before a chest opens.
      const warm = await A.loot.until(() => true);
      expect(warm.chests).toHaveLength(6);
      for (const c of warm.chests) expect(c).toHaveLength(12);
      expect((await getWorld()).physics.chestHandles.size).toBe(chestsBefore + 6);

      await A.rooms.until((m) => m.players.length === 2);
      a.send(C2S.READY, { r: 1 });
      b.send(C2S.READY, { r: 1 });
      await A.rooms.until((m) => m.phase === MatchPhase.MATCH);
      // A new match, a new generation: both see the same chests, all closed, nothing on the ground.
      const la = await A.loot.until((m) => m.gen > warm.gen);
      const lb = await B.loot.until((m) => m.gen === la.gen);
      expect(lb.chests).toEqual(la.chests);
      expect(la.chests.every((c) => c[10] === ChestState.CLOSED)).toBe(true);
      expect(la.items).toHaveLength(0);
      const gen = la.gen;
      await sleep(200);

      // ---- Both try to open chest 0 at once: exactly one opening, seen by both.
      a.send(C2S.INTERACT, { s: 1, k: 0, id: 0, g: gen });
      b.send(C2S.INTERACT, { s: 1, k: 0, id: 0, g: gen });
      const [ra, rb] = await Promise.all([A.results.until((r) => r.s === 1), B.results.until((r) => r.s === 1)]);
      expect([ra.ok, rb.ok].filter(Boolean)).toHaveLength(1);
      expect((ra.ok ? rb : ra).r).toBe(LootReject.GONE);
      const opener = ra.ok ? ia : ib;
      const opening = await B.event(isChest(ChestState.OPENING));
      expect(opening.by).toBe(opener);
      const [itemsA, itemsB] = await Promise.all([A.event(isItems(0)), B.event(isItems(0))]);
      expect(itemsA.it).toEqual(itemsB.it);
      expect(itemsA.it.length).toBeGreaterThanOrEqual(2);
      expect(itemsA.it.length).toBeLessThanOrEqual(3);
      await A.event(isChest(ChestState.OPEN));
      // Opening again rolls nothing new.
      a.send(C2S.INTERACT, { s: 2, k: 0, id: 0, g: gen });
      expect((await A.results.until((r) => r.s === 2)).r).toBe(LootReject.GONE);

      // ---- One weapon, two hands: exactly one player gets it, it disappears for both.
      a.send(C2S.DEV_LOOT, { op: 'give', item: 'weapon_ak47' });
      const drop = await B.event((e): e is Extract<GameEvent, { e: 'items' }> => e.e === 'items' && e.src === -2 && e.it[0]![1] === itemOf('weapon_ak47'));
      const akId = drop.it[0]![0];
      await sleep(150);
      a.send(C2S.INTERACT, { s: 3, k: 1, id: akId, g: gen });
      b.send(C2S.INTERACT, { s: 3, k: 1, id: akId, g: gen });
      const [ta, tb] = await Promise.all([A.results.until((r) => r.s === 3), B.results.until((r) => r.s === 3)]);
      expect([ta.ok, tb.ok].filter(Boolean)).toHaveLength(1);
      expect((ta.ok ? tb : ta).r).toBe(LootReject.GONE);
      const [W, L, w, l, iw, il] = ta.ok ? [A, B, a, b, ia, ib] : [B, A, b, a, ib, ia];
      const won = ta.ok ? ta : tb;
      expect(won).toMatchObject({ a: LootAction.TAKE, w: 1, d: itemOf('weapon_ak47'), n: 1 });
      const take = await L.event((e): e is Extract<GameEvent, { e: 'take' }> => e.e === 'take' && e.id === akId);
      expect(take).toMatchObject({ by: iw, left: 0 });
      const ws = await W.self.until((s) => s.wpn[1] === 'ak47');
      expect(ws.wpn).toEqual(['sunbeam', 'ak47']);
      expect(ws.weapon).toBe(1);
      expect(ws.ammo[1]).toBe(WEAPONS.ak47.magazine);
      expect(L.self.latest()!.wpn).toEqual(['sunbeam', '']);
      // Everyone sees the new weapon in the winner's hand.
      expect((await L.rooms.until((m) => m.players.find((p) => p.index === iw)?.weapons[1] === 'ak47')).players.find((p) => p.index === il)!.weapons).toEqual(['sunbeam', '']);
      // A replayed request is stale.
      w.send(C2S.INTERACT, { s: 3, k: 1, id: akId, g: gen });
      await sleep(150);
      expect(W.results.all.filter((r) => r.s === 3)).toHaveLength(2);
      expect(W.results.latest()!.r).toBe(LootReject.STALE);

      // ---- Both slots full: the request must name a slot; the replaced weapon drops as a pickup.
      w.send(C2S.DEV_LOOT, { op: 'give', item: 'weapon_sniper' });
      const sn = await W.event((e): e is Extract<GameEvent, { e: 'items' }> => e.e === 'items' && e.it[0]![1] === itemOf('weapon_sniper'));
      const snId = sn.it[0]![0];
      await sleep(150);
      w.send(C2S.INTERACT, { s: 4, k: 1, id: snId, g: gen });
      expect((await W.results.until((r) => r.s === 4)).r).toBe(LootReject.SLOTS_FULL);
      await sleep(120);
      w.send(C2S.INTERACT, { s: 5, k: 1, id: snId, g: gen, w: 0 });
      expect(await W.results.until((r) => r.s === 5)).toMatchObject({ ok: true, w: 0 });
      const swap = await L.event((e): e is Extract<GameEvent, { e: 'items' }> => e.e === 'items' && e.src === -2 && e.it[0]![1] === itemOf('weapon_sunbeam'));
      expect(swap.by).toBe(iw);
      expect((await W.self.until((s) => s.wpn[0] === 'sniper')).wpn).toEqual(['sniper', 'ak47']);

      // ---- Fire the weapon found in the chest: the server resolves it as the sniper.
      await sleep(400);
      await fireAt(w, W.snaps, iw, il, 1, 0);
      const shot = await L.event((e): e is Extract<GameEvent, { e: 'shot' }> => e.e === 'shot' && e.by === iw);
      expect(shot.id).toBe('sniper');
      const hit = await L.event((e): e is Extract<GameEvent, { e: 'dmg' }> => e.e === 'dmg' && e.by === iw && e.target === il);
      expect(hit.amount).toBeGreaterThanOrEqual(60);
      expect((await W.self.until((s) => s.ammo[0] === WEAPONS.sniper.magazine - 1)).ammo[0]).toBe(WEAPONS.sniper.magazine - 1);

      // ---- Ammunition: into the reserve of its type, capped; a reload takes from it.
      w.send(C2S.DEV_LOOT, { op: 'give', item: 'ammo_heavy' });
      const ammo = await W.event((e): e is Extract<GameEvent, { e: 'items' }> => e.e === 'items' && e.it[0]![1] === itemOf('ammo_heavy'));
      await sleep(150);
      w.send(C2S.INTERACT, { s: 6, k: 1, id: ammo.it[0]![0], g: gen });
      const got = await W.results.until((r) => r.s === 6);
      expect(got.ok).toBe(true);
      const withAmmo = await W.self.until((s) => s.res[2]! > 0);
      expect(withAmmo.res[2]).toBe(Math.min(AMMO.heavy.max, got.n!));
      const reloadedP = W.self.next((s) => s.ammo[0] === WEAPONS.sniper.magazine && !s.reloading, 5000);
      w.send(C2S.RELOAD, {});
      const reloaded = await reloadedP;
      expect(reloaded.res[2]).toBe(withAmmo.res[2]! - 1);

      // ---- A consumable: picked up into the belt, used, Shield restored (never past the maximum).
      l.send(C2S.DEV_LOOT, { op: 'give', item: 'shield_cell' });
      const cell = await L.event((e): e is Extract<GameEvent, { e: 'items' }> => e.e === 'items' && e.it[0]![1] === itemOf('shield_cell'));
      await sleep(150);
      l.send(C2S.INTERACT, { s: 10, k: 1, id: cell.it[0]![0], g: gen });
      expect((await L.results.until((r) => r.s === 10)).ok).toBe(true);
      await L.self.until((s) => s.inv[1]! > 0);
      const before = (await L.snaps.next((m) => m.p.length >= 2)).p.find((p) => p[0] === il)![16];
      expect(before).toBeLessThan(100);
      await sleep(120);
      l.send(C2S.USE_ITEM, { s: 11, c: 1 });
      expect((await L.results.until((r) => r.s === 11)).ok).toBe(true);
      await L.event((e): e is Extract<GameEvent, { e: 'use' }> => e.e === 'use' && e.by === il && e.ph === 1, CONSUMABLES.shield.useMs + 2000);
      const after = (await L.snaps.next((m) => m.p.length >= 2)).p.find((p) => p[0] === il)![16];
      expect(after).toBe(Math.min(100, before + CONSUMABLES.shield.amount));

      // ---- Elimination: the loser's inventory goes to the ground through the same pickups.
      for (let seq = 2; seq < 40; seq++) {
        if (W.seen((e) => e.e === 'elim').length) break;
        await sleep(1150);
        await fireAt(w, W.snaps, iw, il, seq, 0);
        if (W.self.latest()!.ammo[0] === 0) w.send(C2S.SWITCH_WEAPON, { w: 1 });
      }
      const deathDrop = await A.event((e): e is Extract<GameEvent, { e: 'items' }> => e.e === 'items' && e.src === -1 && e.by === il, 8000);
      expect(deathDrop.it.map((t) => ITEM_IDS[t[1]])).toContain('weapon_sunbeam');
      expect((await L.self.until((s) => s.wpn.every((x) => x === ''))).wpn).toEqual(['', '']);

      // ---- Results → lobby: a fresh generation, every chest closed, nothing on the ground.
      await A.rooms.until((m) => m.phase === MatchPhase.RESULTS);
      a.send(C2S.RETURN_LOBBY, {});
      b.send(C2S.RETURN_LOBBY, {});
      const lobby = await A.loot.until((m) => m.gen > gen);
      expect(lobby.chests.every((c) => c[10] === ChestState.CLOSED)).toBe(true);
      expect(lobby.items).toHaveLength(0);
      expect((await B.loot.until((m) => m.gen === lobby.gen)).chests).toEqual(lobby.chests);
      // Fresh kits for everyone.
      expect((await L.self.until((s) => s.wpn[0] === 'sunbeam')).wpn).toEqual(['sunbeam', '']);
    } finally {
      await a.leave(true);
      await b.leave(true);
    }
    // The room's chest colliders left the process-wide world with it.
    await sleep(300);
    expect((await getWorld()).physics.chestHandles.size).toBe(chestsBefore);
  }, 60000);

  it('an opening completes even if the opener leaves at once; late requests from an old generation are refused', async () => {
    const [sa, sb] = await Promise.all([standAt('vila-poco', 1.45, -0.45), standAt('vila-poco', 1.45, 0.75)]);
    const a = await new Client(url).create(ROOM_NAME, { ...opts('A'), maxPlayers: 2, countdownMs: 100, resultsMs: 4000, skipDraft: true, skipUfo: true, tormentaOff: true, matchSpawns: [sa, sb], lootSeed: 99, lootSpots: ['vila-poco'], chestCount: 4 });
    const A = watch(a);
    await waitWelcome(a);
    const b = await new Client(url).joinById((await A.rooms.until((m) => m.players.length === 1)).code, opts('B'));
    const B = watch(b);
    await waitWelcome(b);
    let left = false;
    try {
      await A.rooms.until((m) => m.players.length === 2);
      const warmGen = (await A.loot.until(() => true)).gen;
      a.send(C2S.READY, { r: 1 });
      b.send(C2S.READY, { r: 1 });
      await A.rooms.until((m) => m.phase === MatchPhase.MATCH);
      const gen = (await A.loot.until((m) => m.gen > warmGen)).gen;
      await sleep(200);
      // A request naming the warmup's generation: refused.
      b.send(C2S.INTERACT, { s: 1, k: 0, id: 0, g: warmGen });
      expect((await B.results.until((r) => r.s === 1)).r).toBe(LootReject.GONE);
      await sleep(120);
      b.send(C2S.INTERACT, { s: 2, k: 0, id: 0, g: gen });
      expect((await B.results.until((r) => r.s === 2)).ok).toBe(true);
      await b.leave(true);
      left = true;
      // B is gone (A wins the match), yet the lid finishes and the rewards appear for A.
      const items = await A.event(isItems(0), LOOT_RULES.openMs + 3000);
      expect(items.it.length).toBeGreaterThanOrEqual(2);
      await A.event(isChest(ChestState.OPEN));
      expect(A.seen((e) => e.e === 'chest' && e.st === ChestState.OPENING)).toHaveLength(1);
    } finally {
      await a.leave(true);
      if (!left) await b.leave(true);
    }
  }, 30000);
});

function waitWelcome(room: Room): Promise<WelcomeMsg> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout waiting for WELCOME')), 5000);
    const off = room.onMessage(S2C.WELCOME, (m: WelcomeMsg) => {
      clearTimeout(t);
      off();
      resolve(m);
    });
  });
}
