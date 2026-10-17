/**
 * World layout: resolves authored structures and deterministic scatter into placements with a local frame and
 * collider primitives. Client builds visuals from the same placements; the server builds only the colliders.
 * Local frame convention: X = side (up × forward), Y = local up, Z = forward.
 */
import { MATCH_SPAWNS, PLANET, SCATTER, SPAWNS, SPAWN_CLEAR_DEG, STRUCTURES, type StructureKind } from '@graao/game-data';
import { v3, v3angle, v3cross, v3normalize, v3rotateAxis, type Vec3 } from '@graao/shared';
import { mulberry32 } from './rng';
import { headingTangent, latLonToDir } from './sphere';
import type { Terrain } from './terrain';

export type ColliderPrimitive =
  | { type: 'cuboid'; hx: number; hy: number; hz: number; x: number; y: number; z: number }
  | { type: 'cylinder'; r: number; hh: number; x: number; y: number; z: number }
  | { type: 'ball'; r: number; x: number; y: number; z: number }
  | { type: 'hull'; points: number[] };

export type PlacementKind = StructureKind | 'tree' | 'pine' | 'rock' | 'bush' | 'grass' | 'flower';

export interface Placement {
  id: number;
  kind: PlacementKind;
  variant: number;
  scale: number;
  /** Base point in world space (on the terrain, or lifted for floating pieces). */
  position: Vec3;
  up: Vec3;
  forward: Vec3;
  side: Vec3;
  colliders: ColliderPrimitive[];
  /** Approximate bounding sphere radius (m) for culling and camera obstruction. */
  radius: number;
  /** Height of the bounding sphere center above the base. */
  centerHeight: number;
  visualOnly: boolean;
  /** Per-placement random seed for visual variation. */
  seed: number;
}

export interface HouseDims {
  w: number;
  d: number;
  h: number;
  roofH: number;
  overhang: number;
}

export const HOUSE_VARIANTS: HouseDims[] = [
  { w: 5.2, d: 4.4, h: 3.4, roofH: 2.0, overhang: 0.35 },
  { w: 4.4, d: 4.0, h: 5.4, roofH: 1.8, overhang: 0.3 },
  { w: 6.4, d: 3.8, h: 3.0, roofH: 1.7, overhang: 0.35 },
];

/** Shared dimensions of the authored structures (visual builders read these too). */
export const STRUCTURE_DIMS = {
  tower: { radius: 3.2, height: 12, domeRadius: 3.6 },
  giantTree: { trunkRadius: 2.1, trunkHeight: 17 },
  arch: { span: 4.6, pillar: 0.9, height: 5.0, lintel: 1.0 },
  lamp: { height: 3.3 },
  well: { radius: 1.05, height: 0.9 },
  wall: { length: 8, height: 1.5, thickness: 0.6 },
  shard: { radius: 5, depth: 7 },
} as const;

