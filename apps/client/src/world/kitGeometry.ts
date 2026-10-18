/**
 * Geometry of the world kit (game-data world/kit.ts): each prefab's visible parts merged into one BufferGeometry in
 * the prefab frame (X side, Y up, Z forward) with flat colours, rotated by the same quaternion the colliders use
 * (game-core quatFromEulerDeg), so the drawn wall is the wall that stops you.
 *
 * Placed pieces are baked into a few static meshes (one per icosahedron face of the planet, for frustum culling):
 * a whole village costs one draw call (plus its shadow pass) instead of one per prefab. Each piece keeps its own range
 * of vertices in a per-vertex `instanceFade` attribute, which the stylized material reads like the instanced props'
 * fade, so the camera dissolve still works piece by piece.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { KIT_PALETTE, KIT_PREFABS, type KitPart } from '@graao/game-data';
import { quatFromEulerDeg, type Placement } from '@graao/game-core';

type Geo = THREE.BufferGeometry;

function partGeometry(p: KitPart): Geo {
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
  }
}

/** Position, normal and colour only, non-indexed (mergeable). */
function clean(g: Geo): Geo {
  const n = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(n.attributes)) if (!['position', 'normal', 'color'].includes(name)) n.deleteAttribute(name);
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
    const c = new THREE.Color(KIT_PALETTE[p.color]);
    const n = g.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
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
export function buildKitChunks(placements: Placement[], material: THREE.Material, groupOf: (p: Placement) => number): { meshes: THREE.Mesh[]; refs: Map<number, KitPieceRef>; triangles: number } {
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
    mesh.name = `kit_${g}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    meshes.push(mesh);
    triangles += at / 3;
    for (const r of ranges) if (!r.p.visualOnly) refs.set(r.p.id, { mesh, start: r.start, count: r.count, placement: r.p });
  }
  return { meshes, refs, triangles };
}
