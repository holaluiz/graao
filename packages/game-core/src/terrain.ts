/**
 * Deterministic planet terrain: one height function `heightAt(dir)` (meters above PLANET.radius) used for the render
 * mesh, the Rapier collision trimesh and prop placement on both client and server.
 */
import { PLANET, TERRAIN_FEATURES, type TerrainFeature } from '@graao/game-data';
import { v3, v3angle, v3cross, v3dot, v3normalize, v3set, type Vec3 } from '@graao/shared';
import { createNoise3, fbm3, type Noise3 } from './noise';
import { latLonToDir } from './sphere';

const DEG = Math.PI / 180;

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
/** 1 at t=0 → 0 at t≥1, smooth (cosine). */
const bump = (t: number) => (t >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * Math.max(0, t)));

interface Segment {
  a: Vec3;
  b: Vec3;
  normal: Vec3;
  arc: number;
}

interface ResolvedFeature {
  f: TerrainFeature;
  center: Vec3;
  a?: Vec3;
  b?: Vec3;
  normal?: Vec3;
  arc?: number;
  /** Channels: the polyline's great-circle segments. */
  segs?: Segment[];
  /** Cosine of the largest angle from the center at which the feature has any effect (cheap early-out). */
  cosOuter: number;
}

export interface Terrain {
  readonly radius: number;
  readonly seaRadius: number;
  /** Height above `radius` at unit direction `dir`. */
  heightAt(dir: Vec3): number;
  /** World-space surface point at unit direction `dir`. */
  surfaceAt(dir: Vec3, out?: Vec3): Vec3;
  /** Unit surface normal at `dir` (finite differences on the height function). */
  normalAt(dir: Vec3, out?: Vec3): Vec3;
  /** Slope angle (radians) between the surface normal and local up. */
  slopeAt(dir: Vec3): number;
  /** Raw hill noise in [-1, 1] at a frequency, for scatter density masks. */
  maskAt(dir: Vec3, frequency: number): number;
}

