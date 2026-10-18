/**
 * World layout: resolves the versioned map file (classic structures, kit prefabs and kit buildings: game-data
 * world/map.ts) and deterministic scatter into placements with a local frame and collider primitives. Client builds
 * visuals from the same placements; the server builds only the colliders.
 * Local frame convention: X = side (up × forward), Y = local up, Z = forward.
 */
import { GRAAO_MAP, KIT, KIT_PREFABS, MATCH_SPAWNS, PLANET, REGIONS, SCATTER, SPAWNS, SPAWN_CLEAR_DEG, resolvePrefab, type Biome, type GraaoMap, type KitBuilding, type KitPart, type KitPiece, type KitPrefab, type MapPlacement, type ScatterKind, type StructureKind } from '@graao/game-data';
import { v3, v3angle, v3cross, v3dot, v3normalize, v3rotateAxis, type Vec3 } from '@graao/shared';
import { mulberry32 } from './rng';
import { headingTangent, latLonToDir } from './sphere';
import type { Terrain } from './terrain';

/**
 * A collider in a placement's frame. `q` is an optional local rotation (x, y, z, w) composed after the placement's
 * own; `block: 'move'` colliders stop characters but not shots or sight (railings, fences: physics Group.RAIL).
 */
export type ColliderPrimitive =
  | { type: 'cuboid'; hx: number; hy: number; hz: number; x: number; y: number; z: number; q?: Quat; block?: 'move' }
  | { type: 'cylinder'; r: number; hh: number; x: number; y: number; z: number; q?: Quat; block?: 'move' }
  | { type: 'cone'; r: number; hh: number; x: number; y: number; z: number; q?: Quat; block?: 'move' }
  | { type: 'ball'; r: number; x: number; y: number; z: number; block?: 'move' }
  | { type: 'hull'; points: number[]; block?: 'move' };

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export type PlacementKind = StructureKind | 'kit' | ScatterKind;

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
  /** Kit pieces: the prefab id (KIT_PREFABS). */
  prefab?: string;
  /** Map placement this came from (a building's pieces share their building's id). */
  mapId?: string;
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

const DEG = Math.PI / 180;

/** Quaternion of a three.js Euler (degrees, order 'XYZ'): the client draws kit parts with the same rotation. */
export function quatFromEulerDeg(rx = 0, ry = 0, rz = 0): Quat {
  const c1 = Math.cos((rx * DEG) / 2), s1 = Math.sin((rx * DEG) / 2);
  const c2 = Math.cos((ry * DEG) / 2), s2 = Math.sin((ry * DEG) / 2);
  const c3 = Math.cos((rz * DEG) / 2), s3 = Math.sin((rz * DEG) / 2);
  return { x: s1 * c2 * c3 + c1 * s2 * s3, y: c1 * s2 * c3 - s1 * c2 * s3, z: c1 * c2 * s3 + s1 * s2 * c3, w: c1 * c2 * c3 - s1 * s2 * s3 };
}

/** Rotates (x, y, z) by unit quaternion q. */
export function quatRotate(q: Quat, x: number, y: number, z: number): [number, number, number] {
  const tx = 2 * (q.y * z - q.z * y);
  const ty = 2 * (q.z * x - q.x * z);
  const tz = 2 * (q.x * y - q.y * x);
  return [x + q.w * tx + (q.y * tz - q.z * ty), y + q.w * ty + (q.z * tx - q.x * tz), z + q.w * tz + (q.x * ty - q.y * tx)];
}

const hasRotation = (p: KitPart) => !!(p.rx || p.ry || p.rz);

