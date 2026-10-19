/**
 * Isolated Ability v2 profiling: real Colyseus room, two independent SDK clients and eight real bots.
 * pnpm exec tsx tools/profiling/ability-metrics.ts --seconds 12 --out docs/gameplay/perf/ability-v2-network.json
 * Decoded payload JSON bytes are a logical comparison, NOT measured MessagePack/WebSocket wire traffic.
 * No .env loading, persistence, external services, browser, renderer or production server are used.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Client, type Room } from '@colyseus/sdk';
import { matchMaker } from '@colyseus/core';
import { ABILITIES, DEFAULT_APPEARANCE, ULTIMATE_ABILITIES, type AbilityId, type Loadout } from '@graao/game-data';
import {
  GRAAbilitySystem, applyAbilityDamage, createAbilityBarrier, createCharacterState, createPhysics,
  initRapier, newAbilityRuntime, newVitals, resolveTargetPoint, validateLoadout,
  type AbilityActor, type AbilityHost, type CharacterState,
} from '@graao/game-core';
import {
  AbilityReject, C2S, CLIENT_VERSION, MatchPhase, PROTOCOL_VERSION, ROOM_NAME, S2C, v3normalize,
  type AbilityResultMsg, type AbilityRevealMsg, type DraftStateMsg, type EventsMsg, type GameEvent,
  type PongMsg, type RoomStateMsg, type Vec3, type WelcomeMsg,
} from '@graao/shared';
import { createGraaoServer } from '../../apps/server/src/app';
import { setAuthVerifier } from '../../apps/server/src/auth/SupabaseAuth';
import { setMatchStore } from '../../apps/server/src/persistence/MatchStore';
import { getWorld } from '../../apps/server/src/world';

const arg = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : process.argv[index + 1] ?? fallback;
};
const seconds = Number(arg('seconds', '12'));
if (!Number.isFinite(seconds) || seconds < 10 || seconds > 30) throw new Error('--seconds must be 10..30');
if (process.env.NODE_ENV === 'production') throw new Error('The profiler needs development-only room options.');
const out = arg('out', 'docs/gameplay/perf/ability-v2-network.json');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const round = (n: number, places = 4) => Number(n.toFixed(places));
function stats(values: number[]) {
  const sorted = values.toSorted((a, b) => a - b);
  return {
    samples: values.length,
    min: sorted.at(0) ?? null,
    mean: values.length ? round(values.reduce((a, b) => a + b, 0) / values.length) : null,
    p95: sorted.length ? round(sorted[Math.floor((sorted.length - 1) * 0.95)]!) : null,
    max: sorted.at(-1) ?? null,
  };
}
async function until<T>(read: () => T | undefined | false, label: string, ms = 10000): Promise<T> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const result = read();
    if (result) return result;
    await sleep(10);
  }
  throw new Error(`Timed out: ${label}`);
}

interface InternalPlayer { index: number; bot: boolean; state: CharacterState }
interface InternalRoom {
  abilities: GRAAbilitySystem;
  players: Map<string, InternalPlayer>;
  perf: { creepMs: number; botMs: number; peakTickMs: number; ticks: number };
}
interface Traffic { count: number; bytes: number; sizes: number[] }
const desired: Loadout[] = [
  ['firefly_scout', 'paper_wall', 'steady_hand', 'sun_meteor'],
  ['sap_snare', 'leaf_shell', 'anti_glue', 'firefly_beacon'],
];

async function concurrentUltimateStress() {
  const physics = createPhysics(await initRapier(), {
    positions: new Float32Array([-70, -70, 100, 70, -70, 100, 70, 70, 100, -70, 70, 100]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]), normals: new Float32Array(12),
    heights: new Float32Array(4), triangleFace: new Uint8Array(2),
  }, { placements: [], structures: [], anchors: [], doors: [], crates: [] });
  const actors: AbilityActor[] = ULTIMATE_ABILITIES.map((ultimate, index) => ({
    index, state: createCharacterState({ x: (index % 5 - 2) * 12, y: index < 5 ? -12 : 12, z: 100.01 }, { x: 1, y: 0, z: 0 }),
    vitals: newVitals(), loadout: ['wind_step', 'sap_snare', 'steady_hand', ultimate],
    cooldownEnds: [0, 0, 0, 0], castUntil: 0, slowUntil: 0, slowFactor: 1, runtime: newAbilityRuntime(0),
  }));
  const events: GameEvent[] = [];
  let reveals = 0;
  const host: AbilityHost = {
    actors: () => actors, physics, canFight: (actor) => actor.vitals.alive,
    damage: (_by, target, amount) => { applyAbilityDamage(target.vitals, amount); },
    dash: () => {}, emit: (event) => events.push(event), sendPrivate: () => { reveals++; },
    createBarrier: (_view, frame) => createAbilityBarrier(physics, frame),
    teleport: (actor, feet, facing) => { actor.state.pos = { ...feet }; actor.state.facing = { ...facing }; },
  };
  const engine = new GRAAbilitySystem(host);
  const costs: number[] = [], combined: number[] = [], entities: number[] = [], pending: number[] = [], projectiles: number[] = [];
  const start = performance.now();
  try {
    const requests = actors.map((actor) => {
      const id = actor.loadout[3], def = ABILITIES[id];
      const point = { x: actor.state.pos.x + 3, y: actor.state.pos.y, z: 100.01 };
      const direction = v3normalize({ x: 1, y: 0, z: -actor.state.pos.x / actor.state.pos.z });
      const reason = engine.request(actor, { slot: 3, id, seq: 1, cmdSeq: 1,
        ...(def.targetType === 'point' ? { point } : {}), ...(def.targetType === 'direction' ? { dir: direction } : {}),
      }, 1000);
      return { id, accepted: reason === AbilityReject.OK, reason: Object.entries(AbilityReject).find(([, value]) => value === reason)?.[0] };
    });
    const requestBatchMs = performance.now() - start;
    const steps = 900;
    for (let step = 0; step < steps; step++) {
      const before = performance.now();
      engine.update(1000 + step * (1000 / 60), 1 / 60);
      const after = performance.now();
      physics.world.step();
      costs.push(after - before); combined.push(performance.now() - before);
      entities.push(engine.entities.length); pending.push(engine.pendingCount); projectiles.push(engine.projectileCount);
    }
    const barriersBeforeClear = physics.barrierHandles.size;
    engine.clear();
    return {
      config: { actors: 10, uniqueUltimates: 10, sameRequestTimeMs: 1000, simulatedSeconds: 15, steps, simulatedHz: 60 },
      requests, allTenAccepted: requests.every((request) => request.accepted), requestBatchMs: round(requestBatchMs),
      abilityUpdateMs: stats(costs), abilityAndRapierStepMs: stats(combined),
      activeGameplayObjects: { persistentEntities: stats(entities), pendingCastsAndAreas: stats(pending), projectiles: stats(projectiles) },
      eventCount: events.length, privateRevealCount: reveals, barriersBeforeClear,
      cleanup: { persistentEntities: engine.entities.length, pending: engine.pendingCount, projectiles: engine.projectileCount, colliders: physics.barrierHandles.size },
      limits: [
        'Separate deterministic microbenchmark: all ten different Ultimates requested at the same simulated timestamp.',
        'Real Rapier terrain plane and real ability barrier colliders, not the production map.',
        'Authoritative effect engine + Rapier world.step only. No CharacterMotor/AI/network/renderer; flight state exists but is not physically integrated.',
        'No warmup/repeated runs; a single short timing sample can include JIT/GC or shared-machine scheduling noise.',
        'Does not establish ten-player synchronized browser performance or wire traffic.',
      ],
    };
  } finally { engine.clear(); physics.dispose(); }
}
const names = new Map<number, string>(Object.entries(S2C).map(([name, type]) => [type, name]));
let collecting = false;
function watch(room: Room, human: number) {
  let welcome: WelcomeMsg | undefined;
  let state: RoomStateMsg | undefined;
  const phases = new Set<number>();
  const traffic = new Map<number, Traffic>();
  const events: GameEvent[] = [];
  const results: AbilityResultMsg[] = [];
  const reveals: AbilityRevealMsg[] = [];
  const ticks: number[] = [];
  const draftRounds = new Set<number>();
  for (const type of Object.values(S2C)) room.onMessage(type, (payload: unknown) => {
    if (type === S2C.WELCOME) welcome = payload as WelcomeMsg;
    if (type === S2C.ROOM_STATE) { state = payload as RoomStateMsg; phases.add(state.phase); }
    if (type === S2C.DRAFT_STATE) {
      const draft = payload as DraftStateMsg;
      if (draft.stage === 'pick' && draft.round < 4 && !draftRounds.has(draft.round)) {
        draftRounds.add(draft.round);
        room.send(C2S.DRAFT_PICK, { r: draft.round, a: desired[human]![draft.round]! });
      }
    }
    if (!collecting) return;
    const row = traffic.get(type) ?? { count: 0, bytes: 0, sizes: [] };
    const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
    row.count++; row.bytes += bytes; row.sizes.push(bytes); traffic.set(type, row);
    if (type === S2C.EVENTS) events.push(...(payload as EventsMsg).ev);
    if (type === S2C.PONG) ticks.push((payload as PongMsg).tick);
    if (type === S2C.ABILITY_RESULT) results.push(payload as AbilityResultMsg);
    if (type === S2C.ABILITY_REVEAL) reveals.push(payload as AbilityRevealMsg);
  });
  return { get welcome() { return welcome; }, get state() { return state; }, traffic, phases, events, results, reveals, ticks, draftRounds };
}

// Explicit no-op providers. The app module does not load environment files.
setAuthVerifier(null);
setMatchStore({ name: 'profiling-none', record: async () => null });
const world = await getWorld();
const server = createGraaoServer();
const port = 3500 + Math.floor(Math.random() * 300);
const rooms: Room[] = [];
let ping: ReturnType<typeof setInterval> | undefined;
await server.listen(port);
try {
  const options = (name: string) => ({ name, protocol: PROTOCOL_VERSION, client: CLIENT_VERSION, appearance: DEFAULT_APPEARANCE });
  const first = await new Client(`ws://127.0.0.1:${port}`).create(ROOM_NAME, {
    ...options('Metrics A'), visibility: 'private', bots: 8, maxPlayers: 10,
    draftPickMs: 100, draftRevealMs: 20, draftRepickMs: 100,
    skipUfo: true, closeSpawns: true, countdownMs: 0, ultimateChargeMs: 0,
    tormentaOff: true, creepCount: 0, lootSeed: 7,
  });
  rooms.push(first);
  const A = watch(first, 0);
  await until(() => A.welcome, 'first welcome');
  const second = await new Client(`ws://127.0.0.1:${port}`).joinById(first.roomId, options('Metrics B'));
  rooms.push(second);
  const B = watch(second, 1);
  await until(() => B.welcome, 'second welcome');
  for (const room of rooms) room.send(C2S.READY, { r: 1 });
  await until(() => A.state?.players.filter((p) => !p.bot).every((p) => p.ready), 'human readiness');
  first.send(C2S.START_MATCH, {});
  const preparation = await until(() => A.state?.phase === MatchPhase.PREPARATION && A.state, 'real draft completion');
  if (preparation.players.length !== 10 || preparation.players.filter((p) => p.bot).length !== 8) throw new Error('Expected exactly 2 SDK clients + 8 bots.');
  const builds = preparation.players.map((p) => ({
    index: p.index, name: p.name, bot: p.bot, loadout: p.loadout,
    legal: validateLoadout(p.loadout) !== null,
    passives: p.loadout.filter((id) => ABILITIES[id as AbilityId]?.kind === 'passive').length,
  }));
  if (builds.some((build) => !build.legal)) throw new Error('A participant received an illegal draft build.');
  for (const room of rooms) room.send(C2S.PREPARED, { id: preparation.preparation!.id, ok: true });
  await until(() => A.state?.phase === MatchPhase.MATCH && B.state?.phase === MatchPhase.MATCH, 'prepared match');
  const internal = matchMaker.getLocalRoomById(first.roomId) as unknown as InternalRoom;
  const engine = internal.abilities;
  const originalUpdate = engine.update.bind(engine);
  const updateCosts: number[] = [];
  const entities: number[] = [], pending: number[] = [], projectiles: number[] = [];
  // Instance-local instrumentation only; original production source and all game rules stay unchanged.
  engine.update = (now, dt) => {
    const before = performance.now();
    originalUpdate(now, dt);
    if (collecting) {
      updateCosts.push(performance.now() - before);
      entities.push(engine.entities.length); pending.push(engine.pendingCount); projectiles.push(engine.projectileCount);
    }
  };
  internal.perf.peakTickMs = 0;
  const botIndices = new Set(builds.filter((p) => p.bot).map((p) => p.index));
  const initialPositions = [...internal.players.values()].map((p) => ({ index: p.index, pos: { ...p.state.pos } }));
  const sent: { human: number; id: string; atMs: number }[] = [];
  const seq = [0, 0];
  const started = performance.now();
  collecting = true;
  ping = setInterval(() => { for (const room of rooms) room.send(C2S.PING, { c: Date.now() }); }, 250);
  function cast(human: number, slot: number) {
    const seen = human === 0 ? A : B;
    const index = seen.welcome!.index;
    const player = [...internal.players.values()].find((p) => p.index === index)!;
    const id = builds.find((p) => p.index === index)!.loadout[slot]! as AbilityId;
    const def = ABILITIES[id];
    if (def.kind === 'passive') return;
    const up = v3normalize(player.state.pos);
    const eye = { x: player.state.pos.x + up.x * 1.6, y: player.state.pos.y + up.y * 1.6, z: player.state.pos.z + up.z * 1.6 };
    const point = def.targetType === 'point' ? resolveTargetPoint(world.physics, world.terrain, player.state.pos, eye, player.state.facing, Math.min(def.range, 4)) : undefined;
    const tuple = (p: Vec3, scale: number) => [Math.round(p.x * scale), Math.round(p.y * scale), Math.round(p.z * scale)];
    seq[human] = seq[human]! + 1;
    rooms[human]!.send(C2S.ABILITY_REQUEST, { s: seq[human], k: slot, a: id, c: 1,
      ...(def.targetType === 'direction' ? { d: tuple(player.state.facing, 10000) } : {}),
      ...(point ? { p: tuple(point, 1000) } : {}),
    });
    sent.push({ human, id, atMs: round(performance.now() - started, 2) });
  }
  // All mutations below are ordinary client intents. Mana/cooldowns/target validation remain authoritative.
  const schedule = [
    { after: 150, human: 0, slot: 0 }, { after: 600, human: 1, slot: 1 },
    { after: 1100, human: 0, slot: 1 }, { after: 1600, human: 1, slot: 0 },
    { after: 2500, human: 0, slot: 3 }, { after: 3200, human: 1, slot: 3 },
  ];
  let next = 0;
  const botBrainSamples: number[] = [];
  while (performance.now() - started < seconds * 1000) {
    const elapsed = performance.now() - started;
    while (next < schedule.length && elapsed >= schedule[next]!.after) {
      const action = schedule[next++]!; cast(action.human, action.slot);
    }
    botBrainSamples.push(internal.perf.botMs);
    await sleep(25);
  }
  const sampleMs = performance.now() - started;
  collecting = false;
  engine.update = originalUpdate;
  clearInterval(ping); ping = undefined;
  const castEvents = A.events.filter((event): event is Extract<GameEvent, { e: 'cast' }> => event.e === 'cast');
  const count = (values: string[]) => Object.fromEntries([...new Set(values)].sort().map((id) => [id, values.filter((value) => value === id).length]));
  const clientReports = [A, B].map((seen, human) => ({
    human, index: seen.welcome!.index,
    phasesSeen: [...seen.phases].map((phase) => Object.entries(MatchPhase).find(([, value]) => value === phase)?.[0] ?? String(phase)),
    pickedRounds: [...seen.draftRounds],
    traffic: Object.fromEntries([...seen.traffic].map(([type, row]) => [names.get(type), {
      count: row.count, logicalJsonBytes: row.bytes, logicalJsonKiBPerSecond: round(row.bytes / 1024 / (sampleMs / 1000), 3),
      payloadBytes: stats(row.sizes),
    }])),
    allTraffic: { count: [...seen.traffic.values()].reduce((n, row) => n + row.count, 0), logicalJsonBytes: [...seen.traffic.values()].reduce((n, row) => n + row.bytes, 0) },
    pongSmoothedTickMs: stats(seen.ticks),
    abilityResults: seen.results.map((result) => ({ ...result, reason: Object.entries(AbilityReject).find(([, value]) => value === result.r)?.[0] })),
    eventTypes: count(seen.events.map((event) => event.e)),
    privateReveals: { count: seen.reveals.length, byKind: count(seen.reveals.map((reveal) => reveal.kind)), authorizedOnly: seen.reveals.every((reveal) => reveal.by === seen.welcome!.index) },
  }));
  const report = {
    measuredAtUtc: new Date().toISOString(), gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    node: process.version, protocol: PROTOCOL_VERSION, config: { sdkClients: 2, bots: 8, draftPickMs: 100, draftRevealMs: 20, countdownMs: 0, skipUfo: true, tormentaOff: true, creepCount: 0, lootSeed: 7, closeSpawns: true, secondsRequested: seconds },
    durationMs: round(sampleMs, 2), finalPhase: Object.entries(MatchPhase).find(([, value]) => value === A.state?.phase)?.[0],
    builds, initialPositions, humanCastIntents: sent, clients: clientReports,
    abilityUpdateMs: stats(updateCosts), serverPeakTickMs: round(internal.perf.peakTickMs), botBrainSmoothedMs: stats(botBrainSamples),
    activeGameplayObjects: { persistentEntities: stats(entities), pendingCastsAndAreas: stats(pending), projectiles: stats(projectiles) },
    acceptedCasts: { humans: count(castEvents.filter((event) => !botIndices.has(event.by)).map((event) => event.a)), bots: count(castEvents.filter((event) => botIndices.has(event.by)).map((event) => event.a)), botsByIndex: count(castEvents.filter((event) => botIndices.has(event.by)).map((event) => String(event.by))) },
    concurrentUltimates: await concurrentUltimateStress(),
    limits: [
      'Two independent headless SDK clients and eight server bots; no ten-human claim.',
      'UTF-8 JSON.stringify of decoded S2C payloads; excludes MessagePack encoding, WebSocket/TCP/TLS headers and retransmissions.',
      'Sample begins on MATCH after real draft and PREPARED acknowledgements; excludes join/world loading and draft traffic.',
      'PONG tick is the room exponential moving average, not an independent per-tick duration sample. serverPeakTickMs is the actual peak room update during the window.',
      'Ability update uses instance-local timing; observers allocate entity views and add small overhead to this isolated process.',
      'Bot draft/AI use production random behavior. Config is reproducible; exact draft, casts and timings can vary.',
      'Network sample is a short idle-human match, not a sustained combat soak. Synchronized ten-Ultimate stress is a separate engine/Rapier microbenchmark.',
      'No renderer: FPS, GPU frame time, draw calls, VFX particles and LOW/HIGH browser presentation are not measured here.',
      'No Supabase, authentication service or R2 dependency; private loopback test server is disposed after sampling.',
    ],
  };
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ out, durationMs: report.durationMs, finalPhase: report.finalPhase, buildsLegal: builds.every((p) => p.legal), abilityUpdateMs: report.abilityUpdateMs, serverPeakTickMs: report.serverPeakTickMs, acceptedCasts: report.acceptedCasts, concurrentUltimates: report.concurrentUltimates })}\n`);
} finally {
  if (ping) clearInterval(ping);
  await Promise.all(rooms.map((room) => room.leave().catch(() => {})));
  await server.gracefullyShutdown(false).catch(() => {});
}
