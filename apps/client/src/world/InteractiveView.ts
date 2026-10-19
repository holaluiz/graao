/**
 * Doors and breakable crates on screen (game-core interactives.ts): every door leaf of the planet in one mesh whose
 * vertices are rewritten while a door swings (a leaf is a painted board with two raised panels on each face and a
 * knob), and every crate in another, a broken crate's vertices folded to a point. Two draw calls for the lot; the
 * colliders are the InteractiveSystem's, so the drawn leaf is the leaf that stops you.
 */
import * as THREE from 'three';
import { KIT_PALETTE, type KitColor } from '@graao/game-data';
import { doorLeafBoxes, type DoorDef, type OrientedBox, type Placement } from '@graao/game-core';
import { kitPrefabGeometry } from './kitGeometry';

/** A leaf's boxes in its own frame (x along the leaf from the hinge, y up, z through it), from its half extents. */
function leafParts(hx: number, hy: number, hz: number): { c: [number, number, number]; h: [number, number, number]; shade: number; lod: number }[] {
  const out: { c: [number, number, number]; h: [number, number, number]; shade: number; lod: number }[] = [{ c: [0, 0, 0], h: [hx, hy, hz], shade: 1, lod: 0 }];
  const px = Math.max(0.05, hx - 0.11);
  for (const s of [-1, 1]) {
    out.push({ c: [0, hy * 0.42, s * (hz + 0.01)], h: [px, hy * 0.36, 0.012], shade: 0.8, lod: 1 });
    out.push({ c: [0, -hy * 0.48, s * (hz + 0.01)], h: [px, hy * 0.3, 0.012], shade: 0.8, lod: 1 });
    out.push({ c: [hx - 0.09, -0.08, s * (hz + 0.025)], h: [0.025, 0.05, 0.02], shade: -1, lod: 1 });
  }
  return out;
}

const CUBE = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
const CUBE_POS = CUBE.getAttribute('position') as THREE.BufferAttribute;
const CUBE_NRM = CUBE.getAttribute('normal') as THREE.BufferAttribute;
const PER_BOX = CUBE_POS.count;
const PARTS_PER_LEAF = leafParts(1, 1, 1).length;
const KNOB = new THREE.Color(KIT_PALETTE.ouro);

export class InteractiveView {
  readonly group = new THREE.Group();
  private readonly doorMesh: THREE.Mesh;
  private readonly crateMesh: THREE.Mesh | null = null;
  /** First vertex of every door's leaves in the door mesh. */
  private readonly doorStart: number[] = [];
  private readonly shown: number[] = [];
  private readonly crateRange: { start: number; count: number; positions: Float32Array }[] = [];
  private readonly crateHidden: boolean[] = [];
  private readonly tmp = new THREE.Vector3();