export function createTerrain(): Terrain {
  const noise: Noise3 = createNoise3(PLANET.seed);
  const detail: Noise3 = createNoise3(PLANET.seed ^ 0x5bd1e995);
  const crest: Noise3 = createNoise3(PLANET.seed ^ 0x27d4eb2f);
  const R = PLANET.radius;

  const segment = (a: Vec3, b: Vec3): Segment => ({ a, b, normal: v3normalize(v3cross(a, b)), arc: v3angle(a, b) });
  const features: ResolvedFeature[] = TERRAIN_FEATURES.map((f) => {
    if (f.kind === 'fissure' || f.kind === 'ridge') {
      const a = latLonToDir(f.lat1, f.lon1);
      const b = latLonToDir(f.lat2, f.lon2);
      const normal = v3normalize(v3cross(a, b));
      const arc = v3angle(a, b);
      const reach = f.kind === 'fissure' ? f.widthDeg * 3.2 : f.widthDeg * 1.05;
      return { f, center: v3normalize({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }), a, b, normal, arc, cosOuter: Math.cos(arc / 2 + reach * DEG) };
    }
    if (f.kind === 'channel') {
      const pts = f.points.map(([lat, lon]) => latLonToDir(lat, lon));
      const segs = pts.slice(1).map((b, i) => segment(pts[i]!, b));
      const center = v3normalize(pts.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y, z: acc.z + p.z }), { x: 0, y: 0, z: 0 }));
      const far = Math.max(...pts.map((p) => v3angle(p, center)));
      return { f, center, segs, cosOuter: Math.cos(far + (f.widthDeg + f.bankDeg) * DEG * 1.05) };
    }
    const outer = f.kind === 'flatten' ? f.radiusDeg + f.falloffDeg : f.radiusDeg;
    return { f, center: latLonToDir(f.lat, f.lon), cosOuter: Math.cos(outer * DEG) };
  });

  /** Angular distance from `d` to the great-circle arc a→b. */
  const segDistance = (d: Vec3, s: { a: Vec3; b: Vec3; normal: Vec3; arc: number }): number => {
    const n = s.normal;
    const off = Math.asin(Math.max(-1, Math.min(1, v3dot(d, n))));
    // Is the projection of d inside the arc?
    const proj = v3normalize({ x: d.x - n.x * Math.sin(off), y: d.y - n.y * Math.sin(off), z: d.z - n.z * Math.sin(off) });
    const da = v3angle(proj, s.a);
    const db = v3angle(proj, s.b);
    if (da <= s.arc + 1e-6 && db <= s.arc + 1e-6) return Math.abs(off);
    return Math.min(v3angle(d, s.a), v3angle(d, s.b));
  };
  const arcDistance = (d: Vec3, rf: ResolvedFeature): number => segDistance(d, { a: rf.a!, b: rf.b!, normal: rf.normal!, arc: rf.arc! });

  const heightAt = (d: Vec3): number => {
    const fx = d.x * PLANET.hillFrequency;
    const fy = d.y * PLANET.hillFrequency;
    const fz = d.z * PLANET.hillFrequency;
    let h = PLANET.baseOffset + PLANET.hillAmplitude * fbm3(noise, fx + 11.3, fy - 4.1, fz + 7.7, 3);
    h += 0.32 * detail(d.x * 9.5, d.y * 9.5, d.z * 9.5);

    for (const rf of features) {
      const f = rf.f;
      const dc = d.x * rf.center.x + d.y * rf.center.y + d.z * rf.center.z;
      if (dc < rf.cosOuter) continue;
      if (f.kind === 'mound') {
        const t = Math.acos(Math.min(1, dc)) / (f.radiusDeg * DEG);
        if (t < 1) h += f.height * bump(t);
      } else if (f.kind === 'basin') {
        const t = Math.acos(Math.min(1, dc)) / (f.radiusDeg * DEG);
        if (t < 1) h -= f.depth * bump(t) * (0.75 + 0.25 * bump(t));
      } else if (f.kind === 'fissure') {
        const dist = arcDistance(d, rf) / (f.widthDeg * DEG);
        if (dist < 1) h -= f.depth * (1 - dist * dist);
        else if (dist < 3) h += f.rimHeight * bump(Math.abs(dist - 2));
      } else if (f.kind === 'ridge') {
        // Rounded crest with a jagged top (rocky outcrops every few metres).
        const dist = arcDistance(d, rf) / (f.widthDeg * DEG);
        if (dist < 1) {
          const b = bump(dist);
          h += f.height * b * (1 + 0.16 * b * crest(d.x * 26, d.y * 26, d.z * 26));
        }
      }
    }
    for (const rf of features) {
      const f = rf.f;
      if (f.kind !== 'flatten') continue;
      const dc = d.x * rf.center.x + d.y * rf.center.y + d.z * rf.center.z;
      if (dc < rf.cosOuter) continue;
      const a = Math.acos(Math.min(1, dc)) / DEG;
      const w = 1 - smoothstep(f.radiusDeg, f.radiusDeg + f.falloffDeg, a);
      if (w > 0) h = h + (f.height - h) * w;
    }
    // Channels last: they cut through the flattened squares and plateaus down to their floor.
    for (const rf of features) {
      const f = rf.f;
      if (f.kind !== 'channel') continue;
      const dc = d.x * rf.center.x + d.y * rf.center.y + d.z * rf.center.z;
      if (dc < rf.cosOuter || h <= f.floor) continue;
      let dist = Infinity;
      for (const sg of rf.segs!) dist = Math.min(dist, segDistance(d, sg));
      const t = dist / DEG;
      if (t >= f.widthDeg + f.bankDeg) continue;
      const k = t <= f.widthDeg ? 0 : smoothstep(f.widthDeg, f.widthDeg + f.bankDeg, t);
      h = Math.min(h, f.floor + (h - f.floor) * k);
    }
    return h;
  };

  const tmpA = v3();
  const tmpB = v3();
  const tmpT1 = v3();
  const tmpT2 = v3();

  const surfaceAt = (d: Vec3, out: Vec3 = v3()): Vec3 => {
    const r = R + heightAt(d);
    return v3set(out, d.x * r, d.y * r, d.z * r);
  };

  const normalAt = (d: Vec3, out: Vec3 = v3()): Vec3 => {
    // Two tangents around d, sample the surface, cross product.
    const ref = Math.abs(d.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    v3normalize(v3cross(ref, d, tmpT1), tmpT1);
    v3cross(d, tmpT1, tmpT2);
    const e = 0.004; // ≈ 0.4 m at R = 100
    const p0 = surfaceAt(d, v3());
    const p1 = surfaceAt(v3normalize({ x: d.x + tmpT1.x * e, y: d.y + tmpT1.y * e, z: d.z + tmpT1.z * e }, tmpA), tmpA);
    const p2 = surfaceAt(v3normalize({ x: d.x + tmpT2.x * e, y: d.y + tmpT2.y * e, z: d.z + tmpT2.z * e }, tmpB), tmpB);
    const n = v3cross(
      { x: p1.x - p0.x, y: p1.y - p0.y, z: p1.z - p0.z },
      { x: p2.x - p0.x, y: p2.y - p0.y, z: p2.z - p0.z },
      out,
    );
    v3normalize(n, n);
    if (v3dot(n, d) < 0) v3set(n, -n.x, -n.y, -n.z);
    return n;
  };

  return {
    radius: R,
    seaRadius: R + PLANET.seaLevel,
    heightAt,
    surfaceAt,
    normalAt,
    slopeAt: (d) => Math.acos(Math.max(-1, Math.min(1, v3dot(normalAt(d), d)))),
    maskAt: (d, f) => fbm3(noise, d.x * f - 31.7, d.y * f + 13.9, d.z * f + 5.3, 2),
  };
}

