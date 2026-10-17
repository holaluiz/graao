/**
 * Integration: real graao server in-process + two Colyseus SDK clients.
 * Create room → join by code → both see each other → A's movement reaches B via authoritative snapshots.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import { ABILITIES, DEFAULT_APPEARANCE, DEFAULT_LOADOUTS, WEAPONS, randomAppearance } from '@graao/game-data';
import { castOrigin, chestOf } from '@graao/game-core';
import { SnapshotInterpolator } from '../apps/client/src/net/SnapshotInterpolator';
import { AIM_SCALE, AbilityReject, C2S, CLIENT_VERSION, HitKind, INTERPOLATION_DELAY_MS, MatchPhase, PROTOCOL_VERSION, SnapFlag, ROOM_NAME, S2C, WISH_SCALE, type AbilityRequestMsg, type AbilityResultMsg, type DraftStateMsg, type EventsMsg, type GameEvent, type InputCmd, type RoomStateMsg, type SelfStatusMsg, type SnapshotMsg, type Vec3, type WelcomeMsg } from '@graao/shared';
import { createGraaoServer } from '../apps/server/src/app';
import { getWorld } from '../apps/server/src/world';

const PORT = 2600 + Math.floor(Math.random() * 300);
const server = createGraaoServer();
const url = `ws://127.0.0.1:${PORT}`;

beforeAll(async () => {
  await getWorld();
  await server.listen(PORT);
}, 30000);

afterAll(async () => {
  await server.gracefullyShutdown(false).catch(() => {});
});

function opts(name: string, protocol = PROTOCOL_VERSION) {
  return { protocol, client: CLIENT_VERSION, name, appearance: name === 'A' ? DEFAULT_APPEARANCE : randomAppearance(() => 0.42) };
}

function waitFor<T>(room: Room, type: number, pred: (m: T) => boolean = () => true, ms = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), ms);
    const off = room.onMessage(type, (m: T) => {
      if (pred(m)) {
        clearTimeout(t);
        off();
        resolve(m);
      }
    });
  });
}

/** Fires aimed Sunbeam shots from `a`'s head toward `ib`'s chest using the latest snapshot positions. */
function shooter(a: Room, ia: () => number, ib: () => number) {
  async function positions(): Promise<{ pa: number[]; pb: number[] }> {
    const s = await waitFor<SnapshotMsg>(a, S2C.SNAPSHOT, (m) => m.p.length >= 2);
    return { pa: s.p.find((p) => p[0] === ia())!, pb: s.p.find((p) => p[0] === ib())! };
  }
  return async function shoot(seq: number, originOverride?: [number, number, number]) {
    const { pa, pb } = await positions();
    const A = { x: pa[1]! / 1000, y: pa[2]! / 1000, z: pa[3]! / 1000 };
    const B = { x: pb[1]! / 1000, y: pb[2]! / 1000, z: pb[3]! / 1000 };
    const ua = Math.hypot(A.x, A.y, A.z);
    const ub = Math.hypot(B.x, B.y, B.z);
    const head = { x: A.x * (1 + 1.6 / ua), y: A.y * (1 + 1.6 / ua), z: A.z * (1 + 1.6 / ua) };
    const chest = { x: B.x * (1 + 1.0 / ub), y: B.y * (1 + 1.0 / ub), z: B.z * (1 + 1.0 / ub) };
    const d = { x: chest.x - head.x, y: chest.y - head.y, z: chest.z - head.z };
    const l = Math.hypot(d.x, d.y, d.z);
    a.send(C2S.FIRE, {
      s: seq,
      w: 0,
      o: originOverride ?? [Math.round(head.x * 1000), Math.round(head.y * 1000), Math.round(head.z * 1000)],
      d: [Math.round((d.x / l) * 10000), Math.round((d.y / l) * 10000), Math.round((d.z / l) * 10000)],
      a: 1,
    });
  };
}

