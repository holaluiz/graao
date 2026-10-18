/**
 * Code-authored character geometry (no Blender needed for the MVP). A PartBuilder accumulates closed primitives
 * (tubes, parametric surfaces, decals) in the rig's bind pose. Each vertex carries:
 *   - aSlot:    palette slot (colors resolve per character in the shader; geometry never stores a color)
 *   - aRegion:  body region id (clothes hide regions of the body)
 *   - aOutline: outline width multiplier (0 = no ink hull, used by face decals)
 * Skin weights come from ONE function of (position, candidate bones) shared by the body and every garment, so a
 * sleeve point and the arm point under it bend identically.
 */
import * as THREE from 'three';
import type { BodyRegion } from '@graao/game-data';
import { END_BONES, type BoneName, type GRARig } from '../rig/GRARig';

export const REGION_IDS: Record<BodyRegion | 'none', number> = {
  none: 0,
  head: 1,
  ears: 11,
  neck: 2,
  torso: 3,
  hips: 4,
  upper_arms: 5,
  forearms: 6,
  hands: 7,
  upper_legs: 8,
  lower_legs: 9,
  feet: 10,
};

/** Palette slots resolved by the character shader. */
export const Slot = {
  SKIN: 0,
  BLUSH: 1,
  INK: 2,
  EYE_WHITE: 3,
  HAIR: 4,
  TOP: 5,
  TOP_ACCENT: 6,
  BOTTOM: 7,
  BOTTOM_ACCENT: 8,
  SHOES: 9,
  SOLE: 10,
  ACC: 11,
  ACC_ACCENT: 12,
  HAIR_ACCENT: 13,
  MARK: 14,
  LIPS: 15,
  HAT: 16,
  HAT_ACCENT: 17,
  EXTRA: 18,
  EXTRA_ACCENT: 19,
  EXTRA_DETAIL: 20,
  /** Short facial hair: hair color pulled toward the skin. */
  STUBBLE: 21,
  /** Fixed detail colors shared by every piece: leaves and flower hearts. */
  LEAF: 22,
  POLLEN: 23,
  /** Third color of a garment (plaid lines, side stripes, studs…), resolved per piece. */
  TOP_DETAIL: 24,
  BOTTOM_DETAIL: 25,
  SHOES_DETAIL: 26,
} as const;
export { PALETTE_SIZE } from '../../render/materials/GRAStylizedMaterial';
export type SlotId = (typeof Slot)[keyof typeof Slot];

export type V3 = [number, number, number];

export interface PrimitiveOpts {
  slot: SlotId;
  region?: BodyRegion | 'none';
  /** Bones this primitive may be weighted to. */
  bones: BoneName[];
  /** Exclude bones of the opposite side based on vertex x (default true when both sides are listed). */
  sideGate?: boolean;
  outline?: number;
}

export interface RingSpec {
  /** Ring center. */
  p: V3;
  /** Radius along the reference axis and the perpendicular axis. */
  ra: number;
  rb: number;
  /** Superellipse exponent (2 = ellipse, higher = boxier). */
  n?: number;
  region?: BodyRegion | 'none';
  slot?: SlotId;
}

export interface TubeOpts extends PrimitiveOpts {
  /** Axis that defines the `ra` radius direction (projected per ring). */
  ref: V3;
  segments?: number;
  capStart?: 'round' | 'flat' | 'open';
  capEnd?: 'round' | 'flat' | 'open';
  /** Length of round caps relative to the end radius. */
  capScale?: number;
  /** Rotates the cross-section start angle (radians). */
  phase?: number;
  /** Radial modulation (pleats, ribs): r *= 1 + amp * cos(freq * θ). */
  ripple?: { amp: number; freq: number };
}

/** Extra cross-section segments of every tube (see `tube`). */
const TUBE_SEGMENTS = 4 / 3;

