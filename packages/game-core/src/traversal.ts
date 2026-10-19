/**
 * Vertical traversal (docs/gameplay/TRAVERSAL_STATES.md, CLIMBING.md, GLIDING.md): ledge detection, ledge hang,
 * mantle and climbing, run inside the shared CharacterMotor step (client prediction and the authoritative server run
 * the very same code). Everything is measured in the character's own radial frame — localUp = normalize(pos), never a
 * global Y — and decided from Rapier queries against the real colliders plus the input wish; the animation never moves
 * the capsule. Every per-mode quantity that decides a transition is either re-derived from the geometry each step (the
 * wall normal, the ledge top) or an integer step counter that the snapshot carries (`packTraversal`), so a client
 * rebuilds exactly the server's state on reconciliation.
 */
import { ABILITIES, MOVEMENT, SurfaceFlag, TRAVERSAL, TRAVERSAL_ACTIONS, TraversalMode, type AbilityDefinition } from '@graao/game-data';
import { InputButton, MovementState, SIM_HZ, v3, v3cross, v3dot, v3len, v3normalize, v3set, type Vec3 } from '@graao/shared';
import type { CharacterState } from './character';
import { Group, groups, type GamePhysics } from './physics';

/** Traversal the motor may start for a character (CharacterState.traversalCaps): bots get none until V8. */
export const TraversalCap = {
  LEDGE: 1 << 0,
  CLIMB: 1 << 1,
  GLIDE: 1 << 2,
  ALL: 0b111,
} as const;

/** Seconds → whole simulation steps (timers are integers so client and server count the same). */
export const steps = (seconds: number): number => Math.round(seconds * SIM_HZ);

const CAPSULE_CENTER = MOVEMENT.capsuleHalfHeight + MOVEMENT.capsuleRadius;
const RADIUS = MOVEMENT.capsuleRadius;
/** Everything a character collides with (and what a ledge/wall probe may hit). */
export const TRAVERSAL_GROUPS = groups(Group.PLAYER, Group.TERRAIN | Group.PROP | Group.CHEST | Group.BARRIER | Group.RAIL);
const TOP_COS = Math.cos(TRAVERSAL.reach.topMaxSlope);
const WALK_COS = Math.cos((MOVEMENT.maxSlopeClimbDeg * Math.PI) / 180);

export const MANTLE_STEPS = steps(TRAVERSAL.mantle.maxTime);
export const GLIDE_STEPS = steps(TRAVERSAL.glide.maxTime);

/** MovementState on the wire for a traversal mode (NONE: the motor's own locomotion state). */
export function traversalMoveState(mode: TraversalMode): MovementState | null {
  switch (mode) {
    case TraversalMode.HANG:
      return MovementState.LEDGE_HANG;
    case TraversalMode.MANTLE:
      return MovementState.MANTLE;
    case TraversalMode.CLIMB:
      return MovementState.CLIMB;
    case TraversalMode.GLIDE:
      return MovementState.GLIDE;
    default:
      return null;
  }
}

/** Traversal mode of a replicated MovementState. */
export function traversalOfMoveState(ms: number): TraversalMode {
  switch (ms) {
    case MovementState.LEDGE_HANG:
      return TraversalMode.HANG;
    case MovementState.MANTLE:
      return TraversalMode.MANTLE;
    case MovementState.CLIMB:
      return TraversalMode.CLIMB;
    case MovementState.GLIDE:
      return TraversalMode.GLIDE;
    default:
      return TraversalMode.NONE;
  }
}

/**
 * May an ability be cast in this traversal mode (TRAVERSAL_ACTIONS)? On the glider only mobility magic (it takes the
 * glide over); on a ledge, a wall or mid-mantle nothing.
 */
export function traversalAllowsCast(mode: TraversalMode, abilityId: string): boolean {
  const cast = TRAVERSAL_ACTIONS[mode].cast;
  if (cast !== 'mobility') return cast === 'all';
  const def = (ABILITIES as Record<string, AbilityDefinition | undefined>)[abilityId];
  return !!def && (def.category === 'mobility' || def.tags.includes('mobility'));
}

/** Snapshot `trav` field: [travSteps 12 bits | glideSteps 10 bits | grabCooldown 6 bits]. */
export function packTraversal(s: Pick<CharacterState, 'travSteps' | 'glideSteps' | 'grabCooldown'>): number {
  return Math.min(4095, s.travSteps) | (Math.min(1023, s.glideSteps) << 12) | (Math.min(63, s.grabCooldown) << 22);
}

