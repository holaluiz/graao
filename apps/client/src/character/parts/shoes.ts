/**
 * Shoes: chunky silhouettes (Messenger principle: the feet are the bottom color accent of the silhouette). Flip-flops
 * and leather sandals leave the bare foot visible and arch their straps over it.
 */
import type { BoneName } from '../rig/GRARig';
import type { BodyShape } from '../build/anatomy';
import { PartBuilder, Slot, type RingSpec, type SlotId, type V3 } from '../build/PartBuilder';

interface ShoeStyle {
  sole: { y: number; hh: number; widths: [number, number, number, number]; z0: number; z1: number };
  upper: { heights: [number, number, number, number]; centers: [number, number, number, number]; inset: number; z0: number; z1: number };
  shaft?: { top: number; r: number };
  toeCap?: boolean;
  laces?: boolean;
  /** Football studs under the sole and a stripe on the outer side. */
  studs?: boolean;
  /** Heel plate on springs (the sole only runs under the front of the foot). */
  springs?: boolean;
}

const STYLES: Record<string, ShoeStyle> = {
  'shoes.chunky': {
    sole: { y: 0.021, hh: 0.023, widths: [0.047, 0.05, 0.058, 0.05], z0: -0.078, z1: 0.205 },
    upper: { heights: [0.05, 0.046, 0.036, 0.026], centers: [0.075, 0.068, 0.054, 0.045], inset: 0.004, z0: -0.068, z1: 0.19 },
    laces: true,
  },
  'shoes.boots': {
    sole: { y: 0.024, hh: 0.026, widths: [0.05, 0.051, 0.057, 0.05], z0: -0.072, z1: 0.19 },
    upper: { heights: [0.06, 0.052, 0.04, 0.03], centers: [0.085, 0.078, 0.062, 0.05], inset: 0.003, z0: -0.064, z1: 0.178 },
    shaft: { top: 0.215, r: 0.056 },
    laces: true,
  },
  'shoes.chuteira': {
    sole: { y: 0.016, hh: 0.011, widths: [0.044, 0.046, 0.053, 0.046], z0: -0.074, z1: 0.2 },
    upper: { heights: [0.044, 0.04, 0.03, 0.022], centers: [0.058, 0.054, 0.045, 0.036], inset: 0.004, z0: -0.066, z1: 0.188 },
    laces: true,
    studs: true,
  },
  'shoes.mola': {
    sole: { y: 0.026, hh: 0.022, widths: [0.047, 0.05, 0.058, 0.05], z0: -0.004, z1: 0.205 },
    upper: { heights: [0.05, 0.046, 0.036, 0.026], centers: [0.075, 0.068, 0.054, 0.045], inset: 0.004, z0: -0.068, z1: 0.19 },
    laces: true,
    springs: true,
  },
  'shoes.slipons': {
    sole: { y: 0.014, hh: 0.015, widths: [0.043, 0.045, 0.052, 0.046], z0: -0.072, z1: 0.19 },
    upper: { heights: [0.036, 0.034, 0.028, 0.022], centers: [0.05, 0.046, 0.04, 0.032], inset: 0.004, z0: -0.064, z1: 0.18 },
    toeCap: true,
  },
};

/** Four-point profile sampled at t ∈ [0,1] (heel, arch, ball, toe). */
function profile(v: [number, number, number, number], t: number): number {
  const k = Math.min(2.999, t * 3);
  const i = Math.floor(k);
  const f = k - i;
  const s = f * f * (3 - 2 * f);
  return v[i]! + (v[i + 1]! - v[i]!) * s;
}

/** The bare foot (body.ts): ellipsoid centered (x, 0.04, 0.045) with radii (0.04, 0.038, 0.1). */
function footTop(z: number): number {
  const t = (z - 0.045) / 0.1;
  return 0.04 + 0.038 * Math.sqrt(Math.max(0, 1 - t * t));
}
function footHalfW(z: number): number {
  const t = (z - 0.045) / 0.1;
  return 0.04 * Math.sqrt(Math.max(0, 1 - t * t));
}

/** Strap over the foot from side `from` (1 = +x) to side `-from`, while z goes z0 -> z1. */
function overFoot(x: number, from: number, z0: number, z1: number, lift: number, n = 9): V3[] {
  const pts: V3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const z = z0 + (z1 - z0) * t;
    const a = Math.PI * t;
    pts.push([x + from * Math.cos(a) * (footHalfW(z) + lift + 0.003), 0.012 + Math.sin(a) * (footTop(z) + lift - 0.012), z]);
  }
  return pts;
}

