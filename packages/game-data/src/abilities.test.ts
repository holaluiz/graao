import { describe, expect, it } from 'vitest';
import { ABILITIES, ABILITY_IDS, BASIC_ABILITIES, PASSIVE_ABILITIES, ULTIMATE_ABILITIES, type AbilityEffect } from './abilities';

function walk(effects: AbilityEffect[]): AbilityEffect[] {
  return effects.flatMap((effect) => [effect, ...(effect.kind === 'area' || effect.kind === 'trap' ? walk(effect.effects) : effect.kind === 'projectile' ? walk(effect.onHit) : [])]);
}

describe('official ability catalogue v2', () => {
  it('contains exactly 30 basics, eight automatic passives and ten tactical Ultimates', () => {
    expect(ABILITY_IDS).toHaveLength(40);
    expect(BASIC_ABILITIES).toHaveLength(30);
    expect(PASSIVE_ABILITIES).toHaveLength(8);
    expect(ULTIMATE_ABILITIES).toHaveLength(10);
    const counts = Object.values(ABILITIES).reduce<Record<string, number>>((result, ability) => {
      result[ability.category] = (result[ability.category] ?? 0) + 1;
      return result;
    }, {});
    expect(counts).toEqual({ mobility: 6, control: 7, defense: 5, exploration: 4, passive: 8, ultimate: 10 });
  });

  it('retains all legacy keys while migrating the two extra Ultimates into the specified catalogue', () => {
    for (const id of ['sun_orb', 'wind_step', 'pollen_burst', 'leaf_shell', 'thorn_seed', 'gust_ring', 'sap_snare', 'bloom', 'sun_meteor', 'petal_cyclone', 'dawn_lance'] as const) {
      expect(ABILITIES[id].id).toBe(id);
    }
    expect(ABILITIES.petal_cyclone.name).toBe('Festa de Pólen');
    expect(ABILITIES.dawn_lance.name).toBe('Arrastão de Vento');
  });

  it('provides distinct icons, complete presentation and safe data-driven activation profiles', () => {
    expect(new Set(Object.values(ABILITIES).map((definition) => definition.presentation.icon)).size).toBe(40);
    expect(new Set(ULTIMATE_ABILITIES.map((id) => ABILITIES[id].presentation.mark)).size).toBe(10);
    for (const id of ABILITY_IDS) {
      const definition = ABILITIES[id];
      expect(definition.name.length).toBeGreaterThan(4);
      expect(definition.blurb.length).toBeGreaterThan(15);
      expect(definition.manaCost).toBeGreaterThanOrEqual(0);
      expect(definition.manaCost).toBeLessThanOrEqual(100);
      expect(definition.bot.minRange).toBeLessThanOrEqual(definition.bot.maxRange);
      if (definition.kind === 'passive') {
        expect(definition).toMatchObject({ slotType: 'basic', category: 'passive', manaCost: 0, cooldown: 0, castTime: 0, targetType: 'none', effects: [] });
        expect(definition.passive).toBeDefined();
      } else if (definition.kind === 'ultimate') {
        expect(definition.cooldown).toBeGreaterThanOrEqual(85);
        expect(definition.cooldown).toBeLessThanOrEqual(110);
        expect(definition.presentation.mark).toBeDefined();
      } else {
        expect(definition.cooldown).toBeGreaterThanOrEqual(7);
        expect(definition.cooldown).toBeLessThanOrEqual(24);
      }
    }
  });

  it('keeps weapons as the damage source: only the announced Meteor deals direct spell damage', () => {
    const damageAbilities = ABILITY_IDS.filter((id) => walk(ABILITIES[id].effects).some((effect) => effect.kind === 'damage'));
    expect(damageAbilities).toEqual(['sun_meteor']);
    expect(walk(ABILITIES.sun_meteor.effects).find((effect) => effect.kind === 'damage')).toEqual({ kind: 'damage', amount: 35 });
    expect(ABILITIES.sun_meteor.presentation.telegraph).toBe('ring');
  });
});