export interface TerrainMesh {
  /** xyz per vertex, world space (deduplicated across icosahedron faces). */
  positions: Float32Array;
  /** Smooth vertex normals accumulated over the whole sphere (no seams between chunks). */
  normals: Float32Array;
  /** Height above radius per vertex (for shading: shore, cliffs, peaks). */
  heights: Float32Array;
  indices: Uint32Array;
  /** Icosahedron face (0..19) of each triangle, used to split render chunks for frustum culling. */
  triangleFace: Uint8Array;
}

/** Geodesic icosphere at subdivision `frequency`, displaced by the terrain height function. */
export function buildTerrainMesh(terrain: Terrain, frequency: number = PLANET.terrainFrequency): TerrainMesh {
  const t = (1 + Math.sqrt(5)) / 2;
  const base: Vec3[] = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map(([x, y, z]) => v3normalize({ x: x!, y: y!, z: z! }));
  const faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];

  const F = frequency;
  const key = new Map<string, number>();
  const dirs: number[] = [];
  const index: number[] = [];
  const triFace: number[] = [];

  const vertexId = (d: Vec3): number => {
    const k = `${Math.round(d.x * 1e6)},${Math.round(d.y * 1e6)},${Math.round(d.z * 1e6)}`;
    let id = key.get(k);
    if (id === undefined) {
      id = dirs.length / 3;
      dirs.push(d.x, d.y, d.z);
      key.set(k, id);
    }
    return id;
  };

  for (let fi = 0; fi < faces.length; fi++) {
    const [ia, ib, ic] = faces[fi]!;
    const A = base[ia!]!;
    const B = base[ib!]!;
    const C = base[ic!]!;
    const grid: number[][] = [];
    for (let i = 0; i <= F; i++) {
      const row: number[] = [];
      for (let j = 0; j <= F - i; j++) {
        const wa = (F - i - j) / F;
        const wb = i / F;
        const wc = j / F;
        const d = v3normalize({
          x: A.x * wa + B.x * wb + C.x * wc,
          y: A.y * wa + B.y * wb + C.y * wc,
          z: A.z * wa + B.z * wb + C.z * wc,
        });
        row.push(vertexId(d));
      }
      grid.push(row);
    }
    for (let i = 0; i < F; i++) {
      for (let j = 0; j < F - i; j++) {
        const v0 = grid[i]![j]!;
        const v1 = grid[i + 1]![j]!;
        const v2 = grid[i]![j + 1]!;
        index.push(v0, v1, v2);
        triFace.push(fi);
        if (j < F - i - 1) {
          const v3i = grid[i + 1]![j + 1]!;
          index.push(v1, v3i, v2);
          triFace.push(fi);
        }
      }
    }
  }

  const n = dirs.length / 3;
  const positions = new Float32Array(n * 3);
  const heights = new Float32Array(n);
  const d = v3();
  for (let i = 0; i < n; i++) {
    v3set(d, dirs[i * 3]!, dirs[i * 3 + 1]!, dirs[i * 3 + 2]!);
    const h = terrain.heightAt(d);
    heights[i] = h;
    const r = terrain.radius + h;
    positions[i * 3] = d.x * r;
    positions[i * 3 + 1] = d.y * r;
    positions[i * 3 + 2] = d.z * r;
  }

  // Ensure outward winding, then accumulate area-weighted normals.
  const normals = new Float32Array(n * 3);
  const indices = new Uint32Array(index);
  for (let tIdx = 0; tIdx < indices.length; tIdx += 3) {
    const a = indices[tIdx]!;
    const b = indices[tIdx + 1]!;
    const c = indices[tIdx + 2]!;
    const ax = positions[a * 3]!, ay = positions[a * 3 + 1]!, az = positions[a * 3 + 2]!;
    const e1x = positions[b * 3]! - ax, e1y = positions[b * 3 + 1]! - ay, e1z = positions[b * 3 + 2]! - az;
    const e2x = positions[c * 3]! - ax, e2y = positions[c * 3 + 1]! - ay, e2z = positions[c * 3 + 2]! - az;
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    if (nx * ax + ny * ay + nz * az < 0) {
      indices[tIdx + 1] = c;
      indices[tIdx + 2] = b;
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    for (const v of [a, b, c]) {
      normals[v * 3] = normals[v * 3]! + nx;
      normals[v * 3 + 1] = normals[v * 3 + 1]! + ny;
      normals[v * 3 + 2] = normals[v * 3 + 2]! + nz;
    }
  }
  for (let i = 0; i < n; i++) {
    const x = normals[i * 3]!, y = normals[i * 3 + 1]!, z = normals[i * 3 + 2]!;
    const l = Math.hypot(x, y, z) || 1;
    normals[i * 3] = x / l;
    normals[i * 3 + 1] = y / l;
    normals[i * 3 + 2] = z / l;
  }

  return { positions, normals, heights, indices, triangleFace: new Uint8Array(triFace) };
}
