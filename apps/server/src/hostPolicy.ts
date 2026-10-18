/**
 * How this process hosts rooms — the only place where the dedicated server and the Graao Host differ. Gameplay never
 * asks; the room consults this policy when a room is created, when someone joins (who is the host) and when the host
 * leaves.
 *
 * - DEDICATED (default; development, tests, a hosted server, the browser-hosted worker): any client may create rooms;
 *   the first person in a room is its host; the room closes when the host leaves and disposes itself when empty.
 * - DESKTOP (`HOST_MODE=DESKTOP`, alias `GRAAO_HOST_MODE=LOCAL_PLAYER_HOST`; the Graao Host app on a player's PC): the
 *   process opens exactly one room on the app's command (a create from the network is refused); the host is whoever
 *   proves the session's owner key; the room outlives the host's browser tab and closes only when the app stops.
 *
 * Web Crypto only (no `node:crypto`): this module also runs inside the browser-hosted room worker.
 */
import { ServerError } from '@colyseus/core';
import { HOST_CREATE_KEY_OPTION, sha256Hex } from '@graao/shared';

export type HostMode = 'DEDICATED' | 'DESKTOP';

export function hostModeFromEnv(env: Record<string, string | undefined> = process.env): HostMode {
  if ((env.HOST_MODE ?? '').toUpperCase() === 'DESKTOP') return 'DESKTOP';
  if ((env.GRAAO_HOST_MODE ?? '').toUpperCase() === 'LOCAL_PLAYER_HOST') return 'DESKTOP';
  return 'DEDICATED';
}

interface PolicyState {
  mode: HostMode;
  /** DESKTOP: SHA-256 (hex) of the secret only this process knows; room creation must carry the secret. */
  createKeyHash: string;
}

const state: PolicyState = { mode: 'DEDICATED', createKeyHash: '' };

/** Equal hex digests, without an early exit. */
function sameDigest(a: string, b: string): boolean {
  if (a.length !== b.length || !a) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const HEX64 = /^[0-9a-f]{64}$/;

export async function configureHostPolicy(p: { mode: HostMode; createKey?: string }): Promise<void> {
  state.mode = p.mode;
  state.createKeyHash = p.createKey ? await sha256Hex(p.createKey) : '';
}

export const hostPolicy = {
  get mode(): HostMode {
    return state.mode;
  },

  /** Rooms dispose themselves when empty (dedicated) or stay until the app closes them (desktop). */
  get autoDispose(): boolean {
    return state.mode === 'DEDICATED';
  },

  /** The host leaving ends the room (dedicated) or just frees their seat (desktop: the app keeps hosting). */
  get closesWithHost(): boolean {
    return state.mode === 'DEDICATED';
  },

  /** Throws unless these create options may open a room in this process. */
  async admitCreate(options: Record<string, unknown> | undefined): Promise<void> {
    if (state.mode !== 'DESKTOP') return;
    const key = options?.[HOST_CREATE_KEY_OPTION];
    const ok = typeof key === 'string' && key.length <= 256 && state.createKeyHash !== '' && sameDigest(await sha256Hex(key), state.createKeyHash);
    if (!ok) throw new ServerError(4003, 'Salas deste host são abertas pelo aplicativo Graao Host.');
  },

  /**
   * Is this joiner the room's host? `null` = this process has no notion of an owner (dedicated: the first person in
   * becomes the host); `true`/`false` = whether the join options carry the owner key whose SHA-256 (hex) the app gave
   * the room when it opened it.
   */
  async ownerJoin(options: { hostKey?: unknown } | undefined, ownerKeyHash: string): Promise<boolean | null> {
    if (state.mode !== 'DESKTOP') return null;
    const key = options?.hostKey;
    if (typeof key !== 'string' || key.length > 256 || !HEX64.test(ownerKeyHash)) return false;
    return sameDigest(await sha256Hex(key), ownerKeyHash);
  },
};
