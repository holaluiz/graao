/**
 * Match rules shared by the server (authoritative) and tests. Pure functions over plain data, no networking.
 *
 * Flow (MVP): warmup (FREE_ROAM: respawns on, practice damage) → every connected player READY (≥ minPlayers) → MATCH
 * (countdown, then weapons unlock; no respawns) → the last participant standing wins → RESULTS → back to warmup.
 */
export const MATCH_RULES = {
  /** Players needed before a match can start. */
  minPlayers: 2,
  /** Countdown between "everyone is ready" and weapons unlocking (ms). */
  countdownMs: 3000,
  /** How long the results screen stays before returning to warmup (ms). */
  resultsMs: 9000,
} as const;

export interface MatchParticipant {
  index: number;
  alive: boolean;
  connected: boolean;
  inMatch: boolean;
}

/** True when a warmup room may start a match: enough connected players and all of them ready. */
export function everyoneReady(players: { connected: boolean; ready: boolean }[], minPlayers: number = MATCH_RULES.minPlayers): boolean {
  const connected = players.filter((p) => p.connected);
  return connected.length >= minPlayers && connected.every((p) => p.ready);
}

/**
 * Decides whether a running match is over. Last participant standing wins; nobody left standing (or everyone
 * disconnected) is a draw with winner -1.
 */
export function decideMatch(players: MatchParticipant[]): { over: boolean; winner: number } {
  const standing = players.filter((p) => p.inMatch && p.alive && p.connected);
  if (standing.length > 1) return { over: false, winner: -1 };
  return { over: true, winner: standing.length === 1 ? standing[0]!.index : -1 };
}
