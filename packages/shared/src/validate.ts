/** Runtime validation of untrusted client messages. Every handler on the server goes through one of these. */
import { DISPLAY_NAME_MAX, MAX_INPUT_BACKLOG, MAX_PLAYERS, MAX_SOLO_BOTS, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, ROOM_CODE_PREFIX } from './constants';
import { isAppearanceShape } from './appearance';
import { AIM_SCALE, MatchPhase, WISH_SCALE, type InputCmd, type InputMsg, type PingMsg, type AppearanceUpdateMsg, type RoomListing } from './protocol';
import { PROTOCOL_VERSION } from './version';

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);

export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // Letters, digits, spaces and a few symbols; collapse whitespace; strip control characters.
  const s = raw
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N} _.-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, DISPLAY_NAME_MAX);
  return s.length >= 1 ? s : null;
}

export function validateInputCmd(c: unknown): InputCmd | null {
  if (!Array.isArray(c) || c.length !== 8) return null;
  for (const n of c) if (!isInt(n)) return null;
  const [seq, wx, wy, wz, ax, ay, az, b] = c as number[];
  if (seq! < 0 || seq! > 0x7fffffff) return null;
  if (Math.abs(wx!) > WISH_SCALE || Math.abs(wy!) > WISH_SCALE || Math.abs(wz!) > WISH_SCALE) return null;
  if (Math.abs(ax!) > AIM_SCALE || Math.abs(ay!) > AIM_SCALE || Math.abs(az!) > AIM_SCALE) return null;
  if (b! < 0 || b! > 0xff) return null;
  return c as InputCmd;
}

export function validateInputMsg(m: unknown): InputMsg | null {
  if (!m || typeof m !== 'object') return null;
  const i = (m as { i?: unknown }).i;
  if (!Array.isArray(i) || i.length === 0 || i.length > MAX_INPUT_BACKLOG) return null;
  const out: InputCmd[] = [];
  for (const c of i) {
    const v = validateInputCmd(c);
    if (!v) return null;
    out.push(v);
  }
  return { i: out };
}

export function validatePing(m: unknown): PingMsg | null {
  if (!m || typeof m !== 'object') return null;
  const c = (m as { c?: unknown }).c;
  return typeof c === 'number' && Number.isFinite(c) ? { c } : null;
}

export function validateAppearanceUpdate(m: unknown): AppearanceUpdateMsg | null {
  if (!m || typeof m !== 'object') return null;
  const a = (m as { appearance?: unknown }).appearance;
  return isAppearanceShape(a) ? { appearance: { ...a } } : null;
}

export function validateFire(m: unknown): import('./protocol').FireMsg | null {
  if (!m || typeof m !== 'object') return null;
  const o = m as Record<string, unknown>;
  const ints = (v: unknown, n: number, max: number) =>
    Array.isArray(v) && v.length === n && v.every((x) => isInt(x) && Math.abs(x as number) <= max);
  if (!isInt(o.s) || (o.s as number) < 0 || (o.s as number) > 0x7fffffff) return null;
  if (o.w !== 0 && o.w !== 1) return null;
  if (!ints(o.o, 3, 1_000_000) || !ints(o.d, 3, 10000)) return null;
  const d = o.d as number[];
  const len = Math.hypot(d[0]!, d[1]!, d[2]!);
  if (len < 9000 || len > 11000) return null;
  return { s: o.s as number, w: o.w as number, o: o.o as [number, number, number], d: d as [number, number, number], a: o.a === 1 ? 1 : 0 };
}

export function validateReady(m: unknown): import('./protocol').ReadyMsg | null {
  if (!m || typeof m !== 'object') return null;
  const r = (m as { r?: unknown }).r;
  return r === 0 || r === 1 ? { r } : null;
}

export function validateRoomSettings(m: unknown): import('./protocol').RoomSettingsMsg | null {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  const bots = (m as { bots?: unknown }).bots;
  return isInt(bots) && bots >= 0 && bots <= MAX_SOLO_BOTS ? { bots } : null;
}

