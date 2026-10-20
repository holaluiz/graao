import { describe, expect, it } from 'vitest';
import { WEAPONS } from '@graao/game-data';
import { HitKind, v3angle, v3normalize } from '@graao/shared';
import { aimRayStart, applyDamage, falloff, HITBOX, muzzlePoint, newVitals, rayCapsule, rayPlayers, raySphere, resolvePellet, spreadDirections } from './combat';
import type { GamePhysics } from './physics';

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

describe('aim ray from the shoulder camera', () => {
  // Shooter at (0, 100, 0) facing +z, the target 5 m ahead; spherical "walls" stand in for colliders (a ray that
  // starts inside one hits it at 0, like Rapier's solid casts).
  const shooter = { x: 0, y: 100, z: 0 };
  const facing = { x: 0, y: 0, z: 1 };
  const muzzle = muzzlePoint(shooter, facing);
  const targets = [{ index: 0, feet: shooter, alive: true }, { index: 1, feet: { x: 0, y: 100, z: 5 }, alive: true }];
  const camera = { x: -0.42, y: 101.62, z: -4.4 };
  const dir = v3normalize({ x: 0 - camera.x, y: 101.1 - camera.y, z: 5 - camera.z });
  const world = (walls: { c: { x: number; y: number; z: number }; r: number; handle: number }[]) =>
    ({
      castRay(o: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }, max: number) {
        let best: { toi: number; handle: number } | null = null;
        for (const w of walls) {
          const t = raySphere(o, d, w.c, w.r);
          if (t >= 0 && t <= max && (!best || t < best.toi)) best = { toi: t, handle: w.handle };
        }
        return best;
      },
    }) as unknown as GamePhysics;

  it('starts level with the shooter', () => {
    expect(aimRayStart(camera, dir, muzzle)).toBeGreaterThan(4);
    expect(aimRayStart(camera, dir, { x: 0, y: 101.6, z: -6 })).toBe(0);
  });

  it('a camera inside a wall (or behind one) does not eat the shot', () => {
    const inside = resolvePellet(world([{ c: camera, r: 0.6, handle: 7 }]), camera, dir, muzzle, 60, targets, 0);
    expect(inside.target).toBe(1);
    const behind = resolvePellet(world([{ c: { x: -0.4, y: 101.5, z: -2.2 }, r: 0.5, handle: 7 }]), camera, dir, muzzle, 60, targets, 0);
    expect(behind.target).toBe(1);
  });

  it('a wall between the shooter and the target still blocks it', () => {
    const r = resolvePellet(world([{ c: camera, r: 0.6, handle: 7 }, { c: { x: 0, y: 101, z: 2.5 }, r: 0.6, handle: 8 }]), camera, dir, muzzle, 60, targets, 0);
    expect(r.target).toBe(-1);
    expect(r.handle).toBe(8);
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