/** Inserts a Catmull-Rom midpoint between consecutive rings (centers, radii, exponent); slots/regions stay per span. */
export function smoothRings(rings: RingSpec[]): RingSpec[] {
  if (rings.length < 3) return rings;
  const out: RingSpec[] = [];
  const at = (i: number) => rings[Math.max(0, Math.min(rings.length - 1, i))]!;
  const cr = (a: number, b: number, c: number, d: number) => (-a + 9 * b + 9 * c - d) / 16;
  for (let i = 0; i < rings.length - 1; i++) {
    const r0 = at(i - 1);
    const r1 = at(i);
    const r2 = at(i + 1);
    const r3 = at(i + 2);
    out.push(r1);
    out.push({
      ...r1,
      p: [cr(r0.p[0], r1.p[0], r2.p[0], r3.p[0]), cr(r0.p[1], r1.p[1], r2.p[1], r3.p[1]), cr(r0.p[2], r1.p[2], r2.p[2], r3.p[2])],
      ra: Math.max(1e-4, cr(r0.ra, r1.ra, r2.ra, r3.ra)),
      rb: Math.max(1e-4, cr(r0.rb, r1.rb, r2.rb, r3.rb)),
      n: cr(r0.n ?? 2, r1.n ?? 2, r2.n ?? 2, r3.n ?? 2),
    });
  }
  out.push(rings[rings.length - 1]!);
  return out;
}

export class PartBuilder {
  readonly pos: number[] = [];
  readonly slot: number[] = [];
  readonly region: number[] = [];
  readonly outline: number[] = [];
  readonly boneSet: number[] = [];
  readonly gate: number[] = [];
  readonly index: number[] = [];
  readonly normals: number[] = [];
  private readonly boneSets: BoneName[][] = [];
  private primVertexStart = 0;
  private primIndexStart = 0;
  private current: PrimitiveOpts | null = null;
  private currentSet = 0;

  begin(opts: PrimitiveOpts): this {
    this.current = opts;
    const key = opts.bones.join(',');
    let id = this.boneSets.findIndex((b) => b.join(',') === key);
    if (id < 0) {
      id = this.boneSets.length;
      this.boneSets.push(opts.bones);
    }
    this.currentSet = id;
    this.primVertexStart = this.pos.length / 3;
    this.primIndexStart = this.index.length;
    return this;
  }

  vertex(x: number, y: number, z: number, slot?: SlotId, region?: BodyRegion | 'none'): number {
    const o = this.current!;
    this.pos.push(x, y, z);
    this.slot.push(slot ?? o.slot);
    this.region.push(REGION_IDS[region ?? o.region ?? 'none']);
    this.outline.push(o.outline ?? 1);
    this.boneSet.push(this.currentSet);
    const both = o.bones.some((b) => b.startsWith('Left')) && o.bones.some((b) => b.startsWith('Right'));
    this.gate.push(o.sideGate ?? both ? 1 : 0);
    return this.pos.length / 3 - 1;
  }

  tri(a: number, b: number, c: number): void {
    this.index.push(a, b, c);
  }

  /** Closes the primitive: fixes winding so faces point outward (signed volume) and computes smooth normals. */
  end(opts: { orient?: 'auto' | 'keep' } = {}): void {
    const v0 = this.primVertexStart;
    const v1 = this.pos.length / 3;
    const i0 = this.primIndexStart;
    const P = this.pos;
    if ((opts.orient ?? 'auto') === 'auto') {
      let cx = 0, cy = 0, cz = 0;
      for (let v = v0; v < v1; v++) {
        cx += P[v * 3]!;
        cy += P[v * 3 + 1]!;
        cz += P[v * 3 + 2]!;
      }
      const n = Math.max(1, v1 - v0);
      cx /= n;
      cy /= n;
      cz /= n;
      let vol = 0;
      for (let t = i0; t < this.index.length; t += 3) {
        const a = this.index[t]!, b = this.index[t + 1]!, c = this.index[t + 2]!;
        const ax = P[a * 3]! - cx, ay = P[a * 3 + 1]! - cy, az = P[a * 3 + 2]! - cz;
        const bx = P[b * 3]! - cx, by = P[b * 3 + 1]! - cy, bz = P[b * 3 + 2]! - cz;
        const qx = P[c * 3]! - cx, qy = P[c * 3 + 1]! - cy, qz = P[c * 3 + 2]! - cz;
        vol += ax * (by * qz - bz * qy) - ay * (bx * qz - bz * qx) + az * (bx * qy - by * qx);
      }
      if (vol < 0) {
        for (let t = i0; t < this.index.length; t += 3) {
          const b = this.index[t + 1]!;
          this.index[t + 1] = this.index[t + 2]!;
          this.index[t + 2] = b;
        }
      }
    }
    // Smooth normals for this primitive only.
    const acc = new Float64Array((v1 - v0) * 3);
    for (let t = i0; t < this.index.length; t += 3) {
      const a = this.index[t]!, b = this.index[t + 1]!, c = this.index[t + 2]!;
      const ex = P[b * 3]! - P[a * 3]!, ey = P[b * 3 + 1]! - P[a * 3 + 1]!, ez = P[b * 3 + 2]! - P[a * 3 + 2]!;
      const fx = P[c * 3]! - P[a * 3]!, fy = P[c * 3 + 1]! - P[a * 3 + 1]!, fz = P[c * 3 + 2]! - P[a * 3 + 2]!;
      const nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx;
      for (const v of [a, b, c]) {
        const k = (v - v0) * 3;
        acc[k]! += nx;
        acc[k + 1]! += ny;
        acc[k + 2]! += nz;
      }
    }
    for (let v = v0; v < v1; v++) {
      const k = (v - v0) * 3;
      const l = Math.hypot(acc[k]!, acc[k + 1]!, acc[k + 2]!) || 1;
      this.normals.push(acc[k]! / l, acc[k + 1]! / l, acc[k + 2]! / l);
    }
    this.current = null;
  }

