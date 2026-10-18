/**
 * The Graao Host lifecycle, independent of Electron (the window, tray and processes are injected), so the same code
 * runs in the app, in the headless runner and in tests.
 *
 * A hosting request arrives as a deep link with a one-time ticket the site created for its signed-in player. The app
 * peeks at the ticket (and asks the person at this PC to confirm when this installation is not linked to that account
 * yet), claims it (the central service returns a session token valid only for this installation and the room code it
 * allocated), starts the match server process, opens the room, opens the public endpoint (tunnel), checks that the
 * endpoint really answers, and only then publishes the room. While hosting it sends a heartbeat with the room's own
 * counts. Every failure stops at ERROR with an explanation and a bounded retry; nothing reconnects forever.
 */
import {
  HOST_HEARTBEAT_MS,
  HostCentralError,
  PROTOCOL_VERSION,
  compareVersions,
  sha256Hex,
  type HostCentral,
  type HostLink,
  type HostMetrics,
  type HostRoomReport,
  type ServerToApp,
  type TicketClaim,
} from '@graao/shared';
import {
  DEFAULT_SETTINGS,
  type Clock,
  type HostError,
  type HostErrorCode,
  type HostPhase,
  type HostSettings,
  type HostUiState,
  type IdentityStore,
  type ServerHandle,
  type TunnelFactory,
  type TunnelHandle,
  type TunnelKind,
} from './types';

export const HOST_CLOSED_TEXT = 'O HOST ENCERROU A PARTIDA';

export interface HostControllerDeps {
  central: HostCentral;
  identity: IdentityStore;
  spawnServer: () => ServerHandle;
  tunnels: TunnelFactory;
  appVersion: string;
  /** Development only: force a tunnel kind (direct-dev, quick-test) whatever the central service says. */
  tunnelOverride?: TunnelKind | null;
  log?: (line: string) => void;
  appMetrics?: () => { cpuPercent: number; memoryMB: number };
  clock?: Clock;
  timeouts?: Partial<{ listenMs: number; openMs: number; stopMs: number }>;
}

const realClock: Clock = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

class StepError extends Error {
  constructor(
    readonly hostError: HostError,
    cause?: unknown,
  ) {
    super(hostError.message, { cause });
  }
}

const ERR = {
  serverStart: (detail: string): HostError => ({ code: 'server_start', title: 'O servidor não iniciou', message: `O servidor da partida não conseguiu iniciar neste PC. ${detail}`, retryable: true }),
  serverCrashed: (detail: string): HostError => ({ code: 'server_crashed', title: 'O servidor parou', message: `O servidor da partida fechou inesperadamente. Os convidados foram desconectados. ${detail}`, retryable: true }),
  tunnel: (detail: string): HostError => ({ code: 'tunnel', title: 'Sem conexão pública', message: `Não foi possível abrir o endereço público da sala (túnel). Confira sua internet. ${detail}`, retryable: true }),
};

