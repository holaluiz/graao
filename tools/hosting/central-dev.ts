/**
 * Local development central service for Graao Host: the real hosting migration on an embedded Postgres, served with
 * the same HTTP shape as Supabase (`POST /rest/v1/rpc/<fn>`), so the site and the app run unchanged against it.
 *
 *   pnpm exec tsx tools/hosting/central-dev.ts [--port 54330] [--tunnel direct-dev|quick-test]
 *
 * Point the client at it with VITE_GRAAO_HOST=on and VITE_GRAAO_HOST_API=http://127.0.0.1:54330 (the launch config
 * `graao-client-hosting` sets both) and the app with
 * GRAAO_HOST_CENTRAL_URL=http://127.0.0.1:54330. Identity: `Authorization: Bearer dev.<uuid>` (tests), or a real
 * Supabase access token of the graao project, verified against its public keys (the site's anonymous session).
 * Data lives in memory: restarting forgets every installation, ticket and room. Development only.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { SupabaseJwtVerifier } from '../../apps/server/src/auth/SupabaseAuth';
import { createCentralDb, RpcError, type CentralDb } from './centralDb';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CentralDevServer {
  url: string;
  central: CentralDb;
  close(): Promise<void>;
}

export async function startCentralDev(opts: { port?: number; tunnelMode?: string; supabaseUrl?: string } = {}): Promise<CentralDevServer> {
  const central = await createCentralDb({ allowLoopbackEndpoints: true, tunnelMode: opts.tunnelMode ?? 'direct-dev' });
  const verifier = opts.supabaseUrl ? new SupabaseJwtVerifier(opts.supabaseUrl) : null;

  const identity = async (req: IncomingMessage): Promise<string | null> => {
    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (token.startsWith('dev.') && UUID.test(token.slice(4))) return token.slice(4).toLowerCase();
    if (token.split('.').length === 3 && verifier) return (await verifier.verify(token))?.id ?? null;
    return null;
  };

  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-client-info',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    });
    res.end(JSON.stringify(body));
  };

  const server = createServer((req, res) => {
    void (async () => {
      if (req.method === 'OPTIONS') return send(res, 204, null);
      const url = new URL(req.url ?? '/', 'http://x');
      if (req.method === 'POST' && url.pathname === '/functions/v1/graao-host-tunnel') {
        return send(res, 503, { error: 'tunnel_unconfigured', message: 'Central de desenvolvimento: sem túneis gerenciados.' });
      }
      const m = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(url.pathname);
      if (req.method !== 'POST' || !m) return send(res, 404, { message: 'not found' });
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 64 * 1024) return send(res, 413, { message: 'payload too large' });
      }
      let args: Record<string, unknown>;
      try {
        args = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      } catch {
        return send(res, 400, { message: 'invalid json' });
      }
      try {
        send(res, 200, await central.rpc(m[1]!, args, await identity(req)));
      } catch (e) {
        if (e instanceof RpcError) return send(res, e.status, { code: e.code, message: e.message });
        send(res, 500, { message: String(e) });
      }
    })();
  });
  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}`,
    central,
    close: async () => {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
      await central.close();
    },
  };
}

if (process.argv[1] && /central-dev\.ts$/.test(process.argv[1])) {
  const arg = (n: string) => {
    const i = process.argv.indexOf(`--${n}`);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  let supabaseUrl = process.env.VITE_SUPABASE_URL;
  try {
    process.loadEnvFile(new URL('../../apps/client/.env.local', import.meta.url));
    supabaseUrl ??= process.env.VITE_SUPABASE_URL;
  } catch {
    /* no client env: dev tokens only */
  }
  const s = await startCentralDev({ port: Number(arg('port') ?? 54330), tunnelMode: arg('tunnel') ?? 'direct-dev', supabaseUrl });
  console.log(`graao-host central (dev) em ${s.url} · túnel padrão: ${arg('tunnel') ?? 'direct-dev'} · tokens: dev.<uuid>${supabaseUrl ? ` e JWT de ${new URL(supabaseUrl).host}` : ''}`);
}