export function unpackTraversal(v: number, s: Pick<CharacterState, 'travSteps' | 'glideSteps' | 'grabCooldown'>): void {
  s.travSteps = v & 4095;
  s.glideSteps = (v >>> 12) & 1023;
  s.grabCooldown = (v >>> 22) & 63;
}

/**
 * Leaves any traversal mode (a knockback, an ability that moves the character, a snare): the character falls with
 * whatever velocity it has, and may not grab again for a moment (no regrab spam).
 */
export function releaseTraversal(s: CharacterState, cooldown = steps(TRAVERSAL.cooldown.regrab)): void {
  if (s.traversal === TraversalMode.NONE) return;
  s.traversal = TraversalMode.NONE;
  s.travSteps = 0;
  s.ledgeR = 0;
  s.grabCooldown = Math.max(s.grabCooldown, cooldown);
}

/** A wall found in front of the character. */
export interface WallHit {
  /** Hit point and the face's normal (unit, pointing out of the wall). */
  point: Vec3;
  normal: Vec3;
  /** The normal's horizontal part (unit, on the tangent plane): "out of the wall" for steering and facing. */
  flat: Vec3;
  handle: number;
  /** SurfaceFlag bits of the collider. */
  flags: number;
  /** Distance from the capsule axis to the wall along the probe. */
  dist: number;
  /** Height of the probe that hit, over the feet. */
  height: number;
}

/** A grabbable ledge top over a wall. */
export interface LedgeTop {
  /** Height of the top over the feet (m, along local up). */
  height: number;
  handle: number;
}

export type Grab =
  | { kind: 'mantle'; wall: WallHit; top: LedgeTop }
  | { kind: 'hang'; wall: WallHit; top: LedgeTop }
  | { kind: 'climb'; wall: WallHit };

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const along = (p: Vec3, d: Vec3, k: number): Vec3 => ({ x: p.x + d.x * k, y: p.y + d.y * k, z: p.z + d.z * k });

/**
 * Geometry queries for traversal, bound to one physics world and the motor's collider filter (the server's world is
 * shared by rooms: another room's chests, barriers and crates are invisible to this character).
 */
export class TraversalProbe {
  private readonly down = v3();

  constructor(private readonly physics: GamePhysics, private readonly predicate: () => ((c: { handle: number }) => boolean) | undefined) {}

  /** Traversal flags of a collider: tagged props and crates from the map, ability barriers are ledges, else none. */
  flags(handle: number): number {
    if (handle === this.physics.terrainHandle) return 0;
    if (this.physics.barrierHandles.has(handle)) return SurfaceFlag.LEDGE;
    return this.physics.traversalByCollider.get(handle) ?? 0;
  }

  private ray(origin: Vec3, dir: Vec3, max: number) {
    return this.physics.castRayNormal(origin, dir, max, TRAVERSAL_GROUPS, this.predicate());
  }

  /**
   * Is any grabbable or climbable collider within reach of a body at `feet` (one overlap query, the cheap first test
   * of `detect`: most of the time in the air nothing tagged is near and the wall probes are skipped)?
   */
  taggedNear(feet: Vec3, up: Vec3, reach: number): boolean {
    const room = this.predicate();
    const tagged = (c: { handle: number }) => this.flags(c.handle) !== 0 && (!room || room(c));
    return this.physics.capsuleOverlaps(along(feet, up, 1.05), up, 0.55, reach, TRAVERSAL_GROUPS, tagged);
  }

  /**
   * The closest wall in front: rays along `dir` (unit tangent) at each of `heights` over the feet, from `back` m behind
   * the capsule axis up to `reach` in front of it. A wall faces the probe and is steep (|normal · up| < maxUp). `dist` is
   * measured from the axis: negative when the face is behind it — an overhang (an eave, a slab's lip) the body has
   * already passed under, still within the hands' reach.
   */
  wall(feet: Vec3, up: Vec3, dir: Vec3, heights: readonly number[], reach: number, maxUp: number, back = 0): WallHit | null {
    let best: WallHit | null = null;
    for (const h of heights) {
      const origin = along(along(feet, up, h), dir, -back);
      const hit = this.ray(origin, dir, reach + back);
      if (!hit || hit.toi < 1e-3) continue;
      const n = hit.normal;
      const nUp = v3dot(n, up);
      if (Math.abs(nUp) >= maxUp || v3dot(n, dir) > -0.3) continue;
      const dist = hit.toi - back;
      if (best && dist >= best.dist) continue;
      const flat = v3normalize({ x: n.x - up.x * nUp, y: n.y - up.y * nUp, z: n.z - up.z * nUp });
      best = { point: along(origin, dir, hit.toi), normal: { ...n }, flat, handle: hit.handle, flags: this.flags(hit.handle), dist, height: h };
    }
    return best;
  }

