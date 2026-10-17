import { describe, expect, it } from 'vitest';
import { MATCH_SPAWNS, MOVEMENT, PLANET, SPAWNS } from '@graao/game-data';
import { InputButton, MovementState, v3, v3angle, v3dot, v3len, v3normalize } from '@graao/shared';
import { ABILITIES } from '@graao/game-data';
import { AbilityReject } from '@graao/shared';
import { resolveTargetPoint, validateTargetPoint } from './abilities';
import { CharacterMotor, cloneCharacterState, createCharacterState, newInput, startDash } from './character';
import { GROUPS_PROP_QUERY, quatFromUp } from './physics';
import { latLonToDir, northTangent, transportTangent } from './sphere';
import { createGameWorld } from './world';

const world = await createGameWorld({ includeVisual: false });

describe('terrain and layout', () => {
  it('is deterministic', async () => {
    const other = await createGameWorld({ includeVisual: false });
    expect(other.mesh.positions.length).toBe(world.mesh.positions.length);
    expect(other.mesh.positions[1234]).toBe(world.mesh.positions[1234]);
    expect(other.layout.placements.length).toBe(world.layout.placements.length);
    const a = other.layout.placements[40]!.position;
    const b = world.layout.placements[40]!.position;
    expect([a.x, a.y, a.z]).toEqual([b.x, b.y, b.z]);
    other.physics.dispose();
  });

  it('has land around the spawns and stays within sane heights', () => {
    for (const s of SPAWNS) {
      const h = world.terrain.heightAt(latLonToDir(s.lat, s.lon));
      expect(h).toBeGreaterThan(PLANET.seaLevel);
      expect(h).toBeLessThan(15);
    }
    let min = Infinity;
    let max = -Infinity;
    for (const h of world.mesh.heights) {
      min = Math.min(min, h);
      max = Math.max(max, h);
    }
    expect(min).toBeGreaterThan(-10);
    expect(max).toBeLessThan(20);
  });

  it('keeps every spawn (free roam and match) on dry land and clear of solid props', () => {
    for (const s of [...SPAWNS, ...MATCH_SPAWNS]) {
      const dir = latLonToDir(s.lat, s.lon);
      expect(world.terrain.heightAt(dir)).toBeGreaterThan(PLANET.seaLevel + 0.2);
      // A slightly fattened player capsule standing on the spawn must not touch any prop collider.
      const feet = world.terrain.surfaceAt(dir);
      const { R } = world.physics;
      const r = MOVEMENT.capsuleRadius + 0.15;
      const center = { x: feet.x + dir.x * (MOVEMENT.capsuleHalfHeight + r + 0.05), y: feet.y + dir.y * (MOVEMENT.capsuleHalfHeight + r + 0.05), z: feet.z + dir.z * (MOVEMENT.capsuleHalfHeight + r + 0.05) };
      const hit = world.physics.world.intersectionWithShape(center, quatFromUp(dir), new R.Capsule(MOVEMENT.capsuleHalfHeight, r), undefined, GROUPS_PROP_QUERY);
      expect(hit, `a prop overlaps spawn ${s.lat},${s.lon}`).toBeNull();
    }
  });

  it('places solid props with colliders', () => {
    const solid = world.layout.placements.filter((p) => !p.visualOnly);
    expect(solid.length).toBeGreaterThan(150);
    expect(world.physics.propByCollider.size).toBeGreaterThan(150);
  });
});

