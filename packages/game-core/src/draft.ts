/**
 * Ability Draft rules (pure, deterministic given an rng; the server runs it, tests drive it with fake clocks).
 *
 * Four simultaneous rounds: Basic, Basic, Basic, Ultimate. In each round every seat chooses in secret; the round
 * resolves as soon as everyone has chosen (or when time runs out: missing choices are made at random). When two seats
 * want the same ability and ownership is unique, the seat with priority this round keeps it and the others repick
 * at once from what is left (a short repick window). Priority rotates every round, starting from a random seat.
 * After each round the result stays on screen briefly (reveal), then the next round opens.
 *
 * Ownership is unique for a slot type when its pool covers every seat (2 players: 8 basics ≥ 2 × 3, 3 ultimates
 * ≥ 2 × 1); larger rooms fall back to "never twice in the same loadout".
 */
import { ABILITIES, BASIC_ABILITIES, LOADOUT_SLOTS, ULTIMATE_ABILITIES, isAbilityId, type AbilityId, type Loadout } from '@graao/game-data';
import { DraftReject, type DraftKind, type DraftStage, type DraftStateMsg } from '@graao/shared';

/** Slot type of each round, in order: keys 1, 2, 3 then the Ultimate on 4. */
export const DRAFT_ROUNDS: readonly DraftKind[] = ['basic', 'basic', 'basic', 'ultimate'];

export const DRAFT_RULES = {
  /** Time to choose in a round (ms); the round resolves earlier once everyone has chosen. */
  pickMs: 45000,
  /** Time a seat that lost a conflict has to choose again (ms). */
  repickMs: 20000,
  /** How long a resolved round stays on screen before the next one opens (ms). */
  revealMs: 1600,
} as const;

export type DraftTimings = { pickMs: number; repickMs: number; revealMs: number };

export interface DraftSeat {
  index: number;
  /** Abilities won, in round order. */
  picks: AbilityId[];
  /** Hidden choice for the current window. */
  pending: AbilityId | null;
  /** Lost this round's conflict: chooses again in the repick window. */
  repick: boolean;
  lostTo: { index: number; id: AbilityId } | null;
}

export interface DraftRoundResult {
  index: number;
  id: AbilityId;
  auto: boolean;
  contested: boolean;
}

export const draftPool = (kind: DraftKind): readonly AbilityId[] => (kind === 'basic' ? BASIC_ABILITIES : ULTIMATE_ABILITIES);

/** Seat indices ordered by priority for a round: ascending seats rotated by (first + round). */
export function draftPriority(indices: readonly number[], round: number, first: number): number[] {
  const sorted = [...indices].sort((a, b) => a - b);
  const n = sorted.length;
  if (!n) return [];
  const k = (((first + round) % n) + n) % n;
  return [...sorted.slice(k), ...sorted.slice(0, k)];
}

export class AbilityDraft {
  readonly seats: DraftSeat[];
  round = 0;
  stage: DraftStage = 'pick';
  /** Clock time when the current window or reveal ends. */
  endsAt: number;
  priority: number[];
  /** What each seat got in the current round (filled while it resolves, shown during the reveal). */
  roundResults: DraftRoundResult[] = [];
  readonly unique: Record<DraftKind, boolean>;
  private readonly t: DraftTimings;
  private readonly rng: () => number;
  private readonly firstPriority: number;
  /** Seats whose ability this round was chosen automatically / was disputed. */
  private readonly auto = new Set<number>();
  private readonly contested = new Set<number>();

  constructor(indices: readonly number[], now: number, opts: { timings?: Partial<DraftTimings>; rng?: () => number; firstPriority?: number } = {}) {
    this.seats = [...indices].sort((a, b) => a - b).map((index) => ({ index, picks: [], pending: null, repick: false, lostTo: null }));
    this.t = { ...DRAFT_RULES, ...opts.timings };
    this.rng = opts.rng ?? Math.random;
    this.firstPriority = opts.firstPriority ?? 0;
    const per = (kind: DraftKind) => DRAFT_ROUNDS.filter((k) => k === kind).length;
    this.unique = {
      basic: BASIC_ABILITIES.length >= this.seats.length * per('basic'),
      ultimate: ULTIMATE_ABILITIES.length >= this.seats.length * per('ultimate'),
    };
    this.priority = draftPriority(indices, 0, this.firstPriority);
    this.endsAt = now + this.t.pickMs;
  }

  get kind(): DraftKind {
    return DRAFT_ROUNDS[Math.min(this.round, DRAFT_ROUNDS.length - 1)]!;
  }

  get done(): boolean {
    return this.stage === 'done';
  }

  seat(index: number): DraftSeat | undefined {
    return this.seats.find((s) => s.index === index);
  }

  /** Every ability won so far → its owner. */
  owners(): Map<AbilityId, number> {
    const m = new Map<AbilityId, number>();
    for (const s of this.seats) for (const id of s.picks) m.set(id, s.index);
    return m;
  }

  /** Seats that still need this round's ability. */
  awaiting(): DraftSeat[] {
    return this.stage === 'pick' ? this.seats.filter((s) => s.picks.length <= this.round) : [];
  }

  /** What `index` may choose right now. */
  available(index: number): AbilityId[] {
    const seat = this.seat(index);
    if (!seat || this.stage !== 'pick' || seat.picks.length > this.round) return [];
    const owners = this.owners();
    const unique = this.unique[this.kind];
    return draftPool(this.kind).filter((id) => !seat.picks.includes(id) && !(unique && owners.has(id)));
  }