describe('two clients in one graao room', () => {
  let a: Room;
  let b: Room;
  let welcomeA: WelcomeMsg;
  let welcomeB: WelcomeMsg;

  it('creates a room with a short code and lets a second client join by that code', async () => {
    const ca = new Client(url);
    a = await ca.create(ROOM_NAME, opts('A'));
    welcomeA = await waitFor<WelcomeMsg>(a, S2C.WELCOME);
    expect(welcomeA.code).toMatch(/^GR-[2-9A-HJ-NP-Z]{4}$/);
    const cb = new Client(url);
    const statePromise = waitFor<RoomStateMsg>(a, S2C.ROOM_STATE, (m) => m.players.length === 2);
    b = await cb.joinById(welcomeA.code, opts('B'));
    welcomeB = await waitFor<WelcomeMsg>(b, S2C.WELCOME);
    expect(welcomeB.index).not.toBe(welcomeA.index);
    const state = await statePromise;
    expect(state.players.map((p) => p.name).sort()).toEqual(['A', 'B']);
  });

  it('replicates authoritative movement of A to B', async () => {
    const first = await waitFor<SnapshotMsg>(b, S2C.SNAPSHOT, (m) => m.p.length === 2);
    const startA = first.p.find((p) => p[0] === welcomeA.index)!;
    // A runs "north" for ~1.5 s: wish = +Y projected by the server on A's tangent plane.
    let seq = 1;
    for (let k = 0; k < 45; k++) {
      const cmds: InputCmd[] = [0, 1].map(() => [seq++, 0, WISH_SCALE, 0, 0, 0, AIM_SCALE, 0] as InputCmd);
      a.send(C2S.PLAYER_INPUT, { i: cmds });
      await new Promise((r) => setTimeout(r, 33));
    }
    await new Promise((r) => setTimeout(r, 300));
    const later = await waitFor<SnapshotMsg>(b, S2C.SNAPSHOT, (m) => m.p.length === 2);
    const endA = later.p.find((p) => p[0] === welcomeA.index)!;
    const moved = Math.hypot(endA[1] - startA[1], endA[2] - startA[2], endA[3] - startA[3]) / 1000;
    expect(moved).toBeGreaterThan(3);
    // Never faster than real time: 90 commands at 60 Hz ≈ 1.5 s × 5.6 m/s.
    expect(moved).toBeLessThan(10);
    // A's ack follows its last processed sequence number.
    expect(endA[14]).toBeGreaterThan(80);
  }, 15000);

  it('advances a steadily moving player uniformly per snapshot despite send jitter (smooth remotes)', async () => {
    let seq = 100000;
    let sending = true;
    const t0 = Date.now();
    let sent = 0;
    const send = async () => {
      while (sending) {
        // Like the browser client: a real-time accumulator produces exactly 60 commands per second on average.
        const due = Math.floor(((Date.now() - t0) / 1000) * 60) - sent;
        const cmds: InputCmd[] = Array.from({ length: Math.min(10, due) }, () => [seq++, WISH_SCALE, 0, 0, 0, 0, AIM_SCALE, 0] as InputCmd);
        sent += cmds.length;
        if (cmds.length) a.send(C2S.PLAYER_INPUT, { i: cmds });
        // 33 ms ± 12 ms jitter, like a real browser on Wi-Fi.
        await new Promise((r) => setTimeout(r, 33 + (Math.random() - 0.5) * 24));
      }
    };
    void send();
    await new Promise((r) => setTimeout(r, 600));
    const positions: number[][] = [];
    const off = b.onMessage(S2C.SNAPSHOT, (m: SnapshotMsg) => {
      const s = m.p.find((p) => p[0] === welcomeA.index);
      if (s) positions.push([m.t + s[19], s[1], s[2], s[3], Math.hypot(s[4], s[5], s[6]) / 100]);
    });
    await new Promise((r) => setTimeout(r, 2500));
    off();
    sending = false;
    // Measured speed (displacement over the per-player clock) must agree with the server's own velocity: any timing
    // jitter would show up as disagreement, while real slowdowns (bumping into houses) affect both equally.
    const errs: number[] = [];
    const speeds: number[] = [];
    for (let i = 1; i < positions.length; i++) {
      const [t0, x0, y0, z0, v0] = positions[i - 1]!;
      const [t1, x1, y1, z1, v1] = positions[i]!;
      const measured = Math.hypot(x1! - x0!, y1! - y0!, z1! - z0!) / 1000 / Math.max(1e-3, (t1! - t0!) / 1000);
      const reported = (v0! + v1!) / 2;
      speeds.push(measured);
      if (Math.abs(v1! - v0!) < 0.5) errs.push(Math.abs(measured - reported));
    }
    const mean = speeds.reduce((s, x) => s + x, 0) / speeds.length;
    const meanErr = errs.reduce((s, x) => s + x, 0) / Math.max(1, errs.length);
    if (process.env.GRAAO_DEBUG) console.log(positions.slice(1).map((p, i) => [Math.round(p[0]! - positions[i]![0]!), speeds[i]!.toFixed(2), p[4]!.toFixed(2)].join(' ')).join('\n'));
    expect(mean).toBeGreaterThan(3);
    expect(errs.length).toBeGreaterThan(10);
    expect(meanErr / mean).toBeLessThan(0.08);
  }, 15000);

  it('renders a remote smoothly at 60 Hz from real snapshot arrivals (client interpolation)', async () => {
    let seq = 200000;
    let sending = true;
    const t0 = Date.now();
    let sent = 0;
    void (async () => {
      while (sending) {
        const due = Math.floor(((Date.now() - t0) / 1000) * 60) - sent;
        const cmds: InputCmd[] = Array.from({ length: Math.min(10, due) }, () => [seq++, -WISH_SCALE, 0, 0, 0, 0, AIM_SCALE, 0] as InputCmd);
        sent += cmds.length;
        if (cmds.length) a.send(C2S.PLAYER_INPUT, { i: cmds });
        await new Promise((r) => setTimeout(r, 33 + (Math.random() - 0.5) * 24));
      }
    })();
    const arrivals: { arrival: number; s: { t: number; x: number; y: number; z: number } }[] = [];
    const off = b.onMessage(S2C.SNAPSHOT, (m: SnapshotMsg) => {
      const s = m.p.find((p) => p[0] === welcomeA.index);
      if (s) arrivals.push({ arrival: Date.now(), s: { t: m.t + s[19], x: s[1] / 1000, y: s[2] / 1000, z: s[3] / 1000 } });
    });
    await new Promise((r) => setTimeout(r, 3500));
    off();
    sending = false;

    const interp = new SnapshotInterpolator<{ t: number; x: number; y: number; z: number }>();
    let k = 0;
    const speeds: number[] = [];
    let extrapolated = 0;
    let prev: [number, number, number] | null = null;
    const frame = 1000 / 60;
    for (let T = arrivals[0]!.arrival + 400; T < arrivals[arrivals.length - 1]!.arrival; T += frame) {
      while (k < arrivals.length && arrivals[k]!.arrival <= T) {
        interp.push(arrivals[k]!.s, arrivals[k]!.arrival);
        k++;
      }
      const r = interp.sample(T, INTERPOLATION_DELAY_MS)!;
      if (r.extrapolateMs > 0) extrapolated++;
      const p: [number, number, number] = [
        r.a.x + (r.b.x - r.a.x) * r.alpha,
        r.a.y + (r.b.y - r.a.y) * r.alpha,
        r.a.z + (r.b.z - r.a.z) * r.alpha,
      ];
      if (prev) speeds.push(Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]) / (frame / 1000));
      prev = p;
    }
    const jumps = speeds.slice(1).map((v, i) => Math.abs(v - speeds[i]!)).sort((x, y) => x - y);
    const p95 = jumps[Math.floor(jumps.length * 0.95)]!;
    if (process.env.GRAAO_DEBUG) console.log('ARR', arrivals.slice(0, 40).map((x, i) => i ? [x.arrival - arrivals[i - 1]!.arrival, Math.round(x.s.t - arrivals[i - 1]!.s.t), (Math.hypot(x.s.x - arrivals[i - 1]!.s.x, x.s.y - arrivals[i - 1]!.s.y, x.s.z - arrivals[i - 1]!.s.z) * 1000).toFixed(0)].join('/') : '').join(' '));
    if (process.env.GRAAO_DEBUG) console.log('SPD', speeds.slice(0, 60).map((v) => v.toFixed(1)).join(' '));
    if (process.env.GRAAO_DEBUG) console.log(JSON.stringify({ frames: speeds.length, extrapolatedPct: +((100 * extrapolated) / speeds.length).toFixed(1), p95SpeedJump: +p95.toFixed(3), meanSpeed: +(speeds.reduce((x, y) => x + y, 0) / speeds.length).toFixed(2), lagMs: Math.round(interp.lag) }));
    expect(speeds.length).toBeGreaterThan(120);
    expect(extrapolated / speeds.length).toBeLessThan(0.05);
    // Timing hitches show up as multi-m/s jumps at snapshot boundaries; terrain and collisions cause small real changes.
    expect(p95).toBeLessThan(2.0);
  }, 15000);

  it('rejects a client speaking another protocol version', async () => {
    const cc = new Client(url);
    await expect(cc.create(ROOM_NAME, opts('C', PROTOCOL_VERSION + 99))).rejects.toThrow(/VERSION_MISMATCH/);
    // A full room refuses a third player in the 2-player MVP configuration.
    await expect(new Client(url).joinById(welcomeA.code, opts('D'))).rejects.toThrow(/locked|full/);
  });

  it('cleans up when players leave', async () => {
    const left = waitFor<RoomStateMsg>(a, S2C.ROOM_STATE, (m) => m.players.length === 1);
    await b.leave(true);
    expect((await left).players[0]!.name).toBe('A');
    await a.leave(true);
  });
});

