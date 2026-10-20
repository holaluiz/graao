/**
 * The host's side of a browser-hosted room (main thread). Runs the match room in a Web Worker, seats the host's own
 * player in-page (`LocalLink`) and, when the room is online, answers guests who find it by code (signaling) with a
 * WebRTC data channel each (`HostPeer`). Room messages go out encoded once per broadcast.
 *
 * A public online room is announced in the room browser of every other player (`roomDirectory`) with the listing its
 * own room publishes; the announcement follows every change and is withdrawn when the room closes.
 *
 * The host leaving (SAIR DA SALA, closing the tab) closes the room for everyone: guests get `["bye"]` and go back to
 * the menu. A guest whose connection dies keeps their seat for the room's reconnection window and comes back with a
 * new connection (`["rejoin", {sid, token}]`).
 */
import { MAX_PLAYERS, S2C, parseRoomListing } from '@graao/shared';
import { BufferedLink, LinkClose, type RoomLink } from '../RoomLink';
import type { FromRoom, ToRoom } from './hostProtocol';
import { roomDirectory } from './roomDirectory';
import { SignalChannel, randomId } from './signaling';
import { FrameReader, SNAPSHOT_BACKLOG_BYTES, gatheredSdp, iceServers, sendFrame } from './wire';

/** Where a seated session's room messages go. */
interface Endpoint {
  deliver(type: number, message: unknown, encoded: () => string): void;
}

type Waiter = { resolve(): void; reject(e: Error): void };

const HOST_SID = 'host';

export class RoomHost {
  code = '';
  /** Called once when the room is gone (closed by the host, or failed). */
  onClosed: (() => void) | null = null;
  private worker: Worker | null = null;
  private signal: SignalChannel | null = null;
  private readonly endpoints = new Map<string, Endpoint>();
  /** Reconnection tokens of guest sessions (only the right guest may take a held seat back). */
  private readonly tokens = new Map<string, string>();
  private readonly waiters = new Map<string, Waiter>();
  private readonly peers = new Map<string, HostPeer>();
  private created: Waiter & { code?: string } = { resolve: () => {}, reject: () => {} };
  private closed = false;
  /** The room's latest listing (sent by the room whenever it changes). */
  private metadata: Record<string, unknown> | null = null;
  private readonly onPageHide = () => this.close();

  private constructor() {}

  /**
   * Builds the room; `online` also publishes its code so guests can join (else a private practice room, offline).
   * Rejects with a player-facing message.
   */
  static async create(options: Record<string, unknown>, online: boolean): Promise<RoomHost> {
    const host = new RoomHost();
    try {
      await host.start(options);
      // A code another host already uses (rare): build the room again with a new one.
      for (let attempt = 1; online && !(await host.publish()); attempt++) {
        if (attempt >= 3) throw new Error('Não deu para reservar um código de sala. Tente de novo.');
        await host.restart(options);
      }
      host.announce();
    } catch (e) {
      host.close();
      throw e;
    }
    addEventListener('pagehide', host.onPageHide);
    return host;
  }

  get online(): boolean {
    return !!this.signal;
  }

  /** Guests connected right now. */
  get guests(): number {
    return this.endpoints.size - (this.endpoints.has(HOST_SID) ? 1 : 0);
  }

  /** Seats the host's own player. */
  async connectLocal(options: unknown): Promise<RoomLink> {
    const link = new LocalLink(this);
    this.endpoints.set(HOST_SID, link);
    try {
      await this.seat(HOST_SID, options);
    } catch (e) {
      this.endpoints.delete(HOST_SID);
      throw e;
    }
    link.started();
    return link;
  }

  post(m: ToRoom): void {
    this.worker?.postMessage(m);
  }

