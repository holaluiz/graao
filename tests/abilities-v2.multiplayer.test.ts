/** Two independent Colyseus clients; no database, no client-side gameplay authority. */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import { ABILITIES, DEFAULT_APPEARANCE, type Loadout } from '@graao/game-data';
import { chestOf, resolveTargetPoint, validateLoadout } from '@graao/game-core';
import { AbilityReject, C2S, CLIENT_VERSION, MatchPhase, PROTOCOL_VERSION, ROOM_NAME, S2C, v3cross, v3normalize, type AbilityEntityView, type AbilityResultMsg, type AbilityRevealMsg, type EventsMsg, type GameEvent, type RoomStateMsg, type SelfStatusMsg, type SnapshotMsg, type Vec3, type WelcomeMsg } from '@graao/shared';
import { createGraaoServer } from '../apps/server/src/app';
import { getNav, getWorld } from '../apps/server/src/world';
import { setAuthVerifier } from '../apps/server/src/auth/SupabaseAuth';
import { setMatchStore } from '../apps/server/src/persistence/MatchStore';

const port = 3300 + Math.floor(Math.random() * 200);
const server = createGraaoServer();
const rooms: Room[] = [];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until<T>(read: () => T | undefined | false, ms = 6000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) { const value = read(); if (value) return value; await sleep(15); }
  throw new Error('Ability v2 multiplayer condition timed out');
}
const opts = (name: string, loadout?: Loadout) => ({ name, appearance: DEFAULT_APPEARANCE, protocol: PROTOCOL_VERSION, client: CLIENT_VERSION, ...(loadout ? { loadout } : {}) });
const mm = (p: Vec3): [number, number, number] => [Math.round(p.x * 1000), Math.round(p.y * 1000), Math.round(p.z * 1000)];
function watch(room: Room) {
  let welcome: WelcomeMsg | undefined, state: RoomStateMsg | undefined, self: SelfStatusMsg | undefined, snapshot: SnapshotMsg | undefined;
  const events: GameEvent[] = [], results: AbilityResultMsg[] = [], reveals: AbilityRevealMsg[] = [];
  room.onMessage(S2C.WELCOME, (m: WelcomeMsg) => { welcome = m; });
  room.onMessage(S2C.ROOM_STATE, (m: RoomStateMsg) => { state = m; });
  room.onMessage(S2C.SELF, (m: SelfStatusMsg) => { self = m; });
  room.onMessage(S2C.SNAPSHOT, (m: SnapshotMsg) => { snapshot = m; });
  room.onMessage(S2C.EVENTS, (m: EventsMsg) => events.push(...m.ev));
  room.onMessage(S2C.ABILITY_RESULT, (m: AbilityResultMsg) => results.push(m));
  room.onMessage(S2C.ABILITY_REVEAL, (m: AbilityRevealMsg) => reveals.push(m));
  for (const type of [S2C.ABILITY_STATE, S2C.LOOT_STATE, S2C.WORLD_STATE, S2C.DRAFT_STATE, S2C.LOOT_RESULT, S2C.NOTICE, S2C.MATCH_SUMMARY]) room.onMessage(type, () => {});
  return { get welcome() { return welcome; }, get state() { return state; }, get self() { return self; }, get snapshot() { return snapshot; }, events, results, reveals };
}
type Seen = ReturnType<typeof watch>;
function feet(seen: Seen, index: number): Vec3 {
  const p = seen.snapshot!.p.find((p) => p[0] === index)!;
  return { x: p[1] / 1000, y: p[2] / 1000, z: p[3] / 1000 };
}
async function cast(room: Room, seen: Seen, slot: number, id: string, point?: Vec3, direction?: Vec3) {
  const seq = seen.results.length + 1;
  room.send(C2S.ABILITY_REQUEST, { s: seq, k: slot, a: id, c: 1, ...(point ? { p: mm(point) } : {}), ...(direction ? { d: [Math.round(direction.x * 10000), Math.round(direction.y * 10000), Math.round(direction.z * 10000)] } : {}) });
  return until(() => seen.results.find((m) => m.s === seq));
}
async function pair(aBuild: Loadout, bBuild: Loadout) {
  const a = await new Client(`ws://127.0.0.1:${port}`).create(ROOM_NAME, { ...opts('A', aBuild), legacyWarmup: true, ultimateChargeMs: 0, creepsOff: true });
  rooms.push(a); const A = watch(a); await until(() => A.welcome);
  const b = await new Client(`ws://127.0.0.1:${port}`).joinById(a.roomId, opts('B', bBuild));
  rooms.push(b); const B = watch(b); await until(() => B.welcome && A.snapshot?.p.length === 2 && B.snapshot?.p.length === 2);
  await sleep(400);
  return { a, b, A, B, ia: A.welcome!.index, ib: B.welcome!.index };
}
// The bots' navigation graph is built once per server, at the first match with bots: built here, not in a test's wait.
beforeAll(async () => { setAuthVerifier(null); setMatchStore({ name: 'none', record: async () => null }); getNav(await getWorld()); await server.listen(port); }, 60000);
afterEach(async () => { await Promise.all(rooms.splice(0).map((room) => room.leave().catch(() => {}))); });
afterAll(async () => { await server.gracefullyShutdown(false).catch(() => {}); });

