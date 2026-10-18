/**
 * Match rules shared by the server (authoritative) and tests. Pure functions over plain data, no networking.
 *
 * Flow (MVP): warmup (FREE_ROAM: respawns on, practice damage) → every connected player READY (≥ minPlayers) → MATCH
 * (countdown, then weapons unlock; no respawns) → the last participant standing wins → RESULTS → back to warmup (the
 * lobby) once everyone asked to, or when the results time runs out.
 *
 * The MatchLedger keeps the server's own count of what happened in one match (damage, shots, casts, eliminations,
 * who left) and turns it into the summary everyone sees and the server persists.
 */
import type { MatchSummaryLine, MatchSummaryMsg } from '@graao/shared';

export const MATCH_RULES = {
  /** Players needed before a match can start. */
  minPlayers: 2,
  /** Countdown between "everyone is ready" and weapons unlocking (ms). */
  countdownMs: 3000,
  /** How long the results stay at most before the room returns to the lobby (ms); everyone asking ends them sooner. */
  resultsMs: 20000,
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

export interface LedgerEntrant {
  index: number;
  name: string;
  loadout: readonly string[];
}

interface LedgerLine extends Omit<MatchSummaryLine, 'placement' | 'won'> {
  /** When this participant was knocked out or left (server ms); Infinity while standing. */
  outAt: number;
}

/**
 * The server's record of one match, from boarding (or the start without the UFO) to the end. Only the room feeds it
 * (from validated actions), so the summary never depends on what a client claims. Unknown indices (late joiners,
 * spectators) are ignored.
 */
export class MatchLedger {
  private readonly lines = new Map<number, LedgerLine>();

  constructor(
    entrants: readonly LedgerEntrant[],
    readonly startedAt: number,
  ) {
    for (const e of entrants) {
      this.lines.set(e.index, {
        index: e.index,
        name: e.name,
        kills: 0,
        deaths: 0,
        damageDealt: 0,
        damageTaken: 0,
        shots: 0,
        hits: 0,
        abilitiesCast: 0,
        loadout: [...e.loadout],
        left: false,
        outAt: Infinity,
      });
    }
  }

  has(index: number): boolean {
    return this.lines.has(index);
  }

  /** The loadout changed after boarding (it is fixed once the fight starts). */
  setLoadout(index: number, loadout: readonly string[]): void {
    const l = this.lines.get(index);
    if (l) l.loadout = [...loadout];
  }

  /** A weapon shot was accepted; `hit` = at least one pellet touched a player. */
  shot(by: number, hit: boolean): void {
    const l = this.lines.get(by);
    if (!l) return;
    l.shots++;
    if (hit) l.hits++;
  }

  /** Shield + Health actually removed. Damage to oneself only counts as taken. */
  damage(by: number, target: number, amount: number): void {
    if (!(amount > 0)) return;
    const t = this.lines.get(target);
    if (t) t.damageTaken += amount;
    const b = by !== target ? this.lines.get(by) : undefined;
    if (b) b.damageDealt += amount;
  }

  /** An ability request was accepted. */
  cast(by: number): void {
    const l = this.lines.get(by);
    if (l) l.abilitiesCast++;
  }

  elimination(by: number, target: number, now: number): void {
    const t = this.lines.get(target);
    if (!t || t.outAt !== Infinity) return;
    t.deaths++;
    t.outAt = now;
    const b = by !== target ? this.lines.get(by) : undefined;
    if (b) b.kills++;
  }

  /** Left the room before the end: out at that moment (still standing players rank above). */
  left(index: number, now: number): void {
    const l = this.lines.get(index);
    if (!l) return;
    l.left = true;
    if (l.outAt === Infinity) l.outAt = now;
  }

  /**
   * The summary: the winner first, then everyone else by how long they lasted. Players out at the same moment share
   * a placement; in a draw (winner -1) nobody is placed above the others by default.
   */
  finish(code: string, winner: number, now: number): MatchSummaryMsg {
    const all = [...this.lines.values()];
    const lasted = (l: LedgerLine) => (l.index === winner ? Infinity : l.outAt === Infinity ? now : l.outAt);
    const players = all
      .map((l): MatchSummaryLine => {
        const mine = lasted(l);
        const above = all.filter((o) => o !== l && lasted(o) > mine).length;
        const { outAt: _out, ...rest } = l;
        return { ...rest, damageDealt: Math.round(l.damageDealt), damageTaken: Math.round(l.damageTaken), placement: 1 + above, won: l.index === winner };
      })
      .sort((a, b) => a.placement - b.placement || a.index - b.index);
    return { code, winner, startedAt: this.startedAt, endedAt: now, durationMs: Math.max(0, now - this.startedAt), players };
  }
}
