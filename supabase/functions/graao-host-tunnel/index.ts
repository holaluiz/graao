/**
 * Supabase Edge Function `graao-host-tunnel` (Deno): provisions the managed Cloudflare Tunnel of one Graao Host
 * installation and hands its connector a token. The Cloudflare API token never leaves this function; the app only
 * proves its hosting session (the session token from `host_ticket_claim`).
 *
 * POST { session, port }        → { hostname, endpoint_id, token }   (called by the Graao Host app)
 *   - one tunnel per installation (`graao-host-<host id>`), created once, reused; a stable hostname
 *     `h-<id>.<GRAAO_HOST_DOMAIN>` (proxied CNAME to <tunnel>.cfargotunnel.com);
 *   - the tunnel secret is rotated on every call, so a connector token works only until the next hosting session;
 *   - ingress: that hostname → http://127.0.0.1:<port> (the app's local match server), everything else → 404.
 * POST { action: "cleanup", days } with header `x-graao-admin: <GRAAO_HOST_ADMIN_SECRET>` → deletes the tunnels and
 *   DNS records of revoked installations and of those silent for `days` (default 30).
 *
 * Secrets (supabase secrets set …): CF_API_TOKEN (Account › Cloudflare Tunnel: Edit; Zone › DNS: Edit — nothing else),
 * CF_ACCOUNT_ID, CF_ZONE_ID, GRAAO_HOST_DOMAIN (e.g. play.graao.com), GRAAO_HOST_ADMIN_SECRET. SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY are provided by the platform. Deploy with --no-verify-jwt (the app has no user JWT; the
 * function checks the hosting session itself).
 *
 * Status: written against the Cloudflare v4 API documentation; NOT executed yet (no Cloudflare account/zone for graao).
 */
const CF = 'https://api.cloudflare.com/client/v4';
const env = (k: string) => Deno.env.get(k) ?? '';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

async function cf<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${CF}${path}`, {
    method,
    headers: { Authorization: `Bearer ${env('CF_API_TOKEN')}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as { success?: boolean; result?: T; errors?: { message: string }[] };
  if (!r.ok || j.success === false) throw new Error(`cloudflare ${method} ${path.split('/').slice(0, 4).join('/')}: ${r.status} ${(j.errors ?? []).map((e) => e.message).join('; ')}`);
  return j.result as T;
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  const r = await fetch(`${env('SUPABASE_URL')}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(text.includes('graao_host:') ? /graao_host:([a-z_]+)/.exec(text)![1] : `rpc ${fn}: ${r.status}`);
  return JSON.parse(text) as T;
}

const secret32 = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const shortId = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('');

async function provision(session: string, port: number): Promise<Response> {
  let v: { host_id: string; tunnel_id: string | null; hostname: string | null; dns_record_id: string | null };
  try {
    v = await rpc('host_session_validate', { p_session: session });
  } catch (e) {
    const code = (e as Error).message;
    return json(401, { error: code === 'installation_revoked' ? code : 'session_invalid' });
  }
  const acc = env('CF_ACCOUNT_ID');
  const zone = env('CF_ZONE_ID');
  const hostname = v.hostname ?? `h-${await shortId(v.host_id)}.${env('GRAAO_HOST_DOMAIN')}`;

  let tunnelId = v.tunnel_id;
  if (tunnelId) {
    const t = await cf<{ deleted_at: string | null }>('GET', `/accounts/${acc}/cfd_tunnel/${tunnelId}`).catch(() => null);
    if (!t || t.deleted_at) tunnelId = null;
  }
  if (!tunnelId) {
    const t = await cf<{ id: string }>('POST', `/accounts/${acc}/cfd_tunnel`, { name: `graao-host-${v.host_id}`, config_src: 'cloudflare', tunnel_secret: secret32() });
    tunnelId = t.id;
  } else {
    // A fresh secret per hosting session: older connector tokens stop working.
    await cf('PATCH', `/accounts/${acc}/cfd_tunnel/${tunnelId}`, { tunnel_secret: secret32() });
  }
  await cf('PUT', `/accounts/${acc}/cfd_tunnel/${tunnelId}/configurations`, {
    config: { ingress: [{ hostname, service: `http://127.0.0.1:${port}`, originRequest: {} }, { service: 'http_status:404' }] },
  });
  const record = { type: 'CNAME', name: hostname, content: `${tunnelId}.cfargotunnel.com`, proxied: true, comment: `graao-host ${v.host_id}` };
  let dnsId = v.dns_record_id;
  if (dnsId) await cf('PATCH', `/zones/${zone}/dns_records/${dnsId}`, record).catch(() => (dnsId = null));
  if (!dnsId) dnsId = (await cf<{ id: string }>('POST', `/zones/${zone}/dns_records`, record)).id;
  const token = await cf<string>('GET', `/accounts/${acc}/cfd_tunnel/${tunnelId}/token`);
  await rpc('host_tunnel_upsert', { p_host: v.host_id, p_tunnel_id: tunnelId, p_hostname: hostname, p_dns_record_id: dnsId });
  return json(200, { hostname, endpoint_id: hostname.split('.')[0], token });
}

async function cleanup(days: number): Promise<Response> {
  const acc = env('CF_ACCOUNT_ID');
  const zone = env('CF_ZONE_ID');
  const stale = await rpc<{ host_id: string; tunnel_id: string; dns_record_id: string | null }[]>('host_tunnels_stale', { p_days: days });
  const done: string[] = [];
  for (const t of stale) {
    try {
      if (t.dns_record_id) await cf('DELETE', `/zones/${zone}/dns_records/${t.dns_record_id}`).catch(() => {});
      await cf('DELETE', `/accounts/${acc}/cfd_tunnel/${t.tunnel_id}/connections`).catch(() => {});
      await cf('DELETE', `/accounts/${acc}/cfd_tunnel/${t.tunnel_id}`);
      await rpc('host_tunnel_forget', { p_host: t.host_id });
      done.push(t.host_id);
    } catch (e) {
      console.error('cleanup', t.host_id, (e as Error).message);
    }
  }
  return json(200, { removed: done.length, candidates: stale.length });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method' });
  if (!env('CF_API_TOKEN') || !env('CF_ACCOUNT_ID') || !env('CF_ZONE_ID') || !env('GRAAO_HOST_DOMAIN')) {
    return json(503, { error: 'tunnel_unconfigured', message: 'Túneis gerenciados ainda não configurados no servidor central.' });
  }
  const body = (await req.json().catch(() => ({}))) as { session?: unknown; port?: unknown; action?: unknown; days?: unknown };
  try {
    if (body.action === 'cleanup') {
      const admin = env('GRAAO_HOST_ADMIN_SECRET');
      if (!admin || req.headers.get('x-graao-admin') !== admin) return json(403, { error: 'forbidden' });
      return await cleanup(typeof body.days === 'number' ? body.days : 30);
    }
    const session = typeof body.session === 'string' ? body.session : '';
    const port = typeof body.port === 'number' ? body.port : 0;
    if (!/^[0-9a-f]{64}$/.test(session) || !Number.isInteger(port) || port < 1024 || port > 65535) return json(400, { error: 'invalid' });
    return await provision(session, port);
  } catch (e) {
    console.error('graao-host-tunnel', (e as Error).message);
    return json(502, { error: 'tunnel_failed', message: 'Falha ao preparar o túnel.' });
  }
});