  /** Overrides the normal of vertex `v` (decals take the surface normal under them). */
  setNormal(v: number, n: V3): void {
    this.normals[v * 3] = n[0];
    this.normals[v * 3 + 1] = n[1];
    this.normals[v * 3 + 2] = n[2];
  }

  private readonly pendingNormals = new Map<number, V3>();
  /** Records a normal to apply after the current primitive's `end()` (see `flushNormals`). */
  setNormalLater(v: number, n: V3): void {
    this.pendingNormals.set(v, n);
  }
  flushNormals(): void {
    for (const [v, n] of this.pendingNormals) this.setNormal(v, n);
    this.pendingNormals.clear();
  }

  /**
   * Adds a ready-made triangle mesh (a Blender-authored piece, the sculpted head) with its own normals; weighted like
   * everything else. `vertexOpts` picks per-vertex options (region, bones) by vertex number.
   */
  mesh(positions: ArrayLike<number>, normals: ArrayLike<number>, index: ArrayLike<number>, opts: PrimitiveOpts, vertexOpts?: (i: number) => PrimitiveOpts): this {
    this.begin(opts);
    let cur = opts;
    const base = this.pos.length / 3;
    for (let i = 0; i < positions.length; i += 3) {
      const o = vertexOpts?.(i / 3) ?? opts;
      if (o !== cur) this.begin((cur = o));
      this.vertex(positions[i]!, positions[i + 1]!, positions[i + 2]!);
      this.normals.push(normals[i]!, normals[i + 1]!, normals[i + 2]!);
    }
    for (let i = 0; i < index.length; i++) this.index.push(base + index[i]!);
    this.current = null;
    return this;
  }

  private readonly fixedWeights = new Map<number, [BoneName, number][]>();
  /** Explicit skin weights for vertex `v` (instead of the distance-based ones). */
  setWeights(v: number, w: [BoneName, number][]): void {
    this.fixedWeights.set(v, w);
  }

  // -------------------------------------------------------------------------------------------- primitives

