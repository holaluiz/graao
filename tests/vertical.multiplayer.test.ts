/**
 * Integration: the vertical world through the real graao server (docs/qa/VERTICAL_TRAVERSAL_TEST_REPORT.md, the
 * multiplayer scenarios of the request), with Colyseus SDK clients that only send intent:
 * - free roam: A jumps at a house wall of the vila, hangs from the eave and pulls up onto the roof; A rides the
 *   Corrente do Sino onto the Ilha do Sino; B sees every state in the authoritative snapshots.
 * - a real match (skipDraft/skipUfo): A on the island's edge shoots B on the ground and hits; B under the island
 *   cannot shoot A through the rock; a push throws A off the edge and A glides down and lands; the Tormenta closes on
 *   B's region, A back on the island (high and outside) is hurt by it, B (inside, on the ground) is not, and the match
 *   ends with B the winner.
 * - prediction under latency: the client's own LocalPlayer (the prediction and reconciliation the game runs) climbs,
 *   pulls up and glides with 100 ms of delay each way; the corrections stay small and never snap.
 * Players are put at the spots under test through the room object (a test hook: the protocol has no teleport); spots
 * are found with the shared motor on the real map (a house wall that leads to its roof), never hard-coded walls.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import { matchMaker } from '@colyseus/core';
import { DEFAULT_APPEARANCE, GRAAO_MAP, KIT, KIT_BUILDINGS, PLANET, TRAVERSAL, TraversalMode, randomAppearance } from '@graao/game-data';
import { CharacterMotor, applyKnockback, buildingSite, createCharacterState, createGameWorld, dirToLatLon, frameOfPlacement, headingTangent, latLonToDir, newInput, type CharacterState, type PlacementFrame } from '@graao/game-core';
import { AIM_SCALE, C2S, CLIENT_VERSION, InputButton, MatchPhase, MovementState, PROTOCOL_VERSION, ROOM_NAME, S2C, SnapFlag, WISH_SCALE, v3cross, v3len, v3normalize, type EventsMsg, type GameEvent, type InputCmd, type RoomStateMsg, type SnapshotMsg, type Vec3, type WelcomeMsg } from '@graao/shared';
import { createGraaoServer } from '../apps/server/src/app';
import { setAuthVerifier } from '../apps/server/src/auth/SupabaseAuth';
import { setMatchStore } from '../apps/server/src/persistence/MatchStore';
import { getWorld } from '../apps/server/src/world';
import { LocalPlayer } from '../apps/client/src/game/LocalPlayer';
import type { Input } from '../apps/client/src/game/Input';
import { snapToCharacterState } from '../apps/client/src/net/snapState';

const PORT = 3120 + Math.floor(Math.random() * 40);
const server = createGraaoServer();
const url = `ws://127.0.0.1:${PORT}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const R = PLANET.radius;
const ZERO: Vec3 = { x: 0, y: 0, z: 0 };
/** A world of its own for the client side (its predicted capsule must not live in the server's physics world). */
const clientWorld = await createGameWorld({ includeVisual: false });

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
const radial = (p: Vec3) => v3len(p) - R;
const add = (a: Vec3, b: Vec3, s: number): Vec3 => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s });
const neg = (v: Vec3): Vec3 => ({ x: -v.x, y: -v.y, z: -v.z });
const frame = (id: string): PlacementFrame => frameOfPlacement(clientWorld.terrain, GRAAO_MAP.placements.find((p) => p.id === id)!);
/** What a character stands on under (or just over) `p`. */
function footing(p: Vec3): Vec3 {
  const u = v3normalize(p);
  const hit = clientWorld.physics.castRay(add(p, u, 1.5), neg(u), 6)!;
  return add(p, u, 1.5 - hit.toi);
}
/** The terrain under `p` (the ground below an island, not its top). */
const groundAt = (p: Vec3): Vec3 => clientWorld.terrain.surfaceAt(v3normalize(p));
const snapPos = (s: number[]): Vec3 => ({ x: s[1]! / 1000, y: s[2]! / 1000, z: s[3]! / 1000 });

/**
 * A ground-floor wall of a building where a jump into it hangs from the eave and the pull-up stands on the roof (the
 * shared motor on the real map, as the server runs it): next to a door, facing the wall.
 */
