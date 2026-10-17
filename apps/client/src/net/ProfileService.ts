/**
 * ProfileService: the player's persistent identity in Supabase. Anonymous sign-in (the session is kept by
 * supabase-js in localStorage, so the same browser is the same player), one `profiles` row (display name, appearance
 * ids, settings) and the match history (`my_matches`, written by the match server, never by this client).
 *
 * Supabase is optional and never in the way: supabase-js loads lazily once the menu is up, every call has a timeout,
 * and without configuration, offline, or with anonymous sign-ins disabled, everything keeps working from localStorage
 * and the player joins rooms as a guest. The access token goes to the match server, which verifies it itself.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { RPC, TABLES, parseHistory, type HistoryEntry, type PlayerSettings } from '@graao/database';
import type { CharacterAppearance } from '@graao/shared';

export type ProfileStatus = 'off' | 'connecting' | 'cloud' | 'local';

export interface CloudProfile {
  name: string;
  /** Unvalidated ids: the caller migrates them against the catalog. */
  appearance: unknown;
  settings: PlayerSettings;
}

interface ProfilePatch {
  display_name?: string;
  appearance?: CharacterAppearance;
  settings?: PlayerSettings;
}

const SAVE_DEBOUNCE_MS = 1200;

function withTimeout<T>(p: PromiseLike<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what}: tempo esgotado`)), ms);
    Promise.resolve(p).then(
      (v) => (clearTimeout(t), resolve(v)),
      (e: unknown) => (clearTimeout(t), reject(e instanceof Error ? e : new Error(String(e)))),
    );
  });
}

export class ProfileService {
  status: ProfileStatus;
  /** Why the cloud is not in use (shown in the menu). */
  detail = '';
  userId: string | null = null;
  /** Called whenever `status` changes. */
  onStatus: (s: ProfileStatus) => void = () => {};
  private client: SupabaseClient | null = null;
  private started: Promise<CloudProfile | null> | null = null;
  private pending: ProfilePatch = {};
  private settings: PlayerSettings = {};
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '',
    private readonly key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ?? (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '',
  ) {
    this.status = url && key ? 'connecting' : 'off';
    if (this.status === 'off') this.detail = 'sem Supabase configurado';
    addEventListener('pagehide', () => void this.flush());
  }

  /** Fields changed before the cloud row arrived: they win over it (the player just chose them). */
  get localChanges(): Readonly<ProfilePatch> {
    return this.pending;
  }

  /** Signs in (reusing the stored session) and loads this player's row; null when there is none or no cloud. */
  start(): Promise<CloudProfile | null> {
    return (this.started ??= this.connect());
  }

  private setStatus(s: ProfileStatus, detail = ''): void {
    this.status = s;
    this.detail = detail;
    this.onStatus(s);
  }

  private async connect(): Promise<CloudProfile | null> {
    if (this.status === 'off') return null;
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const client = createClient(this.url, this.key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'graao.auth' },
      });
      let { data } = await withTimeout(client.auth.getSession(), 6000, 'sessão');
      if (!data.session) {
        const r = await withTimeout(client.auth.signInAnonymously(), 8000, 'login');
        if (r.error) throw r.error;
        data = { session: r.data.session };
      }
      const user = data.session?.user;
      if (!user) throw new Error('sem usuário');
      this.client = client;
      this.userId = user.id;
      const row = await withTimeout(client.from(TABLES.profiles).select('display_name, appearance, settings').eq('id', user.id).maybeSingle(), 6000, 'perfil');
      if (row.error) throw row.error;
      this.setStatus('cloud');
      // Anything saved while connecting goes up now.
      if (Object.keys(this.pending).length) this.schedule(0);
      if (!row.data) return null;
      const r = row.data as { display_name: string; appearance: unknown; settings: PlayerSettings | null };
      this.settings = { ...(r.settings ?? {}), ...this.settings };
      return { name: r.display_name ?? '', appearance: r.appearance, settings: r.settings ?? {} };
    } catch (e) {
      const msg = (e as { code?: string; message?: string })?.code === 'anonymous_provider_disabled' ? 'login anônimo desligado no Supabase' : ((e as Error)?.message ?? String(e));
      console.warn('[graao] perfil local:', msg);
      this.client = null;
      this.setStatus('local', msg);
      return null;
    }
  }

  /** Queues fields for this player's row (debounced; kept locally by the caller as well). */
  save(patch: { name?: string; appearance?: CharacterAppearance; settings?: PlayerSettings }): void {
    if (patch.name !== undefined) this.pending.display_name = patch.name.slice(0, 20);
    if (patch.appearance) this.pending.appearance = { ...patch.appearance };
    if (patch.settings) {
      this.settings = { ...this.settings, ...patch.settings };
      this.pending.settings = { ...this.settings };
    }
    if (this.status === 'cloud') this.schedule(SAVE_DEBOUNCE_MS);
  }

  private schedule(ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), ms);
  }

  /** Upserts the queued fields now (only the columns that changed). */
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.client || !this.userId || !Object.keys(this.pending).length) return;
    const patch = this.pending;
    this.pending = {};
    try {
      const r = await withTimeout(this.client.from(TABLES.profiles).upsert({ id: this.userId, ...patch }), 8000, 'salvar perfil');
      if (r.error) throw r.error;
    } catch (e) {
      console.warn('[graao] perfil não salvo:', (e as Error)?.message ?? e);
      // Keep it for the next change (newer fields win).
      this.pending = { ...patch, ...this.pending };
    }
  }

  /** The current access token for the match server (refreshed by supabase-js); undefined = join as a guest. */
  async accessToken(timeoutMs = 2500): Promise<string | undefined> {
    if (this.status === 'connecting') await withTimeout(this.start(), timeoutMs, 'perfil').catch(() => null);
    if (!this.client) return undefined;
    try {
      const { data } = await withTimeout(this.client.auth.getSession(), timeoutMs, 'sessão');
      return data.session?.access_token;
    } catch {
      return undefined;
    }
  }

  /** This player's latest matches (newest first); empty without the cloud. */
  async history(limit = 8): Promise<HistoryEntry[]> {
    await this.start();
    if (!this.client) return [];
    const r = await withTimeout(this.client.rpc(RPC.myMatches, { p_limit: limit }), 8000, 'histórico');
    if (r.error) throw r.error;
    return parseHistory(r.data);
  }
}
