import { describe, expect, it } from 'vitest';
import { ABILITIES, type Loadout } from '@graao/game-data';
import { createCharacterState, newAbilityRuntime, newVitals, type AbilityActor } from '@graao/game-core';
import { chooseBotAbility, type BotAbilitySituation } from './BotAbilityController';

const actor = (loadout: Loadout): AbilityActor => ({ index: 0, loadout, state: createCharacterState({ x: 0, y: 0, z: 100 }, { x: 1, y: 0, z: 0 }), vitals: newVitals(), runtime: newAbilityRuntime(), cooldownEnds: [0, 0, 0, 0], castUntil: 0, slowUntil: 0, slowFactor: 1 });
const situation: BotAbilitySituation = { now: 10000, distance: 10, hasEnemy: true, enemyVisible: true, seekingZone: false, hasResources: false, nearWall: false, recentlyHurt: false, canFight: true };

describe('tactical bot ability intentions', () => {
  it('never manually activates passives, exhausted mana, cooldowns or a dead actor', () => {
    const a = actor(['steady_hand', 'wind_step', 'sap_snare', 'sun_meteor']);
    expect(chooseBotAbility(a, situation)?.def.id).not.toBe('steady_hand');
    a.vitals.mana = 0;
    expect(chooseBotAbility(a, situation)).toBeNull();
    a.vitals.mana = 100;
    a.cooldownEnds.fill(20000);
    expect(chooseBotAbility(a, situation)).toBeNull();
    a.cooldownEnds.fill(0);
    a.vitals.alive = false;
    expect(chooseBotAbility(a, situation)).toBeNull();
  });
  it('does not spend an offensive ultimate in empty space or across hidden opponents', () => {
    const a = actor(['steady_hand', 'wind_step', 'sap_snare', 'sun_meteor']);
    a.cooldownEnds[1] = a.cooldownEnds[2] = 20000;
    expect(chooseBotAbility(a, { ...situation, hasEnemy: false }, 3)).toBeNull();
    expect(chooseBotAbility(a, { ...situation, enemyVisible: false }, 3)).toBeNull();
    expect(chooseBotAbility(a, situation, 3)?.def.id).toBe('sun_meteor');
  });
  it('uses resources, hurt defenses and air mobility only in useful conditions', () => {
    const a = actor(['firefly_scout', 'leaf_shell', 'paper_wings', 'kite_flight']);
    a.state.grounded = true;
    expect(chooseBotAbility(a, situation)).toBeNull();
    expect(chooseBotAbility(a, { ...situation, hasResources: true })?.slot).toBe(0);
    expect(chooseBotAbility(a, { ...situation, recentlyHurt: true }, 1)?.slot).toBe(1);
    a.state.grounded = false;
    expect(chooseBotAbility(a, situation, 2)?.slot).toBe(2);
  });
  it('all forty catalog entries have a real tactical role and bounded ranges', () => {
    expect(Object.values(ABILITIES)).toHaveLength(40);
    for (const def of Object.values(ABILITIES)) {
      expect(def.bot.role === 'passive').toBe(def.kind === 'passive');
      expect(def.bot.minRange).toBeGreaterThanOrEqual(0);
      expect(def.bot.maxRange).toBeGreaterThanOrEqual(def.bot.minRange);
    }
  });
});
