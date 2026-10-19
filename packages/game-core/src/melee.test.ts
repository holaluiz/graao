import { describe, expect, it } from 'vitest';
import { MELEE } from '@graao/game-data';
import type { Vec3 } from '@graao/shared';
import { PLAYER_MELEE_BODY, meleeReady, resolveMelee, type MeleeBody, type MeleeRayCaster } from './melee';
import { latLonToDir, northTangent } from './sphere';

const R = 100;
const feet = (lat: number, lon: number): Vec3 => {
  const d = latLonToDir(lat, lon);
  return { x: d.x * R, y: d.y * R, z: d.z * R };
};
/** 1 m ≈ 0.573° on a 100 m planet. */
const M = 180 / (Math.PI * R);
const open: MeleeRayCaster = { castRay: () => null };
/** A wall plane `at` metres north of the attacker (along +lat). */
const wallNorth = (at: number): MeleeRayCaster => ({
  castRay: (o, d, max) => {
    const north = northTangent({ x: o.x / R, y: o.y / R, z: o.z / R });
    const along = d.x * north.x + d.y * north.y + d.z * north.z;
    if (along <= 1e-3) return null;
    const t = at / along;
    return t <= max ? { toi: t } : null;
  },
});
const player = (id: number, p: Vec3): MeleeBody => ({ id, creep: false, feet: p, alive: true, ...PLAYER_MELEE_BODY });

describe('punches (resolveMelee)', () => {
  const me = feet(0, 0);
  const north = northTangent({ x: me.x / R, y: me.y / R, z: me.z / R });

  it('reaches a player in front within range, and only one body', () => {
    const near = player(1, feet(1.2 * M, 0));
    const farther = player(2, feet(1.6 * M, 0));
    const out = resolveMelee(open, me, north, [farther, near, player(0, me)], 0);
    expect(out.result).toBe(1);
    expect(out.target).toBe(1);
  });

  it('misses what is behind, beside the cone, or out of reach, and never hits the attacker', () => {
    const behind = player(1, feet(-1.2 * M, 0));
    const side = player(2, feet(0.3 * M, 1.4 * M));
    const far = player(3, feet((MELEE.range + PLAYER_MELEE_BODY.radius + 0.4) * M, 0));
    const out = resolveMelee(open, me, north, [behind, side, far, player(0, me)], 0);
    expect(out.result).toBe(0);
    expect(out.target).toBe(-1);
  });

  it('hits a creep by its own capsule, and the dead count for nothing', () => {
    const creep: MeleeBody = { id: 7, creep: true, feet: feet(1.5 * M, 0), alive: true, bottom: 0, top: 0.78, radius: 0.4 };
    const dead = player(1, feet(0.9 * M, 0));
    dead.alive = false;
    const out = resolveMelee(open, me, north, [dead, creep], 0);
    expect(out).toMatchObject({ result: 2, target: 7 });
  });

  it('is stopped by a wall between the fists and the target (no punching through walls)', () => {
    const target = player(1, feet(1.3 * M, 0));
    const out = resolveMelee(wallNorth(0.4), me, north, [target], 0);
    expect(out.result).toBe(3);
    expect(out.target).toBe(-1);
    // With the wall behind the target the punch lands.
    expect(resolveMelee(wallNorth(3), me, north, [target], 0).result).toBe(1);
  });

  it('flattens the aim onto the ground: looking down at a player in front still punches them', () => {
    const target = player(1, feet(1.1 * M, 0));
    const up = { x: me.x / R, y: me.y / R, z: me.z / R };
    const down = { x: north.x * 0.5 - up.x * 0.86, y: north.y * 0.5 - up.y * 0.86, z: north.z * 0.5 - up.z * 0.86 };
    expect(resolveMelee(open, me, down, [target], 0).result).toBe(1);
  });

  it('enforces the interval with a small tolerance', () => {
    expect(meleeReady(1000, 1000 + MELEE.intervalMs, MELEE.intervalMs)).toBe(true);
    expect(meleeReady(1000, 1000 + MELEE.intervalMs * 0.9, MELEE.intervalMs)).toBe(true);
    expect(meleeReady(1000, 1000 + MELEE.intervalMs * 0.5, MELEE.intervalMs)).toBe(false);
  });
});