function findRoofWall(): { feet: Vec3; into: Vec3 } {
  const motor = new CharacterMotor(clientWorld.physics);
  for (const mp of GRAAO_MAP.placements) {
    const b = KIT_BUILDINGS[mp.prefab];
    if (!b?.doors?.length) continue;
    const up = latLonToDir(mp.lat, mp.lon);
    const forward = headingTangent(up, mp.yaw);
    const side = v3normalize(v3cross(up, forward));
    const site = buildingSite(clientWorld.terrain, b, mp);
    const base = add(ZERO, up, R + clientWorld.terrain.heightAt(up) + (mp.lift ?? 0) + site.raise);
    const at = (x: number, y: number, z: number) => add(add(add(base, side, x), up, y), forward, z);
    for (const door of b.doors) {
      const a = (door.yaw * Math.PI) / 180;
      const ox = -Math.sin(a);
      const oz = Math.cos(a);
      for (const slide of [-1.4, 1.4]) {
        const feet = add(footing(at(door.x + ox * 1.1 + oz * slide, KIT.floorTop + 1.5, door.z + oz * 1.1 - ox * slide)), up, 0.04);
        const into = v3normalize(add(add(ZERO, side, -ox), forward, -oz));
        const s = createCharacterState(feet, into);
        const body = motor.createBody(s);
        const inp = newInput();
        const seen = new Set<number>();
        for (let i = 0; i < 150; i++) {
          inp.wish = into;
          inp.buttons = i > 10 && i < 14 ? InputButton.JUMP : 0;
          motor.step(body, s, inp, 1 / 60);
          seen.add(s.traversal);
        }
        body.dispose();
        if (seen.has(TraversalMode.HANG) && seen.has(TraversalMode.MANTLE) && s.grounded && radial(s.pos) - radial(feet) > 2.2) return { feet, into };
      }
    }
  }
  throw new Error('nenhuma parede com beirada até o telhado');
}

interface ServerSide {
  index: number;
  bot?: boolean;
  state: { pos: Vec3; vel: Vec3; facing: Vec3; grounded: boolean; traversal: number; stamina: number; glideSteps: number; airTime: number; airJumped: boolean; dashSteps: number };
}
type RoomObject = { players: Map<string, ServerSide> };

/** One client's view of a room plus the server-side test hooks. */
function harness(a: Room, roomId: string) {
  const room = matchMaker.getLocalRoomById(roomId) as unknown as RoomObject;
  let seq = 1;
  const sp = (i: number) => [...room.players.values()].find((p) => p.index === i)!;
  return {
    sp,
    /** Puts player `i` (server side) with its feet at `p`, at rest, facing `f`. */
    put(i: number, p: Vec3, f: Vec3): void {
      const s = sp(i).state;
      const up = v3normalize(p);
      s.pos = add(p, up, 0.05);
      s.vel = { ...ZERO };
      s.facing = { ...f };
      s.grounded = false;
      s.traversal = 0;
      s.stamina = TRAVERSAL.stamina.max;
      s.glideSteps = 0;
    },
    /** Sends this client's commands in real time (two per 33 ms) until `until` or `seconds`. */
    async drive(seconds: number, ctl: (t: number) => { wish: Vec3; buttons: number }, until?: () => boolean): Promise<boolean> {
      const t0 = Date.now();
      while (Date.now() - t0 < seconds * 1000) {
        if (until?.()) return true;
        const c = ctl((Date.now() - t0) / 1000);
        const cmds: InputCmd[] = [0, 1].map(() => [seq++, Math.round(c.wish.x * WISH_SCALE), Math.round(c.wish.y * WISH_SCALE), Math.round(c.wish.z * WISH_SCALE), 0, 0, AIM_SCALE, c.buttons] as InputCmd);
        a.send(C2S.PLAYER_INPUT, { i: cmds });
        await sleep(33);
      }
      return until?.() ?? false;
    },
  };
}

