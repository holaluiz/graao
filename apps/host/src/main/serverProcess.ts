/**
 * The match server runs in its own process (never in the app's main process): Electron's `utilityProcess` in the app,
 * a Node child process in the headless runner and tests. Both speak the same control messages (`AppToServer` /
 * `ServerToApp`); the server's console goes to the app's bounded technical log.
 */
import { fork, type ChildProcess } from 'node:child_process';
import type { AppToServer, ServerToApp } from '@graao/shared';
import type { ServerHandle } from './types';

/** Environment of the server process: production rules, desktop mode, nothing from the developer's shell config. */
export function serverEnv(base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of ['SystemRoot', 'TEMP', 'TMP', 'PATH', 'Path', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA']) if (base[k]) env[k] = base[k]!;
  return { ...env, NODE_ENV: 'production', HOST_MODE: 'DESKTOP' };
}

/** Multiple listeners per event over any process-like transport. */
export function handleOf(io: {
  send(m: AppToServer): void;
  kill(): void;
  wire(onMessage: (m: unknown) => void, onExit: (code: number | null) => void): void;
}): ServerHandle {
  const msg: ((m: ServerToApp) => void)[] = [];
  const exit: ((code: number | null) => void)[] = [];
  let exited: { code: number | null } | null = null;
  io.wire(
    (m) => {
      if (m && typeof m === 'object' && typeof (m as { t?: unknown }).t === 'string') for (const cb of [...msg]) cb(m as ServerToApp);
    },
    (code) => {
      exited = { code };
      for (const cb of [...exit]) cb(code);
    },
  );
  return {
    send: (m) => {
      if (!exited) io.send(m);
    },
    onMessage: (cb) => void msg.push(cb),
    onExit: (cb) => {
      if (exited) cb(exited.code);
      else exit.push(cb);
    },
    kill: () => {
      if (!exited) io.kill();
    },
  };
}

/** Node child process (headless runner, tests). */
export function forkServer(bundlePath: string, log: (line: string) => void, env = serverEnv()): ServerHandle {
  const child: ChildProcess = fork(bundlePath, [], { env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], execArgv: [] });
  const pipe = (d: Buffer) => d.toString().split(/\r?\n/).filter(Boolean).forEach((l) => log(`servidor: ${l}`));
  child.stdout?.on('data', pipe);
  child.stderr?.on('data', pipe);
  return handleOf({
    send: (m) => child.send(m),
    kill: () => child.kill(),
    wire: (onMessage, onExit) => {
      child.on('message', onMessage);
      child.once('exit', (code) => onExit(code));
      child.once('error', () => onExit(-1));
    },
  });
}
