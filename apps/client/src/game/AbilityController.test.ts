import { describe, expect, it } from 'vitest';
import { ABILITIES, ABILITY_RULES } from '@graao/game-data';
import { AbilityReject, type SelfStatusMsg } from '@graao/shared';
import { AbilityController } from './AbilityController';

const status = (o: Partial<SelfStatusMsg>): SelfStatusMsg => ({ weapon: 0, ammo: [24, 4], reloading: false, reloadEndsAt: 0, alive: true, respawnAt: 0, shotSeq: -1, mana: 100, cd: [0, 0, 0, 0], castUntil: 0, abilitySeq: -1, slowUntil: 0, slow: 100, wpn: ['sunbeam', ''], res: [48, 0, 0], inv: [0, 0, 0], useUntil: 0, useItem: -1, ...o });
const same = (t: number) => t;

describe('AbilityController (client mirror, never the judge)', () => {
  it('predicts an expected cast at once: cooldown sweep, wind-up and Mana', () => {
    const c = new AbilityController();
    const p = c.press(0, 1000, true, true)!;
    expect(p.predicted).toBe(true);
    expect(p.id).toBe('sun_orb');
    expect(c.cooldownLeft(0, 1000)).toBeCloseTo(ABILITIES.sun_orb.cooldown, 6);
    expect(c.cooldownFrac(0, 1000)).toBe(1);
    expect(c.manaShown).toBe(100 - ABILITIES.sun_orb.manaCost);
    // The server agrees: SELF brings the spent Mana; nothing to roll back.
    expect(c.onResult({ s: p.seq, k: 0, ok: true, r: AbilityReject.OK })).toEqual({ rollback: false, late: false, reason: AbilityReject.OK });
    c.applyServer(status({ mana: 80, cd: [1000 + 2500, 0, 0, 0] }), 1010, 1010, same);
    expect(c.manaShown).toBe(80);
    expect(c.cooldownLeft(0, 1010)).toBeCloseTo(2.49, 2);
  });

  it('rolls a refused prediction back (the server decides)', () => {
    const c = new AbilityController();
    const p = c.press(2, 1000, true, true)!;
    expect(c.casting(1100)).toBe(true);
    // SELF arriving before the answer keeps the predicted slot.
    c.applyServer(status({}), 1020, 1020, same);
    expect(c.cooldownLeft(2, 1020)).toBeGreaterThan(0);
    const r = c.onResult({ s: p.seq, k: 2, ok: false, r: AbilityReject.BLOCKED });
    expect(r.rollback).toBe(true);
    expect(c.cooldownLeft(2, 1030)).toBe(0);
    expect(c.casting(1030)).toBe(false);
    expect(c.manaShown).toBe(100);
  });

  it('still asks the server when the mirror expects a refusal, and presents a late acceptance', () => {
    const c = new AbilityController();
    c.mana = 5;
    expect(c.expect(1, 1000, true, true)).toBe(AbilityReject.NO_MANA);
    const p = c.press(1, 1000, true, true)!;
    expect(p.predicted).toBe(false);
    expect(c.onResult({ s: p.seq, k: 1, ok: false, r: AbilityReject.NO_MANA })).toEqual({ rollback: false, late: false, reason: AbilityReject.NO_MANA });
    // The mirror was stale (Mana regenerated on the server): accepted without prediction → present late.
    const q = c.press(1, 1100, true, true)!;
    expect(c.onResult({ s: q.seq, k: 1, ok: true, r: AbilityReject.OK }).late).toBe(true);
  });

  it('the Ultimate charges from full on a fresh life and the slow mirrors the server', () => {
    const c = new AbilityController();
    const charge = ABILITY_RULES.ultimateInitialCharge * 1000;
    c.applyServer(status({ cd: [0, 0, 0, 5000 + charge], slowUntil: 6000, slow: 55 }), 5000, 5000, same);
    expect(c.cooldownFrac(3, 5000)).toBeCloseTo(1, 3);
    expect(c.cooldownFrac(3, 5000 + charge / 2)).toBeCloseTo(0.5, 3);
    expect(c.expect(3, 5000, true, true)).toBe(AbilityReject.COOLDOWN);
    expect(c.slowNow(5500)).toBe(0.55);
    expect(c.slowNow(6000)).toBe(1);
    expect(c.expect(0, 5000, false, true)).toBe(AbilityReject.DEAD);
    expect(c.expect(0, 5000, true, false)).toBe(AbilityReject.PHASE);
  });

  it('never queues, predicts a cooldown or spends Mana when a passive slot is pressed', () => {
    const c = new AbilityController();
    c.setLoadout(['sun_orb', 'wind_step', 'steady_hand', 'sun_meteor']);
    expect(c.expect(2, 1000, true, true)).toBe(AbilityReject.PASSIVE);
    expect(c.press(2, 1000, true, true)).toBeNull();
    expect(c.manaShown).toBe(100);
    expect(c.cooldownLeft(2, 1000)).toBe(0);
    expect(c.casting(1000)).toBe(false);
  });

  it('mirrors silence, temporary protection and passive conditions without inventing their lifetime', () => {
    const c = new AbilityController();
    c.applyServer(status({ silencedUntil: 1800, rootedUntil: 1700, noSprintUntil: 1900, blockedUntil: 2000,
      tempShield: 40, tempShieldUntil: 8000, passiveActive: [false, false, true, false], speed: 65, sprintSpeed: 107, airControl: 120,
    }), 1000, 1000, same);
    expect(c.expect(0, 1000, true, true)).toBe(AbilityReject.SILENCED);
    expect(c.expect(0, 1800, true, true)).toBe(AbilityReject.BUSY);
    expect(c.expect(0, 2000, true, true)).toBe(AbilityReject.OK);
    expect(c.temporaryShield).toBe(40);
    expect(c.temporaryShieldEnd).toBe(8000);
    expect(c.passiveActive).toEqual([false, false, true, false]);
    expect([c.speed, c.sprintSpeed, c.airControl]).toEqual([.65, 1.07, 1.2]);
    c.reset();
    expect(c.silencedEnd).toBe(0);
    expect(c.temporaryShield).toBe(0);
    expect(c.passiveActive).toEqual([false, false, false, false]);
  });

  it('keeps target rejection feedback separate from authoritative cooldown state', () => {
    const c = new AbilityController();
    const p = c.press(0, performance.now(), true, true)!;
    c.onResult({ s: p.seq, k: 0, ok: false, r: AbilityReject.BAD_TARGET });
    expect(c.targetState(0, performance.now())).toBe('invalid_target');
    expect(c.targetState(0, performance.now() + 1000)).toBeNull();
    expect(c.cooldownLeft(0, performance.now())).toBe(0);
  });
});
