import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173, strictPort: true },
  preview: { port: 4173 },
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