function structureColliders(kind: StructureKind, variant: number, s: number): { colliders: ColliderPrimitive[]; radius: number; centerHeight: number } {
  switch (kind) {
    case 'house': {
      const v = HOUSE_VARIANTS[variant % HOUSE_VARIANTS.length]!;
      const o = v.overhang;
      const hw = v.w / 2 + o;
      const hd = v.d / 2 + o;
      return {
        colliders: [
          { type: 'cuboid', hx: v.w / 2, hy: (v.h + 1.2) / 2, hz: v.d / 2, x: 0, y: (v.h - 1.2) / 2, z: 0 },
          { type: 'hull', points: [-hw, v.h, -hd, hw, v.h, -hd, -hw, v.h, hd, hw, v.h, hd, -hw, v.h + v.roofH, 0, hw, v.h + v.roofH, 0] },
        ],
        radius: Math.hypot(hw, hd, (v.h + v.roofH) / 2),
        centerHeight: (v.h + v.roofH) / 2,
      };
    }
    case 'tower': {
      const t = STRUCTURE_DIMS.tower;
      return {
        colliders: [
          { type: 'cylinder', r: t.radius, hh: (t.height + 1) / 2, x: 0, y: (t.height - 1) / 2, z: 0 },
          { type: 'ball', r: t.domeRadius, x: 0, y: t.height, z: 0 },
        ],
        radius: t.height / 2 + t.domeRadius,
        centerHeight: t.height / 2 + 1,
      };
    }
    case 'giant_tree': {
      const g = STRUCTURE_DIMS.giantTree;
      return {
        colliders: [{ type: 'cylinder', r: g.trunkRadius * s, hh: (g.trunkHeight * s + 1) / 2, x: 0, y: (g.trunkHeight * s - 1) / 2, z: 0 }],
        radius: 16 * s,
        centerHeight: 17 * s,
      };
    }
    case 'arch': {
      const a = STRUCTURE_DIMS.arch;
      const hp = a.pillar / 2;
      const px = a.span / 2 + hp;
      return {
        colliders: [
          { type: 'cuboid', hx: hp, hy: a.height / 2 + 0.5, hz: hp, x: -px, y: a.height / 2 - 0.5, z: 0 },
          { type: 'cuboid', hx: hp, hy: a.height / 2 + 0.5, hz: hp, x: px, y: a.height / 2 - 0.5, z: 0 },
          { type: 'cuboid', hx: px + hp + 0.3, hy: a.lintel / 2, hz: hp + 0.1, x: 0, y: a.height + a.lintel / 2, z: 0 },
        ],
        radius: px + 1.5,
        centerHeight: a.height / 2 + 0.5,
      };
    }
    case 'crystal_cluster':
      return {
        colliders: [
          { type: 'ball', r: 1.3 * s, x: 0, y: 0.5 * s, z: 0 },
          { type: 'cylinder', r: 0.55 * s, hh: 1.8 * s, x: 0.2 * s, y: 2.2 * s, z: -0.1 * s },
        ],
        radius: 3.2 * s,
        centerHeight: 2 * s,
      };
    case 'floating_shard': {
      const sh = STRUCTURE_DIMS.shard;
      const pts: number[] = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        pts.push(Math.cos(a) * sh.radius * s, 0, Math.sin(a) * sh.radius * s);
        pts.push(Math.cos(a) * sh.radius * 0.6 * s, -sh.depth * 0.45 * s, Math.sin(a) * sh.radius * 0.6 * s);
      }
      pts.push(0, -sh.depth * s, 0);
      return { colliders: [{ type: 'hull', points: pts }], radius: sh.radius * s + 3, centerHeight: -1 };
    }
    case 'lamp':
      return { colliders: [{ type: 'cylinder', r: 0.1, hh: 1.75, x: 0, y: 1.55, z: 0 }], radius: 1.8, centerHeight: 1.7 };
    case 'well': {
      const w = STRUCTURE_DIMS.well;
      return { colliders: [{ type: 'cylinder', r: w.radius, hh: 0.75, x: 0, y: w.height - 0.75, z: 0 }], radius: 1.6, centerHeight: 0.8 };
    }
    case 'wall': {
      const w = STRUCTURE_DIMS.wall;
      return {
        colliders: [{ type: 'cuboid', hx: (w.length * s) / 2, hy: (w.height + 0.8) / 2, hz: w.thickness / 2, x: 0, y: (w.height - 0.8) / 2, z: 0 }],
        radius: (w.length * s) / 2 + 0.5,
        centerHeight: w.height / 2,
      };
    }
  }
}

function scatterColliders(kind: PlacementKind, s: number): { colliders: ColliderPrimitive[]; radius: number; centerHeight: number } {
  switch (kind) {
    case 'tree':
      return { colliders: [{ type: 'cylinder', r: 0.24 * s, hh: 1.5 * s + 0.4, x: 0, y: 1.1 * s, z: 0 }], radius: 2.6 * s, centerHeight: 3.0 * s };
    case 'pine':
      return { colliders: [{ type: 'cylinder', r: 0.22 * s, hh: 1.3 * s + 0.4, x: 0, y: 0.9 * s, z: 0 }], radius: 2.3 * s, centerHeight: 2.8 * s };
    case 'rock':
      return { colliders: [{ type: 'ball', r: 0.78 * s, x: 0, y: 0.18 * s, z: 0 }], radius: 0.95 * s, centerHeight: 0.3 * s };
    case 'bush':
      return { colliders: [], radius: 0.9 * s, centerHeight: 0.45 * s };
    default:
      return { colliders: [], radius: 0.4 * s, centerHeight: 0.2 * s };
  }
}

export interface WorldLayout {
  placements: Placement[];
  structures: Placement[];
}

export interface LayoutOptions {
  /** Include client-only decoration (grass, flowers, bushes). */
  includeVisual: boolean;
}

