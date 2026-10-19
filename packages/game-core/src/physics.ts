/**
 * Rapier world for gameplay physics. Gravity is NOT global: the world gravity is zero and every system applies its
 * own (radial for characters, custom for projectiles). Terrain is a trimesh built from the shared height function;
 * props use primitive colliders from the layout. Client and server build the same world.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import type { Vec3 } from '@graao/shared';
import type { ColliderPrimitive, Placement, SurfacedCollider, WorldLayout } from './layout';
import type { TerrainMesh } from './terrain';

export type Rapier = typeof RAPIER;

let rapierReady: Promise<Rapier> | null = null;
/** Initializes the Rapier WASM module once per process/page. */
export function initRapier(): Promise<Rapier> {
  rapierReady ??= RAPIER.init().then(() => RAPIER);
  return rapierReady;
}

/** Collision group bits. */
export const Group = {
  TERRAIN: 0x0001,
  PROP: 0x0002,
  PLAYER: 0x0004,
  /** Chests added at run time (per room on the server, whose world is shared: see `CharacterMotor.chestFilter`). */
  CHEST: 0x0008,
  /** Temporary ability cover, scoped to one room by ray/motor predicates. */
  BARRIER: 0x0010,
  /** Map railings and fences: they stop characters, never shots or sight (not in the world queries). */
  RAIL: 0x0020,
} as const;

/** Rapier InteractionGroups: membership in the high 16 bits, filter in the low 16 bits. */
export const groups = (membership: number, filter: number): number => ((membership & 0xffff) << 16) | (filter & 0xffff);

export const GROUPS_WORLD_QUERY = groups(0xffff, Group.TERRAIN | Group.PROP | Group.BARRIER);
export const GROUPS_TERRAIN_QUERY = groups(0xffff, Group.TERRAIN);
export const GROUPS_PROP_QUERY = groups(0xffff, Group.PROP);
export const GROUPS_CHEST_QUERY = groups(0xffff, Group.CHEST);

/** Quaternion (x, y, z, w) of the rotation whose columns are the given orthonormal axes. */
export function quatFromBasis(xa: Vec3, ya: Vec3, za: Vec3): { x: number; y: number; z: number; w: number } {
  const m00 = xa.x, m01 = ya.x, m02 = za.x;
  const m10 = xa.y, m11 = ya.y, m12 = za.y;
  const m20 = xa.z, m21 = ya.z, m22 = za.z;
  const trace = m00 + m11 + m22;
  let x: number, y: number, z: number, w: number;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    w = 0.25 / s;
    x = (m21 - m12) * s;
    y = (m02 - m20) * s;
    z = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }
  return { x, y, z, w };
}