describe('combat through the authoritative server (gate 3)', () => {
  let a: Room;
  let b: Room;
  let ia = -1;
  let ib = -1;
  const events: GameEvent[] = [];
  let shoot: ReturnType<typeof shooter>;

  it('sets up a fresh room with two players', async () => {
    a = await new Client(url).create(ROOM_NAME, opts('A'));
    const wa = await waitFor<WelcomeMsg>(a, S2C.WELCOME);
    ia = wa.index;
    const code = wa.code;
    b = await new Client(url).joinById(code, opts('B'));
    ib = (await waitFor<WelcomeMsg>(b, S2C.WELCOME)).index;
    b.onMessage(S2C.EVENTS, (m: EventsMsg) => events.push(...m.ev));
    shoot = shooter(a, () => ia, () => ib);
    await new Promise((r) => setTimeout(r, 600)); // let both land
  });

  it('damages the shield first and confirms the hit to everyone', async () => {
    await shoot(1);
    await new Promise((r) => setTimeout(r, 200));
    const shot = events.find((e) => e.e === 'shot');
    const dmg = events.find((e) => e.e === 'dmg');
    expect(shot).toBeTruthy();
    expect(dmg && dmg.e === 'dmg' && dmg.target === ib).toBe(true);
    if (dmg && dmg.e === 'dmg') {
      expect(dmg.kinds[0]).toBe(HitKind.SHIELD);
      expect(dmg.shield).toBe(100 - WEAPONS.sunbeam.damage);
      expect(dmg.health).toBe(100);
    }
  });

  it('rejects fire-rate spam and teleported camera origins', async () => {
    events.length = 0;
    await new Promise((r) => setTimeout(r, 200));
    for (let s = 2; s < 12; s++) await shoot(s); // positions() waits ~1 snapshot each, still far above 7 shots/s? no: ~20/s
    await shoot(50, [0, 0, 0]);
    await new Promise((r) => setTimeout(r, 300));
    const shots = events.filter((e) => e.e === 'shot');
    // 10 requests in ~0.5 s: at most ceil(0.5 × 7 / 0.85) + 1 accepted; the planet-center origin never.
    expect(shots.length).toBeLessThanOrEqual(6);
    expect(shots.every((e) => e.e === 'shot' && e.s !== 50)).toBe(true);
  });

  it('eliminates B after enough hits and respawns B with full vitals', async () => {
    let seq = 100;
    const deadline = Date.now() + 8000;
    while (!events.some((e) => e.e === 'elim') && Date.now() < deadline) {
      await shoot(seq++);
      await new Promise((r) => setTimeout(r, 160));
    }
    const elim = events.find((e) => e.e === 'elim');
    expect(elim && elim.e === 'elim' && elim.by === ia && elim.target === ib).toBe(true);
    const dead = await waitFor<SnapshotMsg>(b, S2C.SNAPSHOT, (m) => m.p.some((p) => p[0] === ib && (p[13]! & SnapFlag.ALIVE) === 0));
    expect(dead.p.find((p) => p[0] === ib)![15]).toBe(0);
    const respawn = await new Promise<boolean>((resolve) => {
      const t = setTimeout(() => resolve(false), 6000);
      const off = b.onMessage(S2C.EVENTS, (m: EventsMsg) => {
        if (m.ev.some((e) => e.e === 'respawn' && e.target === ib)) {
          clearTimeout(t);
          off();
          resolve(true);
        }
      });
    });
    expect(respawn).toBe(true);
    const alive = await waitFor<SnapshotMsg>(b, S2C.SNAPSHOT, (m) => m.p.some((p) => p[0] === ib && (p[13]! & SnapFlag.ALIVE) !== 0));
    const pb = alive.p.find((p) => p[0] === ib)!;
    expect([pb[15], pb[16]]).toEqual([100, 100]);
    await a.leave(true);
    await b.leave(true);
  }, 20000);
});