describe('the vertical world in free roam: roofs and islands', () => {
  let a: Room;
  let b: Room;
  let ia = -1;
  let h: ReturnType<typeof harness>;
  const seenByB: number[][] = [];
  const lastA = () => seenByB[seenByB.length - 1]!;

  it('two clients join', async () => {
    const sino = frame('vert-ilha-do-sino');
    const ll = dirToLatLon(v3normalize(sino.at(0, 0, 14)));
    a = await new Client(url).create(ROOM_NAME, { ...opts('A'), maxPlayers: 2, freeRoamSpawns: [ll, ll] });
    const wa = await new Promise<WelcomeMsg>((r) => a.onMessage(S2C.WELCOME, r));
    b = await new Client(url).joinById(wa.code, opts('B'));
    await new Promise<WelcomeMsg>((r) => b.onMessage(S2C.WELCOME, r));
    ia = wa.index;
    h = harness(a, a.roomId);
    b.onMessage(S2C.SNAPSHOT, (m: SnapshotMsg) => {
      const s = m.p.find((p) => p[0] === ia);
      if (s) seenByB.push([...s]);
    });
    for (let i = 0; i < 100 && seenByB.length < 3; i++) await sleep(30);
    expect(seenByB.length).toBeGreaterThan(2);
  }, 30000);

  it('A jumps at a house wall, hangs from the eave and pulls up onto the roof; B sees LEDGE_HANG, then MANTLE', async () => {
    const wall = findRoofWall();
    h.put(ia, wall.feet, wall.into);
    await sleep(400);
    const h0 = radial(h.sp(ia).state.pos);
    const from = seenByB.length;
    await h.drive(2.8, (t) => ({ wish: wall.into, buttons: t > 0.15 && t < 0.24 ? InputButton.JUMP : 0 }));
    await sleep(250);
    const states = seenByB.slice(from).map((s) => s[11]!);
    expect(states).toContain(MovementState.LEDGE_HANG);
    expect(states).toContain(MovementState.MANTLE);
    // The hang came before the pull-up, and A ends standing on the roof, well over the street.
    expect(states.indexOf(MovementState.LEDGE_HANG)).toBeLessThan(states.lastIndexOf(MovementState.MANTLE));
    expect(lastA()[13]! & SnapFlag.GROUNDED).toBe(SnapFlag.GROUNDED);
    expect(radial(snapPos(lastA())) - h0).toBeGreaterThan(2.2);
    expect(h.sp(ia).state.traversal).toBe(TraversalMode.NONE);
  }, 20000);

  it('A rides the Corrente do Sino on the kite and lands on the Ilha do Sino; B sees A gliding up and standing on it', async () => {
    const sino = frame('vert-ilha-do-sino');
    const top = radial(sino.base);
    h.put(ia, groundAt(sino.at(-7.9, 0, 0.6)), sino.side);
    await sleep(400);
    const from = seenByB.length;
    const rose = await h.drive(8, () => ({ wish: ZERO, buttons: InputButton.JUMP }), () => radial(h.sp(ia).state.pos) > top + 2.5);
    expect(rose, 'subiu na corrente').toBe(true);
    const landed = await h.drive(5, () => ({ wish: sino.side, buttons: InputButton.JUMP }), () => h.sp(ia).state.grounded);
    expect(landed).toBe(true);
    await sleep(250);
    expect(seenByB.slice(from).some((s) => s[11] === MovementState.GLIDE)).toBe(true);
    expect(radial(snapPos(lastA()))).toBeGreaterThan(top - 0.3);
    expect(lastA()[13]! & SnapFlag.GROUNDED).toBe(SnapFlag.GROUNDED);
  }, 20000);

  it('cleans up', async () => {
    await a.leave();
    await b.leave();
  });
});

