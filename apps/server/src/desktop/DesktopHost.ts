/**
 * The match server as the Graao Host app runs it (HOST_MODE=DESKTOP): the same Colyseus server and `GraaoMatchRoom`,
 * listening on 127.0.0.1 only (the public endpoint is a tunnel the app opens to this port), with exactly one room that
 * the app opens and closes through `handle()` — never a client. Every second it reports the room (from the room's own
 * state) and the process's cost (tick time, CPU, memory, event loop delay, socket bytes) to the app.
 */
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { matchMaker } from '@colyseus/core';
import {
  CLIENT_VERSION,
  HOST_CREATE_KEY_OPTION,
  PROTOCOL_VERSION,
  ROOM_NAME,
  SERVER_TICK_MS,
  isRoomCode,
  randomSecret,
  sanitizeHostSettings,
  type AppToServer,
  type HostMetrics,
  type HostRoomSettings,
  type ServerToApp,
} from '@graao/shared';
import { createGraaoServer } from '../app';
import { configureHostPolicy } from '../hostPolicy';
import { log } from '../log';
import type { GraaoMatchRoom } from '../rooms/GraaoMatchRoom';
import { getWorld } from '../world';

const LOOP_RESOLUTION_MS = 20;

/** What guests see when the app stops hosting (the client shows it with "Voltar às salas"). */
export const HOST_CLOSED_TEXT = 'O HOST ENCERROU A PARTIDA';

export interface DesktopHostOptions {
  /** 0 = any free port. */
  port?: number;
  statusMs?: number;
}

export class DesktopHost {
  private readonly http: HttpServer = createServer();
  private readonly server = createGraaoServer({ httpServer: this.http });
  private readonly createKey = randomSecret(32);
  private readonly sockets = new Set<Socket>();
  private closedBytesIn = 0;
  private closedBytesOut = 0;
  /** The histogram includes its own sampling interval (and Windows' coarse timers): only the excess is lag. */
  private readonly loop = monitorEventLoopDelay({ resolution: LOOP_RESOLUTION_MS });
  private statusTimer: ReturnType<typeof setInterval> | undefined;
  private lastCpu = process.cpuUsage();
  private lastCpuAt = performance.now();
  private readonly startedAt = Date.now();
  private roomCode = '';
  private opening = false;
  private stopping: Promise<void> | null = null;
  port = 0;

  constructor(
    private readonly emit: (m: ServerToApp) => void,
    private readonly opts: DesktopHostOptions = {},
  ) {}

  async start(): Promise<number> {
    await configureHostPolicy({ mode: 'DESKTOP', createKey: this.createKey });
    this.http.on('connection', (socket: Socket) => {
      this.sockets.add(socket);
      socket.once('close', () => {
        this.closedBytesIn += socket.bytesRead;
        this.closedBytesOut += socket.bytesWritten;
        this.sockets.delete(socket);
      });
    });
    await getWorld();
    await this.server.listen(this.opts.port ?? 0, '127.0.0.1');
    this.port = (this.http.address() as AddressInfo).port;
    this.loop.enable();
    this.statusTimer = setInterval(() => this.report(), this.opts.statusMs ?? 1000);
    this.emit({ t: 'listening', port: this.port, protocol: PROTOCOL_VERSION, version: CLIENT_VERSION });
    log('desktop host listening', { port: this.port });
    return this.port;
  }

  /** A command from the app (already parsed; shapes are checked again here). */
  async handle(m: AppToServer): Promise<void> {
    if (m.t === 'open') await this.open(m.settings, m.code, m.ownerKeyHash);
    else if (m.t === 'close') await this.close(typeof m.reason === 'string' ? m.reason.slice(0, 120) : HOST_CLOSED_TEXT);
    else if (m.t === 'shutdown') await this.shutdown();
  }

  private room(): GraaoMatchRoom | undefined {
    return this.roomCode ? (matchMaker.getLocalRoomById(this.roomCode) as GraaoMatchRoom | undefined) : undefined;
  }

  private async open(raw: HostRoomSettings, code: string, ownerKeyHash: string): Promise<void> {
    if (this.opening || this.room()) return this.emit({ t: 'open-failed', error: 'room_already_open' });
    if (!isRoomCode(code) || !/^[0-9a-f]{64}$/.test(ownerKeyHash)) return this.emit({ t: 'open-failed', error: 'invalid_open' });
    const s = sanitizeHostSettings(raw);
    this.opening = true;
    try {
      const cache = await matchMaker.createRoom(ROOM_NAME, {
        roomName: s.roomName,
        visibility: s.visibility === 'PRIVATE' ? 'private' : 'public',
        bots: s.bots,
        hostName: s.hostName,
        presetCode: code,
        ownerKeyHash,
        [HOST_CREATE_KEY_OPTION]: this.createKey,
      });
      this.roomCode = cache.roomId;
      this.emit({ t: 'opened', code: cache.roomId });
      this.report();
    } catch (e) {
      this.emit({ t: 'open-failed', error: (e as Error).message || String(e) });
    } finally {
      this.opening = false;
    }
  }

  /** Ends the room for everyone (they are told why); the process keeps running for the next room. Always answers `closed`. */
  async close(reason = HOST_CLOSED_TEXT): Promise<void> {
    const room = this.room();
    const code = this.roomCode;
    this.roomCode = '';
    if (room) await room.closeByHost(reason).catch((e: unknown) => log('close failed', { error: String(e) }));
    this.emit({ t: 'closed', code, reason });
  }

  shutdown(): Promise<void> {
    return (this.stopping ??= (async () => {
      await this.close(HOST_CLOSED_TEXT);
      clearInterval(this.statusTimer);
      this.loop.disable();
      await this.server.gracefullyShutdown(false).catch(() => {});
    })());
  }

  metrics(): HostMetrics {
    const now = performance.now();
    const cpu = process.cpuUsage(this.lastCpu);
    const elapsedMs = Math.max(1, now - this.lastCpuAt);
    this.lastCpu = process.cpuUsage();
    this.lastCpuAt = now;
    let bytesIn = this.closedBytesIn;
    let bytesOut = this.closedBytesOut;
    for (const s of this.sockets) {
      bytesIn += s.bytesRead;
      bytesOut += s.bytesWritten;
    }
    const mem = process.memoryUsage();
    const lag = Math.max(0, this.loop.percentile(99) / 1e6 - LOOP_RESOLUTION_MS);
    this.loop.reset();
    return {
      tickMs: Math.round((this.room()?.tickCostMs ?? 0) * 100) / 100,
      tickBudgetMs: SERVER_TICK_MS,
      heapMB: Math.round(mem.heapUsed / 1048576),
      rssMB: Math.round(mem.rss / 1048576),
      cpuPercent: Math.round(((cpu.user + cpu.system) / 1000 / elapsedMs) * 1000) / 10,
      loopLagMs: Math.round(lag * 10) / 10,
      bytesIn,
      bytesOut,
      connections: this.sockets.size,
      uptimeS: Math.round((Date.now() - this.startedAt) / 1000),
    };
  }

  private report(): void {
    const room = this.room();
    // The room went away on its own (it never should while hosting): tell the app once.
    if (this.roomCode && !room && !this.opening) {
      const code = this.roomCode;
      this.roomCode = '';
      this.emit({ t: 'closed', code, reason: 'disposed' });
    }
    this.emit({ t: 'status', room: room?.hostReport() ?? null, metrics: this.metrics() });
  }
}