/** Central service errors in words for the person at this PC. */
export function describeCentralError(e: unknown): HostError {
  if (e instanceof StepError) return e.hostError;
  if (!(e instanceof HostCentralError)) return { code: 'unknown', title: 'Algo deu errado', message: String((e as Error)?.message ?? e), retryable: true };
  const map: Partial<Record<HostCentralError['code'], [HostErrorCode, string, string, boolean]>> = {
    ticket_not_found: ['ticket', 'Pedido de sala inválido', 'Esse pedido de hospedagem não existe. Crie a sala de novo pelo site do graao.', false],
    ticket_expired: ['ticket', 'Pedido expirado', 'O pedido de hospedagem expirou. Crie a sala de novo pelo site do graao.', false],
    ticket_used: ['ticket', 'Pedido já usado', 'Esse pedido de hospedagem já foi usado. Crie a sala de novo pelo site do graao.', false],
    version_mismatch: ['version', 'Versão diferente', 'O site do graao está numa versão diferente deste Graao Host. Atualize o Graao Host para hospedar.', false],
    installation_conflict: ['conflict', 'PC vinculado a outra conta', 'Este PC já hospeda para outra conta do graao. Para trocar, use "Desvincular este PC" nas configurações.', false],
    installation_revoked: ['auth', 'Autorização removida', 'A autorização deste PC foi removida pela conta. Desvincule este PC nas configurações e vincule de novo.', false],
    installation_secret: ['auth', 'Identidade inválida', 'A identidade guardada deste PC não confere. Use "Desvincular este PC" nas configurações e tente de novo.', false],
    session_invalid: ['auth', 'Sessão expirada', 'A sessão de hospedagem expirou. Crie a sala de novo pelo site.', false],
    tunnel_unconfigured: ['tunnel_unconfigured', 'Conexão pública indisponível', 'O serviço de túneis gerenciados do graao ainda não está configurado no servidor central.', false],
    tunnel_failed: ['provisioning', 'Falha no provisionamento', 'O serviço central não conseguiu preparar o endereço público desta sala.', true],
    endpoint_invalid: ['provisioning', 'Endereço recusado', 'O serviço central recusou o endereço público desta sala.', true],
    rate_limited: ['network', 'Muitas tentativas', 'Muitos pedidos em pouco tempo. Aguarde um minuto e tente de novo.', true],
    unavailable: ['network', 'Serviço central indisponível', 'Não foi possível falar com o serviço central do graao. Confira sua internet.', true],
  };
  const hit = map[e.code];
  if (hit) return { code: hit[0], title: hit[1], message: hit[2], retryable: hit[3], ...(hit[0] === 'version' ? { update: true } : {}) };
  return { code: 'unknown', title: 'Algo deu errado', message: e.message, retryable: true };
}

export class HostController {
  private s: HostUiState;
  private readonly listeners = new Set<(s: HostUiState) => void>();
  private readonly clock: Clock;
  private readonly log: (line: string) => void;
  private run = 0;
  private link: { ticket: string; secret: string } | null = null;
  private claim: TicketClaim | null = null;
  private server: ServerHandle | null = null;
  private serverPort = 0;
  private serverExpectedExit = false;
  private readonly serverWaiters = new Set<(m: ServerToApp) => void>();
  private tunnel: TunnelHandle | null = null;
  private tunnelRestarts = 0;
  private grant: { token: string; hostname: string; endpointId: string } | undefined;
  private heartbeat: unknown = null;
  private centralFailures = 0;
  private published = false;

  constructor(private readonly d: HostControllerDeps) {
    this.clock = d.clock ?? realClock;
    this.log = d.log ?? (() => {});
    const id = d.identity.load();
    this.s = {
      phase: 'IDLE',
      error: null,
      pairing: null,
      room: null,
      connection: { tunnel: null, endpointHost: '', central: 'ok' },
      metrics: null,
      stability: null,
      linked: !!id.installationId,
      app: { version: d.appVersion, protocol: PROTOCOL_VERSION, latest: '', required: false, downloadUrl: '' },
      settings: { ...DEFAULT_SETTINGS },
      notice: '',
    };
  }

  get state(): HostUiState {
    return this.s;
  }

  /** Something is running (a room, or the steps toward one). */
  get busy(): boolean {
    return ['STARTING_SERVER', 'CONNECTING_TUNNEL', 'REGISTERING_ROOM', 'READY', 'HOSTING', 'STOPPING'].includes(this.s.phase);
  }

  get roomCode(): string {
    return this.s.room?.code ?? this.claim?.roomCode ?? '';
  }

  /** The owner key of the current room (the ticket secret), for "Abrir sala no navegador". */
  get ownerKey(): string {
    return this.busy ? (this.link?.secret ?? '') : '';
  }