describe('vertical combat in a real match (island and ground, the Tormenta)', () => {
  it('shots between altitudes, the island as cover, a push off its edge, the Tormenta at altitude, a winner', async () => {
    const sino = frame('vert-ilha-do-sino');
    // A on the island's south edge; B on the ground south of it, where A's line of fire clears the edge.
    const edge = sino.at(0.5, 0, 3.6);
    const eyes = (p: Vec3) => add(p, v3normalize(p), 1.6);
    const chest = (p: Vec3) => add(p, v3normalize(p), 1.0);
    const ground = [sino.at(0.5, 0, 16), sino.at(3, 0, 15), sino.at(-2, 0, 15), sino.at(0.5, 0, 19)].map(groundAt).find((g) => {
      const o = eyes(edge);
      const d = { x: chest(g).x - o.x, y: chest(g).y - o.y, z: chest(g).z - o.z };
      const l = v3len(d);
      return !clientWorld.physics.castRay(o, { x: d.x / l, y: d.y / l, z: d.z / l }, l - 0.5);
    });
    expect(ground, 'um ponto no chão à vista da borda da ilha').toBeTruthy();
    const ll = (p: Vec3) => dirToLatLon(v3normalize(p));
    const a = await new Client(url).create(ROOM_NAME, {
      ...opts('A'),
      legacyWarmup: true,
      maxPlayers: 2,
      countdownMs: 300,
      resultsMs: 3000,
      skipDraft: true,
      skipUfo: true,
      chestCount: 0,
      matchSpawns: [ll(sino.at(0, 0, 12)), ll(ground!)],
      // The safe region closes onto B's spot (4° ≈ 7 m): the island (12 m away and 15 m up) ends up outside.
      tormentaFinal: ll(ground!),
      tormentaPhases: [{ waitMs: 18000, shrinkMs: 800, radiusDeg: 4, damage: 9 }],
      tormentaPulseMs: 250,
      tormentaFinalDamage: 9,
    });
    const welcomeA = await new Promise<WelcomeMsg>((r) => a.onMessage(S2C.WELCOME, r));
    const b = await new Client(url).joinById(welcomeA.code, opts('B'));
    const welcomeB = await new Promise<WelcomeMsg>((r) => b.onMessage(S2C.WELCOME, r));
    const ia = welcomeA.index;
    const ib = welcomeB.index;
    const h = harness(a, a.roomId);
    const hb = harness(b, a.roomId);
    const rooms: RoomStateMsg[] = [];
    const events: { t: number; e: GameEvent }[] = [];
    const seenByB: number[][] = [];
    a.onMessage(S2C.ROOM_STATE, (m: RoomStateMsg) => rooms.push(m));
    b.onMessage(S2C.EVENTS, (m: EventsMsg) => events.push(...m.ev.map((e) => ({ t: Date.now(), e }))));
    b.onMessage(S2C.SNAPSHOT, (m: SnapshotMsg) => {
      const s = m.p.find((p) => p[0] === ia);
      if (s) seenByB.push([...s]);
    });
    const phase = async (p: number, ms = 8000) => {
      for (let t = 0; t < ms && rooms.at(-1)?.phase !== p; t += 50) await sleep(50);
      return rooms.at(-1)?.phase === p;
    };
    try {
      for (let t = 0; t < 3000 && (rooms.at(-1)?.players.length ?? 0) < 2; t += 50) await sleep(50);
      a.send(C2S.READY, { r: 1 });
      b.send(C2S.READY, { r: 1 });
      expect(await phase(MatchPhase.MATCH), 'a partida começa').toBe(true);
      await sleep(300);

      // ---- From the island's edge down to the ground: the server's hitscan hits B.
      h.put(ia, edge, sino.forward);
      hb.put(ib, ground!, neg(sino.forward));
      await sleep(500);
      let shot = 1;
      const fire = (from: Room, src: Vec3, dst: Vec3) => {
        const o = eyes(src);
        const c = chest(dst);
        const d = { x: c.x - o.x, y: c.y - o.y, z: c.z - o.z };
        const l = v3len(d);
        from.send(C2S.FIRE, { s: shot++, w: 0, o: [Math.round(o.x * 1000), Math.round(o.y * 1000), Math.round(o.z * 1000)], d: [Math.round((d.x / l) * 10000), Math.round((d.y / l) * 10000), Math.round((d.z / l) * 10000)], a: 1 });
      };
      const hits = (by: number, target: number) => events.filter(({ e }) => e.e === 'dmg' && e.by === by && e.target === target && e.c !== 'tormenta');
      for (let k = 0; k < 3; k++) {
        fire(a, h.sp(ia).state.pos, h.sp(ib).state.pos);
        await sleep(220);
      }
      for (let t = 0; t < 1500 && !hits(ia, ib).length; t += 50) await sleep(50);
      expect(hits(ia, ib).length, 'A acerta B de cima da ilha').toBeGreaterThan(0);

      // ---- From right under the island, B's shot up at A stops in the rock (no damage to A).
      h.put(ia, sino.at(1.5, 0, 1.5), sino.forward);
      hb.put(ib, groundAt(sino.at(1.5, 0, 1.5)), sino.forward);
      await sleep(500);
      const under = hits(ib, ia).length;
      for (let k = 0; k < 3; k++) {
        fire(b, h.sp(ib).state.pos, h.sp(ia).state.pos);
        await sleep(220);
      }
      await sleep(600);
      expect(hits(ib, ia).length, 'a rocha da ilha cobre A').toBe(under);

      // ---- Pushed off the south edge: A falls, opens the kite with jump held, glides down and lands; B sees it all.
      hb.put(ib, ground!, neg(sino.forward));
      h.put(ia, edge, sino.forward);
      await sleep(500);
      const from = seenByB.length;
      applyKnockback(h.sp(ia).state as unknown as CharacterState, null, 8, 3, sino.forward);
      const down = await h.drive(6, () => ({ wish: ZERO, buttons: InputButton.JUMP }), () => h.sp(ia).state.grounded && radial(h.sp(ia).state.pos) < radial(sino.base) - 5);
      expect(down, 'caiu da ilha e pousou').toBe(true);
      await sleep(250);
      const fall = seenByB.slice(from);
      expect(fall.some((s) => s[11] === MovementState.GLIDE), 'B vê A planando').toBe(true);
      expect(lastOf(fall)[13]! & SnapFlag.GROUNDED).toBe(SnapFlag.GROUNDED);
      expect(radial(snapPos(lastOf(fall)))).toBeLessThan(radial(sino.base) - 5);

      // ---- Back on the island when the Tormenta closes onto B: altitude is no shelter, A is hurt and B is not.
      h.put(ia, sino.at(1.5, 0, 1.5), sino.forward);
      hb.put(ib, ground!, neg(sino.forward));
      expect(await phase(MatchPhase.RESULTS, 30000), 'a partida termina').toBe(true);
      const storm = events.filter(({ e }) => e.e === 'dmg' && e.c === 'tormenta').map(({ e }) => e as Extract<GameEvent, { e: 'dmg' }>);
      expect(storm.length).toBeGreaterThan(2);
      expect(storm.every((e) => e.target === ia)).toBe(true);
      expect(seenByB.some((s) => (s[13]! & SnapFlag.IN_TORMENTA) !== 0), 'A marcado dentro da Tormenta, na ilha').toBe(true);
      const elim = events.map(({ e }) => e).find((e) => e.e === 'elim') as Extract<GameEvent, { e: 'elim' }> | undefined;
      expect(elim).toMatchObject({ target: ia, c: 'tormenta' });
      expect(rooms.at(-1)!.winner).toBe(ib);
    } finally {
      await a.leave();
      await b.leave();
    }
  }, 60000);
});

