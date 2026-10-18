import { describe, expect, it } from 'vitest';
import { createCharacterState } from '@graao/game-core';
import { InputButton } from '@graao/shared';
import { botIntent } from './BotBrain';

describe('solo bot movement intent', () => {
  it('pursues across the local tangent plane and aims at a target on a spherical world', () => {
    const state = createCharacterState({ x: 100, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    const intent = botIntent(state, { x: 96, y: 28, z: 0 }, 1, 1000);
    expect(intent.wish.x).toBeCloseTo(0);
    expect(intent.wish.y).toBeGreaterThan(0.8);
    expect(Math.hypot(intent.wish.x, intent.wish.y, intent.wish.z)).toBeCloseTo(1);
    expect(intent.aim.x).toBeLessThan(0);
    expect(intent.aim.y).toBeGreaterThan(0.9);
    expect(intent.buttons & InputButton.SPRINT).not.toBe(0);
    expect(intent.origin.x).toBeCloseTo(101.6);
  });

  it('keeps space near an opponent and can sidestep a blocked route', () => {
    const state = createCharacterState({ x: 0, y: 100, z: 0 }, { x: 0, y: 0, z: 1 });
    const close = botIntent(state, { x: 0, y: 100, z: 3 }, 1, 1500);
    expect(close.wish.z).toBeLessThan(0);
    const blocked = botIntent(state, { x: 0, y: 100, z: 30 }, 1, 1500, true);
    expect(Math.abs(blocked.wish.x)).toBeGreaterThan(blocked.wish.z);
    expect(blocked.buttons & InputButton.JUMP).not.toBe(0);
  });

  it('stays idle without targets and handles coincident or antipodal targets without invalid vectors', () => {
    const state = createCharacterState({ x: 0, y: 100, z: 0 }, { x: 0, y: 0, z: 1 });
    expect(botIntent(state, undefined, 1, 0).wish).toEqual({ x: 0, y: 0, z: 0 });
    for (const target of [state.pos, { x: 0, y: -100, z: 0 }]) {
      const intent = botIntent(state, target, 1, 0);
      expect([...Object.values(intent.wish), ...Object.values(intent.aim)].every(Number.isFinite)).toBe(true);
    }
  });
});
