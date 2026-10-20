import { describe, expect, it } from 'vitest';
import { AbilityDraft, DRAFT_ROUNDS, validateLoadout } from '@graao/game-core';
import { ABILITIES, ABILITY_IDS, BASIC_ABILITIES, ULTIMATE_ABILITIES } from '@graao/game-data';
import { DraftReject } from '@graao/shared';
import { draftSlots, isDraftChoiceAvailable, shouldAutoConfirmDraftChoice } from './DraftScreen';
import { CATEGORY_ORDER, draftCatalogSections } from './abilityFacts';

describe('draft preview and confirmation', () => {
  it('offers only the current pool to a participating seat that still needs a choice', () => {
    const state = new AbilityDraft([0, 1], 0).view(0);
    expect(isDraftChoiceAvailable(state, 0, 'sun_orb')).toBe(true);
    expect(isDraftChoiceAvailable(state, 0, 'sun_meteor')).toBe(false);
    expect(isDraftChoiceAvailable(state, 0, 'unknown')).toBe(false);
    expect(isDraftChoiceAvailable(state, 0, null)).toBe(false);
    expect(isDraftChoiceAvailable(state, 7, 'sun_orb')).toBe(false);
    state.seats[0]!.picking = false;
    expect(isDraftChoiceAvailable(state, 0, 'sun_orb')).toBe(false);
    state.seats[0]!.picking = true;
    state.stage = 'reveal';
    expect(isDraftChoiceAvailable(state, 0, 'sun_orb')).toBe(false);
  });

  it('allows a shared ability in a ten-player room but never a duplicate in your own build', () => {
    const state = new AbilityDraft(Array.from({ length: 10 }, (_, i) => i), 0).view(0);
    expect(state.unique).toBe(false);
    // A later owner's entry can hide our earlier ownership in the public owners map.
    state.owners = [['sun_orb', 9]];
    expect(isDraftChoiceAvailable(state, 0, 'sun_orb')).toBe(true);
    state.seats[0]!.picks = ['sun_orb'];
    expect(isDraftChoiceAvailable(state, 0, 'sun_orb')).toBe(false);
  });

  it('does not offer an owned ability when the round has unique ownership', () => {
    const state = new AbilityDraft([0, 1], 0).view(0);
    state.unique = true; // Older servers may still publish this flag; current rules always use individual ownership.
    state.owners = [['sun_orb', 1]];
    expect(isDraftChoiceAvailable(state, 0, 'sun_orb')).toBe(false);
  });

  it('puts all forty spells on two grids — 30 basics, 10 Ultimates — with no tabs or pages', () => {
    const { basic, ultimate } = draftCatalogSections();
    expect(basic).toHaveLength(30);
    expect(ultimate).toHaveLength(10);
    expect(new Set(basic)).toEqual(new Set(BASIC_ABILITIES));
    expect(new Set(ultimate)).toEqual(new Set(ULTIMATE_ABILITIES));
    expect(new Set([...basic, ...ultimate])).toEqual(new Set(ABILITY_IDS));
    // Grouped by category so the color bands read as clusters.
    const order = basic.map((id) => CATEGORY_ORDER.indexOf(ABILITIES[id].category));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('makes a second passive unavailable while leaving an active choice valid', () => {
    const state = new AbilityDraft([0, 1], 0).view(0);
    state.seats[0]!.picks = ['steady_hand'];
    expect(isDraftChoiceAvailable(state, 0, 'anti_glue')).toBe(false);
    expect(isDraftChoiceAvailable(state, 0, 'wind_step')).toBe(true);
  });

  it('agrees with the authoritative rules on every card through a ten-seat draft that bots and the clock finish', () => {
    const seats = Array.from({ length: 10 }, (_, i) => i);
    const T = { pickMs: 1000, repickMs: 500, revealMs: 100 };
    const d = new AbilityDraft(seats, 0, { timings: T, rng: () => 0.37 });
    const grid = draftCatalogSections();
    let now = 0;
    for (let round = 0; round < DRAFT_ROUNDS.length; round++) {
      // Every one of the 40 cards is offered to a seat exactly when the server would accept it.
      for (const seat of seats) {
        const view = d.view(seat);
        const free = new Set(d.available(seat));
        for (const id of ABILITY_IDS) expect(isDraftChoiceAvailable(view, seat, id), `${seat} ${id} r${round}`).toBe(free.has(id));
      }
      // Seat 0 plays through the screen: a passive whenever the grid offers one, else the first valid card.
      const view = d.view(0);
      const order = view.kind === 'ultimate' ? grid.ultimate : grid.basic;
      const mine = order.find((id) => ABILITIES[id].kind === 'passive' && isDraftChoiceAvailable(view, 0, id)) ?? order.find((id) => isDraftChoiceAvailable(view, 0, id))!;
      expect(d.pick(0, round, mine, now)).toBe(DraftReject.OK);
      // Seats 1–8 choose like the server's bots; seat 9 never answers and is filled when the time runs out.
      for (const seat of seats.slice(1, 9)) {
        const free = d.available(seat);
        d.pick(seat, round, free[(seat + round) % free.length]!, now);
      }
      expect(d.update(now + 1)).toBe(false);
      now += T.pickMs;
      expect(d.update(now)).toBe(true);
      expect(d.stage).toBe('reveal');
      expect(d.view(0).reveal.find((r) => r.index === 9)?.auto).toBe(true);
      now += T.revealMs;
      d.update(now);
    }
    expect(d.done).toBe(true);
    for (const seat of seats) {
      const loadout = d.loadout(seat)!;
      expect(validateLoadout(loadout), `seat ${seat}`).toEqual(loadout);
      expect(loadout.filter((id) => ABILITIES[id].kind === 'passive').length).toBeLessThanOrEqual(1);
    }
    expect(ABILITIES[d.loadout(0)![0]].kind).toBe('passive');
  });

  it('shows previews and confirmations to their owner and only a lock to everyone else', () => {
    const d = new AbilityDraft([0, 1], 0, { timings: { pickMs: 1000, repickMs: 500, revealMs: 100 } });
    let a = d.view(0);
    expect(draftSlots(a, 0, 0, null).map((x) => x.state)).toEqual(['current', 'empty', 'empty', 'empty']);
    expect(draftSlots(a, 0, 0, 'sun_orb')[0]).toEqual({ state: 'preview', id: 'sun_orb' });
    expect(draftSlots(a, 1, 0, null)[0]).toEqual({ state: 'current', id: null });
    d.pick(1, 0, 'thorn_seed', 10);
    a = d.view(0);
    // The other player's secret choice is a lock, never the spell.
    expect(draftSlots(a, 1, 0, null)[0]).toEqual({ state: 'hidden', id: null });
    expect(JSON.stringify(draftSlots(a, 1, 0, null))).not.toContain('thorn_seed');
    d.pick(0, 0, 'wind_step', 20);
    a = d.view(0);
    expect(draftSlots(a, 0, 0, null)[0]).toEqual({ state: 'confirmed', id: 'wind_step' });
    // Changing a confirmed choice shows the new preview until it is sent.
    expect(draftSlots(a, 0, 0, 'slide')[0]).toEqual({ state: 'preview', id: 'slide' });
    d.update(30);
    a = d.view(0);
    expect(a.stage).toBe('reveal');
    expect(draftSlots(a, 1, 0, null)[0]).toEqual({ state: 'confirmed', id: 'thorn_seed' });
    expect(draftSlots(a, 0, 0, null).map((x) => x.state)).toEqual(['confirmed', 'empty', 'empty', 'empty']);
    // A spectator (not a seat) sees public picks and locks but owns no slots.
    expect(draftSlots(a, 0, 5, null)[0]).toEqual({ state: 'confirmed', id: 'wind_step' });
    expect(draftSlots(a, 5, 5, 'sun_orb').every((x) => x.state === 'empty')).toBe(true);
  });

  it('confirms a valid local preview once just before the server deadline', () => {
    const state = new AbilityDraft([0, 1], 0).view(0);
    expect(shouldAutoConfirmDraftChoice(state, 0, 'sun_orb', null, state.endsAt - 201)).toBe(false);
    expect(shouldAutoConfirmDraftChoice(state, 0, 'sun_orb', null, state.endsAt - 200)).toBe(true);
    expect(shouldAutoConfirmDraftChoice(state, 0, 'sun_orb', null, state.endsAt - 1)).toBe(true);
    expect(shouldAutoConfirmDraftChoice(state, 0, 'sun_orb', 'sun_orb', state.endsAt - 100)).toBe(false);
    expect(shouldAutoConfirmDraftChoice(state, 0, 'sun_orb', null, state.endsAt)).toBe(false);
    expect(shouldAutoConfirmDraftChoice(state, 0, 'sun_orb', null, state.endsAt + 1)).toBe(false);
    expect(shouldAutoConfirmDraftChoice(state, 0, null, null, state.endsAt - 100)).toBe(false);
    expect(shouldAutoConfirmDraftChoice(state, 0, 'sun_meteor', null, state.endsAt - 100)).toBe(false);
  });

  it('leaves confirmed choices alone and can confirm an edited preview while the round stays open', () => {
    const state = new AbilityDraft([0, 1], 0).view(0);
    state.mine = 'sun_orb';
    expect(shouldAutoConfirmDraftChoice(state, 0, 'sun_orb', null, state.endsAt - 100)).toBe(false);
    expect(shouldAutoConfirmDraftChoice(state, 0, 'bloom', null, state.endsAt - 100)).toBe(true);
    state.stage = 'reveal';
    expect(shouldAutoConfirmDraftChoice(state, 0, 'bloom', null, state.endsAt - 100)).toBe(false);
  });
});
