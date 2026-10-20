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

/**
 * How the data channel reaches the other side, from the ICE candidate types of the selected pair: `direta` (both
 * `host`: same network or a reachable address), `STUN` (`srflx`/`prflx`: through a NAT, found via STUN), `relay`
 * (TURN). The external alpha reads this to decide whether TURN is needed (docs/networking/HOST_VALIDATION.md).
 */
export function classifyRoute(local: string | undefined, remote: string | undefined): 'direta' | 'STUN' | 'relay' | '?' {
  if (!local || !remote) return '?';
  if (local === 'relay' || remote === 'relay') return 'relay';
  if (local === 'host' && remote === 'host') return 'direta';
  return 'STUN';
}

/** The route of the selected candidate pair in a `getStats()` report, e.g. "STUN · udp", or null before one is chosen. */
export function routeFromStats(stats: ReadonlyMap<string, Record<string, unknown>>): string | null {
  let pair: Record<string, unknown> | undefined;
  for (const r of stats.values()) {
    if (r.type === 'transport' && typeof r.selectedCandidatePairId === 'string') pair = stats.get(r.selectedCandidatePairId);
  }
  // Firefox has no transport report: the pair marks itself.
  if (!pair) for (const r of stats.values()) if (r.type === 'candidate-pair' && (r.selected === true || (r.nominated === true && r.state === 'succeeded'))) pair = r;
  if (!pair) return null;
  const local = stats.get(String(pair.localCandidateId));
  const remote = stats.get(String(pair.remoteCandidateId));
  const route = classifyRoute(local?.candidateType as string | undefined, remote?.candidateType as string | undefined);
  const protocol = typeof local?.protocol === 'string' ? local.protocol : '';
  return protocol ? `${route} · ${protocol}` : route;
}

export async function iceRoute(pc: RTCPeerConnection): Promise<string | null> {
  try {
    return routeFromStats((await pc.getStats()) as unknown as ReadonlyMap<string, Record<string, unknown>>);
  } catch {
    return null;
  }
}

/**
 * `p`, unless `ms` pass first: then it rejects with `message`, and a value that `p` still produces later goes to
 * `onLate` (to close a connection nobody is waiting for any more).
 */
export function within<T>(p: Promise<T>, ms: number, message: string, onLate: (late: T) => void = () => {}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let over = false;
    const timer = setTimeout(() => {
      over = true;
      reject(new Error(message));
    }, Math.max(0, ms));
    p.then(
      (v) => {
        if (over) return onLate(v);
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        if (over) return;
        clearTimeout(timer);
        reject(e);
      },
    );
  });
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
