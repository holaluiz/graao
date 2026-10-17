import { describe, expect, it } from 'vitest';
import { WEAPONS } from '@graao/game-data';
import { HitKind, v3angle, v3normalize } from '@graao/shared';
import { applyDamage, falloff, HITBOX, newVitals, rayCapsule, rayPlayers, raySphere, spreadDirections } from './combat';

describe('damage', () => {
  it('hits the shield first, then health', () => {
    const v = newVitals();
    const r = applyDamage(v, 30, false);
    expect(r.kinds).toEqual([HitKind.SHIELD]);
    expect(v.shield).toBe(70);
    expect(v.health).toBe(100);
  });

  it('reports a shield break and spills the rest into health', () => {
    const v = newVitals();
    v.shield = 10;
    const r = applyDamage(v, 25, false);
    expect(r.kinds).toEqual([HitKind.SHIELD_BREAK, HitKind.BODY]);
    expect(v.shield).toBe(0);
    expect(v.health).toBe(85);
  });

  it('marks critical health damage and eliminates at zero', () => {
    const v = newVitals();
    v.shield = 0;
    v.health = 20;
    const r = applyDamage(v, 30, true);
    expect(r.kinds).toEqual([HitKind.CRITICAL, HitKind.ELIMINATION]);
    expect(r.eliminated).toBe(true);
    expect(v.alive).toBe(false);
    expect(v.health).toBe(0);
  });

  it('ignores damage on eliminated players', () => {
    const v = newVitals();
    v.alive = false;
    expect(applyDamage(v, 50, false).kinds).toEqual([]);
  });

  it('takes 200 points of damage to eliminate from full', () => {
    const v = newVitals();
    let shots = 0;
    while (v.alive) {
      applyDamage(v, WEAPONS.sunbeam.damage, false);
      shots++;
    }
    expect(shots).toBe(Math.ceil(200 / WEAPONS.sunbeam.damage));
  });
});

describe('hitboxes', () => {
  const feet = { x: 0, y: 100, z: 0 };
  const players = [{ index: 1, feet, alive: true }];

  it('ray vs sphere and capsule', () => {
    expect(raySphere({ x: -5, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 1)).toBeCloseTo(4, 6);
    expect(raySphere({ x: -5, y: 2, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 1)).toBe(-1);
    expect(rayCapsule({ x: -5, y: 0.5, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, 0.3)).toBeCloseTo(4.7, 6);
    expect(rayCapsule({ x: -5, y: 1.2, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, 0.3)).toBeCloseTo(5 - Math.sqrt(0.09 - 0.04), 5);
  });

  it('detects head (critical) and body hits on a standing player', () => {
    const head = rayPlayers({ x: -10, y: 100 + HITBOX.headHeight, z: 0 }, { x: 1, y: 0, z: 0 }, 50, players, 0);
    expect(head?.head).toBe(true);
    expect(head?.t).toBeCloseTo(10 - HITBOX.headRadius, 4);
    const body = rayPlayers({ x: -10, y: 100.8, z: 0 }, { x: 1, y: 0, z: 0 }, 50, players, 0);
    expect(body?.head).toBe(false);
    expect(rayPlayers({ x: -10, y: 102.5, z: 0 }, { x: 1, y: 0, z: 0 }, 50, players, 0)).toBeNull();
    expect(rayPlayers({ x: -10, y: 100.8, z: 0 }, { x: 1, y: 0, z: 0 }, 5, players, 0)).toBeNull();
    expect(rayPlayers({ x: -10, y: 100.8, z: 0 }, { x: 1, y: 0, z: 0 }, 50, players, 1)).toBeNull();
  });
});

describe('spread and falloff', () => {
  it('is deterministic per seed and stays inside the cone', () => {
    const dir = v3normalize({ x: 0.3, y: 0.2, z: 1 });
    const a = spreadDirections(dir, 5, 8, 1234);
    const b = spreadDirections(dir, 5, 8, 1234);
    expect(a).toEqual(b);
    expect(spreadDirections(dir, 5, 8, 99)).not.toEqual(a);
    for (const d of a) expect((v3angle(d, dir) * 180) / Math.PI).toBeLessThanOrEqual(5.0001);
    expect(v3angle(a[0]!, dir)).toBeLessThan(1e-9);
  });

  it('falls off between start and end distances', () => {
    const w = WEAPONS.petal;
    expect(falloff(w, 2)).toBe(1);
    expect(falloff(w, 100)).toBe(w.falloffMin);
    const mid = falloff(w, (w.falloffStart + w.falloffEnd) / 2);
    expect(mid).toBeGreaterThan(w.falloffMin);
    expect(mid).toBeLessThan(1);
  });
});