  /** Swept tube through `rings` with superellipse cross-sections; optional round/flat/open caps. */
  tube(rings: RingSpec[], opts: TubeOpts): this {
    this.begin(opts);
    // Soft, rounded silhouettes: twice the rings along the sweep (Catmull-Rom through the authored ones) and a third
    // more segments around. Body and garments go through the same refinement, so shells keep their offsets.
    rings = smoothRings(rings);
    const seg = Math.round((opts.segments ?? 12) * TUBE_SEGMENTS);
    const ref = new THREE.Vector3(...opts.ref).normalize();
    const pts = rings.map((r) => new THREE.Vector3(...r.p));
    const frames: { t: THREE.Vector3; e1: THREE.Vector3; e2: THREE.Vector3 }[] = [];
    for (let i = 0; i < rings.length; i++) {
      const a = pts[Math.max(0, i - 1)]!;
      const b = pts[Math.min(rings.length - 1, i + 1)]!;
      const t = b.clone().sub(a).normalize();
      const e1 = ref.clone().addScaledVector(t, -ref.dot(t));
      if (e1.lengthSq() < 1e-8) e1.set(1, 0, 0).addScaledVector(t, -t.x);
      e1.normalize();
      const e2 = new THREE.Vector3().crossVectors(t, e1);
      frames.push({ t, e1, e2 });
    }
    const phase = opts.phase ?? 0;
    const ringVerts: number[][] = [];
    const makeRing = (c: THREE.Vector3, f: (typeof frames)[number], ra: number, rb: number, n: number, slot?: SlotId, region?: BodyRegion | 'none') => {
      const ids: number[] = [];
      for (let k = 0; k < seg; k++) {
        const th = phase + (k / seg) * Math.PI * 2;
        const cs = Math.cos(th);
        const sn = Math.sin(th);
        const e = 2 / n;
        let x = Math.sign(cs) * Math.pow(Math.abs(cs), e) * ra;
        let y = Math.sign(sn) * Math.pow(Math.abs(sn), e) * rb;
        if (opts.ripple) {
          const m = 1 + opts.ripple.amp * Math.cos(opts.ripple.freq * th);
          x *= m;
          y *= m;
        }
        ids.push(
          this.vertex(
            c.x + f.e1.x * x + f.e2.x * y,
            c.y + f.e1.y * x + f.e2.y * y,
            c.z + f.e1.z * x + f.e2.z * y,
            slot,
            region,
          ),
        );
      }
      return ids;
    };

    const capRings = 3;
    const capScale = opts.capScale ?? 0.85;
    const first = rings[0]!;
    const last = rings[rings.length - 1]!;
    const f0 = frames[0]!;
    const fl = frames[frames.length - 1]!;

    // Start cap rings (from pole side toward ring 0).
    let startPole: number | null = null;
    if (opts.capStart === 'round' || opts.capStart === 'flat' || opts.capStart === undefined) {
      const round = opts.capStart !== 'flat';
      const len = round ? Math.min(first.ra, first.rb) * capScale : 0;
      if (round) {
        for (let j = capRings; j >= 1; j--) {
          const phi = (j / (capRings + 1)) * (Math.PI / 2);
          const c = pts[0]!.clone().addScaledVector(f0.t, -Math.sin(phi) * len);
          ringVerts.push(makeRing(c, f0, first.ra * Math.cos(phi), first.rb * Math.cos(phi), first.n ?? 2, first.slot, first.region));
        }
      }
      const pc = pts[0]!.clone().addScaledVector(f0.t, -len);
      startPole = this.vertex(pc.x, pc.y, pc.z, first.slot, first.region);
    }
    for (let i = 0; i < rings.length; i++) {
      const r = rings[i]!;
      ringVerts.push(makeRing(pts[i]!, frames[i]!, r.ra, r.rb, r.n ?? 2, r.slot, r.region));
    }
    let endPole: number | null = null;
    if (opts.capEnd === 'round' || opts.capEnd === 'flat' || opts.capEnd === undefined) {
      const round = opts.capEnd !== 'flat';
      const len = round ? Math.min(last.ra, last.rb) * capScale : 0;
      if (round) {
        for (let j = 1; j <= capRings; j++) {
          const phi = (j / (capRings + 1)) * (Math.PI / 2);
          const c = pts[pts.length - 1]!.clone().addScaledVector(fl.t, Math.sin(phi) * len);
          ringVerts.push(makeRing(c, fl, last.ra * Math.cos(phi), last.rb * Math.cos(phi), last.n ?? 2, last.slot, last.region));
        }
      }
      const pc = pts[pts.length - 1]!.clone().addScaledVector(fl.t, len);
      endPole = this.vertex(pc.x, pc.y, pc.z, last.slot, last.region);
    }

    for (let i = 0; i < ringVerts.length - 1; i++) {
      const A = ringVerts[i]!;
      const B = ringVerts[i + 1]!;
      for (let k = 0; k < seg; k++) {
        const k1 = (k + 1) % seg;
        this.tri(A[k]!, A[k1]!, B[k]!);
        this.tri(A[k1]!, B[k1]!, B[k]!);
      }
    }
    if (startPole !== null) {
      const A = ringVerts[0]!;
      for (let k = 0; k < seg; k++) this.tri(startPole, A[(k + 1) % seg]!, A[k]!);
    }
    if (endPole !== null) {
      const A = ringVerts[ringVerts.length - 1]!;
      for (let k = 0; k < seg; k++) this.tri(A[k]!, A[(k + 1) % seg]!, endPole);
    }
    // Open tubes are not closed volumes: keep the analytic outward winding.
    const open = opts.capStart === 'open' || opts.capEnd === 'open';
    this.end({ orient: open ? 'keep' : 'auto' });
    return this;
  }

