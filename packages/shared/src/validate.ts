/** Runtime validation of untrusted client messages. Every handler on the server goes through one of these. */
import { DISPLAY_NAME_MAX, MAX_INPUT_BACKLOG } from './constants';
import { isAppearanceShape } from './appearance';
import { AIM_SCALE, WISH_SCALE, type InputCmd, type InputMsg, type PingMsg, type AppearanceUpdateMsg } from './protocol';

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

export function validateSwitch(m: unknown): import('./protocol').SwitchWeaponMsg | null {
  if (!m || typeof m !== 'object') return null;
  const w = (m as { w?: unknown }).w;
  return w === 0 || w === 1 ? { w } : null;
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
