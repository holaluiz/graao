/**
 * A guest's connection to a browser-hosted room: finds the host by room code (signaling), opens a WebRTC data channel
 * to it and asks for a seat. If the connection dies, it keeps trying for the room's reconnection window with the
 * session token the host gave (`["rejoin", …]`); meanwhile the session shows "reconectando…".
 */
import { RECONNECT_SECONDS } from '@graao/shared';
import { BufferedLink, LinkClose, type RoomLink } from '../RoomLink';
import { SignalChannel, randomId } from './signaling';
import { FrameReader, gatheredSdp, iceServers, sendFrame } from './wire';

interface Seat {
  sid: string;
  token: string;
}

/** One WebRTC connection to the host, ready to carry frames. */
interface Pipe {
  pc: RTCPeerConnection;
  dc: RTCDataChannel;
  reader: FrameReader;
}

export class PeerLink extends BufferedLink implements RoomLink {
  private pipe: Pipe | null = null;
  private seat: Seat | null = null;
  private left = false;
  private reconnecting = false;
  private quietTimer: ReturnType<typeof setTimeout> | undefined;
  private onIn: (n: number) => void = () => {};
  private onOut: (n: number) => void = () => {};

  private constructor(private readonly code: string) {
    super();
  }

  /** Joins the room with this code. Rejects with a player-facing message. */
  static async connect(code: string, options: unknown): Promise<PeerLink> {
    const link = new PeerLink(code);
    const pipe = await link.open();
    try {
      link.seat = await link.handshake(pipe, ['join', options]);
    } catch (e) {
      pipe.pc.close();
      throw e;
    }
    link.adopt(pipe);
    link.startDelivery();
    return link;
  }

  send(type: number, message?: unknown): void {
    const dc = this.pipe?.dc;
    if (this.left || !dc || dc.readyState !== 'open') return;
    this.onOut(sendFrame(dc, JSON.stringify([type, message])));
  }

  meter(onIn: (bytes: number) => void, onOut: (bytes: number) => void): void {
    this.onIn = onIn;
    this.onOut = onOut;
  }

  async leave(): Promise<void> {
    if (this.left) return;
    this.left = true;
    const pipe = this.pipe;
    this.pipe = null;
    if (pipe?.dc.readyState === 'open') pipe.dc.send(JSON.stringify(['bye']));
    setTimeout(() => pipe?.pc.close(), 100);
  }

  // ------------------------------------------------------------------------------------------------ connection

  /** Finds the host on the code's channel and opens a data channel to it. */
  private async open(): Promise<Pipe> {
    const signal = await SignalChannel.open(this.code);
    const me = randomId();
    const pc = new RTCPeerConnection({ iceServers: iceServers() });
    try {
      // Is anyone hosting this code? (A quick answer instead of waiting out the whole negotiation.)
      const here = signal.wait((m) => m.t === 'here' && m.to === me, 4000);
      signal.send({ t: 'knock', from: me });
      if (!(await here)) throw new Error('Nenhuma sala com esse código (ou quem criou já saiu).');
      const dc = pc.createDataChannel('graao', { ordered: true });
      await pc.setLocalDescription(await pc.createOffer());
      const answer = signal.wait((m) => m.t === 'answer' && m.to === me && typeof m.sdp === 'string', 10000);
      signal.send({ t: 'offer', from: me, sdp: await gatheredSdp(pc) });
      const a = await answer;
      if (!a) throw new Error('Quem criou a sala não respondeu. Tente de novo.');
      await pc.setRemoteDescription({ type: 'answer', sdp: a.sdp! });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Não deu para conectar direto com quem criou a sala (a rede de um de vocês bloqueia conexões diretas).')),
          15000,
        );
        dc.onopen = () => (clearTimeout(timer), resolve());
      });
      return { pc, dc, reader: new FrameReader() };
    } catch (e) {
      pc.close();
      throw e;
    } finally {
      signal.close();
    }
  }

  /** Sends the seat request and waits for the answer; room frames before it are kept for the session. */
  private handshake(pipe: Pipe, request: unknown[]): Promise<Seat> {
    return new Promise<Seat>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Quem criou a sala não respondeu. Tente de novo.')), 10000);
      pipe.dc.onmessage = (e) => {
        const f = pipe.reader.read(e.data);
        if (!f) return;
        const [head, body] = f;
        if (typeof head === 'number') return this.deliver(head, body);
        if (head === 'ok') {
          clearTimeout(timer);
          resolve(body as Seat);
        } else if (head === 'no') {
          clearTimeout(timer);
          reject(new Error(String(body)));
        }
      };
      pipe.dc.onclose = () => (clearTimeout(timer), reject(new Error('A conexão com a sala caiu.')));
      pipe.dc.send(JSON.stringify(request));
    });
  }

  /** From now on this pipe carries the session. */
  private adopt(pipe: Pipe): void {
    this.pipe = pipe;
    pipe.dc.onmessage = (e) => {
      if (typeof e.data === 'string') this.onIn(e.data.length);
      const f = pipe.reader.read(e.data);
      if (!f) return;
      const [head, body] = f;
      if (typeof head === 'number') this.deliver(head, body);
      else if (head === 'bye') this.end(typeof body === 'number' ? body : LinkClose.HOST_CLOSED);
    };
    pipe.dc.onclose = () => this.lost(pipe);
    pipe.pc.onconnectionstatechange = () => {
      const s = pipe.pc.connectionState;
      if (s === 'connected') clearTimeout(this.quietTimer);
      else if (s === 'disconnected') this.quietTimer = setTimeout(() => this.lost(pipe), 4000);
      else if (s === 'failed' || s === 'closed') this.lost(pipe);
    };
  }

  private end(code: number): void {
    if (this.left) return;
    this.left = true;
    clearTimeout(this.quietTimer);
    const pipe = this.pipe;
    this.pipe = null;
    pipe?.pc.close();
    this.emitLeave(code);
  }

  /** The connection died without a goodbye: try to take the seat back on a new one. */
  private lost(pipe: Pipe): void {
    if (this.left || this.pipe !== pipe || this.reconnecting) return;
    clearTimeout(this.quietTimer);
    this.pipe = null;
    pipe.pc.close();
    this.reconnecting = true;
    for (const h of this.dropHandlers) h();
    void this.reconnect();
  }

  private async reconnect(): Promise<void> {
    const deadline = Date.now() + (RECONNECT_SECONDS - 1) * 1000;
    while (!this.left && Date.now() < deadline) {
      let pipe: Pipe | null = null;
      try {
        pipe = await this.open();
        this.seat = await this.handshake(pipe, ['rejoin', this.seat]);
        if (this.left) {
          pipe.pc.close();
          return;
        }
        this.reconnecting = false;
        this.adopt(pipe);
        for (const h of this.reconnectHandlers) h();
        return;
      } catch (e) {
        pipe?.pc.close();
        // The room no longer holds the seat: no point trying again.
        if (/failed to reconnect|room is gone/.test((e as Error)?.message ?? '')) break;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    this.reconnecting = false;
    this.end(LinkClose.LOST);
  }
}
