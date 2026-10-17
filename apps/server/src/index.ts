/** graao match server entry point. */
import { CLIENT_VERSION, PROTOCOL_VERSION } from '@graao/shared';
import { createGraaoServer } from './app';
import { serverConfig } from './config';
import { getWorld } from './world';
import { log } from './log';

// Local secrets live in apps/server/.env (never committed); hosted servers set real environment variables, which win.
try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch {
  /* no .env: guests only, nothing persisted */
}
const cfg = serverConfig();
log('persistence', { supabase: cfg.supabaseUrl ? new URL(cfg.supabaseUrl).host : 'off', results: !!(cfg.supabaseUrl && cfg.serverSecret), requireAuth: cfg.requireAuth });

const argPort = process.argv.indexOf('--port');
const PORT = Number(argPort > 0 ? process.argv[argPort + 1] : (process.env.PORT ?? 2567));
const server = createGraaoServer();

const latency = Number(process.env.SIMULATE_LATENCY_MS ?? 0);
if (latency > 0) {
  server.simulateLatency(latency);
  log('simulated latency', { ms: latency });
}

// Build the shared world before accepting players so the first room opens instantly.
await getWorld();
await server.listen(PORT);
log('server listening', { port: PORT, protocol: PROTOCOL_VERSION, version: CLIENT_VERSION });
