/**
 * What a `NetSession` needs from its room connection. A Colyseus `Room` (dedicated server) fits as is; the host's own
 * player (`LocalLink`, in-page) and a guest (`PeerLink`, WebRTC) implement it for rooms hosted in a player's browser.
 */
export interface RoomLink {
  onMessage<T>(type: number, handler: (message: T) => void): unknown;
  send(type: number, message?: unknown): void;
  /** The connection dropped; the room keeps the seat while it comes back. */
  onDrop(handler: () => void): unknown;
  onReconnect(handler: () => void): unknown;
  /** Gone for good (`code`: see `LinkClose`). */
  onLeave(handler: (code: number) => void): unknown;
  leave(consented?: boolean): Promise<unknown>;
  /** Optional byte counters for the F3 overlay. */
  meter?(onIn: (bytes: number) => void, onOut: (bytes: number) => void): void;
  /** Links that know their own stages (signaling, ICE) keep them here; the session drives the rest from the events above. */
  readonly linkStatus?: LinkStatus;
  /** How the bytes travel (F3), e.g. "STUN · udp" for a WebRTC guest. */
  route?(): string;
}

/**
 * Where a room connection stands: one vocabulary for every link (dedicated server, browser-hosted guest, the host's
 * own player), shown in F3 and logged on each change.
 *
 *   DISCONNECTED → SIGNALING → CONNECTING → CONNECTED ⇄ RECONNECTING
 *   any live state → FAILED (gave up: no host on the code, no route between the networks, reconnection window over,
 *                            seat not kept) or CLOSED (someone left on purpose: SAIR, the host closed the room)
 *
 * FAILED and CLOSED are final. RECONNECTING never outlives the room's reconnection window (`RECONNECT_SECONDS`).
 * A dedicated-server or in-page link is CONNECTED from the start (its matchmaking is not signaling we can see).
 */
export type LinkState = 'DISCONNECTED' | 'SIGNALING' | 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'FAILED' | 'CLOSED';

export const LINK_TRANSITIONS: Readonly<Record<LinkState, readonly LinkState[]>> = {
  DISCONNECTED: ['SIGNALING', 'CONNECTING', 'CONNECTED', 'FAILED', 'CLOSED'],
  SIGNALING: ['CONNECTING', 'FAILED', 'CLOSED'],
  CONNECTING: ['CONNECTED', 'FAILED', 'CLOSED'],
  CONNECTED: ['RECONNECTING', 'FAILED', 'CLOSED'],
  RECONNECTING: ['CONNECTED', 'FAILED', 'CLOSED'],
  FAILED: [],
  CLOSED: [],
};

export const canTransition = (from: LinkState, to: LinkState): boolean => LINK_TRANSITIONS[from].includes(to);

/** The state a link ends in: on purpose (SAIR, the host closing the room, a room notice saying why) or a failure. */
export function closedState(code: number, purposeful = false): LinkState {
  // 1000: a WebSocket's normal closure (the dedicated server disposing of the room).
  return purposeful || code === LinkClose.CONSENTED || code === LinkClose.HOST_CLOSED || code === 1000 ? 'CLOSED' : 'FAILED';
}

/** A link's current state; moves only along `LINK_TRANSITIONS` (repeats and illegal moves are ignored). */
export class LinkStatus {
  private current: LinkState = 'DISCONNECTED';
  private since: number;
  private note = '';
  private readonly listeners = new Set<(to: LinkState, from: LinkState, detail: string) => void>();

  /** `log`: name for the console line on each change (the external alpha collects these); none in tests. */
  constructor(log = '', now = Date.now()) {
    this.since = now;
    if (log) this.on((to, from, detail) => console.info(`[graao] conexão (${log}): ${from} → ${to}${detail ? ` · ${detail}` : ''}`));
  }

  get state(): LinkState {
    return this.current;
  }

  get detail(): string {
    return this.note;
  }

  /**
   * Moves to `next` if the table allows it. A new `detail` alone (same state, e.g. the next attempt) is kept too,
   * except in a final state: the first reason given for FAILED/CLOSED is the one that stays.
   */
  set(next: LinkState, detail = '', now = Date.now()): boolean {
    if (next === this.current) {
      if (LINK_TRANSITIONS[next].length) this.note = detail || this.note;
      return false;
    }
    if (!canTransition(this.current, next)) return false;
    const from = this.current;
    this.current = next;
    this.since = now;
    this.note = detail;
    for (const l of this.listeners) l(next, from, detail);
    return true;
  }

  on(listener: (to: LinkState, from: LinkState, detail: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** "RECONNECTING · tentativa 2 · 3 s" (F3). */
  describe(now = Date.now()): string {
    return [this.current, this.note, `${Math.max(0, Math.floor((now - this.since) / 1000))} s`].filter(Boolean).join(' · ');
  }
}

/** Close codes of browser-hosted rooms (the server's own are Colyseus close codes). */
export const LinkClose = {
  CONSENTED: 4000,
  /** The connection could not come back within the reconnection window. */
  LOST: 4001,
  /** The room refused the seat on reconnection (it let the player go). */
  REFUSED: 4002,
  /** The host closed the room (left, or closed the tab). */
  HOST_CLOSED: 4100,
} as const;

/**
 * Handler registry with a start gate: messages that arrive before the session has registered its handlers (the
 * room's welcome comes with the seat) wait, in order, until `startDelivery`, which runs them on the next task.
 */
export class BufferedLink {
  readonly linkStatus = new LinkStatus('sala');
  private readonly handlers = new Map<number, (m: unknown) => void>();
  private readonly early: [number, unknown][] = [];
  private delivering = false;
  protected readonly dropHandlers: (() => void)[] = [];
  protected readonly reconnectHandlers: (() => void)[] = [];
  protected readonly leaveHandlers: ((code: number) => void)[] = [];

  onMessage<T>(type: number, handler: (message: T) => void): () => void {
    this.handlers.set(type, handler as (m: unknown) => void);
    return () => this.handlers.delete(type);
  }

  onDrop(handler: () => void): void {
    this.dropHandlers.push(handler);
  }

  onReconnect(handler: () => void): void {
    this.reconnectHandlers.push(handler);
  }

  onLeave(handler: (code: number) => void): void {
    this.leaveHandlers.push(handler);
  }

  /** A room message arrived. */
  deliver(type: number, message: unknown): void {
    if (!this.delivering) {
      this.early.push([type, message]);
      return;
    }
    this.handlers.get(type)?.(message);
  }

  protected startDelivery(): void {
    setTimeout(() => {
      this.delivering = true;
      for (const [type, m] of this.early.splice(0)) this.handlers.get(type)?.(m);
    }, 0);
  }

  protected emitLeave(code: number): void {
    for (const h of this.leaveHandlers) h(code);
  }
}
