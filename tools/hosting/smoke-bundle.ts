/**
 * GATE 1 check: the bundled Graao Host server runs outside the repository with no node_modules.
 *
 *   pnpm --filter @graao/server build:desktop
 *   pnpm exec tsx tools/hosting/smoke-bundle.ts [--runtime <node or electron.exe>] [--bundle <path>]
 *
 * Copies the bundle into an empty temporary folder, starts it standalone (with ELECTRON_RUN_AS_NODE=1 when the runtime
 * is Electron), joins the room it opens with a real Colyseus client holding the owner key, checks the host seat and the
 * planned bots, and stops it. Prints one JSON line with the measurements.
 */
import { spawn } from 'node:child_process';
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { Client } from '@colyseus/sdk';
import { DEFAULT_APPEARANCE } from '@graao/game-data';
import { C2S, CLIENT_VERSION, PROTOCOL_VERSION, S2C, type RoomStateMsg } from '@graao/shared';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1]! : fallback;
};
const runtime = arg('runtime', process.execPath);
const bundle = resolve(arg('bundle', 'apps/server/dist/desktop/graao-server.mjs'));

const dir = mkdtempSync(join(tmpdir(), 'graao-host-smoke-'));
copyFileSync(bundle, join(dir, 'graao-server.mjs'));
const t0 = performance.now();
const child = spawn(runtime, ['graao-server.mjs', '--bots', '3', '--name', 'Sala fumaça'], {
  cwd: dir,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_PATH: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stderr = '';
child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));

const ready = await new Promise<{ url: string; code: string; ownerKey: string }>((res, rej) => {
  const timer = setTimeout(() => rej(new Error(`no standalone line in 30 s\n${stderr}`)), 30000);
  let buf = '';
  child.stdout.on('data', (d: Buffer) => {
    buf += d.toString();
    for (const line of buf.split('\n')) {
      if (!line.startsWith('{')) continue;
      try {
        const j = JSON.parse(line) as { standalone?: boolean; url: string; code: string; ownerKey: string };
        if (j.standalone) {
          clearTimeout(timer);
          res(j);
        }
      } catch {
        /* partial line */
      }
    }
  });
  child.once('exit', (c) => rej(new Error(`server exited (${c})\n${stderr}`)));
});
const startMs = Math.round(performance.now() - t0);

const room = await new Client(ready.url).joinById(ready.code, { protocol: PROTOCOL_VERSION, client: CLIENT_VERSION, name: 'Luiz', appearance: DEFAULT_APPEARANCE, hostKey: ready.ownerKey });
// Ask for a fresh broadcast (the one sent with the seat may arrive before the handler exists).
const state = await new Promise<RoomStateMsg>((res, rej) => {
  const timer = setTimeout(() => rej(new Error('no ROOM_STATE')), 5000);
  room.onMessage(S2C.ROOM_STATE, (m: RoomStateMsg) => {
    clearTimeout(timer);
    res(m);
  });
  room.send(C2S.ROOM_SETTINGS, { bots: 3 });
});
const health = (await (await fetch(`${ready.url.replace('ws', 'http')}/health`)).json()) as Record<string, unknown>;
await room.leave();
child.kill();
await new Promise((r) => child.once('exit', r));
const files = readdirSync(dir);
rmSync(dir, { recursive: true, force: true });

const ok = state.room?.hostSessionId === room.sessionId && state.room?.botsPlanned === 3 && health.mode === 'DESKTOP';
console.log(JSON.stringify({ ok, runtime: basename(runtime), folder: files, startMs, code: ready.code, host: state.room?.hostSessionId === room.sessionId, botsPlanned: state.room?.botsPlanned, health }));
process.exitCode = ok ? 0 : 1;
// Leftover SDK timers must not keep the check alive.
setTimeout(() => process.exit(), 200).unref();
