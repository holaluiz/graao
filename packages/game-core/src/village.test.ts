/**
 * Vila das Lanternas graybox (World Building 1.0, phase C): the authored map plays like it looks. A character on the
 * real planet walks through doors, up the external stair onto a flat roof and across the footbridge; walls stop
 * shots, windows and railings let them through, railings stop people; every village chest spot is valid.
 */
import { describe, expect, it } from 'vitest';
import { CHEST_SPOTS, GRAAO_MAP, KIT, KIT_BUILDINGS, MAP_HASH, MOVEMENT, validateMap } from '@graao/game-data';
import { v3dot, v3len, v3normalize, v3projectOnPlane, type Vec3 } from '@graao/shared';
import { CharacterMotor, createCharacterState, newInput, type CharacterBody, type CharacterState } from './character';
import { resolveChestSpots } from './chests';
import { placementToWorld, type Placement } from './layout';
import { GROUPS_WORLD_QUERY } from './physics';
import { createGameWorld } from './world';

const world = await createGameWorld({ includeVisual: false });
const motor = new CharacterMotor(world.physics);

/** A building's frame: its foundation piece sits at the building origin with the building's own axes. */
function building(mapId: string) {
  const p = world.layout.placements.find((q) => q.mapId === mapId && q.prefab?.startsWith('fundacao'));
  if (!p) throw new Error(`no building ${mapId}`);
  return {
    p,
    at: (x: number, y: number, z: number): Vec3 => placementToWorld(p, x, y, z),
    /** Height of a point above the building base, along the building's up. */
    heightOf: (q: Vec3): number => v3dot({ x: q.x - p.position.x, y: q.y - p.position.y, z: q.z - p.position.z }, p.up),
    local: (q: Vec3) => {
      const d = { x: q.x - p.position.x, y: q.y - p.position.y, z: q.z - p.position.z };
      return { x: v3dot(d, p.side), y: v3dot(d, p.up), z: v3dot(d, p.forward) };
    },
  };
}

interface Walker {
  s: CharacterState;
  body: CharacterBody;
  minHeight: number;
}

/** A character standing (after settling) at `feet`. */
function spawn(feet: Vec3, facing: Vec3): Walker {
  const up = v3normalize(feet);
  const s = createCharacterState({ x: feet.x + up.x * 0.15, y: feet.y + up.y * 0.15, z: feet.z + up.z * 0.15 }, v3normalize(v3projectOnPlane(facing, up)));
  const body = motor.createBody(s);
  const inp = newInput();
  for (let i = 0; i < 30; i++) motor.step(body, s, inp, 1 / 60);
  return { s, body, minHeight: Infinity };
}

/** Runs toward `target` (steering on the tangent plane) until within `reach` m or `maxSeconds`. */
function walkTo(w: Walker, target: Vec3, track?: (q: Vec3) => number, maxSeconds = 8, reach = 0.35): boolean {
  const inp = newInput();
  for (let i = 0; i < maxSeconds * 60; i++) {
    const up = v3normalize(w.s.pos);
    const to = v3projectOnPlane({ x: target.x - w.s.pos.x, y: target.y - w.s.pos.y, z: target.z - w.s.pos.z }, up);
    if (v3len(to) < reach) return true;
    inp.wish = v3normalize(to);
    motor.step(w.body, w.s, inp, 1 / 60);
    if (track) w.minHeight = Math.min(w.minHeight, track(w.s.pos));
  }
  return false;
}

/** Pushes along `dir` for `seconds`. */
function push(w: Walker, dir: Vec3, seconds: number): void {
  const inp = newInput();
  inp.wish = dir;
  for (let i = 0; i < seconds * 60; i++) motor.step(w.body, w.s, inp, 1 / 60);
}

const casa = building('vila-casa-laje');
const mercado = building('vila-mercadinho');
const beco = building('vila-casa-beco');