describe('a complete 1v1 match (gate 3: A wins)', () => {
  let a: Room;
  let b: Room;
  let ia = -1;
  let ib = -1;
  const events: GameEvent[] = [];
  const states: RoomStateMsg[] = [];
  let shoot: ReturnType<typeof shooter>;

  it('starts when both players are ready, with a countdown that locks weapons', async () => {
    a = await new Client(url).create(ROOM_NAME, { ...opts('A'), countdownMs: 600, resultsMs: 900, closeSpawns: true, skipDraft: true });
    const wa = await waitFor<WelcomeMsg>(a, S2C.WELCOME);
    ia = wa.index;
    b = await new Client(url).joinById(wa.code, opts('B'));
    ib = (await waitFor<WelcomeMsg>(b, S2C.WELCOME)).index;
    b.onMessage(S2C.EVENTS, (m: EventsMsg) => events.push(...m.ev));
    a.onMessage(S2C.ROOM_STATE, (m: RoomStateMsg) => states.push(m));
    shoot = shooter(a, () => ia, () => ib);
    await new Promise((r) => setTimeout(r, 500));

    a.send(C2S.READY, { r: 1 });
    const oneReady = await waitFor<RoomStateMsg>(a, S2C.ROOM_STATE, (m) => m.players.some((p) => p.ready));
    expect(oneReady.phase).toBe(MatchPhase.FREE_ROAM);
    const started = waitFor<RoomStateMsg>(a, S2C.ROOM_STATE, (m) => m.phase === MatchPhase.MATCH);
    b.send(C2S.READY, { r: 1 });
    const st = await started;
    expect(st.startsAt).toBeGreaterThan(Date.now() - 50);
    expect(st.players.every((p) => p.inMatch && !p.ready && p.kills === 0)).toBe(true);

    // Shots during the countdown are refused by the server.
    events.length = 0;
    await new Promise((r) => setTimeout(r, 150)); // let the spawn reset land
    await shoot(1);
    await new Promise((r) => setTimeout(r, 150));
    expect(events.some((e) => e.e === 'shot')).toBe(false);
  });

  it('A eliminates B: no respawn inside the match, RESULTS names A the winner', async () => {
    await new Promise((r) => setTimeout(r, 700)); // countdown over (and both landed)
    const results = waitFor<RoomStateMsg>(a, S2C.ROOM_STATE, (m) => m.phase === MatchPhase.RESULTS, 12000);
    let seq = 10;
    const deadline = Date.now() + 9000;
    while (!events.some((e) => e.e === 'elim') && Date.now() < deadline) {
      await shoot(seq++);
      await new Promise((r) => setTimeout(r, 160));
    }
    expect(events.some((e) => e.e === 'dmg')).toBe(true);
    const res = await results;
    expect(res.winner).toBe(ia);
    expect(res.players.find((p) => p.index === ia)!.kills).toBe(1);
    expect(res.players.find((p) => p.index === ib)!.deaths).toBe(1);
    // Damage is off during the results screen and B stays down.
    const before = events.length;
    await shoot(seq);
    await new Promise((r) => setTimeout(r, 200));
    expect(events.slice(before).some((e) => e.e === 'shot' || (e.e === 'respawn' && e.target === ib))).toBe(false);
  }, 20000);

  it('returns to warmup after the results with everyone alive again', async () => {
    const warm = await waitFor<RoomStateMsg>(a, S2C.ROOM_STATE, (m) => m.phase === MatchPhase.FREE_ROAM, 5000);
    expect(warm.winner).toBe(-1);
    expect(warm.players.every((p) => !p.ready && !p.inMatch)).toBe(true);
    const alive = await waitFor<SnapshotMsg>(b, S2C.SNAPSHOT, (m) => m.p.length === 2 && m.p.every((p) => (p[13]! & SnapFlag.ALIVE) !== 0));
    expect(alive.p.find((p) => p[0] === ib)![15]).toBe(100);
    await a.leave(true);
    await b.leave(true);
  });
});

