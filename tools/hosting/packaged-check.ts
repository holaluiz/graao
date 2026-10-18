/**
 * Checks a packaged Graao Host (security fuses on, server in app.asar.unpacked, bundled cloudflared) against the
 * development central service, then simulates the host PC vanishing (process tree killed, as on a power cut).
 *
 *   pnpm exec tsx tools/hosting/packaged-check.ts --exe "apps/host/release/win-unpacked/Graao Host.exe" [--via argv|protocol] [--tunnel direct|quick]
 *
 * --via protocol: the app is started first (with the development environment), then the hosting link is opened through
 * Windows (`start graao-host://…`), exactly as a browser does: this needs the installed app (protocol registered).
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@colyseus/sdk';
import { DEFAULT_APPEARANCE } from '@graao/game-data';
import { CLIENT_VERSION, PROTOCOL_VERSION, S2C, buildHostLink, createHostCentral, randomSecret, sha256Hex } from '@graao/shared';
import { startCentralDev } from './central-dev';

const arg = (n: string, d: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1]! : d;
};
const exe = resolve(arg('exe', 'apps/host/release/win-unpacked/Graao Host.exe'));
const via = arg('via', 'argv');
const tunnel = arg('tunnel', 'direct');
const log = (s: string) => console.log(`[empacotado] ${s}`);
// The single-instance lock belongs to the data folder: a link opened by Windows reaches the running app only when both
// use the app's real folder, so the protocol check uses it (and removes what it wrote, if the folder was not there).
const realData = join(process.env.APPDATA ?? '', 'Graao Host');
const ownsRealData = via === 'protocol' && !existsSync(realData);
if (via === 'protocol' && !ownsRealData) throw new Error(`${realData} já existe: feche/limpe o Graao Host instalado antes deste teste`);
const userData = via === 'protocol' ? realData : mkdtempSync(join(tmpdir(), 'graao-host-pkg-'));
mkdirSync(userData, { recursive: true });
const central = await startCentralDev({ tunnelMode: tunnel === 'quick' ? 'quick-test' : 'direct-dev' });
const env = { ...process.env, GRAAO_HOST_CENTRAL_URL: central.url, GRAAO_HOST_CENTRAL_KEY: 'dev', GRAAO_HOST_TUNNEL: tunnel, ...(via === 'protocol' ? {} : { GRAAO_HOST_USER_DATA: userData }) } as Record<string, string>;
delete env.ELECTRON_RUN_AS_NODE;

const uid = 'eeeeeeee-5555-4555-8555-000000000005';
const site = createHostCentral({ url: central.url, key: 'dev', accessToken: async () => `dev.${uid}` });
const anon = createHostCentral({ url: central.url, key: 'dev' });
// This check cannot click "Vincular": link this installation beforehand (as a first hosting would) and hand the app
// that identity (a plain identity file; the app encrypts it with the OS key on its next save).
{
  const s = randomSecret();
  const t = await site.ticketCreate(await sha256Hex(s), { roomName: 'vínculo', visibility: 'PRIVATE', bots: 0, hostName: 'Luiz' }, PROTOCOL_VERSION);
  const installSecret = randomSecret();
  const claim = await anon.ticketClaim({ ticketId: t.ticketId, secret: s, installationId: null, installSecret, appVersion: '0.1.0', protocol: PROTOCOL_VERSION });
  await anon.sessionEnd(claim.sessionToken);
  writeFileSync(join(userData, 'identity.json'), JSON.stringify({ installationId: claim.hostId, enc: 'plain', secret: installSecret }));
}
const secret = randomSecret();
const { ticketId } = await site.ticketCreate(await sha256Hex(secret), { roomName: 'Sala empacotada', visibility: 'PUBLIC', bots: 4, hostName: 'Luiz' }, PROTOCOL_VERSION);
const link = buildHostLink({ action: 'host', ticket: ticketId, secret });
const t0 = Date.now();
let app;
if (via === 'protocol') {
  app = spawn(exe, [], { env, stdio: 'ignore', detached: false });
  await new Promise((r) => setTimeout(r, 4000));
  // What a browser does with a graao-host:// link: ask Windows to open it with the registered app.
  execFileSync('powershell.exe', ['-NoProfile', '-Command', `Start-Process '${link}'`], { env: { ...process.env, GRAAO_HOST_CENTRAL_URL: '' } });
  log('link aberto pelo Windows (protocolo registrado)');
} else {
  app = spawn(exe, [link], { env, stdio: 'ignore' });
}

const until = async <T>(f: () => Promise<T | null | false>, ms: number, what: string): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await f().catch(() => null);
    if (v) return v;
    if (Date.now() > end) throw new Error(`tempo esgotado: ${what}`);
    await new Promise((r) => setTimeout(r, 300));
  }
};

try {
  // A fresh installation asks for confirmation; this check cannot click, so the identity is pre-linked below.
  const status = await until(async () => {
    const s = await site.ticketStatus(ticketId, secret);
    if (s.status === 'FAILED') throw new Error(`falhou: ${s.error}`);
    return s.status === 'READY' ? s : null;
  }, 90000, 'sala pronta (o app pede confirmação de vínculo na primeira vez: confirme na janela)');
  log(`sala ${status.roomCode} pronta em ${Date.now() - t0} ms → ${status.endpointUrl}`);

  const opts = (name: string, extra = {}) => ({ protocol: PROTOCOL_VERSION, client: CLIENT_VERSION, name, appearance: DEFAULT_APPEARANCE, ...extra });
  const owner = await new Client(status.endpointUrl).joinById(status.roomCode, opts('Luiz', { hostKey: secret }));
  const guest = await new Client(status.endpointUrl).joinById(status.roomCode, opts('Pedro'));
  for (const r of [owner, guest]) for (const t of [S2C.WELCOME, S2C.ROOM_STATE, S2C.SELF, S2C.LOOT_STATE, S2C.NOTICE]) r.onMessage(t, () => {});
  const listed = await until(async () => (await anon.publicRooms()).find((r) => r.roomCode === status.roomCode && r.humanCount === 2) ?? null, 15000, 'contagem na lista');
  log(`na lista: ${listed.name} · ${listed.humanCount} humanos + ${listed.effectiveBotCount} bots`);

  // The host PC "loses power": every process of the app dies at once (no goodbye to anyone).
  const dropped = new Promise<string>((r) => {
    guest.onDrop(() => r('drop'));
    guest.onLeave((c) => r(`leave ${c}`));
  });
  const killedAt = Date.now();
  execFileSync('taskkill', ['/F', '/T', '/PID', String(app.pid)], { stdio: 'ignore' });
  log(`processos do app encerrados à força; convidado: ${await dropped} após ${Date.now() - killedAt} ms`);
  await until(async () => !(await anon.publicRooms()).some((r) => r.roomCode === status.roomCode), 45000, 'sala sair da lista');
  log(`sala removida da lista ${Math.round((Date.now() - killedAt) / 1000)} s depois (limite: 30 s sem heartbeat)`);
  log(`endpoint resolvido depois: ${JSON.stringify(await anon.roomEndpoint(status.roomCode))}`);
  log('OK');
} finally {
  try {
    execFileSync('taskkill', ['/F', '/T', '/IM', 'Graao Host.exe'], { stdio: 'ignore' });
  } catch {
    /* already gone */
  }
  await central.close();
  await new Promise((r) => setTimeout(r, 1500));
  if (via !== 'protocol' || ownsRealData) rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  setTimeout(() => process.exit(), 300).unref();
}
