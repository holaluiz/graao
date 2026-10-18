/**
 * The public endpoint of a room: a Cloudflare Tunnel opened by the bundled `cloudflared` connector (outbound only: no
 * router setup, no open port, the host's IP stays hidden). Three kinds:
 *
 * - managed: the central service provisioned a named tunnel with a stable hostname and handed over a connector token
 *   (passed to cloudflared through the environment, never on the command line, never written to disk);
 * - quick-test: a `trycloudflare.com` Quick Tunnel with a random hostname — for tests only (no uptime guarantee, 200
 *   in-flight requests);
 * - direct-dev: no tunnel, `ws://127.0.0.1:<port>` (local development and automated tests only).
 *
 * A tunnel counts as open only after the room server answers `/health` through the public address.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { Resolver } from 'node:dns/promises';
import type { TunnelFactory, TunnelHandle, TunnelKind } from './types';

export interface TunnelOptions {
  cloudflaredPath: string;
  log: (line: string) => void;
  /** How long the public address may take to answer (ms). */
  readyTimeoutMs?: number;
  fetch?: typeof fetch;
}

const QUICK_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
const REGISTERED = /Registered tunnel connection|Connection [0-9a-f-]+ registered/i;

export function createTunnelFactory(o: TunnelOptions): TunnelFactory {
  return {
    async start(kind: TunnelKind, port: number, grant?: { token: string; hostname: string; endpointId: string }): Promise<TunnelHandle> {
      if (kind === 'direct-dev') return direct(port);
      if (kind === 'quick-test') return cloudflared(o, 'quick-test', ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], {}, null);
      if (!grant?.token || !grant.hostname) throw new Error('sem credencial do túnel gerenciado');
      return cloudflared(o, 'managed', ['tunnel', '--no-autoupdate', 'run'], { TUNNEL_TOKEN: grant.token }, grant);
    },
  };
}

function direct(port: number): TunnelHandle {
  return { kind: 'direct-dev', url: `ws://127.0.0.1:${port}`, endpointId: `local-${port}`, onExit: () => {}, stop: async () => {} };
}

async function cloudflared(o: TunnelOptions, kind: TunnelKind, args: string[], env: Record<string, string>, grant: { hostname: string; endpointId: string } | null): Promise<TunnelHandle> {
  const child: ChildProcess = spawn(o.cloudflaredPath, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const tail: string[] = [];
  const exitCbs: ((reason: string) => void)[] = [];
  let stopping = false;
  let hostname = grant?.hostname ?? '';
  let registered = false;
  let onProgress: () => void = () => {};

  const onLine = (line: string) => {
    if (!line.trim()) return;
    tail.push(line);
    if (tail.length > 20) tail.shift();
    o.log(`cloudflared: ${line.replace(/eyJ[A-Za-z0-9_-]{20,}/g, '«token»')}`);
    const m = QUICK_URL.exec(line);
    if (m && !hostname) hostname = new URL(m[0]).hostname;
    if (REGISTERED.test(line)) registered = true;
    onProgress();
  };
  let buf = '';
  const feed = (d: Buffer) => {
    buf += d.toString();
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? '';
    lines.forEach(onLine);
  };
  child.stdout?.on('data', feed);
  child.stderr?.on('data', feed);

  const exited = new Promise<string>((resolve) => {
    child.once('error', (e) => resolve(`cloudflared não iniciou: ${e.message}`));
    child.once('exit', (code) => resolve(`cloudflared saiu (código ${code}): ${tail.slice(-3).join(' | ')}`));
  });
  void exited.then((reason) => {
    if (!stopping) for (const cb of exitCbs) cb(reason);
  });

  const stop = async () => {
    if (stopping) return;
    stopping = true;
    if (child.exitCode === null) {
      child.kill();
      await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
    }
  };

  try {
    // Wait for the address and the first registered connection, then for the room to answer through it.
    const deadline = Date.now() + (o.readyTimeoutMs ?? 45000);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('o túnel não se registrou a tempo')), Math.max(1000, deadline - Date.now()));
      onProgress = () => {
        if (hostname && registered) {
          clearTimeout(timer);
          resolve();
        }
      };
      onProgress();
      void exited.then((reason) => {
        clearTimeout(timer);
        reject(new Error(reason));
      });
    });
    await waitForDns(hostname, Math.min(deadline, Date.now() + 15000));
    await waitHealthy(`https://${hostname}/health`, deadline, o.fetch ?? fetch, () => child.exitCode !== null);
  } catch (e) {
    await stop();
    throw e;
  }

  return {
    kind,
    url: `wss://${hostname}`,
    endpointId: grant?.endpointId ?? hostname.split('.')[0]!,
    onExit: (cb) => void exitCbs.push(cb),
    stop,
  };
}

/**
 * A brand-new hostname may not exist for a moment after the tunnel registers. Asking the system resolver too early
 * gets an NXDOMAIN that Windows keeps in its negative cache for minutes, so the public resolvers are asked first
 * (directly, no OS cache). Networks that block outside DNS just skip this after the deadline.
 */
export async function waitForDns(hostname: string, deadline: number): Promise<void> {
  const r = new Resolver({ timeout: 2000, tries: 1 });
  r.setServers(['1.1.1.1', '8.8.8.8']);
  while (Date.now() < deadline) {
    try {
      if ((await r.resolve4(hostname)).length) return;
    } catch {
      /* not there yet */
    }
    await new Promise((res) => setTimeout(res, 500));
  }
}

/** The room server's `/health` through the public address (new hostnames can take a few seconds to resolve). */
export async function waitHealthy(url: string, deadline: number, doFetch: typeof fetch, gone: () => boolean): Promise<void> {
  let last = '';
  while (Date.now() < deadline && !gone()) {
    try {
      const r = await doFetch(url, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      if (r.ok) {
        const h = (await r.json()) as { ok?: unknown; mode?: unknown };
        if (h.ok === true && h.mode === 'DESKTOP') return;
        last = 'resposta inesperada';
      } else last = `HTTP ${r.status}`;
    } catch (e) {
      last = (e as Error).message;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`o endereço público não respondeu (${last || 'tempo esgotado'})`);
}
