/**
 * Shared harness for the vertical-world magic tests: the real graao server on a random port, two Colyseus SDK clients
 * with fixed loadouts in free roam (Ultimates charged, no creeps), and server-side hooks to put a player at the spot
 * under test (the protocol has no teleport). Used by `vertical.abilities.multiplayer` and `vertical.mobility.multiplayer`.
 */
import { afterAll, afterEach, beforeAll } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import { matchMaker } from '@colyseus/core';
import { DEFAULT_APPEARANCE, PLANET, TRAVERSAL, type Loadout } from '@graao/game-data';
import { dirToLatLon } from '@graao/game-core';
import { AIM_SCALE, C2S, CLIENT_VERSION, PROTOCOL_VERSION, ROOM_NAME, S2C, WISH_SCALE, v3len, v3normalize, type AbilityResultMsg, type EventsMsg, type GameEvent, type InputCmd, type SnapshotMsg, type Vec3, type WelcomeMsg } from '@graao/shared';
import { createGraaoServer } from '../../apps/server/src/app';
import { setAuthVerifier } from '../../apps/server/src/auth/SupabaseAuth';
import { setMatchStore } from '../../apps/server/src/persistence/MatchStore';
import { getWorld } from '../../apps/server/src/world';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const R = PLANET.radius;
export const ZERO: Vec3 = { x: 0, y: 0, z: 0 };
export const radial = (p: Vec3) => v3len(p) - R;
export const add = (a: Vec3, b: Vec3, s: number): Vec3 => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const neg = (v: Vec3): Vec3 => ({ x: -v.x, y: -v.y, z: -v.z });
export const mm = (p: Vec3): [number, number, number] => [Math.round(p.x * 1000), Math.round(p.y * 1000), Math.round(p.z * 1000)];
/** The tangent part of `v` at `at` (its length is the horizontal distance there). */
export function flatAt(v: Vec3, at: Vec3): Vec3 {
  const up = v3normalize(at);
  const k = v.x * up.x + v.y * up.y + v.z * up.z;
  return { x: v.x - up.x * k, y: v.y - up.y * k, z: v.z - up.z * k };
}
/** Unit tangent direction from `from` toward `to` (zero when straight above or below). */
export function toward(from: Vec3, to: Vec3): Vec3 {
  const f = flatAt(sub(to, from), from);
  const l = v3len(f);
  return l < 1e-6 ? { ...ZERO } : { x: f.x / l, y: f.y / l, z: f.z / l };
}

export interface ServerSide {
  index: number;
  state: {
    pos: Vec3; vel: Vec3; facing: Vec3; grounded: boolean; traversal: number; stamina: number; glideSteps: number; moveState: number;
    airJumped: boolean; abilityJumpUsed: boolean; grabCooldown: number; abilityMovement?: { mode: string };
  };
}

/** Starts the server for the file and leaves every room opened by the file's tests after each one. */
export function abilityServer() {
  const port = 3520 + Math.floor(Math.random() * 400);
  const server = createGraaoServer();
  const opened: Room[] = [];
  beforeAll(async () => {
    setAuthVerifier(null);
    setMatchStore({ name: 'none', record: async () => null });
    await getWorld();
    await server.listen(port);
  }, 30000);
  afterEach(async () => {
    await Promise.all(opened.splice(0).map((r) => r.leave().catch(() => {})));
  });
  afterAll(async () => {
    await server.gracefullyShutdown(false).catch(() => {});
  });
  return { url: `ws://127.0.0.1:${port}`, opened };
}

