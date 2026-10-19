/**
 * Vertical traversal on a test course (docs/gameplay/TRAVERSAL_STATES.md): a smooth planet of the real radius and
 * gravity with tagged blocks — a crate, walls of several heights, a thin wall, an overhang, climbable and plain rock
 * faces, a long ledge, a floating island — driven through the real CharacterMotor and Rapier, like the server does.
 */
import { describe, expect, it } from 'vitest';
import { MOVEMENT, PLANET, SurfaceFlag, TRAVERSAL, TraversalMode } from '@graao/game-data';
import { InputButton, MovementState, POS_SCALE, STAMINA_SCALE, VEL_SCALE, v3cross, v3dot, v3len, v3normalize, type Vec3 } from '@graao/shared';
import { applyKnockback } from './abilities';
import { CharacterMotor, cloneCharacterState, createCharacterState, newInput, type CharacterBody, type CharacterInput, type CharacterState } from './character';
import type { Placement, SurfacedCollider, WorldLayout } from './layout';
import { createPhysics, initRapier } from './physics';
import { headingTangent, latLonToDir } from './sphere';
import { buildTerrainMesh, type Terrain } from './terrain';
import { GLIDE_STEPS, TraversalCap, packTraversal, steps, traversalOfMoveState, unpackTraversal } from './traversal';

const R = PLANET.radius;
const DT = 1 / 60;
const M = 180 / (Math.PI * R); // degrees of arc per metre on the ground

// ------------------------------------------------------------------------------------------------ the course

let nextId = 1;
type Box = { hx: number; hy: number; hz: number; x?: number; y?: number; z?: number; trav?: number };

/** A placement on the ground at (lat, lon) facing north, made of boxes (y = height of the box's base). */
function piece(lat: number, lon: number, boxes: Box[], lift = 0): Placement {
  const up = latLonToDir(lat, lon);
  const forward = headingTangent(up, 0);
  const side = v3normalize(v3cross(up, forward));
  const colliders: SurfacedCollider[] = boxes.map((b) => ({ type: 'cuboid', hx: b.hx, hy: b.hy, hz: b.hz, x: b.x ?? 0, y: (b.y ?? 0) + b.hy, z: b.z ?? 0, ...(b.trav ? { trav: b.trav } : {}) }));
  return {
    id: nextId++, kind: 'kit', variant: 0, scale: 1, position: { x: up.x * (R + lift), y: up.y * (R + lift), z: up.z * (R + lift) },
    up, forward, side, colliders, radius: 10, centerHeight: 2, visualOnly: false, seed: 0,
  };
}

const LEDGE = SurfaceFlag.LEDGE;
const CLIMB = SurfaceFlag.LEDGE | SurfaceFlag.CLIMB;
/** Test lanes: each obstacle sits on its own meridian at lat 0, the runner starts south of it. */
const LANE = {
  crate: 0, wall18: 4, wall32: 8, climb: 12, plain: 16, thin: 20, overhang: 24, long: 28, tall: 32, island: 40, untagged: 44, high: 48,
} as const;
const placements: Placement[] = [
  piece(0, LANE.crate, [{ hx: 0.8, hy: 0.5, hz: 0.6, trav: LEDGE }]),
  piece(0, LANE.wall18, [{ hx: 2, hy: 0.9, hz: 1, trav: LEDGE }]),
  piece(0, LANE.wall32, [{ hx: 2, hy: 1.6, hz: 1.5, trav: LEDGE }]),
  piece(0, LANE.climb, [{ hx: 2.5, hy: 3, hz: 1.5, trav: CLIMB }]),
  piece(0, LANE.plain, [{ hx: 2.5, hy: 3, hz: 1.5 }]),
  piece(0, LANE.thin, [{ hx: 2, hy: 1.3, hz: 0.1, trav: LEDGE }]),
  // A 2 m wall under a slab that juts 1.2 m out over the approach at 3.0 m: no room to pull up.
  piece(0, LANE.overhang, [{ hx: 2, hy: 1.0, hz: 1, trav: LEDGE }, { hx: 2, hy: 0.15, hz: 1.6, y: 3.0, z: -0.6, trav: LEDGE }]),
  piece(0, LANE.long, [{ hx: 2.0, hy: 1.6, hz: 1, trav: LEDGE }]),
  piece(0, LANE.tall, [{ hx: 2.5, hy: 10, hz: 1.5, trav: CLIMB }]),
  piece(0, LANE.island, [{ hx: 4, hy: 0.5, hz: 4, trav: LEDGE }], 15),
  piece(0, LANE.untagged, [{ hx: 2, hy: 0.9, hz: 1 }]),
  piece(0, LANE.high, [{ hx: 2, hy: 1.6, hz: 1.5, trav: LEDGE }]),
];

