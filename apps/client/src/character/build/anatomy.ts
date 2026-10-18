/**
 * graao body anatomy: independently authored proportions informed by the Messenger study (big head, short torso,
 * long thin limbs, small hands, ≈ 5.6 heads tall). The rings below are the body's envelope: garments are built from
 * them with offsets, and the sculpted body (bodySculpt.ts) is fitted into them, so clothes always cover it.
 */
import type { RigProportions } from '../rig/GRARig';
import type { RingSpec, V3 } from './PartBuilder';
import { makeHead, type HeadShape } from './head';

export { makeHead, type HeadLandmarks, type HeadShape } from './head';

export interface BodyShape {
  p: RigProportions;
  sturdy: boolean;
  /** Girth multiplier for the torso and limbs. */
  girth: number;
  torso: RingSpec[];
  /** Left arm rings (mirror for right) along +X. */
  arm: RingSpec[];
  /** Left leg rings (mirror for right) along -Y. */
  leg: RingSpec[];
  head: HeadShape;
}

/** Arms hang on the side line of the chest (not behind it): shared by the rig, the arm rings and the hands. */
export const ARM_Z = 0.004;

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
  const z = ARM_Z;
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
  return { p, sturdy, girth: g, torso, arm, leg, head: makeHead([0, p.headY + 0.112, 0.008]) };
}

/**
 * Foot envelope (heel → toes) at the foot's x: center height, half width and half height per station. Bottoms sit on
 * y = 0 (a flat sole, never below the ground), the instep rises toward the ankle, the ball widens, the toes flatten.
 * The sculpted foot is fitted into it and shoes and sandals are built over it.
 */
export const FOOT_STATIONS: { z: number; y: number; w: number; h: number }[] = [
  { z: -0.05, y: 0.032, w: 0.028, h: 0.031 },
  { z: -0.02, y: 0.038, w: 0.033, h: 0.038 },
  { z: 0.025, y: 0.036, w: 0.036, h: 0.036 },
  { z: 0.075, y: 0.026, w: 0.041, h: 0.026 },
  { z: 0.115, y: 0.019, w: 0.042, h: 0.019 },
  { z: 0.14, y: 0.016, w: 0.037, h: 0.016 },
];

/** Interpolated foot station at `z` (clamped to the foot). */
export function footAt(z: number): { y: number; w: number; h: number } {
  const st = FOOT_STATIONS;
  if (z <= st[0]!.z) return st[0]!;
  for (let i = 0; i < st.length - 1; i++) {
    const a = st[i]!;
    const b = st[i + 1]!;
    if (z <= b.z) {
      const t = (z - a.z) / (b.z - a.z);
      return { y: a.y + (b.y - a.y) * t, w: a.w + (b.w - a.w) * t, h: a.h + (b.h - a.h) * t };
    }
  }
  return st[st.length - 1]!;
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
