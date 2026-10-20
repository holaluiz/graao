/**
 * Integration: magic in the vertical world through the real graao server (docs/qa/VERTICAL_TRAVERSAL_TEST_REPORT.md),
 * two Colyseus SDK clients with fixed loadouts in free roam, abilities cast with the same requests a player sends:
 * - areas are measured in 3D: a Meteoro Solar on the ground right under the Ilha do Sino does not reach the player on
 *   it, 15 m up; one cast from the island's edge down onto the ground hits;
 * - mobility magic chases between altitudes: B rises from the ground on the Voo de Papagaio and lands on the island;
 * - a real push: the Anel de Vento throws A off the island's edge (A opens the kite on the way down and lands), and a
 *   Muro de Papel raised at the edge holds A on the island against the same push.
 * Players are put at the spots under test through the room object (a test hook: the protocol has no teleport).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import { matchMaker } from '@colyseus/core';
import { DEFAULT_APPEARANCE, GRAAO_MAP, PLANET, TRAVERSAL, type Loadout } from '@graao/game-data';
import { GROUPS_WORLD_QUERY, castOrigin, dirToLatLon, frameOfPlacement, type PlacementFrame } from '@graao/game-core';
import { AIM_SCALE, C2S, CLIENT_VERSION, InputButton, MovementState, PROTOCOL_VERSION, ROOM_NAME, S2C, WISH_SCALE, v3len, v3normalize, type AbilityResultMsg, type EventsMsg, type GameEvent, type InputCmd, type SnapshotMsg, type Vec3, type WelcomeMsg } from '@graao/shared';
import { createGraaoServer } from '../apps/server/src/app';
import { setAuthVerifier } from '../apps/server/src/auth/SupabaseAuth';
import { setMatchStore } from '../apps/server/src/persistence/MatchStore';
import { getWorld } from '../apps/server/src/world';

const PORT = 3520 + Math.floor(Math.random() * 60);
const server = createGraaoServer();
const url = `ws://127.0.0.1:${PORT}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const R = PLANET.radius;
const ZERO: Vec3 = { x: 0, y: 0, z: 0 };
const opened: Room[] = [];

beforeAll(async () => {
  setAuthVerifier(null);
  setMatchStore({ name: 'none', record: async () => null });
  await getWorld();
  await server.listen(PORT);
}, 30000);
afterEach(async () => {
  await Promise.all(opened.splice(0).map((r) => r.leave().catch(() => {})));
});
afterAll(async () => {
  await server.gracefullyShutdown(false).catch(() => {});
});

const radial = (p: Vec3) => v3len(p) - R;
const add = (a: Vec3, b: Vec3, s: number): Vec3 => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s });
const neg = (v: Vec3): Vec3 => ({ x: -v.x, y: -v.y, z: -v.z });
const mm = (p: Vec3): [number, number, number] => [Math.round(p.x * 1000), Math.round(p.y * 1000), Math.round(p.z * 1000)];

interface ServerSide {
  index: number;
  state: { pos: Vec3; vel: Vec3; facing: Vec3; grounded: boolean; traversal: number; stamina: number; glideSteps: number; abilityMovement?: { mode: string } };
}

/** A client of a two-player room: its messages, its commands, and the server-side test hooks. */
function seat(room: Room) {
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
type Seat = ReturnType<typeof seat>;

/** Two players with fixed builds in free roam (Ultimates charged), spawned beside the Ilha do Sino. */
async function pair(aBuild: Loadout, bBuild: Loadout, sino: PlacementFrame) {
  const near = dirToLatLon(v3normalize(sino.at(0, 0, 14)));
  const opts = (name: string, loadout: Loadout) => ({ name, appearance: DEFAULT_APPEARANCE, protocol: PROTOCOL_VERSION, client: CLIENT_VERSION, loadout, creepCount: 0 });
  const ra = await new Client(url).create(ROOM_NAME, { ...opts('A', aBuild), legacyWarmup: true, maxPlayers: 2, ultimateChargeMs: 0, creepsOff: true, freeRoamSpawns: [near, near] });
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

const dmgBy = (seen: Seat, by: number, target: number, ability?: string) =>
  seen.events.filter((e): e is Extract<GameEvent, { e: 'dmg' }> => e.e === 'dmg' && e.by === by && e.target === target && (ability === undefined || e.a === ability));

describe('magic between the ground and the floating islands', () => {
  let sino: PlacementFrame;
  let top = 0;
  let groundAt: (p: Vec3) => Vec3;

  beforeAll(async () => {
    const world = await getWorld();
    sino = frameOfPlacement(world.terrain, GRAAO_MAP.placements.find((p) => p.id === 'vert-ilha-do-sino')!);
    top = radial(sino.base);
    groundAt = (p: Vec3) => world.terrain.surfaceAt(v3normalize(p));
  });

  it('a Meteoro Solar on the ground right under the island does not reach the player on it; one from the edge hits the ground', async () => {
    const { A, B, sp, put } = await pair(['wind_step', 'gust_ring', 'soft_step', 'sun_meteor'], ['paper_wall', 'clothesline', 'steady_hand', 'sun_meteor'], sino);
    // A on the island; B on the ground south of it, the point under A in plain view under the rock.
    const onIsland = sino.at(1.5, 0, 1.5);
    const under = groundAt(onIsland);
    put(A, onIsland, sino.forward);
    put(B, groundAt(sino.at(1.5, 0, 12)), neg(sino.forward));
    await sleep(500);
    const below = await B.cast(3, 'sun_meteor', under);
    expect(below.ok, `meteoro sob a ilha: ${below.r}`).toBe(true);
    await sleep(1800);
    // The meteor did fall, on the ground under the island (both clients see the impact)...
    const impact = A.events.find((e): e is Extract<GameEvent, { e: 'area' }> => e.e === 'area' && e.a === 'sun_meteor' && e.by === B.index);
    expect(impact, 'o meteoro caiu').toBeTruthy();
    const at = { x: impact!.at[0] / 1000, y: impact!.at[1] / 1000, z: impact!.at[2] / 1000 };
    expect(v3len({ x: at.x - under.x, y: at.y - under.y, z: at.z - under.z })).toBeLessThan(1);
    // ...horizontally right under A, 15 m down and behind the rock: no damage, no push.
    const ua = v3normalize(sp(A).pos);
    const flat = { x: at.x - sp(A).pos.x, y: at.y - sp(A).pos.y, z: at.z - sp(A).pos.z };
    const k = flat.x * ua.x + flat.y * ua.y + flat.z * ua.z;
    expect(v3len({ x: flat.x - ua.x * k, y: flat.y - ua.y * k, z: flat.z - ua.z * k })).toBeLessThan(6);
    expect(radial(sp(A).pos) - radial(under)).toBeGreaterThan(12);
    expect(dmgBy(A, B.index, A.index, 'sun_meteor')).toHaveLength(0);
    expect(radial(sp(A).pos)).toBeGreaterThan(top - 0.3);
    // From the island's south edge down onto B in the open: the area lands on B.
    put(A, sino.at(0.5, 0, 3.6), sino.forward);
    const target = groundAt(sino.at(0.5, 0, 16));
    put(B, target, neg(sino.forward));
    await sleep(500);
    const down = await A.cast(3, 'sun_meteor', target);
    expect(down.ok, `meteoro da borda: ${down.r}`).toBe(true);
    for (let t = 0; t < 2500 && !dmgBy(B, A.index, B.index, 'sun_meteor').length; t += 50) await sleep(50);
    expect(dmgBy(B, A.index, B.index, 'sun_meteor')[0]?.amount).toBe(35);
  }, 30000);

  it('a magic projectile from under the island stops in its rock; from outside its edge it reaches the player on it', async () => {
    const world = await getWorld();
    const { A, B, sp, put } = await pair(['wind_step', 'gust_ring', 'soft_step', 'sun_meteor'], ['sun_orb', 'vine_lasso', 'steady_hand', 'sun_meteor'], sino);
    /** The aim from B's cast origin (the game's own: shoulder height, a step ahead) to A at `aimHeight`. */
    const aimFrom = (feet: Vec3, target: Vec3) => {
      const rough = { x: target.x - feet.x, y: target.y - feet.y, z: target.z - feet.z };
      const from = castOrigin(feet, rough);
      const d = { x: target.x - from.x, y: target.y - from.y, z: target.z - from.z };
      return { from, d, l: v3len(d) };
    };
    const shotAt = async (slot: number, id: string, aimHeight = 1.0) => {
      const { d } = aimFrom(sp(B).pos, add(sp(A).pos, v3normalize(sp(A).pos), aimHeight));
      const l = v3len(d);
      const before = B.events.length;
      const res = await B.cast(slot, id, undefined, { x: d.x / l, y: d.y / l, z: d.z / l });
      expect(res.ok, `${id}: ${res.r}`).toBe(true);
      for (let t = 0; t < 2000 && !B.events.slice(before).some((e) => e.e === 'projEnd'); t += 20) await sleep(20);
      return B.events.slice(before).find((e): e is Extract<GameEvent, { e: 'projEnd' }> => e.e === 'projEnd');
    };
    // Right under the island, aiming straight up at A: the orb ends in the rock (the world), never on A.
    put(A, sino.at(1.5, 0, 1.5), sino.forward);
    put(B, groundAt(sino.at(1.0, 0, 0.5)), sino.forward);
    await sleep(500);
    const blocked = await shotAt(0, 'sun_orb');
    expect(blocked, 'o orbe terminou').toBeTruthy();
    expect(blocked!.t).toBe(-1);
    const end = { x: blocked!.at[0] / 1000, y: blocked!.at[1] / 1000, z: blocked!.at[2] / 1000 };
    expect(radial(end)).toBeGreaterThan(radial(sp(B).pos) + 2);
    expect(radial(end)).toBeLessThan(top + 0.2);
    // Outside the south edge, with a clear line up to A's head at the edge (the rock's lip hides the body from below):
    // the lasso lands on A.
    put(A, sino.at(0.5, 0, 4.2), sino.forward);
    const spot = [8, 9, 10, 11, 12, 13, 14].map((z) => groundAt(sino.at(0.5, 0, z))).find((g) => {
      const { from: o, d, l } = aimFrom(g, add(sino.at(0.5, 0, 4.2), v3normalize(sino.base), 1.6));
      // The lasso is a 0.35 m ball: the line and one half a metre under it (the lip side) must both be clear.
      const dir = { x: d.x / l, y: d.y / l, z: d.z / l };
      const low = add(o, v3normalize(o), -0.5);
      const block = world.physics.castRay(o, dir, l - 0.6, GROUPS_WORLD_QUERY) ?? world.physics.castRay(low, dir, l - 0.6, GROUPS_WORLD_QUERY);
      if (process.env.GRAAO_DEBUG) console.log(`linha até A: chão ${radial(g).toFixed(2)} l ${l.toFixed(2)} bloqueio ${block ? block.toi.toFixed(2) : '—'}`);
      return l < 17.4 && !block;
    });
    expect(spot, 'um ponto no chão de onde se vê A na borda').toBeTruthy();
    put(B, spot!, neg(sino.forward));
    await sleep(500);
    const hit = await shotAt(1, 'vine_lasso', 1.6);
    if (process.env.GRAAO_DEBUG && hit) console.log(`laço terminou em t ${hit.t} a ${radial({ x: hit.at[0] / 1000, y: hit.at[1] / 1000, z: hit.at[2] / 1000 }).toFixed(2)} m`);
    expect(hit?.t, 'o laço acertou A na borda').toBe(A.index);
  }, 30000);

  it('B rises from the ground on the Voo de Papagaio and lands on the island next to A', async () => {
    const { A, B, sp, put } = await pair(['wind_step', 'gust_ring', 'soft_step', 'sun_meteor'], ['paper_wall', 'clothesline', 'steady_hand', 'kite_flight'], sino);
    put(A, sino.at(1.5, 0, 1.5), sino.forward);
    put(B, groundAt(sino.at(1.0, 0, 10)), neg(sino.forward));
    await sleep(500);
    const flight = await B.cast(3, 'kite_flight');
    expect(flight.ok, `voo: ${flight.r}`).toBe(true);
    // Straight up until clear of the island's edge, then over it (the flight holds under its ceiling), and down on it.
    const centre = sino.at(1.0, 0, 1.0);
    const landed = await B.drive(11, () => {
      const s = sp(B);
      if (radial(s.pos) < top + 1.2) return { wish: ZERO, buttons: 0 };
      const to = { x: centre.x - s.pos.x, y: centre.y - s.pos.y, z: centre.z - s.pos.z };
      const up = v3normalize(s.pos);
      const k = to.x * up.x + to.y * up.y + to.z * up.z;
      const flat = { x: to.x - up.x * k, y: to.y - up.y * k, z: to.z - up.z * k };
      const l = v3len(flat);
      return { wish: l > 1 ? { x: flat.x / l, y: flat.y / l, z: flat.z / l } : ZERO, buttons: 0 };
    }, () => sp(B).grounded && radial(sp(B).pos) > top - 0.3);
    expect(landed, `B a ${radial(sp(B).pos).toFixed(1)} m`).toBe(true);
    expect(B.events.some((e) => e.e === 'cast' && e.a === 'kite_flight' && e.by === B.index)).toBe(true);
    // A sees B standing up there with it.
    const seen = A.snaps.at(-1)!.p.find((p) => p[0] === B.index)!;
    expect(radial({ x: seen[1]! / 1000, y: seen[2]! / 1000, z: seen[3]! / 1000 })).toBeGreaterThan(top - 0.3);
  }, 30000);

  it('the Anel de Vento throws A off the edge (A opens the kite and lands); a Muro de Papel at the edge holds A on the island', async () => {
    // Without a wall.
    {
      const { A, B, sp, put } = await pair(['wind_step', 'gust_ring', 'soft_step', 'sun_meteor'], ['paper_wall', 'gust_ring', 'steady_hand', 'sun_meteor'], sino);
      put(A, sino.at(0.5, 0, 2.6), sino.forward);
      put(B, sino.at(0.5, 0, 0.8), sino.forward);
      await sleep(500);
      const ring = await B.cast(1, 'gust_ring');
      expect(ring.ok, `anel: ${ring.r}`).toBe(true);
      // A holds jump from the push on: off the edge, the kite opens on the way down.
      const states = new Set<number>();
      const down = await A.drive(7, () => ({ wish: ZERO, buttons: InputButton.JUMP }), () => {
        const s = A.snaps.at(-1)?.p.find((p) => p[0] === A.index);
        if (s) states.add(s[11]!);
        return sp(A).grounded && radial(sp(A).pos) < top - 5;
      });
      expect(down, `A a ${radial(sp(A).pos).toFixed(1)} m`).toBe(true);
      expect(states.has(MovementState.GLIDE), 'A abriu a pipa').toBe(true);
      expect(B.events.some((e) => e.e === 'cast' && e.a === 'gust_ring')).toBe(true);
    }
    // With a Muro de Papel raised by A between itself and the edge.
    {
      const { A, B, sp, put } = await pair(['paper_wall', 'gust_ring', 'soft_step', 'sun_meteor'], ['wind_step', 'gust_ring', 'steady_hand', 'sun_meteor'], sino);
      put(A, sino.at(0.5, 0, 2.3), sino.forward);
      put(B, sino.at(0.5, 0, 0.6), sino.forward);
      await sleep(500);
      const wall = await A.cast(0, 'paper_wall', sino.at(0.5, 0, 3.9));
      expect(wall.ok, `muro: ${wall.r}`).toBe(true);
      for (let t = 0; t < 2000 && !A.events.some((e) => e.e === 'abilityEntity' && e.entity.kind === 'barrier'); t += 20) await sleep(20);
      const south = () => {
        const d = { x: sp(A).pos.x - sino.base.x, y: sp(A).pos.y - sino.base.y, z: sp(A).pos.z - sino.base.z };
        return d.x * sino.forward.x + d.y * sino.forward.y + d.z * sino.forward.z;
      };
      const before = south();
      const ring = await B.cast(1, 'gust_ring');
      expect(ring.ok, `anel: ${ring.r}`).toBe(true);
      let furthest = before;
      await A.drive(2.5, () => {
        furthest = Math.max(furthest, south());
        return { wish: ZERO, buttons: 0 };
      });
      // Thrown toward the edge (the push did land) and stopped by the wall: still on the island, short of the wall.
      if (process.env.GRAAO_DEBUG) console.log(`muro: A de ${before.toFixed(2)} até ${furthest.toFixed(2)} m (muro em 3,9), altura ${radial(sp(A).pos).toFixed(2)}`);
      expect(furthest - before, 'o Anel de Vento empurrou A').toBeGreaterThan(0.5);
      expect(furthest).toBeLessThan(3.9);
      expect(radial(sp(A).pos)).toBeGreaterThan(top - 0.3);
    }
  }, 40000);
});
