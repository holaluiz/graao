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
