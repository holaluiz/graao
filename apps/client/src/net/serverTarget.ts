/**
 * Which match server this tab talks to, and whether it is reachable before the player clicks anything.
 *
 * - The official server of a build is `VITE_SERVER_URL` (set in the host, e.g. Vercel, for production builds).
 *   Without it the page's own host on port 2567 is assumed (local development, LAN tests with `pnpm dev`).
 * - `?server=ws://host:port` points a tab at another server: any ws/wss in development; in production builds only
 *   `wss://` (a hosted https page cannot open plain sockets). A tab pointed at a non-official server never sends the
 *   player's Supabase token there: the player joins as a guest, so a shared link cannot harvest sign-ins.
 */
import { PROTOCOL_VERSION } from '@graao/shared';

export interface ServerTarget {
  /** WebSocket URL for the Colyseus client. */
  url: string;
  /** The build's own server (may receive the player's identity token). */
  official: boolean;
}

const WS_URL = /^wss?:\/\/[\w.-]+(:\d+)?\/?$/;

export function officialServerUrl(env: { VITE_SERVER_URL?: string } = import.meta.env, loc: Pick<Location, 'protocol' | 'hostname'> = location): string {
  const v = env.VITE_SERVER_URL?.trim();
  if (v) return v.replace(/\/+$/, '');
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.hostname}:2567`;
}

export function serverTarget(search = location.search, dev = import.meta.env.DEV, official = officialServerUrl()): ServerTarget {
  const q = new URLSearchParams(search).get('server')?.trim().replace(/\/+$/, '');
  if (q && WS_URL.test(q) && (dev || q.startsWith('wss://')) && q !== official) return { url: q, official: false };
  return { url: official, official: true };
}

/** HTTP base of a ws(s) URL (Colyseus serves its routes, including `/health`, on the same port). */
export function httpBase(wsUrl: string): string {
  return wsUrl.replace(/^ws/, 'http');
}

export type ServerStatus =
  | { kind: 'online'; players: number; rooms: number }
  | { kind: 'version'; server: number }
  | { kind: 'offline' };

/** Asks the server's `/health` (a few seconds at most). Never throws. */
export async function probeServer(target: ServerTarget, timeoutMs = 4000): Promise<ServerStatus> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${httpBase(target.url)}/health`, { cache: 'no-store', signal: ctl.signal });
    if (!res.ok) return { kind: 'offline' };
    const h = (await res.json()) as { protocol?: unknown; players?: unknown; rooms?: unknown };
    if (typeof h.protocol === 'number' && h.protocol !== PROTOCOL_VERSION) return { kind: 'version', server: h.protocol };
    return { kind: 'online', players: Number(h.players) || 0, rooms: Number(h.rooms) || 0 };
  } catch {
    return { kind: 'offline' };
  } finally {
    clearTimeout(timer);
  }
}
