/**
 * Graao Host without a window: the same `HostController`, with the match server in a Node child process and the
 * identity in a plain folder. For automated tests and multi-installation checks on one machine (each instance has its
 * own folder = its own installation identity). Not shipped.
 */
import { createHostCentral } from '@graao/shared';
import { HostController } from './HostController';
import { forkServer } from './serverProcess';
import { createIdentityStore } from './store';
import { createTunnelFactory } from './tunnel';
import type { TunnelKind } from './types';

export interface HeadlessHostOptions {
  centralUrl: string;
  centralKey?: string;
  dataDir: string;
  serverBundle: string;
  tunnel?: TunnelKind | null;
  cloudflared?: string;
  appVersion?: string;
  log?: (line: string) => void;
}

export function createHeadlessHost(o: HeadlessHostOptions): HostController {
  const log = o.log ?? (() => {});
  return new HostController({
    central: createHostCentral({ url: o.centralUrl, key: o.centralKey ?? 'dev-publishable' }),
    identity: createIdentityStore(o.dataDir),
    spawnServer: () => forkServer(o.serverBundle, log),
    tunnels: createTunnelFactory({ cloudflaredPath: o.cloudflared ?? 'cloudflared', log }),
    appVersion: o.appVersion ?? '0.1.0',
    tunnelOverride: o.tunnel ?? null,
    log,
  });
}

/** Resolves when the controller reaches one of `phases` (rejects on ERROR unless it is wanted, or on timeout). */
export function waitPhase(c: HostController, phases: string[], ms = 60000): Promise<void> {
  return new Promise((resolve, reject) => {
    const check = () => {
      if (phases.includes(c.state.phase)) return done(resolve);
      if (c.state.phase === 'ERROR') return done(() => reject(new Error(`ERROR: ${c.state.error?.code}: ${c.state.error?.message}`)));
    };
    const timer = setTimeout(() => done(() => reject(new Error(`timeout waiting for ${phases.join('|')} (now ${c.state.phase})`))), ms);
    const off = c.onState(check);
    function done(f: () => void) {
      clearTimeout(timer);
      off();
      f();
    }
    check();
  });
}
