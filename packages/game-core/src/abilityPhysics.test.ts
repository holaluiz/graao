import { describe, expect, it } from 'vitest';
import { InputButton, v3dot, v3normalize } from '@graao/shared';
import { CharacterMotor, createCharacterState, newInput, startDash } from './character';
import { createAbilityBarrier, createPhysics, initRapier, type GamePhysics } from './physics';

const R = await initRapier();
function physics(): GamePhysics {
  return createPhysics(R, {
    positions: new Float32Array([-30, -30, 100, 30, -30, 100, 30, 30, 100, -30, 30, 100]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]), normals: new Float32Array(12), heights: new Float32Array(4), triangleFace: new Uint8Array(2),
  }, { placements: [], structures: [], anchors: [], doors: [], crates: [] });
}

function barrier(p: GamePhysics) {
  return createAbilityBarrier(p, { center: { x: 0, y: 0, z: 101.2 }, up: { x: 0, y: 0, z: 1 }, forward: { x: 1, y: 0, z: 0 }, side: { x: 0, y: 1, z: 0 }, width: 4, height: 2.4, depth: 0.25 });
}

describe('ability collision in the real shared Rapier world', () => {
  it('cover blocks shots and reports a radial surface normal only to its own room', () => {
    const p = physics();
    try {
      const wall = barrier(p);
      const origin = { x: -5, y: 0, z: 101 };
      const direction = { x: 1, y: 0, z: 0 };
      expect(p.castRay(origin, direction, 10)?.handle).toBe(wall.handle);
      const emptyRoom = (c: { handle: number }) => !p.barrierHandles.has(c.handle);
      expect(p.castRay(origin, direction, 10, undefined, emptyRoom)).toBeNull();
      expect(p.castRayNormal(origin, direction, 10)?.normal.x).toBeLessThan(-0.9);
      wall.dispose();
      wall.dispose();
      expect(p.barrierHandles.size).toBe(0);
      expect(p.castRay(origin, direction, 10)).toBeNull();
    } finally { p.dispose(); }
  });

  it('a dash is stopped by its own room cover while another room capsule passes through', () => {
    const p = physics();
    try {
      const wall = barrier(p);
      const first = new CharacterMotor(p);
      const second = new CharacterMotor(p);
      first.barrierFilter = new Set([wall.handle]);
      second.barrierFilter = new Set();
      const a = createCharacterState({ x: -3, y: 0, z: 100.08 }, { x: 1, y: 0, z: 0 });
      const b = createCharacterState({ ...a.pos }, { ...a.facing });
      a.grounded = b.grounded = true;
      const bodyA = first.createBody(a);
      const bodyB = second.createBody(b);
      startDash(a, { x: 1, y: 0, z: 0 }, 6, 0.3, 1 / 60);
      startDash(b, { x: 1, y: 0, z: 0 }, 6, 0.3, 1 / 60);
      for (let i = 0; i < 18; i++) { first.step(bodyA, a, newInput(), 1 / 60); second.step(bodyB, b, newInput(), 1 / 60); }
      expect(a.pos.x).toBeLessThan(-0.3);
      expect(b.pos.x).toBeGreaterThan(2);
      bodyA.dispose(); bodyB.dispose(); wall.dispose();
    } finally { p.dispose(); }
  });

  it('gliding limits radial fall speed, expires, and resumes ordinary radial gravity', () => {
    const p = physics();
    try {
      const motor = new CharacterMotor(p);
      const s = createCharacterState({ x: 0, y: 0, z: 110 }, { x: 1, y: 0, z: 0 });
      s.vel.z = -20;
      s.abilityMovement = { mode: 'glide', remaining: 0.15, speed: 9, gravityFactor: 0.2, airControl: 1.4, lift: 3.5 };
      const body = motor.createBody(s);
      motor.step(body, s, newInput(), 1 / 60);
      expect(v3dot(s.vel, v3normalize(s.pos))).toBeCloseTo(-3.5, 3);
      for (let i = 0; i < 15; i++) motor.step(body, s, newInput(), 1 / 60);
      expect(s.abilityMovement).toBeUndefined();
      expect(v3dot(s.vel, v3normalize(s.pos))).toBeLessThan(-4);
      body.dispose();
    } finally { p.dispose(); }
  });

  it('root blocks movement and jumps, while sprint prevention preserves normal movement and aiming', () => {
    const p = physics();
    try {
      const motor = new CharacterMotor(p);
      const s = createCharacterState({ x: 0, y: 0, z: 100.08 }, { x: 1, y: 0, z: 0 });
      const body = motor.createBody(s);
      s.grounded = true; s.rooted = true;
      const input = newInput(); input.wish.x = 1; input.aim.x = 1; input.aim.z = 0; input.buttons = InputButton.JUMP | InputButton.SPRINT;
      for (let i = 0; i < 20; i++) motor.step(body, s, input, 1 / 60);
      expect(Math.abs(s.pos.x)).toBeLessThan(0.1);
      s.rooted = false; s.noSprint = true;
      input.buttons = InputButton.AIM | InputButton.SPRINT;
      for (let i = 0; i < 45; i++) motor.step(body, s, input, 1 / 60);
      expect(s.pos.x).toBeGreaterThan(0.8);
      expect(s.aiming).toBe(true);
      body.dispose();
    } finally { p.dispose(); }
  });
});
