/**
 * The public list of browser-hosted rooms. Each public room's host announces the metadata its own authoritative room
 * (`GraaoMatchRoom` in the host's worker) publishes, with Supabase Realtime Presence on one channel; the room browser
 * shows what the hosts announce right now.
 *
 * Supabase only relays these announcements, like a notice board: it never counts seats or decides who may enter.
 * Joining still asks the host's room, which refuses a full or started room, so a stale line can only end in a clear
 * refusal. A line disappears when its host withdraws it (the room closed) or the host's Realtime connection ends (the
 * tab closed). Each tab opens one channel, shared by its announcement and its room browser.
 */
import type { RealtimeChannel } from '@supabase/supabase-js';
import { parseRoomListing, type RoomListing } from '@graao/shared';
import { realtime, signalingConfigured } from './signaling';

export type DirectoryStatus = 'connecting' | 'live' | 'offline';
export type DirectoryListener = (rooms: RoomListing[], status: DirectoryStatus) => void;

const CHANNEL = 'graao-rooms';
/** Realtime limits how often one client may update its presence: changes are coalesced. */
const MIN_TRACK_MS = 900;
const RETRY_MS = 5000;
/** A bound on what a misbehaving announcer can put on the screen. */
const MAX_ROOMS = 60;

/** Presence state → one line per room code (the newest announcement wins), parsed like any untrusted listing. */
export function roomsFromPresence(state: Record<string, unknown[]>): RoomListing[] {
  const newest = new Map<string, { at: number; room: RoomListing }>();
  for (const metas of Object.values(state)) {
    for (const meta of metas) {
      const room = parseRoomListing(meta);
      if (!room) continue;
      const at = Number((meta as { at?: unknown }).at) || 0;
      const seen = newest.get(room.code);
      if (!seen || at >= seen.at) newest.set(room.code, { at, room });
    }
  }
  return [...newest.values()]
    .sort((a, b) => Number(b.room.available) - Number(a.room.available) || b.at - a.at)
    .slice(0, MAX_ROOMS)
    .map((x) => x.room);
}

class RoomDirectory {
  private channel: RealtimeChannel | null = null;
  private opening = false;
  private status: DirectoryStatus = 'connecting';
  private synced = false;
  private rooms: RoomListing[] = [];
  private readonly listeners = new Set<DirectoryListener>();
  /** This tab's own public room, while it hosts one. */
  private announced: RoomListing | null = null;
  private trackedJson = '';
  private lastTrackAt = 0;
  private trackTimer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;

  get available(): boolean {
    return signalingConfigured();
  }

  /** Follows the list while the room browser is open. Returns the way to stop. */
  watch(listener: DirectoryListener): () => void {
    this.listeners.add(listener);
    listener(this.rooms, this.synced ? this.status : this.status === 'offline' ? 'offline' : 'connecting');
    void this.ensure();
    return () => {
      this.listeners.delete(listener);
      this.closeIfIdle();
    };
  }

  /** Asks again now (the list is live; this only matters after a failure). */
  refresh(): void {
    if (this.status === 'offline') {
      clearTimeout(this.retryTimer);
      void this.ensure();
    } else this.emit();
  }

  /** This tab hosts a public room: announce it (null withdraws it). */
  announce(room: RoomListing | null): void {
    this.announced = room;
    if (!room) {
      clearTimeout(this.trackTimer);
      if (this.channel && this.trackedJson) void this.channel.untrack().catch(() => {});
      this.trackedJson = '';
      this.closeIfIdle();
      return;
    }
    void this.ensure().then(() => this.scheduleTrack());
  }

  private emit(): void {
    const status = this.synced ? this.status : this.status === 'offline' ? 'offline' : 'connecting';
    for (const l of this.listeners) l(this.rooms, status);
  }

  private async ensure(): Promise<void> {
    if (this.channel || this.opening || !this.available) {
      if (!this.available) {
        this.status = 'offline';
        this.emit();
      }
      return;
    }
    this.opening = true;
    this.status = 'connecting';
    this.synced = false;
    this.emit();
    try {
      const sb = await realtime();
      if (!this.listeners.size && !this.announced) return;
      const channel = sb.channel(CHANNEL, { config: { presence: { key: crypto.randomUUID() } } });
      this.channel = channel;
      channel.on('presence', { event: 'sync' }, () => {
        if (this.channel !== channel) return;
        this.synced = true;
        this.rooms = roomsFromPresence(channel.presenceState() as Record<string, unknown[]>);
        this.emit();
      });
      await new Promise<void>((resolve) => {
        channel.subscribe((status) => {
          if (this.channel !== channel) return resolve();
          if (status === 'SUBSCRIBED') {
            this.status = 'live';
            this.trackedJson = '';
            this.emit();
            this.scheduleTrack();
            resolve();
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            this.fail();
            resolve();
          }
        });
      });
    } catch {
      this.fail();
    } finally {
      this.opening = false;
    }
  }

  private fail(): void {
    const channel = this.channel;
    this.channel = null;
    this.trackedJson = '';
    this.status = 'offline';
    this.synced = false;
    this.emit();
    if (channel) void realtime().then((sb) => sb.removeChannel(channel)).catch(() => {});
    clearTimeout(this.retryTimer);
    if (this.listeners.size || this.announced) this.retryTimer = setTimeout(() => void this.ensure(), RETRY_MS);
  }

  private scheduleTrack(): void {
    clearTimeout(this.trackTimer);
    const room = this.announced;
    const channel = this.channel;
    if (!room || !channel || this.status !== 'live') return;
    const json = JSON.stringify(room);
    if (json === this.trackedJson) return;
    const wait = this.lastTrackAt + MIN_TRACK_MS - Date.now();
    if (wait > 0) {
      this.trackTimer = setTimeout(() => this.scheduleTrack(), wait);
      return;
    }
    this.trackedJson = json;
    this.lastTrackAt = Date.now();
    void channel.track({ ...room, at: Date.now() }).catch(() => {
      if (this.trackedJson === json) this.trackedJson = '';
    });
  }

  private closeIfIdle(): void {
    if (this.listeners.size || this.announced) return;
    clearTimeout(this.retryTimer);
    clearTimeout(this.trackTimer);
    const channel = this.channel;
    this.channel = null;
    this.trackedJson = '';
    this.synced = false;
    this.status = 'connecting';
    this.rooms = [];
    if (channel) void realtime().then((sb) => sb.removeChannel(channel)).catch(() => {});
  }
}

/** One directory per tab. */
export const roomDirectory = new RoomDirectory();
