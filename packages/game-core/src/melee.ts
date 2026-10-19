/**
 * Unarmed combat rules shared by the server (authoritative) and the client (cosmetic prediction only): which body a
 * punch reaches. A punch comes from the attacker's chest along the camera aim flattened onto the local ground plane;
 * it reaches the nearest body (player capsule or creep capsule) whose surface is within MELEE.range and inside the
 * front cone, with nothing solid in between. One punch hits at most one body.
 */
import { MELEE } from '@graao/game-data';
import { v3addScaled, v3dot, v3normalize, v3projectOnPlane, type Vec3 } from '@graao/shared';
import { HITBOX } from './combat';
import { northTangent } from './sphere';

export interface MeleeBody {
  /** Player index, or the creep's id. */
  id: number;
  creep: boolean;
  feet: Vec3;
  alive: boolean;
  /** Capsule above the feet (m). */
  bottom: number;
  top: number;
  radius: number;
}

/** A player's whole body (torso capsule up to the top of the head) as a punch sees it. */
export const PLAYER_MELEE_BODY = { bottom: HITBOX.bodyBottom, top: HITBOX.headHeight + HITBOX.headRadius, radius: HITBOX.bodyRadius } as const;

export interface MeleeRayCaster {
  castRay(origin: Vec3, dir: Vec3, maxDist: number, filterGroups?: number): { toi: number } | null;
}

export interface MeleeOutcome {
  /** 0 nothing in reach, 1 a player, 2 a creep, 3 stopped by a wall. */
  result: 0 | 1 | 2 | 3;
  /** Player index or creep id (-1 for none). */
  target: number;
  /** Contact point (body surface or wall), or the end of the reach. */
  point: Vec3;
}

export interface MeleeConfig {
  range: number;
  coneDeg: number;
  chestHeight: number;
}

/** Closest point of segment a–b to p. */
function closestOnSegment(a: Vec3, b: Vec3, p: Vec3): Vec3 {
  const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const len2 = v3dot(ab, ab);
  const t = len2 > 1e-9 ? Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y + (p.z - a.z) * ab.z) / len2)) : 0;
  return { x: a.x + ab.x * t, y: a.y + ab.y * t, z: a.z + ab.z * t };
}

/** The punch's forward direction: the aim on the attacker's ground plane (facing when the aim is straight up/down). */
export function meleeForward(feet: Vec3, aim: Vec3, facing?: Vec3): Vec3 {
  const up = v3normalize(feet);
  const flat = v3projectOnPlane(aim, up);
  if (Math.hypot(flat.x, flat.y, flat.z) > 1e-3) return v3normalize(flat);
  return facing ? v3normalize(v3projectOnPlane(facing, up)) : northTangent(up);
}

/**
 * Resolves one punch from an attacker standing at `feet` aiming `aim` (unit). `ignore` is the attacker's own player
 * index. `worldGroups` is the collision filter for walls (the world query shots use).
 */
export function resolveMelee(physics: MeleeRayCaster, feet: Vec3, aim: Vec3, bodies: readonly MeleeBody[], ignore: number, worldGroups?: number, cfg: MeleeConfig = MELEE, facing?: Vec3): MeleeOutcome {
  const up = v3normalize(feet);
  const chest = v3addScaled(feet, up, cfg.chestHeight);
  const forward = meleeForward(feet, aim, facing);
  const cosCone = Math.cos((cfg.coneDeg * Math.PI) / 180);
  const candidates: { body: MeleeBody; q: Vec3; dist: number; centre: number; score: number }[] = [];
  for (const b of bodies) {
    if (!b.alive || (!b.creep && b.id === ignore)) continue;
    const bu = v3normalize(b.feet);
    const a = v3addScaled(b.feet, bu, b.bottom + b.radius);
    const t = v3addScaled(b.feet, bu, Math.max(b.bottom + b.radius, b.top - b.radius));
    const q = closestOnSegment(a, t, chest);
    const toQ = { x: q.x - chest.x, y: q.y - chest.y, z: q.z - chest.z };
    const centre = Math.hypot(toQ.x, toQ.y, toQ.z);
    const dist = centre - b.radius;
    if (dist > cfg.range) continue;
    // Direction on the ground plane: close bodies (overlapping the attacker) count whatever the angle.
    const flat = v3projectOnPlane(toQ, up);
    const fl = Math.hypot(flat.x, flat.y, flat.z);
    const cos = fl > 1e-4 ? v3dot(flat, forward) / fl : 1;
    if (fl > b.radius + 0.15 && cos < cosCone) continue;
    candidates.push({ body: b, q, dist, centre, score: Math.max(0, dist) + (1 - cos) * 1.6 });
  }
  candidates.sort((x, y) => x.score - y.score);
  let wall: Vec3 | null = null;
  for (const c of candidates) {
    const len = c.centre;
    if (len > 1e-3) {
      const d = { x: (c.q.x - chest.x) / len, y: (c.q.y - chest.y) / len, z: (c.q.z - chest.z) / len };
      const reach = Math.max(0, len - c.body.radius);
      const hit = reach > 0.05 ? physics.castRay(chest, d, reach, worldGroups) : null;
      if (hit) {
        wall ??= v3addScaled(chest, d, hit.toi);
        continue;
      }
      return { result: c.body.creep ? 2 : 1, target: c.body.id, point: v3addScaled(chest, d, reach) };
    }
    return { result: c.body.creep ? 2 : 1, target: c.body.id, point: { ...chest } };
  }
  if (wall) return { result: 3, target: -1, point: wall };
  // Nothing to hit: a wall straight ahead stops the fist, otherwise it swings through the air.
  const ahead = physics.castRay(chest, forward, cfg.range, worldGroups);
  if (ahead) return { result: 3, target: -1, point: v3addScaled(chest, forward, ahead.toi) };
  return { result: 0, target: -1, point: v3addScaled(chest, forward, cfg.range) };
}

/** Punch interval check (server): enough time since the last accepted punch, with the jitter tolerance. */
export function meleeReady(lastAt: number, now: number, intervalMs: number, tolerance: number = MELEE.intervalTolerance): boolean {
  return now - lastAt >= intervalMs * tolerance;
}
