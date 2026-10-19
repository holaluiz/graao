/**
 * Integration: Battle Royale empty hands, punches, creeps and in-match progression through the real graao server with
 * two Colyseus SDK clients.
 *
 * A and B start the match unarmed (no ghost weapons, no shots), punch each other under the server's rules (reach,
 * interval, replays), see the creeps in the snapshots, earn XP from creeps (credited by the room once per creep),
 * level up, spend a point, then find a weapon, put it away to punch and take it back to shoot.
 *
 * The second test shares one creep between A and B (final blow 70 %, the rest by damage), checks that the five
 * attributes change the fight for real (Ataque, Defesa — never against the Tormenta —, Velocidade de Ataque,
 * Vitalidade, Energia), that the server refuses what a client cannot do (no points, over the cap, forged messages),
 * and that the next match starts everyone again at level 1 with empty hands.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import { matchMaker } from '@colyseus/core';
import { CREEPS, CREEP_TYPE_IDS, DEFAULT_APPEARANCE, ITEM_IDS, MELEE, PROGRESSION, STAT_IDS, randomAppearance } from '@graao/game-data';
import { addXp, dirToLatLon } from '@graao/game-core';
import {
  C2S,
  CLIENT_VERSION,
  CreepStateCode,
  FISTS_SLOT,
  MatchPhase,
  PROTOCOL_VERSION,
  ROOM_NAME,
  S2C,
  type EventsMsg,
  type GameEvent,
  type LootStateMsg,
  type ProgressMsg,
  type RoomStateMsg,
  type SelfStatusMsg,
  type SnapshotMsg,
  type WelcomeMsg,
} from '@graao/shared';
import { createGraaoServer } from '../apps/server/src/app';
import { setAuthVerifier } from '../apps/server/src/auth/SupabaseAuth';
import { setMatchStore } from '../apps/server/src/persistence/MatchStore';
import { getChestSpots, getWorld } from '../apps/server/src/world';

const PORT = 3010 + Math.floor(Math.random() * 40);
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
    next(pred: (m: T) => boolean, ms = 5000): Promise<T> {
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`timeout waiting for message ${type}`)), ms);
        waiters.push({ pred, resolve: (m) => (clearTimeout(t), resolve(m)) });
      });
    },
  };
}

function watch(room: Room) {
  const events = inbox<EventsMsg>(room, S2C.EVENTS);
  return {
    self: inbox<SelfStatusMsg>(room, S2C.SELF),
    rooms: inbox<RoomStateMsg>(room, S2C.ROOM_STATE),
    snaps: inbox<SnapshotMsg>(room, S2C.SNAPSHOT),
    progress: inbox<ProgressMsg>(room, S2C.PROGRESS),
    loot: inbox<LootStateMsg>(room, S2C.LOOT_STATE),
    events,
    async event<E extends GameEvent>(pred: (e: GameEvent) => e is E, ms = 5000): Promise<E> {
      const m = await events.until((x) => x.ev.some(pred), ms);
      return m.ev.find(pred)!;
    },
    seen(pred: (e: GameEvent) => boolean): GameEvent[] {
      return events.all.flatMap((m) => m.ev.filter(pred));
    },
  };
}

async function standAt(spotId: string, along: number, side: number): Promise<{ lat: number; lon: number }> {
  const s = getChestSpots(await getWorld()).find((x) => x.def.id === spotId)!;
  const sx = { x: s.up.y * s.forward.z - s.up.z * s.forward.y, y: s.up.z * s.forward.x - s.up.x * s.forward.z, z: s.up.x * s.forward.y - s.up.y * s.forward.x };
  return dirToLatLon({ x: s.pos.x + s.forward.x * along + sx.x * side, y: s.pos.y + s.forward.y * along + sx.y * side, z: s.pos.z + s.forward.z * along + sx.z * side });
}

/** Head of `from` and the aim at `to`'s chest from the latest snapshot. */
async function aimAt(snaps: ReturnType<typeof inbox<SnapshotMsg>>, from: number, to: number) {
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
  return {
    o: [Math.round(head.x * 1000), Math.round(head.y * 1000), Math.round(head.z * 1000)] as [number, number, number],
    d: [Math.round((d.x / l) * 10000), Math.round((d.y / l) * 10000), Math.round((d.z / l) * 10000)] as [number, number, number],
  };
}