  /**
   * Closed surface from a star-shaped function: `f(dir)` returns the surface point for a unit direction around a
   * center. `nu` around (longitude), `nv` pole to pole.
   */
  starSurface(f: (dir: THREE.Vector3) => V3, nu: number, nv: number, opts: PrimitiveOpts, slotFn?: (p: V3, dir: THREE.Vector3) => SlotId | undefined): this {
    this.begin(opts);
    const grid: number[][] = [];
    const d = new THREE.Vector3();
    const top = (() => {
      d.set(0, 1, 0);
      const p = f(d);
      return this.vertex(p[0], p[1], p[2], slotFn?.(p, d));
    })();
    for (let j = 1; j < nv; j++) {
      const phi = (j / nv) * Math.PI;
      const row: number[] = [];
      for (let i = 0; i < nu; i++) {
        const th = (i / nu) * Math.PI * 2;
        d.set(Math.sin(phi) * Math.sin(th), Math.cos(phi), Math.sin(phi) * Math.cos(th));
        const p = f(d);
        row.push(this.vertex(p[0], p[1], p[2], slotFn?.(p, d)));
      }
      grid.push(row);
    }
    const bottom = (() => {
      d.set(0, -1, 0);
      const p = f(d);
      return this.vertex(p[0], p[1], p[2], slotFn?.(p, d));
    })();
    for (let i = 0; i < nu; i++) this.tri(top, grid[0]![i]!, grid[0]![(i + 1) % nu]!);
    for (let j = 0; j < grid.length - 1; j++) {
      for (let i = 0; i < nu; i++) {
        const i1 = (i + 1) % nu;
        this.tri(grid[j]![i]!, grid[j + 1]![i]!, grid[j + 1]![i1]!);
        this.tri(grid[j]![i]!, grid[j + 1]![i1]!, grid[j]![i1]!);
      }
    }
    const lastRow = grid[grid.length - 1]!;
    for (let i = 0; i < nu; i++) this.tri(bottom, lastRow[(i + 1) % nu]!, lastRow[i]!);
    this.end();
    return this;
  }

  /** Ellipsoid centered at `c` with radii `r`, optionally rotated by a matrix. */
  ellipsoid(c: V3, r: V3, opts: PrimitiveOpts, nu = 12, nv = 8, rot?: THREE.Matrix3): this {
    const v = new THREE.Vector3();
    return this.starSurface(
      (dir) => {
        v.set(dir.x * r[0], dir.y * r[1], dir.z * r[2]);
        if (rot) v.applyMatrix3(rot);
        return [c[0] + v.x, c[1] + v.y, c[2] + v.z];
      },
      nu,
      nv,
      opts,
    );
  }

  /** Rounded box via a high-exponent superellipsoid. */
  roundedBox(c: V3, half: V3, opts: PrimitiveOpts, exponent = 6, nu = 16, nv = 10, rot?: THREE.Matrix3): this {
    const v = new THREE.Vector3();
    const e = 2 / exponent;
    const sp = (x: number) => Math.sign(x) * Math.pow(Math.abs(x), e);
    return this.starSurface(
      (dir) => {
        v.set(sp(dir.x) * half[0], sp(dir.y) * half[1], sp(dir.z) * half[2]);
        if (rot) v.applyMatrix3(rot);
        return [c[0] + v.x, c[1] + v.y, c[2] + v.z];
      },
      nu,
      nv,
      opts,
    );
  }

  /** Torus around `axis` through `c` (major radius R, minor r). */
  torus(c: V3, axis: V3, R: number, r: number, opts: PrimitiveOpts, nu = 20, nv = 6): this {
    this.begin(opts);
    const ax = new THREE.Vector3(...axis).normalize();
    const e1 = new THREE.Vector3(1, 0, 0);
    if (Math.abs(ax.dot(e1)) > 0.9) e1.set(0, 1, 0);
    e1.addScaledVector(ax, -ax.dot(e1)).normalize();
    const e2 = new THREE.Vector3().crossVectors(ax, e1);
    const ids: number[][] = [];
    for (let i = 0; i < nu; i++) {
      const u = (i / nu) * Math.PI * 2;
      const radial = e1.clone().multiplyScalar(Math.cos(u)).addScaledVector(e2, Math.sin(u));
      const row: number[] = [];
      for (let j = 0; j < nv; j++) {
        const v = (j / nv) * Math.PI * 2;
        const p = radial.clone().multiplyScalar(R + r * Math.cos(v)).addScaledVector(ax, r * Math.sin(v));
        row.push(this.vertex(c[0] + p.x, c[1] + p.y, c[2] + p.z));
      }
      ids.push(row);
    }
    for (let i = 0; i < nu; i++) {
      const i1 = (i + 1) % nu;
      for (let j = 0; j < nv; j++) {
        const j1 = (j + 1) % nv;
        this.tri(ids[i]![j]!, ids[i1]![j]!, ids[i1]![j1]!);
        this.tri(ids[i]![j]!, ids[i1]![j1]!, ids[i]![j1]!);
      }
    }
    this.end();
    return this;
  }

