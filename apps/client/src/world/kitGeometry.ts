/**
 * Geometry of the world kit (game-data world/kit.ts): each prefab's visible parts merged into one BufferGeometry in
 * the prefab frame (X side, Y up, Z forward) with flat colours, rotated by the same quaternion the colliders use
 * (game-core quatFromEulerDeg), so the drawn wall is the wall that stops you.
 *
 * Placed pieces are baked into a few static meshes (one per cell of the planet, for frustum culling): a whole village
 * costs a few draw calls (plus the shadow pass) instead of one per prefab. Each piece keeps its own range of vertices
 * in a per-vertex `instanceFade` attribute, which the stylized material reads like the instanced props' fade, so the
 * camera dissolve still works piece by piece. Small decoration (frames, sills, shutters, little props: see isNearPart)
 * carries `aLod` = 1 and the kit material folds it away beyond ~45 m — detail up close, simple masses far away,
 * without extra draw calls. Water pieces (fountains, falls, streams) go to their own meshes with the water material.
 *
 * Rock (the vertical kit): a box with `relief` is drawn broken into facets a few centimetres off its collider, a `hull`
 * part is drawn from the same points the collider is built from, and either may be banded in strata (`bands`).
 */
import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { KIT_PALETTE, KIT_PREFABS, type KitPart } from '@graao/game-data';
import { quatFromEulerDeg, type Placement } from '@graao/game-core';

type Geo = THREE.BufferGeometry;

/** A stable hash of a point (mm) and a salt, in [0, 1). */
function hash(x: number, y: number, z: number, salt: number): number {
  let h = Math.imul(Math.round(x * 1000) ^ 0x9e3779b9, 0x85ebca6b);
  h ^= Math.imul(Math.round(y * 1000) + salt, 0xc2b2ae35);
  h ^= Math.imul(Math.round(z * 1000) - salt * 7, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/**
 * A box drawn as broken rock (KitPart `relief`): its faces cut into ≈ 1.6 × 1.1 m cells whose corners move out of the
 * face by up to `relief`, into it by up to twice that, and along it by up to a third of a cell (so the cells stop
 * reading as a grid); the top stays flat to walk on. A corner shared by two faces moves the same way on both (the
 * offset hashes its position), so the skin stays closed.
 */
function reliefBox(p: KitPart): Geo {
  const a = p.relief!;
  const { hx, hy, hz } = p;
  const seg = (half: number, cell: number) => Math.max(1, Math.round((half * 2) / cell));
  const [nx, ny, nz] = [seg(hx, 1.6), seg(hy, 1.1), seg(hz, 1.6)];
  const g = new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2, nx, ny, nz).toNonIndexed();
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const salt = Math.round(hx * 131 + hy * 71 + hz * 37 + p.x * 17 + p.y * 13 + p.z * 7);
  const on = (v: number, half: number) => Math.abs(Math.abs(v) - half) < 1e-3;
  // Across a face: out ≤ a, in ≤ 2a. Along it: up to a third of the cell either way (in the face's plane).
  const normal = (v: number, h: number) => Math.sign(v) * (h * 3 - 2) * a;
  const cells = { x: (hx * 2) / nx, y: (hy * 2) / ny, z: (hz * 2) / nz };
  const along = (h: number, cell: number) => (h - 0.5) * 0.66 * cell;
  for (let i = 0; i < pos.count; i++) {
    const x = Math.round(pos.getX(i) * 1000) / 1000;
    const y = Math.round(pos.getY(i) * 1000) / 1000;
    const z = Math.round(pos.getZ(i) * 1000) / 1000;
    const ox = on(x, hx), oy = on(y, hy), oz = on(z, hz);
    const top = oy && y > 0;
    if (top && !ox && !oz) {
      pos.setXYZ(i, x, y, z);
      continue;
    }
    const dx = ox ? normal(x, hash(x, y, z, salt)) : along(hash(x, y, z, salt), cells.x);
    const dy = top ? 0 : oy ? normal(y, hash(x, y, z, salt + 1)) : along(hash(x, y, z, salt + 1), cells.y);
    const dz = oz ? normal(z, hash(x, y, z, salt + 2)) : along(hash(x, y, z, salt + 2), cells.z);
    pos.setXYZ(i, x + dx, y + dy, z + dz);
  }
  g.deleteAttribute('normal');
  g.computeVertexNormals();
  return g;
}

function partGeometry(p: KitPart): Geo {
  if (p.shape === 'box' && p.relief) return reliefBox(p);
  switch (p.shape) {
    case 'box':
      return new THREE.BoxGeometry(p.hx * 2, p.hy * 2, p.hz * 2);
    case 'cyl':
      return new THREE.CylinderGeometry(p.hx, p.hx, p.hy * 2, p.seg ?? 10);
    case 'cone':
      return new THREE.ConeGeometry(p.hx, p.hy * 2, p.seg ?? 10);
    case 'ball':
      return new THREE.IcosahedronGeometry(p.hx, 1);
    case 'gable': {
      // Triangle in (z, y) extruded along x: base on y = 0 from z = −hz to +hz, apex at (y = hy, z = 0).
      const shape = new THREE.Shape([new THREE.Vector2(-p.hz, 0), new THREE.Vector2(p.hz, 0), new THREE.Vector2(0, p.hy)]);
      const g = new THREE.ExtrudeGeometry(shape, { depth: p.hx * 2, bevelEnabled: false });
      g.translate(0, 0, -p.hx);
      g.rotateY(Math.PI / 2);
      return g;
    }
    case 'hip': {
      // Hipped roof: base rectangle on y = 0, ridge along X at y = hy (45° hips in plan), flat-shaded.
      const rx = Math.max(0.02, p.hx - p.hz);
      const A = [-p.hx, 0, p.hz], B = [p.hx, 0, p.hz], C = [p.hx, 0, -p.hz], D = [-p.hx, 0, -p.hz];
      const E = [rx, p.hy, 0], F = [-rx, p.hy, 0];
      const tris = [A, B, E, A, E, F, C, D, F, C, F, E, B, C, E, D, A, F, A, D, C, A, C, B];
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3));
      g.computeVertexNormals();
      return g;
    }
    case 'hull': {
      // The same points game-core builds the collider from (around the part's centre): what you see stops you.
      const q = p.pts ?? [];
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i + 2 < q.length; i += 3) pts.push(new THREE.Vector3(q[i], q[i + 1], q[i + 2]));
      return new ConvexGeometry(pts);
    }
  }
}

