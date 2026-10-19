/**
 * Headless match with creeps (Teste I and Teste L of docs/gameplay/CREEP_SYSTEM.md): runs the real GraaoMatchRoom in
 * this process under Battle Royale rules (everyone lands with empty hands) with N people (idle SDK clients that only
 * get ready) and M bots, and reports per plan:
 *   - server cost: tick (mean of the smoothed cost, worst tick), creep AI + movement, bot brains, creeps alive;
 *   - network: bytes per second one client receives (snapshots with creeps, events);
 *   - what the bots did: chests opened, weapons picked up, creeps defeated, XP, levels and points spent (by profile).
 *
 *   pnpm exec tsx tools/profiling/creep-soak.ts [--plans 1+9,2+8,2+0] [--seconds 90] [--creeps 16] [--out file.json]
 *
 * "1+9" = one person and nine bots. People stand still (bots may eliminate them: they keep watching, like players).
 * Without the UFO everyone starts on a spawn spread over the planet (chest spots far apart, like a spread-out drop);
 * --tight keeps the match's own spawn ring instead.
 */
import { writeFileSync } from 'node:fs';
import { Client, type Room } from '@colyseus/sdk';
import { matchMaker } from '@colyseus/core';
import { BOT_STAT_PROFILE_IDS, DEFAULT_APPEARANCE, STAT_IDS } from '@graao/game-data';
import { dirToLatLon } from '@graao/game-core';
import { C2S, CLIENT_VERSION, CreepStateCode, MatchPhase, PROTOCOL_VERSION, ROOM_NAME, S2C, type EventsMsg, type RoomStateMsg } from '@graao/shared';
import { createGraaoServer } from '../../apps/server/src/app';
import { setAuthVerifier } from '../../apps/server/src/auth/SupabaseAuth';
import { setMatchStore } from '../../apps/server/src/persistence/MatchStore';
import { getChestSpots, getWorld } from '../../apps/server/src/world';

const args = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] && !args[i + 1]!.startsWith('--') ? args[i + 1]! : d;
};
const plans = arg('plans', '1+9,2+8,2+0').split(',').map((p) => p.split('+').map(Number) as [number, number]);
const seconds = Number(arg('seconds', '90'));
const creepCount = Number(arg('creeps', '16'));
const out = arg('out', '');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface RoomInternals {
  tickCostMs: number;
  perf: { creepMs: number; botMs: number; peakTickMs: number; ticks: number };
  creeps: { creeps: Map<number, { state: number }>; director: { dropped: number } };
  players: Map<string, { index: number; bot: boolean; name: string; prog: { level: number; xp: number; points: number; stats: number[] }; inv: { slots: ({ id: string } | null)[] }; kills: number; vitals: { alive: boolean } }>;
}

setAuthVerifier(null);
setMatchStore({ name: 'none', record: async () => null });
const world = await getWorld();
// Ten spawns far apart (farthest-point sampling over the chest spots: always on reachable ground).
const spots = getChestSpots(world).map((s) => s.pos);
const spread = [spots[0]!];
while (spread.length < 10) {
  let best = spots[0]!;
  let bestD = -1;
  for (const p of spots) {
    const d = Math.min(...spread.map((q) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z)));
    if (d > bestD) {
      bestD = d;
      best = p;
    }
  }
  spread.push(best);
}
const matchSpawns = args.includes('--tight') ? undefined : spread.map((p) => dirToLatLon(p));
const port = 3200 + Math.floor(Math.random() * 300);
const server = createGraaoServer();
await server.listen(port);
const url = `ws://127.0.0.1:${port}`;
const report: Record<string, unknown>[] = [];

