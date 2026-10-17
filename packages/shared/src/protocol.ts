/**
 * graao network protocol. Every message type lives here; no magic strings elsewhere.
 *
 * Matchmaking operations (AUTH, CREATE_ROOM, JOIN_ROOM, LEAVE) are Colyseus room operations carrying `JoinOptions`.
 * In-room messages use small numeric type ids (cheaper on the wire than strings) and compact array payloads for
 * high-frequency traffic (inputs, snapshots). Clients only ever send *intent*.
 */
import type { CharacterAppearance } from './appearance';

/** Client → server message ids. */
export const C2S = {
  READY: 1,
  APPEARANCE_UPDATE: 2,
  DRAFT_PICK: 3,
  PLAYER_INPUT: 4,
  FIRE: 5,
  RELOAD: 6,
  SWITCH_WEAPON: 7,
  ABILITY_REQUEST: 8,
  UFO_JUMP: 9,
  PING: 10,
  RETURN_LOBBY: 11,
  START_MATCH: 12,
} as const;
export type C2SType = (typeof C2S)[keyof typeof C2S];

/** Server → client message ids. */
export const S2C = {
  WELCOME: 101,
  ROOM_STATE: 102,
  SNAPSHOT: 103,
  EVENTS: 104,
  PONG: 105,
  NOTICE: 106,
  SELF: 107,
} as const;
export type S2CType = (typeof S2C)[keyof typeof S2C];

/** Reasons the server refuses a join. Sent as the ServerError message prefix. */
export const JoinError = {
  VERSION_MISMATCH: 'VERSION_MISMATCH',
  ROOM_FULL: 'ROOM_FULL',
  IN_PROGRESS: 'IN_PROGRESS',
  BAD_APPEARANCE: 'BAD_APPEARANCE',
  AUTH_FAILED: 'AUTH_FAILED',
} as const;

/** Match phases owned by the server. The client HUD director maps them to presentation phases. */
export const MatchPhase = {
  LOBBY: 0,
  ABILITY_DRAFT: 1,
  UFO: 2,
  MATCH: 3,
  RESULTS: 4,
  /** Free roam: everyone spawns on the planet immediately (Phase 1–2 vertical slices and dev). */
  FREE_ROAM: 9,
} as const;
export type MatchPhase = (typeof MatchPhase)[keyof typeof MatchPhase];

/** Semantic locomotion state; clients choose animation clips from it (never from streamed bones). */
export const MovementState = {
  IDLE: 0,
  WALK: 1,
  RUN: 2,
  SPRINT: 3,
  JUMP: 4,
  FALL: 5,
} as const;
export type MovementState = (typeof MovementState)[keyof typeof MovementState];

/** Semantic action state layered over locomotion. */
export const ActionState = {
  NONE: 0,
  FIRE: 1,
  RELOAD: 2,
  CAST: 3,
  ULTIMATE: 4,
  HIT: 5,
  DEAD: 6,
} as const;
export type ActionState = (typeof ActionState)[keyof typeof ActionState];

/** Bit flags packed into one integer per input command. */
export const InputButton = {
  JUMP: 1 << 0,
  SPRINT: 1 << 1,
  AIM: 1 << 2,
  FIRE: 1 << 3,
} as const;

// ------------------------------------------------------------------------------------------------ join

/** Options sent with Colyseus `create` / `joinById`. */
export interface JoinOptions {
  protocol: number;
  client: string;
  name: string;
  appearance: CharacterAppearance;
  /** Supabase access token in production; absent for DEV GUEST. */
  token?: string;
}

/** First message after joining. Carries the server clock and rates so the client can sync. */
export interface WelcomeMsg {
  you: string;
  index: number;
  code: string;
  serverTime: number;
  protocol: number;
  server: string;
  tickHz: number;
  snapshotHz: number;
}

// ------------------------------------------------------------------------------------------------ input

/**
 * One fixed-step movement command (SIM_HZ). Compact tuple:
 * `[seq, wishX, wishY, wishZ, aimX, aimY, aimZ, buttons]`
 * - wish: world-space desired move direction × 127 (ints in [-127, 127]); the server re-projects it onto its own
 *   tangent plane and clamps the length, so a client can choose a direction but never a speed.
 * - aim: world-space camera aim direction × 1000 (ints).
 */
export type InputCmd = [number, number, number, number, number, number, number, number];

export interface InputMsg {
  /** Commands in ascending seq order (usually 2–3 per message). */
  i: InputCmd[];
}

export const WISH_SCALE = 127;
export const AIM_SCALE = 1000;

// ------------------------------------------------------------------------------------------------ snapshot

