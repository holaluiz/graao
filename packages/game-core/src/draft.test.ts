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
    expect(d.unique).toEqual({ basic: true, ultimate: true });
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

  it('gives a disputed ability to the seat with priority; the other repicks at once', () => {
    const d = new AbilityDraft([0, 1], 0, { timings: T, firstPriority: 1 });
    expect(d.priority).toEqual([1, 0]);
    d.pick(0, 0, 'sun_orb', 0);
    d.pick(1, 0, 'sun_orb', 0);
    d.update(10);
    expect(d.seat(1)!.picks).toEqual(['sun_orb']);
    expect(d.stage).toBe('pick');
    expect(d.endsAt).toBe(10 + T.repickMs);
    const v0 = d.view(0);
    expect(v0).toMatchObject({ repick: true, lostTo: { index: 1, a: 'sun_orb' }, mine: null });
    expect(v0.owners).toEqual([['sun_orb', 1]]);
    // The loser cannot take it again and must choose something else.
    expect(d.pick(0, 0, 'sun_orb', 20)).toBe(DraftReject.TAKEN);
    expect(d.available(0)).not.toContain('sun_orb');
    expect(d.pick(0, 0, 'sap_snare', 20)).toBe(DraftReject.OK);
    d.update(30);
    expect(d.stage).toBe('reveal');
    expect(d.view(1).reveal).toEqual([
      { index: 1, a: 'sun_orb', auto: false, contested: true },
      { index: 0, a: 'sap_snare', auto: false, contested: true },
    ]);
    // Round 2: priority passes to seat 0.
    nextRound(d, 30);
    expect(d.priority).toEqual([0, 1]);
    d.pick(0, 1, 'bloom', 300);
    d.pick(1, 1, 'bloom', 300);
    d.update(300);
    expect(d.seat(0)!.picks).toEqual(['sap_snare', 'bloom']);
    expect(d.seat(1)!.repick).toBe(true);
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

  it('chooses at random for whoever runs out of time (never a taken ability) and keeps the draft moving', () => {
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
    expect(a.filter((id) => b.includes(id))).toEqual([]);
  });

  it('stops waiting for a seat that leaves', () => {
    const d = new AbilityDraft([0, 1, 2], 0, { timings: T });
    // 3 players: 8 basics < 9 picks, so basics may repeat across players (never twice in one loadout).
    expect(d.unique.basic).toBe(false);
    expect(d.unique.ultimate).toBe(true);
    d.pick(0, 0, 'sun_orb', 0);
    d.pick(1, 0, 'sun_orb', 0);
    expect(d.update(5)).toBe(false);
    d.remove(2);
    expect(d.update(6)).toBe(true);
    expect(d.seat(0)!.picks).toEqual(['sun_orb']);
    expect(d.seat(1)!.picks).toEqual(['sun_orb']);
    expect(d.stage).toBe('reveal');
  });

  it('fits a 1v1 inside the 30–60 s target with the default timings', () => {
    // Worst case without conflicts: every round times out; one repick per round on top of that is still bounded.
    const worst = DRAFT_ROUNDS.length * (DRAFT_RULES.pickMs + DRAFT_RULES.revealMs);
    expect(worst).toBeLessThanOrEqual(60000);
    // Pools cover a unique 1v1 draft.
    expect(BASIC_ABILITIES.length).toBeGreaterThanOrEqual(2 * 3);
    expect(ULTIMATE_ABILITIES.length).toBeGreaterThanOrEqual(2);
    expect(Object.values(ABILITIES).filter((a) => a.slotType === 'ultimate').length).toBe(ULTIMATE_ABILITIES.length);
  });
});