  constructor(private readonly doors: readonly DoorDef[], crates: readonly Placement[], material: THREE.Material) {
    this.group.name = 'Interactives';
    // ---- doors: every leaf of every door (two leaves for colonial doors and garage gates).
    let verts = 0;
    for (const d of doors) {
      this.doorStart.push(verts);
      verts += (d.style === 'dupla' ? 2 : 1) * PARTS_PER_LEAF * PER_BOX;
      this.shown.push(-1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(verts * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const color = new Float32Array(verts * 3);
    const lod = new Float32Array(verts);
    for (const d of doors) {
      const base = new THREE.Color(KIT_PALETTE[d.color as KitColor]);
      const parts = leafParts(1, 1, 1);
      const leaves = d.style === 'dupla' ? 2 : 1;
      let v = this.doorStart[d.id]!;
      for (let l = 0; l < leaves; l++) {
        for (const p of parts) {
          const c = p.shade < 0 ? KNOB : base.clone().multiplyScalar(p.shade);
          for (let i = 0; i < PER_BOX; i++, v++) {
            color.set([c.r, c.g, c.b], v * 3);
            lod[v] = p.lod;
          }
        }
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(color, 3));
    geo.setAttribute('aLod', new THREE.BufferAttribute(lod, 1));
    geo.setAttribute('instanceFade', new THREE.BufferAttribute(new Float32Array(verts), 1));
    this.doorMesh = new THREE.Mesh(geo, material);
    this.doorMesh.name = 'interactive_doors';
    this.doorMesh.castShadow = true;
    this.doorMesh.receiveShadow = true;
    this.doorMesh.frustumCulled = false;
    this.group.add(this.doorMesh);
    for (const d of doors) this.setDoor(d.id, 0);
    geo.computeBoundingSphere();

    // ---- crates: baked like the kit chunks, each with its own vertex range.
    if (crates.length) {
      const parts: THREE.BufferGeometry[] = [];
      const m = new THREE.Matrix4();
      const basis = new THREE.Matrix4();
      let at = 0;
      for (const p of crates) {
        const g = kitPrefabGeometry(p.prefab!).clone();
        basis.makeBasis(new THREE.Vector3(p.side.x, p.side.y, p.side.z), new THREE.Vector3(p.up.x, p.up.y, p.up.z), new THREE.Vector3(p.forward.x, p.forward.y, p.forward.z));
        m.copy(basis).scale(new THREE.Vector3(p.scale, p.scale, p.scale)).setPosition(p.position.x, p.position.y, p.position.z);
        g.applyMatrix4(m);
        const n = g.getAttribute('position').count;
        this.crateRange.push({ start: at, count: n, positions: (g.getAttribute('position').array as Float32Array).slice() });
        this.crateHidden.push(false);
        at += n;
        parts.push(g);
      }
      const merged = mergeAll(parts);
      merged.setAttribute('instanceFade', new THREE.BufferAttribute(new Float32Array(at), 1));
      (merged.getAttribute('position') as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
      merged.computeBoundingSphere();
      this.crateMesh = new THREE.Mesh(merged, material);
      this.crateMesh.name = 'interactive_crates';
      this.crateMesh.castShadow = true;
      this.crateMesh.receiveShadow = true;
      this.crateMesh.frustumCulled = false;
      this.group.add(this.crateMesh);
    }
  }

  /** Poses door `id` at `open` (0 closed … 1 open). */
  setDoor(id: number, open: number): void {
    const q = Math.round(open * 1000) / 1000;
    if (this.shown[id] === q) return;
    this.shown[id] = q;
    const d = this.doors[id]!;
    const pos = this.doorMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const nrm = this.doorMesh.geometry.getAttribute('normal') as THREE.BufferAttribute;
    let v = this.doorStart[id]!;
    for (const leaf of doorLeafBoxes(d, q)) {
      for (const p of leafParts(leaf.half.x, leaf.half.y, leaf.half.z)) v = this.writeBox(pos, nrm, v, leaf, p.c, p.h);
    }
    pos.needsUpdate = true;
    nrm.needsUpdate = true;
  }

  /** Shows or hides crate `id` (broken crates fold to a point: no fragments drawn). */
  setCrate(id: number, whole: boolean): void {
    if (!this.crateMesh || this.crateHidden[id] === !whole) return;
    this.crateHidden[id] = !whole;
    const r = this.crateRange[id]!;
    const pos = this.crateMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    if (whole) arr.set(r.positions, r.start * 3);
    else {
      const x = r.positions[0]!, y = r.positions[1]!, z = r.positions[2]!;
      for (let i = 0; i < r.count; i++) arr.set([x, y, z], (r.start + i) * 3);
    }
    pos.needsUpdate = true;
  }

  get triangles(): number {
    return ((this.doorMesh.geometry.getAttribute('position').count) + (this.crateMesh?.geometry.getAttribute('position').count ?? 0)) / 3;
  }

  /** One box of a leaf (centre and half extents in the leaf frame) written at vertex `v`; returns the next vertex. */
  private writeBox(pos: THREE.BufferAttribute, nrm: THREE.BufferAttribute, v: number, leaf: OrientedBox, c: [number, number, number], h: [number, number, number]): number {
    const { side: sx, up: uy, forward: fz } = leaf;
    const cx = leaf.center.x + sx.x * c[0] + uy.x * c[1] + fz.x * c[2];
    const cy = leaf.center.y + sx.y * c[0] + uy.y * c[1] + fz.y * c[2];
    const cz = leaf.center.z + sx.z * c[0] + uy.z * c[1] + fz.z * c[2];
    for (let i = 0; i < PER_BOX; i++, v++) {
      const px = CUBE_POS.getX(i) * 2 * h[0];
      const py = CUBE_POS.getY(i) * 2 * h[1];
      const pz = CUBE_POS.getZ(i) * 2 * h[2];
      pos.setXYZ(v, cx + sx.x * px + uy.x * py + fz.x * pz, cy + sx.y * px + uy.y * py + fz.y * pz, cz + sx.z * px + uy.z * py + fz.z * pz);
      const nx = CUBE_NRM.getX(i), ny = CUBE_NRM.getY(i), nz = CUBE_NRM.getZ(i);
      nrm.setXYZ(v, sx.x * nx + uy.x * ny + fz.x * nz, sx.y * nx + uy.y * ny + fz.y * nz, sx.z * nx + uy.z * ny + fz.z * nz);
    }
    return v;
  }

  /** Where crate `id` stands (its first vertex: debris and sounds). */
  crateAt(id: number, out = this.tmp): THREE.Vector3 {
    const r = this.crateRange[id];
    return r ? out.set(r.positions[0]!, r.positions[1]!, r.positions[2]!) : out.set(0, 0, 0);
  }
}

/** Merges geometries with the same attributes (position, normal, color, aLod), non-indexed. */
function mergeAll(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'color', 'aLod']) {
    const size = list[0]!.getAttribute(name).itemSize;
    const total = list.reduce((n, g) => n + g.getAttribute(name).count, 0);
    const arr = new Float32Array(total * size);
    let at = 0;
    for (const g of list) {
      const a = g.getAttribute(name).array as Float32Array;
      arr.set(a, at);
      at += a.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  return out;
}