  /**
   * Closed thin sheet over a grid of points (rows × cols, no wrap): offset ±t/2 along the grid normal. Used for capes,
   * hat brims and crests. Rows run along `i`, columns along `j`.
   */
  slab(grid: V3[][], t: number, opts: PrimitiveOpts): this {
    this.begin(opts);
    const R = grid.length;
    const C = grid[0]!.length;
    const at = (i: number, j: number) => new THREE.Vector3(...grid[Math.min(R - 1, Math.max(0, i))]![Math.min(C - 1, Math.max(0, j))]!);
    const top: number[][] = [];
    const bot: number[][] = [];
    const n = new THREE.Vector3();
    const last = new THREE.Vector3(0, 0, 1);
    for (let i = 0; i < R; i++) {
      const rt: number[] = [];
      const rb: number[] = [];
      for (let j = 0; j < C; j++) {
        const du = at(i, j + 1).sub(at(i, j - 1));
        const dv = at(i + 1, j).sub(at(i - 1, j));
        n.crossVectors(du, dv);
        if (n.lengthSq() < 1e-14) n.copy(last);
        else last.copy(n.normalize());
        const p = at(i, j);
        rt.push(this.vertex(p.x + n.x * t * 0.5, p.y + n.y * t * 0.5, p.z + n.z * t * 0.5));
        rb.push(this.vertex(p.x - n.x * t * 0.5, p.y - n.y * t * 0.5, p.z - n.z * t * 0.5));
      }
      top.push(rt);
      bot.push(rb);
    }
    for (let i = 0; i < R - 1; i++) {
      for (let j = 0; j < C - 1; j++) {
        this.tri(top[i]![j]!, top[i]![j + 1]!, top[i + 1]![j + 1]!);
        this.tri(top[i]![j]!, top[i + 1]![j + 1]!, top[i + 1]![j]!);
        this.tri(bot[i]![j]!, bot[i + 1]![j + 1]!, bot[i]![j + 1]!);
        this.tri(bot[i]![j]!, bot[i + 1]![j]!, bot[i + 1]![j + 1]!);
      }
    }
    // Rim along the border, counter-clockwise seen from the top side.
    const loop: [number, number][] = [];
    for (let j = 0; j < C - 1; j++) loop.push([0, j]);
    for (let i = 0; i < R - 1; i++) loop.push([i, C - 1]);
    for (let j = C - 1; j > 0; j--) loop.push([R - 1, j]);
    for (let i = R - 1; i > 0; i--) loop.push([i, 0]);
    for (let k = 0; k < loop.length; k++) {
      const [ai, aj] = loop[k]!;
      const [bi, bj] = loop[(k + 1) % loop.length]!;
      this.tri(top[ai]![aj]!, bot[ai]![aj]!, bot[bi]![bj]!);
      this.tri(top[ai]![aj]!, bot[bi]![bj]!, top[bi]![bj]!);
    }
    this.end();
    return this;
  }

  /**
   * Flat flower (or frayed disk, or star with `sharp`) centered at `c` facing `n`: a squashed star surface whose rim
   * has `petals` lobes cut `depth` deep (0 = disk). `t` is the thickness along `n`.
   */
  flower(c: V3, n: V3, R: number, t: number, petals: number, opts: PrimitiveOpts, depth = 0.4, spin = 0, nu = 0, sharp = false): this {
    const { e1, e2, N } = frame(n);
    const lobes = petals > 0 ? petals : 1;
    return this.starSurface(
      (d) => {
        const a = Math.atan2(d.z, d.x) + spin;
        const k = (lobes * a) / (Math.PI * 2);
        // Round petals, or straight-edged star points (triangle wave).
        const lobe = sharp ? 1 - Math.abs(2 * (k - Math.floor(k)) - 1) : Math.pow(Math.abs(Math.cos((lobes * a) / 2)), 0.6);
        const r = R * (1 - depth * (1 - lobe));
        return [
          c[0] + e1.x * d.x * r + e2.x * d.z * r + N.x * d.y * t,
          c[1] + e1.y * d.x * r + e2.y * d.z * r + N.y * d.y * t,
          c[2] + e1.z * d.x * r + e2.z * d.z * r + N.z * d.y * t,
        ];
      },
      nu || Math.max(16, lobes * 4),
      5,
      opts,
    );
  }

