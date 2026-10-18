/**
 * Entry point of the match server inside the Graao Host app (bundled to `graao-server.mjs`). Talks to the app over the
 * process channel only: Electron's `utilityProcess` (`process.parentPort`) or a Node child (`process.send`, used by the
 * headless runner and tests). Nothing administrative is reachable from the network.
 *
 * Standalone (no parent, for packaging checks): `node graao-server.mjs [--port 2580] [--bots 3] [--name "Sala"]`
 * opens one room and prints its code and owner key; Ctrl+C closes it.
 */
import { randomSecret, sha256Hex, type AppToServer, type HostRoomSettings, type ServerToApp } from '@graao/shared';
import { DesktopHost } from './DesktopHost';

interface Channel {
  send(m: ServerToApp): void;
  onMessage(cb: (m: unknown) => void): void;
  onParentGone(cb: () => void): void;
}

interface ParentPort {
  postMessage(m: unknown): void;
  on(event: 'message', cb: (e: { data: unknown }) => void): void;
}

function channel(): Channel | null {
  const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort;
  if (parentPort) {
    // Electron ends utility processes together with the app.
    return { send: (m) => parentPort.postMessage(m), onMessage: (cb) => parentPort.on('message', (e) => cb(e.data)), onParentGone: () => {} };
  }
  if (process.send) {
    return { send: (m) => process.send!(m), onMessage: (cb) => process.on('message', cb), onParentGone: (cb) => process.on('disconnect', cb) };
  }
  return null;
}

/** Commands come from our own app, but their shape is still checked before use. */
function parseCommand(m: unknown): AppToServer | null {
  if (!m || typeof m !== 'object') return null;
  const o = m as Record<string, unknown>;
  if (o.t === 'shutdown') return { t: 'shutdown' };
  if (o.t === 'close') return { t: 'close', reason: typeof o.reason === 'string' ? o.reason : '' };
  if (o.t === 'open' && o.settings && typeof o.settings === 'object' && typeof o.code === 'string' && typeof o.ownerKeyHash === 'string') {
    // The settings are sanitized again by the host.
    return { t: 'open', settings: o.settings as HostRoomSettings, code: o.code, ownerKeyHash: o.ownerKeyHash };
  }
  return null;
}

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

async function main(): Promise<void> {
  const ch = channel();
  const emit = ch ? ch.send : (m: ServerToApp) => m.t !== 'status' && console.log(JSON.stringify(m));
  const host = new DesktopHost(emit, { port: Number(arg('port') ?? 0) || 0 });
  let exiting = false;
  const exit = async (code: number) => {
    if (exiting) return;
    exiting = true;
    await host.shutdown().catch(() => {});
    process.exit(code);
  };
  process.on('uncaughtException', (e) => {
    emit({ t: 'fatal', error: e?.stack ?? String(e) });
    void exit(1);
  });
  process.on('unhandledRejection', (e) => emit({ t: 'fatal', error: String((e as Error)?.stack ?? e) }));
  process.on('SIGTERM', () => void exit(0));
  process.on('SIGINT', () => void exit(0));

  await host.start();
  if (ch) {
    ch.onParentGone(() => void exit(0));
    ch.onMessage((raw) => {
      const m = parseCommand(raw);
      if (!m) return;
      if (m.t === 'shutdown') void exit(0);
      else void host.handle(m);
    });
    return;
  }
  // Standalone packaging check.
  const ownerKey = randomSecret(32);
  const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const code = `GR-${Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')}`;
  await host.handle({ t: 'open', code, ownerKeyHash: await sha256Hex(ownerKey), settings: { roomName: arg('name') ?? 'Sala de teste', visibility: 'PUBLIC', bots: Number(arg('bots') ?? 0) || 0, hostName: 'Host' } });
  console.log(JSON.stringify({ standalone: true, url: `ws://127.0.0.1:${host.port}`, code, ownerKey }));
}

void main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
