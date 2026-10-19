import { describe, expect, it } from 'vitest';
import { ABILITIES, ATTRIBUTES } from '@graao/game-data';
import { AbilityReject } from '@graao/shared';
import { checkCast, spendCast, validateLoadout } from './abilities';
import { applyDamage, applyTemporaryShield, applyTormentaDamage, expireTemporaryShield, newVitals } from './combat';
import { newPassiveRuntime, passiveModifiers } from './passives';
import { applyStatus, newStatusRuntime, statusModifiers, updateStatusEffects } from './statusEffects';

describe('Ability v2 first vertical slice contracts', () => {
  it('keeps six different tactical mechanics and moderate announced Ultimate damage', () => {
    expect(ABILITIES.wind_step.effects[0]).toMatchObject({ kind: 'dash', distance: 6 });
    expect(ABILITIES.sap_snare.effects[0]).toMatchObject({ kind: 'area', radius: 4, pulses: 20, interval: 0.25 });
    expect(ABILITIES.leaf_shell.effects[0]).toEqual({ kind: 'temporaryShield', amount: 40, duration: 7 });
    expect(ABILITIES.steady_hand.passive).toEqual({ type: 'weaponHandling', factor: 0.88 });
    expect(ABILITIES.firefly_scout.effects[0]).toEqual({ kind: 'reveal', mode: 'resources', radius: 12, duration: 5 });
    expect(ABILITIES.sun_meteor.cooldown).toBe(90);
    expect(JSON.stringify(ABILITIES.sun_meteor.effects)).toContain('"amount":35');
    expect(ABILITIES.sun_meteor.presentation.telegraph).toBe('ring');
  });

  it('spends mana and cooldown once, rejects early or unaffordable casts, and never activates passives', () => {
    const loadout = ['wind_step', 'leaf_shell', 'steady_hand', 'sun_meteor'] as const;
    const state = { alive: true, canFight: true, mana: 100, loadout, cooldownEnds: [0, 0, 0, 0], castUntil: 0 };
    expect(checkCast(state, 0, 'wind_step', 1000)).toBe(AbilityReject.OK);
    const actor = { vitals: newVitals(), cooldownEnds: [0, 0, 0, 0], castUntil: 0 };
    spendCast(actor, 0, ABILITIES.wind_step, 1000);
    expect(actor.vitals.mana).toBe(85);
    expect(actor.cooldownEnds[0]).toBe(8000);
    expect(checkCast({ ...state, cooldownEnds: actor.cooldownEnds }, 0, 'wind_step', 2000)).toBe(AbilityReject.COOLDOWN);
    expect(checkCast({ ...state, mana: 14 }, 0, 'wind_step', 1000)).toBe(AbilityReject.NO_MANA);
    expect(checkCast(state, 2, 'steady_hand', 1000)).toBe(AbilityReject.PASSIVE);
    expect(validateLoadout(loadout)).toEqual(loadout);
    expect(validateLoadout(['steady_hand', 'soft_step', 'wind_step', 'sun_meteor'])).toBeNull();
  });

  it('admits self-cleansing through silence while retaining all other authoritative gates', () => {
    const state = { alive: true, canFight: true, mana: 100, loadout: ['rain_bath', 'wind_step', 'steady_hand', 'confetti_wheel'], cooldownEnds: [0, 0, 0, 0], castUntil: 0, silenced: true };
    expect(checkCast(state, 0, 'rain_bath', 1000)).toBe(AbilityReject.OK);
    expect(checkCast(state, 3, 'confetti_wheel', 1000)).toBe(AbilityReject.OK);
    expect(checkCast(state, 1, 'wind_step', 1000)).toBe(AbilityReject.SILENCED);
    expect(checkCast({ ...state, mana: 0 }, 0, 'rain_bath', 1000)).toBe(AbilityReject.NO_MANA);
    expect(checkCast({ ...state, blocked: true }, 0, 'rain_bath', 1000)).toBe(AbilityReject.BLOCKED);
    expect(checkCast({ ...state, cooldownEnds: [5000, 0, 0, 0] }, 0, 'rain_bath', 1000)).toBe(AbilityReject.COOLDOWN);
  });

  it('consumes temporary protection first, expires it without inflating Shield and never protects against Tormenta', () => {
    const vitals = newVitals();
    vitals.shield = 20;
    applyTemporaryShield(vitals, 40, 7, 1000);
    const first = applyDamage(vitals, 25, false);
    expect(first.temporaryShieldDamage).toBe(25);
    expect([vitals.temporaryShield, vitals.shield, vitals.health]).toEqual([15, 20, 100]);
    applyDamage(vitals, 25, false);
    expect([vitals.temporaryShield, vitals.shield, vitals.health]).toEqual([0, 10, 100]);
    applyTemporaryShield(vitals, 40, 7, 2000);
    applyTormentaDamage(vitals, 10);
    expect([vitals.temporaryShield, vitals.shield, vitals.health]).toEqual([40, 10, 90]);
    expireTemporaryShield(vitals, 9000);
    expect([vitals.temporaryShield, vitals.shield]).toEqual([0, 10]);
    expect(vitals.health).toBeLessThanOrEqual(ATTRIBUTES.maxHealth);
  });

  it('does not multiply slows or prolong a short stronger slow with a long weaker one', () => {
    const runtime = newStatusRuntime();
    applyStatus(runtime, 'slow', 0.75, 5, 1000, 1);
    applyStatus(runtime, 'slow', 0.65, 1, 1000, 2);
    expect(statusModifiers(runtime, 1500).speedFactor).toBe(0.65);
    updateStatusEffects(runtime, 2100);
    expect(statusModifiers(runtime, 2100).speedFactor).toBe(0.75);
    updateStatusEffects(runtime, 6000);
    expect(statusModifiers(runtime, 6000).speedFactor).toBe(1);
  });

  it('applies Mão Firme to actual weapon recoil and dispersion modifiers, with neutral values when eliminated', () => {
    const loadout = ['wind_step', 'leaf_shell', 'steady_hand', 'sun_meteor'];
    const runtime = newPassiveRuntime(0);
    const modifiers = passiveModifiers(loadout, runtime, 1000);
    expect([modifiers.weaponRecoil, modifiers.weaponSpread]).toEqual([0.88, 0.88]);
    expect(passiveModifiers(loadout, runtime, 1000, false).weaponSpread).toBe(1);
    expect(runtime.active).toBe(false);
  });
});