  /** Closed tube along a closed polyline (belts, chains, hat bands). `rb` lies along the curve's plane normal side. */
  loop(pts: V3[], ra: number, rb: number, opts: PrimitiveOpts, segments = 6, radius?: (i: number) => number): this {
    this.begin(opts);
    const P = pts.map((p) => new THREE.Vector3(...p));
    const n = P.length;
    // Plane normal of the loop (Newell's method) as the reference axis for `ra`.
    const ref = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const a = P[i]!;
      const b = P[(i + 1) % n]!;
      ref.x += (a.y - b.y) * (a.z + b.z);
      ref.y += (a.z - b.z) * (a.x + b.x);
      ref.z += (a.x - b.x) * (a.y + b.y);
    }
    if (ref.lengthSq() < 1e-12) ref.set(0, 1, 0);
    ref.normalize();
    const rings: number[][] = [];
    for (let i = 0; i < n; i++) {
      const tng = P[(i + 1) % n]!.clone().sub(P[(i - 1 + n) % n]!).normalize();
      const e1 = ref.clone().addScaledVector(tng, -ref.dot(tng)).normalize();
      const e2 = new THREE.Vector3().crossVectors(tng, e1);
      const k = radius ? radius(i) : 1;
      const ids: number[] = [];
      for (let s = 0; s < segments; s++) {
        const th = (s / segments) * Math.PI * 2;
        const x = Math.cos(th) * ra * k;
        const y = Math.sin(th) * rb * k;
        const c = P[i]!;
        ids.push(this.vertex(c.x + e1.x * x + e2.x * y, c.y + e1.y * x + e2.y * y, c.z + e1.z * x + e2.z * y));
      }
      rings.push(ids);
    }
    for (let i = 0; i < n; i++) {
      const A = rings[i]!;
      const B = rings[(i + 1) % n]!;
      for (let s = 0; s < segments; s++) {
        const s1 = (s + 1) % segments;
        this.tri(A[s]!, A[s1]!, B[s]!);
        this.tri(A[s1]!, B[s1]!, B[s]!);
      }
    }
    this.end();
    return this;
  }

  // -------------------------------------------------------------------------------------------- output

  /** Builds an indexed BufferGeometry with skinning attributes for `rig`. */
  toGeometry(rig: GRARig): THREE.BufferGeometry {
    const n = this.pos.length / 3;
    const skinIndex = new Uint16Array(n * 4);
    const skinWeight = new Float32Array(n * 4);
    const segs = boneSegments(rig);
    const tmp = new THREE.Vector3();
    for (let v = 0; v < n; v++) {
      tmp.set(this.pos[v * 3]!, this.pos[v * 3 + 1]!, this.pos[v * 3 + 2]!);
      const fixed = this.fixedWeights.get(v);
      const w = fixed
        ? fixed.filter(([, x]) => x > 1e-4).map(([name, x]) => [rig.index.get(name)!, x] as [number, number])
        : skinWeightsAt(tmp, this.boneSets[this.boneSet[v]!]!, this.gate[v] === 1, segs, rig);
      for (let k = 0; k < 4; k++) {
        skinIndex[v * 4 + k] = w[k]?.[0] ?? 0;
        skinWeight[v * 4 + k] = w[k]?.[1] ?? 0;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
    g.setAttribute('aSlot', new THREE.Float32BufferAttribute(this.slot, 1));
    g.setAttribute('aRegion', new THREE.Float32BufferAttribute(this.region, 1));
    g.setAttribute('aOutline', new THREE.Float32BufferAttribute(this.outline, 1));
    g.setIndex(this.index);
    return g;
  }
}

/** Orthonormal frame whose third axis is `n` (for decals and flat pieces). */
export function frame(n: V3): { e1: THREE.Vector3; e2: THREE.Vector3; N: THREE.Vector3 } {
  const N = new THREE.Vector3(...n).normalize();
  const up = Math.abs(N.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const e1 = new THREE.Vector3().crossVectors(up, N).normalize();
  const e2 = new THREE.Vector3().crossVectors(N, e1);
  return { e1, e2, N };
}

/** Rotation that maps local +Z to `n` (local +Y stays as close to world up as possible). */
export function facing(n: V3): THREE.Matrix3 {
  const { e1, e2, N } = frame(n);
  return new THREE.Matrix3().set(e1.x, e2.x, N.x, e1.y, e2.y, N.y, e1.z, e2.z, N.z);
}

// ---------------------------------------------------------------------------------------------- skinning

interface Segment {
  bone: number;
  name: BoneName;
  a: THREE.Vector3;
  b: THREE.Vector3;
}

const segCache = new WeakMap<GRARig, Map<BoneName, Segment>>();

/** Each deforming bone as a segment from its joint toward its main child (or a short extension for tips). */
export function boneSegments(rig: GRARig): Map<BoneName, Segment> {
  const cached = segCache.get(rig);
  if (cached) return cached;
  const out = new Map<BoneName, Segment>();
  const p = rig.proportions;
  const mainChild: Partial<Record<BoneName, BoneName>> = {
    Spine: 'Spine1', Spine1: 'Spine2', Spine2: 'Neck', Neck: 'Head', Head: 'HeadTop_End',
    LeftShoulder: 'LeftArm', LeftArm: 'LeftForeArm', LeftForeArm: 'LeftHand', LeftHand: 'LeftHandMiddle1',
    RightShoulder: 'RightArm', RightArm: 'RightForeArm', RightForeArm: 'RightHand', RightHand: 'RightHandMiddle1',
    LeftUpLeg: 'LeftLeg', LeftLeg: 'LeftFoot', LeftFoot: 'LeftToeBase', LeftToeBase: 'LeftToe_End',
    RightUpLeg: 'RightLeg', RightLeg: 'RightFoot', RightFoot: 'RightToeBase', RightToeBase: 'RightToe_End',
  };
  for (const d of rig.defs) {
    if (END_BONES.has(d.name)) continue;
    const i = rig.index.get(d.name)!;
    const a = new THREE.Vector3(...d.pos);
    let b: THREE.Vector3;
    if (d.name === 'Hips') {
      a.set(0, p.hipsY - 0.12, -0.01);
      b = new THREE.Vector3(0, p.hipsY + 0.04, -0.01);
    } else {
      const child = mainChild[d.name] ?? rig.defs.find((c) => c.parent === d.name)?.name;
      if (child) b = new THREE.Vector3(...rig.byName.get(child)!.pos);
      else {
        // Finger tips: extend along the parent direction.
        const parent = rig.byName.get(d.parent!)!;
        const dir = a.clone().sub(new THREE.Vector3(...parent.pos));
        b = a.clone().add(dir);
      }
    }
    out.set(d.name, { bone: i, name: d.name, a, b });
  }
  segCache.set(rig, out);
  return out;
}

const tmpAB = new THREE.Vector3();
const tmpAP = new THREE.Vector3();
function distToSegment(p: THREE.Vector3, s: Segment): number {
  tmpAB.subVectors(s.b, s.a);
  tmpAP.subVectors(p, s.a);
  const t = Math.max(0, Math.min(1, tmpAP.dot(tmpAB) / Math.max(1e-9, tmpAB.lengthSq())));
  return tmpAP.addScaledVector(tmpAB, -t).length();
}

/** Inverse-distance weights (power 8) over candidate bone segments; top 4 influences, normalized. */
export function skinWeightsAt(p: THREE.Vector3, candidates: BoneName[], gate: boolean, segs: Map<BoneName, Segment>, rig: GRARig): [number, number][] {
  const items: [number, number][] = [];
  for (const name of candidates) {
    if (gate) {
      if (p.x > 0.02 && name.startsWith('Right')) continue;
      if (p.x < -0.02 && name.startsWith('Left')) continue;
    }
    const s = segs.get(name);
    if (!s) continue;
    const d = Math.max(0.008, distToSegment(p, s));
    items.push([s.bone, 1 / Math.pow(d, 8)]);
  }
  if (items.length === 0) items.push([rig.index.get('Hips')!, 1]);
  items.sort((a, b) => b[1] - a[1]);
  const top = items.slice(0, 4);
  const sum = top.reduce((s, x) => s + x[1], 0);
  return top.map(([b, w]) => [b, w / sum]);
}