await initRapier();
const flat = { radius: R, heightAt: () => 0 } as unknown as Terrain;
const layout: WorldLayout = { placements, structures: placements, anchors: [], doors: [], crates: [] };
const physics = createPhysics(await initRapier(), buildTerrainMesh(flat, 40), layout);
const motor = new CharacterMotor(physics);

// ------------------------------------------------------------------------------------------------ helpers

interface Runner {
  s: CharacterState;
  body: CharacterBody;
  inp: CharacterInput;
  /** Traversal modes seen, in order (consecutive repeats folded). */
  seen: TraversalMode[];
}

const surface = (lat: number, lon: number, h = 0): Vec3 => {
  const d = latLonToDir(lat, lon);
  return { x: d.x * (R + h), y: d.y * (R + h), z: d.z * (R + h) };
};
/** Height over the smooth ground (m). */
const height = (p: Vec3) => v3len(p) - R;
const north = (p: Vec3) => headingTangent(v3normalize(p), 0);
const east = (p: Vec3) => headingTangent(v3normalize(p), 90);

/** A runner standing `gap` m south of the near face of the obstacle in `lane` whose half depth is `hz`. */
function before(lane: number, hz: number, gap: number, h = 0): Runner {
  const pos = surface(-(hz + gap + MOVEMENT.capsuleRadius) * M, lane, h + 0.05);
  const s = createCharacterState(pos, north(pos));
  const r: Runner = { s, body: motor.createBody(s), inp: newInput(), seen: [] };
  run(r, 0.3, 'none');
  return r;
}

function at(pos: Vec3, facing?: Vec3): Runner {
  const s = createCharacterState(pos, facing ?? north(pos));
  return { s, body: motor.createBody(s), inp: newInput(), seen: [] };
}

type Wish = 'north' | 'south' | 'east' | 'west' | 'none';
const wishOf = (w: Wish, p: Vec3): Vec3 => {
  if (w === 'none') return { x: 0, y: 0, z: 0 };
  const d = w === 'north' || w === 'south' ? north(p) : east(p);
  const k = w === 'south' || w === 'west' ? -1 : 1;
  return { x: d.x * k, y: d.y * k, z: d.z * k };
};

/** Steps for `seconds` with a wish and buttons (a number, or per step); stops early when `until` holds. Returns steps. */
function run(r: Runner, seconds: number, wish: Wish, buttons: number | ((i: number) => number) = 0, until?: (s: CharacterState) => boolean): number {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    r.inp.wish = wishOf(wish, r.s.pos);
    r.inp.buttons = typeof buttons === 'number' ? buttons : buttons(i);
    motor.step(r.body, r.s, r.inp, DT);
    if (r.seen[r.seen.length - 1] !== r.s.traversal) r.seen.push(r.s.traversal);
    expect(r.s.stamina).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(r.s.pos.x + r.s.pos.y + r.s.pos.z)).toBe(true);
    if (until?.(r.s)) return i + 1;
  }
  return n;
}

/** Jump pressed for the first few steps of a run, then released. */
const tap = (i: number) => (i < 3 ? InputButton.JUMP : 0);
const done = (r: Runner) => r.body.dispose();

// ------------------------------------------------------------------------------------------------ tests