  /** A secret choice for the current window (may be changed until the round resolves). */
  pick(index: number, round: number, id: string, _now: number): DraftReject {
    if (this.stage !== 'pick') return DraftReject.NOT_DRAFTING;
    if (round !== this.round) return DraftReject.WRONG_ROUND;
    const seat = this.seat(index);
    if (!seat || seat.picks.length > this.round) return DraftReject.NOT_PICKING;
    if (!isAbilityId(id) || ABILITIES[id].slotType !== this.kind || !draftPool(this.kind).includes(id)) return DraftReject.NOT_IN_POOL;
    if (seat.picks.includes(id)) return DraftReject.ALREADY_OWNED;
    if (this.unique[this.kind] && this.owners().has(id)) return DraftReject.TAKEN;
    seat.pending = id;
    return DraftReject.OK;
  }

  /** A seat left: its picks are released and the draft no longer waits for it. */
  remove(index: number): void {
    const i = this.seats.findIndex((s) => s.index === index);
    if (i < 0) return;
    this.seats.splice(i, 1);
    this.priority = this.priority.filter((p) => p !== index);
    this.roundResults = this.roundResults.filter((r) => r.index !== index);
  }

  /**
   * Advances time: resolves the window once everyone has chosen or when it times out (missing choices are made at
   * random), ends the reveal and opens the next round. Returns true when anything visible changed.
   */
  update(now: number): boolean {
    if (this.stage === 'done') return false;
    if (this.stage === 'reveal') {
      if (now < this.endsAt) return false;
      this.nextRound(now);
      return true;
    }
    const waiting = this.awaiting();
    if (!waiting.length) {
      this.startReveal(now);
      return true;
    }
    if (waiting.every((s) => s.pending)) {
      this.resolve(now);
      return true;
    }
    if (now < this.endsAt) return false;
    for (const s of waiting) {
      if (s.pending) continue;
      const options = this.available(s.index);
      const fallback = draftPool(this.kind).filter((id) => !s.picks.includes(id));
      const from = options.length ? options : fallback;
      s.pending = from[Math.floor(this.rng() * from.length) % from.length]!;
      this.auto.add(s.index);
    }
    this.resolve(now);
    return true;
  }

  /** Commits uncontested choices; disputed ones go to the seat with priority, the others repick. */
  private resolve(now: number): void {
    const unique = this.unique[this.kind];
    const claims = new Map<AbilityId, DraftSeat[]>();
    for (const s of this.awaiting()) {
      const list = claims.get(s.pending!) ?? [];
      list.push(s);
      claims.set(s.pending!, list);
    }
    const rank = (i: number) => {
      const r = this.priority.indexOf(i);
      return r < 0 ? 1e9 : r;
    };
    let losers = 0;
    for (const [id, seats] of claims) {
      const winners = unique ? [...seats].sort((a, b) => rank(a.index) - rank(b.index)).slice(0, 1) : seats;
      for (const s of seats) {
        if (winners.includes(s)) {
          s.picks.push(id);
          if (seats.length > 1 && unique) this.contested.add(s.index);
          this.roundResults.push({ index: s.index, id, auto: this.auto.has(s.index), contested: this.contested.has(s.index) });
          s.repick = false;
          s.lostTo = null;
        } else {
          s.repick = true;
          s.lostTo = { index: winners[0]!.index, id };
          this.contested.add(s.index);
          this.auto.delete(s.index);
          losers++;
        }
        s.pending = null;
      }
    }
    if (losers) this.endsAt = now + this.t.repickMs;
    else this.startReveal(now);
  }

  private startReveal(now: number): void {
    this.stage = 'reveal';
    this.endsAt = now + this.t.revealMs;
  }

  private nextRound(now: number): void {
    this.round++;
    this.roundResults = [];
    this.auto.clear();
    this.contested.clear();
    for (const s of this.seats) {
      s.pending = null;
      s.repick = false;
      s.lostTo = null;
    }
    if (this.round >= DRAFT_ROUNDS.length) {
      this.stage = 'done';
      this.endsAt = now;
      return;
    }
    this.stage = 'pick';
    this.priority = draftPriority(
      this.seats.map((s) => s.index),
      this.round,
      this.firstPriority,
    );
    this.endsAt = now + this.t.pickMs;
  }

  /** The drafted loadout (keys 1, 2, 3, then the Ultimate on 4), or null while incomplete. */
  loadout(index: number): Loadout | null {
    const s = this.seat(index);
    return s && s.picks.length === LOADOUT_SLOTS ? ([...s.picks] as Loadout) : null;
  }

  /** What `forIndex` may know: public picks and locks, plus only its own hidden choice. */
  view(forIndex: number): DraftStateMsg {
    const me = this.seat(forIndex);
    const waiting = new Set(this.awaiting().map((s) => s.index));
    return {
      round: this.round,
      rounds: DRAFT_ROUNDS.length,
      kind: this.kind,
      stage: this.stage,
      endsAt: this.endsAt,
      priority: [...this.priority],
      pool: [...draftPool(this.kind)],
      unique: this.unique[this.kind],
      owners: [...this.owners()],
      seats: this.seats.map((s) => ({ index: s.index, picks: [...s.picks], picking: waiting.has(s.index), locked: waiting.has(s.index) && !!s.pending })),
      mine: me?.pending ?? null,
      repick: !!me?.repick,
      lostTo: me?.lostTo ? { index: me.lostTo.index, a: me.lostTo.id } : null,
      reveal: this.stage === 'reveal' ? this.roundResults.map((r) => ({ index: r.index, a: r.id, auto: r.auto, contested: r.contested })) : [],
    };
  }
}
