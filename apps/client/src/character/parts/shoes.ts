/** Shoes: chunky silhouettes (Messenger principle: the feet are the bottom color accent of the silhouette). */
import type { BoneName } from '../rig/GRARig';
import type { BodyShape } from '../build/anatomy';
import { PartBuilder, Slot, type RingSpec } from '../build/PartBuilder';

interface ShoeStyle {
  sole: { y: number; hh: number; widths: [number, number, number, number]; z0: number; z1: number };
  upper: { heights: [number, number, number, number]; centers: [number, number, number, number]; inset: number; z0: number; z1: number };
  shaft?: { top: number; r: number };
  toeCap?: boolean;
  laces?: boolean;
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

export function buildShoes(b: PartBuilder, s: BodyShape, shoesId: string): void {
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
    if (st.toeCap) {
      b.ellipsoid([x, 0.036, 0.15], [0.046, 0.026, 0.045], { slot: Slot.SOLE, bones: [`${side}ToeBase`, `${side}Foot`] as BoneName[] }, 12, 8);
    }
  }
}