/** Hamilton product a·b (apply b, then a). */
export function quatMul(a: { x: number; y: number; z: number; w: number }, b: { x: number; y: number; z: number; w: number }): { x: number; y: number; z: number; w: number } {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

/** Quaternion rotating +Y onto unit vector `up`. */
export function quatFromUp(up: Vec3): { x: number; y: number; z: number; w: number } {
  const d = up.y;
  if (d < -0.999999) return { x: 1, y: 0, z: 0, w: 0 };
  // axis = Y × up = (up.z, 0, -up.x)
  const x = up.z;
  const z = -up.x;
  const w = 1 + d;
  const l = Math.hypot(x, z, w);
  return { x: x / l, y: 0, z: z / l, w: w / l };
}

export interface GamePhysics {
  R: Rapier;
  world: InstanceType<Rapier['World']>;
  /** Collider handle → placement (props only). */
  propByCollider: Map<number, Placement>;
  /** Collider handle → what that kit part is made of (its KitColor), when it says (footsteps). */
  surfaceByCollider: Map<number, string>;
  terrainHandle: number;
  /** Every chest collider currently in this world (any room's). */
  chestHandles: Set<number>;
  /** Every ability barrier in this shared world; a server query must filter foreign rooms. */
  barrierHandles: Set<number>;
  /**
   * Every door and crate collider (interactiveSystem.ts) of every room in this world: the server's world is shared, so
   * a room's motor and shots only meet its own (see `CharacterMotor.interactiveFilter`).
   */
  interactiveHandles: Set<number>;
  /** Casts a ray; returns distance and collider handle of the first hit, or null. */
  castRay(origin: Vec3, dir: Vec3, maxDist: number, filterGroups?: number, predicate?: (collider: RAPIER.Collider) => boolean): { toi: number; handle: number } | null;
  /** Like castRay, plus the surface normal at the hit. */
  castRayNormal(origin: Vec3, dir: Vec3, maxDist: number, filterGroups?: number, predicate?: (collider: RAPIER.Collider) => boolean): { toi: number; handle: number; normal: Vec3 } | null;
  /** True when a box (half extents, centre, basis side/up/forward) overlaps any collider in `filterGroups`. */
  boxOverlaps(center: Vec3, half: Vec3, side: Vec3, up: Vec3, forward: Vec3, filterGroups: number, predicate?: (collider: RAPIER.Collider) => boolean): boolean;
  /** True when a ball overlaps any collider in `filterGroups`. */
  ballOverlaps(center: Vec3, r: number, filterGroups: number, predicate?: (collider: RAPIER.Collider) => boolean): boolean;
  dispose(): void;
}

export function createPhysics(R: Rapier, mesh: TerrainMesh, layout: WorldLayout): GamePhysics {
  const world = new R.World({ x: 0, y: 0, z: 0 });
  const terrainDesc = R.ColliderDesc.trimesh(mesh.positions, mesh.indices)
    .setCollisionGroups(groups(Group.TERRAIN, 0xffff))
    .setFriction(0.8);
  const terrain = world.createCollider(terrainDesc);

  const propByCollider = new Map<number, Placement>();
  const surfaceByCollider = new Map<number, string>();
  for (const p of layout.placements) {
    // Breakable crates get per-room colliders (interactiveSystem.ts).
    if (p.visualOnly || p.colliders.length === 0 || p.breakable) continue;
    // One description per primitive, in order: the i-th collider is the i-th primitive.
    placementColliderDescs(R, p).forEach((desc, i) => {
      const col = world.createCollider(desc);
      propByCollider.set(col.handle, p);
      const surface = (p.colliders[i] as SurfacedCollider | undefined)?.surface;
      if (surface) surfaceByCollider.set(col.handle, surface);
    });
  }
  // Build the broad phase once so scene queries see the static world.
  world.step();

  const ray = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
  return {
    R,
    world,
    propByCollider,
    surfaceByCollider,
    terrainHandle: terrain.handle,
    chestHandles: new Set(),
    barrierHandles: new Set(),
    interactiveHandles: new Set(),
    castRay(origin, dir, maxDist, filterGroups = GROUPS_WORLD_QUERY, predicate) {
      ray.origin = origin;
      ray.dir = dir;
      const hit = world.castRay(ray, maxDist, true, undefined, filterGroups, undefined, undefined, predicate);
      return hit ? { toi: hit.timeOfImpact, handle: hit.collider.handle } : null;
    },
    castRayNormal(origin, dir, maxDist, filterGroups = GROUPS_WORLD_QUERY, predicate) {
      ray.origin = origin;
      ray.dir = dir;
      const hit = world.castRayAndGetNormal(ray, maxDist, true, undefined, filterGroups, undefined, undefined, predicate);
      return hit ? { toi: hit.timeOfImpact, handle: hit.collider.handle, normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z } } : null;
    },
    boxOverlaps(center, half, side, up, forward, filterGroups, predicate) {
      let any = false;
      world.intersectionsWithShape(center, quatFromBasis(side, up, forward), new R.Cuboid(half.x, half.y, half.z), () => {
        any = true;
        return false;
      }, undefined, filterGroups, undefined, undefined, predicate);
      return any;
    },
    ballOverlaps(center, r, filterGroups, predicate) {
      let any = false;
      world.intersectionsWithShape(center, { x: 0, y: 0, z: 0, w: 1 }, new R.Ball(r), () => {
        any = true;
        return false;
      }, undefined, filterGroups, undefined, undefined, predicate);
      return any;
    },
    dispose() {
      world.free();
    },
  };
}

