import { describe, expect, it } from 'vitest';
import { applyStatus, cleanseStatusEffects, newAbilityRuntime, newStatusRuntime, resetAbilityRuntime, statusModifiers, updateStatusEffects } from './statusEffects';

describe('timed status rules', () => {
  it('uses the strongest current slow, restores weaker effects on expiry and caps movement bonuses', () => {
    const runtime = newStatusRuntime();
    applyStatus(runtime, 'slow', 0.75, 5, 0, 1);
    applyStatus(runtime, 'slow', 0.65, 1, 0, 2);
    applyStatus(runtime, 'speed', 100, 2, 0, 3);
    applyStatus(runtime, 'speed', 1.1, 5, 0, 4);
    expect(statusModifiers(runtime, 500).speedFactor).toBeCloseTo(0.65 * 1.3);
    expect(statusModifiers(runtime, 1100).speedFactor).toBeCloseTo(0.75 * 1.3);
    expect(statusModifiers(runtime, 2100).speedFactor).toBeCloseTo(0.75 * 1.1);
    updateStatusEffects(runtime, 5000);
    expect(statusModifiers(runtime, 5000).speedFactor).toBe(1);
    expect(runtime.effects).toHaveLength(0);
  });

  it('bounds hard control and rejects chained refreshes during recovery', () => {
    const runtime = newStatusRuntime();
    expect(applyStatus(runtime, 'root', 1, 100, 1000, 1)).toBe(true);
    expect(runtime.effects[0]!.endsAt).toBe(1800);
    expect(applyStatus(runtime, 'root', 1, 0.8, 1200, 2)).toBe(false);
    expect(statusModifiers(runtime, 1500).rooted).toBe(true);
    expect(statusModifiers(runtime, 1800).rooted).toBe(false);
    expect(applyStatus(runtime, 'root', 1, 0.8, 2000, 2)).toBe(false);
    expect(applyStatus(runtime, 'root', 1, 0.8, 2800, 2)).toBe(true);
    expect(runtime.effects).toHaveLength(1);
  });

  it('keeps overlapping spells from the same caster independent when their slow strengths differ', () => {
    const runtime = newStatusRuntime();
    applyStatus(runtime, 'slow', 0.7, 3, 1000, 5);
    applyStatus(runtime, 'slow', 0.65, 0.4, 1100, 5);
    expect(statusModifiers(runtime, 1200).speedFactor).toBe(0.65);
    expect(statusModifiers(runtime, 1600).speedFactor).toBe(0.7);
    applyStatus(runtime, 'slow', 0.7, 0.2, 1700, 5);
    expect(statusModifiers(runtime, 2500).speedFactor).toBe(0.7);
    expect(statusModifiers(runtime, 4000).speedFactor).toBe(1);
  });

  it('cleanses only permitted tags and applies temporary resistance without damage immunity', () => {
    const runtime = newStatusRuntime();
    applyStatus(runtime, 'slow', 0.65, 3, 0, 1);
    applyStatus(runtime, 'silence', 1, 0.8, 0, 1);
    applyStatus(runtime, 'root', 1, 0.8, 0, 1);
    applyStatus(runtime, 'speed', 1.15, 6, 0, 2);
    expect(cleanseStatusEffects(runtime, ['slow', 'silence', 'noSprint'], 100, 0.65, 2)).toBe(2);
    expect(statusModifiers(runtime, 100)).toMatchObject({ rooted: true, silenced: false });
    expect(runtime.effects.some((effect) => effect.kind === 'speed')).toBe(true);
    applyStatus(runtime, 'slow', 0.65, 3, 200, 2);
    expect(runtime.effects.find((effect) => effect.kind === 'slow')!.endsAt).toBeCloseTo(1250);
    updateStatusEffects(runtime, 2200);
    applyStatus(runtime, 'slow', 0.65, 3, 2200, 2);
    expect(runtime.effects.find((effect) => effect.kind === 'slow')!.endsAt).toBe(5200);
  });

  it('applies Anti-Cola to slow/silence duration only and retains minimum counterplay durations', () => {
    const runtime = newStatusRuntime();
    applyStatus(runtime, 'slow', 0, 4, 1000, 1, 0.25);
    applyStatus(runtime, 'silence', 1, 0.8, 1000, 1, 0.25);
    applyStatus(runtime, 'noSprint', 1, 2.5, 1000, 1, 0.25);
    expect(runtime.effects.find((effect) => effect.kind === 'slow')).toMatchObject({ endsAt: 4000, factor: 0.3 });
    expect(runtime.effects.find((effect) => effect.kind === 'silence')!.endsAt).toBe(1600);
    expect(runtime.effects.find((effect) => effect.kind === 'noSprint')!.endsAt).toBe(3500);
    applyStatus(runtime, 'slow', 0.7, 0.01, 2000, 3, 0.8);
    expect(runtime.effects.find((effect) => effect.source === 3)!.endsAt).toBe(2150);
  });

  it('clears effects, resistance and passive timing on death or reset', () => {
    const runtime = newAbilityRuntime(0);
    applyStatus(runtime, 'slow', 0.65, 3, 0, 1);
    cleanseStatusEffects(runtime, ['silence'], 0, 0.5, 2);
    runtime.passive.shieldCarry = 0.75;
    updateStatusEffects(runtime, 100, false);
    expect(runtime.effects).toHaveLength(0);
    expect(runtime.resistances).toHaveLength(0);
    resetAbilityRuntime(runtime, 200);
    expect(runtime.passive).toEqual({ lastDamageAt: 200, lastFireAt: 200, shieldCarry: 0, active: false });
    expect(runtime.recovery).toEqual({});
  });

  it('rejects invalid durations and magnitudes without polluting state', () => {
    const runtime = newStatusRuntime();
    for (const duration of [0, -1, NaN, Infinity]) expect(applyStatus(runtime, 'slow', 0.65, duration, 0)).toBe(false);
    expect(applyStatus(runtime, 'slow', NaN, 2, 0)).toBe(false);
    expect(runtime.effects).toHaveLength(0);
  });
});
