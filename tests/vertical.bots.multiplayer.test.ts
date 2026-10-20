/**
 * Integration: bots in the vertical world through the real graao server (docs/world/VERTICAL_BOT_NAVIGATION.md and
 * docs/qa/VERTICAL_TRAVERSAL_TEST_REPORT.md, "Bots"), with Colyseus SDK clients that only send intent:
 * - a bot left on the Ilha do Sino when the Tormenta closes onto the ground far from it glides down the island's
 *   planagem link, walks into the safe region and goes back to fighting the person waiting there;
 * - ten participants (two SDK clients and eight bots, everyone empty-handed) spread round the Serra do Mirante, with the
 *   only chests on the summit and the islands: the server keeps up (every tick measured), nobody leaves the play zone or
 *   turns NaN, bots fight, and the Tormenta ends the match. How far the bots got up (links taken, chests opened up high)
 *   depends on who brawls first: it is reported, not asserted (the navigator tests prove the climbs).
 * Players are put at the spots under test through the room object (a test hook: the protocol has no teleport).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import { matchMaker } from '@colyseus/core';
import { CHEST_REGIONS, DEFAULT_APPEARANCE, GRAAO_MAP, PLANET, TRAVERSAL, randomAppearance } from '@graao/game-data';
import { buildNavGraph, createGameWorld, dirToLatLon, frameOfPlacement, type PlacementFrame } from '@graao/game-core';
import { C2S, CLIENT_VERSION, ChestState, MatchPhase, MovementState, PROTOCOL_VERSION, ROOM_NAME, S2C, SnapFlag, v3dot, v3len, v3normalize, type EventsMsg, type GameEvent, type RoomStateMsg, type SnapshotMsg, type Vec3, type WelcomeMsg } from '@graao/shared';
import { createGraaoServer } from '../apps/server/src/app';
import { setAuthVerifier } from '../apps/server/src/auth/SupabaseAuth';
import { setMatchStore } from '../apps/server/src/persistence/MatchStore';
import { getChestSpots, getWorld } from '../apps/server/src/world';

const PORT = 3170 + Math.floor(Math.random() * 40);
const server = createGraaoServer();
const url = `ws://127.0.0.1:${PORT}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const R = PLANET.radius;
const world = await createGameWorld({ includeVisual: false });
const nav = buildNavGraph(world);

beforeAll(async () => {
  setAuthVerifier(null);
  setMatchStore({ name: 'none', record: async () => null });
  await getWorld();
  await server.listen(PORT);
}, 30000);

afterAll(async () => {
  await server.gracefullyShutdown(false).catch(() => {});
});

const opts = (name: string) => ({ protocol: PROTOCOL_VERSION, client: CLIENT_VERSION, name, appearance: name === 'A' ? DEFAULT_APPEARANCE : randomAppearance(() => 0.42) });
const radial = (p: Vec3) => v3len(p) - R;
const add = (a: Vec3, b: Vec3, s: number): Vec3 => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s });
const neg = (v: Vec3): Vec3 => ({ x: -v.x, y: -v.y, z: -v.z });
const frame = (id: string): PlacementFrame => frameOfPlacement(world.terrain, GRAAO_MAP.placements.find((p) => p.id === id)!);
const ll = (p: Vec3) => dirToLatLon(v3normalize(p));
/** What a character stands on under (or just over) `p`. */
function footing(p: Vec3): Vec3 {
  const u = v3normalize(p);
  const hit = world.physics.castRay(add(p, u, 1.5), { x: -u.x, y: -u.y, z: -u.z }, 6)!;
  return add(p, u, 1.5 - hit.toi);
}
/** The terrain under `p` (the ground below an island, not its top). */
const groundAt = (p: Vec3): Vec3 => world.terrain.surfaceAt(v3normalize(p));
/** Ground a bot can walk on: a navigation node right there, on dry land. */
const walkable = (p: Vec3) => {
  const n = nav.nearest(p, 2.5);
  return n >= 0 && !nav.nodes[n]!.water && Math.abs(radial(nav.nodes[n]!.pos) - radial(p)) < 1;
};
/** Great-circle distance between two points' directions (m on the nominal sphere). */
const arc = (a: Vec3, b: Vec3) => Math.acos(Math.min(1, Math.max(-1, v3dot(v3normalize(a), v3normalize(b))))) * R;
const snapPos = (s: number[]): Vec3 => ({ x: s[1]! / 1000, y: s[2]! / 1000, z: s[3]! / 1000 });
const pct = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * q))] ?? 0;
/**
 * The period a plain 50 ms interval really gets on this machine (ms, median): the room's clock (Colyseus
 * setSimulationInterval) can tick no faster. On Windows the timer granularity of 15,6 ms makes it ~62,5 ms.
 */
