/**
 * Server configuration from the environment (read lazily: the entry point loads `apps/server/.env` first; tests never
 * do, so they never reach the real database). Secrets stay on the server; the browser only ever has the publishable key.
 */
export interface ServerConfig {
  /** Supabase project URL (https://<ref>.supabase.co); empty = no persistence, everyone plays as a guest. */
  supabaseUrl: string;
  /** Publishable (anon) key: enough to call `record_match`, which checks the server secret itself. */
  supabaseKey: string;
  /** Match server secret registered (as a SHA-256) in `private.server_keys`. */
  serverSecret: string;
  /** Refuse joins without a valid Supabase token (public servers). Off by default: dev guests can join. */
  requireAuth: boolean;
}

export function serverConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    supabaseUrl: (env.SUPABASE_URL ?? '').replace(/\/+$/, ''),
    supabaseKey: env.SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_ANON_KEY ?? '',
    serverSecret: env.GRAAO_SERVER_SECRET ?? '',
    requireAuth: env.GRAAO_REQUIRE_AUTH === '1',
  };
}