/** Sends ABILITY_REQUESTs from `a` aimed at `ib` (latest snapshot positions) and returns the server's answer. */
function caster(a: Room, ia: () => number, ib: () => number) {
  let seq = 0;
  async function positions(): Promise<{ A: Vec3; B: Vec3 }> {
    const s = await waitFor<SnapshotMsg>(a, S2C.SNAPSHOT, (m) => m.p.length >= 2);
    const pa = s.p.find((p) => p[0] === ia())!;
    const pb = s.p.find((p) => p[0] === ib())!;
    return { A: { x: pa[1]! / 1000, y: pa[2]! / 1000, z: pa[3]! / 1000 }, B: { x: pb[1]! / 1000, y: pb[2]! / 1000, z: pb[3]! / 1000 } };
  }
  return async function cast(k: number, id: string, target: 'dir' | 'point' | 'none' = 'none'): Promise<AbilityResultMsg> {
    const { A, B } = await positions();
    const s = ++seq;
    const msg: AbilityRequestMsg = { s, k, a: id, c: 0 };
    if (target === 'dir') {
      // From where the projectile leaves A toward B's chest (the cast origin depends on the flattened aim).
      const chest = chestOf(B);
      const from = castOrigin(A, { x: chest.x - A.x, y: chest.y - A.y, z: chest.z - A.z });
      const d = { x: chest.x - from.x, y: chest.y - from.y, z: chest.z - from.z };
      const l = Math.hypot(d.x, d.y, d.z);
      msg.d = [Math.round((d.x / l) * 10000), Math.round((d.y / l) * 10000), Math.round((d.z / l) * 10000)];
    } else if (target === 'point') msg.p = [Math.round(B.x * 1000), Math.round(B.y * 1000), Math.round(B.z * 1000)];
    const answer = waitFor<AbilityResultMsg>(a, S2C.ABILITY_RESULT, (m) => m.s === s);
    a.send(C2S.ABILITY_REQUEST, msg);
    return answer;
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('abilities through the authoritative server (gate 4: guns and magic)', () => {
  let a: Room;
  let b: Room;
  let ia = -1;
  let ib = -1;
  const events: GameEvent[] = [];
  const selfA: SelfStatusMsg[] = [];
  let cast: ReturnType<typeof caster>;

  it('hands out the default loadouts and refuses casts during the countdown', async () => {
    a = await new Client(url).create(ROOM_NAME, { ...opts('A'), countdownMs: 300, resultsMs: 900, closeSpawns: true, ultimateChargeMs: 0, skipDraft: true });
    const wa = await waitFor<WelcomeMsg>(a, S2C.WELCOME);
    ia = wa.index;
    const joined = waitFor<RoomStateMsg>(a, S2C.ROOM_STATE, (m) => m.players.length === 2);
    b = await new Client(url).joinById(wa.code, opts('B'));
    ib = (await waitFor<WelcomeMsg>(b, S2C.WELCOME)).index;
    b.onMessage(S2C.EVENTS, (m: EventsMsg) => events.push(...m.ev));
    a.onMessage(S2C.SELF, (m: SelfStatusMsg) => selfA.push(m));
    cast = caster(a, () => ia, () => ib);
    const st = await joined;
    expect(st.players.find((p) => p.index === ia)!.loadout).toEqual(DEFAULT_LOADOUTS[0]);
    expect(st.players.find((p) => p.index === ib)!.loadout).toEqual(DEFAULT_LOADOUTS[1]);
    await sleep(500); // land
    const started = waitFor<RoomStateMsg>(a, S2C.ROOM_STATE, (m) => m.phase === MatchPhase.MATCH);
    a.send(C2S.READY, { r: 1 });
    b.send(C2S.READY, { r: 1 });
    await started;
    // During the countdown abilities are refused like weapons (the phase rule is the room's canFight).
    await sleep(100);
    expect((await cast(0, 'sun_orb', 'dir')).r).toBe(AbilityReject.PHASE);
    await sleep(450);
  });

  it('refuses what A does not own, a projectile hits B (server-simulated), spam is refused by cooldown', async () => {
    expect((await cast(1, 'leaf_shell')).r).toBe(AbilityReject.NOT_OWNED);
    expect((await cast(3, 'petal_cyclone')).r).toBe(AbilityReject.NOT_OWNED);
    events.length = 0;
    const orb = await cast(0, 'sun_orb', 'dir');
    expect(orb).toMatchObject({ ok: true, r: AbilityReject.OK });
    expect((await cast(0, 'sun_orb', 'dir')).r).toBe(AbilityReject.COOLDOWN);
    // Mana and the cooldown end time arrive in A's private status.
    const st = selfA[selfA.length - 1]!;
    expect(st.mana).toBeLessThanOrEqual(100 - ABILITIES.sun_orb.manaCost + 1);
    expect(st.cd[0]).toBeGreaterThan(Date.now() + 1000);
    await sleep(600);
    expect(events.some((e) => e.e === 'cast' && e.by === ia && e.a === 'sun_orb')).toBe(true);
    expect(events.some((e) => e.e === 'proj' && e.by === ia)).toBe(true);
    expect(events.some((e) => e.e === 'projEnd' && e.t === ib)).toBe(true);
    const dmg = events.find((e) => e.e === 'dmg' && e.target === ib);
    expect(dmg && dmg.e === 'dmg' && dmg.a === 'sun_orb' && dmg.kinds.includes(HitKind.ABILITY) && dmg.amount === 26).toBe(true);
  });

  it('areas at B warn first, then damage, slow and knock B back; the drained Mana refuses the next cast', async () => {
    events.length = 0;
    const pb = await cast(2, 'pollen_burst', 'point');
    expect(pb.r).toBe(AbilityReject.OK);
    // Winding up: anything else is BUSY.
    expect((await cast(1, 'wind_step')).r).toBe(AbilityReject.BUSY);
    await sleep(ABILITIES.pollen_burst.castTime * 1000 + 60);
    // The Ultimate (no charge time in this room) spends the rest of the Mana.
    expect((await cast(3, 'sun_meteor', 'point')).ok).toBe(true);
    await sleep(ABILITIES.sun_meteor.castTime * 1000 + 60);
    expect((await cast(1, 'wind_step')).r).toBe(AbilityReject.NO_MANA);
    await sleep(1500);
    const areas = events.filter((e) => e.e === 'area').map((e) => (e.e === 'area' ? e.a : ''));
    expect(areas).toEqual(['pollen_burst', 'sun_meteor']);
    expect(events.some((e) => e.e === 'fx' && e.k === 'slow' && e.target === ib)).toBe(true);
    expect(events.some((e) => e.e === 'fx' && e.k === 'knock' && e.target === ib)).toBe(true);
    expect(events.filter((e) => e.e === 'dmg' && e.target === ib).length).toBe(2);
  }, 15000);

  it('A eliminates B with abilities only: no respawn, RESULTS names A the winner', async () => {
    const results = waitFor<RoomStateMsg>(a, S2C.ROOM_STATE, (m) => m.phase === MatchPhase.RESULTS, 20000);
    const deadline = Date.now() + 16000;
    while (!events.some((e) => e.e === 'elim') && Date.now() < deadline) {
      // Orbs as soon as cooldown and Mana allow (the server answers COOLDOWN / NO_MANA meanwhile).
      const r = await cast(0, 'sun_orb', 'dir');
      await sleep(r.ok ? 700 : 300);
    }
    const elim = events.find((e) => e.e === 'elim');
    expect(elim && elim.e === 'elim' && elim.by === ia && elim.target === ib).toBe(true);
    const lethal = events.filter((e) => e.e === 'dmg' && e.target === ib).pop();
    expect(lethal && lethal.e === 'dmg' && lethal.kinds.includes(HitKind.ELIMINATION) && lethal.kinds.includes(HitKind.ABILITY)).toBe(true);
    const res = await results;
    expect(res.winner).toBe(ia);
    expect(res.players.find((p) => p.index === ia)!.kills).toBe(1);
    // Results screen: abilities are off.
    expect((await cast(0, 'sun_orb', 'dir')).r).toBe(AbilityReject.PHASE);
    await a.leave(true);
    await b.leave(true);
  }, 25000);
});

/** Keeps every message of one type a room receives, so a test can wait for one that may already have arrived. */
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
    /** The newest message matching `pred`, now or when it arrives. */
    until(pred: (m: T) => boolean, ms = 5000): Promise<T> {
      for (let i = all.length - 1; i >= 0; i--) if (pred(all[i]!)) return Promise.resolve(all[i]!);
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`timeout waiting for message ${type}`)), ms);
        waiters.push({ pred, resolve: (m) => (clearTimeout(t), resolve(m)) });
      });
    },
  };
}

