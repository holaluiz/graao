/**
 * Wind volumes, the bell's event winds, the radial ceiling and the Tormenta at altitude (docs/gameplay/WIND_VOLUMES.md,
 * docs/world/FLOATING_ISLANDS.md): a smooth planet of the real radius with an updraft beside a floating island, a
 * directional wind, an event updraft woken by a bell — driven through the real CharacterMotor and Rapier.
 */
import { describe, expect, it } from 'vitest';
import { INTERACTIVES, PLANET, TRAVERSAL, TraversalMode, type MapWind } from '@graao/game-data';
import { InputButton, v3cross, v3dot, v3len, v3normalize, type GameEvent, type Vec3 } from '@graao/shared';
import { CharacterMotor, cloneCharacterState, createCharacterState, newInput, type CharacterBody, type CharacterInput, type CharacterState } from './character';
import { InteractiveSystem } from './interactives';
import type { BellDef, Placement, SurfacedCollider, WorldLayout } from './layout';
import { createPhysics, initRapier } from './physics';
import { headingTangent, latLonToDir } from './sphere';
import { buildTerrainMesh, type Terrain } from './terrain';
import { tormentaInside } from './tormenta';
import { GLIDE_STEPS } from './traversal';
import { newWindSample, resolveWinds, sampleWind, windFade } from './wind';

const R = PLANET.radius;
const DT = 1 / 60;
const M = 180 / (Math.PI * R);
const DEG = Math.PI / 180;

/** A floating island: an 8 × 8 m slab 14 m up at (lat 0, lon 60), the updraft just south of its edge. */
function island(lat: number, lon: number, lift: number): Placement {
  const up = latLonToDir(lat, lon);
  const forward = headingTangent(up, 0);
  const side = v3normalize(v3cross(up, forward));
  const colliders: SurfacedCollider[] = [{ type: 'cuboid', hx: 4, hy: 0.5, hz: 4, x: 0, y: 0.5, z: 0, trav: 1 }];
  return { id: 1, kind: 'kit', variant: 0, scale: 1, position: { x: up.x * (R + lift), y: up.y * (R + lift), z: up.z * (R + lift) }, up, forward, side, colliders, radius: 6, centerHeight: 0.5, visualOnly: false, seed: 0, mapId: 'ilha' };
}

const WINDS: MapWind[] = [
  // Updraft 3 m south of the island's south edge (the island spans ±4 m around lat 0).
  { id: 'subida', kind: 'updraft', lat: -7 * M, lon: 60, base: 0, height: 19, radius: 2.6, strength: 6.5 },
  // Directional wind toward the north.
  { id: 'corrente', kind: 'directional', lat: 0, lon: 70, base: 0, height: 30, radius: 5, yaw: 0, strength: 7 },
  // Event updraft woken by the bell of placement 'sino'.
  { id: 'subida-sino', kind: 'updraft', lat: 0, lon: 80, base: 0, height: 19, radius: 3, strength: 6.5, trigger: 'sino' },
];

await initRapier();
const flat = { radius: R, heightAt: () => 0 } as unknown as Terrain;
const placements = [island(0, 60, 14)];
const winds = resolveWinds(flat, WINDS, R);
const bellAt = latLonToDir(0, 84);
const bells: BellDef[] = [{ id: 0, mapId: 'sino', up: bellAt, position: { x: bellAt.x * (R + 1.6), y: bellAt.y * (R + 1.6), z: bellAt.z * (R + 1.6) } }];
const layout: WorldLayout = { placements, structures: placements, anchors: [], doors: [], crates: [], winds, bells };
const physics = createPhysics(await initRapier(), buildTerrainMesh(flat, 40), layout);
const motor = new CharacterMotor(physics);

interface Runner {
  s: CharacterState;
  body: CharacterBody;
  inp: CharacterInput;
}

const surface = (lat: number, lon: number, h = 0): Vec3 => {
  const d = latLonToDir(lat, lon);
  return { x: d.x * (R + h), y: d.y * (R + h), z: d.z * (R + h) };
};
const height = (p: Vec3) => v3len(p) - R;
const north = (p: Vec3) => headingTangent(v3normalize(p), 0);
const vertical = (s: CharacterState) => v3dot(s.vel, v3normalize(s.pos));

function at(pos: Vec3): Runner {
  const s = createCharacterState(pos, north(pos));
  return { s, body: motor.createBody(s), inp: newInput() };
}

function run(r: Runner, seconds: number, wish: 'north' | 'none', buttons: number | ((i: number) => number), until?: (s: CharacterState) => boolean): number {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    const f = north(r.s.pos);
    r.inp.wish = wish === 'north' ? f : { x: 0, y: 0, z: 0 };
    r.inp.buttons = typeof buttons === 'number' ? buttons : buttons(i);
    motor.step(r.body, r.s, r.inp, DT);
    expect(r.s.stamina).toBeGreaterThanOrEqual(0);
    if (until?.(r.s)) return i + 1;
  }
  return n;
}
const done = (r: Runner) => r.body.dispose();