const lastOf = <T>(xs: T[]): T => xs[xs.length - 1]!;

/** Just the vector a camera frame hands LocalPlayer (three.js is the client's dependency, not the tests'). */
class V3 {
  constructor(public x = 0, public y = 0, public z = 0) {}
  clone(): V3 {
    return new V3(this.x, this.y, this.z);
  }
  multiplyScalar(k: number): V3 {
    this.x *= k;
    this.y *= k;
    this.z *= k;
    return this;
  }
  addScaledVector(v: V3, k: number): V3 {
    this.x += v.x * k;
    this.y += v.y * k;
    this.z += v.z * k;
    return this;
  }
  lengthSq(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }
  normalize(): V3 {
    return this.multiplyScalar(1 / (Math.sqrt(this.lengthSq()) || 1));
  }
}

describe('traversal prediction under latency (100 ms each way)', () => {
  it('the client predicts a climb, a pull-up and a ride on the kite; reconciliation corrects by centimetres, never snaps', async () => {
    const DELAY = 100;
    const massif = frame('vert-serra-macico');
    const ll = dirToLatLon(v3normalize(massif.at(3, 0, 12)));
    const c = await new Client(url).create(ROOM_NAME, { ...opts('A'), maxPlayers: 1, freeRoamSpawns: [ll] });
    const welcome = await new Promise<WelcomeMsg>((r) => c.onMessage(S2C.WELCOME, r));
    const me = welcome.index;
    const h = harness(c, c.roomId);
    const start = footing(massif.at(0.4, 0, 7.2));
    const into = neg(massif.forward);
    const local = new LocalPlayer(clientWorld.physics, start, into);
    const corrections: number[] = [];
    const modes = new Set<number>();
    let live = false;
    // Snapshots reach the client DELAY ms late; its commands reach the server DELAY ms late.
    c.onMessage(S2C.SNAPSHOT, (m: SnapshotMsg) => {
      const s = m.p.find((p) => p[0] === me);
      if (!s) return;
      setTimeout(() => {
        if (!live) return;
        const st = snapToCharacterState(s);
        st.aim = { ...local.state.aim };
        const before = local.state.traversal;
        local.reconcile(st, s[14]!);
        corrections.push(local.stats.lastCorrection);
        if (process.env.GRAAO_DEBUG && local.stats.lastCorrection > 0.05) console.log(`correção ${local.stats.lastCorrection.toFixed(3)} m: local ${before} → servidor ${st.traversal}, ${local.stats.replayed} reaplicados, h ${radial(st.pos).toFixed(2)}`);
      }, DELAY);
    });
    try {
      h.put(me, start, into);
      await sleep(600);
      local.teleport(h.sp(me).state.pos, into);
      live = true;
      const cam = (fwd: Vec3) => {
        const up = v3normalize(start);
        const right = v3normalize(v3cross(fwd, up));
        const f = new V3(fwd.x, fwd.y, fwd.z);
        return { forward: f, right: new V3(right.x, right.y, right.z), up: new V3(up.x, up.y, up.z), view: f.clone() } as unknown as Parameters<LocalPlayer['update']>[2];
      };
      const play = async (seconds: number, wish: Vec3 | null, jump: (t: number) => boolean) => {
        const camera = cam(wish ?? into);
        const input = {
          moveAxis: () => ({ x: 0, y: wish ? 1 : 0 }),
          isDown: (k: string) => (k === 'forward' && !!wish) || (k === 'jump' && jump(clock)),
        } as unknown as Input;
        let clock = 0;
        let last = performance.now();
        while (clock < seconds) {
          await sleep(16);
          const now = performance.now();
          const dt = (now - last) / 1000;
          last = now;
          clock += dt;
          local.update(dt, input, camera, true);
          modes.add(local.state.traversal);
          const cmds = local.outbox.splice(0);
          if (cmds.length) setTimeout(() => c.send(C2S.PLAYER_INPUT, { i: cmds }), DELAY);
        }
      };
      // Into the face with a jump: climb, pull up onto the terrace, stand.
      await play(4.5, into, (t) => t < 0.1);
      await play(0.8, null, () => false);
      expect(modes.has(TraversalMode.CLIMB)).toBe(true);
      expect(modes.has(TraversalMode.MANTLE)).toBe(true);
      // Down the front again and into the west updraft on the kite (jump held): predicted with the same wind volumes.
      live = false;
      const draft = footing(massif.at(-10.9, 0, -0.8));
      h.put(me, draft, massif.side);
      await sleep(600);
      local.teleport(h.sp(me).state.pos, massif.side);
      live = true;
      await play(2.5, null, () => true);
      // Let go and walk out of the column (inside it the updraft only slows the fall): down to the ground, then rest.
      await play(4, massif.side, () => false);
      await play(1, null, () => false);
      expect(modes.has(TraversalMode.GLIDE)).toBe(true);
      expect(local.state.grounded).toBe(true);
      await sleep(400);
      // Every correction small (a few cm at most, for the timing of a grab or the glider), none a snap.
      expect(corrections.length).toBeGreaterThan(80);
      const worst = Math.max(...corrections);
      expect(worst, `maior correção ${worst.toFixed(3)} m`).toBeLessThan(0.35);
      corrections.sort((x, y) => x - y);
      expect(corrections[Math.floor(corrections.length * 0.95)]!).toBeLessThan(0.05);
      // Landed and at rest (every command in), prediction and server agree.
      const server = h.sp(me).state.pos;
      expect(v3len({ x: local.state.pos.x - server.x, y: local.state.pos.y - server.y, z: local.state.pos.z - server.z })).toBeLessThan(0.1);
    } finally {
      live = false;
      local.dispose();
      await c.leave();
    }
  }, 40000);
});

