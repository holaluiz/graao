// Bundles the server into one ESM file for Docker / Node hosting (dependencies with WASM stay external).
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/server.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  external: ['@dimforge/rapier3d-compat', '@colyseus/*', 'ws', 'msgpackr', 'msgpackr-extract'],
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
});
console.log('server bundled → dist/server.mjs');