describe('map file', () => {
  it('is valid, versioned and hashed', () => {
    expect(validateMap(GRAAO_MAP)).toEqual([]);
    expect(MAP_HASH).toMatch(/^planeta-graao@\d+\.\d+\.\d+#[0-9a-f]{8}$/);
    // Every building of the kit is used by the village.
    for (const id of Object.keys(KIT_BUILDINGS)) expect(GRAAO_MAP.placements.some((p) => p.prefab === id), id).toBe(true);
  });

  it('every village kit piece stands on the ground: no floating floors, no buried walls', () => {
    const vila = world.layout.placements.filter((p) => p.mapId?.startsWith('vila-') && p.prefab?.startsWith('fundacao'));
    expect(vila.length).toBe(4);
    for (const p of vila) {
      const ground = world.terrain.heightAt(p.up) + world.terrain.radius;
      // Each corner of the floor slab: terrain within the 0.8 m foundation, never above the floor.
      for (const [x, z] of [[-3, -2], [3, -2], [-3, 2], [3, 2]] as const) {
        const c = placementToWorld(p, x, 0, z);
        const under = world.terrain.radius + world.terrain.heightAt(v3normalize(c));
        const base = v3len(c);
        expect(base - under, `${p.mapId} corner ${x},${z}`).toBeGreaterThan(-0.05);
        expect(base - under, `${p.mapId} corner ${x},${z}`).toBeLessThan(KIT.foundation - 0.1);
      }
      expect(Math.abs(v3len(p.position) - ground)).toBeLessThan(0.01);
    }
  });
});

describe('Vila das Lanternas on foot', () => {
  it('walks from the plaza through the front door into the Casa da Laje, then out the back door', () => {
    const w = spawn(casa.at(0, 0, 5.5), casa.p.forward);
    expect(walkTo(w, casa.at(0, 0, 0))).toBe(true);
    const inside = casa.local(w.s.pos);
    expect(Math.abs(inside.x)).toBeLessThan(2.6);
    expect(Math.abs(inside.z)).toBeLessThan(2.6);
    expect(inside.y).toBeCloseTo(KIT.floorTop, 1);
    expect(w.s.grounded).toBe(true);
    expect(walkTo(w, casa.at(0, 0, -5))).toBe(true);
    w.body.dispose();
  });

  it('climbs the external stair and steps onto the laje', () => {
    const w = spawn(casa.at(-3.74, 0, 4.4), casa.p.forward);
    expect(walkTo(w, casa.at(-3.74, 3.35, -2.5), (q) => casa.heightOf(q))).toBe(true);
    expect(casa.heightOf(w.s.pos)).toBeGreaterThan(KIT.roofTop - 0.1);
    expect(walkTo(w, casa.at(-1.2, 3.35, -2.0))).toBe(true);
    expect(casa.heightOf(w.s.pos)).toBeCloseTo(KIT.roofTop, 1);
    expect(w.s.grounded).toBe(true);
    // And back down the same way.
    expect(walkTo(w, casa.at(-3.74, 3.35, -2.5))).toBe(true);
    expect(walkTo(w, casa.at(-3.74, 0, 4.6))).toBe(true);
    expect(casa.heightOf(w.s.pos)).toBeLessThan(0.3);
    w.body.dispose();
  });

  it('crosses the footbridge over Rua do Norte from roof to roof without falling', () => {
    const w = spawn(casa.at(1.6, KIT.roofTop, 0), casa.p.forward);
    expect(casa.heightOf(w.s.pos)).toBeCloseTo(KIT.roofTop, 1);
    // Measured along the local radial (the two roofs are 11 m apart: their tangent planes differ by ≈ 6°).
    const aboveGround = (q: Vec3) => v3len(q) - (world.terrain.radius + world.terrain.heightAt(v3normalize(q)));
    expect(walkTo(w, mercado.at(-1.6, KIT.roofTop, 0), aboveGround)).toBe(true);
    expect(w.minHeight).toBeGreaterThan(KIT.roofTop - 0.25);
    expect(mercado.heightOf(w.s.pos)).toBeCloseTo(KIT.roofTop, 1);
    // The Mercadinho's own stair leads back down to the street on the other side.
    expect(walkTo(w, mercado.at(1.4, KIT.roofTop, -2.1))).toBe(true);
    expect(walkTo(w, mercado.at(3.74, KIT.roofTop, -2.5))).toBe(true);
    expect(walkTo(w, mercado.at(3.74, 0, 4.6))).toBe(true);
    expect(mercado.heightOf(w.s.pos)).toBeLessThan(0.3);
    w.body.dispose();
  });

  it('the footbridge railings stop a player walking sideways', () => {
    const bridge = world.layout.placements.find((p) => p.mapId === 'vila-passarela')!;
    const w = spawn(placementToWorld(bridge, 0, 0, 0), bridge.forward);
    push(w, bridge.side, 1.2);
    push(w, { x: -bridge.side.x, y: -bridge.side.y, z: -bridge.side.z }, 1.2);
    const local = v3dot({ x: w.s.pos.x - bridge.position.x, y: w.s.pos.y - bridge.position.y, z: w.s.pos.z - bridge.position.z }, bridge.up);
    expect(local).toBeGreaterThan(-0.2);
    w.body.dispose();
  });

  it('walks through the Casa do Beco from the plaza side to the alley (a shortcut through the block)', () => {
    const w = spawn(beco.at(0, 0, 4.0), beco.p.forward);
    expect(walkTo(w, beco.at(0, 0, -4.0), undefined, 6)).toBe(true);
    w.body.dispose();
  });
});

describe('Vila das Lanternas in a fight', () => {
  const shot = (from: Vec3, to: Vec3) => {
    const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
    const len = v3len(d);
    return world.physics.castRay(from, v3normalize(d), len, GROUPS_WORLD_QUERY);
  };

  it('a wall stops a shot; the window next to it lets one through', () => {
    const wall = shot(casa.at(-2, 1.5, -6), casa.at(-2, 1.5, 0));
    expect(wall).not.toBeNull();
    expect(wall!.toi).toBeCloseTo(3 - KIT.wallT / 2, 1);
    // Back window at x = +2 and the front window in line with it: a shot passes through the whole house.
    expect(shot(casa.at(2, 1.7, -6), casa.at(2, 1.7, 6))).toBeNull();
  });

  it('a low wall covers the legs, not the head; railings never stop shots', () => {
    const muro = world.layout.placements.find((p) => p.mapId === 'vila-muro-praca')!;
    expect(shot(placementToWorld(muro, 0, 0.7, -2), placementToWorld(muro, 0, 0.7, 2))).not.toBeNull();
    expect(shot(placementToWorld(muro, 0, 1.45, -2), placementToWorld(muro, 0, 1.45, 2))).toBeNull();
    const bridge = world.layout.placements.find((p) => p.mapId === 'vila-passarela')!;
    expect(shot(placementToWorld(bridge, -2, 0.5, 0), placementToWorld(bridge, 2, 0.5, 0))).toBeNull();
  });

  it('the laje parapet is cover on the roof', () => {
    expect(shot(casa.at(0, KIT.roofTop + 0.5, 6), casa.at(0, KIT.roofTop + 0.5, 0))).not.toBeNull();
    expect(shot(casa.at(0, KIT.roofTop + 1.3, 6), casa.at(0, KIT.roofTop + 1.3, 0))).toBeNull();
  });
});

describe('Vila das Lanternas loot', () => {
  it('every village chest spot is valid where it was authored (indoors, on the roof, behind walls)', () => {
    const vila = CHEST_SPOTS.filter((c) => c.region === 'Vila das Lanternas');
    expect(vila.length).toBeGreaterThanOrEqual(6);
    const spots = resolveChestSpots(world, vila);
    for (const s of spots) {
      expect(s.ok, `${s.def.id}: ${s.reason}`).toBe(true);
      expect(s.moved, s.def.id).toBeLessThan(1.7);
    }
    const roof = spots.find((s) => s.def.id === 'vila-mercadinho-laje')!;
    expect(mercado.heightOf(roof.pos)).toBeCloseTo(KIT.roofTop, 1);
    const inside = spots.find((s) => s.def.id === 'vila-casa-laje')!;
    const l = casa.local(inside.pos);
    expect(Math.abs(l.x) < 3 && Math.abs(l.z) < 3).toBe(true);
  });
});

// Keep the capsule size in view: the doors and the stair were sized for it.
it('door and stair clearances fit the character capsule', () => {
  const height = 2 * (MOVEMENT.capsuleHalfHeight + MOVEMENT.capsuleRadius);
  expect(KIT.door.h).toBeGreaterThan(height + 0.5);
  expect(KIT.door.w).toBeGreaterThan(MOVEMENT.capsuleRadius * 2 + 0.5);
  expect(KIT.stair.width).toBeGreaterThan(MOVEMENT.capsuleRadius * 2 + 0.4);
  expect(Math.atan2(KIT.stair.rise, KIT.stair.run) * (180 / Math.PI)).toBeLessThan(MOVEMENT.maxSlopeClimbDeg - 10);
});

export type { Placement };
