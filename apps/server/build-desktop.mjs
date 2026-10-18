// Bundles the Graao Host server (HOST_MODE=DESKTOP) into ONE self-contained ESM file: Colyseus, ws, express, Rapier
// (its WASM is embedded in the JS) and the game packages. Runs from any folder with no node_modules, on plain Node 22+
// or inside Electron (utilityProcess). Only optional native addons stay out; their packages fall back to pure JS.
import { build } from 'esbuild';

const out = process.argv[2] ?? 'dist/desktop/graao-server.mjs';
const result = await build({
  entryPoints: ['src/desktop/main.ts'],
  outfile: out,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: 'linked',
  minify: false,
  legalComments: 'linked',
  metafile: true,
  // Production rules always: development-only room options (skip draft, free loadouts...) stay off on players' PCs.
  define: { 'process.env.NODE_ENV': '"production"' },
  external: ['bufferutil', 'utf-8-validate', 'msgpackr-extract', '@colyseus/tools'],
  banner: { js: "import { createRequire as __graaoCreateRequire } from 'module'; const require = __graaoCreateRequire(import.meta.url);" },
  logLevel: 'warning',
});
const bytes = Object.values(result.metafile.outputs).find((o) => o.entryPoint)?.bytes ?? 0;
console.log(`desktop server bundled → ${out} (${(bytes / 1048576).toFixed(1)} MB)`);