describe('spherical character controller', () => {
  const motor = new CharacterMotor(world.physics);
  const spawnDir = latLonToDir(SPAWNS[0]!.lat, SPAWNS[0]!.lon);
  const ground = world.terrain.surfaceAt(spawnDir);
  const start = { x: ground.x + spawnDir.x * 1.5, y: ground.y + spawnDir.y * 1.5, z: ground.z + spawnDir.z * 1.5 };

  it('falls radially and lands on the terrain', () => {
    const s = createCharacterState(start, northTangent(spawnDir));
    const body = motor.createBody(s);
    const inp = newInput();
    for (let i = 0; i < 120; i++) motor.step(body, s, inp, 1 / 60);
    body.dispose();
    expect(s.grounded).toBe(true);
    expect(s.moveState).toBe(MovementState.IDLE);
    const h = v3len(s.pos) - (PLANET.radius + world.terrain.heightAt(v3normalize(s.pos)));
    expect(Math.abs(h)).toBeLessThan(0.15);
  });

  it('jumps along local up', () => {
    const s = createCharacterState(start, northTangent(spawnDir));
    const body = motor.createBody(s);
    const inp = newInput();
    for (let i = 0; i < 90; i++) motor.step(body, s, inp, 1 / 60);
    const r0 = v3len(s.pos);
    inp.buttons = InputButton.JUMP;
    let peak = 0;
    for (let i = 0; i < 40; i++) {
      motor.step(body, s, inp, 1 / 60);
      peak = Math.max(peak, v3len(s.pos) - r0);
    }
    body.dispose();
    expect(peak).toBeGreaterThan(0.9);
    expect(peak).toBeLessThan(1.8);
  });

  it('runs a full lap around the planet without flips, NaNs or getting stuck', () => {
    // Run along the great circle through the spawn heading "east" (constant camera-relative forward input).
    const s = createCharacterState(start, northTangent(spawnDir));
    const body = motor.createBody(s);
    const inp = newInput();
    let heading = northTangent(spawnDir);
    let prevUp = v3normalize(s.pos);
    let travelled = 0;
    let steps = 0;
    let stuckSteps = 0;
    let prev = { ...s.pos };
    const circumference = 2 * Math.PI * PLANET.radius;
    while (travelled < circumference && steps < 60 * 400) {
      const up = v3normalize(s.pos);
      heading = transportTangent(heading, prevUp, up);
      prevUp = up;
      inp.wish = { ...heading };
      inp.aim = { ...heading };
      // Hop over obstacles now and then, like a player would.
      inp.buttons = steps % 50 < 3 ? InputButton.JUMP : 0;
      motor.step(body, s, inp, 1 / 60);
      const d = Math.hypot(s.pos.x - prev.x, s.pos.y - prev.y, s.pos.z - prev.z);
      if (d < 0.01) stuckSteps++;
      travelled += d;
      prev = { ...s.pos };
      steps++;
      expect(Number.isFinite(s.pos.x + s.pos.y + s.pos.z)).toBe(true);
      expect(Math.abs(v3dot(s.facing, v3normalize(s.pos)))).toBeLessThan(1e-3);
    }
    body.dispose();
    // Allow obstacles (trees, houses) to deflect the path, but the character must keep moving most of the time.
    expect(travelled).toBeGreaterThan(circumference * 0.95);
    expect(stuckSteps / steps).toBeLessThan(0.15);
    // Heading stays a unit tangent after the lap.
    expect(v3len(heading)).toBeCloseTo(1, 5);
  });

  it('replays identically from a cloned state (prediction / reconciliation contract)', () => {
    const s = createCharacterState(start, northTangent(spawnDir));
    const body = motor.createBody(s);
    const inp = newInput();
    for (let i = 0; i < 60; i++) motor.step(body, s, inp, 1 / 60);
    const snapshot = cloneCharacterState(s);
    const inputs = Array.from({ length: 90 }, (_, i) => ({
      wish: v3normalize({ x: Math.sin(i * 0.1), y: 0.2, z: Math.cos(i * 0.07) }),
      aim: { x: 0, y: 0, z: 1 },
      buttons: i % 30 === 0 ? InputButton.JUMP : InputButton.SPRINT,
    }));
    for (const i of inputs) motor.step(body, s, { ...i, wish: { ...i.wish }, aim: { ...i.aim } }, 1 / 60);
    const a = { ...s.pos };
    const r = cloneCharacterState(snapshot);
    for (const i of inputs) motor.step(body, r, { ...i, wish: { ...i.wish }, aim: { ...i.aim } }, 1 / 60);
    body.dispose();
    expect(Math.hypot(a.x - r.pos.x, a.y - r.pos.y, a.z - r.pos.z)).toBeLessThan(1e-6);
  });
});