const ROOM_CODE = new RegExp(`^${ROOM_CODE_PREFIX}[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);
const PHASES = new Set<number>(Object.values(MatchPhase));
const cleanText = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\p{Cc}/gu, '').replace(/\s+/g, ' ').trim().slice(0, max) : '');

/**
 * One line of the room browser, from an untrusted source (the server's `/rooms`, or a host's own announcement).
 * Seat counts must add up within the capacity; closed rooms are dropped. A room speaking another protocol is kept
 * (the browser shows it as another version), never offered as available.
 */
export function parseRoomListing(raw: unknown): RoomListing | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const count = (v: unknown, max: number) => (isInt(v) && v >= 0 && v <= max ? v : -1);
  const code = typeof o.code === 'string' ? o.code.toUpperCase() : '';
  const humans = count(o.humans, MAX_PLAYERS);
  const botsDesired = count(o.botsDesired, MAX_SOLO_BOTS);
  const botsPlanned = count(o.botsPlanned, MAX_SOLO_BOTS);
  const capacity = count(o.capacity, MAX_PLAYERS);
  const phase = o.phase;
  if (!ROOM_CODE.test(code) || o.visibility !== 'public' || typeof o.hostSessionId !== 'string' || !o.hostSessionId) return null;
  if (humans < 1 || botsDesired < 0 || botsPlanned < 0 || capacity < 2 || humans + botsPlanned > capacity) return null;
  if (!isInt(phase) || !PHASES.has(phase) || phase === MatchPhase.CLOSED || !isInt(o.protocol)) return null;
  const region = cleanText(o.region, 32);
  return {
    code,
    name: cleanText(o.name, 56) || `Sala ${code}`,
    visibility: 'public',
    hostSessionId: o.hostSessionId.slice(0, 64),
    hostName: sanitizeName(o.hostName) ?? 'Jogador',
    humans,
    botsDesired,
    botsPlanned,
    capacity,
    protocol: o.protocol,
    phase: phase as MatchPhase,
    available: o.available === true && o.protocol === PROTOCOL_VERSION && phase === MatchPhase.LOBBY && humans < capacity,
    canStart: o.canStart === true,
    startReason: cleanText(o.startReason, 160),
    ...(region ? { region } : {}),
  };
}

export function validatePrepared(m: unknown): import('./protocol').PreparedMsg | null {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  const o = m as Record<string, unknown>;
  if (!isInt(o.id) || o.id < 1 || typeof o.ok !== 'boolean') return null;
  return { id: o.id, ok: o.ok, ...(typeof o.error === 'string' ? { error: o.error.slice(0, 160) } : {}) };
}

export function validateSwitch(m: unknown): import('./protocol').SwitchWeaponMsg | null {
  if (!m || typeof m !== 'object') return null;
  const w = (m as { w?: unknown }).w;
  return w === 0 || w === 1 || w === 2 ? { w } : null;
}

/** MELEE shape check (reach, direction, walls, interval and empty hands are the room's job). */
export function validateMelee(m: unknown): import('./protocol').MeleeMsg | null {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  const o = m as Record<string, unknown>;
  const ints = (v: unknown, n: number, max: number) =>
    Array.isArray(v) && v.length === n && v.every((x) => isInt(x) && Math.abs(x as number) <= max);
  if (!isInt(o.s) || (o.s as number) < 0 || (o.s as number) > 0x7fffffff) return null;
  if (!ints(o.o, 3, 1_000_000) || !ints(o.d, 3, 10000)) return null;
  const d = o.d as number[];
  const len = Math.hypot(d[0]!, d[1]!, d[2]!);
  if (len < 9000 || len > 11000) return null;
  return { s: o.s as number, o: o.o as [number, number, number], d: d as [number, number, number] };
}

/** ALLOCATE_STAT shape check (points left and the match phase are the room's job). */
export function validateAllocateStat(m: unknown): import('./protocol').AllocateStatMsg | null {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  const o = m as Record<string, unknown>;
  if (!isInt(o.s) || (o.s as number) < 0 || (o.s as number) > 0x7fffffff) return null;
  if (!isInt(o.k) || (o.k as number) < 0 || (o.k as number) > 7) return null;
  return { s: o.s as number, k: o.k as number };
}

/** DRAFT_PICK shape check (pool, ownership and round are the draft's job). */
export function validateDraftPick(m: unknown): import('./protocol').DraftPickMsg | null {
  if (!m || typeof m !== 'object') return null;
  const o = m as Record<string, unknown>;
  if (!isInt(o.r) || (o.r as number) < 0 || (o.r as number) > 16) return null;
  if (typeof o.a !== 'string' || o.a.length > 24 || !/^[a-z_]+$/.test(o.a)) return null;
  return { r: o.r as number, a: o.a };
}

/** ABILITY_REQUEST shape check (ownership, Mana, cooldown, range and target are the room's job). */
export function validateAbilityRequest(m: unknown): import('./protocol').AbilityRequestMsg | null {
  if (!m || typeof m !== 'object') return null;
  const o = m as Record<string, unknown>;
  const ints = (v: unknown, n: number, max: number) =>
    Array.isArray(v) && v.length === n && v.every((x) => isInt(x) && Math.abs(x as number) <= max);
  if (!isInt(o.s) || (o.s as number) < 0 || (o.s as number) > 0x7fffffff) return null;
  if (!isInt(o.c) || (o.c as number) < 0 || (o.c as number) > 0x7fffffff) return null;
  if (!isInt(o.k) || (o.k as number) < 0 || (o.k as number) > 3) return null;
  if (typeof o.a !== 'string' || o.a.length > 24 || !/^[a-z_]+$/.test(o.a)) return null;
  const out: import('./protocol').AbilityRequestMsg = { s: o.s as number, k: o.k as number, a: o.a, c: o.c as number };
  if (o.d !== undefined) {
    if (!ints(o.d, 3, 10000)) return null;
    const d = o.d as number[];
    const len = Math.hypot(d[0]!, d[1]!, d[2]!);
    if (len < 9000 || len > 11000) return null;
    out.d = d as [number, number, number];
  }
  if (o.p !== undefined) {
    if (!ints(o.p, 3, 1_000_000)) return null;
    out.p = o.p as [number, number, number];
  }
  return out;
}

/** RETURN_LOBBY carries no data: any plain object (or nothing) is accepted. */
export function validateReturnLobby(m: unknown): Record<string, never> | null {
  return m === undefined || m === null || (typeof m === 'object' && !Array.isArray(m)) ? {} : null;
}

/** UFO_JUMP carries no data (the server decides where and when the jump starts): any plain object is accepted. */
export function validateUfoJump(m: unknown): Record<string, never> | null {
  return m && typeof m === 'object' && !Array.isArray(m) ? {} : null;
}

/** INTERACT shape check (distance, state, ownership and the generation are the loot system's job). */
export function validateInteract(m: unknown): import('./protocol').InteractMsg | null {
  if (!m || typeof m !== 'object') return null;
  const o = m as Record<string, unknown>;
  if (!isInt(o.s) || (o.s as number) < 0 || (o.s as number) > 0x7fffffff) return null;
  if (o.k !== 0 && o.k !== 1) return null;
  if (!isInt(o.id) || (o.id as number) < 0 || (o.id as number) > 0x7fffffff) return null;
  if (!isInt(o.g) || (o.g as number) < 0 || (o.g as number) > 0x7fffffff) return null;
  if (o.w !== undefined && o.w !== 0 && o.w !== 1) return null;
  return { s: o.s as number, k: o.k, id: o.id as number, g: o.g as number, ...(o.w !== undefined ? { w: o.w as number } : {}) };
}

/** WORLD_USE shape check. */
export function validateWorldUse(m: unknown): import('./protocol').WorldUseMsg | null {
  if (!m || typeof m !== 'object') return null;
  const o = m as Record<string, unknown>;
  if (!isInt(o.s) || (o.s as number) < 0 || (o.s as number) > 0x7fffffff) return null;
  if (!isInt(o.id) || (o.id as number) < 0 || (o.id as number) > 0xffff) return null;
  if (o.k !== undefined && o.k !== 0 && o.k !== 1) return null;
  return o.k === 1 ? { s: o.s as number, id: o.id as number, k: 1 } : { s: o.s as number, id: o.id as number };
}

/** USE_ITEM shape check. */
export function validateUseItem(m: unknown): import('./protocol').UseItemMsg | null {
  if (!m || typeof m !== 'object') return null;
  const o = m as Record<string, unknown>;
  if (!isInt(o.s) || (o.s as number) < 0 || (o.s as number) > 0x7fffffff) return null;
  if (!isInt(o.c) || (o.c as number) < 0 || (o.c as number) > 7) return null;
  return { s: o.s as number, c: o.c as number };
}

/** DEV_LOOT shape check (the server also ignores it outside dev builds). */
export function validateDevLoot(m: unknown): import('./protocol').DevLootMsg | null {
  if (!m || typeof m !== 'object') return null;
  const o = m as Record<string, unknown>;
  if (o.op !== 'regen' && o.op !== 'open_all' && o.op !== 'reveal' && o.op !== 'give') return null;
  const out: import('./protocol').DevLootMsg = { op: o.op };
  if (isInt(o.seed)) out.seed = (o.seed as number) >>> 0;
  if (typeof o.item === 'string' && o.item.length <= 32 && /^[a-z_0-9]+$/.test(o.item)) out.item = o.item;
  return out;
}