describe('spherical frame', () => {
  it('falls along the local up everywhere on the sphere and lands where it started', () => {
    for (const [lat, lon] of [[0, -60], [89.9, 0], [-89.9, 30], [0, 90], [45, 135], [-30, -120]] as const) {
      const r = at(surface(lat, lon, 6));
      const dir0 = v3normalize(r.s.pos);
      let minVs = 0;
      run(r, 2, 'none', 0, (s) => {
        minVs = Math.min(minVs, v3dot(s.vel, v3normalize(s.pos)));
        return false;
      });
      expect(r.s.grounded, `${lat},${lon}`).toBe(true);
      expect(minVs).toBeLessThan(-5);
      expect(Math.acos(Math.min(1, v3dot(dir0, v3normalize(r.s.pos)))) * R, `deriva ${lat},${lon}`).toBeLessThan(0.01);
      expect(height(r.s.pos)).toBeLessThan(0.1);
      done(r);
    }
  });

  it('stands, walks and falls off a floating island (support is the real collider, not the radial altitude)', () => {
    const r = at(surface(0, LANE.island, 20));
    run(r, 2, 'none');
    expect(r.s.grounded).toBe(true);
    expect(height(r.s.pos)).toBeGreaterThan(15.9);
    expect(height(r.s.pos)).toBeLessThan(16.1);
    run(r, 0.5, 'north');
    expect(r.s.grounded).toBe(true);
    expect(height(r.s.pos)).toBeGreaterThan(15.9);
    run(r, 2.5, 'north', 0, (s) => !s.grounded);
    expect(r.s.grounded).toBe(false);
    run(r, 4, 'none', 0, (s) => s.grounded);
    expect(height(r.s.pos)).toBeLessThan(0.1);
    done(r);
  });
});

describe('locomotion states', () => {
  it('grounded → jumping → falling → grounded', () => {
    const r = at(surface(-20, 0, 0.05));
    run(r, 0.3, 'none');
    const states: number[] = [];
    run(r, 1.2, 'none', tap, (s) => {
      if (states[states.length - 1] !== s.moveState) states.push(s.moveState);
      return false;
    });
    expect(states).toEqual([MovementState.JUMP, MovementState.FALL, MovementState.IDLE]);
    done(r);
  });
});