describe('ability primitives on the real planet', () => {
  const motor = new CharacterMotor(world.physics);
  const spawnDir = latLonToDir(SPAWNS[0]!.lat, SPAWNS[0]!.lon);
  const ground = world.terrain.surfaceAt(spawnDir);
  const start = { x: ground.x + spawnDir.x * 0.3, y: ground.y + spawnDir.y * 0.3, z: ground.z + spawnDir.z * 0.3 };
  const landed = () => {
    const s = createCharacterState(start, northTangent(spawnDir));
    const body = motor.createBody(s);
    for (let i = 0; i < 60; i++) motor.step(body, s, newInput(), 1 / 60);
    return { s, body };
  };
  const dash = ABILITIES.wind_step.effects[0]! as { distance: number; duration: number };

  it('Dash moves its distance in whole fixed steps, never farther, then leaves at run speed', () => {
    let best = 0;
    for (let k = 0; k < 8; k++) {
      const { s, body } = landed();
      const up = v3normalize(s.pos);
      const heading = transportTangent(northTangent(spawnDir), spawnDir, up);
      const ang = (k / 8) * Math.PI * 2;
      const side = { x: up.y * heading.z - up.z * heading.y, y: up.z * heading.x - up.x * heading.z, z: up.x * heading.y - up.y * heading.x };
      const dir = { x: heading.x * Math.cos(ang) + side.x * Math.sin(ang), y: heading.y * Math.cos(ang) + side.y * Math.sin(ang), z: heading.z * Math.cos(ang) + side.z * Math.sin(ang) };
      const p0 = { ...s.pos };
      expect(startDash(s, dir, dash.distance, dash.duration, 1 / 60)).toBe(true);
      expect(s.dashSteps).toBe(Math.round(dash.duration * 60));
      for (let i = 0; i < 12; i++) motor.step(body, s, newInput(), 1 / 60);
      expect(s.dashSteps).toBe(0);
      const moved = Math.hypot(s.pos.x - p0.x, s.pos.y - p0.y, s.pos.z - p0.z);
      expect(moved).toBeLessThan(dash.distance + 0.4);
      best = Math.max(best, moved);
      const vUp = v3dot(s.vel, v3normalize(s.pos));
      const flat = Math.hypot(s.vel.x - vUp * v3normalize(s.pos).x, s.vel.y - vUp * v3normalize(s.pos).y, s.vel.z - vUp * v3normalize(s.pos).z);
      expect(flat).toBeLessThanOrEqual(MOVEMENT.runSpeed + 1e-6);
      body.dispose();
    }
    // At least one heading out of the village plaza is free for the whole dash.
    expect(best).toBeGreaterThan(dash.distance - 0.5);
  });

  it('a dash replays identically from a cloned mid-dash state (prediction contract)', () => {
    const { s, body } = landed();
    startDash(s, northTangent(v3normalize(s.pos)), dash.distance, dash.duration, 1 / 60);
    for (let i = 0; i < 5; i++) motor.step(body, s, newInput(), 1 / 60);
    const mid = cloneCharacterState(s);
    for (let i = 0; i < 20; i++) motor.step(body, s, newInput(), 1 / 60);
    for (let i = 0; i < 20; i++) motor.step(body, mid, newInput(), 1 / 60);
    body.dispose();
    expect(Math.hypot(s.pos.x - mid.pos.x, s.pos.y - mid.pos.y, s.pos.z - mid.pos.z)).toBeLessThan(1e-6);
  });

  it('Slow scales the running speed', () => {
    const speed = (slow: number) => {
      const { s, body } = landed();
      s.slow = slow;
      const inp = newInput();
      let heading = northTangent(v3normalize(s.pos));
      let prevUp = v3normalize(s.pos);
      const p0 = { ...s.pos };
      for (let i = 0; i < 45; i++) {
        const up = v3normalize(s.pos);
        heading = transportTangent(heading, prevUp, up);
        prevUp = up;
        inp.wish = { ...heading };
        motor.step(body, s, inp, 1 / 60);
      }
      body.dispose();
      return Math.hypot(s.pos.x - p0.x, s.pos.y - p0.y, s.pos.z - p0.z);
    };
    const normal = speed(1);
    const slowed = speed(0.5);
    expect(slowed / normal).toBeGreaterThan(0.4);
    expect(slowed / normal).toBeLessThan(0.62);
  });

  it('client target points always pass the server checks (camera rays in every direction around the spawn)', () => {
    const { s, body } = landed();
    body.dispose();
    const feet = s.pos;
    const up = v3normalize(feet);
    const north = northTangent(up);
    let checked = 0;
    for (const id of ['pollen_burst', 'sun_meteor'] as const) {
      const range = ABILITIES[id].range;
      for (let k = 0; k < 24; k++) {
        for (const pitch of [-0.5, -0.25, -0.08, 0.15, 0.6]) {
          const ang = (k / 24) * Math.PI * 2;
          const side = { x: up.y * north.z - up.z * north.y, y: up.z * north.x - up.x * north.z, z: up.x * north.y - up.y * north.x };
          const f = { x: north.x * Math.cos(ang) + side.x * Math.sin(ang), y: north.y * Math.cos(ang) + side.y * Math.sin(ang), z: north.z * Math.cos(ang) + side.z * Math.sin(ang) };
          const dir = v3normalize({ x: f.x + up.x * pitch, y: f.y + up.y * pitch, z: f.z + up.z * pitch });
          // Over-the-shoulder camera: 3.2 m behind, 2.2 m up.
          const cam = { x: feet.x - f.x * 3.2 + up.x * 2.2, y: feet.y - f.y * 3.2 + up.y * 2.2, z: feet.z - f.z * 3.2 + up.z * 2.2 };
          const p = resolveTargetPoint(world.physics, world.terrain, feet, cam, dir, range);
          expect(validateTargetPoint(world.physics, feet, p, range), `${id} heading ${k} pitch ${pitch}`).toBe(AbilityReject.OK);
          checked++;
        }
      }
    }
    expect(checked).toBe(240);
  });
});

