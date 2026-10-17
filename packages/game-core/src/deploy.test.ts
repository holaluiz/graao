import { describe, expect, it } from 'vitest';
import { ARENA_CENTER, MOVEMENT, PLANET, UFO } from '@graao/game-data';
import { DeployState, InputButton, MovementState, v3angle, v3dot, v3len, v3normalize, v3projectOnPlane, type UfoRouteMsg } from '@graao/shared';
import { CharacterMotor, createCharacterState, newInput } from './character';
import { diveStart, everyoneLanded, jumpOpen, makeUfoRoute, ufoHeading, ufoPosition, ufoSpeed } from './deploy';
import { mulberry32 } from './rng';
import { latLonToDir } from './sphere';
import { createGameWorld } from './world';

const DEG = Math.PI / 180;
const arena = latLonToDir(ARENA_CENTER.lat, ARENA_CENTER.lon);

describe('UFO route', () => {
  const routes = Array.from({ length: 20 }, (_, i) => makeUfoRoute(mulberry32(i * 31 + 7), 1_000_000));

  it('flies 100 m above the sea and passes over the arena in the middle of the jump window', () => {
    for (const r of routes) {
      const mid = (r.open + r.close) / 2;
      const p = ufoPosition(r, mid);
      expect(v3len(p)).toBeCloseTo(UFO.orbitRadius, 3);
      expect(v3angle(v3normalize(p), arena) / DEG).toBeLessThanOrEqual(UFO.approachJitterDeg + 0.01);
      // The window spans the configured arc, centred on the closest approach.
      const a = ufoPosition(r, r.open);
      const b = ufoPosition(r, r.close);
      expect(v3angle(v3normalize(a), v3normalize(b)) / DEG).toBeCloseTo(UFO.windowArcDeg, 1);
      expect(v3angle(v3normalize(a), v3normalize(p)) / DEG).toBeCloseTo(UFO.windowArcDeg / 2, 1);
    }
  });

  it('opens the hatch after the reveal and keeps it open for the window', () => {
    const r = routes[0]!;
    expect(r.open - r.t0).toBe(UFO.revealMs);
    expect(r.close - r.open).toBe(UFO.windowMs);
    expect(jumpOpen(r, r.open - 1)).toBe(false);
    expect(jumpOpen(r, r.open)).toBe(true);
    expect(jumpOpen(r, r.close + 1)).toBe(false);
  });

  it('moves at a steady, readable speed along its own heading', () => {
    for (const r of routes.slice(0, 5)) {
      expect(ufoSpeed(r)).toBeGreaterThan(15);
      expect(ufoSpeed(r)).toBeLessThan(30);
      const t = r.open + 3000;
      const p0 = ufoPosition(r, t);
      const p1 = ufoPosition(r, t + 100);
      const v = { x: (p1.x - p0.x) * 10, y: (p1.y - p0.y) * 10, z: (p1.z - p0.z) * 10 };
      expect(v3len(v)).toBeCloseTo(ufoSpeed(r), 1);
      expect(v3dot(v3normalize(v), ufoHeading(r, t + 50))).toBeGreaterThan(0.9999);
    }
  });

  it('is plain integers that survive the network unchanged (every side evaluates the same numbers)', () => {
    const r = routes[3]!;
    for (const v of [...r.c, ...r.h, r.r, r.t0, r.open, r.close, r.a0, r.w]) expect(Number.isInteger(v)).toBe(true);
    const copy = JSON.parse(JSON.stringify(r)) as UfoRouteMsg;
    const t = r.open + 1234;
    expect(ufoPosition(copy, t)).toEqual(ufoPosition(r, t));
    expect(diveStart(copy, t)).toEqual(diveStart(r, t));
  });

  it('starts a dive just under the hull, along the course, quantized like the jump event', () => {
    const r = routes[5]!;
    const t = r.open + 5000;
    const d = diveStart(r, t);
    const ship = ufoPosition(r, t);
    expect(v3len(ship) - v3len(d.pos)).toBeCloseTo(UFO.exitDrop, 2);
    expect(v3len(d.vel)).toBeCloseTo(UFO.exitSpeed, 1);
    for (const x of [d.pos.x, d.pos.y, d.pos.z]) expect(Math.round(x * 1000)).toBeCloseTo(x * 1000, 6);
    for (const x of [d.vel.x, d.vel.y, d.vel.z]) expect(Math.round(x * 100)).toBeCloseTo(x * 100, 6);
    // Clamped into the window.
    expect(diveStart(r, r.open - 5000)).toEqual(diveStart(r, r.open));
    expect(diveStart(r, r.close + 5000)).toEqual(diveStart(r, r.close));
  });
});

