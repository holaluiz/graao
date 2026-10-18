/**
 * Where the app talks to. Baked in at build time (build.mjs): the central service (the graao Supabase project URL and
 * its publishable key — browser-safe, never a service-role key), the site and the app version. Environment variables
 * override them for development and tests only (someone who can set them already controls this PC). A deep link can
 * never change them.
 */
import type { TunnelKind } from './types';

declare const __GRAAO_CENTRAL_URL__: string | undefined;
declare const __GRAAO_CENTRAL_KEY__: string | undefined;
declare const __GRAAO_SITE_URL__: string | undefined;
declare const __GRAAO_HOST_VERSION__: string | undefined;

const baked = (v: () => string | undefined): string => {
  try {
    return v() ?? '';
  } catch {
    return '';
  }
};

export interface AppConfig {
  centralUrl: string;
  centralKey: string;
  siteUrl: string;
  version: string;
  tunnelOverride: TunnelKind | null;
}

export function appConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const tunnel = env.GRAAO_HOST_TUNNEL;
  return {
    centralUrl: (env.GRAAO_HOST_CENTRAL_URL || baked(() => __GRAAO_CENTRAL_URL__)).replace(/\/+$/, ''),
    centralKey: env.GRAAO_HOST_CENTRAL_KEY || baked(() => __GRAAO_CENTRAL_KEY__),
    siteUrl: (env.GRAAO_HOST_SITE_URL || baked(() => __GRAAO_SITE_URL__) || 'https://graao.vercel.app').replace(/\/+$/, ''),
    version: baked(() => __GRAAO_HOST_VERSION__) || env.npm_package_version || '0.0.0',
    tunnelOverride: tunnel === 'direct' || tunnel === 'direct-dev' ? 'direct-dev' : tunnel === 'quick' || tunnel === 'quick-test' ? 'quick-test' : null,
  };
}

/** The page a host opens to play in their own room (the fragment never reaches any server). */
export function roomUrl(siteUrl: string, code: string, ownerKey: string): string {
  return `${siteUrl}/?sala=${encodeURIComponent(code)}${ownerKey ? `#host=${encodeURIComponent(ownerKey)}` : ''}`;
}
