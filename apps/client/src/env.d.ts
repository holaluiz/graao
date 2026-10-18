/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_SERVER_URL?: string;
  readonly VITE_ASSET_BASE?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Supabase publishable key (safe in the browser; RLS protects the data). */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** Graao Host central service (defaults to VITE_SUPABASE_URL; a development central for local tests). */
  readonly VITE_GRAAO_HOST_API?: string;
  /** Where "Baixar Graao Host" points (else the central service's download_url). */
  readonly VITE_GRAAO_HOST_DOWNLOAD_URL?: string;
}
declare const __BUILD_TIME__: string;
