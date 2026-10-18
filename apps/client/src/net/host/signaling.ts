/**
 * How guests find a host by room code: a Supabase Realtime broadcast channel per code (`graao-room:GR-XXXX`), used
 * only to exchange the WebRTC offer and answer; the game itself then flows peer to peer. The publishable key is
 * enough (no sign-in). Everyone who knows the code can read the channel, as everyone who knows it can join the room;
 * the host learns each guest's network address (that is what a direct connection is).
 *
 * Messages (`event: 'sig'`):
 * - host checking its code is free: `{t:'probe', from}` → an existing host answers `{t:'taken', to}`
 * - guest: `{t:'knock', from}` → host `{t:'here', to}`; then `{t:'offer', from, sdp}` → `{t:'answer', to, sdp}`
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface SignalMsg {
  t: string;
  from?: string;
  to?: string;
  sdp?: string;
}

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '';
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ?? (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '';

/** Is online play possible in this build (players need a way to find each other)? */
export const signalingConfigured = (): boolean => !!url && !!key;

let client: Promise<SupabaseClient> | null = null;

function realtime(): Promise<SupabaseClient> {
  client ??= import('@supabase/supabase-js').then(({ createClient }) =>
    // Its own storage key and no session: signaling never touches the player's cloud profile.
    createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'graao-signal' } }),
  );
  return client;
}

export class SignalChannel {
  private readonly listeners = new Set<(m: SignalMsg) => void>();
  private closed = false;

  private constructor(private readonly channel: ReturnType<SupabaseClient['channel']>, private readonly sb: SupabaseClient) {
    channel.on('broadcast', { event: 'sig' }, ({ payload }) => {
      if (this.closed || !payload || typeof (payload as SignalMsg).t !== 'string') return;
      for (const l of this.listeners) l(payload as SignalMsg);
    });
  }

  static async open(code: string, timeoutMs = 8000): Promise<SignalChannel> {
    if (!signalingConfigured()) throw new Error('Online indisponível neste build: falta configurar o Supabase.');
    const sb = await realtime();
    const ch = new SignalChannel(sb.channel(`graao-room:${code}`, { config: { broadcast: { self: false, ack: false } } }), sb);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('O serviço que conecta os jogadores não respondeu. Confira sua internet.')), timeoutMs);
      ch.channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(timer);
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clearTimeout(timer);
          reject(new Error('Não deu para alcançar o serviço que conecta os jogadores. Confira sua internet.'));
        }
      });
    }).catch((e) => {
      ch.close();
      throw e;
    });
    return ch;
  }

  send(m: SignalMsg): void {
    if (!this.closed) void this.channel.send({ type: 'broadcast', event: 'sig', payload: m });
  }

  on(listener: (m: SignalMsg) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The first message matching `pred` within `ms`, or null. */
  wait(pred: (m: SignalMsg) => boolean, ms: number): Promise<SignalMsg | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        off();
        resolve(null);
      }, ms);
      const off = this.on((m) => {
        if (!pred(m)) return;
        clearTimeout(timer);
        off();
        resolve(m);
      });
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.listeners.clear();
    void this.sb.removeChannel(this.channel);
  }
}

export const randomId = (n = 12): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, (b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
};
