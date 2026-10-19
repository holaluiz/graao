import { describe, expect, it } from 'vitest';
import { AbilityDraft } from '@graao/game-core';
import { isDraftChoiceAvailable, shouldAutoConfirmDraftChoice, draftCatalogPage } from './DraftScreen';
import { BASIC_ABILITIES, ULTIMATE_ABILITIES } from '@graao/game-data';

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

  it('keeps all forty entries reachable through bounded pages and category filters', () => {
    const basics = Array.from({ length: 5 }, (_, page) => draftCatalogPage(BASIC_ABILITIES, 'all', page, 6).ids).flat();
    expect(new Set(basics)).toEqual(new Set(BASIC_ABILITIES));
    expect(draftCatalogPage(BASIC_ABILITIES, 'passive', 0, 6).total).toBe(8);
    const ultimates = Array.from({ length: 3 }, (_, page) => draftCatalogPage(ULTIMATE_ABILITIES, 'ultimate', page, 4).ids).flat();
    expect(new Set(ultimates)).toEqual(new Set(ULTIMATE_ABILITIES));
    expect(draftCatalogPage(BASIC_ABILITIES, 'mobility', 99, 4).page).toBe(1);
  });

  it('makes a second passive unavailable while leaving an active choice valid', () => {
    const state = new AbilityDraft([0, 1], 0).view(0);
    state.seats[0]!.picks = ['steady_hand'];
    expect(isDraftChoiceAvailable(state, 0, 'anti_glue')).toBe(false);
    expect(isDraftChoiceAvailable(state, 0, 'wind_step')).toBe(true);
  });

  it('keeps the full catalogue reachable in the two-card landscape layout', () => {
    for (const [pool, category] of [[BASIC_ABILITIES, 'all'], [ULTIMATE_ABILITIES, 'ultimate']] as const) {
      const first = draftCatalogPage(pool, category, 0, 2);
      const pages = Array.from({ length: first.pages }, (_, index) => draftCatalogPage(pool, category, index, 2));
      expect(pages.every((page) => page.ids.length > 0 && page.ids.length <= 2)).toBe(true);
      expect(pages.flatMap((page) => page.ids)).toEqual(pool);
    }
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