async function platformTickMs(): Promise<number> {
  const gaps: number[] = [];
  await new Promise<void>((done) => {
    let last = performance.now();
    const id = setInterval(() => {
      const t = performance.now();
      gaps.push(t - last);
      last = t;
      if (gaps.length >= 20) {
        clearInterval(id);
        done();
      }
    }, 50);
  });
  return pct(gaps, 0.5);
}

interface ServerSide {
  index: number;
  bot?: boolean;
  state: { pos: Vec3; vel: Vec3; facing: Vec3; grounded: boolean; traversal: number; stamina: number; glideSteps: number };
}
interface BotBrainView {
  nav: { reset(): void; linking: boolean };
  /** The chest it is after (−1: none). */
  chest: number;
}
type RoomObject = {
  players: Map<string, ServerSide>;
  bots: Map<number, BotBrainView>;
  perf: { botMs: number; creepMs: number; peakTickMs: number; ticks: number };
  tickCostMs: number;
};
/** The link a bot is taking now (its navigator's private plan; null: walking). */
const linkOf = (b: BotBrainView): string | null => {
  const n = b.nav as unknown as { linking: boolean; links: ({ id: string } | null)[]; i: number };
  return n.linking ? n.links[n.i]?.id ?? null : null;
};

/** A client's view of a room: room states, events and the snapshots of everyone. */
function watch(room: Room) {
  const seen = { rooms: [] as RoomStateMsg[], events: [] as { t: number; e: GameEvent }[], snaps: new Map<number, number[][]>() };
  room.onMessage(S2C.ROOM_STATE, (m: RoomStateMsg) => seen.rooms.push(m));
  room.onMessage(S2C.EVENTS, (m: EventsMsg) => seen.events.push(...m.ev.map((e) => ({ t: Date.now(), e }))));
  room.onMessage(S2C.SNAPSHOT, (m: SnapshotMsg) => {
    for (const s of m.p) {
      let list = seen.snaps.get(s[0]!);
      if (!list) seen.snaps.set(s[0]!, (list = []));
      list.push([...s]);
    }
  });
  return seen;
}
const phaseOf = (seen: ReturnType<typeof watch>) => seen.rooms.at(-1)?.phase;
async function until<T>(f: () => T | undefined | false | null, ms: number): Promise<T | undefined> {
  for (let t = 0; t < ms; t += 50) {
    const v = f();
    if (v) return v;
    await sleep(50);
  }
  return undefined;
}