  /** Everyone out: guests are told, the worker and the signaling channel stop. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    removeEventListener('pagehide', this.onPageHide);
    roomDirectory.announce(null);
    for (const peer of this.peers.values()) peer.close('host');
    this.peers.clear();
    this.signal?.close();
    this.signal = null;
    this.post({ t: 'close' });
    // Let the close reach the room (it disposes), then stop the worker.
    const worker = this.worker;
    this.worker = null;
    setTimeout(() => worker?.terminate(), 200);
    for (const w of this.waiters.values()) w.reject(new Error('A sala foi fechada.'));
    this.waiters.clear();
    this.created.reject(new Error('A sala foi fechada.'));
    this.onClosed?.();
  }

  // ------------------------------------------------------------------------------------------------ room worker

  private start(options: Record<string, unknown>): Promise<void> {
    this.worker = new Worker(new URL('./host.worker.ts', import.meta.url), { type: 'module', name: 'graao-room' });
    this.worker.onmessage = (e: MessageEvent<FromRoom>) => this.onRoom(e.data);
    this.worker.onerror = (e) => {
      console.error('[graao host] worker error', e.message);
      this.created.reject(new Error('A sala não conseguiu iniciar neste navegador.'));
    };
    return this.build(options);
  }

  private build(options: Record<string, unknown>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('A sala demorou demais para iniciar.')), 30000);
      this.created = {
        resolve: () => (clearTimeout(timer), resolve()),
        reject: (e) => (clearTimeout(timer), reject(e)),
      };
      this.post({ t: 'create', options });
    });
  }

  private async restart(options: Record<string, unknown>): Promise<void> {
    this.post({ t: 'close' });
    await this.build(options);
  }

  private onRoom(m: FromRoom): void {
    switch (m.t) {
      case 'created':
        this.code = m.code;
        this.created.resolve();
        return;
      case 'create-error':
        this.created.reject(new Error(`A sala não conseguiu iniciar (${m.error}).`));
        return;
      case 'joined':
      case 'reconnected':
        this.waiters.get(m.sid)?.resolve();
        this.waiters.delete(m.sid);
        return;
      case 'join-error':
      case 'reconnect-error':
        this.waiters.get(m.sid)?.reject(new Error(m.error));
        this.waiters.delete(m.sid);
        return;
      case 'send': {
        let json: string | undefined;
        const encoded = () => (json ??= JSON.stringify([m.type, m.m]));
        for (const sid of m.to) this.endpoints.get(sid)?.deliver(m.type, m.m, encoded);
        return;
      }
      case 'metadata':
        this.metadata = m.metadata;
        this.announce();
        return;
      case 'released':
        this.tokens.delete(m.sid);
        for (const peer of this.peers.values()) if (peer.sid === m.sid) peer.close('released');
        return;
      case 'disposed':
        // Restarting for a new code also disposes the old room: only a seated room going away closes the host.
        if (this.endpoints.size || this.closed) this.close();
        return;
    }
  }

  private wait(sid: string, m: ToRoom): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.waiters.set(sid, { resolve, reject });
      this.post(m);
    });
  }

  /** A seat for this session (its endpoint is registered first: the welcome comes with the seat). */
  seat(sid: string, options: unknown): Promise<void> {
    return this.wait(sid, { t: 'join', sid, options });
  }

  /** Public online rooms are listed for everyone (private and practice rooms only by code, or not at all). */
  private announce(): void {
    if (this.closed || !this.signal || !this.code || !this.metadata) return;
    const room = parseRoomListing({ ...this.metadata, code: this.code });
    roomDirectory.announce(room?.visibility === 'public' ? room : null);
  }

  // ------------------------------------------------------------------------------------------------ guests

  /** Claims the code on its signaling channel; false when another host already answers there. */
  private async publish(): Promise<boolean> {
    this.signal?.close();
    const signal = await SignalChannel.open(this.code);
    const me = randomId();
    const taken = signal.wait((m) => m.t === 'taken' && m.to === me, 900);
    signal.send({ t: 'probe', from: me });
    if (await taken) {
      signal.close();
      return false;
    }
    this.signal = signal;
    signal.on((m) => {
      if (!m.from) return;
      if (m.t === 'probe') signal.send({ t: 'taken', to: m.from });
      else if (m.t === 'knock') signal.send({ t: 'here', to: m.from });
      else if (m.t === 'offer' && typeof m.sdp === 'string') void this.answer(m.from, m.sdp);
    });
    return true;
  }

  private async answer(from: string, sdp: string): Promise<void> {
    if (this.closed || !this.signal || this.peers.has(from) || this.peers.size >= MAX_PLAYERS * 2) return;
    const peer = new HostPeer(this, from);
    this.peers.set(from, peer);
    try {
      const answer = await peer.answer(sdp);
      this.signal?.send({ t: 'answer', to: from, sdp: answer });
    } catch (e) {
      console.warn('[graao host] could not answer a guest', e);
      peer.close('error');
    }
  }

  forget(peer: HostPeer): void {
    if (this.peers.get(peer.guestId) === peer) this.peers.delete(peer.guestId);
  }

  /** A guest asks for a seat: a new session with its own reconnection token. */
  async join(peer: HostPeer, options: unknown): Promise<{ sid: string; token: string }> {
    const sid = randomId(9);
    const token = randomId(24);
    this.endpoints.set(sid, peer);
    try {
      await this.seat(sid, options);
    } catch (e) {
      this.endpoints.delete(sid);
      throw e;
    }
    this.tokens.set(sid, token);
    return { sid, token };
  }

  /** A dropped guest is back on a new connection. */
  async rejoin(peer: HostPeer, sid: string, token: string): Promise<void> {
    if (!sid || this.tokens.get(sid) !== token) throw new Error('failed to reconnect');
    // An old connection of the same session may still linger: it no longer speaks for it.
    for (const other of this.peers.values()) if (other !== peer && other.sid === sid) other.close('replaced', false);
    this.endpoints.set(sid, peer);
    try {
      await this.wait(sid, { t: 'reconnect', sid });
    } catch (e) {
      if (this.endpoints.get(sid) === peer) this.endpoints.delete(sid);
      throw e;
    }
  }

