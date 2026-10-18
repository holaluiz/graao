/**
 * Client dev server for Graao Host checks: no HMR (parallel edits never reload the page mid-test) and the hosting API
 * pointed at the local development central (`pnpm exec tsx tools/hosting/central-dev.ts`, port 54330). Port 5180.
 * Launch config `graao-client-hosting` in .claude/launch.json.
 */
import base from '../../apps/client/vite.config.ts';

export default {
  ...base,
  server: { ...base.server, port: 5180, strictPort: true, hmr: false },
  define: { ...base.define, 'import.meta.env.VITE_GRAAO_HOST_API': JSON.stringify(process.env.GRAAO_HOST_API ?? 'http://127.0.0.1:54330') },
};