describe('a bot up on an island when the Tormenta closes elsewhere', () => {
  it('glides down, walks into the safe region and goes back to fighting', async () => {
    const sino = frame('vert-ilha-do-sino');
    const top = footing(sino.at(1.5, 0, 1.5));
    // The person waits on open ground south of the island, ~25 m away: the Tormenta closes onto that spot (8° ≈ 14 m),
    // so the island ends up outside and the bot, its opponent beyond its fighting reach, heads for the safe region.
    const spot = [sino.at(2, 0, 26), sino.at(-2, 0, 27), sino.at(6, 0, 25), sino.at(0, 0, 30), sino.at(-6, 0, 26)].map(groundAt).find(walkable);
    expect(spot, 'chão aberto ao sul da ilha').toBeTruthy();
    const a = await new Client(url).create(ROOM_NAME, {
      ...opts('A'),
      legacyWarmup: true,
      maxPlayers: 2,
      bots: 1,
      countdownMs: 300,
      resultsMs: 3000,
      skipDraft: true,
      skipUfo: true,
      chestCount: 0,
      creepCount: 0,
      matchSpawns: [ll(spot!), ll(top)],
      tormentaFinal: ll(spot!),
      tormentaPhases: [{ waitMs: 1500, shrinkMs: 1500, radiusDeg: 8, damage: 1 }],
      tormentaPulseMs: 500,
      tormentaFinalDamage: 1,
    });
    const A = watch(a);
    const welcome = await new Promise<WelcomeMsg>((r) => a.onMessage(S2C.WELCOME, r));
    const room = matchMaker.getLocalRoomById(a.roomId) as unknown as RoomObject;
    try {
      const bot = await until(() => A.rooms.at(-1)?.players.find((p) => p.bot), 3000);
      expect(bot, 'um bot na sala').toBeTruthy();
      const ib = bot!.index;
      a.send(C2S.READY, { r: 1 });
      expect(await until(() => phaseOf(A) === MatchPhase.MATCH, 8000), 'a partida começa').toBe(true);
      // The bot on the island's top, at rest, with a fresh plan (its spawn was the ground under the island).
      const sb = [...room.players.values()].find((p) => p.index === ib)!;
      const up = v3normalize(top);
      Object.assign(sb.state, { pos: add(top, up, 0.05), vel: { x: 0, y: 0, z: 0 }, facing: sino.forward, grounded: false, traversal: 0, stamina: TRAVERSAL.stamina.max, glideSteps: 0 });
      room.bots.get(ib)!.nav.reset();
      const links = new Set<string>();
      const t0 = Date.now();
      // What the bot went through on the server (traversal mode changes, with the time and its height over the ground).
      const modes: string[] = [];
      const tracker = setInterval(() => {
        const l = linkOf(room.bots.get(ib)!);
        if (l) links.add(l);
        const m = `${sb.state.traversal}${sb.state.grounded ? 'g' : ''}`;
        if (modes.at(-1)?.split('@')[0] !== m) modes.push(`${m}@${((Date.now() - t0) / 1000).toFixed(1)}/${(radial(sb.state.pos) - radial(groundAt(sb.state.pos))).toFixed(1)}`);
      }, 50);
      const snaps = () => A.snaps.get(ib) ?? [];
      try {
        // Down from the island on the kite, standing on the ground well under it.
        const glided = await until(() => snaps().some((s) => s[11] === MovementState.GLIDE), 20000);
        expect(glided, `o bot plana para descer (ligações: ${[...links].join(', ') || '—'}; modos ${modes.join(' ')})`).toBe(true);
        const landed = await until(() => {
          const s = snaps().at(-1);
          return s && (s[13]! & SnapFlag.GROUNDED) !== 0 && radial(snapPos(s)) < radial(top) - 5;
        }, 15000);
        expect(landed, 'o bot pousa no chão').toBe(true);
        expect([...links].some((l) => /^vert-lk-planagem-/.test(l)), `ligações ${[...links].join(', ')}`).toBe(true);
        // Inside the safe region (no Tormenta flag, near its centre).
        const inside = await until(() => {
          const s = snaps().at(-1);
          return s && (s[13]! & SnapFlag.IN_TORMENTA) === 0 && arc(snapPos(s), spot!) < 12;
        }, 30000);
        expect(inside, 'o bot entra na região segura').toBe(true);
        const landedAt = Date.now();
        // Back to the fight: its shots or punches land on A (not the Tormenta's damage).
        const hit = await until(() => A.events.find(({ t, e }) => t >= landedAt - 2000 && e.e === 'dmg' && e.by === ib && e.target === welcome.index && e.c !== 'tormenta'), 20000);
        expect(hit, 'o bot volta a lutar').toBeTruthy();
        if (process.env.GRAAO_DEBUG) console.log(`[bot-tormenta] ligações ${[...links].join(' → ')}; região segura em ${((landedAt - t0) / 1000).toFixed(1)} s; dano em A ${((hit!.t - t0) / 1000).toFixed(1)} s`);
      } finally {
        clearInterval(tracker);
      }
    } finally {
      await a.leave();
    }
  }, 90000);
});