describe('sphere math', () => {
  it('transports a tangent around a full circle back to itself', () => {
    const axis = v3normalize({ x: 0.3, y: 0.2, z: 0.9 });
    let up = v3normalize({ x: 1, y: 0, z: 0 });
    up = v3normalize({ x: up.x - axis.x * v3dot(up, axis), y: up.y - axis.y * v3dot(up, axis), z: up.z - axis.z * v3dot(up, axis) });
    let t = v3normalize({ x: axis.x, y: axis.y, z: axis.z });
    const t0 = { ...t };
    const n = 720;
    for (let i = 0; i < n; i++) {
      const a = ((i + 1) / n) * Math.PI * 2;
      const next = v3();
      // rotate initial up around axis by a
      const c = Math.cos(a), s = Math.sin(a);
      const k = axis;
      const u0 = up;
      const d = v3dot(k, u0) * (1 - c);
      next.x = u0.x * c + (k.y * u0.z - k.z * u0.y) * s + k.x * d;
      next.y = u0.y * c + (k.z * u0.x - k.x * u0.z) * s + k.y * d;
      next.z = u0.z * c + (k.x * u0.y - k.y * u0.x) * s + k.z * d;
      const prevUp = i === 0 ? up : (globalThis as { __prev?: typeof up }).__prev!;
      t = transportTangent(t, prevUp, next);
      (globalThis as { __prev?: typeof up }).__prev = next;
    }
    // Transport along a great circle has no holonomy.
    expect(v3angle(t, t0)).toBeLessThan(1e-3);
  });
});