describe('ledges and mantle', () => {
  it('vaults straight onto a 1 m crate (no hang)', () => {
    const r = before(LANE.crate, 0.6, 0.4);
    run(r, 1.5, 'north', tap, (s) => s.traversal === TraversalMode.NONE && s.grounded && height(s.pos) > 0.9);
    expect(r.seen).toContain(TraversalMode.MANTLE);
    expect(r.seen).not.toContain(TraversalMode.HANG);
    expect(r.s.grounded).toBe(true);
    expect(height(r.s.pos)).toBeCloseTo(1.0, 1);
    done(r);
  });

  it('jumps into a 3.2 m wall, hangs, and pulls up when pushing toward it', () => {
    const r = before(LANE.wall32, 1.5, 0.3);
    run(r, 1.2, 'north', tap, (s) => s.traversal === TraversalMode.HANG);
    expect(r.s.traversal).toBe(TraversalMode.HANG);
    expect(r.s.moveState).toBe(MovementState.LEDGE_HANG);
    run(r, 0.4, 'none');
    // Hanging: hands on the edge, feet `depth` under the top, facing the wall.
    expect(height(r.s.pos)).toBeCloseTo(3.2 - TRAVERSAL.hang.depth, 1);
    expect(v3dot(r.s.facing, north(r.s.pos))).toBeGreaterThan(0.99);
    run(r, 2, 'north', 0, (s) => s.traversal === TraversalMode.NONE);
    expect(r.seen).toEqual([TraversalMode.NONE, TraversalMode.HANG, TraversalMode.MANTLE, TraversalMode.NONE]);
    expect(r.s.grounded).toBe(true);
    expect(height(r.s.pos)).toBeCloseTo(3.2, 1);
    run(r, 0.5, 'north');
    expect(height(r.s.pos)).toBeCloseTo(3.2, 1);
    done(r);
  });

  it('a 1.8 m wall is hung from on the way up and mantled with forward held', () => {
    const r = before(LANE.wall18, 1, 0.3);
    run(r, 2, 'north', tap, (s) => s.traversal === TraversalMode.NONE && s.grounded && height(s.pos) > 1.7);
    expect(r.seen).toContain(TraversalMode.MANTLE);
    expect(height(r.s.pos)).toBeCloseTo(1.8, 1);
    done(r);
  });

  it('hangs without drifting, spends stamina, lets go with back held, and cannot regrab at once', () => {
    const r = before(LANE.high, 1.5, 0.3);
    run(r, 1.2, 'north', tap, (s) => s.traversal === TraversalMode.HANG);
    run(r, 0.2, 'none');
    const p0 = { ...r.s.pos };
    const st0 = r.s.stamina;
    run(r, 1, 'none');
    expect(r.s.traversal).toBe(TraversalMode.HANG);
    expect(Math.hypot(r.s.pos.x - p0.x, r.s.pos.y - p0.y, r.s.pos.z - p0.z)).toBeLessThan(0.01);
    expect(st0 - r.s.stamina).toBeCloseTo(TRAVERSAL.stamina.hang, 0);
    run(r, 0.1, 'south');
    expect(r.s.traversal).toBe(TraversalMode.NONE);
    expect(r.s.grabCooldown).toBeGreaterThan(0);
    // Pushing back into the wall right away does not grab it again; the body just falls.
    run(r, 0.25, 'north');
    expect(r.s.traversal).toBe(TraversalMode.NONE);
    run(r, 2, 'north', 0, (s) => s.grounded);
    expect(r.s.grounded).toBe(true);
    done(r);
  });

  it('sprint lets go, a jump with back held jumps off the wall', () => {
    const a = before(LANE.high, 1.5, 0.3);
    run(a, 1.2, 'north', tap, (s) => s.traversal === TraversalMode.HANG);
    run(a, 0.2, 'none');
    run(a, 0.05, 'none', InputButton.SPRINT);
    expect(a.s.traversal).toBe(TraversalMode.NONE);
    done(a);
    const b = before(LANE.high, 1.5, 0.3);
    run(b, 1.2, 'north', tap, (s) => s.traversal === TraversalMode.HANG);
    run(b, 0.2, 'none');
    const y0 = height(b.s.pos);
    run(b, 0.05, 'south', InputButton.JUMP);
    expect(b.s.traversal).toBe(TraversalMode.NONE);
    expect(v3dot(b.s.vel, north(b.s.pos))).toBeLessThan(-3);
    run(b, 0.25, 'south');
    expect(height(b.s.pos)).toBeGreaterThan(y0);
    done(b);
  });

  it('shimmies along the ledge and stops where it ends', () => {
    const r = before(LANE.long, 1, 0.3);
    run(r, 1.2, 'north', tap, (s) => s.traversal === TraversalMode.HANG);
    run(r, 0.2, 'none');
    const p0 = { ...r.s.pos };
    run(r, 0.5, 'east');
    expect(r.s.traversal).toBe(TraversalMode.HANG);
    const moved = v3dot({ x: r.s.pos.x - p0.x, y: r.s.pos.y - p0.y, z: r.s.pos.z - p0.z }, east(r.s.pos));
    expect(moved).toBeGreaterThan(0.5);
    run(r, 4, 'east');
    expect(r.s.traversal).toBe(TraversalMode.HANG);
    // The wall is 4 m wide: the hands stop at its end, never past it.
    const across = v3dot({ x: r.s.pos.x - p0.x, y: r.s.pos.y - p0.y, z: r.s.pos.z - p0.z }, east(r.s.pos));
    expect(across).toBeLessThan(2.0);
    done(r);
  });

  it('a thin wall can be hung from but not stood on (no room past the edge)', () => {
    const r = before(LANE.thin, 0.1, 0.3);
    run(r, 1.2, 'north', tap, (s) => s.traversal === TraversalMode.HANG);
    expect(r.s.traversal).toBe(TraversalMode.HANG);
    run(r, 1.5, 'north');
    expect(r.s.traversal).toBe(TraversalMode.HANG);
    expect(r.seen).not.toContain(TraversalMode.MANTLE);
    done(r);
  });

  it('an overhang over the ledge blocks the pull-up (destination checked before moving)', () => {
    const r = before(LANE.overhang, 1, 0.3);
    run(r, 3, 'north', tap);
    expect(r.seen).not.toContain(TraversalMode.MANTLE);
    expect(height(r.s.pos)).toBeLessThan(1.0);
    done(r);
  });

  it('untagged blocks are never grabbed', () => {
    const r = before(LANE.untagged, 1, 0.3);
    run(r, 2, 'north', tap);
    expect(r.seen).toEqual([TraversalMode.NONE]);
    done(r);
  });

  it('no grab without stamina, and none for a character without the capability (bots)', () => {
    const r = before(LANE.wall32, 1.5, 0.3);
    r.s.stamina = TRAVERSAL.stamina.minGrab - 1;
    run(r, 1.2, 'north', tap);
    expect(r.seen).toEqual([TraversalMode.NONE]);
    done(r);
    const b = before(LANE.wall32, 1.5, 0.3);
    b.s.traversalCaps = 0;
    run(b, 1.2, 'north', tap);
    expect(b.seen).toEqual([TraversalMode.NONE]);
    done(b);
  });

  it('dropping and jumping at the same ledge never gains height (no regrab farming)', () => {
    const r = before(LANE.high, 1.5, 0.3);
    let best = 0;
    for (let k = 0; k < 6; k++) {
      run(r, 1.2, 'north', (i) => (i < 3 || (i > 20 && i < 23) ? InputButton.JUMP : 0), (s) => s.traversal === TraversalMode.HANG);
      run(r, 0.15, 'none', 0, (s) => {
        best = Math.max(best, height(s.pos));
        return false;
      });
      run(r, 0.1, 'south');
      run(r, 2, 'none', 0, (s) => s.grounded);
    }
    expect(best).toBeLessThan(3.2 - TRAVERSAL.hang.depth + 0.15);
    done(r);
  });
});