describe('a chest up high (Alturas: better loot)', () => {
  it('a bot at the foot of the Serra prefers the summit chest to a nearer one on the ground, climbs up and opens it', async () => {
    const massif = frame('vert-serra-macico');
    const foot = footing(massif.at(0.6, 0.5, 9.5));
    const spots = getChestSpots(await getWorld());
    const summit = spots.find((c) => c.def.id === 'vert-cume-mirante')!;
    expect(summit?.ok, 'o baú do cume é válido').toBe(true);
    const dSummit = v3len({ x: summit.pos.x - foot.x, y: summit.pos.y - foot.y, z: summit.pos.z - foot.z });
    // A plain chest nearer than the summit in a straight line, but within the high chest's pull.
    const plain = spots
      .filter((c) => c.ok && !CHEST_REGIONS[c.region]?.vantage)
      .map((c) => ({ c, d: v3len({ x: c.pos.x - foot.x, y: c.pos.y - foot.y, z: c.pos.z - foot.z }) }))
      .filter(({ d }) => d < dSummit - 1 && d > dSummit - 15)
      .sort((x, y) => x.d - y.d)[0];
    // The person far away (beyond the calm range: the bot explores instead of hunting it).
    const far = footing(groundAt(neg(massif.base)));
    const a = await new Client(url).create(ROOM_NAME, {
      ...opts('A'), legacyWarmup: true, maxPlayers: 2, bots: 1, countdownMs: 300, skipDraft: true, skipUfo: true, creepCount: 0,
      lootSpots: ['vert-cume-mirante', ...(plain ? [plain.c.def.id] : [])], chestCount: plain ? 2 : 1,
      matchSpawns: [ll(far), ll(foot)],
      // The safe region stays round the Serra the whole time (a random one would send the bot off to it instead).
      tormentaFinal: ll(foot),
      tormentaPhases: [{ waitMs: 120000, shrinkMs: 3000, radiusDeg: 60, damage: 1 }],
    });
    const A = watch(a);
    await new Promise<WelcomeMsg>((r) => a.onMessage(S2C.WELCOME, r));
    const room = matchMaker.getLocalRoomById(a.roomId) as unknown as RoomObject & { loot: { chests: { id: number; state: number; by: number; spot: { def: { id: string } } }[] } };
    try {
      const bot = await until(() => A.rooms.at(-1)?.players.find((p) => p.bot), 3000);
      expect(bot, 'um bot na sala').toBeTruthy();
      const ib = bot!.index;
      a.send(C2S.READY, { r: 1 });
      expect(await until(() => phaseOf(A) === MatchPhase.MATCH, 8000), 'a partida começa').toBe(true);
      const top = room.loot.chests.find((c) => c.spot.def.id === 'vert-cume-mirante')!;
      const sb = [...room.players.values()].find((p) => p.index === ib)!;
      // Seats are not handed out in a fixed order: put the bot at the foot of the Serra and the person far away.
      const sa = [...room.players.values()].find((p) => !p.bot)!;
      const rest = (st: ServerSide['state'], p: Vec3, f: Vec3) => Object.assign(st, { pos: add(p, v3normalize(p), 0.05), vel: { x: 0, y: 0, z: 0 }, facing: f, grounded: false, traversal: 0, stamina: TRAVERSAL.stamina.max, glideSteps: 0 });
      rest(sa.state, far, massif.forward);
      rest(sb.state, foot, neg(massif.forward));
      room.bots.get(ib)!.nav.reset();
      const links = new Set<string>();
      let chosen = -2;
      const tracker = setInterval(() => {
        const l = linkOf(room.bots.get(ib)!);
        if (l) links.add(l);
        if (chosen === -2 && room.bots.get(ib)!.chest >= 0) chosen = room.bots.get(ib)!.chest;
      }, 50);
      try {
        const opened = await until(() => top.state !== ChestState.CLOSED && top.by === ib, 60000);
        if (process.env.GRAAO_DEBUG) console.log(`baú do cume: ${dSummit.toFixed(1)} m; baú comum ${plain ? `${plain.c.def.id} a ${plain.d.toFixed(1)} m` : '—'}; ligações ${[...links].join(', ')}; bot a ${radial(sb.state.pos).toFixed(1)} m`);
        expect(opened, `o bot abre o baú do cume (ligações: ${[...links].join(', ') || '—'}; bot a ${radial(sb.state.pos).toFixed(1)} m)`).toBe(true);
        if (plain) expect(chosen, 'o primeiro baú escolhido foi o do cume').toBe(top.id);
      } finally {
        clearInterval(tracker);
      }
    } finally {
      await a.leave().catch(() => {});
    }
  }, 90000);
});

