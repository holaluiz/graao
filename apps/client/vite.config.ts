import { writeFileSync } from 'node:fs';
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

/**
 * The dev map editor (`?editor`, src/editor/MapEditor.ts) saves the versioned map through the dev server: POST
 * /__graao/map writes packages/game-data/src/world/planeta-graao.map.json (the editor validates and serializes it
 * first). Dev server only, never in a build. The write does not reload the editor's page (its own copy is newer).
 */
function mapEditorSave(): Plugin {
  const file = fileURLToPath(new URL('../../packages/game-data/src/world/planeta-graao.map.json', import.meta.url));
  let wroteAt = 0;
  return {
    name: 'graao-map-editor',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__graao/map', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = '';
        req.setEncoding('utf8');
        req.on('data', (c: string) => (body += c));
        req.on('end', () => {
          const fail = (code: number, msg: string) => {
            res.statusCode = code;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: msg }));
          };
          try {
            const m = JSON.parse(body) as { mapId?: unknown; placements?: unknown; chestSpots?: unknown };
            if (m.mapId !== 'planeta-graao' || !Array.isArray(m.placements) || !Array.isArray(m.chestSpots)) return fail(400, 'não parece um mapa do graao');
            wroteAt = Date.now();
            writeFileSync(file, body.endsWith('\n') ? body : `${body}\n`);
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, bytes: body.length }));
          } catch (e) {
            fail(400, (e as Error).message);
          }
        });
      });
    },
    handleHotUpdate(ctx) {
      // The editor keeps its own (newer) copy: no reload of the page that just saved.
      if (ctx.file.replace(/\\/g, '/') === file.replace(/\\/g, '/') && Date.now() - wroteAt < 3000) return [];
      return undefined;
    },
  };
}

export default defineConfig({
  server: { port: 5173, strictPort: true },
  preview: { port: 4173 },
  plugins: [serverInBrowser(), mapEditorSave()],
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