describe('a stall of the relay (a hosted room: every command passes through the host tab)', () => {
  it('everyone silent at once for 350 ms: the glider keeps gliding and every held command is taken in; one client alone silent still falls', async () => {
    const STALL = 350;
    const massif = frame('vert-serra-macico');
    const draft = footing(massif.at(-10.9, 0, -0.8));
    const ll = dirToLatLon(v3normalize(draft));
    const a = await new Client(url).create(ROOM_NAME, { ...opts('A'), maxPlayers: 2, freeRoamSpawns: [ll, ll] });
    const welcome = await new Promise<WelcomeMsg>((r) => a.onMessage(S2C.WELCOME, r));
    const me = welcome.index;
    const b = await new Client(url).joinById(welcome.code, opts('B'));
    await new Promise<WelcomeMsg>((r) => b.onMessage(S2C.WELCOME, r));
    const h = harness(a, a.roomId);
    // The relay: what A and B send reaches the server through it; stalled, it holds everything, then lets it all out
    // in order (as the host page does when its main thread comes back).
    const held: (() => void)[] = [];
    let stallAll = false;
    let stallA = false;
    const relay = (who: 'A' | 'B', send: () => void) => ((stallAll || (who === 'A' && stallA)) ? held.push(send) : send());
    const release = () => {
      stallAll = stallA = false;
      for (const f of held.splice(0)) f();
    };
    const local = new LocalPlayer(clientWorld.physics, draft, massif.side);
    const corrections: { t: number; c: number }[] = [];
    let live = false;
    a.onMessage(S2C.SNAPSHOT, (m: SnapshotMsg) => {
      const s = m.p.find((p) => p[0] === me);
      if (!s || !live) return;
      const st = snapToCharacterState(s);
      st.aim = { ...local.state.aim };
      local.reconcile(st, s[14]!);
      corrections.push({ t: performance.now(), c: local.stats.lastCorrection });
    });
    // B: idle commands every 33 ms, through the relay.
    let bSeq = 1;
    const bTimer = setInterval(() => {
      const cmds: InputCmd[] = [0, 1].map(() => [bSeq++, 0, 0, 0, 0, 0, AIM_SCALE, 0] as InputCmd);
      relay('B', () => b.send(C2S.PLAYER_INPUT, { i: cmds }));
    }, 33);
    const up = v3normalize(draft);
    const right = v3normalize(v3cross(massif.side, up));
    const camera = { forward: new V3(massif.side.x, massif.side.y, massif.side.z), right: new V3(right.x, right.y, right.z), up: new V3(up.x, up.y, up.z), view: new V3(massif.side.x, massif.side.y, massif.side.z) } as unknown as Parameters<LocalPlayer['update']>[2];
    const input = { moveAxis: () => ({ x: 0, y: 0 }), isDown: (k: string) => k === 'jump' } as unknown as Input;
    /** Plays A (jump held: the kite rides the updraft) for `ms`, sampling the server's A every frame. */
    const play = async (ms: number, sample?: (s: ServerSide['state']) => void) => {
      const t0 = performance.now();
      let last = t0;
      while (performance.now() - t0 < ms) {
        await sleep(16);
        const now = performance.now();
        local.update((now - last) / 1000, input, camera, true);
        last = now;
        const cmds = local.outbox.splice(0);
        if (cmds.length) relay('A', () => a.send(C2S.PLAYER_INPUT, { i: cmds }));
        sample?.(h.sp(me).state);
      }
    };
    try {
      h.put(me, draft, massif.side);
      await sleep(600);
      local.teleport(h.sp(me).state.pos, massif.side);
      live = true;
      await play(1500);
      expect(h.sp(me).state.traversal, 'A plana na corrente').toBe(TraversalMode.GLIDE);
      // Everyone silent: the server's A never leaves the kite, and once the relay lets go, the prediction agrees.
      const during = new Set<number>();
      stallAll = true;
      await play(STALL, (s) => during.add(s.traversal));
      const released = performance.now();
      release();
      await play(1000, (s) => during.add(s.traversal));
      const after = corrections.filter((x) => x.t > released).map((x) => x.c);
      const worst = Math.max(...after);
      if (process.env.GRAAO_DEBUG) console.log(`travamento de todos: estados ${[...during].join(',')}, ${after.length} correções, pior ${worst.toFixed(3)} m`);
      expect([...during], 'A continua planando').toEqual([TraversalMode.GLIDE]);
      expect(worst, `pior correção ${worst.toFixed(3)} m`).toBeLessThan(0.1);
      // A alone silent (B's commands keep coming): that is A's own silence; the server drops A from the kite.
      const alone = new Set<number>();
      stallA = true;
      // (Long enough for B's commands to come in between even on a loaded machine.)
      await play(STALL + 550, (s) => alone.add(s.traversal));
      release();
      await play(300);
      if (process.env.GRAAO_DEBUG) console.log(`só A calado: estados ${[...alone].join(',')}`);
      expect(alone.has(TraversalMode.NONE), 'sem comandos só de A, A cai').toBe(true);
    } finally {
      live = false;
      clearInterval(bTimer);
      local.dispose();
      await Promise.all([a.leave(), b.leave()]).catch(() => {});
    }
  }, 30000);
});