describe('climbing', () => {
  it('climbs a tagged 6 m rock face and pulls up over its top', () => {
    const r = before(LANE.climb, 1.5, 0.3);
    run(r, 0.6, 'north', tap, (s) => s.traversal === TraversalMode.CLIMB);
    expect(r.s.traversal).toBe(TraversalMode.CLIMB);
    expect(r.s.moveState).toBe(MovementState.CLIMB);
    run(r, 8, 'north', 0, (s) => s.traversal === TraversalMode.NONE && s.grounded);
    expect(r.seen).toEqual([TraversalMode.NONE, TraversalMode.CLIMB, TraversalMode.MANTLE, TraversalMode.NONE]);
    expect(height(r.s.pos)).toBeCloseTo(6, 1);
    expect(r.s.stamina).toBeLessThan(TRAVERSAL.stamina.max * 0.6);
    done(r);
  });

  it('moves sideways and down on the wall, and steps off at its foot', () => {
    const r = before(LANE.climb, 1.5, 0.3);
    run(r, 0.6, 'north', tap, (s) => s.traversal === TraversalMode.CLIMB);
    run(r, 1, 'north');
    const h1 = height(r.s.pos);
    expect(h1).toBeGreaterThan(1.5);
    const p0 = { ...r.s.pos };
    run(r, 0.5, 'west');
    expect(v3dot({ x: r.s.pos.x - p0.x, y: r.s.pos.y - p0.y, z: r.s.pos.z - p0.z }, east(r.s.pos))).toBeLessThan(-0.6);
    expect(r.s.traversal).toBe(TraversalMode.CLIMB);
    run(r, 3, 'south', 0, (s) => s.traversal === TraversalMode.NONE);
    expect(r.s.traversal).toBe(TraversalMode.NONE);
    expect(r.s.grounded).toBe(true);
    expect(height(r.s.pos)).toBeLessThan(0.1);
    done(r);
  });

  it('a plain (untagged) rock face is not climbable', () => {
    const r = before(LANE.plain, 1.5, 0.3);
    run(r, 2, 'north', tap);
    expect(r.seen).toEqual([TraversalMode.NONE]);
    done(r);
  });

  it('runs out of stamina on a 20 m face, falls, and cannot grab again until rested', () => {
    const r = before(LANE.tall, 1.5, 0.3);
    run(r, 0.6, 'north', tap, (s) => s.traversal === TraversalMode.CLIMB);
    const n = run(r, 12, 'north', 0, (s) => s.traversal !== TraversalMode.CLIMB);
    // 100 stamina at 18/s up: ≈ 5.5 s of climbing, never infinite.
    expect(n * DT).toBeGreaterThan(4.5);
    expect(n * DT).toBeLessThan(6.5);
    expect(r.s.stamina).toBe(0);
    expect(r.s.traversal).toBe(TraversalMode.NONE);
    const peak = height(r.s.pos);
    expect(peak).toBeGreaterThan(7);
    expect(peak).toBeLessThan(12);
    run(r, 4, 'north', 0, (s) => s.grounded);
    expect(r.seen.filter((m) => m === TraversalMode.CLIMB)).toHaveLength(1);
    expect(r.s.grounded).toBe(true);
    // The ground refills it.
    run(r, 1, 'none');
    expect(r.s.stamina).toBeGreaterThan(TRAVERSAL.stamina.regenRest * 0.9);
    done(r);
  });

  it('a jump off the wall pushes away and up', () => {
    const r = before(LANE.climb, 1.5, 0.3);
    run(r, 0.6, 'north', tap, (s) => s.traversal === TraversalMode.CLIMB);
    run(r, 0.5, 'north');
    run(r, 0.05, 'none', InputButton.JUMP);
    expect(r.s.traversal).toBe(TraversalMode.NONE);
    expect(v3dot(r.s.vel, north(r.s.pos))).toBeLessThan(-3);
    expect(v3dot(r.s.vel, v3normalize(r.s.pos))).toBeGreaterThan(3);
    done(r);
  });
});