  /**
   * The walkable top of `wall`, between `min` and `max` over the feet: a ray down from high over a point just past the
   * face. Nothing may sit over the top (the ray starts free and its first hit is the top), the face under the edge must
   * be at least `minFace` tall (no grabbing a thin trim) and the top must be grabbable (its own tag or the same collider).
   */
  ledgeTop(feet: Vec3, up: Vec3, wall: WallHit, min: number, max: number): LedgeTop | null {
    const r = TRAVERSAL.reach;
    const inset = along(wall.point, wall.flat, -r.topInset);
    const lift = r.topProbeHeight - v3dot(sub(inset, feet), up);
    const start = along(inset, up, lift);
    v3set(this.down, -up.x, -up.y, -up.z);
    const hit = this.ray(start, this.down, r.topProbeHeight - min + 0.02);
    if (!hit || hit.toi < 0.05) return null;
    const height = r.topProbeHeight - hit.toi;
    if (height > max || height < min) return null;
    if (v3dot(hit.normal, up) < TOP_COS) return null;
    if (hit.handle !== wall.handle && !(this.flags(hit.handle) & SurfaceFlag.LEDGE)) return null;
    // A real face under the edge (a cornice over a wall counts: the wall below is hit just behind it).
    const faceH = Math.max(0.1, height - r.minFace);
    const back = { x: -wall.flat.x, y: -wall.flat.y, z: -wall.flat.z };
    const face = this.ray(along(along(wall.point, up, faceH - wall.height), wall.flat, 0.3), back, 1.0);
    if (!face) return null;
    return { height, handle: hit.handle };
  }

  /**
   * Can a character pull up over the ledge `top` of `wall`? The spot `forwardDistance` past the edge must have walkable
   * support near the top's height (a flat slab, a laje, a pitched roof going on up), the capsule must fit standing on
   * it, and the column it rises in (from where it is to over the top) must be free.
   */
  canMantle(feet: Vec3, up: Vec3, wall: WallHit, top: LedgeTop): boolean {
    const m = TRAVERSAL.mantle;
    const pred = this.predicate();
    const h = RADIUS - 0.03;
    const half = MOVEMENT.capsuleHalfHeight;
    // The spot on the top: its own height (a pitched roof rises past the edge).
    const edge = along(feet, wall.flat, -(wall.dist - RADIUS));
    const spot = along(edge, wall.flat, -m.forwardDistance);
    v3set(this.down, -up.x, -up.y, -up.z);
    const support = this.ray(along(spot, up, top.height + 0.6), this.down, 1.0);
    if (!support || support.toi < 0.05 || v3dot(support.normal, up) < WALK_COS) return false;
    const spotH = top.height + 0.6 - support.toi;
    const spotFeet = along(spot, up, spotH + m.clearance);
    const spotUp = v3normalize(spotFeet);
    if (this.physics.capsuleOverlaps(along(spotFeet, spotUp, CAPSULE_CENTER), spotUp, half, h, TRAVERSAL_GROUPS, pred)) return false;
    // The column: the capsule at the current horizontal place, swept up until its feet clear the top (a balcony
    // beside the edge or a cornice above it catches the shoulders, not the centre line the probes look along).
    const end = top.height + m.clearance;
    for (let lift = Math.min(0.15, end); ; lift = Math.min(end, lift + 0.3)) {
      if (this.physics.capsuleOverlaps(along(feet, up, lift + CAPSULE_CENTER), up, half, h, TRAVERSAL_GROUPS, pred)) return false;
      if (lift >= end) return true;
    }
  }

