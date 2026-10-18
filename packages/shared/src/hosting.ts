/**
 * Graao Host: community hosting from a player's own PC. The Graao Host desktop app runs the same match server
 * (`HOST_MODE=DESKTOP`); friends join from the browser through the host's public endpoint. Shared here by the site,
 * the app and the server:
 *
 * - the public room and host registration models (what the central service lists),
 * - the `graao-host://` deep link the site opens to wake the app (one-time ticket, never a lasting credential),
 * - the control messages between the app and its server process (IPC, never exposed on the public port),
 * - the central service API (Supabase RPCs, or the local development central with the same shape).
 *
 * See docs/hosting/GRAAO_HOST_ARCHITECTURE.md.
 */
import { MAX_PLAYERS, MAX_SOLO_BOTS, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, ROOM_CODE_PREFIX } from './constants';
import { MatchPhase, type RoomListing } from './protocol';
import { sanitizeName } from './validate';
import { PROTOCOL_VERSION } from './version';

/** Custom URL protocol registered by the installer. */
export const HOST_LINK_SCHEME = 'graao-host';
/** Bump on a breaking change between the site, the app and the central functions (independent of the game protocol). */
export const HOST_API_VERSION = 1;
/** The app reports at this period; the list hides a room whose host went quiet for `HOST_STALE_S`. */
export const HOST_HEARTBEAT_MS = 5000;
export const HOST_STALE_S = 30;
/** A hosting ticket must be claimed by the app within this time. */
export const HOST_TICKET_TTL_S = 300;

export type HostInstallStatus = 'OFFLINE' | 'STARTING' | 'ONLINE' | 'HOSTING' | 'STOPPING' | 'ERROR';
export type PublicRoomStatus = 'LOBBY' | 'DRAFT' | 'DEPLOYMENT' | 'MATCH' | 'RESULTS' | 'CLOSED';
export type HostVisibility = 'PUBLIC' | 'PRIVATE';

/** One authorized installation of the app (what the central service knows; never paths, IPs or secrets). */
export interface GraaoHostRegistration {
  hostId: string;
  ownerPlayerId: string;
  appVersion: string;
  protocolVersion: number;
  status: HostInstallStatus;
  activeRoomId?: string;
  lastHeartbeatAt: number;
  revoked?: boolean;
}

/** One line of the public room list for a room running on someone's Graao Host. */
export interface GraaoPublicRoom {
  roomId: string;
  roomCode: string;
  name: string;
  hostId: string;
  /** Opaque per-owner id (not the account id). */
  hostPlayerId: string;
  hostDisplayName: string;
  maxParticipants: 10;
  humanCount: number;
  desiredBotCount: number;
  effectiveBotCount: number;
  visibility: HostVisibility;
  status: PublicRoomStatus;
  /** The room accepts new players right now (lobby, free human seat, fresh heartbeat). */
  available: boolean;
  endpointId: string;
  protocolVersion: number;
  createdAt: number;
  lastHeartbeatAt: number;
}

export function roomStatusOf(phase: MatchPhase): PublicRoomStatus {
  switch (phase) {
    case MatchPhase.ABILITY_DRAFT:
      return 'DRAFT';
    case MatchPhase.PREPARATION:
    case MatchPhase.UFO:
      return 'DEPLOYMENT';
    case MatchPhase.MATCH:
      return 'MATCH';
    case MatchPhase.RESULTS:
      return 'RESULTS';
    case MatchPhase.CLOSED:
      return 'CLOSED';
    default:
      return 'LOBBY';
  }
}

const PHASE_OF_STATUS: Record<PublicRoomStatus, MatchPhase> = {
  LOBBY: MatchPhase.LOBBY,
  DRAFT: MatchPhase.ABILITY_DRAFT,
  DEPLOYMENT: MatchPhase.UFO,
  MATCH: MatchPhase.MATCH,
  RESULTS: MatchPhase.RESULTS,
  CLOSED: MatchPhase.CLOSED,
};