describe('universal glide', () => {
  it('opens with jump held on the way down, falls slowly, closes after its time and not again in the flight', () => {
    // Jump pressed in the air spends the double jump first (a hop), then the held jump opens the glider.
    const hop = at(surface(-30, 4, 36));
    run(hop, 0.5, 'north');
    run(hop, 0.05, 'north', InputButton.JUMP);
    expect(hop.s.airJumped).toBe(true);
    expect(v3dot(hop.s.vel, v3normalize(hop.s.pos))).toBeGreaterThan(5);
    done(hop);
    const r = at(surface(-30, 0, 36));
    run(r, 0.5, 'north');
    r.s.airJumped = true;
    expect(r.s.traversal).toBe(TraversalMode.NONE);
    const n = run(r, 1, 'north', InputButton.JUMP, (s) => s.traversal === TraversalMode.GLIDE);
    expect(r.s.traversal).toBe(TraversalMode.GLIDE);
    expect(r.s.moveState).toBe(MovementState.GLIDE);
    expect(n).toBeLessThan(5);
    let maxH = 0;
    let rising = -Infinity;
    run(r, 1.5, 'north', InputButton.JUMP, (s) => {
      maxH = Math.max(maxH, v3dot(s.vel, north(s.pos)));
      rising = Math.max(rising, v3dot(s.vel, v3normalize(s.pos)));
      return false;
    });
    // Braked to the glide's fall speed (never upward: no climb without an updraft), horizontal speed capped.
    expect(rising).toBeLessThan(0);
    expect(v3dot(r.s.vel, v3normalize(r.s.pos))).toBeCloseTo(-TRAVERSAL.glide.fallSpeed, 1);
    expect(maxH).toBeLessThanOrEqual(TRAVERSAL.glide.speed + 1e-6);
    const k = run(r, 3, 'north', InputButton.JUMP, (s) => s.traversal !== TraversalMode.GLIDE);
    expect(r.s.glideSteps).toBe(GLIDE_STEPS);
    expect(k).toBeLessThan(GLIDE_STEPS);
    run(r, 0.05, 'north', 0);
    run(r, 0.5, 'north', InputButton.JUMP);
    expect(r.seen.filter((m) => m === TraversalMode.GLIDE)).toHaveLength(1);
    done(r);
  });

  it('letting go closes it; landing closes it and refills the glide time', () => {
    const r = at(surface(-34, 0, 40));
    run(r, 0.5, 'none');
    run(r, 0.5, 'none', InputButton.JUMP, (s) => s.traversal === TraversalMode.GLIDE);
    run(r, 0.3, 'none', InputButton.JUMP);
    run(r, 0.05, 'none', 0);
    expect(r.s.traversal).toBe(TraversalMode.NONE);
    const used = r.s.glideSteps;
    expect(used).toBeGreaterThan(10);
    run(r, 0.6, 'none', InputButton.JUMP, (s) => s.traversal === TraversalMode.GLIDE);
    expect(r.s.traversal).toBe(TraversalMode.GLIDE);
    run(r, 20, 'none', InputButton.JUMP, (s) => s.grounded);
    expect(r.s.grounded).toBe(true);
    expect(r.s.traversal).toBe(TraversalMode.NONE);
    expect(r.s.glideSteps).toBe(0);
    done(r);
  });

  it('does not open from a plain jump on flat ground (too close to it) nor too early in the air', () => {
    const r = at(surface(-38, 0, 0.05));
    run(r, 0.3, 'none');
    run(r, 1.5, 'north', InputButton.JUMP);
    expect(r.seen).toEqual([TraversalMode.NONE]);
    done(r);
    const q = at(surface(-38, 2, 36));
    const n = run(q, 1, 'none', InputButton.JUMP, (s) => s.traversal === TraversalMode.GLIDE);
    expect(n * DT).toBeGreaterThanOrEqual(TRAVERSAL.glide.minAirTime - 1e-9);
    done(q);
  });

  it('a dash, a snare, a knockback and a character without the capability all leave no glide', () => {
    const r = at(surface(-42, 0, 36));
    run(r, 1, 'north', InputButton.JUMP, (s) => s.traversal === TraversalMode.GLIDE);
    r.s.rooted = true;
    run(r, 0.05, 'north', InputButton.JUMP);
    expect(r.s.traversal).toBe(TraversalMode.NONE);
    r.s.rooted = false;
    run(r, 0.05, 'north', 0);
    // The press hops first (the double jump), then the held jump opens the glider again on the way down.
    run(r, 1.2, 'north', InputButton.JUMP, (s) => s.traversal === TraversalMode.GLIDE);
    expect(r.s.traversal).toBe(TraversalMode.GLIDE);
    applyKnockback(r.s, null, 8, 2, north(r.s.pos));
    expect(r.s.traversal).toBe(TraversalMode.NONE);
    done(r);
    const b = at(surface(-42, 3, 36));
    b.s.traversalCaps = TraversalCap.LEDGE;
    run(b, 1.5, 'north', InputButton.JUMP);
    expect(b.seen).toEqual([TraversalMode.NONE]);
    done(b);
  });

  it('glides onto a ledge and grabs it', () => {
    // From 5 m up, 4 m south of the 3.2 m wall's face, gliding north into it (no coyote hop, double jump spent).
    const r = at(surface(-(1.5 + 4) * M, LANE.wall32, 5));
    r.s.airJumped = true;
    r.s.airTime = 1;
    run(r, 2.5, 'north', InputButton.JUMP, (s) => s.traversal === TraversalMode.HANG || s.traversal === TraversalMode.MANTLE);
    expect(r.seen).toContain(TraversalMode.GLIDE);
    expect([TraversalMode.HANG, TraversalMode.MANTLE]).toContain(r.s.traversal);
    done(r);
  });
});

