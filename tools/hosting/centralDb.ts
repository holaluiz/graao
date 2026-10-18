/**
 * The Graao Host central service on an embedded Postgres (PGlite): the real migration
 * (`packages/database/migrations/0003_graao_host.sql`) on a minimal stand-in of what Supabase provides (roles, the
 * `auth.users` table, `auth.uid()` from the request's JWT subject). Used by the tests and by the local development
 * central (`central-dev.ts`), so both exercise the exact SQL that production runs.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const MIGRATION = join(dirname(fileURLToPath(import.meta.url)), '../../packages/database/migrations/0003_graao_host.sql');

const SUPABASE_STANDIN = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema auth;
  create table auth.users (id uuid primary key, is_anonymous boolean not null default true);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
`;

/** The functions a client may call (PostgREST would expose exactly the granted ones). */
export const RPC_NAMES = new Set([
  'host_config',
  'host_ticket_create',
  'host_ticket_status',
  'host_ticket_cancel',
  'host_ticket_peek',
  'host_ticket_claim',
  'host_ticket_fail',
  'host_room_publish',
  'host_heartbeat',
  'host_room_close',
  'host_session_end',
  'host_public_rooms',
  'host_room_endpoint',
  'host_my_installations',
  'host_revoke',
]);

export class RpcError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface CentralDb {
  db: PGlite;
  /** One RPC as PostgREST runs it: as `anon` or `authenticated` (with `uid`), named JSON arguments. */
  rpc(fn: string, args: Record<string, unknown>, uid?: string | null): Promise<unknown>;
  /** Test/dev helper: set a config value (e.g. tunnel_mode). */
  setConfig(key: string, value: unknown): Promise<void>;
  close(): Promise<void>;
}

export async function createCentralDb(opts: { allowLoopbackEndpoints?: boolean; tunnelMode?: string } = {}): Promise<CentralDb> {
  const db = new PGlite();
  await db.exec(SUPABASE_STANDIN);
  await db.exec(readFileSync(MIGRATION, 'utf8'));
  const setConfig = async (key: string, value: unknown) => {
    await db.query(`insert into private.host_config (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value`, [key, JSON.stringify(value)]);
  };
  if (opts.allowLoopbackEndpoints) await setConfig('allow_loopback_endpoints', true);
  if (opts.tunnelMode) await setConfig('tunnel_mode', opts.tunnelMode);

  // PGlite is single-connection: one RPC at a time, like a serialized connection pool.
  let queue: Promise<unknown> = Promise.resolve();
  const rpc = (fn: string, args: Record<string, unknown>, uid: string | null = null): Promise<unknown> => {
    const run = async () => {
      if (!RPC_NAMES.has(fn)) throw new RpcError(404, 'PGRST202', `Could not find the function public.${fn}`);
      const names = Object.keys(args).filter((k) => /^p_[a-z_]+$/.test(k));
      const params = names.map((k) => {
        const v = args[k];
        return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
      });
      const call = `select public.${fn}(${names.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as result`;
      try {
        return await db.transaction(async (tx) => {
          if (uid) await tx.query(`insert into auth.users (id) values ($1) on conflict do nothing`, [uid]);
          await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid ?? '']);
          await tx.exec(`set local role ${uid ? 'authenticated' : 'anon'}`);
          const r = await tx.query<{ result: unknown }>(call, params);
          return r.rows[0]?.result ?? null;
        });
      } catch (e) {
        const msg = (e as Error).message ?? String(e);
        if (/permission denied/.test(msg)) throw new RpcError(401, '42501', msg);
        if (/function .* does not exist/.test(msg)) throw new RpcError(404, 'PGRST202', msg);
        throw new RpcError(400, (e as { code?: string }).code ?? 'P0001', msg);
      }
    };
    const p = queue.then(run, run);
    queue = p.catch(() => {});
    return p;
  };
  return { db, rpc, setConfig, close: () => db.close() };
}