describe('the drop (radial skydive with the shared controller)', async () => {
  const world = await createGameWorld({ includeVisual: false });
  const motor = new CharacterMotor(world.physics);
  const route = makeUfoRoute(mulberry32(99), 0);

  function dive(buttons: number, steer: 'none' | 'forward'): { seconds: number; maxFall: number; reach: number; states: Set<number> } {
    const d = diveStart(route, (route.open + route.close) / 2);
    const s = createCharacterState(d.pos, d.facing);
    s.vel = { ...d.vel };
    s.diving = true;
    const body = motor.createBody(s);
    const inp = newInput();
    const start = v3normalize(d.pos);
    let t = 0;
    let maxFall = 0;
    const states = new Set<number>();
    while (s.diving && t < 30) {
      const up = v3normalize(s.pos);
      const f = steer === 'forward' ? v3normalize(v3projectOnPlane(d.facing, up)) : { x: 0, y: 0, z: 0 };
      inp.wish = f;
      inp.buttons = buttons;
      motor.step(body, s, inp, 1 / 60);
      maxFall = Math.max(maxFall, -v3dot(s.vel, v3normalize(s.pos)));
      if (s.diving) states.add(s.moveState);
      t += 1 / 60;
    }
    body.dispose();
    return { seconds: t, maxFall, reach: v3angle(start, v3normalize(s.pos)) * PLANET.radius, states };
  }

  it('falls at the capped skydive speed and lands (the dive ends on the first ground contact)', () => {
    const r = dive(0, 'none');
    expect(r.seconds).toBeGreaterThan(3.5);
    expect(r.seconds).toBeLessThan(8);
    expect(r.maxFall).toBeLessThanOrEqual(MOVEMENT.diveTerminalSpeed + 0.01);
    expect([...r.states]).toEqual([MovementState.FALL]);
  });

  it('dives faster head-first (sprint) and steers far enough to pick a landing spot', () => {
    const fast = dive(InputButton.SPRINT, 'none');
    const slow = dive(0, 'none');
    expect(fast.seconds).toBeLessThan(slow.seconds - 0.8);
    expect(fast.maxFall).toBeGreaterThan(MOVEMENT.diveTerminalSpeed + 5);
    const steered = dive(0, 'forward');
    // Steering reach: tens of metres over the ground from the jump point.
    expect(steered.reach).toBeGreaterThan(40);
  });

  it('ignores jump and aim while diving', () => {
    const d = diveStart(route, route.open);
    const s = createCharacterState(d.pos, d.facing);
    s.diving = true;
    const body = motor.createBody(s);
    const inp = newInput();
    inp.buttons = InputButton.JUMP | InputButton.AIM | InputButton.FIRE;
    const r0 = v3len(s.pos);
    for (let i = 0; i < 30; i++) motor.step(body, s, inp, 1 / 60);
    expect(v3len(s.pos)).toBeLessThan(r0);
    expect(s.aiming).toBe(false);
    body.dispose();
  });
});

describe('deployment rules', () => {
  it('starts the fight only when every connected participant has landed', () => {
    const p = (deploy: DeployState, connected = true, inMatch = true) => ({ deploy, connected, inMatch });
    expect(everyoneLanded([p(DeployState.LANDED), p(DeployState.DIVING)])).toBe(false);
    expect(everyoneLanded([p(DeployState.LANDED), p(DeployState.SHIP)])).toBe(false);
    expect(everyoneLanded([p(DeployState.LANDED), p(DeployState.LANDED)])).toBe(true);
    // A disconnected seat or a spectator does not hold the match back.
    expect(everyoneLanded([p(DeployState.LANDED), p(DeployState.SHIP, false)])).toBe(true);
    expect(everyoneLanded([p(DeployState.LANDED), p(DeployState.NONE, true, false)])).toBe(true);
    expect(everyoneLanded([])).toBe(false);
  });
});
