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
  /** RESULTS: this player wants to go back to the lobby now (the room returns once everyone asked, or on the timer). */
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
  /** Private answer to every ABILITY_REQUEST (accepted or refused, with the reason). */
  ABILITY_RESULT: 108,
  /** Ability Draft state, per player (each one only learns its own hidden choice). */
  DRAFT_STATE: 109,
  /** Server-authoritative summary of a finished match (sent once, when RESULTS starts). */
  MATCH_SUMMARY: 110,
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

/**
 * Where a match participant is in the UFO deployment: aboard (riding, not simulated), diving (radial fall under the
 * player's control) or landed. NONE outside a deployment (warmup, late joiners, rooms that skip the UFO).
 */
export const DeployState = {
  NONE: 0,
  SHIP: 1,
  DIVING: 2,
  LANDED: 3,
} as const;
export type DeployState = (typeof DeployState)[keyof typeof DeployState];

/** Semantic locomotion state; clients choose animation clips from it (never from streamed bones). */
export const MovementState = {
  IDLE: 0,
  WALK: 1,
  RUN: 2,
  SPRINT: 3,
  JUMP: 4,
  FALL: 5,
  /** In deep water (moving or treading): also how a snapshot tells the client that the character swims. */
  SWIM: 6,
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
  /** Create only: computer opponents in a private solo room (0 keeps a regular room). */
  soloBots?: number;
  /** Dev/tests only (ignored in production): ability ids for slots 1–4 instead of the default loadout. */
  loadout?: string[];
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
 * - flags: bit 0 grounded, bit 1 alive, bit 2 aiming, bit 3 aboard the UFO, bit 4 diving, bit 5 double jump used.
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
  /** Riding the UFO: not simulated, drawn inside the ship (position = the ship's). */
  ON_SHIP: 1 << 3,
  /** Skydiving after the jump (until the first ground contact). */
  DIVING: 1 << 4,
  /** The double jump of this flight is spent: the owner's prediction must not grant it again, others flip once. */
  AIR_JUMPED: 1 << 5,
  /** Outside the Tormenta's safe region, by the server's own test (the one that decides the damage). */
  IN_TORMENTA: 1 << 6,
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
  /** Computer-controlled opponent in a solo room. */
  bot?: boolean;
  /** Live scoreboard state, owned by the match server. */
  alive?: boolean;
  damageDealt?: number;
  appearance: CharacterAppearance;
  ready: boolean;
  connected: boolean;
  /** Connection lost: the seat is kept for RECONNECT_SECONDS while the client tries to come back. */
  dropped?: boolean;
  /** Takes part in the current match (false for late joiners and in warmup). */
  inMatch: boolean;
  /** Eliminations in the current match (warmup: since joining). */
  kills: number;
  deaths: number;
  /** Ability ids for keys 1, 2, 3 (basics) and 4 (Ultimate). Public like draft picks; the Ultimate drives the mark. */
  loadout: string[];
  /** UFO deployment progress (aboard / diving / landed); NONE outside a deployment. */
  deploy: DeployState;
  /** Matches won in this room (the room's running score). */
  wins: number;
  /** RESULTS only: asked to go back to the lobby. */
  back: boolean;
}

/**
 * The UFO's route for one deployment, chosen by the server. Clients only derive the ship's position from it; the
 * jump-out state comes in the `jump` event. Integers only (micro-units, ms) so every side evaluates the same numbers.
 *
 * The route is a great circle of radius `r` (cm) around the planet centre. `c` is the closest approach (unit vector
 * × 1e6, over the drop zone) and `h` the direction of travel there (unit tangent × 1e6). At server time t the ship
 * is at angle θ = a0·1e-6 + w·1e-9·(t − t0) radians from `c` toward `h`. Jumps are accepted in [open, close];
 * whoever is still aboard at `close` is dropped.
 */
export interface UfoRouteMsg {
  c: [number, number, number];
  h: [number, number, number];
  r: number;
  t0: number;
  open: number;
  close: number;
  a0: number;
  w: number;
}

/**
 * One Tormenta phase, chosen by the server (MATCH only). The safe region is a spherical cap: a centre direction from
 * the planet centre and an angular radius; inside = geodesic angle to the centre < radius. Integers only (unit
 * vectors × 1e6, radii in microradians, server ms), so the server's test and every client's boundary are the same
 * numbers. Clients derive the boundary at any server time from this; nothing streams per tick.
 *
 * Phase k of n holds the circle (c, r) from t0 to `a` (the next region (tc, tr) is announced), then closes onto it
 * between `a` and `b` (centre along the great circle, radius linearly). Phase n + 1 is the final region: c = tc,
 * a = b = 0, held until the match ends. Outside the region every pulse (`every` ms, aligned to the Tormenta's start)
 * takes `dmg` Health.
 */