/** Flat sole following the foot outline (two calls stack a two-tone flip-flop sole). */
function flatSole(b: PartBuilder, x: number, y: number, hh: number, slot: SlotId, bones: BoneName[]): void {
  const widths: [number, number, number, number] = [0.042, 0.044, 0.05, 0.044];
  const rings: RingSpec[] = [];
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    rings.push({ p: [x, y, -0.085 + 0.29 * t], ra: profile(widths, t), rb: hh, n: 3.4 });
  }
  b.tube(rings, { slot, bones, ref: [1, 0, 0], segments: 14, capStart: 'round', capEnd: 'round', capScale: 0.5 });
}

const strap = (pts: V3[], r: number): RingSpec[] => pts.map((p) => ({ p, ra: r, rb: r }));

/** Bare-foot footwear: the chinelo (Y strap from a toe post) and the leather alpercata (crossed straps, heel strap). */
function buildSandal(b: PartBuilder, s: BodyShape, shoesId: string): void {
  for (const side of ['Left', 'Right'] as const) {
    const sx = side === 'Left' ? 1 : -1;
    const x = sx * s.p.legSocketX;
    const bones = [`${side}Foot`, `${side}ToeBase`, `${side}Leg`] as BoneName[];
    const opts = { slot: Slot.SHOES, bones, ref: [0, 0, 1] as V3, segments: 7, outline: 0.6 };
    if (shoesId === 'shoes.chinelo') {
      flatSole(b, x, 0.0045, 0.0045, Slot.SHOES, bones);
      flatSole(b, x, 0.0105, 0.0025, Slot.SOLE, bones);
      const junction: V3 = [x - sx * 0.004, footTop(0.115) + 0.006, 0.115];
      b.tube(strap([[x - sx * 0.008, 0.012, 0.142], [x - sx * 0.006, 0.05, 0.13], junction], 0.0045), { ...opts, capStart: 'round', capEnd: 'round' });
      for (const k of [1, -1]) {
        const arm: V3[] = [];
        for (let i = 0; i <= 7; i++) {
          const t = i / 7;
          const z = 0.115 + (0.03 - 0.115) * t;
          const a = (1 - t) * (Math.PI / 2);
          arm.push([x + k * Math.cos(a) * (footHalfW(z) + 0.008), 0.012 + Math.sin(a) * (footTop(z) + 0.006 - 0.012), z]);
        }
        b.tube(strap(arm, 0.0048), { ...opts, capStart: 'round', capEnd: 'round' });
      }
    } else {
      flatSole(b, x, 0.008, 0.008, Slot.SOLE, bones);
      // Toe strap, two straps crossing over the instep, and a heel strap behind the ankle.
      b.tube(strap(overFoot(x, 1, 0.13, 0.13, 0.006), 0.0045), { ...opts, capStart: 'flat', capEnd: 'flat' });
      b.tube(strap(overFoot(x, 1, 0.02, 0.085, 0.007), 0.0045), { ...opts, capStart: 'flat', capEnd: 'flat' });
      b.tube(strap(overFoot(x, -1, 0.02, 0.085, 0.009), 0.0045), { ...opts, capStart: 'flat', capEnd: 'flat' });
      const heel: V3[] = [[x + 0.042, 0.014, 0.004]];
      for (let i = 0; i <= 8; i++) {
        const a = (i / 8) * Math.PI;
        heel.push([x + Math.cos(a) * 0.04, 0.05, -0.012 - Math.sin(a) * 0.047]);
      }
      heel.push([x - 0.042, 0.014, 0.004]);
      b.tube(strap(heel, 0.0045), { ...opts, bones: [`${side}Foot`, `${side}Leg`] as BoneName[], capStart: 'flat', capEnd: 'flat' });
      b.ellipsoid([x + sx * 0.044, 0.05, -0.01], [0.004, 0.009, 0.009], { slot: Slot.SHOES_DETAIL, bones, outline: 0.4 }, 8, 5);
    }
  }
}