describe('ability draft through the authoritative server (gate 6: players enter with drafted abilities)', () => {
  let a: Room;
  let b: Room;
  let ia = -1;
  let ib = -1;
  let da: ReturnType<typeof inbox<DraftStateMsg>>;
  let db: ReturnType<typeof inbox<DraftStateMsg>>;
  let ra: ReturnType<typeof inbox<RoomStateMsg>>;
  const picksOf = (m: DraftStateMsg, i: number) => m.seats.find((s) => s.index === i)!.picks;

  it('READY opens the draft: round 1 is a basic round, nobody can fight', async () => {
    a = await new Client(url).create(ROOM_NAME, { ...opts('A'), countdownMs: 300, resultsMs: 900, closeSpawns: true, draftPickMs: 2500, draftRepickMs: 2500, draftRevealMs: 150 });
    da = inbox<DraftStateMsg>(a, S2C.DRAFT_STATE);
    ra = inbox<RoomStateMsg>(a, S2C.ROOM_STATE);
    ia = (await waitFor<WelcomeMsg>(a, S2C.WELCOME)).index;
    b = await new Client(url).joinById((await ra.until((m) => m.players.length === 1)).code, opts('B'));
    db = inbox<DraftStateMsg>(b, S2C.DRAFT_STATE);
    ib = (await waitFor<WelcomeMsg>(b, S2C.WELCOME)).index;
    await ra.until((m) => m.players.length === 2);
    a.send(C2S.READY, { r: 1 });
    b.send(C2S.READY, { r: 1 });
    await ra.until((m) => m.phase === MatchPhase.ABILITY_DRAFT);
    const s = await da.until((m) => m.round === 0 && m.stage === 'pick');
    expect(s).toMatchObject({ rounds: 4, kind: 'basic', unique: true, mine: null, repick: false });
    expect(s.pool).toContain('sun_orb');
    expect(s.pool).not.toContain('sun_meteor');
    expect([...s.priority].sort()).toEqual([ia, ib].sort());
    // Abilities and weapons are off during the draft.
    const r = await new Promise<AbilityResultMsg>((resolve) => {
      const off = a.onMessage(S2C.ABILITY_RESULT, (m: AbilityResultMsg) => (off(), resolve(m)));
      a.send(C2S.ABILITY_REQUEST, { s: 1, k: 1, a: DEFAULT_LOADOUTS[0]![1], c: 0 });
    });
    expect(r.r).toBe(AbilityReject.PHASE);
  });

  it('keeps choices hidden; a disputed ability goes to the player with priority and the other repicks', async () => {
    const first = da.latest()!.priority[0]!;
    const winner = first === ia ? a : b;
    const loser = first === ia ? b : a;
    const loserBox = first === ia ? db : da;
    const loserIndex = first === ia ? ib : ia;
    winner.send(C2S.DRAFT_PICK, { r: 0, a: 'sun_orb' });
    // The other side sees a lock, never the choice.
    const seen = await (first === ia ? db : da).until((m) => m.seats.some((x) => x.index === first && x.locked));
    expect(seen.mine).toBeNull();
    expect(seen.owners).toEqual([]);
    loser.send(C2S.DRAFT_PICK, { r: 0, a: 'sun_orb' });
    const lost = await loserBox.until((m) => m.repick);
    expect(lost.lostTo).toEqual({ index: first, a: 'sun_orb' });
    expect(lost.owners).toEqual([['sun_orb', first]]);
    // Taking it anyway is refused (the state keeps no choice); something else is accepted.
    loser.send(C2S.DRAFT_PICK, { r: 0, a: 'sun_orb' });
    await sleep(150);
    expect(loserBox.latest()!.mine).toBeNull();
    loser.send(C2S.DRAFT_PICK, { r: 0, a: 'sap_snare' });
    const rev = await da.until((m) => m.round === 0 && m.stage === 'reveal');
    expect(rev.reveal).toEqual(
      expect.arrayContaining([
        { index: first, a: 'sun_orb', auto: false, contested: true },
        { index: loserIndex, a: 'sap_snare', auto: false, contested: true },
      ]),
    );
    // Round 2 gives priority to the other player.
    const r1 = await da.until((m) => m.round === 1 && m.stage === 'pick');
    expect(r1.priority[0]).toBe(loserIndex);
  });

  it('rounds 2–4 (the last one an Ultimate); a player who runs out of time gets a random free ability', async () => {
    a.send(C2S.DRAFT_PICK, { r: 1, a: 'wind_step' });
    b.send(C2S.DRAFT_PICK, { r: 1, a: 'leaf_shell' });
    await da.until((m) => m.round === 2 && m.stage === 'pick');
    a.send(C2S.DRAFT_PICK, { r: 2, a: 'pollen_burst' });
    b.send(C2S.DRAFT_PICK, { r: 2, a: 'gust_ring' });
    const ult = await da.until((m) => m.round === 3 && m.stage === 'pick');
    expect(ult.kind).toBe('ultimate');
    expect(ult.pool.sort()).toEqual(['dawn_lance', 'petal_cyclone', 'sun_meteor']);
    a.send(C2S.DRAFT_PICK, { r: 3, a: 'dawn_lance' });
    // B waits: the window (2.5 s) expires and the server picks for B.
    const done = await da.until((m) => m.stage === 'done', 6000);
    expect(picksOf(done, ia)[3]).toBe('dawn_lance');
    expect(['sun_meteor', 'petal_cyclone']).toContain(picksOf(done, ib)[3]);
  }, 10000);

  it('the match starts with the drafted loadouts, public in ROOM_STATE, and only they can be cast', async () => {
    const st = await ra.until((m) => m.phase === MatchPhase.MATCH);
    const final = da.latest()!;
    const la = st.players.find((p) => p.index === ia)!.loadout;
    const lb = st.players.find((p) => p.index === ib)!.loadout;
    expect(la).toEqual(picksOf(final, ia));
    expect(lb).toEqual(picksOf(final, ib));
    expect(la.slice(1, 3)).toEqual(['wind_step', 'pollen_burst']);
    expect(lb.slice(1, 3)).toEqual(['leaf_shell', 'gust_ring']);
    expect(la.filter((id) => lb.includes(id))).toEqual([]);
    expect(st.players.every((p) => p.inMatch)).toBe(true);
    await sleep(450); // countdown
    const ask = (room: Room, s: number, k: number, id: string) =>
      new Promise<AbilityResultMsg>((resolve) => {
        const off = room.onMessage(S2C.ABILITY_RESULT, (m: AbilityResultMsg) => {
          if (m.s === s) {
            off();
            resolve(m);
          }
        });
        room.send(C2S.ABILITY_REQUEST, { s, k, a: id, c: 0 });
      });
    // A's warmup slot 3 was pollen_burst... now A's slot 2 holds the drafted pollen_burst, slot 3 the drafted lance.
    expect((await ask(a, 10, 3, 'sun_meteor')).r).toBe(AbilityReject.NOT_OWNED);
    expect((await ask(b, 10, 1, 'leaf_shell')).r).toBe(AbilityReject.OK);
    await a.leave(true);
    await b.leave(true);
  });
});
