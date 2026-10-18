// Builds the Graao Host app into dist/: main + preload (CJS for Electron), the window (one IIFE script, no framework)
// and the self-contained match server bundle. The packaged app needs no node_modules at all.
//
// Baked configuration (publishable values only): GRAAO_HOST_CENTRAL_URL / GRAAO_HOST_CENTRAL_KEY, else the client's
// VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY (environment, or apps/client/.env.local); GRAAO_HOST_SITE_URL.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { build } from 'esbuild';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const env = { ...process.env };
try {
  for (const line of readFileSync('../client/.env.local', 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !env[m[1]]) env[m[1]] = m[2];
  }
} catch {
  /* no local client env */
}
const centralUrl = env.GRAAO_HOST_CENTRAL_URL || env.VITE_SUPABASE_URL || '';
const centralKey = env.GRAAO_HOST_CENTRAL_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY || '';
if (/service_role|sb_secret_/.test(centralKey)) throw new Error('refusing to bake a secret key into the app');
const siteUrl = env.GRAAO_HOST_SITE_URL || 'https://graao.vercel.app';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/renderer', { recursive: true });

const define = {
  __GRAAO_CENTRAL_URL__: JSON.stringify(centralUrl),
  __GRAAO_CENTRAL_KEY__: JSON.stringify(centralKey),
  __GRAAO_SITE_URL__: JSON.stringify(siteUrl),
  __GRAAO_HOST_VERSION__: JSON.stringify(pkg.version),
};
const common = { bundle: true, sourcemap: 'linked', logLevel: 'warning', legalComments: 'none' };
await build({ ...common, entryPoints: ['src/main/main.ts'], outfile: 'dist/main.cjs', platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], define });
await build({ ...common, entryPoints: ['src/preload/preload.ts'], outfile: 'dist/preload.cjs', platform: 'node', format: 'cjs', target: 'node22', external: ['electron'] });
await build({ ...common, entryPoints: ['src/renderer/renderer.ts'], outfile: 'dist/renderer/renderer.js', platform: 'browser', format: 'iife', target: 'chrome130' });
copyFileSync('src/renderer/index.html', 'dist/renderer/index.html');
copyFileSync('src/renderer/style.css', 'dist/renderer/style.css');
execFileSync(process.execPath, ['build-desktop.mjs', '../host/dist/server/graao-server.mjs'], { cwd: '../server', stdio: 'inherit' });
// The installer must carry the tunnel connector (tools/hosting/fetch-cloudflared.mjs downloads and checks it).
if (!existsSync('resources/bin/cloudflared.exe')) {
  if (process.argv.includes('--production')) throw new Error('resources/bin/cloudflared.exe ausente: rode node ../../tools/hosting/fetch-cloudflared.mjs');
  console.warn('aviso: resources/bin/cloudflared.exe ausente (túneis indisponíveis neste build)');
}
console.log(`Graao Host ${pkg.version} built → dist/ (central: ${centralUrl ? new URL(centralUrl).host : 'none'}, site: ${siteUrl})`);