describe('Ability v2 across two independent network clients', () => {
  it('replicates collision-safe dash, destructible shot cover and an owner-only portal traversal', async () => {
    const { a, b, A, B, ia, ib } = await pair(['wind_step', 'bloom', 'soft_step', 'sun_meteor'], ['paper_wall', 'firefly_scout', 'leaf_shell', 'chalk_shortcut']);
    const world = await getWorld();
    const start = feet(B, ia), other = feet(B, ib), up = v3normalize(start);
    const away = v3normalize({ x: start.x - other.x, y: start.y - other.y, z: start.z - other.z });
    expect((await cast(a, A, 0, 'wind_step', undefined, away)).ok).toBe(true);
    for (let seq = 1; seq <= 24; seq += 2) {
      a.send(C2S.PLAYER_INPUT, { i: [seq, seq + 1].map((s) => [s, 0, 0, 0, 0, 0, 1000, 0]) });
      await sleep(33);
    }
    await until(() => Math.hypot(feet(B, ia).x - start.x, feet(B, ia).y - start.y, feet(B, ia).z - start.z) > 1);
    expect(B.events.some((e) => e.e === 'cast' && e.by === ia && e.a === 'wind_step')).toBe(true);
    const source = feet(A, ia), defender = feet(A, ib), du = v3normalize(defender);
    const toward = v3normalize({ x: source.x - defender.x, y: source.y - defender.y, z: source.z - defender.z });
    const eyeB = { x: defender.x + du.x * 1.6, y: defender.y + du.y * 1.6, z: defender.z + du.z * 1.6 };
    const wallPoint = resolveTargetPoint(world.physics, world.terrain, defender, eyeB, toward, 4.5);
    const res = await cast(b, B, 0, 'paper_wall', wallPoint);
    expect(res.ok).toBe(true);
    const wall = await until(() => A.events.find((e): e is Extract<GameEvent, { e: 'abilityEntity' }> => e.e === 'abilityEntity' && e.entity.kind === 'barrier'));
    expect(wall.entity.health).toBe(90);
    const su = v3normalize(source), head = { x: source.x + su.x * 1.6, y: source.y + su.y * 1.6, z: source.z + su.z * 1.6 }, aim = chestOf(defender);
    const dir = v3normalize({ x: aim.x - head.x, y: aim.y - head.y, z: aim.z - head.z });
    const normalShield = A.snapshot!.p.find((p) => p[0] === ib)![16];
    a.send(C2S.FIRE, { s: 1, w: 0, o: mm(head), d: [Math.round(dir.x * 10000), Math.round(dir.y * 10000), Math.round(dir.z * 10000)], a: 1 });
    await until(() => A.events.find((e) => e.e === 'abilityEntity' && e.entity.id === wall.entity.id && e.entity.health! < 90));
    expect(A.snapshot!.p.find((p) => p[0] === ib)![16]).toBe(normalShield);
    expect(B.events.some((e) => e.e === 'dmg' && e.target === ib)).toBe(false);
    // Exit to the open square, away from the erected cover and buildings. The server validates both endpoints.
    const flank = v3normalize(v3cross(du, toward));
    const portalDir = flank.x > 0 ? flank : { x: -flank.x, y: -flank.y, z: -flank.z };
    const exit = resolveTargetPoint(world.physics, world.terrain, defender, eyeB, portalDir, 6);
    const portalRes = await cast(b, B, 3, 'chalk_shortcut', exit);
    expect(portalRes.ok).toBe(true);
    await until(() => A.events.filter((e) => e.e === 'abilityEntity' && e.entity.kind === 'portal').length === 2);
    const entry = A.events.find((e): e is Extract<GameEvent, { e: 'abilityEntity' }> => e.e === 'abilityEntity' && e.entity.kind === 'portal')!.entity;
    const towardEntry = v3normalize({ x: entry.at[0] / 1000 - defender.x, y: entry.at[1] / 1000 - defender.y, z: entry.at[2] / 1000 - defender.z });
    for (let seq = 1; seq <= 30; seq += 2) {
      b.send(C2S.PLAYER_INPUT, { i: [seq, seq + 1].map((s) => [s, Math.round(towardEntry.x * 127), Math.round(towardEntry.y * 127), Math.round(towardEntry.z * 127), 0, 0, 1000, 0]) });
      await sleep(33);
    }
    await until(() => Math.hypot(feet(A, ib).x - defender.x, feet(A, ib).y - defender.y, feet(A, ib).z - defender.z) > 5);
    expect(Math.hypot(feet(A, ib).x - exit.x, feet(A, ib).y - exit.y, feet(A, ib).z - exit.z)).toBeLessThan(4);
    expect(Math.hypot(feet(A, ib).x, feet(A, ib).y, feet(A, ib).z)).toBeGreaterThan(90);
    expect(up).toBeDefined();
  }, 20000);

  it('replicates pool slow once, temporary protection, moderate meteor and private resource knowledge', async () => {
    const { a, b, A, B, ia, ib } = await pair(['sap_snare', 'wind_step', 'steady_hand', 'sun_meteor'], ['leaf_shell', 'firefly_scout', 'paper_wall', 'chalk_shortcut']);
    expect((await cast(a, A, 2, 'steady_hand')).r).toBe(AbilityReject.PASSIVE);
    expect((await cast(b, B, 1, 'firefly_scout')).ok).toBe(true);
    const reveal = await until(() => B.reveals.find((m) => m.kind === 'loot'));
    expect(reveal.kind).toBe('loot');
    expect(A.reveals).toHaveLength(0);
    expect((await cast(b, B, 0, 'leaf_shell')).ok).toBe(true);
    await until(() => B.self?.tempShield === 40);
    const target = feet(A, ib);
    expect((await cast(a, A, 0, 'sap_snare', target)).ok).toBe(true);
    await until(() => B.self?.slow === 65);
    expect(B.self!.speed).toBe(65);
    expect(A.events.some((e) => e.e === 'area' && e.a === 'sap_snare')).toBe(true);
    expect(B.events.some((e) => e.e === 'dmg' && e.a === 'sap_snare')).toBe(false);
    const source = feet(A, ia), up = v3normalize(source), head = { x: source.x + up.x * 1.6, y: source.y + up.y * 1.6, z: source.z + up.z * 1.6 };
    const aim = chestOf(target), dir = v3normalize({ x: aim.x - head.x, y: aim.y - head.y, z: aim.z - head.z });
    a.send(C2S.FIRE, { s: 1, w: 0, o: mm(head), d: [Math.round(dir.x * 10000), Math.round(dir.y * 10000), Math.round(dir.z * 10000)], a: 1 });
    await until(() => B.events.find((e) => e.e === 'dmg' && e.target === ib));
    await until(() => B.self?.tempShield !== undefined && B.self.tempShield < 40);
    expect(feet(B, ib)).toBeDefined();
    expect((await cast(a, A, 3, 'sun_meteor', target)).ok).toBe(true);
    expect(A.events.some((e) => e.e === 'area' && e.a === 'sun_meteor')).toBe(false);
    const impact = await until(() => B.events.find((e) => e.e === 'dmg' && e.a === 'sun_meteor'));
    expect(impact.e === 'dmg' && impact.amount).toBe(35);
    expect(B.events.some((e) => e.e === 'cast' && e.a === 'sun_meteor' && e.by === ia)).toBe(true);
    expect((await cast(a, A, 3, 'sun_meteor', target)).r).toBe(AbilityReject.COOLDOWN);
  }, 20000);

  it.each([1, 2])('completes a ten-seat draft with %i humans, legal passives and bots casting their own builds', async (humans) => {
    const a = await new Client(`ws://127.0.0.1:${port}`).create(ROOM_NAME, { ...opts('Host'), bots: 9, draftPickMs: 100, draftRevealMs: 20, skipUfo: true, closeSpawns: true, countdownMs: 0, tormentaOff: true, creepsOff: true });
    rooms.push(a); const A = watch(a); await until(() => A.welcome);
    const guests: { room: Room; seen: Seen }[] = [];
    if (humans === 2) { const b = await new Client(`ws://127.0.0.1:${port}`).joinById(a.roomId, opts('Guest')); rooms.push(b); const B = watch(b); await until(() => B.welcome); guests.push({ room: b, seen: B }); }
    for (const room of [a, ...guests.map((g) => g.room)]) room.send(C2S.READY, { r: 1 });
    await until(() => A.state?.players.filter((p) => !p.bot).every((p) => p.ready));
    a.send(C2S.START_MATCH, {});
    const preparation = await until(() => A.state?.phase === MatchPhase.PREPARATION && A.state);
    expect(preparation.players).toHaveLength(10);
    expect(preparation.players.filter((p) => !p.bot)).toHaveLength(humans);
    for (const row of preparation.players) expect(validateLoadout(row.loadout)).not.toBeNull();
    for (const room of [a, ...guests.map((g) => g.room)]) room.send(C2S.PREPARED, { id: preparation.preparation!.id, ok: true });
    await until(() => A.state?.phase === MatchPhase.MATCH);
    const botCasts = await until(() => A.events.filter((e) => e.e === 'cast' && preparation.players.find((p) => p.index === e.by)?.bot).length > 0 && A.events.filter((e) => e.e === 'cast'), 12000);
    expect(botCasts.length).toBeGreaterThan(0);
    for (const event of botCasts) if (event.e === 'cast') expect(ABILITIES[event.a as keyof typeof ABILITIES].kind).not.toBe('passive');
    expect(A.snapshot?.p).toHaveLength(10);
  }, 25000);
});