const ROOM_CODE_RE = new RegExp(`^${ROOM_CODE_PREFIX}[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);
const STATUSES = new Set<string>(Object.keys(PHASE_OF_STATUS));
const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);
const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\p{Cc}/gu, '').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const time = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) || 0 : 0);

export function isRoomCode(v: unknown): v is string {
  return typeof v === 'string' && ROOM_CODE_RE.test(v);
}

/** A row of the central list (snake_case from SQL, or camelCase), from an untrusted source: counts must add up. */
export function parsePublicRoom(raw: unknown): GraaoPublicRoom | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const pick = (camel: string, snake: string) => (o[camel] ?? o[snake]) as unknown;
  const code = text(pick('roomCode', 'room_code'), 16).toUpperCase();
  const humans = pick('humanCount', 'human_count');
  const desired = pick('desiredBotCount', 'desired_bot_count');
  const effective = pick('effectiveBotCount', 'effective_bot_count');
  const status = pick('status', 'status');
  const protocol = pick('protocolVersion', 'protocol');
  if (!isRoomCode(code) || !isInt(humans) || !isInt(desired) || !isInt(effective) || !isInt(protocol)) return null;
  if (humans < 0 || humans > MAX_PLAYERS || desired < 0 || desired > MAX_SOLO_BOTS || effective < 0 || effective > MAX_SOLO_BOTS) return null;
  if (humans + effective > MAX_PLAYERS || typeof status !== 'string' || !STATUSES.has(status) || status === 'CLOSED') return null;
  const visibility = pick('visibility', 'visibility') === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC';
  return {
    roomId: text(pick('roomId', 'room_id'), 64),
    roomCode: code,
    name: text(pick('name', 'name'), 56) || `Sala ${code}`,
    hostId: text(pick('hostId', 'host_id'), 64),
    hostPlayerId: text(pick('hostPlayerId', 'host_player_id'), 64),
    hostDisplayName: sanitizeName(pick('hostDisplayName', 'host_display_name')) ?? 'Host',
    maxParticipants: MAX_PLAYERS,
    humanCount: humans,
    desiredBotCount: desired,
    effectiveBotCount: effective,
    visibility,
    status: status as PublicRoomStatus,
    available: pick('available', 'available') === true && status === 'LOBBY' && humans < MAX_PLAYERS && protocol === PROTOCOL_VERSION,
    endpointId: text(pick('endpointId', 'endpoint_id'), 80),
    protocolVersion: protocol,
    createdAt: time(pick('createdAt', 'created_at')),
    lastHeartbeatAt: time(pick('lastHeartbeatAt', 'last_heartbeat_at')),
  };
}

/** The room browser's line for a Graao Host room (the same columns as every other source). */
export function publicRoomToListing(room: GraaoPublicRoom): RoomListing {
  return {
    code: room.roomCode,
    name: room.name,
    visibility: room.visibility === 'PRIVATE' ? 'private' : 'public',
    hostSessionId: room.hostId || room.roomCode,
    hostName: room.hostDisplayName,
    humans: room.humanCount,
    botsDesired: room.desiredBotCount,
    botsPlanned: room.effectiveBotCount,
    capacity: room.maxParticipants,
    protocol: room.protocolVersion,
    phase: PHASE_OF_STATUS[room.status],
    available: room.available,
    canStart: false,
    startReason: '',
    via: 'graao-host',
  };
}

// ------------------------------------------------------------------------------------------------ room settings

export interface HostRoomSettings {
  roomName: string;
  visibility: HostVisibility;
  bots: number;
  hostName: string;
}

export function sanitizeHostSettings(raw: Partial<Record<keyof HostRoomSettings, unknown>>): HostRoomSettings {
  const bots = isInt(raw.bots) ? Math.max(0, Math.min(MAX_SOLO_BOTS, raw.bots)) : 0;
  const hostName = sanitizeName(raw.hostName) ?? 'Host';
  return {
    roomName: text(raw.roomName, 56) || `Sala de ${hostName}`,
    visibility: raw.visibility === 'PRIVATE' || raw.visibility === 'private' ? 'PRIVATE' : 'PUBLIC',
    bots,
    hostName,
  };
}

// ------------------------------------------------------------------------------------------------ deep link

/**
 * `graao-host://host?t=<ticket id>&s=<ticket secret>` asks the app to host the room described by that ticket; the
 * secret is single use, expires in minutes and only lets the app claim that one ticket. `graao-host://open` just
 * brings the app forward. The link never names a server: the app talks only to its own configured central service.
 */
export type HostLink = { action: 'host'; ticket: string; secret: string } | { action: 'open' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET_RE = /^[A-Za-z0-9_-]{32,128}$/;

export function buildHostLink(link: HostLink): string {
  if (link.action === 'open') return `${HOST_LINK_SCHEME}://open`;
  return `${HOST_LINK_SCHEME}://host?t=${encodeURIComponent(link.ticket)}&s=${encodeURIComponent(link.secret)}`;
}

export function parseHostLink(raw: unknown): HostLink | null {
  if (typeof raw !== 'string' || raw.length > 512) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== `${HOST_LINK_SCHEME}:`) return null;
  // `graao-host://host?...` parses with "host" as the hostname; `graao-host:host?...` as the pathname.
  const action = (url.hostname || url.pathname.replace(/^\/+/, '')).replace(/\/+$/, '').toLowerCase();
  if (action === 'open') return { action: 'open' };
  if (action !== 'host') return null;
  const ticket = url.searchParams.get('t') ?? '';
  const secret = url.searchParams.get('s') ?? '';
  if (!UUID_RE.test(ticket) || !SECRET_RE.test(secret)) return null;
  return { action: 'host', ticket: ticket.toLowerCase(), secret };
}

// ------------------------------------------------------------------------------------------------ app ↔ server

/** What the server reports about its one room. */
export interface HostRoomReport {
  code: string;
  name: string;
  visibility: HostVisibility;
  status: PublicRoomStatus;
  humanCount: number;
  desiredBotCount: number;
  effectiveBotCount: number;
  maxParticipants: number;
  available: boolean;
  /** The owner's browser is in the room (host controls available). */
  hostPresent: boolean;
  players: { name: string; bot: boolean; connected: boolean; host: boolean }[];
}

export interface HostMetrics {
  /** Average simulation tick cost (ms) and the target tick period. */
  tickMs: number;
  tickBudgetMs: number;
  heapMB: number;
  rssMB: number;
  /** Server process CPU over the last report period (% of one core). */
  cpuPercent: number;
  /** Event loop delay p99 over the last period (ms). */
  loopLagMs: number;
  bytesIn: number;
  bytesOut: number;
  connections: number;
  uptimeS: number;
}

export type AppToServer =
  | { t: 'open'; settings: HostRoomSettings; code: string; ownerKeyHash: string }
  | { t: 'close'; reason: string }
  | { t: 'shutdown' };

export type ServerToApp =
  | { t: 'listening'; port: number; protocol: number; version: string }
  | { t: 'opened'; code: string }
  | { t: 'open-failed'; error: string }
  | { t: 'status'; room: HostRoomReport | null; metrics: HostMetrics }
  | { t: 'closed'; code: string; reason: string }
  | { t: 'fatal'; error: string };

/** Room create option that only the server process itself can supply (see apps/server/src/hostPolicy.ts). */
export const HOST_CREATE_KEY_OPTION = '__graaoHostCreateKey';

// ------------------------------------------------------------------------------------------------ central API

/** Error codes raised by the central functions (`graao_host:<code>`) or by the transport. */
export type HostCentralErrorCode =
  | 'unauthenticated'
  | 'invalid'
  | 'rate_limited'
  | 'ticket_not_found'
  | 'ticket_expired'
  | 'ticket_used'
  | 'version_mismatch'
  | 'installation_conflict'
  | 'installation_revoked'
  | 'installation_secret'
  | 'session_invalid'
  | 'room_not_found'
  | 'endpoint_invalid'
  | 'tunnel_unconfigured'
  | 'tunnel_failed'
  | 'unavailable'
  | 'unknown';

export class HostCentralError extends Error {
  constructor(
    readonly code: HostCentralErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'HostCentralError';
  }
}

export interface HostCentralOptions {
  /** Supabase project URL (or the development central): RPCs live at `<url>/rest/v1/rpc/<fn>`. */
  url: string;
  /** Publishable key (browser-safe). Never a service-role key. */
  key: string;
  /** The caller's Supabase access token (the site's signed-in or anonymous player), when the call needs one. */
  accessToken?: () => Promise<string | null>;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface HostConfig {
  tunnelMode: 'managed' | 'quick-test' | 'direct-dev';
  latestAppVersion: string;
  minAppVersion: string;
  downloadUrl: string;
  apiVersion: number;
}

export interface TicketPeek {
  roomName: string;
  visibility: HostVisibility;
  desiredBots: number;
  hostDisplayName: string;
  protocol: number;
  /** This installation already belongs to the ticket's owner. */
  linked: boolean;
  /** This installation belongs to another account (it cannot be taken over). */
  conflict: boolean;
}

export interface TicketClaim {
  hostId: string;
  sessionToken: string;
  sessionExpiresAt: number;
  roomCode: string;
  settings: HostRoomSettings;
  tunnelMode: HostConfig['tunnelMode'];
}

export type TicketState = 'PENDING' | 'CLAIMED' | 'READY' | 'FAILED' | 'EXPIRED' | 'CANCELLED';

export interface TicketStatus {
  status: TicketState;
  error: string;
  roomCode: string;
  endpointUrl: string;
}

export interface RoomEndpoint {
  roomCode: string;
  endpointUrl: string;
  protocol: number;
  status: PublicRoomStatus;
  available: boolean;
}

export interface TunnelGrant {
  hostname: string;
  endpointId: string;
  token: string;
}

/** Only `wss://host[:port]` (or `ws://` to a loopback address, development central only). */
export function isEndpointUrl(v: unknown, allowLoopbackWs = false): v is string {
  if (typeof v !== 'string' || v.length > 200) return false;
  if (/^wss:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/.test(v)) return true;
  return allowLoopbackWs && /^ws:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?$/.test(v);
}

/** The central service client (RPCs with JSON named arguments; every function returns JSON). */
export function createHostCentral(o: HostCentralOptions) {
  const base = o.url.replace(/\/+$/, '');
  const doFetch = o.fetch ?? fetch;

  async function rpc<T>(fn: string, args: Record<string, unknown>, auth = false): Promise<T> {
    const headers: Record<string, string> = { apikey: o.key, 'Content-Type': 'application/json' };
    if (auth) {
      const token = await o.accessToken?.();
      if (!token) throw new HostCentralError('unauthenticated', 'Entre no graao para hospedar.');
      headers.Authorization = `Bearer ${token}`;
    }
    let res: Response;
    try {
      res = await doFetch(`${base}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args), signal: AbortSignal.timeout(o.timeoutMs ?? 10000) });
    } catch (e) {
      throw new HostCentralError('unavailable', `Serviço central inacessível: ${(e as Error).message}`);
    }
    const body = await res.text();
    if (!res.ok) {
      let message = body.slice(0, 300);
      try {
        message = String((JSON.parse(body) as { message?: unknown }).message ?? message);
      } catch {
        /* not JSON */
      }
      const m = /graao_host:([a-z_]+)/.exec(message);
      if (m) throw new HostCentralError(m[1] as HostCentralErrorCode, message);
      // PostgREST: the function does not exist yet (migration not applied).
      if (res.status === 404 || /PGRST202|Could not find the function/.test(message)) throw new HostCentralError('unavailable', 'Serviço de hospedagem ainda não configurado no servidor central.');
      if (res.status === 401 || res.status === 403) throw new HostCentralError('unauthenticated', message);
      throw new HostCentralError('unknown', `${res.status}: ${message}`);
    }
    return (body ? JSON.parse(body) : null) as T;
  }

  const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);
  const str = (v: unknown) => (typeof v === 'string' ? v : '');

  return {
    async config(): Promise<HostConfig> {
      const r = await rpc<Record<string, unknown>>('host_config', {});
      const mode = r.tunnel_mode;
      return {
        tunnelMode: mode === 'managed' || mode === 'direct-dev' ? mode : 'quick-test',
        latestAppVersion: str(r.latest_app_version),
        minAppVersion: str(r.min_app_version),
        downloadUrl: str(r.download_url),
        apiVersion: num(r.api_version),
      };
    },

    /** Site (signed-in or anonymous player): a one-time hosting ticket for this room. */
    async ticketCreate(secretHash: string, s: HostRoomSettings, protocol: number): Promise<{ ticketId: string; expiresAt: number }> {
      const r = await rpc<Record<string, unknown>>(
        'host_ticket_create',
        { p_secret_hash: secretHash, p_room_name: s.roomName, p_visibility: s.visibility, p_bots: s.bots, p_protocol: protocol, p_display_name: s.hostName },
        true,
      );
      return { ticketId: str(r.ticket_id), expiresAt: time(r.expires_at) };
    },

    async ticketStatus(ticketId: string, secret: string): Promise<TicketStatus> {
      const r = await rpc<Record<string, unknown>>('host_ticket_status', { p_ticket: ticketId, p_secret: secret });
      return { status: str(r.status) as TicketState, error: str(r.error), roomCode: str(r.room_code), endpointUrl: str(r.endpoint_url) };
    },

    async ticketCancel(ticketId: string, secret: string): Promise<void> {
      await rpc('host_ticket_cancel', { p_ticket: ticketId, p_secret: secret });
    },

    /** App: what the ticket asks for, and whether this installation may take it. */
    async ticketPeek(ticketId: string, secret: string, installationId: string | null): Promise<TicketPeek> {
      const r = await rpc<Record<string, unknown>>('host_ticket_peek', { p_ticket: ticketId, p_secret: secret, p_installation: installationId });
      return {
        roomName: str(r.room_name),
        visibility: r.visibility === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC',
        desiredBots: num(r.desired_bots),
        hostDisplayName: str(r.host_display_name),
        protocol: num(r.protocol),
        linked: r.linked === true,
        conflict: r.conflict === true,
      };
    },

    async ticketClaim(a: { ticketId: string; secret: string; installationId: string | null; installSecret: string; appVersion: string; protocol: number }): Promise<TicketClaim> {
      const r = await rpc<Record<string, unknown>>('host_ticket_claim', {
        p_ticket: a.ticketId,
        p_secret: a.secret,
        p_installation: a.installationId,
        p_install_secret: a.installSecret,
        p_app_version: a.appVersion,
        p_protocol: a.protocol,
      });
      // A version mismatch is recorded on the ticket (the site shows it) and answered, not raised.
      if (typeof r.error === 'string') throw new HostCentralError(r.error === 'version_mismatch' ? 'version_mismatch' : 'unknown', r.error);
      const mode = r.tunnel_mode;
      return {
        hostId: str(r.host_id),
        sessionToken: str(r.session_token),
        sessionExpiresAt: time(r.session_expires_at),
        roomCode: str(r.room_code),
        settings: sanitizeHostSettings({ roomName: r.room_name, visibility: r.visibility, bots: num(r.desired_bots), hostName: r.host_display_name }),
        tunnelMode: mode === 'managed' || mode === 'direct-dev' ? mode : 'quick-test',
      };
    },

    async ticketFail(session: string, ticketId: string, error: string): Promise<void> {
      await rpc('host_ticket_fail', { p_session: session, p_ticket: ticketId, p_error: error.slice(0, 200) });
    },

    /** App: the room is reachable through its public endpoint; list it (and hand the endpoint to the ticket's owner). */
    async roomPublish(session: string, ticketId: string, endpointId: string, endpointUrl: string, room: HostRoomReport): Promise<{ roomId: string }> {
      const r = await rpc<Record<string, unknown>>('host_room_publish', { p_session: session, p_ticket: ticketId, p_endpoint_id: endpointId, p_endpoint_url: endpointUrl, p_room: reportJson(room) });
      return { roomId: str(r.room_id) };
    },

    async heartbeat(session: string, status: HostInstallStatus, room: HostRoomReport | null): Promise<{ revoked: boolean; roomClosed: boolean }> {
      const r = await rpc<Record<string, unknown>>('host_heartbeat', { p_session: session, p_status: status, p_room: room ? reportJson(room) : null });
      return { revoked: r.revoked === true, roomClosed: r.room_closed === true };
    },

    async roomClose(session: string, reason: string): Promise<void> {
      await rpc('host_room_close', { p_session: session, p_reason: reason.slice(0, 120) });
    },

    async sessionEnd(session: string): Promise<void> {
      await rpc('host_session_end', { p_session: session });
    },

    async publicRooms(): Promise<GraaoPublicRoom[]> {
      const r = await rpc<unknown[]>('host_public_rooms', {});
      return (Array.isArray(r) ? r : []).flatMap((x) => parsePublicRoom(x) ?? []);
    },

    async roomEndpoint(code: string): Promise<RoomEndpoint | null> {
      const r = await rpc<Record<string, unknown> | null>('host_room_endpoint', { p_code: code.toUpperCase() });
      if (!r || !r.endpoint_url) return null;
      return { roomCode: str(r.room_code), endpointUrl: str(r.endpoint_url), protocol: num(r.protocol), status: str(r.status) as PublicRoomStatus, available: r.available === true };
    },

    async myInstallations(): Promise<GraaoHostRegistration[]> {
      const r = await rpc<Record<string, unknown>[]>('host_my_installations', {}, true);
      return (Array.isArray(r) ? r : []).map((x) => ({
        hostId: str(x.host_id),
        ownerPlayerId: str(x.owner_id),
        appVersion: str(x.app_version),
        protocolVersion: num(x.protocol),
        status: str(x.status) as HostInstallStatus,
        activeRoomId: str(x.active_room_id) || undefined,
        lastHeartbeatAt: time(x.last_heartbeat_at),
        revoked: x.revoked === true,
      }));
    },

    async revoke(hostId: string): Promise<void> {
      await rpc('host_revoke', { p_host: hostId }, true);
    },

    /** App, managed tunnels: a connector token for this installation's stable hostname (Edge Function). */
    async tunnel(session: string, localPort: number): Promise<TunnelGrant> {
      let res: Response;
      try {
        res = await doFetch(`${base}/functions/v1/graao-host-tunnel`, {
          method: 'POST',
          headers: { apikey: o.key, Authorization: `Bearer ${o.key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ session, port: localPort }),
          signal: AbortSignal.timeout(o.timeoutMs ?? 20000),
        });
      } catch (e) {
        throw new HostCentralError('unavailable', `Serviço de túnel inacessível: ${(e as Error).message}`);
      }
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        const code = str(body.error);
        throw new HostCentralError(code === 'tunnel_unconfigured' || code === 'session_invalid' ? code : 'tunnel_failed', str(body.message) || `túnel: HTTP ${res.status}`);
      }
      return { hostname: str(body.hostname), endpointId: str(body.endpoint_id), token: str(body.token) };
    },
  };
}

export type HostCentral = ReturnType<typeof createHostCentral>;

function reportJson(r: HostRoomReport): Record<string, unknown> {
  return {
    status: r.status,
    human_count: r.humanCount,
    desired_bot_count: r.desiredBotCount,
    effective_bot_count: r.effectiveBotCount,
    available: r.available,
  };
}

/** SHA-256 hex (Web Crypto: browser, Node and Electron). */
export async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** URL-safe random secret (Web Crypto). */
export function randomSecret(bytes = 32): string {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  let s = '';
  for (const b of a) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Semantic version comparison ("0.2.10" > "0.2.9"); unparseable parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}
