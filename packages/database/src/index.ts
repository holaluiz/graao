/**
 * @graao/database: the Supabase schema (`migrations/`) and the shapes that cross it. No client library here: the
 * browser talks to Supabase with supabase-js (lazily loaded), the match server with plain fetch (one RPC).
 *
 * Supabase remembers the player (profile, appearance, settings, match history); Colyseus runs the match and writes
 * its summary once, at RESULTS, through `record_match` (gated by the server secret).
 */
import type { MatchSummaryMsg } from '@graao/shared';

export const TABLES = { profiles: 'profiles' } as const;
export const RPC = { recordMatch: 'record_match', myMatches: 'my_matches' } as const;

/** `public.profiles` (one row per auth user; RLS: own row only). */
export interface ProfileRow {
  id: string;
  display_name: string;
  /** CharacterAppearance ids (validated against the catalog by whoever reads it). */
  appearance: unknown;
  settings: PlayerSettings;
  updated_at?: string;
}

/** Persisted client settings (all optional: older rows keep working). */
export interface PlayerSettings {
  quality?: string;
  fpsCap?: number;
  volume?: number;
  effectsVolume?: number;
  ambienceVolume?: number;
  sensitivity?: number;
  invertY?: boolean;
  shakeIntensity?: number;
  keyBindings?: Record<string, string>;
}

// ------------------------------------------------------------------------------------------------ record_match

/** Who a summary line was, beyond the summary itself (kept by the room, never sent by clients). */
export interface ParticipantInfo {
  /** Supabase user id validated from the join token; null for a guest. */
  profileId: string | null;
  appearance: unknown;
}

export interface RecordMatchPlayer {
  player_index: number;
  profile_id: string | null;
  display_name: string;
  placement: number;
  won: boolean;
  kills: number;
  deaths: number;
  damage_dealt: number;
  damage_taken: number;
  shots: number;
  hits: number;
  abilities_cast: number;
  loadout: string[];
  appearance: unknown;
}

export interface RecordMatchPayload {
  room_code: string;
  started_at: string;
  ended_at: string;
  duration_ms: number;
  winner_index: number;
  protocol: number;
  server_version: string;
  players: RecordMatchPlayer[];
}

/** The `p_match` argument of `record_match` for a finished match. */
export function recordMatchPayload(
  s: MatchSummaryMsg,
  who: ReadonlyMap<number, ParticipantInfo>,
  meta: { protocol: number; serverVersion: string },
): RecordMatchPayload {
  return {
    room_code: s.code,
    started_at: new Date(s.startedAt).toISOString(),
    ended_at: new Date(s.endedAt).toISOString(),
    duration_ms: Math.round(s.durationMs),
    winner_index: s.winner,
    protocol: meta.protocol,
    server_version: meta.serverVersion,
    players: s.players.map((p) => ({
      player_index: p.index,
      profile_id: who.get(p.index)?.profileId ?? null,
      display_name: p.name.slice(0, 20),
      placement: p.placement,
      won: p.won,
      kills: p.kills,
      deaths: p.deaths,
      damage_dealt: Math.round(p.damageDealt),
      damage_taken: Math.round(p.damageTaken),
      shots: p.shots,
      hits: p.hits,
      abilities_cast: p.abilitiesCast,
      loadout: [...p.loadout],
      appearance: who.get(p.index)?.appearance ?? null,
    })),
  };
}

// ------------------------------------------------------------------------------------------------ my_matches

export interface HistoryPlayer {
  index: number;
  name: string;
  placement: number;
  won: boolean;
  kills: number;
  deaths: number;
  damageDealt: number;
  damageTaken: number;
  shots: number;
  hits: number;
  abilitiesCast: number;
  loadout: string[];
}

export interface HistoryEntry {
  id: string;
  code: string;
  endedAt: number;
  durationMs: number;
  winner: number;
  myIndex: number;
  players: HistoryPlayer[];
}

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);

/** Parses `my_matches` defensively (anything malformed is dropped, never thrown). */
export function parseHistory(raw: unknown): HistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: HistoryEntry[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const endedAt = Date.parse(str(o.ended_at));
    if (!str(o.id) || !Number.isFinite(endedAt)) continue;
    const players = (Array.isArray(o.players) ? o.players : []).filter((p): p is Record<string, unknown> => !!p && typeof p === 'object').map(
      (p): HistoryPlayer => ({
        index: num(p.player_index, -1),
        name: str(p.display_name, '?'),
        placement: num(p.placement, 1),
        won: p.won === true,
        kills: num(p.kills),
        deaths: num(p.deaths),
        damageDealt: num(p.damage_dealt),
        damageTaken: num(p.damage_taken),
        shots: num(p.shots),
        hits: num(p.hits),
        abilitiesCast: num(p.abilities_cast),
        loadout: Array.isArray(p.loadout) ? p.loadout.filter((x): x is string => typeof x === 'string') : [],
      }),
    );
    out.push({ id: str(o.id), code: str(o.room_code), endedAt, durationMs: num(o.duration_ms), winner: num(o.winner_index, -1), myIndex: num(o.my_index, -1), players });
  }
  return out;
}