/** Collider of one kit part at scale `s` (null for decoration). */
function kitPartCollider(p: KitPart, s: number): ColliderPrimitive | null {
  if ((p.solid ?? 'full') === 'none') return null;
  const block = p.solid === 'move' ? { block: 'move' as const } : {};
  const q = hasRotation(p) ? { q: quatFromEulerDeg(p.rx, p.ry, p.rz) } : {};
  switch (p.shape) {
    case 'box':
      return { type: 'cuboid', hx: p.hx * s, hy: p.hy * s, hz: p.hz * s, x: p.x * s, y: p.y * s, z: p.z * s, ...q, ...block };
    case 'cyl':
      return { type: 'cylinder', r: p.hx * s, hh: p.hy * s, x: p.x * s, y: p.y * s, z: p.z * s, ...q, ...block };
    case 'cone':
      return { type: 'cone', r: p.hx * s, hh: p.hy * s, x: p.x * s, y: p.y * s, z: p.z * s, ...q, ...block };
    case 'ball':
      return { type: 'ball', r: p.hx * s, x: p.x * s, y: p.y * s, z: p.z * s, ...block };
    case 'gable': {
      // Triangular prism: base on y = 0 from z = −hz to +hz, apex at y = hy, thickness 2·hx (in the part's frame).
      const rot = quatFromEulerDeg(p.rx, p.ry, p.rz);
      const pts: number[] = [];
      for (const sx of [-1, 1]) {
        for (const [y, z] of [[0, -p.hz], [0, p.hz], [p.hy, 0]] as const) {
          const [a, b, c] = quatRotate(rot, sx * p.hx, y, z);
          pts.push((p.x + a) * s, (p.y + b) * s, (p.z + c) * s);
        }
      }
      return { type: 'hull', points: pts, ...block };
    }
    case 'hip': {
      // Hipped roof: the base rectangle and a ridge along X (45 degree hips in plan; a square base makes a pyramid).
      const rot = quatFromEulerDeg(p.rx, p.ry, p.rz);
      const rx = Math.max(0.02, p.hx - p.hz);
      const pts: number[] = [];
      for (const [x, y, z] of [[-p.hx, 0, -p.hz], [p.hx, 0, -p.hz], [-p.hx, 0, p.hz], [p.hx, 0, p.hz], [-rx, p.hy, 0], [rx, p.hy, 0]] as const) {
        const [a, b, c] = quatRotate(rot, x, y, z);
        pts.push((p.x + a) * s, (p.y + b) * s, (p.z + c) * s);
      }
      return { type: 'hull', points: pts, ...block };
    }
  }
}

interface KitShape {
  colliders: ColliderPrimitive[];
  /** Anchor points (grapple targets) in the prefab frame. */
  anchors: [number, number, number][];
  /** Bounding sphere radius around (0, centerHeight, 0). */
  radius: number;
  centerHeight: number;
  /** Horizontal reach from the base point (m): the scatter keep-out. */
  footprint: number;
}

/** Colliders and bounds of a kit prefab at scale `s` (rotated parts are bounded by their half-diagonal). */
export function kitShape(prefab: KitPrefab, s = 1): KitShape {
  const colliders: ColliderPrimitive[] = [];
  const anchors: [number, number, number][] = [];
  let minY = Infinity, maxY = -Infinity, reach = 0;
  for (const p of prefab.parts) {
    const c = kitPartCollider(p, s);
    if (c) colliders.push(c);
    if (p.anchor) anchors.push([p.x * s, p.y * s, p.z * s]);
    const based = p.shape === 'gable' || p.shape === 'hip';
    const ext = p.shape === 'ball' ? p.hx : hasRotation(p) || based ? Math.hypot(p.hx, p.hy, p.hz) : 0;
    const ex = ext || p.hx, ez = ext || p.hz, ey = ext || p.hy;
    const y0 = based && !hasRotation(p) ? p.y : p.y - ey;
    const y1 = based && !hasRotation(p) ? p.y + p.hy : p.y + ey;
    minY = Math.min(minY, y0 * s);
    maxY = Math.max(maxY, y1 * s);
    reach = Math.max(reach, Math.hypot(Math.abs(p.x) + ex, Math.abs(p.z) + ez) * s);
  }
  const centerHeight = (minY + maxY) / 2;
  return { colliders, anchors, centerHeight, radius: Math.hypot(reach, (maxY - minY) / 2), footprint: reach };
}

