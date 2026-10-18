/**
 * Where finished matches go. Supabase when the server has its URL, publishable key and secret (one RPC,
 * `record_match`, plain fetch: no client library on the server); otherwise nowhere (the summary is still logged and
 * shown to the players). Active matches are never written: only their summary, once, at RESULTS.
 */
import { RPC, type RecordMatchPayload } from '@graao/database';
import { serverConfig } from '../config';

export interface MatchStore {
  readonly name: string;
  /** Returns the stored match id, or null when this store keeps nothing. Throws when a configured store fails. */
  record(p: RecordMatchPayload): Promise<string | null>;
}

export class SupabaseMatchStore implements MatchStore {
  readonly name = 'supabase';

  constructor(
    private readonly url: string,
    private readonly key: string,
    private readonly secret: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async record(p: RecordMatchPayload): Promise<string | null> {
    const r = await this.fetchImpl(`${this.url}/rest/v1/rpc/${RPC.recordMatch}`, {
      method: 'POST',
      headers: { apikey: this.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_secret: this.secret, p_match: p }),
      signal: AbortSignal.timeout(8000),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`record_match ${r.status}: ${text.slice(0, 200)}`);
    const id = JSON.parse(text) as unknown;
    return typeof id === 'string' ? id : null;
  }
}

export const NULL_STORE: MatchStore = { name: 'none', record: async () => null };

let store: MatchStore | undefined;

export function matchStore(): MatchStore {
  if (!store) {
    const c = serverConfig();
    store = c.supabaseUrl && c.supabaseKey && c.serverSecret ? new SupabaseMatchStore(c.supabaseUrl, c.supabaseKey, c.serverSecret) : NULL_STORE;
  }
  return store;
}

/** Tests: replace the store (undefined = back to the environment). */
export function setMatchStore(s: MatchStore | undefined): void {
  store = s;
}