export interface TormentaMsg {
  k: number;
  n: number;
  c: [number, number, number];
  r: number;
  tc: [number, number, number];
  tr: number;
  t0: number;
  a: number;
  b: number;
  dmg: number;
  every: number;
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
  /** UFO phase only: the ship's route (null otherwise). */
  ufo: UfoRouteMsg | null;
  /** MATCH only: the Tormenta's current phase (null otherwise). */
  tormenta: TormentaMsg | null;
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

/** NOTICE codes the client reacts to (the text is for display). */
export const NoticeCode = {
  /** The finished match was written to this player's history (Supabase). */
  MATCH_SAVED: 'MATCH_SAVED',
} as const;

// ------------------------------------------------------------------------------------------------ match summary

/** One participant's line in a match summary. Every number is the server's own count, never a client's claim. */
export interface MatchSummaryLine {
  index: number;
  name: string;
  /** 1 = winner. Players knocked out at the same moment share a placement (a draw ties everyone). */
  placement: number;
  won: boolean;
  kills: number;
  deaths: number;
  damageDealt: number;
  damageTaken: number;
  /** Weapon shots fired, and how many of them touched a player (accuracy = hits / shots). */
  shots: number;
  hits: number;
  abilitiesCast: number;
  /** Ability ids for keys 1–4 in this match. */
  loadout: string[];
  /** Left the room before the end. */
  left: boolean;
}

/** MATCH_SUMMARY: sent to everyone when a match ends, before (and whatever happens to) its persistence. */
export interface MatchSummaryMsg {
  code: string;
  /** Winner's player index, -1 for a draw. */
  winner: number;
  /** Server times: boarding (or the match start without the UFO) and the end. */
  startedAt: number;
  endedAt: number;
  durationMs: number;
  /** Best placement first. */
  players: MatchSummaryLine[];
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
  /** Current Mana (integer, floor of the server value). Also in every snapshot. */
  mana: number;
  /** Server time when each loadout slot's cooldown ends (0 = ready). Never decided by the HUD. */
  cd: number[];
  /** Server time when the current cast wind-up ends (0 = not casting). */
  castUntil: number;
  /** Last ABILITY_REQUEST sequence the server handled. */
  abilitySeq: number;
  /** Server time when the current slow ends (0 = not slowed) and its speed factor × 100. */
  slowUntil: number;
  slow: number;
}

// ------------------------------------------------------------------------------------------------ abilities

/** Why the server refused an ability (sent in ABILITY_RESULT). */
export const AbilityReject = {
  OK: 0,
  DEAD: 1,
  NOT_OWNED: 2,
  /** Countdown, results, or not taking part in the match. */
  PHASE: 3,
  /** Another cast is winding up. */
  BUSY: 4,
  COOLDOWN: 5,
  NO_MANA: 6,
  OUT_OF_RANGE: 7,
  BAD_TARGET: 8,
  /** No line of sight from the caster to the target point. */
  BLOCKED: 9,
  /** Older than a request already handled. */
  STALE: 10,
} as const;
export type AbilityReject = (typeof AbilityReject)[keyof typeof AbilityReject];

/**
 * ABILITY_REQUEST intent: `{ s, k, a, c, d?, p? }`
 * - s: ability request sequence (per client, increasing)
 * - k: loadout slot 0–3 (keys 1, 2, 3, 4) and a: the ability id the client believes is there (ownership check)
 * - c: the client's next movement command sequence: dashes start exactly at that command on both sides
 * - d: direction × 10000 (projectiles: from the cast origin toward the aim; dashes: the move direction)
 * - p: target point in mm (point abilities; validated for range, surface and line of sight)
 */
export interface AbilityRequestMsg {
  s: number;
  k: number;
  a: string;
  c: number;
  d?: [number, number, number];
  p?: [number, number, number];
}

export interface AbilityResultMsg {
  s: number;
  k: number;
  ok: boolean;
  r: AbilityReject;
}

// ------------------------------------------------------------------------------------------------ ability draft

/** Why the server refused a DRAFT_PICK (the next DRAFT_STATE to the picker always shows what it holds). */
export const DraftReject = {
  OK: 0,
  /** No draft running, or between rounds (reveal). */
  NOT_DRAFTING: 1,
  /** The pick names another round. */
  WRONG_ROUND: 2,
  /** Not offered this round (wrong slot type or unknown id). */
  NOT_IN_POOL: 3,
  /** Already owned by another player (unique draft). */
  TAKEN: 4,
  /** Already in this player's loadout. */
  ALREADY_OWNED: 5,
  /** This player already has this round's ability (or is not in the draft). */
  NOT_PICKING: 6,
} as const;
export type DraftReject = (typeof DraftReject)[keyof typeof DraftReject];

/** DRAFT_PICK intent: `{ r, a }` — the round the client is looking at and the ability id it wants. */
export interface DraftPickMsg {
  r: number;
  a: string;
}

export type DraftKind = 'basic' | 'ultimate';
export type DraftStage = 'pick' | 'reveal' | 'done';

export interface DraftSeatPublic {
  index: number;
  /** Abilities already won, in round order (public: everyone sees each round once it resolves). */
  picks: string[];
  /** Must choose in the current window (has not got this round's ability yet). */
  picking: boolean;
  /** Has a hidden choice waiting for the round to resolve (what it is stays private). */
  locked: boolean;
}

/**
 * Ability Draft state for one player. Rounds are simultaneous and hidden: everyone chooses, then the round resolves.
 * When two players want the same ability, the one with priority this round keeps it and the other repicks at once.
 */
export interface DraftStateMsg {
  /** Current round, 0-based (equals `rounds` once done). */
  round: number;
  rounds: number;
  kind: DraftKind;
  stage: DraftStage;
  /** Server time when the current pick window or reveal ends. */
  endsAt: number;
  /** Player indices by priority this round, best first. */
  priority: number[];
  /** Ability ids offered this round. */
  pool: string[];
  /** No duplicate ownership this round (pool large enough for every seat). */
  unique: boolean;
  /** Every ability won so far and its owner's index. */
  owners: [string, number][];
  seats: DraftSeatPublic[];
  /** This player's hidden choice in the current window (null = none yet). */
  mine: string | null;
  /** This player lost a conflict this round and must choose again. */
  repick: boolean;
  /** Who kept the ability this player wanted (with `repick`). */
  lostTo: { index: number; a: string } | null;
  /** Reveal: what each player got this round; `contested` = it was disputed, `auto` = chosen when time ran out. */
  reveal: { index: number; a: string; auto: boolean; contested: boolean }[];
}

export type StatusFx = 'shield' | 'heal' | 'slow' | 'knock' | 'dash';

/**
 * What hurt a player when nobody did (`by` = the target itself): the Tormenta. Self damage without a cause is
 * drowning.
 */
export type DamageCause = 'tormenta';

export type GameEvent =
  /** A shot happened. `to` are impact points (mm); `t` is the target index or -1 for world. */
  | { e: 'shot'; by: number; w: number; s: number; from: [number, number, number]; to: [number, number, number][]; t: number[] }
  /** Damage dealt by `by` to `target`; kinds is the hit taxonomy. */
  | { e: 'dmg'; by: number; target: number; amount: number; kinds: HitKind[]; health: number; shield: number; a?: string; c?: DamageCause }
  /** An ability was accepted: everyone plays the cast; `until` is when the wind-up ends (server time). */
  | { e: 'cast'; by: number; a: string; k: number; s: number; until: number; d?: [number, number, number]; p?: [number, number, number] }
  /** A server projectile was launched (`v` in cm/s; gravity and radius come from the ability definition). */
  | { e: 'proj'; id: number; by: number; a: string; s: number; from: [number, number, number]; v: [number, number, number] }
  /** A projectile ended: hit a player (`t` ≥ 0), the world (`t` = -1) or expired (`t` = -2). */
  | { e: 'projEnd'; id: number; at: [number, number, number]; t: number }
  /** An area pulse resolved at `at` (mm) with radius `r` (cm); `n` counts pulses from 0. */
  | { e: 'area'; by: number; a: string; at: [number, number, number]; r: number; n: number }
  /** A status effect landed on `target` (shield/heal amount, slow/dash duration ms, knock speed). */
  | { e: 'fx'; by: number; target: number; k: StatusFx; v: number }
  | { e: 'elim'; by: number; target: number; c?: DamageCause }
  | { e: 'respawn'; target: number }
  | { e: 'reload'; by: number; w: number }
  /**
   * `target` left the UFO (UFO_JUMP, or dropped when the window closed). `at` (mm) and `v` (cm/s) are the exact
   * start of the dive the server simulates; the jumper's client starts predicting from them.
   */
  | { e: 'jump'; target: number; at: [number, number, number]; v: [number, number, number]; auto: boolean }
  /** `target` touched the ground after a dive (`water` = in a lake or the sea). */
  | { e: 'land'; target: number; at: [number, number, number]; water: boolean };

export interface EventsMsg {
  t: number;
  ev: GameEvent[];
}
