/**
 * Supabase access-token check on join. Access tokens are JWTs signed with the project's asymmetric keys (ES256, or
 * RS256); the public keys come from the project's JWKS, cached and refetched on an unknown key id at most once a
 * minute. Nothing in a token is believed before its signature, expiry, issuer and audience check out. The room only
 * needs the user id: identity never comes from what a client says about itself.
 */
import { webcrypto } from 'node:crypto';
import { serverConfig } from '../config';

type CryptoKey = webcrypto.CryptoKey;
const subtle = webcrypto.subtle;

export interface VerifiedUser {
  id: string;
  anonymous: boolean;
}

export interface TokenVerifier {
  verify(token: string): Promise<VerifiedUser | null>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Expiry slack for small clock differences (s). */
const CLOCK_SKEW_S = 30;
/** Do not refetch the JWKS more often than this (ms) when a token names an unknown key. */
const JWKS_REFETCH_MS = 60_000;

const b64urlBytes = (s: string) => new Uint8Array(Buffer.from(s, 'base64url'));
const b64urlJson = (s: string) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8')) as Record<string, unknown>;

type Alg = 'ES256' | 'RS256';
const VERIFY: Record<Alg, webcrypto.EcdsaParams | webcrypto.AlgorithmIdentifier> = { ES256: { name: 'ECDSA', hash: 'SHA-256' }, RS256: { name: 'RSASSA-PKCS1-v1_5' } };

export class SupabaseJwtVerifier implements TokenVerifier {
  private keys = new Map<string, { alg: Alg; key: CryptoKey }>();
  private fetchedAt = 0;
  private pending: Promise<void> | null = null;

  constructor(
    projectUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {
    this.issuer = `${projectUrl.replace(/\/+$/, '')}/auth/v1`;
  }

  readonly issuer: string;

  async verify(token: string): Promise<VerifiedUser | null> {
    try {
      if (typeof token !== 'string' || token.length > 8192) return null;
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const header = b64urlJson(parts[0]!);
      const alg = header.alg;
      if ((alg !== 'ES256' && alg !== 'RS256') || typeof header.kid !== 'string') return null;
      const k = await this.key(header.kid);
      if (!k || k.alg !== alg) return null;
      const ok = await subtle.verify(VERIFY[alg], k.key, b64urlBytes(parts[2]!), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
      if (!ok) return null;
      const c = b64urlJson(parts[1]!);
      if (typeof c.exp !== 'number' || c.exp < this.now() / 1000 - CLOCK_SKEW_S) return null;
      if (c.iss !== this.issuer) return null;
      const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
      if (!aud.includes('authenticated') || c.role !== 'authenticated') return null;
      if (typeof c.sub !== 'string' || !UUID.test(c.sub)) return null;
      return { id: c.sub.toLowerCase(), anonymous: c.is_anonymous === true };
    } catch {
      return null;
    }
  }

  private async key(kid: string): Promise<{ alg: Alg; key: CryptoKey } | null> {
    const known = this.keys.get(kid);
    if (known) return known;
    if (this.fetchedAt > 0 && this.now() - this.fetchedAt < JWKS_REFETCH_MS) return null;
    await (this.pending ??= this.refresh().finally(() => (this.pending = null)));
    return this.keys.get(kid) ?? null;
  }

  private async refresh(): Promise<void> {
    this.fetchedAt = this.now();
    try {
      const r = await this.fetchImpl(`${this.issuer}/.well-known/jwks.json`, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) return;
      const body = (await r.json()) as { keys?: webcrypto.JsonWebKey[] };
      const next = new Map<string, { alg: Alg; key: CryptoKey }>();
      for (const jwk of body.keys ?? []) {
        const kid = (jwk as { kid?: unknown }).kid;
        if (typeof kid !== 'string') continue;
        try {
          if (jwk.kty === 'EC' && jwk.crv === 'P-256') next.set(kid, { alg: 'ES256', key: await subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']) });
          else if (jwk.kty === 'RSA') next.set(kid, { alg: 'RS256', key: await subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']) });
        } catch {
          /* a key this server cannot use */
        }
      }
      if (next.size) this.keys = next;
    } catch {
      /* offline: tokens are refused until the next refetch */
    }
  }
}

let verifier: TokenVerifier | null | undefined;

/** The verifier for this server's Supabase project; null when Supabase is not configured (everyone is a guest). */
export function authVerifier(): TokenVerifier | null {
  if (verifier === undefined) {
    const c = serverConfig();
    verifier = c.supabaseUrl ? new SupabaseJwtVerifier(c.supabaseUrl) : null;
  }
  return verifier;
}

/** Tests: replace the verifier (null = guests only; undefined = back to the environment). */
export function setAuthVerifier(v: TokenVerifier | null | undefined): void {
  verifier = v;
}
