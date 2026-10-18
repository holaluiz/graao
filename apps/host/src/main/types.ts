/** What the Graao Host window shows (main → renderer) and what the controller needs from its surroundings. */
import type { AppToServer, HostConfig, HostMetrics, HostRoomReport, ServerToApp } from '@graao/shared';

/**
 * The hosting lifecycle. The site knows NOT_INSTALLED (no app answered the link); the app starts IDLE (installed,
 * nothing hosted) and goes PAIRING → STARTING_SERVER → CONNECTING_TUNNEL → REGISTERING_ROOM → READY (listed, nobody
 * in yet) ⇄ HOSTING (people in the room) → STOPPING → OFFLINE (stopped; ready for the next room) — or ERROR.
 */
export type HostPhase =
  | 'IDLE'
  | 'PAIRING'
  | 'STARTING_SERVER'
  | 'CONNECTING_TUNNEL'
  | 'REGISTERING_ROOM'
  | 'READY'
  | 'HOSTING'
  | 'STOPPING'
  | 'OFFLINE'
  | 'ERROR';

export type HostErrorCode =
  | 'server_start'
  | 'server_crashed'
  | 'port_unavailable'
  | 'auth'
  | 'ticket'
  | 'tunnel'
  | 'tunnel_unconfigured'
  | 'version'
  | 'network'
  | 'provisioning'
  | 'conflict'
  | 'busy'
  | 'unknown';

export interface HostError {
  code: HostErrorCode;
  title: string;
  message: string;
  retryable: boolean;
  /** Offer the download page (outdated app). */
  update?: boolean;
}

export type TunnelKind = 'managed' | 'quick-test' | 'direct-dev';

export interface HostUiState {
  phase: HostPhase;
  error: HostError | null;
  /** Waiting for the person at this PC to confirm linking it to the account that asked to host. */
  pairing: { roomName: string; hostDisplayName: string; visibility: 'PUBLIC' | 'PRIVATE'; bots: number } | null;
  room: HostRoomReport | null;
  connection: { tunnel: TunnelKind | null; endpointHost: string; central: 'ok' | 'degraded' | 'down' };
  metrics: (HostMetrics & { appCpuPercent: number; appMemoryMB: number }) | null;
  stability: 'boa' | 'atencao' | 'sobrecarregado' | null;
  linked: boolean;
  app: { version: string; protocol: number; latest: string; required: boolean; downloadUrl: string };
  settings: HostSettings;
  notice: string;
}

export interface HostSettings {
  /** Only when the person turns it on (never by default). */
  launchAtLogin: boolean;
  /** Closing the window while hosting keeps hosting from the tray. */
  minimizeToTray: boolean;
  /** Technical panel (logs, ports, bytes). */
  devPanel: boolean;
}

export const DEFAULT_SETTINGS: HostSettings = { launchAtLogin: false, minimizeToTray: true, devPanel: false };

/** This installation's identity: the central id (after the first link) and a local secret only this PC knows. */
export interface HostIdentity {
  installationId: string | null;
  installSecret: string;
}

export interface IdentityStore {
  load(): HostIdentity;
  save(id: HostIdentity): void;
  /** Forget the link (a new identity on the next hosting). */
  reset(): HostIdentity;
}

export interface ServerHandle {
  send(m: AppToServer): void;
  onMessage(cb: (m: ServerToApp) => void): void;
  onExit(cb: (code: number | null) => void): void;
  kill(): void;
}

export interface TunnelHandle {
  kind: TunnelKind;
  /** Public WebSocket endpoint (wss://host, or ws://127.0.0.1:port for direct-dev). */
  url: string;
  endpointId: string;
  onExit(cb: (reason: string) => void): void;
  stop(): Promise<void>;
}

export interface TunnelFactory {
  start(kind: TunnelKind, localPort: number, grant?: { token: string; hostname: string; endpointId: string }): Promise<TunnelHandle>;
}

export interface Clock {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(h: unknown): void;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
}

export type { HostConfig };
