/**
 * graao body anatomy: independently authored proportions informed by the Messenger study (big head, short torso,
 * long thin limbs, small hands, ≈ 5.6 heads tall). Garments are built from the SAME ring specs with offsets, so they
 * follow the body exactly.
 */
import * as THREE from 'three';
import type { RigProportions } from '../rig/GRARig';
import type { RingSpec, V3 } from './PartBuilder';

export interface BodyShape {
  p: RigProportions;
  /** Girth multiplier for the torso and limbs. */
  girth: number;
  torso: RingSpec[];
  /** Left arm rings (mirror for right) along +X. */
  arm: RingSpec[];
  /** Left leg rings (mirror for right) along -Y. */
  leg: RingSpec[];
  head: HeadShape;
}

export interface HeadShape {
  center: V3;
  /** Half extents of the skull ellipsoid. */
  a: number;
  b: number;
  c: number;
  /** Surface point for a unit direction (head-local frame = rig frame). */
  surface(dir: THREE.Vector3, scale?: number): V3;
  /** Point on the face surface seen from the front at head-local (u, v) relative to the center; null off the face. */
  frontPoint(u: number, v: number, lift?: number): { p: V3; n: V3 } | null;
}

export function makeHead(center: V3): HeadShape {
  const a = 0.123;
  const b = 0.148;
  const c = 0.129;
  // Jaw taper below the equator and a gentle chin; the back of the skull is fuller.
  const sx = (dy: number) => (dy < 0 ? 1 - 0.3 * Math.pow(-dy, 1.6) : 1 - 0.06 * dy * dy);
  const sz = (dy: number, dz: number) => (dz < 0 ? 1.06 : dy < 0 ? 1 - 0.12 * Math.pow(-dy, 2) : 1);
  const chin = (dy: number) => (dy < -0.55 ? 0.01 * (1 - Math.abs(dy + 0.85) / 0.3) : 0);
  const surface = (dir: THREE.Vector3, scale = 1): V3 => {
    const x = dir.x * a * sx(dir.y) * scale;
    const y = dir.y * b * scale;
    const z = (dir.z * c * sz(dir.y, dir.z) + (dir.z > 0 ? Math.max(0, chin(dir.y)) * dir.z : 0)) * scale;
    return [center[0] + x, center[1] + y, center[2] + z];
  };
  const frontPoint = (u: number, v: number, lift = 0.0018) => {
    const dy = v / b;
    if (Math.abs(dy) >= 1) return null;
    const dx = u / (a * sx(dy));
    const rem = 1 - dx * dx - dy * dy;
    if (rem <= 0.02) return null;
    const dz = Math.sqrt(rem);
    const dir = new THREE.Vector3(dx, dy, dz);
    const p = surface(dir);
    // Normal from the ellipsoid gradient (good enough for a 2 mm lift).
    const n = new THREE.Vector3((p[0] - center[0]) / (a * a), (p[1] - center[1]) / (b * b), (p[2] - center[2]) / (c * c)).normalize();
    return { p: [p[0] + n.x * lift, p[1] + n.y * lift, p[2] + n.z * lift] as V3, n: [n.x, n.y, n.z] as V3 };
  };
  return { center, a, b, c, surface, frontPoint };
}

export function makeBodyShape(p: RigProportions, sturdy: boolean): BodyShape {
  const g = sturdy ? 1.14 : 1;
  const gw = sturdy ? 1.1 : 1;
  const T = (y: number, hw: number, hd: number, z: number, n: number, region: 'torso' | 'hips'): RingSpec => ({
    p: [0, y, z],
    ra: hw * gw,
    rb: hd * g,
    n,
    region,
  });
  const torso: RingSpec[] = [
    T(0.735, 0.07, 0.06, -0.005, 2.2, 'hips'),
    T(0.765, 0.125, 0.085, -0.008, 2.4, 'hips'),
    T(0.82, 0.146, 0.094, -0.012, 2.5, 'hips'),
    T(0.88, 0.14, 0.09, -0.01, 2.5, 'hips'),
    T(0.95, 0.122, 0.083, -0.004, 2.4, 'torso'),
    T(1.03, 0.127, 0.087, 0.0, 2.5, 'torso'),
    T(1.11, 0.142, 0.094, 0.004, 2.6, 'torso'),
    T(1.185, 0.152, 0.092, 0.002, 2.8, 'torso'),
    T(1.24, 0.156, 0.084, -0.006, 2.9, 'torso'),
    T(1.275, 0.122, 0.07, -0.012, 2.6, 'torso'),
    T(1.3, 0.06, 0.05, -0.014, 2.2, 'torso'),
  ];
  const y = p.shoulderY - 0.003;
  const z = -0.015;
  const A = (x: number, r: number, region: 'upper_arms' | 'forearms', rz = r): RingSpec => ({ p: [x, y, z], ra: r * g, rb: rz * g, region });
  const ex = p.elbowX;
  const wx = p.wristX;
  const sh = p.shoulderX;
  const arm: RingSpec[] = [
    A(sh - 0.04, 0.046, 'upper_arms'),
    A(sh + 0.005, 0.048, 'upper_arms'),
    A(sh + 0.08, 0.043, 'upper_arms'),
    A((sh + ex) / 2 + 0.03, 0.039, 'upper_arms'),
    A(ex - 0.025, 0.035, 'upper_arms'),
    A(ex + 0.015, 0.034, 'forearms', 0.036),
    A(ex + (wx - ex) * 0.4, 0.033, 'forearms', 0.036),
    A(ex + (wx - ex) * 0.75, 0.029, 'forearms', 0.031),
    A(wx - 0.005, 0.025, 'forearms', 0.027),
  ];
  const lx = p.legSocketX;
  const L = (yy: number, r: number, region: 'upper_legs' | 'lower_legs', zz = 0, rz = r): RingSpec => ({ p: [lx, yy, zz], ra: r * g, rb: rz * g, region });
  const ky = p.kneeY;
  const leg: RingSpec[] = [
    L(p.hipsY - 0.01, 0.078, 'upper_legs', -0.005),
    L(p.hipsY - 0.08, 0.077, 'upper_legs', -0.002),
    L(0.66, 0.067, 'upper_legs', 0.004),
    L(0.54, 0.056, 'upper_legs', 0.008),
    L(ky + 0.015, 0.048, 'upper_legs', 0.012),
    L(ky - 0.04, 0.049, 'lower_legs', 0.008, 0.05),
    L(0.33, 0.05, 'lower_legs', -0.004, 0.053),
    L(0.23, 0.043, 'lower_legs', -0.006, 0.045),
    L(0.14, 0.034, 'lower_legs', -0.008),
    L(p.ankleY + 0.01, 0.029, 'lower_legs', -0.01),
  ];
  return { p, girth: g, torso, arm, leg, head: makeHead([0, p.headY + 0.112, 0.008]) };
}

