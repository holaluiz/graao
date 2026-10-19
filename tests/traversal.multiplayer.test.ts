/**
 * Integration: vertical traversal through the real graao server with two Colyseus SDK clients
 * (docs/networking/TRAVERSAL_AUTHORITY.md). A only sends intent (wish, jump); the server's motor decides the climb, the
 * pull-up, the glide and the wind, and B sees them in the authoritative snapshots (moveState, stamina, timers). The
 * summit bell is rung through WORLD_USE: the server checks reach, wakes the event wind for the room's motor and tells
 * both clients; a ring from far away is refused. Players are put at the spots under test through the room object (a
 * test hook: the protocol has no teleport).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import { matchMaker } from '@colyseus/core';
import { DEFAULT_APPEARANCE, GRAAO_MAP, TRAVERSAL, randomAppearance } from '@graao/game-data';
import { dirToLatLon, frameOfPlacement, type PlacementFrame } from '@graao/game-core';
import { AIM_SCALE, C2S, CLIENT_VERSION, InputButton, MovementState, PROTOCOL_VERSION, ROOM_NAME, S2C, STAMINA_SCALE, WISH_SCALE, type EventsMsg, type GameEvent, type InputCmd, type SnapshotMsg, type Vec3, type WelcomeMsg } from '@graao/shared';
import { createGraaoServer } from '../apps/server/src/app';
import { setAuthVerifier } from '../apps/server/src/auth/SupabaseAuth';
import { setMatchStore } from '../apps/server/src/persistence/MatchStore';
import { getWorld } from '../apps/server/src/world';

const PORT = 3060 + Math.floor(Math.random() * 40);
const server = createGraaoServer();
const url = `ws://127.0.0.1:${PORT}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  setAuthVerifier(null);
  setMatchStore({ name: 'none', record: async () => null });
  await getWorld();
  await server.listen(PORT);
}, 30000);

afterAll(async () => {
  await server.gracefullyShutdown(false).catch(() => {});
});

const opts = (name: string) => ({ legacyWarmup: true, protocol: PROTOCOL_VERSION, client: CLIENT_VERSION, name, appearance: name === 'A' ? DEFAULT_APPEARANCE : randomAppearance(() => 0.42), creepCount: 0 });

interface ServerSide {
  index: number;
  state: { pos: Vec3; vel: Vec3; facing: Vec3; grounded: boolean; traversal: number; stamina: number; glideSteps: number; airTime: number; airJumped: boolean };
}
type RoomObject = { players: Map<string, ServerSide>; motor: { windActive: ReadonlySet<number> | null }; interactives: { bells: { id: number; mapId: string; position: Vec3; up: Vec3 }[] } };

describe('vertical traversal over the network', () => {
  let a: Room;
  let b: Room;
  let ia = -1;
  let ib = -1;
  let room: RoomObject;
  let massif: PlacementFrame;
  /** A's latest snapshot as B received it. */
  const seenByB: number[][] = [];
  const eventsA: GameEvent[] = [];
  const eventsB: GameEvent[] = [];
  let seq = 1;

  const sp = (i: number) => [...room.players.values()].find((p) => p.index === i)!;
  const radial = (p: Vec3) => Math.hypot(p.x, p.y, p.z) - 100;
  /** Puts player `i` (server side) with its feet at `p`, at rest, facing `f`. */
  function put(i: number, p: Vec3, f: Vec3): void {
    const s = sp(i).state;
    const up = { x: p.x / Math.hypot(p.x, p.y, p.z), y: p.y / Math.hypot(p.x, p.y, p.z), z: p.z / Math.hypot(p.x, p.y, p.z) };
    s.pos = { x: p.x + up.x * 0.05, y: p.y + up.y * 0.05, z: p.z + up.z * 0.05 };
    s.vel = { x: 0, y: 0, z: 0 };
    s.facing = { ...f };
    s.grounded = false;
    s.traversal = 0;
    s.stamina = TRAVERSAL.stamina.max;
    s.glideSteps = 0;
  }
  /** Sends A's commands in real time (two per 33 ms) for `seconds`: a world-space wish and the buttons at time t. */
  async function drive(seconds: number, ctl: (t: number) => { wish: Vec3; buttons: number }): Promise<void> {
    const t0 = Date.now();
    while (Date.now() - t0 < seconds * 1000) {
      const c = ctl((Date.now() - t0) / 1000);
      const cmds: InputCmd[] = [0, 1].map(() => [seq++, Math.round(c.wish.x * WISH_SCALE), Math.round(c.wish.y * WISH_SCALE), Math.round(c.wish.z * WISH_SCALE), 0, 0, AIM_SCALE, c.buttons] as InputCmd);
      a.send(C2S.PLAYER_INPUT, { i: cmds });
      await sleep(33);
    }
  }
  const lastA = () => seenByB[seenByB.length - 1]!;

  it('two clients join; B sees A', async () => {
    const at = (x: number, z: number) => {
      const ll = dirToLatLon((() => { const p = massif.at(x, 0, z); const l = Math.hypot(p.x, p.y, p.z); return { x: p.x / l, y: p.y / l, z: p.z / l }; })());
      return { lat: ll.lat, lon: ll.lon };
    };
    const w = await getWorld();
    massif = frameOfPlacement(w.terrain, GRAAO_MAP.placements.find((p) => p.id === 'vert-serra-macico')!);
    a = await new Client(url).create(ROOM_NAME, { ...opts('A'), maxPlayers: 2, freeRoamSpawns: [at(0.4, 9), at(3, 12)] });
    const wa = await new Promise<WelcomeMsg>((r) => a.onMessage(S2C.WELCOME, r));
    b = await new Client(url).joinById(wa.code, opts('B'));
    const wb = await new Promise<WelcomeMsg>((r) => b.onMessage(S2C.WELCOME, r));
    ia = wa.index;
    ib = wb.index;
    room = matchMaker.getLocalRoomById(a.roomId) as unknown as RoomObject;
    b.onMessage(S2C.SNAPSHOT, (m: SnapshotMsg) => {
      const s = m.p.find((p) => p[0] === ia);
      if (s) seenByB.push([...s]);
    });
    a.onMessage(S2C.EVENTS, (m: EventsMsg) => eventsA.push(...m.ev));
    b.onMessage(S2C.EVENTS, (m: EventsMsg) => eventsB.push(...m.ev));
    for (let i = 0; i < 100 && seenByB.length < 3; i++) await sleep(30);
    expect(seenByB.length).toBeGreaterThan(2);
    // Every snapshot tuple carries the traversal fields.
    expect(lastA()).toHaveLength(23);
    expect(lastA()[20]).toBe(TRAVERSAL.stamina.max * STAMINA_SCALE);
  }, 30000);

  it('A climbs the first face and pulls up; B sees CLIMB, then MANTLE, then A standing on the terrace', async () => {
    const into = { x: -massif.forward.x, y: -massif.forward.y, z: -massif.forward.z };
    put(ia, massif.at(0.4, 0, 7.2), into);
    await sleep(300);
    const states = new Set<number>();
    let minStamina = Infinity;
    const from = seenByB.length;
    await drive(4.5, (t) => ({ wish: into, buttons: t < 0.1 ? InputButton.JUMP : 0 }));
    await sleep(200);
    for (const s of seenByB.slice(from)) {
      states.add(s[11]!);
      minStamina = Math.min(minStamina, s[20]! / STAMINA_SCALE);
    }
    expect(states.has(MovementState.CLIMB)).toBe(true);
    expect(states.has(MovementState.MANTLE)).toBe(true);
    // The climb spent stamina (18/s on the face, then the pull-up once the top is within the hands' reach), never below
    // zero.
    expect(minStamina).toBeLessThan(TRAVERSAL.stamina.max - 8);
    expect(minStamina).toBeGreaterThanOrEqual(0);
    const end = lastA();
    const terrace = radial(massif.at(0, 4.2, 0));
    expect(radial({ x: end[1]! / 1000, y: end[2]! / 1000, z: end[3]! / 1000 })).toBeGreaterThan(terrace - 0.3);
    expect(end[13]! & 1).toBe(1); // grounded
    expect(sp(ia).state.traversal).toBe(0);
  }, 20000);

  it('A rides the west updraft on the glider; B sees GLIDE and A rising', async () => {
    put(ia, massif.at(-10.9, 0, -0.8), massif.side);
    await sleep(300);
    const from = seenByB.length;
    await drive(2.5, () => ({ wish: { x: 0, y: 0, z: 0 }, buttons: InputButton.JUMP }));
    const seen = seenByB.slice(from);
    expect(seen.some((s) => s[11] === MovementState.GLIDE)).toBe(true);
    const h0 = radial({ x: seen[0]![1]! / 1000, y: seen[0]![2]! / 1000, z: seen[0]![3]! / 1000 });
    const h1 = radial({ x: lastA()[1]! / 1000, y: lastA()[2]! / 1000, z: lastA()[3]! / 1000 });
    expect(h1 - h0).toBeGreaterThan(6);
    // The server spends stamina on the glider and does not count glide time inside the updraft.
    expect(sp(ia).state.stamina).toBeLessThan(TRAVERSAL.stamina.max);
    expect(sp(ia).state.glideSteps).toBeLessThan(30);
    // Letting go of jump folds it.
    await drive(0.4, () => ({ wish: { x: 0, y: 0, z: 0 }, buttons: 0 }));
    await sleep(150);
    expect(lastA()[11]).not.toBe(MovementState.GLIDE);
  }, 20000);

  it('the summit bell rings for the whole room only from within reach, and wakes the corrente on the server', async () => {
    const bell = room.interactives.bells.find((x) => x.mapId === 'vert-serra-macico')!;
    expect(bell).toBeTruthy();
    // From the foot of the massif: too far, refused (no event).
    put(ib, massif.at(3, 0, 12), massif.forward);
    b.send(C2S.WORLD_USE, { s: 1, id: bell.id, k: 1 });
    await sleep(400);
    expect(eventsA.some((e) => e.e === 'bell')).toBe(false);
    // On the summit, in front of the sineira: rung, both clients told, the event wind blowing for the room's motor.
    put(ia, massif.at(0.2, 11.6, -1.4), massif.forward);
    await sleep(300);
    a.send(C2S.WORLD_USE, { s: 2, id: bell.id, k: 1 });
    for (let i = 0; i < 40 && !eventsB.some((e) => e.e === 'bell'); i++) await sleep(25);
    expect(eventsA).toContainEqual({ e: 'bell', id: bell.id, on: 1, by: ia });
    expect(eventsB).toContainEqual({ e: 'bell', id: bell.id, on: 1, by: ia });
    const corrente = GRAAO_MAP.winds!.findIndex((w) => w.id === 'vert-corrente-cume-ilha');
    expect(room.motor.windActive?.has(corrente)).toBe(true);
    // A second ring while it tolls is refused (no second event).
    a.send(C2S.WORLD_USE, { s: 3, id: bell.id, k: 1 });
    await sleep(500);
    expect(eventsB.filter((e) => e.e === 'bell' && e.on === 1)).toHaveLength(1);
  }, 20000);

  it('cleans up', async () => {
    await a.leave();
    await b.leave();
    void ib;
  });
});