describe('knockback and abilities', () => {
  it('a knockback pulls a hanging character off the ledge and blocks an instant regrab', () => {
    const r = before(LANE.high, 1.5, 0.3);
    run(r, 1.2, 'north', tap, (s) => s.traversal === TraversalMode.HANG);
    applyKnockback(r.s, null, 10, 3, { x: -r.s.facing.x, y: -r.s.facing.y, z: -r.s.facing.z });
    expect(r.s.traversal).toBe(TraversalMode.NONE);
    expect(r.s.grabCooldown).toBeGreaterThan(0);
    run(r, 0.1, 'north');
    expect(r.s.traversal).toBe(TraversalMode.NONE);
    done(r);
  });

  it('an ability movement (Linha de Varal) takes over a climb', () => {
    const r = before(LANE.climb, 1.5, 0.3);
    run(r, 0.6, 'north', tap, (s) => s.traversal === TraversalMode.CLIMB);
    run(r, 0.3, 'north');
    r.s.abilityMovement = { mode: 'grapple', remaining: 1, speed: 10, gravityFactor: 0, airControl: 1, lift: 0, anchor: surface(-3, LANE.climb, 3) };
    run(r, 0.05, 'none');
    expect(r.s.traversal).toBe(TraversalMode.NONE);
    done(r);
  });
});