function scatterColliders(kind: PlacementKind, s: number): { colliders: ColliderPrimitive[]; radius: number; centerHeight: number } {
  switch (kind) {
    case 'tree':
      return { colliders: [{ type: 'cylinder', r: 0.24 * s, hh: 1.5 * s + 0.4, x: 0, y: 1.1 * s, z: 0 }], radius: 2.6 * s, centerHeight: 3.0 * s };
    case 'pine':
      return { colliders: [{ type: 'cylinder', r: 0.22 * s, hh: 1.3 * s + 0.4, x: 0, y: 0.9 * s, z: 0 }], radius: 2.3 * s, centerHeight: 2.8 * s };
    case 'rock':
      return { colliders: [{ type: 'ball', r: 0.78 * s, x: 0, y: 0.18 * s, z: 0 }], radius: 0.95 * s, centerHeight: 0.3 * s };
    case 'cerrado':
      return { colliders: [{ type: 'cylinder', r: 0.2 * s, hh: 0.9 * s + 0.4, x: 0, y: 0.6 * s, z: 0 }], radius: 2.0 * s, centerHeight: 1.9 * s };
    case 'ipe':
      return { colliders: [{ type: 'cylinder', r: 0.22 * s, hh: 1.6 * s + 0.4, x: 0, y: 1.2 * s, z: 0 }], radius: 2.4 * s, centerHeight: 3.4 * s };
    case 'palm':
      return { colliders: [{ type: 'cylinder', r: 0.2 * s, hh: 2.6 * s + 0.4, x: 0, y: 2.2 * s, z: 0 }], radius: 2.0 * s, centerHeight: 4.0 * s };
    case 'bush':
      return { colliders: [], radius: 0.9 * s, centerHeight: 0.45 * s };
    default:
      return { colliders: [], radius: 0.4 * s, centerHeight: 0.2 * s };
  }
}

export interface WorldLayout {
  placements: Placement[];
  structures: Placement[];
  /** Grapple / anchor points (world space) from kit parts marked `anchor` (clotheslines, arches, lanterns). */
  anchors: Vec3[];
}

// ------------------------------------------------------------------------------------------------ biomes

/**
 * Biome under a direction: the region it belongs to (the closest whose `radiusDeg` contains it), or the open
 * country ('campo') between them. Scatter rules read it so each landscape keeps its own vegetation.
 */
export function biomeAt(dir: Vec3): Biome {
  let best: Biome = 'campo';
  let bestT = Infinity;
  for (const r of REGIONS) {
    if (!r.biome) continue;
    const t = v3angle(dir, latLonToDir(r.lat, r.lon)) / (r.radiusDeg * DEG);
    if (t < 1 && t < bestT) {
      bestT = t;
      best = r.biome;
    }
  }
  return best;
}

/** Inside the built-up core of a region (its `builtDeg`): no wild trees or rocks there, the streets stay clear. */
export function insideBuiltCore(dir: Vec3): boolean {
  for (const r of REGIONS) if (r.builtDeg && v3angle(dir, latLonToDir(r.lat, r.lon)) < r.builtDeg * DEG) return true;
  return false;
}

// ------------------------------------------------------------------------------------------------ buildings on slopes

export interface BuildingSite {
  /** How far the base was lifted above the ground under the placement point (m). */
  raise: number;
  /** Ground under the footprint, relative to the lifted base: lowest and highest (m, at most 0 under the floor). */
  low: number;
  high: number;
  /** Pieces the slope asks for: the stone base (embasamento) and door steps (soleiras). */
  extra: KitPiece[];
  /** Problems an author should look at (a base deeper than the deepest plinth, a door too high for steps). */
  warnings: string[];
}

/**
 * How a building sits on the terrain: with `settle: 'max'` (default) it is lifted to the highest ground under its
 * foundation, so nothing pokes through the floor; where the ground falls away more than the foundation covers, a stone
 * base of the right depth goes under it, and every door the ground drops away from gets steps down to it. Shared by
 * the layout (client and server) and the map authoring tools.
 */