/**
 * Per-player snapshot tuple (broadcast once per SNAPSHOT_HZ to everyone; each client reads its own ack from it):
 * `[index, px, py, pz, vx, vy, vz, fx, fy, fz, aimPitch, moveState, actionState, flags, ackSeq, health, shield, mana, weapon, simDt]`
 * - p: position in millimetres (ints).  v: velocity in cm/s (ints).
 * - f: facing tangent × 127.  aimPitch: radians × 100 relative to the local horizon.
 * - flags: bit 0 grounded, bit 1 alive, bit 2 aiming.
 * - simDt: ms between the snapshot time and the moment this player's simulated state is valid (≤ 0). Each player is
 *   simulated in whole 1/60 s commands, so remotes interpolate on this per-player clock to move perfectly evenly.
 */
export type PlayerSnap = [
  number, number, number, number, number, number, number, number, number, number,
  number, number, number, number, number, number, number, number, number, number,
];

export const SnapFlag = {
  GROUNDED: 1 << 0,
  ALIVE: 1 << 1,
  AIMING: 1 << 2,
} as const;

export const POS_SCALE = 1000;
export const VEL_SCALE = 100;
export const FACING_SCALE = 127;
export const PITCH_SCALE = 100;

export interface SnapshotMsg {
  /** Server time (ms since epoch) when the snapshot was taken. */
  t: number;
  /** Server tick number. */
  k: number;
  p: PlayerSnap[];
}

// ------------------------------------------------------------------------------------------------ room state

export interface PlayerPublic {
  index: number;
  sessionId: string;
  name: string;
  appearance: CharacterAppearance;
  ready: boolean;
  connected: boolean;
  /** Takes part in the current match (false for late joiners and in warmup). */
  inMatch: boolean;
  /** Eliminations in the current match (warmup: since joining). */
  kills: number;
  deaths: number;
}

/** Reliable, sent when something non-positional changes. */
export interface RoomStateMsg {
  code: string;
  phase: MatchPhase;
  /** Server time when the current phase ends (RESULTS → warmup), 0 when open-ended. */
  phaseEndsAt: number;
  /** MATCH only: server time when fighting starts (countdown before it; weapons locked). */
  startsAt: number;
  /** RESULTS only: winner's player index, -1 for a draw / none. */
  winner: number;
  players: PlayerPublic[];
}

/** READY toggle (warmup): `{ r: 1 }` ready, `{ r: 0 }` not ready. */
export interface ReadyMsg {
  r: number;
}

export interface PingMsg {
  /** Client clock when sent. */
  c: number;
}

export interface PongMsg {
  c: number;
  /** Server clock when answered. */
  t: number;
  /** Average server tick CPU cost (ms). */
  tick: number;
}

export interface AppearanceUpdateMsg {
  appearance: CharacterAppearance;
}

export interface NoticeMsg {
  kind: 'info' | 'error';
  code: string;
  text: string;
}

// ------------------------------------------------------------------------------------------------ combat

/** Hit feedback taxonomy (each kind has its own shape in the HUD, never color only). */
export const HitKind = {
  BODY: 0,
  CRITICAL: 1,
  SHIELD: 2,
  SHIELD_BREAK: 3,
  ABILITY: 4,
  ELIMINATION: 5,
} as const;
export type HitKind = (typeof HitKind)[keyof typeof HitKind];

/**
 * FIRE intent: `{ s, w, o, d, a }`
 * - s: shot sequence (per client, increasing; seeds the deterministic spread)
 * - w: weapon slot (0 = E, 1 = Q)
 * - o: camera origin in mm (the server clamps it near the shooter)
 * - d: aim direction × 10000
 * - a: 1 when aiming down the sights
 */
export interface FireMsg {
  s: number;
  w: number;
  o: [number, number, number];
  d: [number, number, number];
  a: number;
}
export const DIR_SCALE = 10000;

export interface SwitchWeaponMsg {
  w: number;
}

/** Private per-player status (sent only to that player when it changes). */
export interface SelfStatusMsg {
  weapon: number;
  ammo: number[];
  reloading: boolean;
  /** Server time when the reload finishes (0 when not reloading). */
  reloadEndsAt: number;
  alive: boolean;
  respawnAt: number;
  /** Last FIRE sequence the server handled (accepted or refused): newer local shots are still in flight. */
  shotSeq: number;
}

export type GameEvent =
  /** A shot happened. `to` are impact points (mm); `t` is the target index or -1 for world. */
  | { e: 'shot'; by: number; w: number; s: number; from: [number, number, number]; to: [number, number, number][]; t: number[] }
  /** Damage dealt by `by` to `target`; kinds is the hit taxonomy. */
  | { e: 'dmg'; by: number; target: number; amount: number; kinds: HitKind[]; health: number; shield: number }
  | { e: 'elim'; by: number; target: number }
  | { e: 'respawn'; target: number }
  | { e: 'reload'; by: number; w: number };

export interface EventsMsg {
  t: number;
  ev: GameEvent[];
}
