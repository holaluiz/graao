import { describe, expect, it } from 'vitest';
import { ABILITIES, BASIC_ABILITIES, ULTIMATE_ABILITIES } from '@graao/game-data';
import { DraftReject } from '@graao/shared';
import { AbilityDraft, DRAFT_ROUNDS, DRAFT_RULES, draftPriority } from './draft';
import { validateLoadout } from './abilities';

const T = { pickMs: 1000, repickMs: 500, revealMs: 200 };

/** Runs the reveal out and opens the next round. */
function nextRound(d: AbilityDraft, now: number): number {
  expect(d.stage).toBe('reveal');
  d.update(now + T.revealMs);
  return now + T.revealMs;
}

describe('ability draft', () => {
  it('rotates priority every round, starting from the chosen seat', () => {
    expect(draftPriority([0, 1], 0, 0)).toEqual([0, 1]);
    expect(draftPriority([0, 1], 1, 0)).toEqual([1, 0]);
    expect(draftPriority([1, 0], 2, 0)).toEqual([0, 1]);
    expect(draftPriority([0, 1], 0, 1)).toEqual([1, 0]);
    expect(draftPriority([2, 5, 7], 1, 0)).toEqual([5, 7, 2]);
  });

  it('runs four simultaneous rounds (3 basics + 1 Ultimate) into two valid, disjoint loadouts', () => {
    const d = new AbilityDraft([0, 1], 0, { timings: T });
    expect(d.unique).toEqual({ basic: false, ultimate: false });
    let now = 0;
    const plan: [string, string][] = [
      ['sun_orb', 'thorn_seed'],
      ['wind_step', 'leaf_shell'],
      ['pollen_burst', 'gust_ring'],
      ['sun_meteor', 'petal_cyclone'],
    ];
    for (let r = 0; r < DRAFT_ROUNDS.length; r++) {
      expect(d.kind).toBe(DRAFT_ROUNDS[r]);
      expect(d.pick(0, r, plan[r]![0], now)).toBe(DraftReject.OK);
      // Nothing resolves while someone is still choosing.
      expect(d.update(now + 1)).toBe(false);
      expect(d.view(1).seats.find((s) => s.index === 0)).toMatchObject({ locked: true, picking: true });
      // The other player cannot see the hidden choice.
      expect(d.view(1).mine).toBeNull();
      expect(d.pick(1, r, plan[r]![1], now)).toBe(DraftReject.OK);
      expect(d.update(now + 2)).toBe(true);
      expect(d.view(0).reveal.map((x) => x.a).sort()).toEqual([...plan[r]!].sort());
      now = nextRound(d, now + 2);
    }
    expect(d.done).toBe(true);
    const a = d.loadout(0)!;
    const b = d.loadout(1)!;
    expect(a).toEqual(['sun_orb', 'wind_step', 'pollen_burst', 'sun_meteor']);
    expect(validateLoadout(a)).toEqual(a);
    expect(validateLoadout(b)).toEqual(b);
    expect(a.filter((id) => b.includes(id))).toEqual([]);
  });

  it('allows identical spells across players without conflicts, repicks or global exclusivity', () => {
    const d = new AbilityDraft([0, 1], 0, { timings: T, firstPriority: 1 });
    expect(d.priority).toEqual([1, 0]);
    d.pick(0, 0, 'sun_orb', 0);
    d.pick(1, 0, 'sun_orb', 0);
    d.update(10);
    expect(d.seat(1)!.picks).toEqual(['sun_orb']);
    expect(d.seat(0)!.picks).toEqual(['sun_orb']);
    expect(d.stage).toBe('reveal');
    const v0 = d.view(0);
    expect(v0).toMatchObject({ unique: false, repick: false, lostTo: null, mine: null });
    expect(d.view(1).reveal).toEqual([
      { index: 0, a: 'sun_orb', auto: false, contested: false },
      { index: 1, a: 'sun_orb', auto: false, contested: false },
    ]);
    // Round 2: priority passes to seat 0.
    nextRound(d, 10);
    expect(d.priority).toEqual([0, 1]);
    d.pick(0, 1, 'bloom', 300);
    d.pick(1, 1, 'bloom', 300);
    d.update(300);
    expect(d.seat(0)!.picks).toEqual(['sun_orb', 'bloom']);
    expect(d.seat(1)!.picks).toEqual(['sun_orb', 'bloom']);
    expect(d.seat(1)!.repick).toBe(false);
  });

  it('refuses picks from the wrong round, the wrong slot type, or after the seat already has this round', () => {
    const d = new AbilityDraft([0, 1], 0, { timings: T });
    expect(d.pick(0, 1, 'sun_orb', 0)).toBe(DraftReject.WRONG_ROUND);
    expect(d.pick(0, 0, 'sun_meteor', 0)).toBe(DraftReject.NOT_IN_POOL);
    expect(d.pick(0, 0, 'nope', 0)).toBe(DraftReject.NOT_IN_POOL);
    expect(d.pick(7, 0, 'sun_orb', 0)).toBe(DraftReject.NOT_PICKING);
    d.pick(0, 0, 'sun_orb', 0);
    // Changing your mind before the round resolves is fine.
    expect(d.pick(0, 0, 'bloom', 0)).toBe(DraftReject.OK);
    d.pick(1, 0, 'sun_orb', 0);
    d.update(1);
    expect(d.seat(0)!.picks).toEqual(['bloom']);
    expect(d.pick(0, 0, 'wind_step', 1)).toBe(DraftReject.NOT_DRAFTING); // reveal
    nextRound(d, 1);
    d.pick(0, 1, 'wind_step', 300);
    expect(d.pick(0, 1, 'bloom', 300)).toBe(DraftReject.ALREADY_OWNED);
    d.pick(1, 1, 'gust_ring', 300);
    d.update(300);
    nextRound(d, 300);
    // Ultimate round only accepts ultimates (round 3).
    d.pick(0, 2, 'pollen_burst', 600);
    d.pick(1, 2, 'leaf_shell', 600);
    d.update(600);
    nextRound(d, 600);
    expect(d.kind).toBe('ultimate');
    expect(d.pick(0, 3, 'thorn_seed', 900)).toBe(DraftReject.NOT_IN_POOL);
  });

  it('chooses valid spells for whoever runs out of time and keeps the draft moving', () => {
    let k = 0;
    const d = new AbilityDraft([0, 1], 0, { timings: T, rng: () => (k++ * 0.37) % 1 });
    let now = 0;
    for (let r = 0; r < DRAFT_ROUNDS.length; r++) {
      if (r % 2 === 0) d.pick(0, r, d.available(0)[0]!, now);
      expect(d.update(now + T.pickMs - 1)).toBe(false);
      expect(d.update(now + T.pickMs)).toBe(true);
      // A conflict can still send someone to a repick window that also times out.
      if (d.stage === 'pick') d.update(now + T.pickMs + T.repickMs);
      expect(d.stage).toBe('reveal');
      expect(d.view(0).reveal.some((x) => x.index === 1 && x.auto)).toBe(true);
      now = nextRound(d, now + T.pickMs + T.repickMs);
    }
    const a = d.loadout(0)!;
    const b = d.loadout(1)!;
    expect(validateLoadout(a)).toEqual(a);
    expect(validateLoadout(b)).toEqual(b);
    expect(new Set(a).size).toBe(4);
    expect(new Set(b).size).toBe(4);
  });

  it('stops waiting for a seat that leaves', () => {
    const d = new AbilityDraft([0, 1, 2], 0, { timings: T });
    // Exclusivity stays individual regardless of pool size or participant count.
    expect(d.unique.basic).toBe(false);
    expect(d.unique.ultimate).toBe(false);
    d.pick(0, 0, 'sun_orb', 0);
    d.pick(1, 0, 'sun_orb', 0);
    expect(d.update(5)).toBe(false);
    d.remove(2);
    expect(d.update(6)).toBe(true);
    expect(d.seat(0)!.picks).toEqual(['sun_orb']);
    expect(d.seat(1)!.picks).toEqual(['sun_orb']);
    expect(d.stage).toBe('reveal');
  });

  it('rejects late picks and prevents a second passive in every basic round', () => {
    const d = new AbilityDraft([0, 1], 0, { timings: T });
    expect(d.pick(0, 0, 'steady_hand', T.pickMs)).toBe(DraftReject.EXPIRED);
    expect(d.seat(0)!.pending).toBeNull();
    expect(d.pick(0, 0, 'steady_hand', 10)).toBe(DraftReject.OK);
    expect(d.pick(1, 0, 'steady_hand', 10)).toBe(DraftReject.OK);
    d.update(10);
    const now = nextRound(d, 10);
    expect(d.available(0)).not.toContain('soft_step');
    expect(d.pick(0, 1, 'soft_step', now)).toBe(DraftReject.PASSIVE_LIMIT);
    expect(d.pick(0, 1, 'steady_hand', now)).toBe(DraftReject.ALREADY_OWNED);
    expect(d.pick(0, 1, 'wind_step', now)).toBe(DraftReject.OK);
  });

  it.each([1, 2, 10])('completes a %i-participant timeout draft with valid individual builds and at most one passive', (count) => {
    const indices = Array.from({ length: count }, (_, index) => index);
    const d = new AbilityDraft(indices, 0, { timings: T, rng: () => 0.999999 });
    let now = 0;
    for (const index of indices) expect(d.pick(index, 0, 'steady_hand', now)).toBe(DraftReject.OK);
    d.update(now);
    now = nextRound(d, now);
    for (let round = 1; round < 4; round++) {
      d.update(now + T.pickMs);
      now = nextRound(d, now + T.pickMs);
    }
    expect(d.done).toBe(true);
    for (const index of indices) {
      const loadout = d.loadout(index)!;
      expect(validateLoadout(loadout)).toEqual(loadout);
      expect(loadout.filter((id) => ABILITIES[id].kind === 'passive')).toHaveLength(1);
      expect(ABILITIES[loadout[3]!].kind).toBe('ultimate');
    }
    expect(new Set(indices.map((index) => d.loadout(index)!.join(','))).size).toBe(1);
  });

  it('allows 45 seconds to inspect a choice and 20 seconds to repick after a conflict', () => {
    expect(DRAFT_RULES).toEqual({ pickMs: 45000, repickMs: 20000, revealMs: 1600 });
    const d = new AbilityDraft([0, 1], 100);
    expect(d.endsAt).toBe(45100);
    // Pools cover a unique 1v1 draft.
    expect(BASIC_ABILITIES.length).toBeGreaterThanOrEqual(2 * 3);
    expect(ULTIMATE_ABILITIES.length).toBeGreaterThanOrEqual(2);
    expect(Object.values(ABILITIES).filter((a) => a.slotType === 'ultimate').length).toBe(ULTIMATE_ABILITIES.length);
  });
});
