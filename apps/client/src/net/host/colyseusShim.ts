/**
 * Just enough of `@colyseus/core` for `GraaoMatchRoom` to run in the host's browser (a Web Worker): the room is the
 * server's own code, unchanged; only its runtime is this module. The client build swaps `@colyseus/core` for it when
 * the import comes from `apps/server` (see vite.config.ts); tests do the same with `vi.mock`.
 *
 * It mirrors the Colyseus behaviour the room relies on: `onAuth` → `onJoin` (a throw refuses the seat), the seat limit
 * (`maxClients`, seats held for reconnection included), a consented leave (`onLeave`) versus a drop (`onDrop`, then
 * `onReconnect` if `allowReconnection` saw the player back in time, else `onLeave`), one simulation interval, the `*`
 * handler, and disposal once nobody is left. Metadata goes to the host page, which announces public rooms (see
 * `roomDirectory.ts`). Not mirrored: the per-client message rate limit and state sync.
 */

export class ServerError extends Error {
  constructor(
    readonly code: number = 500,
    message?: string,
  ) {
    super(message);
    this.name = 'ServerError';
  }
}

export interface Client {
  readonly sessionId: string;
  auth?: unknown;
  send(type: number | string, message?: unknown): void;
}

export interface AuthContext {
  token?: string;
}

/** Where the room's messages go: the host driver hands them to the main thread (local player and peers). */
export interface RoomOutput {
  /** One message for these sessions (a broadcast is one call, so it is encoded once). */
  send(to: string[], type: number, message: unknown): void;
}

type Handler = (client: Client, message: unknown) => void;
type AnyHandler = (client: Client, type: number | string, message: unknown) => void;

interface PendingReconnection {
  client: Client;
  promise: Promise<Client>;
  resolve(c: Client): void;
  timer: ReturnType<typeof setTimeout>;
}

/** The lifecycle hooks a room overrides (all optional, like Colyseus). */
interface RoomHooks {
  onCreate?(options: unknown): void | Promise<void>;
  onAuth?(client: Client, options: unknown, context: AuthContext): unknown;
  onJoin?(client: Client, options: unknown): void | Promise<void>;
  onLeave?(client: Client, code?: number): void | Promise<void>;
  onDrop?(client: Client, code?: number): void | Promise<void>;
  onReconnect?(client: Client): void | Promise<void>;
  onDispose?(): void | Promise<void>;
}

export const CloseCode = { CONSENTED: 4000, DROPPED: 4001 } as const;

export class Room {
  roomId = '';
  maxClients = Infinity;
  maxMessagesPerSecond = Infinity;
  patchRate: number | null = null;
  metadata: Record<string, unknown> = {};
  /** Set by the host driver before `onCreate`. */
  output: RoomOutput = { send: () => {} };
  /** Called once the room has disposed itself (nobody left). */
  onDisposed: () => void = () => {};

  // True private fields (#): a room subclass may declare fields with any name without clobbering these.
  readonly #handlers = new Map<number | string, Handler>();
  #anyHandler: AnyHandler | null = null;
  readonly #members = new Map<string, Client>();
  readonly #reconnections = new Map<string, PendingReconnection>();
  #simTimer: ReturnType<typeof setInterval> | undefined;
  #disposed = false;
  #private = false;

