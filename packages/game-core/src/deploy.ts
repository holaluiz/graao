/**
 * UFO deployment (Phase 7): the ship's deterministic route, its position at any server time and the exact state a
 * jump starts from. Pure math shared by the authoritative server and the clients, which only derive the ship's
 * position from the route (it is never streamed) and receive each jump's start state in the `jump` event.
 *
 * Route: a great circle at radius r around the planet centre, closest approach `c` (near the arena), direction of
 * travel `h` there. The ship is at angle θ(t) from `c` toward `h`, moving at constant angular speed; the jump window
 * opens at θ = `windowStartDeg` and spans `windowArcDeg` (a full lap). Every route field is an integer (see
 * UfoRouteMsg), so both sides evaluate the same numbers.
 */
import { ARENA_CENTER, PLANET, UFO } from '@graao/game-data';
import {
  DeployState,
  v3,
  v3cross,
  v3normalize,
  v3projectOnPlane,
  v3rotateAxis,
  v3set,
  type UfoRouteMsg,
  type Vec3,
} from '@graao/shared';
import { waterDepth } from './character';
import { latLonToDir } from './sphere';
import type { Terrain } from './terrain';

const DEG = Math.PI / 180;
const U = 1e6;

export interface UfoTimings {
  revealMs: number;
  windowMs: number;
}

/** A new route starting at server time `now`, passing over the arena with a random heading and offset. */
export function makeUfoRoute(rng: () => number, now: number, timings: Partial<UfoTimings> = {}): UfoRouteMsg {
  const revealMs = Math.round(timings.revealMs ?? UFO.revealMs);
  const windowMs = Math.max(1, Math.round(timings.windowMs ?? UFO.windowMs));
  const arena = latLonToDir(ARENA_CENTER.lat, ARENA_CENTER.lon);
  // Closest approach: the arena centre nudged by up to `approachJitterDeg` in a random direction.
  const tan = v3normalize(v3cross(arena, Math.abs(arena.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 }));
  const nudgeAxis = v3rotateAxis(tan, arena, rng() * Math.PI * 2);
  const c = v3rotateAxis(arena, nudgeAxis, Math.sqrt(rng()) * UFO.approachJitterDeg * DEG);
  const h = v3rotateAxis(v3normalize(v3projectOnPlane(tan, c)), c, rng() * Math.PI * 2);
  const w = (UFO.windowArcDeg * DEG) / windowMs; // rad per ms
  const a0 = UFO.windowStartDeg * DEG - w * revealMs;
  const int3 = (v: Vec3): [number, number, number] => [Math.round(v.x * U), Math.round(v.y * U), Math.round(v.z * U)];
  return {
    c: int3(c),
    h: int3(h),
    r: Math.round(UFO.orbitRadius * 100),
    t0: Math.round(now),
    open: Math.round(now) + revealMs,
    close: Math.round(now) + revealMs + windowMs,
    a0: Math.round(a0 * U),
    w: Math.round(w * 1e9),
  };
}

/** Orthonormal route frame decoded from the integer message. */
export function routeFrame(r: UfoRouteMsg): { c: Vec3; h: Vec3; n: Vec3; radius: number } {
  const c = v3normalize({ x: r.c[0], y: r.c[1], z: r.c[2] });
  const h = v3normalize(v3projectOnPlane({ x: r.h[0], y: r.h[1], z: r.h[2] }, c));
  return { c, h, n: v3cross(c, h), radius: r.r / 100 };
}

/** The ship's angle (rad) from the closest approach at server time `t`. */
export const ufoAngle = (r: UfoRouteMsg, t: number): number => r.a0 * 1e-6 + r.w * 1e-9 * (t - r.t0);

/** Ship speed along its route (m/s). */
export const ufoSpeed = (r: UfoRouteMsg): number => (r.w * 1e-9 * 1000 * r.r) / 100;

/** The ship's centre at server time `t` (world space). */
export function ufoPosition(r: UfoRouteMsg, t: number, out: Vec3 = v3()): Vec3 {
  const f = routeFrame(r);
  const a = ufoAngle(r, t);
  const ca = Math.cos(a) * f.radius;
  const sa = Math.sin(a) * f.radius;
  return v3set(out, f.c.x * ca + f.h.x * sa, f.c.y * ca + f.h.y * sa, f.c.z * ca + f.h.z * sa);
}

/** The ship's direction of travel at server time `t` (unit tangent). */
export function ufoHeading(r: UfoRouteMsg, t: number, out: Vec3 = v3()): Vec3 {
  const f = routeFrame(r);
  const a = ufoAngle(r, t);
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  return v3set(out, -f.c.x * sa + f.h.x * ca, -f.c.y * sa + f.h.y * ca, -f.c.z * sa + f.h.z * ca);
}

/** True when a jump at server time `t` is inside the window. */
export const jumpOpen = (r: UfoRouteMsg, t: number): boolean => t >= r.open && t <= r.close;

export interface DiveStart {
  /** Feet position (mm-quantized, m). */
  pos: Vec3;
  /** Velocity (cm/s-quantized, m/s). */
  vel: Vec3;
  facing: Vec3;
}

/**
 * The state a jump at server time `t` (clamped into the window) starts from: just under the hull, moving along the
 * ship's course. Quantized exactly like the `jump` event, so the server simulates from the same numbers the
 * jumper's client predicts from.
 */
export function diveStart(r: UfoRouteMsg, t: number): DiveStart {
  const tc = Math.min(r.close, Math.max(r.open, t));
  const p = ufoPosition(r, tc);
  const up = v3normalize(p);
  const head = ufoHeading(r, tc);
  const q = (x: number, s: number) => Math.round(x * s) / s;
  const pos = { x: q(p.x - up.x * UFO.exitDrop, 1000), y: q(p.y - up.y * UFO.exitDrop, 1000), z: q(p.z - up.z * UFO.exitDrop, 1000) };
  const vel = { x: q(head.x * UFO.exitSpeed, 100), y: q(head.y * UFO.exitSpeed, 100), z: q(head.z * UFO.exitSpeed, 100) };
  return { pos, vel, facing: dirFromVelocity(pos, vel) };
}

/**
 * Did a dive end in water? A dive ends on the first contact with the ground or the sea surface, so a landing is wet
 * when the terrain under it lies below the sea and the feet are (about) at or below the surface.
 */
export function landedInWater(terrain: Terrain, feet: Vec3): boolean {
  return terrain.heightAt(v3normalize(feet)) < PLANET.seaLevel - 0.15 && waterDepth(feet) > -0.6;
}

/** Facing tangent for a dive start (the course, flattened onto the local ground plane). */
export function dirFromVelocity(pos: Vec3, vel: Vec3): Vec3 {
  const up = v3normalize(pos);
  return v3normalize(v3projectOnPlane(vel, up));
}

export interface DeployParticipant {
  connected: boolean;
  inMatch: boolean;
  deploy: DeployState;
}

/** True when every connected participant of a deployment has landed (the fight can start). */
export function everyoneLanded(players: DeployParticipant[]): boolean {
  const seats = players.filter((p) => p.inMatch && p.connected);
  return seats.length > 0 && seats.every((p) => p.deploy === DeployState.LANDED);
}