export function buildingSite(terrain: Terrain, b: KitBuilding, mp: Pick<MapPlacement, 'lat' | 'lon' | 'yaw' | 'lift' | 'settle'>): BuildingSite {
  const R = PLANET.radius;
  const dir = latLonToDir(mp.lat, mp.lon);
  const up = v3normalize(dir);
  const forward = headingTangent(up, mp.yaw);
  const side = v3normalize(v3cross(up, forward));
  const h0 = terrain.heightAt(dir) + (mp.lift ?? 0);
  const base = { x: up.x * (R + h0), y: up.y * (R + h0), z: up.z * (R + h0) };
  /** Ground height under local (x, z), measured along the building's up from the unlifted base. */
  const groundAt = (x: number, z: number): number => {
    const q = { x: base.x + side.x * x + forward.x * z, y: base.y + side.y * x + forward.y * z, z: base.z + side.z * x + forward.z * z };
    const g = terrain.surfaceAt(v3normalize(q));
    return v3dot({ x: g.x - base.x, y: g.y - base.y, z: g.z - base.z }, up);
  };
  const f = b.foundation ?? { x: 0, z: 0, w: b.halfX * 2, d: b.halfZ * 2 };
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i <= 4; i++) {
    for (let k = 0; k <= 4; k++) {
      const g = groundAt(f.x + (i / 4 - 0.5) * (f.w - 0.2), f.z + (k / 4 - 0.5) * (f.d - 0.2));
      lo = Math.min(lo, g);
      hi = Math.max(hi, g);
    }
  }
  const settle = mp.settle ?? b.settle ?? 'max';
  const raise = settle === 'max' ? Math.max(0, hi) : 0;
  const extra: KitPiece[] = [];
  const warnings: string[] = [];
  const drop = raise - lo;
  if (b.foundation && drop > KIT.foundation - 0.15) {
    const depth = KIT.plinthDepths.find((d) => d >= drop + 0.25) ?? KIT.plinthDepths[KIT.plinthDepths.length - 1]!;
    if (depth < drop + 0.1) warnings.push(`${b.id}: chão cai ${drop.toFixed(2)} m, mais que o embasamento de ${depth} m`);
    const id = `embasamento-${f.w}x${f.d}-${Math.round(depth * 10)}`;
    if (KIT_PREFABS[id]) extra.push({ prefab: id, x: f.x, z: f.z });
    else warnings.push(`${b.id}: sem embasamento ${id}`);
  }
  for (const d of b.doors ?? []) {
    const a = d.yaw * DEG;
    // Outward direction of the door in the building frame (yaw 0: +Z, 90: -X, 180: -Z, 270: +X).
    const ox = -Math.sin(a);
    const oz = Math.cos(a);
    const out = groundAt(d.x + ox * 0.75, d.z + oz * 0.75);
    const step = raise + KIT.floorTop - out;
    if (step <= 0.3) continue;
    const n = Math.min(KIT.stoop.maxSteps, Math.max(1, Math.round(step / KIT.stoop.rise)));
    if (step > KIT.stoop.maxSteps * KIT.stoop.rise + 0.25) warnings.push(`${b.id}: porta em (${d.x}, ${d.z}) a ${step.toFixed(2)} m do chão`);
    extra.push({ prefab: `soleira-${n}`, x: d.x, y: KIT.floorTop, z: d.z, yaw: d.yaw });
  }
  return { raise, low: lo - raise, high: hi - raise, extra, warnings };
}


export interface LayoutOptions {
  /** Include client-only decoration (grass, flowers, bushes). */
  includeVisual: boolean;
}