describe('prediction contract', () => {
  /** Replays the same inputs from a clone on a second body: both must end bit-identical. */
  function replayEqual(r: Runner, seconds: number, wish: Wish, buttons: number) {
    const twin = at(r.s.pos);
    twin.s = cloneCharacterState(r.s);
    motor.placeCollider(twin.body.collider, twin.s.pos);
    run(r, seconds, wish, buttons);
    run(twin, seconds, wish, buttons);
    expect(twin.s).toEqual(r.s);
    done(twin);
  }

  it('replays hang, mantle, climb and glide identically from a cloned state', () => {
    const h = before(LANE.wall32, 1.5, 0.3);
    run(h, 1.2, 'north', tap, (s) => s.traversal === TraversalMode.HANG);
    replayEqual(h, 0.3, 'east', 0);
    replayEqual(h, 1.0, 'north', 0);
    done(h);
    const c = before(LANE.climb, 1.5, 0.3);
    run(c, 0.6, 'north', tap, (s) => s.traversal === TraversalMode.CLIMB);
    replayEqual(c, 1.0, 'north', 0);
    done(c);
    const g = at(surface(-46, 0, 36));
    run(g, 1, 'north', InputButton.JUMP, (s) => s.traversal === TraversalMode.GLIDE);
    replayEqual(g, 1.0, 'east', InputButton.JUMP);
    done(g);
  });

  it('rebuilds a traversal from a quantized snapshot and converges on the server state', () => {
    for (const lane of [LANE.wall32, LANE.climb] as const) {
      const server = before(lane, 1.5, 0.3);
      run(server, 1.2, 'north', tap, (s) => s.traversal !== TraversalMode.NONE);
      run(server, 0.2, 'north');
      const mode = server.s.traversal;
      expect(mode).not.toBe(TraversalMode.NONE);
      // What the snapshot carries, as NetSession decodes it.
      const q = (v: number, k: number) => Math.round(v * k) / k;
      const client = at({ x: q(server.s.pos.x, POS_SCALE), y: q(server.s.pos.y, POS_SCALE), z: q(server.s.pos.z, POS_SCALE) });
      client.s.vel = { x: q(server.s.vel.x, VEL_SCALE), y: q(server.s.vel.y, VEL_SCALE), z: q(server.s.vel.z, VEL_SCALE) };
      client.s.facing = v3normalize({ x: Math.round(server.s.facing.x * 127), y: Math.round(server.s.facing.y * 127), z: Math.round(server.s.facing.z * 127) });
      client.s.traversal = traversalOfMoveState(server.s.moveState);
      client.s.stamina = Math.round(server.s.stamina * STAMINA_SCALE) / STAMINA_SCALE;
      unpackTraversal(packTraversal(server.s), client.s);
      client.s.ledgeR = Math.round(server.s.ledgeR * POS_SCALE) / POS_SCALE;
      client.s.jumpHeld = server.s.jumpHeld;
      client.s.sprintHeld = server.s.sprintHeld;
      client.s.grounded = server.s.grounded;
      client.s.airJumped = server.s.airJumped;
      motor.placeCollider(client.body.collider, client.s.pos);
      expect(client.s.traversal).toBe(mode);
      run(server, 0.5, 'north');
      run(client, 0.5, 'north');
      expect(client.s.traversal).toBe(server.s.traversal);
      expect(Math.hypot(client.s.pos.x - server.s.pos.x, client.s.pos.y - server.s.pos.y, client.s.pos.z - server.s.pos.z)).toBeLessThan(0.02);
      expect(Math.abs(client.s.stamina - server.s.stamina)).toBeLessThan(0.05);
      done(server);
      done(client);
    }
  });

  it('packs the traversal timers losslessly', () => {
    const s = { travSteps: 4095, glideSteps: GLIDE_STEPS, grabCooldown: steps(TRAVERSAL.cooldown.afterExhaust) };
    const out = { travSteps: 0, glideSteps: 0, grabCooldown: 0 };
    unpackTraversal(packTraversal(s), out);
    expect(out).toEqual(s);
    expect(packTraversal(s)).toBeLessThan(2 ** 31);
  });
});
