/**
 * Compare the preserved warmup simulation with the competitive lobby on the same running development server.
 * pnpm exec tsx tools/networking/prematch-benchmark.ts --url ws://127.0.0.1:2567 --seconds 8 --output docs/UX/prematch-benchmark.json
 * Private guest rooms only, no READY/START_MATCH, no authentication or persistence. Requires DEV legacyWarmup.
 * JSON payload bytes are an application-level comparison; they exclude MessagePack/WebSocket framing.
 */
import { writeFile } from 'node:fs/promises';
import { Client } from '@colyseus/sdk';
import { DEFAULT_APPEARANCE } from '@graao/game-data';
import { C2S, CLIENT_VERSION, MatchPhase, PROTOCOL_VERSION, ROOM_NAME, S2C, type PongMsg, type RoomStateMsg } from '@graao/shared';

const arg = (name: string, fallback: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
};
const url = arg('url', 'ws://127.0.0.1:2567');
const seconds = Number(arg('seconds', '8'));
if (!Number.isFinite(seconds) || seconds < 2 || seconds > 60) throw new Error('--seconds must be between 2 and 60');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const round = (n: number, decimals = 4) => Number(n.toFixed(decimals));
const phaseName = (phase: number) => Object.entries(MatchPhase).find(([, value]) => value === phase)?.[0] ?? String(phase);

async function sample(legacyWarmup: boolean) {
  const room = await new Client(url).create(ROOM_NAME, {
    protocol: PROTOCOL_VERSION, client: `prematch-benchmark/${CLIENT_VERSION}`, name: 'Benchmark',
    appearance: { ...DEFAULT_APPEARANCE }, visibility: 'private', roomName: 'Private prematch benchmark',
    bots: 9, legacyWarmup,
  });
  let state: RoomStateMsg | undefined;
  let collecting = false;
  const traffic = new Map<number, { count: number; jsonBytes: number }>();
  const ticks: number[] = [];
  for (const type of Object.values(S2C)) {
    room.onMessage(type, (payload: unknown) => {
      if (type === S2C.ROOM_STATE) state = payload as RoomStateMsg;
      if (!collecting) return;
      const entry = traffic.get(type) ?? { count: 0, jsonBytes: 0 };
      entry.count++;
      entry.jsonBytes += Buffer.byteLength(JSON.stringify(payload), 'utf8');
      traffic.set(type, entry);
      if (type === S2C.PONG) ticks.push((payload as PongMsg).tick);
    });
  }
  const ping = setInterval(() => room.send(C2S.PING, { c: Date.now() }), 500);
  try {
    const limit = Date.now() + 5000;
    while (!state && Date.now() < limit) await sleep(10);
    if (!state) throw new Error('No initial room state received');
    const expected = legacyWarmup ? MatchPhase.FREE_ROAM : MatchPhase.LOBBY;
    if (state.phase !== expected) throw new Error(`Expected ${phaseName(expected)}, received ${phaseName(state.phase)}. Use a development server; production ignores legacyWarmup.`);
    await sleep(1000); // Exclude world/room setup and the first message burst from the steady-state sample.
    collecting = true;
    const started = performance.now();
    await sleep(seconds * 1000);
    const sampleMs = performance.now() - started;
    collecting = false;
    const category = (type: number) => {
      const entry = traffic.get(type) ?? { count: 0, jsonBytes: 0 };
      return { ...entry, messagesPerSecond: round(entry.count / (sampleMs / 1000), 2), jsonKiBPerSecond: round(entry.jsonBytes / 1024 / (sampleMs / 1000), 3) };
    };
    const sorted = [...ticks].sort((a, b) => a - b);
    return {
      mode: legacyWarmup ? 'legacyWarmup' : 'strictLobby',
      phase: phaseName(state.phase),
      humans: state.players.filter((p) => !p.bot).length,
      botsInstantiated: state.players.filter((p) => p.bot).length,
      botsPlanned: state.room?.botsPlanned ?? 0,
      rosterSize: state.players.length,
      sampleMs: round(sampleMs, 2),
      snapshots: category(S2C.SNAPSHOT),
      events: category(S2C.EVENTS),
      pongTick: {
        samples: ticks.length,
        meanMs: round(ticks.reduce((sum, n) => sum + n, 0) / Math.max(1, ticks.length)),
        p95Ms: sorted.length ? sorted[Math.floor((sorted.length - 1) * 0.95)]! : null,
        maxMs: sorted.at(-1) ?? null,
      },
      incomingJson: [...traffic.values()].reduce((totals, entry) => ({ count: totals.count + entry.count, jsonBytes: totals.jsonBytes + entry.jsonBytes }), { count: 0, jsonBytes: 0 }),
    };
  } finally {
    clearInterval(ping);
    if (room.connection.isOpen) await room.leave();
  }
}

const health = await fetch(`${url.replace(/^ws/, 'http')}/health`).then((response) => response.json()) as Record<string, unknown>;
const before = await sample(true);
await sleep(500);
const after = await sample(false);
const report = {
  measuredAtUtc: new Date().toISOString(), server: url, clientNode: process.version,
  protocol: PROTOCOL_VERSION, serverVersion: health.version, secondsRequested: seconds,
  warmupMs: 1000, payloadMeasure: 'UTF-8 JSON.stringify of incoming decoded S2C payloads; excludes wire framing',
  before, after,
};
const json = `${JSON.stringify(report, null, 2)}\n`;
if (arg('output', '')) await writeFile(arg('output', ''), json, 'utf8');
process.stdout.write(json);