describe('ten participants round the Serra do Mirante, the chests up high', () => {
  it('the server keeps up, nobody leaves the play zone, bots fight and the match ends', async () => {
    const massif = frame('vert-serra-macico');
    // Ten spots on open ground in a ring round the massif, ten metres apart at least (empty hands start no brawl at once).
    const spots: Vec3[] = [];
    for (let k = 0; spots.length < 10 && k < 200; k++) {
      const a = (k * 2.399) % (Math.PI * 2);
      const r = 22 + (k % 5) * 4.5;
      const p = groundAt(massif.at(Math.cos(a) * r, 0, Math.sin(a) * r));
      if (walkable(p) && spots.every((q) => v3len({ x: p.x - q.x, y: p.y - q.y, z: p.z - q.z }) > 10)) spots.push(p);
    }
    expect(spots.length).toBe(10);
    const centre = groundAt(massif.at(0, 0, 14));
    const platform = await platformTickMs();
    const a = await new Client(url).create(ROOM_NAME, {
      ...opts('A'),
      legacyWarmup: true,
      maxPlayers: 10,
      bots: 8,
      countdownMs: 300,
      resultsMs: 3000,
      skipDraft: true,
      skipUfo: true,
      unarmedStart: true,
      creepCount: 0,
      // The only chests: on the summit and on the two highest islands.
      lootSpots: ['vert-cume-mirante', 'vert-ilha-sino-capelinha', 'vert-ilha-torre'],
      chestCount: 3,
      matchSpawns: spots.map(ll),
      tormentaFinal: ll(centre),
      // A wide first region (everyone inside: the bots go for the chests, not for the safe region), then a close.
      tormentaPhases: [{ waitMs: 26000, shrinkMs: 3000, radiusDeg: 45, damage: 2 }, { waitMs: 1500, shrinkMs: 5000, radiusDeg: 6, damage: 8 }],
      tormentaPulseMs: 400,
      tormentaFinalDamage: 25,
    });
    const A = watch(a);
    await new Promise<WelcomeMsg>((r) => a.onMessage(S2C.WELCOME, r));
    const b = await new Client(url).joinById(a.roomId, opts('B'));
    const B = watch(b);
    await new Promise<WelcomeMsg>((r) => b.onMessage(S2C.WELCOME, r));
    const room = matchMaker.getLocalRoomById(a.roomId) as unknown as RoomObject;
    // Every server tick of this room, measured from outside: its cost and the time since the one before (ms).
    const ticks: { at: number; cost: number; gap: number; phase: number }[] = [];
    const tickOf = room as unknown as { update(): void; phase: number };
    const update = tickOf.update.bind(room);
    tickOf.update = () => {
      const t = performance.now();
      update();
      ticks.push({ at: t, cost: performance.now() - t, gap: ticks.length ? t - ticks.at(-1)!.at : 0, phase: tickOf.phase });
    };
    try {
      expect(await until(() => (A.rooms.at(-1)?.players.length ?? 0) === 10, 4000), 'dez participantes').toBe(true);
      a.send(C2S.READY, { r: 1 });
      b.send(C2S.READY, { r: 1 });
      expect(await until(() => phaseOf(A) === MatchPhase.MATCH, 8000), 'a partida começa').toBe(true);
      const players = A.rooms.at(-1)!.players;
      const bots = players.filter((p) => p.bot).map((p) => p.index);
      expect(bots).toHaveLength(8);
      const links = new Map<number, Set<string>>();
      const chestBots = new Set<number>();
      const high = new Map<number, number>();
      let maxCost = 0;
      const tracker = setInterval(() => {
        for (const [i, brain] of room.bots) {
          const l = linkOf(brain);
          if (l) (links.get(i) ?? links.set(i, new Set()).get(i)!).add(l);
          if (brain.chest >= 0) chestBots.add(i);
          const sp = [...room.players.values()].find((p) => p.index === i);
          if (sp) high.set(i, Math.max(high.get(i) ?? -Infinity, radial(sp.state.pos) - radial(world.terrain.surfaceAt(v3normalize(sp.state.pos)))));
        }
        maxCost = Math.max(maxCost, room.tickCostMs);
      }, 50);
      const t0 = Date.now();
      const from = ticks.length;
      const ended = await until(() => phaseOf(A) === MatchPhase.RESULTS, 75000);
      clearInterval(tracker);
      const seconds = (Date.now() - t0) / 1000;
      const match = ticks.slice(from).filter((k) => k.phase === MatchPhase.MATCH);
      const costs = match.map((k) => k.cost);
      const gaps = match.slice(1).map((k) => k.gap);
      const worst = [...match].sort((x, y) => y.cost - x.cost).slice(0, 3).map((k) => `${k.cost.toFixed(1)} ms em ${((k.at - match[0]!.at) / 1000).toFixed(1)} s`);

      // Every participant stayed finite and inside the radial ceiling of the play zone.
      for (const [, list] of A.snaps) for (const s of list) {
        const p = snapPos(s);
        expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
        expect(radial(p)).toBeLessThan(TRAVERSAL.ceiling + 1);
      }
      // Bots went up: links taken, and climbing or the kite seen by the clients.
      const taken = [...links.values()].flatMap((s) => [...s]);
      const states = new Set(bots.flatMap((i) => (A.snaps.get(i) ?? []).map((s) => s[11]!)).filter((m) => m === MovementState.CLIMB || m === MovementState.GLIDE || m === MovementState.LEDGE_HANG || m === MovementState.MANTLE));
      const opened = A.events.filter(({ e }) => e.e === 'chest' && e.st === ChestState.OPENING && bots.includes(e.by));
      const fights = A.events.filter(({ e }) => e.e === 'dmg' && e.c !== 'tormenta' && bots.includes(e.by));
      const tickLine = `ticks ${match.length} (${(match.length / seconds).toFixed(1)}/s): custo p50 ${pct(costs, 0.5).toFixed(2)} p95 ${pct(costs, 0.95).toFixed(2)} p99 ${pct(costs, 0.99).toFixed(2)} ms, piores ${worst.join(', ')}; intervalo p50 ${pct(gaps, 0.5).toFixed(1)} p95 ${pct(gaps, 0.95).toFixed(1)} ms (timer da plataforma ${platform.toFixed(1)} ms)`;
      const summary = `${seconds.toFixed(1)} s; ${tickLine}; ligações ${taken.join(', ') || '—'}; travessias vistas ${[...states].join(',') || '—'}; vencedor ${A.rooms.at(-1)?.winner ?? '—'}; atrás de baús ${[...chestBots].join(',') || '—'}; altura máx. sobre o terreno ${[...high].map(([i, h]) => `${i}:${h.toFixed(1)}`).join(' ')}; baús abertos por bots ${opened.length}; golpes de bots ${fights.length}; tick suavizado máx. ${maxCost.toFixed(2)} ms, bots ${room.perf.botMs.toFixed(2)} ms`;
      if (process.env.GRAAO_DEBUG) console.log(`[dez] ${summary}`);
      expect(fights.length, summary).toBeGreaterThan(0);
      // The server keeps up: nearly every tick well inside the 50 ms tick, and the room ticks as often as the platform's
      // timer lets it. The bounds catch a gross regression only (the 5 ms budget is measured alone, VERTICAL_WORLD_BUDGET.md):
      // the same scenario in the vila gives the same numbers, and other test files run beside this one.
      expect(pct(costs, 0.5), summary).toBeLessThan(10);
      expect(pct(costs, 0.95), summary).toBeLessThan(25);
      expect(pct(gaps, 0.5), summary).toBeLessThan(platform + 6);
      // Over: a winner, or nobody when the last ones fall to the same pulse of the Tormenta.
      expect(ended, `a partida termina: ${summary}`).toBe(true);
      expect(B.rooms.at(-1)!.phase).toBe(MatchPhase.RESULTS);
    } finally {
      await a.leave();
      await b.leave();
    }
  }, 120000);
});