/**
 * Per-vertex colours of a part already in the prefab frame: flat, or banded in strata (`bands`) — sides only, the tops
 * keep the part's colour. The bands dip a little and vary in thickness, the same in every part of one prefab frame, so
 * the tiers of a massif read as one rock.
 */
function partColors(p: KitPart, g: Geo): THREE.BufferAttribute {
  const pos = g.getAttribute('position');
  const n = pos.count;
  const col = new Float32Array(n * 3);
  const main = new THREE.Color(KIT_PALETTE[p.color]);
  const bands = (p.bands ?? []).map((c) => new THREE.Color(KIT_PALETTE[c]));
  const nrm = g.getAttribute('normal');
  for (let t = 0; t + 2 < n; t += 3) {
    let c = main;
    if (bands.length && nrm.getY(t) + nrm.getY(t + 1) + nrm.getY(t + 2) < 2.2) {
      const cx = (pos.getX(t) + pos.getX(t + 1) + pos.getX(t + 2)) / 3;
      const cy = (pos.getY(t) + pos.getY(t + 1) + pos.getY(t + 2)) / 3;
      const cz = (pos.getZ(t) + pos.getZ(t + 1) + pos.getZ(t + 2)) / 3;
      const h = cy + 0.21 * cx + 0.07 * cz;
      const k = Math.floor(h / 1.05 + 0.4 * Math.sin(h * 0.9));
      const r = hash(k, 0, 0, 11);
      if (r >= 0.5) c = bands[Math.min(bands.length - 1, Math.floor((r - 0.5) * 2 * bands.length))]!;
    }
    for (let v = 0; v < 3; v++) col.set([c.r, c.g, c.b], (t + v) * 3);
  }
  return new THREE.BufferAttribute(col, 3);
}

/** Small decoration only drawn up close (see KitPart `lod`). */
export function isNearPart(p: KitPart): boolean {
  if (p.lod) return p.lod === 'near';
  return (p.solid ?? 'full') === 'none' && Math.max(p.hx, p.hy, p.hz) <= 0.3;
}