/** Collider descriptions of a placement's primitives, posed in the world (shared by the static world and run-time pieces). */
export function placementColliderDescs(R: Rapier, p: Placement): InstanceType<Rapier['ColliderDesc']>[] {
  const out: InstanceType<Rapier['ColliderDesc']>[] = [];
  const q = quatFromBasis(p.side, p.up, p.forward);
  for (const c of p.colliders) {
    const desc = colliderDesc(R, c);
    if (!desc) continue;
    if (c.type === 'hull') {
      desc.setTranslation(p.position.x, p.position.y, p.position.z);
    } else {
      desc.setTranslation(
        p.position.x + p.side.x * c.x + p.up.x * c.y + p.forward.x * c.z,
        p.position.y + p.side.y * c.x + p.up.y * c.y + p.forward.y * c.z,
        p.position.z + p.side.z * c.x + p.up.z * c.y + p.forward.z * c.z,
      );
    }
    desc.setRotation(c.type !== 'hull' && c.type !== 'ball' && c.q ? quatMul(q, c.q) : q).setCollisionGroups(groups(c.block === 'move' ? Group.RAIL : Group.PROP, 0xffff));
    out.push(desc);
  }
  return out;
}

function colliderDesc(R: Rapier, c: ColliderPrimitive) {
  switch (c.type) {
    case 'cuboid':
      return R.ColliderDesc.cuboid(c.hx, c.hy, c.hz);
    case 'cylinder':
      return R.ColliderDesc.cylinder(c.hh, c.r);
    case 'cone':
      return R.ColliderDesc.cone(c.hh, c.r);
    case 'ball':
      return R.ColliderDesc.ball(c.r);
    case 'hull':
      return R.ColliderDesc.convexHull(new Float32Array(c.points));
  }
}

/** Chest collider half extents (m) and the height of its centre over the base point (a chest is a low box). */
export const CHEST_COLLIDER = { hx: 0.47, hy: 0.33, hz: 0.32, centerHeight: 0.31 } as const;

/**
 * Adds a chest's box collider (base point on the ground, up, front). Chest colliders only block characters (the
 * CHEST group is not in the shot/LOS queries). Call `refreshQueries` once after a batch so scene queries see them.
 */
export function addChestCollider(physics: GamePhysics, base: Vec3, up: Vec3, forward: Vec3): number {
  const { R, world } = physics;
  const side = { x: up.y * forward.z - up.z * forward.y, y: up.z * forward.x - up.x * forward.z, z: up.x * forward.y - up.y * forward.x };
  const c = CHEST_COLLIDER;
  const desc = R.ColliderDesc.cuboid(c.hx, c.hy, c.hz)
    .setTranslation(base.x + up.x * c.centerHeight, base.y + up.y * c.centerHeight, base.z + up.z * c.centerHeight)
    .setRotation(quatFromBasis(side, up, forward))
    .setCollisionGroups(groups(Group.CHEST, 0xffff));
  const col = world.createCollider(desc);
  physics.chestHandles.add(col.handle);
  return col.handle;
}

export function removeChestCollider(physics: GamePhysics, handle: number): void {
  const col = physics.world.getCollider(handle);
  if (col) physics.world.removeCollider(col, false);
  physics.chestHandles.delete(handle);
}

/** Rebuilds the broad phase after colliders were added or removed (one step of a world with no dynamic bodies). */
export function refreshQueries(physics: GamePhysics): void {
  physics.world.step();
}

/** Metres, world-space radial basis. `center` is the collider's centre, not the ground point. */
export interface AbilityBarrierFrame {
  center: Vec3;
  side: Vec3;
  up: Vec3;
  forward: Vec3;
  width: number;
  height: number;
  depth: number;
}

/** Temporary solid cover shared by shots and the capsule motor; lifecycle belongs to the room's ability engine. */
export function createAbilityBarrier(physics: GamePhysics, frame: AbilityBarrierFrame): { handle: number; dispose(): void } {
  const { R, world } = physics;
  const desc = R.ColliderDesc.cuboid(frame.width / 2, frame.height / 2, frame.depth / 2)
    .setTranslation(frame.center.x, frame.center.y, frame.center.z)
    .setRotation(quatFromBasis(frame.side, frame.up, frame.forward))
    .setCollisionGroups(groups(Group.BARRIER, 0xffff));
  const collider = world.createCollider(desc);
  physics.barrierHandles.add(collider.handle);
  refreshQueries(physics);
  let disposed = false;
  return {
    handle: collider.handle,
    dispose() {
      if (disposed) return;
      disposed = true;
      const current = world.getCollider(collider.handle);
      if (current) world.removeCollider(current, false);
      physics.barrierHandles.delete(collider.handle);
      refreshQueries(physics);
    },
  };
}