describe('wind volumes', () => {
  it('samples a column standing on the ground: full inside, fading at the edge and the top, nothing outside', () => {
    const v = winds[0]!;
    const c = v3normalize(v.base);
    const at = (h: number, off = 0) => {
      const e = headingTangent(c, 90);
      const p = { x: c.x * (R + h) + e.x * off, y: c.y * (R + h) + e.y * off, z: c.z * (R + h) + e.z * off };
      return windFade(v, p);
    };
    expect(at(5)).toBe(1);
    expect(at(-0.5)).toBe(0);
    expect(at(19.5)).toBe(0);
    expect(at(18.5)).toBeGreaterThan(0);
    expect(at(18.5)).toBeLessThan(0.5);
    expect(at(5, 2.4)).toBeGreaterThan(0);
    expect(at(5, 2.4)).toBeLessThan(0.5);
    expect(at(5, 2.7)).toBe(0);
    const out = newWindSample();
    sampleWind(winds, () => false, surface(0, 70, 4), v3normalize(surface(0, 70)), out);
    expect(out.push).toBeCloseTo(7, 5);
    expect(v3dot(out.dir, north(surface(0, 70)))).toBeCloseTo(1, 5);
    // The bell's updraft blows only while its bell rings.
    sampleWind(winds, () => false, surface(0, 80, 4), v3normalize(surface(0, 80)), out);
    expect(out.lift).toBe(0);
    sampleWind(winds, (i) => i === 2, surface(0, 80, 4), v3normalize(surface(0, 80)), out);
    expect(out.lift).toBeCloseTo(6.5, 5);
  });

  it('without the glider an updraft only slows a fall: no rise without the kite', () => {
    const r = at(surface(-7 * M, 60, 16));
    let maxVs = -Infinity;
    run(r, 2.5, 'none', 0, (s) => {
      maxVs = Math.max(maxVs, vertical(s));
      return s.grounded;
    });
    expect(maxVs).toBeLessThanOrEqual(0);
    // The fall is held at the updraft's cap instead of the free fall's.
    expect(vertical(r.s)).toBeGreaterThan(-TRAVERSAL.wind.fallCapNoGlide - 0.5);
    done(r);
  });

  it('with jump held the glider opens in the updraft, rises to its speed without spending glide time, and glides onto the island', () => {
    const r = at(surface(-7 * M, 60, 0.05));
    run(r, 0.3, 'none', 0);
    expect(r.s.grounded).toBe(true);
    // Jump and keep holding it: the wind catches the kite.
    let maxVs = 0;
    run(r, 4, 'none', InputButton.JUMP, (s) => {
      if (s.traversal === TraversalMode.GLIDE && s.airTime > 0.6) maxVs = Math.max(maxVs, vertical(s));
      return height(s.pos) > 16;
    });
    expect(r.s.traversal).toBe(TraversalMode.GLIDE);
    expect(height(r.s.pos)).toBeGreaterThan(16);
    expect(maxVs).toBeLessThanOrEqual(6.5 + 1e-6);
    expect(maxVs).toBeGreaterThan(5);
    expect(r.s.glideSteps).toBeLessThan(10);
    expect(r.s.stamina).toBeLessThan(TRAVERSAL.stamina.max);
    // Out of the column toward the island, still holding the glider: lands on it.
    run(r, 6, 'north', InputButton.JUMP, (s) => s.grounded);
    expect(r.s.grounded).toBe(true);
    expect(height(r.s.pos)).toBeGreaterThan(14.9);
    expect(r.s.traversal).toBe(TraversalMode.NONE);
    done(r);
  });

  it('a directional wind carries a falling body along, more under the glider, and never past its speed', () => {
    const drift = (glide: boolean, lon: number) => {
      const r = at(surface(0, lon, 26));
      const start = { ...r.s.pos };
      r.s.airJumped = true;
      let maxAlong = 0;
      run(r, 2.0, 'none', glide ? InputButton.JUMP : 0, (s) => {
        maxAlong = Math.max(maxAlong, v3dot(s.vel, north(s.pos)));
        return false;
      });
      const moved = v3dot({ x: r.s.pos.x - start.x, y: r.s.pos.y - start.y, z: r.s.pos.z - start.z }, north(start));
      done(r);
      return { moved, maxAlong };
    };
    const still = drift(false, 100);
    const body = drift(false, 70);
    const kite = drift(true, 70);
    expect(Math.abs(still.moved)).toBeLessThan(0.01);
    expect(body.moved).toBeGreaterThan(1);
    expect(kite.moved).toBeGreaterThan(body.moved);
    expect(kite.maxAlong).toBeLessThanOrEqual(7 + 1e-6);
    expect(body.maxAlong).toBeLessThanOrEqual(7 * TRAVERSAL.wind.noGlideShare + 1e-6);
  });

  it('the glide time still runs out of the updraft, and the stamina bounds a hover in it', () => {
    const r = at(surface(-7 * M, 60, 0.05));
    run(r, 0.3, 'none', 0);
    const n = run(r, 30, 'none', InputButton.JUMP, (s) => s.traversal === TraversalMode.NONE && !s.grounded && s.stamina < TRAVERSAL.stamina.minGlide);
    // Hovering at the top of the column until the stamina gives out (no endless flight).
    expect(n * DT).toBeLessThan(TRAVERSAL.stamina.max / TRAVERSAL.stamina.glide + 2);
    expect(r.s.glideSteps).toBeLessThan(GLIDE_STEPS);
    done(r);
  });

  it('replays a ride in the wind identically from a cloned state (prediction)', () => {
    const r = at(surface(-7 * M, 60, 0.05));
    run(r, 0.3, 'none', 0);
    run(r, 1.0, 'none', InputButton.JUMP);
    const twin = at(r.s.pos);
    twin.s = cloneCharacterState(r.s);
    motor.placeCollider(twin.body.collider, twin.s.pos);
    run(r, 1.5, 'north', InputButton.JUMP);
    run(twin, 1.5, 'north', InputButton.JUMP);
    expect(twin.s).toEqual(r.s);
    done(r);
    done(twin);
  });
});

