/** Authoritative server simulation rate (hypothesis, measured in the F3 overlay). */
export const SERVER_TICK_HZ = 20;
export const SERVER_TICK_MS = 1000 / SERVER_TICK_HZ;

/** Fixed movement step used by both client prediction and server simulation. */
export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;

/** Snapshots per second sent to clients. */
export const SNAPSHOT_HZ = 20;

/** Jitter margin: remotes render this far behind their newest expected sample (on top of measured lag). */
export const INTERPOLATION_DELAY_MS = 70;

/** Legacy 1v1 size for callers that explicitly request a smaller room. */
export const MVP_PLAYERS = 2;
/** Default and maximum participants per room, including bots. */
export const MAX_PLAYERS = 10;
/** Solo rooms reserve one human seat; the remaining seats may be bots. */
export const MAX_SOLO_BOTS = MAX_PLAYERS - 1;

/**
 * A player whose connection drops keeps their seat (and their character, in a match) this long while the client
 * reconnects (Wi-Fi handover, a sleeping laptop, a router hiccup). After that they have left for good.
 */
export const RECONNECT_SECONDS = 20;

/**
 * Inputs a client may queue ahead of the server, and the movement time it may bank while none arrive (anti speed-hack:
 * never faster than real time over this window). One second at SIM_HZ rides out a Wi-Fi or tunnel stall without
 * dropping a command: a dropped one moved the client's prediction but never the server, so it came back as a pull.
 */
export const MAX_INPUT_BACKLOG = SIM_HZ;
/** Commands one PLAYER_INPUT message may carry (the client sends at most 10). */
export const MAX_INPUT_PER_MESSAGE = 12;
/** Commands the server keeps queued per player so it can consume input at a steady rate (smooth remotes). */
export const INPUT_JITTER_BUFFER = 2;
/** Colyseus per-client message rate limit. */
export const MAX_MESSAGES_PER_SECOND = 90;

export const ROOM_NAME = 'graao_match';
export const ROOM_CODE_PREFIX = 'GR-';
export const ROOM_CODE_LENGTH = 4;
/** No 0/O/1/I/L to avoid reading mistakes. */
export const ROOM_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export const DISPLAY_NAME_MAX = 16;