export function buildLayout(terrain: Terrain, opts: LayoutOptions): WorldLayout {
  const R = PLANET.radius;
  const placements: Placement[] = [];
  let nextId = 1;

  const frame = (dir: Vec3, yawDeg: number) => {
    const up = v3normalize(dir);
    const forward = headingTangent(up, yawDeg);
    const side = v3normalize(v3cross(up, forward));
    return { up, forward, side };
  };

  // Authored structures.
  const structures: Placement[] = [];
  for (const sp of STRUCTURES) {
    const dir = latLonToDir(sp.lat, sp.lon);
    const s = sp.scale ?? 1;
    const h = terrain.heightAt(dir) + (sp.lift ?? 0);
    const { up, forward, side } = frame(dir, sp.yaw);
    const c = structureColliders(sp.kind, sp.variant ?? 0, s);
    const p: Placement = {
      id: nextId++,
      kind: sp.kind,
      variant: sp.variant ?? 0,
      scale: s,
      position: { x: up.x * (R + h), y: up.y * (R + h), z: up.z * (R + h) },
      up,
      forward,
      side,
      colliders: c.colliders,
      radius: c.radius,
      centerHeight: c.centerHeight,
      visualOnly: false,
      seed: (nextId * 2654435761) >>> 0,
    };
    structures.push(p);
    placements.push(p);
  }

  const clear = STRUCTURES.map((sp) => ({ dir: latLonToDir(sp.lat, sp.lon), rad: ((sp.clearDeg ?? 2) * Math.PI) / 180 }));
  // Spawn points stay free of rocks and trees so nobody starts inside a collider.
  for (const sp of [...SPAWNS, ...MATCH_SPAWNS]) clear.push({ dir: latLonToDir(sp.lat, sp.lon), rad: (SPAWN_CLEAR_DEG * Math.PI) / 180 });
  const villageCenter = latLonToDir(8, 0);
  const solid: { dir: Vec3; r: number }[] = [];

  for (const rule of SCATTER) {
    if (rule.visualOnly && !opts.includeVisual) continue;
    const rand = mulberry32(PLANET.seed ^ (rule.seed * 0x9e3779b1));
    let placed = 0;
    for (let attempt = 0; attempt < rule.count * 12 && placed < rule.count; attempt++) {
      // Uniform direction on the sphere.
      const z = rand() * 2 - 1;
      const phi = rand() * Math.PI * 2;
      const rr = Math.sqrt(1 - z * z);
      const dir = { x: rr * Math.cos(phi), y: z, z: rr * Math.sin(phi) };
      const yaw = rand() * 360;
      const sRand = rand();
      const vRand = rand();
      const h = terrain.heightAt(dir);
      if (h < PLANET.seaLevel + rule.minHeight) continue;
      // Decoration skips the (expensive) slope test; solid props must sit on walkable ground.
      if (!rule.visualOnly && terrain.slopeAt(dir) > rule.maxSlope) continue;
      if (rule.density && terrain.maskAt(dir, rule.density.frequency) < rule.density.threshold) continue;
      let blocked = false;
      for (const c of clear) {
        if (v3angle(dir, c.dir) < c.rad) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      const isSolid = !rule.visualOnly;
      if ((rule.kind === 'tree' || rule.kind === 'pine') && v3angle(dir, villageCenter) < (11 * Math.PI) / 180) continue;
      let scale: number;
      if (rule.kind === 'tree') scale = 0.8 + sRand * 0.6;
      else if (rule.kind === 'pine') scale = 0.75 + sRand * 0.7;
      else if (rule.kind === 'rock') scale = 0.5 + sRand * sRand * 2.0;
      else if (rule.kind === 'bush') scale = 0.6 + sRand * 0.8;
      else scale = 0.7 + sRand * 0.6;
      if (isSolid) {
        const minGap = rule.kind === 'rock' ? 1.6 * scale + 0.6 : 2.4;
        let near = false;
        for (const o of solid) {
          if (v3angle(dir, o.dir) * R < minGap + o.r) {
            near = true;
            break;
          }
        }
        if (near) continue;
        solid.push({ dir, r: rule.kind === 'rock' ? 0.8 * scale : 0.4 });
      }
      const { up, forward, side } = frame(dir, yaw);
      // Sink props slightly so they sit in the ground on slopes.
      const sink = rule.kind === 'rock' ? 0.25 * scale : rule.kind === 'grass' || rule.kind === 'flower' ? 0.02 : 0.15;
      const r = R + h - sink;
      const c = scatterColliders(rule.kind, scale);
      placements.push({
        id: nextId++,
        kind: rule.kind,
        variant: Math.floor(vRand * 3),
        scale,
        position: { x: up.x * r, y: up.y * r, z: up.z * r },
        up,
        forward,
        side,
        colliders: c.colliders,
        radius: c.radius,
        centerHeight: c.centerHeight,
        visualOnly: rule.visualOnly,
        seed: Math.floor(rand() * 0xffffffff),
      });
      placed++;
    }
  }

  return { placements, structures };
}

/** World position of a point given in a placement's local frame. */
export function placementToWorld(p: Placement, lx: number, ly: number, lz: number, out: Vec3 = v3()): Vec3 {
  out.x = p.position.x + p.side.x * lx + p.up.x * ly + p.forward.x * lz;
  out.y = p.position.y + p.side.y * lx + p.up.y * ly + p.forward.y * lz;
  out.z = p.position.z + p.side.z * lx + p.up.z * ly + p.forward.z * lz;
  return out;
}

/** Rotates a local direction by `angle` around the placement's up (for visual jitter). */
export function rotateAroundUp(p: Placement, v: Vec3, angle: number): Vec3 {
  return v3rotateAxis(v, p.up, angle);
}