describe('the bell and its event wind', () => {
  const events: GameEvent[] = [];
  const me = at(surface(0, 84, 0.05));
  const system = new InteractiveSystem({ physics, layout, actors: () => [], emit: (e) => events.push(e) });
  motor.windActive = system.windsOn;

  it('rings within reach only, wakes its wind for its time, refuses while ringing, then falls silent', () => {
    const far = { index: 1, state: { pos: surface(0, 90) } };
    expect(system.ring(far, 0, 0)).not.toBe(0);
    expect(system.bellNear(me.s.pos)).toBe(0);
    expect(system.ring({ index: 0, state: me.s }, 0, 1000)).toBe(0);
    expect(events).toEqual([{ e: 'bell', id: 0, on: 1, by: 0 }]);
    expect([...system.windsOn]).toEqual([2]);
    expect(system.ring({ index: 0, state: me.s }, 0, 2000)).not.toBe(0);
    expect(system.view(3000).b).toEqual([[0, INTERACTIVES.bell.ringSeconds * 1000 - 2000]]);
    // A rider in the bell's updraft rises while it rings.
    const r = at(surface(0, 80, 0.05));
    run(r, 0.3, 'none', 0);
    run(r, 2, 'none', InputButton.JUMP);
    expect(height(r.s.pos)).toBeGreaterThan(6);
    done(r);
    system.update(1000 + INTERACTIVES.bell.ringSeconds * 1000 - 1);
    expect(system.bellOn[0]).toBe(true);
    system.update(1000 + INTERACTIVES.bell.ringSeconds * 1000);
    expect(system.bellOn[0]).toBe(false);
    expect(events[events.length - 1]).toEqual({ e: 'bell', id: 0, on: 0, by: -1 });
    expect(system.windsOn.size).toBe(0);
    // Silent: the same jump only falls back.
    const q = at(surface(0, 80, 0.05));
    run(q, 0.3, 'none', 0);
    run(q, 2, 'none', InputButton.JUMP);
    expect(height(q.s.pos)).toBeLessThan(0.2);
    done(q);
  });

  it('a client mirror rebuilds the ringing bells from WORLD_STATE and the events', () => {
    const mirror = new InteractiveSystem({ physics, layout, actors: () => [], emit: () => {} });
    mirror.apply({ o: [], c: [], b: [[0, 5000]] });
    expect([...mirror.windsOn]).toEqual([2]);
    mirror.onEvent({ e: 'bell', id: 0, on: 0, by: -1 });
    expect(mirror.windsOn.size).toBe(0);
    mirror.apply({ o: [], c: [] });
    expect(mirror.bellOn).toEqual([false]);
  });
});

describe('altitude limits and the Tormenta', () => {
  it('nothing rises past the radial ceiling of the play zone', () => {
    const r = at(surface(-30, 140, TRAVERSAL.ceiling - 1));
    r.s.vel = { ...v3normalize(r.s.pos) };
    const up = v3normalize(r.s.pos);
    r.s.vel = { x: up.x * 14, y: up.y * 14, z: up.z * 14 };
    r.s.airJumped = true;
    let maxH = 0;
    run(r, 1.5, 'none', 0, (s) => {
      maxH = Math.max(maxH, height(s.pos));
      return false;
    });
    expect(maxH).toBeLessThan(TRAVERSAL.ceiling + 0.3);
    done(r);
  });

  it('decides the safe region by direction alone: an island, a glider or the ceiling give no immunity', () => {
    const circle = { center: latLonToDir(0, 0), radius: 20 * DEG };
    // On the ground inside, high over the same spot inside, an island outside, the far side of the planet outside.
    expect(tormentaInside(circle, surface(10, 0))).toBe(true);
    expect(tormentaInside(circle, surface(10, 0, TRAVERSAL.ceiling))).toBe(true);
    expect(tormentaInside(circle, surface(0, 60, 14))).toBe(false);
    expect(tormentaInside(circle, surface(0, 180, 30))).toBe(false);
    expect(tormentaInside(circle, surface(0, 25, TRAVERSAL.ceiling))).toBe(false);
  });
});