/** Position, normal, colour and LOD flag only, non-indexed (mergeable). */
function clean(g: Geo): Geo {
  const n = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(n.attributes)) if (!['position', 'normal', 'color', 'aLod'].includes(name)) n.deleteAttribute(name);
  return n;
}

const cache = new Map<string, Geo>();

/** One prefab's visible parts, merged, in its own frame (cached; do not mutate). */
export function kitPrefabGeometry(id: string): Geo {
  const hit = cache.get(id);
  if (hit) return hit;
  const prefab = KIT_PREFABS[id];
  if (!prefab) throw new Error(`kit: unknown prefab ${id}`);
  const parts: Geo[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  for (const p of prefab.parts) {
    if (p.visible === false) continue;
    const g = clean(partGeometry(p));
    const r = quatFromEulerDeg(p.rx, p.ry, p.rz);
    g.applyMatrix4(m.compose(new THREE.Vector3(p.x, p.y, p.z), q.set(r.x, r.y, r.z, r.w), one));
    const n = g.getAttribute('position').count;
    g.setAttribute('color', partColors(p, g));
    g.setAttribute('aLod', new THREE.BufferAttribute(new Float32Array(n).fill(isNearPart(p) ? 1 : 0), 1));
    parts.push(g);
  }
  const merged = parts.length ? mergeGeometries(parts, false)! : new THREE.BufferGeometry();
  merged.computeBoundingSphere();
  cache.set(id, merged);
  return merged;
}

/** A piece baked into a kit chunk: its vertex range in that chunk's fade attribute. */
export interface KitPieceRef {
  mesh: THREE.Mesh;
  start: number;
  count: number;
  placement: Placement;
}

/** Small per-building colour variation (every piece of one building shares it). */
function tintOf(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return (((h >>> 0) % 1000) / 1000 - 0.5) * 0.08;
}

/**
 * Bakes kit placements into static meshes, one per group (`groupOf`, e.g. the nearest icosahedron face). Returns the
 * meshes and, per solid placement, the vertex range to fade.
 */
export function buildKitChunks(placements: Placement[], material: THREE.Material, groupOf: (p: Placement) => number, o: { allRefs?: boolean } = {}): { meshes: THREE.Mesh[]; refs: Map<number, KitPieceRef>; triangles: number } {
  const groups = new Map<number, Placement[]>();
  for (const p of placements) {
    const g = groupOf(p);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(p);
  }
  const meshes: THREE.Mesh[] = [];
  const refs = new Map<number, KitPieceRef>();
  const m = new THREE.Matrix4();
  const basis = new THREE.Matrix4();
  let triangles = 0;
  for (const [g, list] of groups) {
    const geos: Geo[] = [];
    const ranges: { p: Placement; start: number; count: number }[] = [];
    let at = 0;
    for (const p of list) {
      const src = kitPrefabGeometry(p.prefab!);
      const n = src.getAttribute('position')?.count ?? 0;
      if (!n) continue;
      const geo = src.clone();
      basis.makeBasis(new THREE.Vector3(p.side.x, p.side.y, p.side.z), new THREE.Vector3(p.up.x, p.up.y, p.up.z), new THREE.Vector3(p.forward.x, p.forward.y, p.forward.z));
      m.copy(basis).scale(new THREE.Vector3(p.scale, p.scale, p.scale)).setPosition(p.position.x, p.position.y, p.position.z);
      geo.applyMatrix4(m);
      const k = 1 + tintOf(p.mapId ?? String(p.id));
      const col = geo.getAttribute('color') as THREE.BufferAttribute;
      for (let i = 0; i < col.count; i++) col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * (1 - (k - 1) * 0.5));
      geos.push(geo);
      ranges.push({ p, start: at, count: n });
      at += n;
    }
    if (!geos.length) continue;
    const merged = mergeGeometries(geos, false)!;
    merged.setAttribute('instanceFade', new THREE.BufferAttribute(new Float32Array(at), 1));
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = `kit_${material.name.includes('Water') ? 'water_' : ''}${g}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    meshes.push(mesh);
    triangles += at / 3;
    for (const r of ranges) if (!r.p.visualOnly || o.allRefs) refs.set(r.p.id, { mesh, start: r.start, count: r.count, placement: r.p });
  }
  return { meshes, refs, triangles };
}
