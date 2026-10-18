/**
 * Runs the server's match room (`GraaoMatchRoom`, unchanged) on the Colyseus stand-in (`colyseusShim`): one room per
 * host, driven by `ToRoom` messages, answering with `FromRoom`. Lives in the host's Web Worker (`host.worker.ts`);
 * tests drive it directly. No identity checks and no persistence here: the host is a player, so everyone joins as a
 * guest and nothing reaches anyone's history (the server config is empty in the browser).
 */
import { GraaoMatchRoom } from '../../../../server/src/rooms/GraaoMatchRoom';
import type { Client, Room } from './colyseusShim';
import type { FromRoom, ToRoom } from './hostProtocol';

const messageOf = (e: unknown) => (e as Error)?.message ?? String(e);

export class HostRoomDriver {
  private room: Room | null = null;
  /** Work runs in arrival order (a join finishes before that session's first message is handled). */
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly post: (m: FromRoom) => void) {}

  handle(m: ToRoom): Promise<void> {
    this.queue = this.queue.then(() => this.run(m)).catch((e) => console.error('[graao host]', e));
    return this.queue;
  }

  private client(sid: string): Client {
    const room = this.room!;
    return { sessionId: sid, send: (type, message) => room.output.send([sid], type as number, message) };
  }

  private async run(m: ToRoom): Promise<void> {
    switch (m.t) {
      case 'create': {
        try {
          // The shim at runtime; typed by the real Colyseus class (the room's own declarations).
          const room = new GraaoMatchRoom() as unknown as Room;
          room.output = { send: (to, type, message) => this.post({ t: 'send', to, type, m: message }) };
          room.onDisposed = () => this.post({ t: 'disposed' });
          room.onSeatReleased = (sid) => this.post({ t: 'released', sid });
          this.room = room;
          await room._create(m.options);
          this.post({ t: 'created', code: room.roomId });
        } catch (e) {
          this.room = null;
          this.post({ t: 'create-error', error: messageOf(e) });
        }
        return;
      }
      case 'join': {
        if (!this.room) return this.post({ t: 'join-error', sid: m.sid, error: 'room is gone' });
        try {
          await this.room._join(this.client(m.sid), m.options);
          this.post({ t: 'joined', sid: m.sid });
        } catch (e) {
          this.post({ t: 'join-error', sid: m.sid, error: messageOf(e) });
        }
        return;
      }
      case 'msg':
        this.room?._message(m.sid, m.type, m.m);
        return;
      case 'leave':
        await this.room?._leave(m.sid, m.consented);
        return;
      case 'reconnect': {
        if (!this.room) return this.post({ t: 'reconnect-error', sid: m.sid, error: 'room is gone' });
        try {
          await this.room._reconnect(this.client(m.sid));
          this.post({ t: 'reconnected', sid: m.sid });
        } catch (e) {
          this.post({ t: 'reconnect-error', sid: m.sid, error: messageOf(e) });
        }
        return;
      }
      case 'close':
        await this.room?._dispose();
        this.room = null;
        return;
    }
  }
}
