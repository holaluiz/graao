/**
 * What the app keeps on disk (its own folder under %APPDATA%): settings, and this installation's identity — the central
 * id and a local secret that proves to the central service this is the same PC. The secret is encrypted with the OS
 * user's key (Electron `safeStorage`, DPAPI on Windows) when available. No session or tunnel token is ever stored.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomSecret } from '@graao/shared';
import { DEFAULT_SETTINGS, type HostIdentity, type HostSettings, type IdentityStore } from './types';

export interface SecretBox {
  available: boolean;
  encrypt(s: string): Buffer;
  decrypt(b: Buffer): string;
}

const PLAIN: SecretBox = { available: false, encrypt: (s) => Buffer.from(s, 'utf8'), decrypt: (b) => b.toString('utf8') };

function readJson(path: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Write to a temporary file then rename, so a crash never leaves half a file. */
function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(tmp, path);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createIdentityStore(dir: string, box: SecretBox = PLAIN): IdentityStore {
  const path = join(dir, 'identity.json');
  const fresh = (): HostIdentity => {
    const id = { installationId: null, installSecret: randomSecret(32) };
    save(id);
    return id;
  };
  const save = (id: HostIdentity) => {
    const sealed = box.available ? { enc: 'os', secret: box.encrypt(id.installSecret).toString('base64') } : { enc: 'plain', secret: id.installSecret };
    writeJson(path, { installationId: id.installationId, ...sealed });
  };
  return {
    load(): HostIdentity {
      const j = readJson(path);
      if (!j || typeof j.secret !== 'string') return fresh();
      try {
        const installSecret = j.enc === 'os' ? box.decrypt(Buffer.from(j.secret, 'base64')) : j.secret;
        if (installSecret.length < 32) return fresh();
        return { installationId: typeof j.installationId === 'string' && UUID.test(j.installationId) ? j.installationId : null, installSecret };
      } catch {
        // Another OS user or a broken file: this PC must be linked again.
        return fresh();
      }
    },
    save,
    reset: fresh,
  };
}

export function loadSettings(dir: string): HostSettings {
  const j = readJson(join(dir, 'settings.json')) ?? {};
  return {
    launchAtLogin: j.launchAtLogin === true,
    minimizeToTray: j.minimizeToTray !== false,
    devPanel: j.devPanel === true,
  };
}

export function saveSettings(dir: string, s: HostSettings): void {
  writeJson(join(dir, 'settings.json'), { ...DEFAULT_SETTINGS, ...s });
}
