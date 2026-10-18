/**
 * Drives the real Graao Host Electron app (built with `pnpm --filter @graao/host build`) through a whole hosting:
 * idle → deep link from a second instance (as Windows delivers `graao-host://`) → pairing card → "Vincular e
 * hospedar" → ready → players join → hosting → settings → "Encerrar hospedagem" → offline. Uses the development
 * central service and takes screenshots of each screen.
 *
 *   pnpm exec tsx tools/hosting/app-drive.ts [--tunnel direct|quick] [--shots docs/hosting/screenshots]
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';
import { Client } from '@colyseus/sdk';
import { DEFAULT_APPEARANCE } from '@graao/game-data';
import { CLIENT_VERSION, PROTOCOL_VERSION, S2C, buildHostLink, createHostCentral, randomSecret, sha256Hex } from '@graao/shared';
import { startCentralDev } from './central-dev';

const arg = (n: string, d: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1]! : d;
};
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const appDir = join(root, 'apps/host');
const electronExe = join(appDir, 'node_modules/electron/dist/electron.exe');
const shots = resolve(arg('shots', 'docs/hosting/screenshots'));
const tunnel = arg('tunnel', 'direct');
const userData = mkdtempSync(join(tmpdir(), 'graao-host-app-'));
const log = (s: string) => console.log(`[app] ${s}`);
mkdirSync(shots, { recursive: true });

const central = await startCentralDev({ tunnelMode: tunnel === 'quick' ? 'quick-test' : 'direct-dev' });
const env = { ...process.env, GRAAO_HOST_CENTRAL_URL: central.url, GRAAO_HOST_CENTRAL_KEY: 'dev', GRAAO_HOST_USER_DATA: userData, GRAAO_HOST_TUNNEL: tunnel === 'quick' ? 'quick' : 'direct' } as Record<string, string>;
delete env.ELECTRON_RUN_AS_NODE;

const app = await electron.launch({ executablePath: electronExe, args: [appDir], env, cwd: appDir });
const win = await app.firstWindow();
await win.setViewportSize({ width: 480, height: 760 });
const shot = async (name: string) => {
  await win.waitForTimeout(400);
  await win.screenshot({ path: join(shots, `${name}.png`) });
  log(`captura: ${name}.png`);
};
const text = (sel: string) => win.locator(sel).innerText();
const waitStatus = async (want: string, ms = 60000) => {
  await win.waitForFunction((w) => document.getElementById('status')?.textContent === w, want, { timeout: ms });
};

try {
  await win.waitForSelector('#card h2');
  log(`janela: ${await text('#status')} · ${await text('#card h2')}`);
  // The window cannot reach Node: no require, no process.
  const isolated = await win.evaluate(() => typeof (window as unknown as { require?: unknown }).require === 'undefined' && typeof (window as unknown as { process?: unknown }).process === 'undefined');
  log(`isolamento da janela (sem require/process): ${isolated}`);
  await shot('host-idle');

  // The site creates the ticket; Windows would launch a second instance with the link: do exactly that.
  const uid = 'dddddddd-4444-4444-8444-000000000004';
  const site = createHostCentral({ url: central.url, key: 'dev', accessToken: async () => `dev.${uid}` });
  const secret = randomSecret();
  const { ticketId } = await site.ticketCreate(await sha256Hex(secret), { roomName: 'Sala do Luiz', visibility: 'PUBLIC', bots: 7, hostName: 'Luiz' }, PROTOCOL_VERSION);
  const second = spawn(electronExe, [appDir, buildHostLink({ action: 'host', ticket: ticketId, secret })], { env, stdio: 'ignore' });
  const secondExit = await new Promise<number | null>((r) => second.once('exit', r));
  log(`segunda instância repassou o link e saiu (código ${secondExit})`);

  await win.waitForSelector('text=VINCULAR E HOSPEDAR', { timeout: 15000 });
  await shot('host-pairing');
  await win.click('text=VINCULAR E HOSPEDAR');
  await win.waitForSelector('.steps', { timeout: 10000 }).catch(() => {});
  await shot('host-starting');
  await waitStatus('ONLINE', 90000);
  const status = await site.ticketStatus(ticketId, secret);
  log(`sala ${status.roomCode} publicada em ${status.endpointUrl}`);
  await shot('host-ready');

  const opts = (name: string, extra = {}) => ({ protocol: PROTOCOL_VERSION, client: CLIENT_VERSION, name, appearance: DEFAULT_APPEARANCE, ...extra });
  const owner = await new Client(status.endpointUrl).joinById(status.roomCode, opts('Luiz', { hostKey: secret }));
  const guest = await new Client(status.endpointUrl).joinById(status.roomCode, opts('Pedro'));
  for (const r of [owner, guest]) for (const t of [S2C.WELCOME, S2C.ROOM_STATE, S2C.SELF, S2C.LOOT_STATE, S2C.NOTICE]) r.onMessage(t, () => {});
  await win.waitForFunction(() => document.querySelectorAll('.seats i.human').length === 2, null, { timeout: 10000 });
  log(`participantes: ${await win.locator('.fact strong').first().innerText()}`);
  await shot('host-hosting');

  await win.click('#settings');
  await win.check('input[name="devPanel"]');
  await shot('host-settings');
  await win.click('text=SALVAR');
  await win.waitForTimeout(1500);
  await win.setViewportSize({ width: 480, height: 1100 });
  await shot('host-tech-panel');
  await win.setViewportSize({ width: 480, height: 760 });

  const closed = new Promise<number>((r) => guest.onLeave((c) => r(c)));
  await win.click('#stop');
  await waitStatus('OFFLINE', 20000);
  log(`convidado desconectado (código ${await closed})`);
  log(`lista depois de encerrar: ${(await createHostCentral({ url: central.url, key: 'dev' }).publicRooms()).length} salas`);
  await shot('host-stopped');
} finally {
  await app.close().catch(() => {});
  await central.close();
  rmSync(userData, { recursive: true, force: true });
  setTimeout(() => process.exit(), 300).unref();
}
