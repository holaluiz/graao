/**
 * The WebRTC side of browser-hosted rooms: ICE servers, waiting for candidates, and the data channel's framing.
 *
 * Frames are JSON arrays. A room message is `[type, payload]` (type is a number). Control frames start with a word:
 * guest → host `["join", JoinOptions]`, `["rejoin", {sid, token}]`, `["bye"]`; host → guest `["ok", {sid, token}]`,
 * `["no", reason]`, `["bye", reason]`. Frames longer than one SCTP message are split into `["~", id, i, n, part]`.
 */

/** STUN only by default (direct connections); a TURN relay can be added with `VITE_ICE_SERVERS` (JSON array). */
export function iceServers(raw: string | undefined = import.meta.env.VITE_ICE_SERVERS as string | undefined): RTCIceServer[] {
  if (raw?.trim()) {
    try {
      const v = JSON.parse(raw) as unknown;
      if (Array.isArray(v) && v.length) return v as RTCIceServer[];
    } catch {
      console.warn('[graao] VITE_ICE_SERVERS is not valid JSON; using the default STUN servers');
    }
  }
  return [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
}

/** Waits for ICE gathering (bounded) and returns the description with every candidate found (no trickle). */
export async function gatheredSdp(pc: RTCPeerConnection, ms = 2500): Promise<string> {
  if (pc.iceGatheringState !== 'complete') {
    await new Promise<void>((resolve) => {
      const done = () => {
        if (pc.iceGatheringState !== 'complete') return;
        clearTimeout(timer);
        pc.removeEventListener('icegatheringstatechange', done);
        resolve();
      };
      const timer = setTimeout(() => {
        pc.removeEventListener('icegatheringstatechange', done);
        resolve();
      }, ms);
      pc.addEventListener('icegatheringstatechange', done);
    });
  }
  return pc.localDescription?.sdp ?? '';
}

/** Below every browser's SCTP message limit. */
const CHUNK = 60000;
/** A peer this far behind gets no snapshots until it catches up (they are superseded 50 ms later anyway). */
export const SNAPSHOT_BACKLOG_BYTES = 512 * 1024;

let chunkId = 0;

/** Sends one JSON frame, split when too long. Returns the bytes queued. */
export function sendFrame(dc: RTCDataChannel, json: string): number {
  if (dc.readyState !== 'open') return 0;
  if (json.length <= CHUNK) {
    dc.send(json);
    return json.length;
  }
  const id = ++chunkId;
  const n = Math.ceil(json.length / CHUNK);
  let bytes = 0;
  for (let i = 0; i < n; i++) {
    const part = JSON.stringify(['~', id, i, n, json.slice(i * CHUNK, (i + 1) * CHUNK)]);
    dc.send(part);
    bytes += part.length;
  }
  return bytes;
}

/** Turns received frames back into whole ones (reassembling split frames). */
export class FrameReader {
  private readonly parts = new Map<number, string[]>();

  /** The whole frame, or null while a split one is incomplete (or the data is not a frame). */
  read(data: unknown): unknown[] | null {
    if (typeof data !== 'string') return null;
    let v: unknown;
    try {
      v = JSON.parse(data);
    } catch {
      return null;
    }
    if (!Array.isArray(v)) return null;
    if (v[0] !== '~') return v;
    const [, id, i, n, part] = v as [string, number, number, number, string];
    if (typeof id !== 'number' || typeof i !== 'number' || typeof n !== 'number' || typeof part !== 'string' || n > 1000) return null;
    const list = this.parts.get(id) ?? new Array<string>(n);
    list[i] = part;
    this.parts.set(id, list);
    if (list.filter((p) => p !== undefined).length < n) return null;
    this.parts.delete(id);
    return this.read(list.join(''));
  }
}
