/**
 * Messages between the host's page (main thread: its own player, the peers' WebRTC channels, signaling) and the
 * worker that runs the match room. Sessions are named by the main thread; the worker only runs the room.
 */

export type ToRoom =
  /** Build the room (create options, as a server's `client.create`). */
  | { t: 'create'; options: Record<string, unknown> }
  /** A connection asks for a seat with these join options. */
  | { t: 'join'; sid: string; options: unknown }
  /** A room message from a seated session. */
  | { t: 'msg'; sid: string; type: number; m: unknown }
  /** The session's connection ended: consented (SAIR) or dropped (may come back within the reconnection window). */
  | { t: 'leave'; sid: string; consented: boolean }
  /** A dropped session is back on a new connection. */
  | { t: 'reconnect'; sid: string }
  /** The host closed the room. */
  | { t: 'close' };

export type FromRoom =
  | { t: 'created'; code: string }
  | { t: 'create-error'; error: string }
  | { t: 'joined'; sid: string }
  | { t: 'join-error'; sid: string; error: string }
  | { t: 'reconnected'; sid: string }
  | { t: 'reconnect-error'; sid: string; error: string }
  /** One room message for these sessions (a broadcast is a single message). */
  | { t: 'send'; to: string[]; type: number; m: unknown }
  /** The room let this session go for good (its reconnection window ended). */
  | { t: 'released'; sid: string }
  /** The room's own listing (name, seats, phase…), as a server room publishes it to the matchmaker. */
  | { t: 'metadata'; metadata: Record<string, unknown> }
  | { t: 'disposed' };