/** A client of a two-player room: its messages, its commands, and the server-side test hooks. */
export function seat(room: Room) {
  const events: GameEvent[] = [];
  const results: AbilityResultMsg[] = [];
  const snaps: SnapshotMsg[] = [];
  let welcome: WelcomeMsg | undefined;
  let seq = 1;
  let shot = 1;
  room.onMessage(S2C.WELCOME, (m: WelcomeMsg) => (welcome = m));
  room.onMessage(S2C.EVENTS, (m: EventsMsg) => events.push(...m.ev));
  room.onMessage(S2C.ABILITY_RESULT, (m: AbilityResultMsg) => results.push(m));
  room.onMessage(S2C.SNAPSHOT, (m: SnapshotMsg) => snaps.push(m));
  for (const t of [S2C.ROOM_STATE, S2C.SELF, S2C.ABILITY_STATE, S2C.ABILITY_REVEAL, S2C.LOOT_STATE, S2C.WORLD_STATE, S2C.DRAFT_STATE, S2C.LOOT_RESULT, S2C.NOTICE, S2C.MATCH_SUMMARY]) room.onMessage(t, () => {});
  return {
    room,
    events,
    results,
    snaps,
    get index() {
      return welcome?.index ?? -1;
    },
    get welcome() {
      return welcome;
    },
    /** Casts the ability in `slot` (a point or a direction), and waits for the server's answer. */
    async cast(slot: number, id: string, point?: Vec3, dir?: Vec3): Promise<AbilityResultMsg> {
      const s = results.length + 1;
      room.send(C2S.ABILITY_REQUEST, { s, k: slot, a: id, c: 1, ...(point ? { p: mm(point) } : {}), ...(dir ? { d: [Math.round(dir.x * 10000), Math.round(dir.y * 10000), Math.round(dir.z * 10000)] } : {}) });
      for (let t = 0; t < 4000 && !results.find((m) => m.s === s); t += 20) await sleep(20);
      return results.find((m) => m.s === s)!;
    },
    /** Sends commands in real time (two per 33 ms) until `until` or `seconds`. */
    async drive(seconds: number, ctl: () => { wish: Vec3; buttons: number }, until?: () => boolean): Promise<boolean> {
      const t0 = Date.now();
      while (Date.now() - t0 < seconds * 1000) {
        if (until?.()) return true;
        const c = ctl();
        const cmds: InputCmd[] = [0, 1].map(() => [seq++, Math.round(c.wish.x * WISH_SCALE), Math.round(c.wish.y * WISH_SCALE), Math.round(c.wish.z * WISH_SCALE), 0, 0, AIM_SCALE, c.buttons] as InputCmd);
        room.send(C2S.PLAYER_INPUT, { i: cmds });
        await sleep(33);
      }
      return until?.() ?? false;
    },
    fire(from: Vec3, at: Vec3): void {
      const o = add(from, v3normalize(from), 1.6);
      const c = add(at, v3normalize(at), 1.0);
      const d = { x: c.x - o.x, y: c.y - o.y, z: c.z - o.z };
      const l = v3len(d);
      room.send(C2S.FIRE, { s: shot++, w: 0, o: mm(o), d: [Math.round((d.x / l) * 10000), Math.round((d.y / l) * 10000), Math.round((d.z / l) * 10000)], a: 1 });
    },
  };
}
export type Seat = ReturnType<typeof seat>;

/** Two players with fixed builds in free roam (Ultimates charged), both spawned near `near`. */
export async function pair(url: string, opened: Room[], aBuild: Loadout, bBuild: Loadout, near: Vec3) {
  const spawn = dirToLatLon(v3normalize(near));
  const opts = (name: string, loadout: Loadout) => ({ name, appearance: DEFAULT_APPEARANCE, protocol: PROTOCOL_VERSION, client: CLIENT_VERSION, loadout, creepCount: 0 });
  const ra = await new Client(url).create(ROOM_NAME, { ...opts('A', aBuild), legacyWarmup: true, maxPlayers: 2, ultimateChargeMs: 0, creepsOff: true, freeRoamSpawns: [spawn, spawn] });
  opened.push(ra);
  const A = seat(ra);
  for (let t = 0; t < 5000 && !A.welcome; t += 20) await sleep(20);
  const rb = await new Client(url).joinById(ra.roomId, opts('B', bBuild));
  opened.push(rb);
  const B = seat(rb);
  for (let t = 0; t < 5000 && !(B.welcome && A.snaps.at(-1)?.p.length === 2); t += 20) await sleep(20);
  const room = matchMaker.getLocalRoomById(ra.roomId) as unknown as { players: Map<string, ServerSide> };
  const sp = (s: Seat) => [...room.players.values()].find((p) => p.index === s.index)!.state;
  /** Puts a player (server side) with its feet at `p`, at rest, facing `f`. */
  const put = (s: Seat, p: Vec3, f: Vec3) => {
    const st = sp(s);
    st.pos = add(p, v3normalize(p), 0.05);
    st.vel = { ...ZERO };
    st.facing = { ...f };
    st.grounded = false;
    st.traversal = 0;
    st.stamina = TRAVERSAL.stamina.max;
    st.glideSteps = 0;
  };
  await sleep(300);
  return { A, B, sp, put };
}

export const dmgBy = (seen: Seat, by: number, target: number, ability?: string) =>
  seen.events.filter((e): e is Extract<GameEvent, { e: 'dmg' }> => e.e === 'dmg' && e.by === by && e.target === target && (ability === undefined || e.a === ability));
