import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

/**
 * The host's match room is the server's own code (apps/server) running in a Web Worker. Only for imports made from
 * there: `@colyseus/core` becomes the in-browser stand-in and `node:crypto` the Web Crypto API.
 */
function serverInBrowser(): Plugin {
  const shim = (f: string) => fileURLToPath(new URL(`./src/net/host/${f}`, import.meta.url));
  const swaps: Record<string, string> = { '@colyseus/core': shim('colyseusShim.ts'), 'node:crypto': shim('nodeCryptoShim.ts') };
  return {
    name: 'graao-server-in-browser',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !(source in swaps) || !importer.replace(/\\/g, '/').includes('/apps/server/src/')) return null;
      return swaps[source];
    },
  };
}

export default defineConfig({
  server: { port: 5173, strictPort: true },
  preview: { port: 4173 },
  plugins: [serverInBrowser()],
  worker: { format: 'es', plugins: () => [serverInBrowser()] },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('rapier3d')) return 'rapier';
          if (id.includes('colyseus')) return 'net';
          // Loaded lazily behind the menu (cloud profile); never on the startup path.
          if (id.includes('@supabase')) return 'supabase';
          return undefined;
        },
      },
    },
  },
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
});