  get #hooks(): RoomHooks {
    return this as unknown as RoomHooks;
  }

  // ---------------------------------------------------------------------------------------------- API used by rooms

  onMessage(type: number | string, handler: Handler | AnyHandler): void {
    if (type === '*') this.#anyHandler = handler as AnyHandler;
    else this.#handlers.set(type, handler as Handler);
  }

  broadcast(type: number, message: unknown, options: { except?: Client | Client[] } = {}): void {
    const except = options.except === undefined ? [] : Array.isArray(options.except) ? options.except : [options.except];
    const to: string[] = [];
    for (const [id, c] of this.#members) if (!except.includes(c)) to.push(id);
    if (to.length) this.output.send(to, type, message);
  }

  setSimulationInterval(callback: (dt: number) => void, ms = 1000 / 60): void {
    if (this.#simTimer !== undefined) clearInterval(this.#simTimer);
    let last = performance.now();
    this.#simTimer = setInterval(() => {
      const now = performance.now();
      try {
        callback(now - last);
      } catch (e) {
        console.error('[graao host] simulation error', e);
      }
      last = now;
    }, ms);
  }

  async setPrivate(v = true): Promise<void> {
    this.#private = v;
  }

  async setMetadata(metadata: Record<string, unknown>): Promise<void> {
    this.metadata = { ...metadata };
    this.onMetadata(this.metadata);
  }

  async disconnect(): Promise<void> {
    await this._dispose();
  }

  get isPrivate(): boolean {
    return this.#private;
  }

  /** The dropped player keeps their seat for `seconds`; resolves with their new connection, rejects on timeout. */
  allowReconnection(previous: Client, seconds: number): Promise<Client> {
    if (this.#disposed) return Promise.reject(new Error('disposing'));
    const held = this.#reconnections.get(previous.sessionId);
    if (held) return held.promise;
    let resolve!: (c: Client) => void;
    let reject!: (e: Error) => void;
    const promise = new Promise<Client>((res, rej) => ((resolve = res), (reject = rej)));
    const timer = setTimeout(() => {
      if (!this.#reconnections.delete(previous.sessionId)) return;
      reject(new Error('reconnection timed out'));
      void this.#afterDropTimeout(previous);
    }, Math.max(0, seconds) * 1000);
    this.#reconnections.set(previous.sessionId, { client: previous, promise, resolve, timer });
    return promise;
  }

  // ---------------------------------------------------------------------------------------------- host driver

  /** Sessions with a live connection or a seat held for reconnection. */
  get seatsTaken(): number {
    return this.#members.size + this.#reconnections.size;
  }

  async _create(options: unknown): Promise<void> {
    await this.#hooks.onCreate?.(options);
  }

  /** Auth then join; throws (ServerError) when the room refuses the seat. */
  async _join(client: Client, options: unknown, context: AuthContext = {}): Promise<void> {
    if (this.#disposed) throw new ServerError(4212, 'room is gone');
    if (this.seatsTaken >= this.maxClients) throw new ServerError(4212, 'room is full');
    client.auth = (await this.#hooks.onAuth?.(client, options, context)) ?? true;
    if (this.seatsTaken >= this.maxClients) throw new ServerError(4212, 'room is full');
    this.#members.set(client.sessionId, client);
    try {
      await this.#hooks.onJoin?.(client, options);
    } catch (e) {
      this.#members.delete(client.sessionId);
      throw e;
    }
  }

  _message(sessionId: string, type: number | string, message: unknown): void {
    const client = this.#members.get(sessionId);
    if (!client) return;
    const handler = this.#handlers.get(type);
    try {
      if (handler) handler(client, message);
      else this.#anyHandler?.(client, type, message);
    } catch (e) {
      console.error('[graao host] message handler error', type, e);
    }
  }

  /** The connection is gone: consented → onLeave; otherwise onDrop (which may hold the seat) or onLeave. */
  async _leave(sessionId: string, consented: boolean): Promise<void> {
    const client = this.#members.get(sessionId);
    if (!client) return;
    this.#members.delete(sessionId);
    try {
      if (consented || !this.#hooks.onDrop) await this.#hooks.onLeave?.(client, CloseCode.CONSENTED);
      else {
        await this.#hooks.onDrop(client, CloseCode.DROPPED);
        // No seat held: the drop is a leave.
        if (!this.#reconnections.has(sessionId)) await this.#hooks.onLeave?.(client, CloseCode.DROPPED);
      }
    } catch (e) {
      console.error('[graao host] leave error', e);
    }
    this.#disposeIfEmpty();
  }

  /** The dropped player is back (new connection, same session). Throws when their seat is no longer held. */
  async _reconnect(client: Client): Promise<void> {
    const pending = this.#reconnections.get(client.sessionId);
    if (!pending) throw new ServerError(4212, 'failed to reconnect');
    clearTimeout(pending.timer);
    this.#reconnections.delete(client.sessionId);
    client.auth = pending.client.auth;
    this.#members.set(client.sessionId, client);
    pending.resolve(client);
    try {
      await this.#hooks.onReconnect?.(client);
    } catch (e) {
      console.error('[graao host] reconnect error', e);
    }
  }

  /** Everyone out now (the host closed the room). */
  async _dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#simTimer !== undefined) clearInterval(this.#simTimer);
    for (const p of this.#reconnections.values()) clearTimeout(p.timer);
    this.#reconnections.clear();
    this.#members.clear();
    try {
      await this.#hooks.onDispose?.();
    } catch (e) {
      console.error('[graao host] dispose error', e);
    }
    this.onDisposed();
  }

  async #afterDropTimeout(client: Client): Promise<void> {
    try {
      await this.#hooks.onLeave?.(client, CloseCode.DROPPED);
    } catch (e) {
      console.error('[graao host] leave error', e);
    }
    this.onSeatReleased(client.sessionId);
    this.#disposeIfEmpty();
  }

  /** Set by the host driver: a held seat expired (the main thread forgets that session). */
  onSeatReleased: (sessionId: string) => void = () => {};

  /** Set by the host driver: the room's own listing changed (the host announces public rooms). */
  onMetadata: (metadata: Record<string, unknown>) => void = () => {};

  #disposeIfEmpty(): void {
    if (!this.#members.size && !this.#reconnections.size) void this._dispose();
  }
}
