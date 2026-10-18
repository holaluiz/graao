import { describe, expect, it } from 'vitest';
import { SupabaseJwtVerifier } from './SupabaseAuth';

const URL_ = 'https://example-ref.supabase.co';
const USER = '6f1c1a8e-1234-4abc-8def-0123456789ab';
const b64 = (v: unknown) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');

async function keyPair(kid: string) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid, alg: 'ES256', use: 'sig' };
  const sign = async (claims: Record<string, unknown>, header: Record<string, unknown> = {}) => {
    const h = b64({ alg: 'ES256', typ: 'JWT', kid, ...header });
    const p = b64(claims);
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(`${h}.${p}`));
    return `${h}.${p}.${Buffer.from(sig).toString('base64url')}`;
  };
  return { jwk, sign };
}

function jwksFetch(keys: unknown[], counter = { n: 0 }): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0]) => {
    counter.n++;
    expect(String(input)).toBe(`${URL_}/auth/v1/.well-known/jwks.json`);
    return new Response(JSON.stringify({ keys }), { status: 200 });
  }) as typeof fetch;
}

const claims = (over: Record<string, unknown> = {}) => ({
  iss: `${URL_}/auth/v1`,
  aud: 'authenticated',
  role: 'authenticated',
  sub: USER,
  exp: Math.floor(Date.now() / 1000) + 3600,
  is_anonymous: true,
  ...over,
});

describe('Supabase token verification (server-side identity)', () => {
  it('accepts a token signed by the project key and returns only the user id', async () => {
    const k = await keyPair('k1');
    const v = new SupabaseJwtVerifier(URL_, jwksFetch([k.jwk]));
    expect(await v.verify(await k.sign(claims()))).toEqual({ id: USER, anonymous: true });
  });

  it('refuses tampered, foreign, expired, wrong-issuer and wrong-audience tokens', async () => {
    const k = await keyPair('k1');
    const other = await keyPair('k1');
    const v = new SupabaseJwtVerifier(URL_, jwksFetch([k.jwk]));
    const good = await k.sign(claims());
    const [h, , s] = good.split('.');
    expect(await v.verify(`${h}.${b64(claims({ sub: '00000000-0000-4000-8000-000000000000' }))}.${s}`)).toBeNull();
    expect(await v.verify(await other.sign(claims()))).toBeNull();
    expect(await v.verify(await k.sign(claims({ exp: Math.floor(Date.now() / 1000) - 120 })))).toBeNull();
    expect(await v.verify(await k.sign(claims({ iss: 'https://evil.supabase.co/auth/v1' })))).toBeNull();
    expect(await v.verify(await k.sign(claims({ aud: 'anon', role: 'anon' })))).toBeNull();
    expect(await v.verify(await k.sign(claims({ sub: 'not-a-uuid' })))).toBeNull();
    expect(await v.verify(await k.sign(claims(), { alg: 'HS256' }))).toBeNull();
    expect(await v.verify('garbage')).toBeNull();
  });

  it('caches the JWKS and refetches an unknown key id at most once a minute', async () => {
    const k = await keyPair('k1');
    const unknown = await keyPair('k2');
    const counter = { n: 0 };
    let now = 1_000_000;
    const v = new SupabaseJwtVerifier(URL_, jwksFetch([k.jwk], counter), () => now);
    const token = await k.sign(claims({ exp: now / 1000 + 3600 }));
    await v.verify(token);
    await v.verify(token);
    expect(counter.n).toBe(1);
    await v.verify(await unknown.sign(claims({ exp: now / 1000 + 3600 })));
    await v.verify(await unknown.sign(claims({ exp: now / 1000 + 3600 })));
    expect(counter.n).toBe(1);
    now += 61_000;
    await v.verify(await unknown.sign(claims({ exp: now / 1000 + 3600 })));
    expect(counter.n).toBe(2);
  });
});