/** Mirrors a left-side ring list to the right side (x → -x). */
export function mirrorRings(rings: RingSpec[]): RingSpec[] {
  return rings.map((r) => ({ ...r, p: [-r.p[0], r.p[1], r.p[2]] as V3 }));
}

/** Offsets a ring list outward (garments): radius grows by `d` (+ multiplicative `k`). */
export function inflate(rings: RingSpec[], d: number, k = 1, extra?: Partial<RingSpec>): RingSpec[] {
  return rings.map((r) => ({ ...r, ra: r.ra * k + d, rb: r.rb * k + d, ...extra }));
}

/** Linear interpolation of a ring list at parameter `y` (for torso-like lists sorted by y) or `x` (arms). */
export function ringAt(rings: RingSpec[], axis: 0 | 1, value: number): RingSpec {
  const asc = rings[0]!.p[axis] < rings[rings.length - 1]!.p[axis];
  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i]!;
    const b = rings[i + 1]!;
    const va = a.p[axis];
    const vb = b.p[axis];
    const inside = asc ? value >= va && value <= vb : value <= va && value >= vb;
    if (inside) {
      const t = (value - va) / (vb - va || 1);
      return {
        ...a,
        p: [a.p[0] + (b.p[0] - a.p[0]) * t, a.p[1] + (b.p[1] - a.p[1]) * t, a.p[2] + (b.p[2] - a.p[2]) * t],
        ra: a.ra + (b.ra - a.ra) * t,
        rb: a.rb + (b.rb - a.rb) * t,
        n: (a.n ?? 2) + ((b.n ?? 2) - (a.n ?? 2)) * t,
      };
    }
  }
  const first = rings[0]!;
  const last = rings[rings.length - 1]!;
  const before = asc ? value < first.p[axis] : value > first.p[axis];
  return { ...(before ? first : last) };
}

/**
 * Point on the torso surface at height `y` and azimuth `theta` (0 = chest, +π/2 = the character's left, π = back),
 * on the garment shell `inflate(ring, d, k)` with the exponent garments use. Returns the point and its outward normal.
 */
export function torsoPoint(s: BodyShape, y: number, theta: number, d: number, k = 1): { p: V3; n: V3 } {
  const r = ringAt(s.torso, 1, y);
  const ra = r.ra * k + d;
  const rb = r.rb * k + d;
  const n = Math.max(2.2, (r.n ?? 2) - 0.2);
  const S = (v: number) => Math.sign(v) * Math.pow(Math.abs(v), 2 / n);
  const sx = Math.sin(theta);
  const cz = Math.cos(theta);
  const x = S(sx) * ra;
  const z = S(cz) * rb;
  // Superellipse gradient: |x/ra|^(n-1) / ra.
  const gx = Math.sign(x) * Math.pow(Math.abs(x / ra), n - 1) / ra;
  const gz = Math.sign(z) * Math.pow(Math.abs(z / rb), n - 1) / rb;
  const l = Math.hypot(gx, gz) || 1;
  return { p: [r.p[0] + x, y, r.p[2] + z], n: [gx / l, 0, gz / l] };
}

/** Resamples a ring list between two axis values with `count` rings (keeps silhouettes smooth for garments). */
export function sliceRings(rings: RingSpec[], axis: 0 | 1, from: number, to: number, count: number): RingSpec[] {
  const out: RingSpec[] = [];
  for (let i = 0; i < count; i++) out.push(ringAt(rings, axis, from + ((to - from) * i) / (count - 1)));
  return out;
}