export function buildLayout(terrain: Terrain, opts: LayoutOptions, map: GraaoMap = GRAAO_MAP): WorldLayout {
  const R = PLANET.radius;
  const placements: Placement[] = [];
  let nextId = 1;

  const frame = (dir: Vec3, yawDeg: number) => {
    const up = v3normalize(dir);
    const forward = headingTangent(up, yawDeg);
    const side = v3normalize(v3cross(up, forward));
    return { up, forward, side };
  };
  /** Scatter keep-out circles (direction, angular radius). */
  const clear: { dir: Vec3; rad: number }[] = [];
  const anchors: Vec3[] = [];

  // Authored map: classic structures, kit prefabs and kit buildings (one placement per piece).
  const structures: Placement[] = [];
  const pushKit = (prefab: KitPrefab, mapId: string, position: Vec3, up: Vec3, forward: Vec3, s: number, variant: number) => {
    const shape = kitShape(prefab, s);
    const side = v3normalize(v3cross(up, forward));
    const id = nextId++;
    clear.push({ dir: v3normalize(position), rad: (shape.footprint + 0.4) / R });
    for (const [ax, ay, az] of shape.anchors) anchors.push({ x: position.x + side.x * ax + up.x * ay + forward.x * az, y: position.y + side.y * ax + up.y * ay + forward.y * az, z: position.z + side.z * ax + up.z * ay + forward.z * az });
    // Decoration without colliders (street tiles, lantern strings) is client-only, like grass; ids stay in step.
    if (!shape.colliders.length && !opts.includeVisual) return;
    const p: Placement = {
      id,
      kind: 'kit',
      variant,
      scale: s,
      position,
      up,
      forward,
      side,
      colliders: shape.colliders,
      radius: shape.radius,
      centerHeight: shape.centerHeight,
      visualOnly: shape.colliders.length === 0,
      seed: (id * 2654435761) >>> 0,
      prefab: prefab.id,
      mapId,
    };
    structures.push(p);
    placements.push(p);
  };
  for (const mp of map.placements) {
    const ref = resolvePrefab(mp.prefab);
    if (!ref) throw new Error(`map: unknown prefab ${mp.prefab} (${mp.id})`);
    const dir = latLonToDir(mp.lat, mp.lon);
    const s = mp.scale ?? 1;
    const h = terrain.heightAt(dir) + (mp.lift ?? 0);
    const { up, forward, side } = frame(dir, mp.yaw);
    const base = { x: up.x * (R + h), y: up.y * (R + h), z: up.z * (R + h) };
    if (ref.type === 'structure') {
      const c = structureColliders(ref.kind, mp.variant ?? 0, s);
      const p: Placement = {
        id: nextId++,
        kind: ref.kind,
        variant: mp.variant ?? 0,
        scale: s,
        position: base,
        up,
        forward,
        side,
        colliders: c.colliders,
        radius: c.radius,
        centerHeight: c.centerHeight,
        visualOnly: false,
        seed: (nextId * 2654435761) >>> 0,
        mapId: mp.id,
      };
      structures.push(p);
      placements.push(p);
      clear.push({ dir, rad: (mp.clearDeg ?? ref.clearDeg) * DEG });
    } else if (ref.type === 'kit') {
      if (ref.prefab.alignToGround) {
        // Street tiles lean with the slope: up is the terrain normal, the front its projection.
        const n = terrain.normalAt(dir);
        const f = v3normalize(v3cross(v3cross(n, forward), n));
        pushKit(ref.prefab, mp.id, base, n, f, s, mp.variant ?? 0);
      } else pushKit(ref.prefab, mp.id, base, up, forward, s, mp.variant ?? 0);
    } else {
      // A building is rigid in its own tangent frame: every piece shares the building's up. On a slope it is lifted
      // to the highest ground under it, with a stone base and door steps where the ground falls away.
      const site = buildingSite(terrain, ref.building, mp);
      for (const piece of [...ref.building.pieces, ...site.extra]) {
        const prefab = KIT_PREFABS[piece.prefab];
        if (!prefab) throw new Error(`kit: building ${ref.building.id} uses unknown prefab ${piece.prefab}`);
        const y = (piece.y ?? 0) + site.raise;
        const pos = {
          x: base.x + side.x * piece.x + up.x * y + forward.x * piece.z,
          y: base.y + side.y * piece.x + up.y * y + forward.y * piece.z,
          z: base.z + side.z * piece.x + up.z * y + forward.z * piece.z,
        };
        const f = piece.yaw ? v3normalize(v3rotateAxis(forward, up, -(piece.yaw * DEG))) : forward;
        pushKit(prefab, mp.id, pos, up, f, 1, 0);
      }
    }
  }

  // Spawn points stay free of rocks and trees so nobody starts inside a collider.
  for (const sp of [...SPAWNS, ...MATCH_SPAWNS]) clear.push({ dir: latLonToDir(sp.lat, sp.lon), rad: (SPAWN_CLEAR_DEG * Math.PI) / 180 });
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
      // Each landscape keeps its own plants (rule.biomes: acceptance per biome); built-up cores keep their streets
      // clear of wild trees and rocks.
      if (rule.biomes) {
        const keep = rule.biomes[biomeAt(dir)] ?? 0;
        if (keep <= 0 || (keep < 1 && vRand * 7.31 % 1 > keep)) continue;
      }
      if (isSolid && insideBuiltCore(dir)) continue;
      let scale: number;
      if (rule.kind === 'tree') scale = 0.8 + sRand * 0.6;
      else if (rule.kind === 'pine') scale = 0.75 + sRand * 0.7;
      else if (rule.kind === 'cerrado') scale = 0.8 + sRand * 0.5;
      else if (rule.kind === 'ipe') scale = 0.85 + sRand * 0.4;
      else if (rule.kind === 'palm') scale = 0.85 + sRand * 0.35;
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
      const sink = rule.kind === 'rock' ? 0.25 * scale : rule.kind === 'grass' || rule.kind === 'flower' || rule.kind === 'capim' ? 0.02 : 0.15;
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

  return { placements, structures, anchors };
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