  /** A guest's connection ended: SAIR (consented) or lost (the room holds the seat for a while). */
  lost(peer: HostPeer, consented: boolean): void {
    if (!peer.sid || this.endpoints.get(peer.sid) !== peer) return;
    this.endpoints.delete(peer.sid);
    if (consented) this.tokens.delete(peer.sid);
    this.post({ t: 'leave', sid: peer.sid, consented });
  }
}

/** The host's own player: room messages in-page, no encoding. */
class LocalLink extends BufferedLink implements RoomLink, Endpoint {
  private left = false;

  constructor(private readonly host: RoomHost) {
    super();
  }

  started(): void {
    this.linkStatus.set('CONNECTED', 'nesta aba');
    this.startDelivery();
  }

  send(type: number, message?: unknown): void {
    if (!this.left) this.host.post({ t: 'msg', sid: HOST_SID, type, m: message });
  }

  route(): string {
    return 'nesta aba';
  }

  async leave(): Promise<void> {
    if (this.left) return;
    this.left = true;
    this.linkStatus.set('CLOSED', 'saiu');
    this.host.close();
  }
}

/** One guest's WebRTC connection, as seen by the host. */
class HostPeer implements Endpoint {
  sid = '';
  private readonly pc = new RTCPeerConnection({ iceServers: iceServers() });
  private dc: RTCDataChannel | null = null;
  private readonly reader = new FrameReader();
  private closed = false;
  private seating = false;
  private quietTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly host: RoomHost,
    readonly guestId: string,
  ) {
    this.pc.ondatachannel = (e) => this.attach(e.channel);
    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState;
      if (s === 'connected') clearTimeout(this.quietTimer);
      // A short blip may heal by itself; past a few seconds the guest starts over on a new connection.
      else if (s === 'disconnected') this.quietTimer = setTimeout(() => this.close('lost', false), 4000);
      else if (s === 'failed' || s === 'closed') this.close('lost', false);
    };
    // A guest that never opens its channel is dropped.
    setTimeout(() => {
      if (!this.dc || this.dc.readyState !== 'open') this.close('timeout', false);
    }, 20000);
  }

  async answer(offer: string): Promise<string> {
    await this.pc.setRemoteDescription({ type: 'offer', sdp: offer });
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    return gatheredSdp(this.pc);
  }

  private attach(dc: RTCDataChannel): void {
    this.dc = dc;
    dc.onmessage = (e) => {
      const f = this.reader.read(e.data);
      if (f) void this.onFrame(f);
    };
    dc.onclose = () => this.close('lost', false);
  }

  private async onFrame(f: unknown[]): Promise<void> {
    const [head, body] = f;
    if (typeof head === 'number') {
      if (this.sid) this.host.post({ t: 'msg', sid: this.sid, type: head, m: body });
      return;
    }
    if (head === 'bye') return this.close('bye', true);
    if (this.sid || this.seating) return;
    this.seating = true;
    try {
      if (head === 'join') {
        const seat = await this.host.join(this, body);
        this.sid = seat.sid;
        this.frame(['ok', seat]);
      } else if (head === 'rejoin') {
        const r = body as { sid?: unknown; token?: unknown } | null;
        const sid = typeof r?.sid === 'string' ? r.sid : '';
        await this.host.rejoin(this, sid, typeof r?.token === 'string' ? r.token : '');
        this.sid = sid;
        this.frame(['ok', { sid, token: r?.token }]);
      }
    } catch (e) {
      this.frame(['no', (e as Error)?.message ?? String(e)]);
      setTimeout(() => this.close('refused', false), 500);
    } finally {
      this.seating = false;
    }
  }

  private frame(f: unknown[]): void {
    if (this.dc) sendFrame(this.dc, JSON.stringify(f));
  }

  deliver(type: number, _message: unknown, encoded: () => string): void {
    const dc = this.dc;
    if (!dc || dc.readyState !== 'open') return;
    if (type === S2C.SNAPSHOT && dc.bufferedAmount > SNAPSHOT_BACKLOG_BYTES) return;
    sendFrame(dc, encoded());
  }

  /** `why`: 'host' (room closed), 'bye' (guest left), 'lost', 'released', 'replaced', 'refused', 'timeout', 'error'. */
  close(why: string, consented = why === 'bye'): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.quietTimer);
    if (why === 'host') this.frame(['bye', LinkClose.HOST_CLOSED]);
    if (why === 'released') this.frame(['bye', LinkClose.REFUSED]);
    this.host.lost(this, consented);
    this.host.forget(this);
    // Give a goodbye frame a moment to leave before the channel closes.
    setTimeout(() => this.pc.close(), why === 'host' || why === 'released' ? 150 : 0);
  }
}
