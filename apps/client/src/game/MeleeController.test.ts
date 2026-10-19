import { describe, expect, it } from 'vitest';
import { MELEE } from '@graao/game-data';
import { MeleeController } from './MeleeController';

describe('MeleeController (local punch timing)', () => {
  it('punches on a click, never faster than the interval, alternating hands', () => {
    const m = new MeleeController();
    const a = m.update(1000, true, true, true);
    expect(a).toEqual({ seq: 1, hand: 0 });
    // Held: nothing until the interval has passed, then the other hand.
    expect(m.update(1000 + MELEE.intervalMs - 1, false, true, true)).toBeNull();
    expect(m.update(1000 + MELEE.intervalMs, false, true, true)).toEqual({ seq: 2, hand: 1 });
    // Released: no more punches.
    expect(m.update(1000 + MELEE.intervalMs * 3, false, false, true)).toBeNull();
  });

  it('buffers a click made just before the next punch is ready, and drops it when it cannot punch', () => {
    const m = new MeleeController();
    m.update(0, true, false, true);
    expect(m.update(MELEE.intervalMs - 100, true, false, true)).toBeNull();
    expect(m.update(MELEE.intervalMs + 10, false, false, true)?.seq).toBe(2);
    expect(m.update(MELEE.intervalMs * 3, true, true, false)).toBeNull();
  });

  it('follows a shorter interval (Velocidade de Ataque)', () => {
    const m = new MeleeController();
    m.intervalMs = 500;
    m.update(0, true, true, true);
    expect(m.update(500, false, true, true)).not.toBeNull();
  });
});