const isMelee = (by: number) => (e: GameEvent): e is Extract<GameEvent, { e: 'melee' }> => e.e === 'melee' && e.by === by;

describe('empty hands, punches, creeps and progression (two clients)', () => {
  it('starts unarmed, punches under the server rules, earns XP from creeps, levels up and spends a point', async () => {
    const [sa, sb] = await Promise.all([standAt('trilha-leste', 1.45, -0.45), standAt('trilha-leste', 1.45, 0.75)]);
    const a = await new Client(url).create(ROOM_NAME, { ...opts('A'), maxPlayers: 2, countdownMs: 100, resultsMs: 6000, skipDraft: true, skipUfo: true, tormentaOff: true, unarmedStart: true, matchSpawns: [sa, sb], lootSeed: 777, lootSpots: ['trilha-leste'], chestCount: 6, creepCount: 6, creepSeed: 5 });
    const A = watch(a);
    const wa = await new Promise<WelcomeMsg>((r) => a.onMessage(S2C.WELCOME, r));
    const b = await new Client(url).joinById(a.roomId, opts('B'));
    const B = watch(b);
    const wb = await new Promise<WelcomeMsg>((r) => b.onMessage(S2C.WELCOME, r));
    const ia = wa.index;
    const ib = wb.index;
    try {
      a.send(C2S.READY, { r: 1 });
      b.send(C2S.READY, { r: 1 });
      const match = await A.rooms.until((m) => m.phase === MatchPhase.MATCH);
      // ---- Empty hands for everyone: no weapon in E or Q, no reserve, fists, level 1.
      const self = await A.self.until((s) => s.alive && Array.isArray(s.wpn) && s.wpn.every((w) => w === '') && s.fists === true);
      expect(self.wpn).toEqual(['', '']);
      expect(self.res.every((n) => n === 0)).toBe(true);
      expect(self.prog).toEqual([1, 0, 80, 0]);
      expect(match.players.every((p) => p.weapons.every((w) => w === ''))).toBe(true);
      expect(match.players.every((p) => p.level === 1)).toBe(true);
      await sleep(250);
      // The snapshot's hand says fists.
      const snap = await A.snaps.next((m) => m.p.length >= 2);
      expect(snap.p.find((p) => p[0] === ia)![18]).toBe(FISTS_SLOT);

      // ---- No weapon, no shot: FIRE is refused outright.
      const aim = await aimAt(A.snaps, ia, ib);
      a.send(C2S.FIRE, { s: 1, w: 0, o: aim.o, d: aim.d, a: 1 });
      await sleep(400);
      expect(A.seen((e) => e.e === 'shot' && e.by === ia).length).toBe(0);

      // ---- A punch: the server finds B in reach and deals the punch damage, Shield first.
      a.send(C2S.MELEE, { s: 1, o: aim.o, d: aim.d });
      const m1 = await A.event(isMelee(ia));
      expect(m1).toMatchObject({ s: 1, r: 1, t: ib });
      const dmg = await B.event((e): e is Extract<GameEvent, { e: 'dmg' }> => e.e === 'dmg' && e.by === ia && e.target === ib);
      expect(dmg.amount).toBe(MELEE.damage);
      expect(dmg.shield).toBe(100 - MELEE.damage);
      expect(dmg.m).toBe(1);
      // ---- Spam inside the interval and replays never land.
      a.send(C2S.MELEE, { s: 2, o: aim.o, d: aim.d });
      a.send(C2S.MELEE, { s: 3, o: aim.o, d: aim.d });
      await sleep(MELEE.intervalMs + 120);
      a.send(C2S.MELEE, { s: 1, o: aim.o, d: aim.d });
      a.send(C2S.MELEE, { s: 4, o: aim.o, d: aim.d });
      await A.event((e): e is Extract<GameEvent, { e: 'melee' }> => isMelee(ia)(e) && e.s === 4);
      await sleep(150);
      expect(A.seen(isMelee(ia)).map((e) => (e as Extract<GameEvent, { e: 'melee' }>).s)).toEqual([1, 4]);
      // A camera origin far from the attacker is refused.
      await sleep(MELEE.intervalMs + 50);
      a.send(C2S.MELEE, { s: 5, o: [aim.o[0] + 20000, aim.o[1], aim.o[2]], d: aim.d });
      await sleep(300);
      expect(A.seen(isMelee(ia)).length).toBe(2);

      // ---- Creeps ride in the snapshots.
      const withCreeps = await A.snaps.until((m) => !!m.c && m.c.length > 0);
      expect(withCreeps.c!.length).toBeLessThanOrEqual(6);
      for (const c of withCreeps.c!) expect(CREEP_TYPE_IDS[c[1]!]).toBeTruthy();

      // ---- XP: the room credits a defeated creep once (here the creep is finished off on the server side).
      const room = matchMaker.getLocalRoomById(a.roomId) as unknown as { creeps: { creeps: Map<number, { id: number; type: string; state: number }>; damage(id: number, by: number, n: number, now: number): { killed: boolean } } };
      let level = 1;
      let earned = 0;
      for (let k = 0; k < 6 && level < 2; k++) {
        const c = [...room.creeps.creeps.values()].find((x) => x.state !== CreepStateCode.DEAD)!;
        expect(room.creeps.damage(c.id, ia, 999, Date.now()).killed).toBe(true);
        // A second killing blow on the same creep gives nothing.
        expect(room.creeps.damage(c.id, ia, 999, Date.now()).killed).toBe(false);
        const pm = await A.progress.next(() => true);
        expect(pm.xp).toBe(CREEPS[c.type as keyof typeof CREEPS].xp);
        expect(pm.last).toBe(true);
        earned += pm.xp;
        level = pm.level;
      }
      expect(level).toBe(2);
      expect(A.progress.all.length).toBeLessThanOrEqual(3);
      expect(B.progress.all.length).toBe(0);
      const lvl = await B.event((e): e is Extract<GameEvent, { e: 'lvl' }> => e.e === 'lvl' && e.target === ia);
      expect(lvl.level).toBe(2);
      expect((await B.rooms.until((m) => m.players.find((p) => p.index === ia)?.level === 2)).players.find((p) => p.index === ia)!.level).toBe(2);
      const after = await A.self.until((s) => s.prog?.[0] === 2);
      expect(after.prog).toEqual([2, earned - 80, 104, 1]);

      // ---- One point into Vitalidade: +7 maximum Health; at full Health it stays full (same fraction, no refill).
      const VIT = STAT_IDS.indexOf('vitalidade');
      a.send(C2S.ALLOCATE_STAT, { s: 1, k: VIT });
      const vit = await A.self.until((s) => s.stats?.[VIT] === 1);
      expect(vit.maxHealth).toBe(107);
      expect(vit.prog![3]).toBe(0);
      const hs = await A.snaps.next((m) => m.p.some((p) => p[0] === ia));
      expect(hs.p.find((p) => p[0] === ia)![15]).toBe(107);
      // No point left: nothing more.
      a.send(C2S.ALLOCATE_STAT, { s: 2, k: 1 });
      await sleep(300);
      expect(A.self.latest()!.stats).toEqual([0, 0, 0, 1, 0]);

      // ---- A weapon found: it takes the hand (no punches); put away, the fists come back; taken out, it shoots.
      a.send(C2S.DEV_LOOT, { op: 'give', item: 'weapon_pistol' });
      const drop = await A.event((e): e is Extract<GameEvent, { e: 'items' }> => e.e === 'items' && e.src === -2 && e.it[0]![1] === ITEM_IDS.indexOf('weapon_pistol'));
      a.send(C2S.INTERACT, { s: 1, k: 1, id: drop.it[0]![0], g: A.loot.latest()!.gen });
      const armed = await A.self.until((s) => s.wpn[0] === 'pistol' || s.wpn[1] === 'pistol');
      expect(armed.fists).toBe(false);
      await sleep(MELEE.intervalMs + 50);
      const aim2 = await aimAt(A.snaps, ia, ib);
      a.send(C2S.MELEE, { s: 6, o: aim2.o, d: aim2.d });
      await sleep(300);
      expect(A.seen(isMelee(ia)).length).toBe(2);
      a.send(C2S.SWITCH_WEAPON, { w: FISTS_SLOT });
      await A.self.until((s) => s.fists === true && (s.wpn[0] === 'pistol' || s.wpn[1] === 'pistol'));
      a.send(C2S.MELEE, { s: 7, o: aim2.o, d: aim2.d });
      await A.event((e): e is Extract<GameEvent, { e: 'melee' }> => isMelee(ia)(e) && e.s === 7);
      // Fists still refuse shots; the weapon back in hand shoots.
      a.send(C2S.FIRE, { s: 2, w: armed.weapon, o: aim2.o, d: aim2.d, a: 1 });
      await sleep(300);
      expect(A.seen((e) => e.e === 'shot' && e.by === ia).length).toBe(0);
      a.send(C2S.SWITCH_WEAPON, { w: armed.weapon });
      await A.self.until((s) => s.fists === false);
      await sleep(400);
      a.send(C2S.FIRE, { s: 3, w: armed.weapon, o: aim2.o, d: aim2.d, a: 1 });
      await A.event((e): e is Extract<GameEvent, { e: 'shot' }> => e.e === 'shot' && e.by === ia);
    } finally {
      await a.leave().catch(() => {});
      await b.leave().catch(() => {});
    }
  }, 40000);

  it('shares a creep, makes every attribute count, refuses forged progress and resets it in the next match', async () => {
    const [sa, sb] = await Promise.all([standAt('trilha-leste', 1.45, -0.45), standAt('trilha-leste', 1.45, 0.75)]);
    const a = await new Client(url).create(ROOM_NAME, { ...opts('A'), maxPlayers: 2, countdownMs: 100, resultsMs: 1200, skipDraft: true, skipUfo: true, tormentaOff: true, unarmedStart: true, matchSpawns: [sa, sb], lootSeed: 778, lootSpots: ['trilha-leste'], chestCount: 6, creepCount: 6, creepSeed: 9 });
    const A = watch(a);
    const wa = await new Promise<WelcomeMsg>((r) => a.onMessage(S2C.WELCOME, r));
    const b = await new Client(url).joinById(a.roomId, opts('B'));
    const B = watch(b);
    const wb = await new Promise<WelcomeMsg>((r) => b.onMessage(S2C.WELCOME, r));
    const ia = wa.index;
    const ib = wb.index;
    type Creep = { id: number; type: keyof typeof CREEPS; state: number };
    type Sp = { index: number; prog: Parameters<typeof addXp>[0]; vitals: { health: number; shield: number; mana: number }; mods: { meleeIntervalMs: number }; state: { pos: { x: number; y: number; z: number } } };
    const room = matchMaker.getLocalRoomById(a.roomId) as unknown as {
      creeps: { creeps: Map<number, Creep & { pos: { x: number; y: number; z: number } }>; damage(id: number, by: number, n: number, now: number): { killed: boolean } };
      players: Map<string, Sp>;
      dealDamage(by: Sp, q: Sp, amount: number, crit: boolean, now: number, ability?: string, hazard?: string): boolean;
      checkMatchEnd(): void;
    };
    const sp = (i: number) => [...room.players.values()].find((p) => p.index === i)!;
    const ATK = STAT_IDS.indexOf('ataque');
    const DEF = STAT_IDS.indexOf('defesa');
    const SPD = STAT_IDS.indexOf('velAtaque');
    const VIT = STAT_IDS.indexOf('vitalidade');
    const ENE = STAT_IDS.indexOf('energia');
    const dmgOn = (target: number, by: number) => (e: GameEvent): e is Extract<GameEvent, { e: 'dmg' }> => e.e === 'dmg' && e.by === by && e.target === target;
    try {
      a.send(C2S.READY, { r: 1 });
      b.send(C2S.READY, { r: 1 });
      await A.rooms.until((m) => m.phase === MatchPhase.MATCH);
      await A.self.until((s) => s.alive && s.fists === true);
      await B.self.until((s) => s.alive && s.fists === true);

      // ---- One creep, two players (Teste H): B lands the final blow (70 %), A gets the rest for its damage. Helpers
      // earn XP only from close by (CREEP_RULES.creditRange), so the creep is brought next to them first.
      const c = [...room.creeps.creeps.values()].find((x) => x.state !== CreepStateCode.DEAD)!;
      const pos = sp(ia).state.pos;
      c.pos = { x: pos.x * 1.0001, y: pos.y, z: pos.z + 2 };
      const xp = CREEPS[c.type].xp;
      expect(room.creeps.damage(c.id, ia, 5, Date.now()).killed).toBe(false);
      expect(room.creeps.damage(c.id, ib, 999, Date.now()).killed).toBe(true);
      const pa = await A.progress.until(() => true);
      const pb = await B.progress.until(() => true);
      const killer = Math.round(xp * PROGRESSION.creepShare.finalBlow);
      expect(pb).toMatchObject({ xp: killer, last: true });
      expect(pa).toMatchObject({ xp: xp - killer, last: false });
      expect(pa.xp + pb.xp).toBe(xp);
      // Dead once: the body shows its defeat, then it is gone for good (a respawn is a new creep with a new id).
      await sleep(CREEPS[c.type].corpseMs + 400);
      const later = await A.snaps.until((m) => !!m.c);
      expect(later.c!.some((x) => x[0] === c.id)).toBe(false);
      expect(new Set(later.c!.map((x) => x[0])).size).toBe(later.c!.length);
      expect(A.progress.all.length).toBe(1);

      // ---- The server refuses what a client cannot do (Teste G): no point to spend, no such attribute, forged level.
      a.send(C2S.ALLOCATE_STAT, { s: 1, k: ATK });
      a.send(C2S.ALLOCATE_STAT, { s: 2, k: 7 });
      a.send(C2S.ALLOCATE_STAT, { s: 3, k: -1, level: 10, points: 9 });
      a.send(C2S.PLAYER_INPUT, { level: 10, xp: 5000, prog: [10, 0, 0, 9] });
      await sleep(300);
      expect(sp(ia).prog).toMatchObject({ level: 1, points: 0 });
      expect(sp(ia).prog.stats).toEqual([0, 0, 0, 0, 0]);

      // ---- Nine points each (the room's own XP, as if they had farmed to the cap).
      addXp(sp(ia).prog, 1e6);
      addXp(sp(ib).prog, 1e6);
      // Ataque five times; the sixth is over the cap and changes nothing.
      for (let k = 0; k < 6; k++) a.send(C2S.ALLOCATE_STAT, { s: 10 + k, k: ATK });
      const atk = await A.self.until((s) => s.stats?.[ATK] === 5);
      await sleep(250);
      expect(A.self.latest()!.stats![ATK]).toBe(5);
      expect(atk.prog).toEqual([10, 0, 0, 4]);

      // ---- Ataque (Teste F): +10 % → a 9 punch lands for 10.
      const aim = await aimAt(A.snaps, ia, ib);
      a.send(C2S.MELEE, { s: 1, o: aim.o, d: aim.d });
      expect((await B.event(dmgOn(ib, ia))).amount).toBe(10);

      // ---- Defesa: B takes five points (-10 %): the same punch now lands for 9.
      for (let k = 0; k < 5; k++) b.send(C2S.ALLOCATE_STAT, { s: 1 + k, k: DEF });
      await B.self.until((s) => s.stats?.[DEF] === 5);
      await sleep(MELEE.intervalMs + 80);
      a.send(C2S.MELEE, { s: 2, o: aim.o, d: aim.d });
      const second = await B.events.next((m) => m.ev.some(dmgOn(ib, ia)));
      expect(second.ev.find(dmgOn(ib, ia))!.amount).toBe(9);
      // ...but never against the Tormenta: 10 of Tormenta is 10 off Health.
      const before = sp(ib).vitals.health;
      room.dealDamage(sp(ib), sp(ib), 10, false, Date.now(), undefined, 'tormenta');
      expect(sp(ib).vitals.health).toBe(before - 10);

      // ---- Velocidade de Ataque: four points (+12 %). A's punches 530 ms apart both land; B's (no points) do not.
      for (let k = 0; k < 4; k++) a.send(C2S.ALLOCATE_STAT, { s: 20 + k, k: SPD });
      await A.self.until((s) => s.stats?.[SPD] === 4);
      expect(sp(ia).mods.meleeIntervalMs).toBe(Math.round(MELEE.intervalMs / 1.12));
      await sleep(MELEE.intervalMs + 80);
      a.send(C2S.MELEE, { s: 3, o: aim.o, d: aim.d });
      await sleep(530);
      a.send(C2S.MELEE, { s: 4, o: aim.o, d: aim.d });
      await A.event((e): e is Extract<GameEvent, { e: 'melee' }> => isMelee(ia)(e) && e.s === 4);
      const aimB = await aimAt(B.snaps, ib, ia);
      b.send(C2S.MELEE, { s: 1, o: aimB.o, d: aimB.d });
      await sleep(530);
      b.send(C2S.MELEE, { s: 2, o: aimB.o, d: aimB.d });
      await sleep(300);
      expect(B.seen(isMelee(ib)).map((e) => (e as Extract<GameEvent, { e: 'melee' }>).s)).toEqual([1]);

      // ---- Vitalidade and Energia: +7 Health and +6 Mana per point, never a refill (same fraction).
      const hurt = sp(ib).vitals.health;
      expect(hurt).toBeLessThan(100);
      b.send(C2S.ALLOCATE_STAT, { s: 10, k: VIT });
      b.send(C2S.ALLOCATE_STAT, { s: 11, k: VIT });
      b.send(C2S.ALLOCATE_STAT, { s: 12, k: ENE });
      b.send(C2S.ALLOCATE_STAT, { s: 13, k: ENE });
      const grown = await B.self.until((s) => s.stats?.[VIT] === 2 && s.stats?.[ENE] === 2);
      expect(grown.maxHealth).toBe(114);
      expect(grown.maxMana).toBe(112);
      expect(sp(ib).vitals.health).toBe(Math.round((Math.round((hurt * 107) / 100) * 114) / 107));
      expect(sp(ib).vitals.health).toBeLessThan(114);
      expect(grown.prog![3]).toBe(0);

      // ---- The next match (Teste J): B goes down, the results end, and both start again at level 1 with nothing.
      room.dealDamage(sp(ia), sp(ib), 999, false, Date.now());
      room.dealDamage(sp(ia), sp(ib), 999, false, Date.now());
      room.checkMatchEnd();
      await A.rooms.until((m) => m.phase === MatchPhase.RESULTS);
      await A.rooms.next((m) => m.phase === MatchPhase.FREE_ROAM || m.phase === MatchPhase.LOBBY, 8000);
      const marks = [A.self.all.length, B.self.all.length];
      a.send(C2S.READY, { r: 1 });
      b.send(C2S.READY, { r: 1 });
      await A.rooms.next((m) => m.phase === MatchPhase.MATCH, 8000);
      for (const [i, W] of [A, B].entries()) {
        const fresh = await W.self.until((s) => W.self.all.indexOf(s) >= marks[i]! && s.alive && s.fists === true && s.prog?.[0] === 1 && s.stats?.every((n) => n === 0) === true);
        expect(fresh.prog).toEqual([1, 0, 80, 0]);
        expect(fresh.wpn).toEqual(['', '']);
        expect(fresh.maxHealth).toBe(100);
        expect(fresh.maxMana).toBe(100);
      }
      const roster = await A.rooms.until((m) => m.phase === MatchPhase.MATCH && m.players.every((p) => p.level === 1));
      expect(roster.players.every((p) => p.weapons.every((w) => w === ''))).toBe(true);
    } finally {
      await a.leave().catch(() => {});
      await b.leave().catch(() => {});
    }
  }, 60000);
});