export function buildShoes(b: PartBuilder, s: BodyShape, shoesId: string): void {
  if (shoesId === 'shoes.chinelo' || shoesId === 'shoes.sandalia') {
    buildSandal(b, s, shoesId);
    return;
  }
  const st = STYLES[shoesId] ?? STYLES['shoes.chunky']!;
  for (const side of ['Left', 'Right'] as const) {
    const sx = side === 'Left' ? 1 : -1;
    const x = sx * s.p.legSocketX;
    const bones = [`${side}Foot`, `${side}ToeBase`, `${side}Leg`] as BoneName[];
    const n = 9;
    const sole: RingSpec[] = [];
    const upper: RingSpec[] = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const zs = st.sole.z0 + (st.sole.z1 - st.sole.z0) * t;
      sole.push({ p: [x, st.sole.y, zs], ra: profile(st.sole.widths, t), rb: st.sole.hh, n: 3.4 });
      const zu = st.upper.z0 + (st.upper.z1 - st.upper.z0) * t;
      upper.push({ p: [x, profile(st.upper.centers, t), zu], ra: profile(st.sole.widths, t) - st.upper.inset, rb: profile(st.upper.heights, t), n: 2.4 });
    }
    b.tube(sole, { slot: Slot.SOLE, bones, ref: [1, 0, 0], segments: 14, capStart: 'round', capEnd: 'round', capScale: 0.5 });
    b.tube(upper, { slot: Slot.SHOES, bones, ref: [1, 0, 0], segments: 14, capStart: 'round', capEnd: 'round', capScale: 0.7 });
    if (st.shaft) {
      b.tube(
        [
          { p: [x, 0.08, -0.018], ra: st.shaft.r, rb: st.shaft.r * 1.05 },
          { p: [x, (0.08 + st.shaft.top) / 2, -0.016], ra: st.shaft.r * 0.95, rb: st.shaft.r },
          { p: [x, st.shaft.top, -0.014], ra: st.shaft.r * 0.98, rb: st.shaft.r },
        ],
        { slot: Slot.SHOES, bones: [`${side}Foot`, `${side}Leg`] as BoneName[], ref: [1, 0, 0], segments: 14, capStart: 'flat', capEnd: 'flat' },
      );
      b.tube(
        [
          { p: [x, st.shaft.top - 0.012, -0.014], ra: st.shaft.r + 0.006, rb: st.shaft.r * 1.02 + 0.006 },
          { p: [x, st.shaft.top + 0.006, -0.014], ra: st.shaft.r + 0.006, rb: st.shaft.r * 1.02 + 0.006 },
        ],
        { slot: Slot.SOLE, bones: [`${side}Leg`] as BoneName[], ref: [1, 0, 0], segments: 14, capStart: 'flat', capEnd: 'flat' },
      );
    }
    if (st.laces) {
      for (let k = 0; k < 3; k++) {
        const z = 0.01 + k * 0.032;
        const t = (z - st.upper.z0) / (st.upper.z1 - st.upper.z0);
        const y = profile(st.upper.centers, t) + profile(st.upper.heights, t) - 0.002;
        b.roundedBox([x, y, z], [0.026, 0.005, 0.008], { slot: Slot.SOLE, bones, outline: 0.3 }, 4, 10, 6);
      }
    }
    if (st.studs) {
      for (const z of [-0.048, -0.02, 0.07, 0.11, 0.15]) {
        for (const k of z < 0 ? [0] : [-1, 1]) b.ellipsoid([x + k * 0.02, 0.004, z], [0.007, 0.007, 0.007], { slot: Slot.SOLE, bones, outline: 0.4 }, 8, 5);
      }
      // Stripe along the outer side of the upper.
      const stripe: RingSpec[] = [];
      for (let i = 0; i <= 6; i++) {
        const t = 0.25 + 0.5 * (i / 6);
        const z = st.upper.z0 + (st.upper.z1 - st.upper.z0) * t;
        stripe.push({ p: [x + sx * (profile(st.sole.widths, t) - st.upper.inset + 0.001), profile(st.upper.centers, t), z], ra: 0.0025, rb: 0.007 });
      }
      b.tube(stripe, { slot: Slot.SHOES_DETAIL, bones, ref: [sx, 0, 0], segments: 6, capStart: 'round', capEnd: 'round', outline: 0.3 });
    }
    if (st.springs) {
      b.roundedBox([x, 0.031, -0.042], [0.045, 0.008, 0.04], { slot: Slot.SOLE, bones }, 4, 14, 8);
      for (const k of [-1, 1]) {
        for (let i = 0; i < 3; i++) b.torus([x + k * 0.019, 0.004 + i * 0.008, -0.045], [0, 1, 0], 0.011, 0.0032, { slot: Slot.SHOES_DETAIL, bones, outline: 0.4 }, 14, 6);
      }
    }
    if (st.toeCap) {
      b.ellipsoid([x, 0.036, 0.15], [0.046, 0.026, 0.045], { slot: Slot.SOLE, bones: [`${side}ToeBase`, `${side}Foot`] as BoneName[] }, 12, 8);
    }
  }
}