  /**
   * What an airborne character moving along `dir` may grab now: a ledge to mantle at once (low/medium obstacles), a
   * ledge to hang from (high), or a climbable face. Null when nothing is in reach, nothing is tagged, or there is no room.
   */
  detect(s: CharacterState, up: Vec3, dir: Vec3): Grab | null {
    const r = TRAVERSAL.reach;
    const caps = s.traversalCaps ?? TraversalCap.ALL;
    if (s.stamina < TRAVERSAL.stamina.minGrab) return null;
    if (!this.taggedNear(s.pos, up, r.wallReach + 0.05)) return null;
    const wall = this.wall(s.pos, up, dir, r.probeHeights, r.wallReach, TRAVERSAL.climb.wallMaxUp, r.reachBack);
    if (!wall || !(wall.flags & (SurfaceFlag.LEDGE | SurfaceFlag.CLIMB))) return null;
    if (-v3dot(dir, wall.flat) < r.intoWall) return null;
    if (Math.abs(v3dot(wall.normal, up)) < r.wallMaxUp && caps & TraversalCap.LEDGE) {
      const top = this.ledgeTop(s.pos, up, wall, r.mantleMin, r.ledgeMax);
      if (top) {
        // Low and medium obstacles (and a ledge so low that hanging from it would stand the feet on the ground) are
        // vaulted at once; higher ones are hung from.
        if (top.height <= r.mantleDirectMax || this.lowHang(s.pos, up, top)) {
          if (this.canMantle(s.pos, up, wall, top)) return { kind: 'mantle', wall, top };
        } else if (this.canHang(s.pos, up, wall, top)) return { kind: 'hang', wall, top };
      }
    }
    if (wall.flags & SurfaceFlag.CLIMB && caps & TraversalCap.CLIMB) return { kind: 'climb', wall };
    return null;
  }

  /**
   * Does the body fit in the hang pose (feet `depth` under the top, `gap` off the face)? Under an eave or a balcony the
   * head and hands would be inside it: that edge is not a ledge from here.
   */
  canHang(feet: Vec3, up: Vec3, wall: WallHit, top: LedgeTop): boolean {
    const h = TRAVERSAL.hang;
    const axis = along(feet, wall.flat, -(wall.dist - RADIUS - h.gap));
    const hangFeet = along(axis, up, top.height - h.depth);
    return !this.physics.capsuleOverlaps(along(hangFeet, up, CAPSULE_CENTER), up, MOVEMENT.capsuleHalfHeight, RADIUS - 0.03, TRAVERSAL_GROUPS, this.predicate());
  }

  /** Would hanging from `top` leave the feet less than `minHangClearance` over the ground under them? */
  private lowHang(feet: Vec3, up: Vec3, top: LedgeTop): boolean {
    v3set(this.down, -up.x, -up.y, -up.z);
    const hit = this.ray(along(feet, up, 0.05), this.down, 2.5);
    return !!hit && hit.toi - 0.05 + top.height - TRAVERSAL.hang.depth < TRAVERSAL.reach.minHangClearance;
  }

  /** Is there walkable ground under the feet within `dist`? */
  groundBelow(feet: Vec3, up: Vec3, dist: number): boolean {
    v3set(this.down, -up.x, -up.y, -up.z);
    const hit = this.ray(along(feet, up, 0.1), this.down, dist + 0.1);
    return !!hit && v3dot(hit.normal, up) >= WALK_COS;
  }

  /** Nothing under the feet for `dist` m (the glider needs some air under it). */
  clearBelow(feet: Vec3, up: Vec3, dist: number): boolean {
    v3set(this.down, -up.x, -up.y, -up.z);
    return !this.ray(along(feet, up, 0.05), this.down, dist);
  }
}

/** Input split on a wall: `toward` (+ into the wall = up / over the edge), `side` (+ to the right along the wall). */
export function wallInput(wish: Vec3, flat: Vec3, up: Vec3): { toward: number; side: number; right: Vec3 } {
  const facing = { x: -flat.x, y: -flat.y, z: -flat.z };
  const right = v3normalize(v3cross(facing, up));
  return { toward: v3dot(wish, facing), side: v3dot(wish, right), right };
}

/** Rising edge of a held button (the previous command's state is in `held`). */
export const pressed = (buttons: number, bit: number, held: boolean): boolean => (buttons & bit) !== 0 && !held;

/** Len of the tangent part of `v` (m/s). */
export const tangentSpeed = (v: Vec3, up: Vec3): number => {
  const k = v3dot(v, up);
  return v3len({ x: v.x - up.x * k, y: v.y - up.y * k, z: v.z - up.z * k });
};

export { InputButton };
