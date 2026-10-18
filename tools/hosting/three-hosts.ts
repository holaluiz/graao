/**
 * TESTE F / E / I on one PC: three independent Graao Host installations (own identity folder, own server process, own
 * tunnel, own room) host three rooms at once, and test players play a match in each through the public endpoint.
 *
 *   pnpm exec tsx tools/hosting/three-hosts.ts [--tunnel quick|direct] [--out docs/hosting/evidence/three-hosts.json]
 *
 * With --tunnel quick each host opens a real Cloudflare Quick Tunnel (wss://<random>.trycloudflare.com): every player
 * connection leaves this PC, crosses Cloudflare and comes back through that host's tunnel. It is still ONE machine and
 * ONE network — the test for players on other networks needs other computers (see GRAAO_HOST_TEST_REPORT.md).
 *
 * Rooms (humans are test clients; bots are the host's): Luiz 3 + 7 bots · Pedro 5 + 5 bots · Ana 10 humans.
 * --plans "1+9,2+8" runs other compositions (one host per item; the stop check needs at least two).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@colyseus/sdk';
import { DEFAULT_APPEARANCE } from '@graao/game-data';
import { C2S, CLIENT_VERSION, PROTOCOL_VERSION, S2C, buildHostLink, createHostCentral, parseHostLink, randomSecret, sha256Hex, type PongMsg } from '@graao/shared';
import { createHeadlessHost, waitPhase } from '../../apps/host/src/main/headless';
import type { HostController } from '../../apps/host/src/main/HostController';
import { startCentralDev } from './central-dev';
import { runGameplaySmoke, type GameplayReport } from './gameplay-smoke';

const arg = (n: string, d: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1]! : d;
};
const tunnel = arg('tunnel', 'quick') === 'direct' ? 'direct-dev' : 'quick-test';
const out = resolve(arg('out', 'docs/hosting/evidence/three-hosts.json'));
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const tmp = mkdtempSync(join(tmpdir(), 'graao-three-hosts-'));
const bundle = join(tmp, 'graao-server.mjs');
const log = (s: string) => console.log(`[três hosts] ${s}`);

execFileSync(process.execPath, ['build-desktop.mjs', bundle], { cwd: join(root, 'apps/server'), stdio: 'ignore' });
const central = await startCentralDev({ tunnelMode: tunnel });
log(`central de desenvolvimento em ${central.url} · túnel: ${tunnel}`);

const OWNERS = ['Luiz', 'Pedro', 'Ana', 'Bia', 'Caio'];
const plans = arg('plans', '3+7,5+5,10+0')
  .split(',')
  .slice(0, OWNERS.length)
  .map((p, i) => {
    const [humans, bots] = p.split('+').map(Number);
    return { owner: OWNERS[i]!, uid: `${'abcde'[i]!.repeat(8)}-1111-4111-8111-00000000000${i}`, humans: humans!, bots: bots! };
  });
const hosts: HostController[] = plans.map((p, i) =>
  createHeadlessHost({ centralUrl: central.url, dataDir: join(tmp, `pc-${i}`), serverBundle: bundle, cloudflared: join(root, 'apps/host/resources/bin/cloudflared.exe'), log: (l) => /fase|túnel|falha|servidor saiu/.test(l) && log(`${p.owner}: ${l}`) }),
);

interface HostResult {
  owner: string;
  code: string;
  endpoint: string;
  readyMs: number;
  pingMs: number[];
  gameplay: GameplayReport | null;
  error?: string;
  peak: { cpuPercent: number; rssMB: number; tickMs: number; loopLagMs: number; bytesOut: number };
}
const results: HostResult[] = [];
const started = Date.now();

try {
  // 1. Each owner asks the site to host; each app confirms the link and opens its room (all three at once).
  await Promise.all(
    plans.map(async (p, i) => {
      const h = hosts[i]!;
      const site = createHostCentral({ url: central.url, key: 'dev', accessToken: async () => `dev.${p.uid}` });
      const secret = randomSecret();
      const t0 = Date.now();
      const { ticketId } = await site.ticketCreate(await sha256Hex(secret), { roomName: `Sala de ${p.owner}`, visibility: 'PUBLIC', bots: p.bots, hostName: p.owner }, PROTOCOL_VERSION);
      h.handleLink(parseHostLink(buildHostLink({ action: 'host', ticket: ticketId, secret }))!);
      await new Promise<void>((r) => {
        const t = setInterval(() => (h.state.pairing || h.state.phase === 'ERROR') && (clearInterval(t), r()), 20);
      });
      h.confirmPairing(true);
      await waitPhase(h, ['READY', 'HOSTING'], 90000);
      const st = await site.ticketStatus(ticketId, secret);
      results[i] = { owner: p.owner, code: st.roomCode, endpoint: st.endpointUrl, readyMs: Date.now() - t0, pingMs: [], gameplay: null, peak: { cpuPercent: 0, rssMB: 0, tickMs: 0, loopLagMs: 0, bytesOut: 0 } };
      log(`${p.owner}: sala ${st.roomCode} pronta em ${Date.now() - t0} ms → ${st.endpointUrl}`);
      // Owner key kept for the match below.
      (results[i] as HostResult & { key?: string }).key = secret;
    }),
  );

  const anon = createHostCentral({ url: central.url, key: 'dev' });
  const listed = await anon.publicRooms();
  log(`lista pública: ${listed.map((r) => `${r.name} (${r.roomCode}, ${r.humanCount}+${r.effectiveBotCount})`).join(' · ')}`);
  if (listed.length !== plans.length) throw new Error(`a lista deveria ter ${plans.length} salas, tem ${listed.length}`);

  // 2. Latency through each endpoint (PING/PONG over the room connection), from a guest that resolved the code.
  for (const r of results) {
    const ep = await anon.roomEndpoint(r.code);
    const room = await new Client(ep!.endpointUrl).joinById(r.code, { protocol: PROTOCOL_VERSION, client: CLIENT_VERSION, name: 'Medidor', appearance: DEFAULT_APPEARANCE });
    for (const t of [S2C.WELCOME, S2C.ROOM_STATE, S2C.SELF, S2C.LOOT_STATE, S2C.NOTICE]) room.onMessage(t, () => {});
    for (let k = 0; k < 10; k++) {
      const rtt = await new Promise<number>((res) => {
        const c = Date.now();
        const off = room.onMessage(S2C.PONG, (m: PongMsg) => m.c === c && (off(), res(Date.now() - c)));
        room.send(C2S.PING, { c });
      });
      r.pingMs.push(rtt);
      await new Promise((res) => setTimeout(res, 100));
    }
    await room.leave(true);
    log(`${r.owner}: ping ${Math.min(...r.pingMs)}–${Math.max(...r.pingMs)} ms (mediana ${[...r.pingMs].sort((a, b) => a - b)[5]} ms)`);
  }

  // 3. A match in every room at the same time, while sampling each host's server.
  const sampler = setInterval(() => {
    hosts.forEach((h, i) => {
      const m = h.state.metrics;
      const p = results[i]?.peak;
      if (!m || !p) return;
      p.cpuPercent = Math.max(p.cpuPercent, m.cpuPercent);
      p.rssMB = Math.max(p.rssMB, m.rssMB);
      p.tickMs = Math.max(p.tickMs, m.tickMs);
      p.loopLagMs = Math.max(p.loopLagMs, m.loopLagMs);
      p.bytesOut = Math.max(p.bytesOut, m.bytesOut);
    });
  }, 500);
  await Promise.all(
    results.map(async (r, i) => {
      try {
        r.gameplay = await runGameplaySmoke({ url: r.endpoint, code: r.code, ownerKey: (r as HostResult & { key: string }).key, guests: plans[i]!.humans - 1, bots: plans[i]!.bots, fightMs: 12000, log: (s) => log(`${r.owner}: ${s}`) });
      } catch (e) {
        r.error = (e as Error).message;
        log(`${r.owner}: FALHOU: ${r.error}`);
      }
    }),
  );
  clearInterval(sampler);

  // 4. The second host stops hosting; the others keep their rooms.
  const stopped = plans[1] ? `Sala de ${plans[1].owner}` : '';
  if (plans[1]) await hosts[1]!.stop();
  const after = await anon.publicRooms();
  log(`depois de encerrar ${stopped || 'nada'}: ${after.map((r) => r.name).join(', ')}`);
  const summary = {
    when: new Date().toISOString(),
    tunnel,
    machine: 'one Windows PC, one network (not separate computers)',
    durationS: Math.round((Date.now() - started) / 1000),
    rooms: results.map((r) => ({ ...r, key: undefined })),
    listedBefore: listed.length,
    listedAfterStop: after.map((r) => r.name),
    ok: results.every((r) => r.gameplay?.ok) && after.length === plans.length - (plans[1] ? 1 : 0) && !after.some((r) => r.name === stopped),
  };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(summary, null, 2));
  log(`resultado: ${summary.ok ? 'OK' : 'FALHOU'} → ${out}`);
  process.exitCode = summary.ok ? 0 : 1;
} finally {
  await Promise.all(hosts.map((h) => h.stop().catch(() => {})));
  await central.close();
  rmSync(tmp, { recursive: true, force: true });
  setTimeout(() => process.exit(), 500).unref();
}