for (const [people, bots] of plans) {
  const opts = (name: string) => ({ legacyWarmup: true, protocol: PROTOCOL_VERSION, client: `soak/${CLIENT_VERSION}`, name, appearance: DEFAULT_APPEARANCE });
  const first = await new Client(url).create(ROOM_NAME, {
    ...opts('P1'), maxPlayers: people + bots, bots, countdownMs: 100, resultsMs: 60000, skipDraft: true, skipUfo: true, unarmedStart: true, creepCount, creepSeed: 7, ...(matchSpawns ? { matchSpawns } : {}),
  });
  const rooms: Room[] = [first];
  for (let k = 1; k < people; k++) rooms.push(await new Client(url).joinById(first.roomId, opts(`P${k + 1}`)));
  const internals = matchMaker.getLocalRoomById(first.roomId) as unknown as RoomInternals;
  // Bytes one client receives.
  let bytes = 0;
  const conn = (first as unknown as { connection: { events: { onmessage?: (e: { data: ArrayBuffer }) => void } } }).connection.events;
  const orig = conn.onmessage;
  conn.onmessage = (e) => {
    bytes += e.data.byteLength ?? 0;
    orig?.(e);
  };
  const tally = { chestsOpened: new Map<number, number>(), weaponsTaken: new Map<number, number>(), creepKills: new Map<number, number>(), levelUps: new Map<number, number>() };
  // Fights between participants: damage by fists and by everything else, eliminations, and when the match ended.
  const fights = { punchDamage: 0, otherDamage: 0, eliminations: 0, endedAtS: -1 };
  const bump = (m: Map<number, number>, k: number) => m.set(k, (m.get(k) ?? 0) + 1);
  let phase = -1;
  first.onMessage(S2C.ROOM_STATE, (m: RoomStateMsg) => (phase = m.phase));
  first.onMessage(S2C.EVENTS, (m: EventsMsg) => {
    for (const e of m.ev) {
      if (e.e === 'chest' && e.st === 1) bump(tally.chestsOpened, e.by);
      else if (e.e === 'creepDie' && e.by >= 0) bump(tally.creepKills, e.by);
      else if (e.e === 'lvl') bump(tally.levelUps, e.target);
      else if (e.e === 'dmg' && e.by !== e.target) {
        if (e.m === 1) fights.punchDamage += e.amount;
        else fights.otherDamage += e.amount;
      } else if (e.e === 'elim' && e.by !== e.target) fights.eliminations++;
    }
  });
  for (const r of rooms) {
    r.onMessage('*', () => {});
    r.send(C2S.READY, { r: 1 });
  }
  const t0 = Date.now();
  while (phase !== MatchPhase.MATCH && Date.now() - t0 < 15000) await sleep(100);
  if (phase !== MatchPhase.MATCH) throw new Error(`plan ${people}+${bots}: the match did not start`);
  const samples: { tick: number; peak: number; creepMs: number; botMs: number; alive: number }[] = [];
  bytes = 0;
  const start = Date.now();
  const weaponsSeen = new Set<string>();
  while (Date.now() - start < seconds * 1000 && phase === MatchPhase.MATCH) {
    await sleep(1000);
    const p = internals.perf;
    samples.push({ tick: internals.tickCostMs, peak: p.peakTickMs, creepMs: p.creepMs, botMs: p.botMs, alive: [...internals.creeps.creeps.values()].filter((c) => c.state !== CreepStateCode.DEAD).length });
    p.peakTickMs = 0;
    for (const q of internals.players.values()) {
      if (!q.bot) continue;
      for (const s of q.inv.slots) if (s && !weaponsSeen.has(`${q.index}:${s.id}`)) {
        weaponsSeen.add(`${q.index}:${s.id}`);
        bump(tally.weaponsTaken, q.index);
      }
    }
  }
  const elapsed = (Date.now() - start) / 1000;
  if (phase !== MatchPhase.MATCH) fights.endedAtS = Math.round(elapsed);
  const mean = (k: keyof (typeof samples)[number]) => samples.reduce((a, s) => a + s[k], 0) / Math.max(1, samples.length);
  const botRows = [...internals.players.values()].filter((q) => q.bot).map((q) => ({
    name: q.name,
    profile: BOT_STAT_PROFILE_IDS[q.index % BOT_STAT_PROFILE_IDS.length],
    alive: q.vitals.alive,
    level: q.prog.level,
    pointsLeft: q.prog.points,
    spent: Object.fromEntries(STAT_IDS.map((id, k) => [id, q.prog.stats[k] ?? 0]).filter(([, n]) => (n as number) > 0)),
    weapons: q.inv.slots.filter(Boolean).map((s) => s!.id),
    chestsOpened: tally.chestsOpened.get(q.index) ?? 0,
    weaponsPickedUp: tally.weaponsTaken.get(q.index) ?? 0,
    creepsDefeated: tally.creepKills.get(q.index) ?? 0,
    kills: q.kills,
  }));
  const row = {
    plan: `${people}+${bots}`,
    seconds: Math.round(elapsed),
    creepCap: creepCount,
    creepsAliveMean: Math.round(mean('alive') * 10) / 10,
    tickMeanMs: Math.round(mean('tick') * 100) / 100,
    tickPeakMs: Math.round(Math.max(...samples.map((s) => s.peak)) * 100) / 100,
    creepAiMeanMs: Math.round(mean('creepMs') * 1000) / 1000,
    botBrainMeanMs: Math.round(mean('botMs') * 1000) / 1000,
    respawnsDropped: internals.creeps.director.dropped,
    kbPerSecondPerClient: Math.round((bytes / 1024 / Math.max(1, elapsed)) * 10) / 10,
    ...fights,
    botLevels: botRows.map((b) => b.level).join(','),
    bots: botRows,
  };
  report.push(row);
  console.log(JSON.stringify({ ...row, bots: undefined }, null, 0));
  for (const b of botRows) console.log('   ', JSON.stringify(b));
  for (const r of rooms) await r.leave().catch(() => {});
  await sleep(500);
}

if (out) writeFileSync(out, JSON.stringify({ date: new Date().toISOString(), seconds, creepCount, report }, null, 2));
await server.gracefullyShutdown(false).catch(() => {});
process.exit(0);