  onState(cb: (s: HostUiState) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private set(patch: Partial<HostUiState>): void {
    this.s = { ...this.s, ...patch };
    for (const l of this.listeners) l(this.s);
  }

  private phase(p: HostPhase, patch: Partial<HostUiState> = {}): void {
    if (p !== this.s.phase) this.log(`fase: ${this.s.phase} → ${p}`);
    this.set({ phase: p, ...patch });
  }

  setSettings(settings: HostSettings): void {
    this.set({ settings: { ...settings } });
  }

  /** The central config: newest app version, the minimum one, where to download. */
  async refreshConfig(): Promise<void> {
    try {
      const c = await this.d.central.config();
      this.set({
        app: { ...this.s.app, latest: c.latestAppVersion, required: !!c.minAppVersion && compareVersions(this.d.appVersion, c.minAppVersion) < 0, downloadUrl: c.downloadUrl },
        connection: { ...this.s.connection, central: 'ok' },
      });
    } catch (e) {
      this.log(`config indisponível: ${(e as Error).message}`);
      this.set({ connection: { ...this.s.connection, central: 'down' } });
    }
  }

  // ------------------------------------------------------------------------------------------------ requests

  handleLink(link: HostLink): void {
    if (link.action !== 'host') return;
    if (this.busy) {
      this.log('pedido de hospedagem recusado: já existe uma sala ativa');
      if (this.claim) void this.d.central.ticketFail(this.claim.sessionToken, link.ticket, 'host_busy').catch(() => {});
      this.set({ notice: 'Já existe uma sala ativa neste PC. Encerre-a antes de criar outra.' });
      return;
    }
    if (this.s.app.required) {
      this.phase('ERROR', { error: { code: 'version', title: 'Atualização obrigatória', message: 'Esta versão do Graao Host não é mais aceita. Baixe a nova versão para hospedar.', retryable: false, update: true } });
      return;
    }
    this.link = { ticket: link.ticket, secret: link.secret };
    this.claim = null;
    this.published = false;
    void this.pair(++this.run);
  }

  private async pair(run: number): Promise<void> {
    const link = this.link!;
    this.phase('PAIRING', { error: null, pairing: null, notice: '', room: null });
    try {
      const id = this.d.identity.load();
      const peek = await this.d.central.ticketPeek(link.ticket, link.secret, id.installationId);
      if (run !== this.run) return;
      if (peek.conflict) throw new HostCentralError('installation_conflict');
      if (!peek.linked) {
        // First time for this account on this PC: the person here must say yes.
        this.set({ pairing: { roomName: peek.roomName, hostDisplayName: peek.hostDisplayName, visibility: peek.visibility, bots: peek.desiredBots } });
        return;
      }
      await this.claimAndStart(run);
    } catch (e) {
      if (run === this.run) this.fail(describeCentralError(e));
    }
  }

  confirmPairing(accept: boolean): void {
    if (this.s.phase !== 'PAIRING' || !this.s.pairing || !this.link) return;
    const run = this.run;
    if (!accept) {
      const link = this.link;
      this.link = null;
      void this.d.central.ticketCancel(link.ticket, link.secret).catch(() => {});
      this.phase('IDLE', { pairing: null, notice: 'Vinculação cancelada.' });
      return;
    }
    this.set({ pairing: null });
    void this.claimAndStart(run).catch((e: unknown) => run === this.run && this.fail(describeCentralError(e)));
  }

  private async claimAndStart(run: number): Promise<void> {
    const link = this.link!;
    const id = this.d.identity.load();
    const claim = await this.d.central.ticketClaim({ ticketId: link.ticket, secret: link.secret, installationId: id.installationId, installSecret: id.installSecret, appVersion: this.d.appVersion, protocol: PROTOCOL_VERSION });
    if (run !== this.run) return;
    if (id.installationId !== claim.hostId) this.d.identity.save({ installationId: claim.hostId, installSecret: id.installSecret });
    this.claim = claim;
    this.set({ linked: true });
    this.log(`ticket aceito: sala ${claim.roomCode}, túnel ${claim.tunnelMode}`);
    await this.startHosting(run);
  }

  /** Server → room → endpoint → check → publish. Reused by retry() with the same claim. */
  private async startHosting(run: number): Promise<void> {
    const claim = this.claim!;
    const link = this.link!;
    try {
      this.phase('STARTING_SERVER', { error: null, notice: '' });
      await this.ensureServer(run);
      const opened = await this.request({ t: 'open', settings: claim.settings, code: claim.roomCode, ownerKeyHash: await sha256Hex(link.secret) }, (m) => m.t === 'opened' || m.t === 'open-failed', this.d.timeouts?.openMs ?? 10000);
      if (opened.t === 'open-failed' && opened.error !== 'room_already_open') throw new StepError(ERR.serverStart(opened.error));
      if (run !== this.run) return;

      this.phase('CONNECTING_TUNNEL');
      const kind = this.d.tunnelOverride ?? claim.tunnelMode;
      this.grant = kind === 'managed' ? await this.d.central.tunnel(claim.sessionToken, this.serverPort) : undefined;
      if (run !== this.run) return;
      await this.openTunnel(run, kind);

      this.phase('REGISTERING_ROOM');
      const tunnel = this.tunnel!;
      await this.d.central.roomPublish(claim.sessionToken, link.ticket, tunnel.endpointId, tunnel.url, this.s.room ?? this.placeholderReport());
      if (run !== this.run) return;
      this.published = true;
      this.centralFailures = 0;
      this.phase((this.s.room?.humanCount ?? 0) > 0 ? 'HOSTING' : 'READY', { connection: { ...this.s.connection, central: 'ok' } });
      this.startHeartbeat();
    } catch (e) {
      if (run !== this.run) return;
      const err = e instanceof StepError ? e.hostError : describeCentralError(e);
      this.log(`falha ao hospedar: ${err.code}: ${(e as Error).message}`);
      await this.releaseResources(false);
      void this.d.central.ticketFail(claim.sessionToken, link.ticket, err.code).catch(() => {});
      this.fail(err);
    }
  }

  private async openTunnel(run: number, kind: TunnelKind): Promise<void> {
    try {
      const t = await this.d.tunnels.start(kind, this.serverPort, this.grant);
      if (run !== this.run) {
        await t.stop();
        return;
      }
      this.tunnel = t;
      this.set({ connection: { ...this.s.connection, tunnel: kind, endpointHost: t.url.replace(/^wss?:\/\//, '') } });
      t.onExit((reason) => void this.onTunnelLost(run, t, reason));
    } catch (e) {
      throw new StepError(ERR.tunnel((e as Error).message ?? ''), e);
    }
  }

  /** A stable hostname (managed tunnel) comes back on its own a few times; a test tunnel's address would change. */
  private async onTunnelLost(run: number, t: TunnelHandle, reason: string): Promise<void> {
    if (run !== this.run || this.tunnel !== t) return;
    this.tunnel = null;
    this.log(`túnel caiu: ${reason}`);
    if (t.kind === 'managed' && this.tunnelRestarts < 3) {
      this.tunnelRestarts++;
      this.set({ notice: 'Conexão pública instável: reconectando…' });
      await new Promise((r) => this.clock.setTimeout(() => r(null), 2000 * this.tunnelRestarts));
      if (run !== this.run) return;
      try {
        await this.openTunnel(run, 'managed');
        this.set({ notice: '' });
        return;
      } catch (e) {
        this.log(`túnel não voltou: ${(e as Error).message}`);
      }
    }
    if (run !== this.run) return;
    await this.endRoom(ERR.tunnel(reason));
  }

  // ------------------------------------------------------------------------------------------------ server process

  private async ensureServer(run: number): Promise<void> {
    if (this.server && this.serverPort) return;
    this.serverExpectedExit = false;
    const server = this.d.spawnServer();
    this.server = server;
    const exited = new Promise<never>((_, reject) => server.onExit((code) => reject(new StepError(ERR.serverStart(`(código ${code})`)))));
    server.onMessage((m) => this.onServerMessage(server, m));
    server.onExit((code) => this.onServerExit(server, code));
    const listening = this.waitServer((m) => m.t === 'listening', this.d.timeouts?.listenMs ?? 30000);
    const m = (await Promise.race([listening, exited])) as Extract<ServerToApp, { t: 'listening' }>;
    if (run !== this.run) return;
    if (m.protocol !== PROTOCOL_VERSION) throw new StepError(ERR.serverStart('Versão interna incompatível.'));
    this.serverPort = m.port;
    this.log(`servidor ouvindo em 127.0.0.1:${m.port}`);
  }

  private onServerMessage(server: ServerHandle, m: ServerToApp): void {
    if (server !== this.server) return;
    for (const w of [...this.serverWaiters]) w(m);
    if (m.t === 'status') this.onStatus(m.room, m.metrics);
    else if (m.t === 'fatal') this.log(`servidor: erro fatal: ${m.error.split('\n')[0]}`);
    else if (m.t === 'closed' && m.reason === 'disposed' && (this.s.phase === 'READY' || this.s.phase === 'HOSTING')) void this.endRoom(ERR.serverCrashed('A sala foi descartada.'));
  }

  private onServerExit(server: ServerHandle, code: number | null): void {
    if (server !== this.server) return;
    this.server = null;
    this.serverPort = 0;
    if (this.serverExpectedExit) return;
    this.log(`servidor saiu (código ${code})`);
    if (this.s.phase === 'READY' || this.s.phase === 'HOSTING') void this.endRoom(ERR.serverCrashed(`(código ${code})`));
  }

  private waitServer(pred: (m: ServerToApp) => boolean, ms: number): Promise<ServerToApp> {
    return new Promise((resolve, reject) => {
      const timer = this.clock.setTimeout(() => {
        this.serverWaiters.delete(w);
        reject(new StepError(ERR.serverStart('O servidor não respondeu a tempo.')));
      }, ms);
      const w = (m: ServerToApp) => {
        if (!pred(m)) return;
        this.clock.clearTimeout(timer);
        this.serverWaiters.delete(w);
        resolve(m);
      };
      this.serverWaiters.add(w);
    });
  }

  private request<T extends ServerToApp>(cmd: Parameters<ServerHandle['send']>[0], pred: (m: ServerToApp) => boolean, ms: number): Promise<T> {
    const reply = this.waitServer(pred, ms) as Promise<T>;
    this.server?.send(cmd);
    return reply;
  }

  private onStatus(room: HostRoomReport | null, metrics: HostMetrics): void {
    const app = this.d.appMetrics?.() ?? { cpuPercent: 0, memoryMB: 0 };
    const load = metrics.tickBudgetMs ? metrics.tickMs / metrics.tickBudgetMs : 0;
    const stability = load > 0.8 || metrics.loopLagMs > 100 ? 'sobrecarregado' : load > 0.5 || metrics.loopLagMs > 40 ? 'atencao' : 'boa';
    const patch: Partial<HostUiState> = { room, metrics: { ...metrics, appCpuPercent: app.cpuPercent, appMemoryMB: app.memoryMB }, stability };
    if (this.s.phase === 'READY' && room && room.humanCount > 0) this.phase('HOSTING', patch);
    else if (this.s.phase === 'HOSTING' && room && room.humanCount === 0) this.phase('READY', patch);
    else this.set(patch);
  }

  private placeholderReport(): HostRoomReport {
    const c = this.claim!;
    return { code: c.roomCode, name: c.settings.roomName, visibility: c.settings.visibility, status: 'LOBBY', humanCount: 0, desiredBotCount: c.settings.bots, effectiveBotCount: c.settings.bots, maxParticipants: 10, available: true, hostPresent: false, players: [] };
  }

  // ------------------------------------------------------------------------------------------------ heartbeat

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeat = this.clock.setInterval(() => void this.beat(), HOST_HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) this.clock.clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private async beat(): Promise<void> {
    const claim = this.claim;
    if (!claim || !this.published) return;
    const run = this.run;
    try {
      const r = await this.d.central.heartbeat(claim.sessionToken, this.s.phase === 'HOSTING' ? 'HOSTING' : 'ONLINE', this.s.room);
      if (run !== this.run) return;
      this.centralFailures = 0;
      if (this.s.connection.central !== 'ok') this.set({ connection: { ...this.s.connection, central: 'ok' }, notice: '' });
      if (r.revoked) await this.endRoom({ code: 'auth', title: 'Autorização removida', message: 'A conta removeu a autorização deste PC. A sala foi encerrada.', retryable: false });
      else if (r.roomClosed) await this.stop('A sala foi encerrada pelo serviço central.');
    } catch (e) {
      if (run !== this.run) return;
      if (e instanceof HostCentralError && (e.code === 'session_invalid' || e.code === 'installation_revoked')) {
        await this.endRoom(describeCentralError(e));
        return;
      }
      this.centralFailures++;
      // The match keeps running (players are connected through the tunnel); only the public list loses the room.
      const down = this.centralFailures >= 3;
      this.set({ connection: { ...this.s.connection, central: down ? 'down' : 'degraded' }, notice: down ? 'Sem contato com o serviço central: a partida continua, mas a sala pode sumir da lista.' : '' });
      this.log(`heartbeat falhou (${this.centralFailures}): ${(e as Error).message}`);
    }
  }

  // ------------------------------------------------------------------------------------------------ stop / errors

  /** "Encerrar hospedagem" (or quitting the app): guests are told, everything is released, the room leaves the list. */
  async stop(reason = HOST_CLOSED_TEXT): Promise<void> {
    const claim = this.claim;
    ++this.run;
    if (this.s.phase !== 'IDLE' && this.s.phase !== 'OFFLINE') this.phase('STOPPING', { pairing: null });
    await this.releaseResources(true, reason);
    if (claim) {
      await this.d.central.roomClose(claim.sessionToken, reason).catch(() => {});
      await this.d.central.sessionEnd(claim.sessionToken).catch(() => {});
    }
    this.claim = null;
    this.link = null;
    this.published = false;
    this.phase('OFFLINE', { room: null, metrics: null, stability: null, error: null, pairing: null, connection: { ...this.s.connection, tunnel: null, endpointHost: '' } });
  }

  /** The room ended on its own (crash, tunnel gone, revoked): release, delist, explain. */
  private async endRoom(err: HostError): Promise<void> {
    const claim = this.claim;
    ++this.run;
    await this.releaseResources(true, HOST_CLOSED_TEXT);
    if (claim) await this.d.central.roomClose(claim.sessionToken, err.code).catch(() => {});
    this.published = false;
    this.fail(err);
  }

  private async releaseResources(closeRoom: boolean, reason = HOST_CLOSED_TEXT): Promise<void> {
    this.stopHeartbeat();
    const server = this.server;
    const tunnel = this.tunnel;
    this.tunnel = null;
    this.tunnelRestarts = 0;
    if (server && closeRoom && this.serverPort) {
      await this.request({ t: 'close', reason }, (m) => m.t === 'closed', this.d.timeouts?.stopMs ?? 5000).catch(() => {});
    }
    await tunnel?.stop().catch(() => {});
    if (server) {
      this.serverExpectedExit = true;
      const gone = new Promise<void>((resolve) => {
        server.onExit(() => resolve());
        this.clock.setTimeout(() => {
          server.kill();
          resolve();
        }, this.d.timeouts?.stopMs ?? 5000);
      });
      server.send({ t: 'shutdown' });
      await gone;
      if (this.server === server) {
        this.server = null;
        this.serverPort = 0;
      }
    }
  }

  private fail(err: HostError): void {
    this.phase('ERROR', { error: err, pairing: null, room: null, metrics: null, stability: null, connection: { ...this.s.connection, tunnel: null, endpointHost: '' } });
  }

  /** ERROR → try again from the last step that can be redone (same claim), or from the ticket. */
  retry(): void {
    if (this.s.phase !== 'ERROR' || !this.s.error?.retryable) return;
    const run = ++this.run;
    if (this.claim && this.link) void this.startHosting(run);
    else if (this.link) void this.pair(run);
  }

  /** Leave the error screen (ends the session the failed attempt held). */
  async dismiss(): Promise<void> {
    if (this.s.phase !== 'ERROR') return;
    const claim = this.claim;
    ++this.run;
    this.claim = null;
    this.link = null;
    if (claim) await this.d.central.sessionEnd(claim.sessionToken).catch(() => {});
    this.phase('IDLE', { error: null });
  }

  /** "Desvincular este PC": forget this installation's identity (the next hosting links it again). */
  unlink(): void {
    if (this.busy) return;
    this.d.identity.reset();
    this.set({ linked: false, notice: 'Este PC foi desvinculado. A próxima sala pede confirmação de novo.' });
  }

  clearNotice(): void {
    if (this.s.notice) this.set({ notice: '' });
  }
}
