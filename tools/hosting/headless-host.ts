/**
 * A Graao Host installation without a window, fed one hosting link by hand (development and browser tests):
 *
 *   pnpm exec tsx tools/hosting/headless-host.ts --link "graao-host://host?t=…&s=…" [--central http://127.0.0.1:54330]
 *     [--tunnel direct|quick] [--data <identity folder>] [--seconds 600]
 *
 * Confirms the pairing automatically (the person running this is the one who asked). Ctrl+C (or --seconds) stops the
 * hosting the same way the app's "Encerrar hospedagem" does: guests are told, the room leaves the list.
 */
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseHostLink } from '@graao/shared';
import { createHeadlessHost } from '../../apps/host/src/main/headless';

const arg = (n: string, d = '') => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1]! : d;
};
const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const link = parseHostLink(arg('link'));
if (!link || link.action !== 'host') throw new Error('--link graao-host://host?t=…&s=… é obrigatório');
const tunnel = arg('tunnel', 'direct') === 'quick' ? 'quick-test' : 'direct-dev';
const host = createHeadlessHost({
  centralUrl: arg('central', 'http://127.0.0.1:54330'),
  dataDir: arg('data', join(tmpdir(), 'graao-headless-host')),
  serverBundle: arg('bundle', join(root, 'apps/host/dist/server/graao-server.mjs')),
  cloudflared: join(root, 'apps/host/resources/bin/cloudflared.exe'),
  tunnel,
  log: (l) => console.log(`[host] ${l}`),
});
host.onState((s) => {
  if (s.pairing) host.confirmPairing(true);
  if (s.phase === 'ERROR') console.log(`[host] ERRO ${s.error?.code}: ${s.error?.message}`);
});
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  console.log('[host] encerrando a hospedagem…');
  await host.stop();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
setTimeout(() => void stop(), Number(arg('seconds', '600')) * 1000);
host.handleLink(link);
