/**
 * Body extras, skinned to the torso (or the left forearm): crossbody bag, gold chain, fanny pack, Brazilian flag worn
 * as a cape, Bonfim ribbons on the wrist. Each sits just outside the current top (`topFit`), so a thick jacket never
 * swallows the chain and a tank top never leaves it floating. Fixed colors per piece (EXTRA, EXTRA_ACCENT, EXTRA_DETAIL).
 */
import * as THREE from 'three';
import type { BoneName } from '../rig/GRARig';
import { ringAt, torsoPoint, type BodyShape } from '../build/anatomy';
import { PartBuilder, Slot, facing, type RingSpec, type V3 } from '../build/PartBuilder';
import { topFit } from './tops';

export const EXTRA_COLORS: Record<string, { main: string; accent: string; detail: string }> = {
  'extra.none': { main: '#2b2a33', accent: '#2b2a33', detail: '#2b2a33' },
  'extra.cordao': { main: '#e2b13c', accent: '#fff0a8', detail: '#e2b13c' },
  'extra.pochete': { main: '#34343b', accent: '#f6d22c', detail: '#c9ced6' },
  'extra.bag': { main: '#e6b83c', accent: '#6b4a2f', detail: '#6b4a2f' },
  'extra.mochila': { main: '#2f3237', accent: '#3f444b', detail: '#c9ced6' },
  'extra.bandeira': { main: '#1f9a52', accent: '#f6d22c', detail: '#2c4fa3' },
  'extra.fitinhas': { main: '#d9493b', accent: '#f6d22c', detail: '#4fa3d6' },
};

const TORSO: BoneName[] = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'LeftShoulder', 'RightShoulder'];

export function buildExtra(b: PartBuilder, s: BodyShape, extraId: string, topId: string): void {
  const fit = topFit(topId);
  /** Point just outside the top at (y, θ). */
  const out = (y: number, theta: number, lift: number) => torsoPoint(s, y, theta, fit.d + lift, fit.k);
  switch (extraId) {
    case 'extra.cordao': {
      // Thick gold chain (alternating fat and thin links) dropping to a medal on the chest.
      const pts: V3[] = [];
      const n = 36;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const drop = Math.pow((1 + Math.cos(a)) / 2, 2);
        pts.push(out(1.286 - 0.108 * drop, a, 0.008 + 0.004 * drop).p);
      }
      b.loop(pts, 0.0055, 0.0055, { slot: Slot.EXTRA, bones: ['Spine1', 'Spine2', 'Neck', 'LeftShoulder', 'RightShoulder'], outline: 0.5 }, 6, (i) => (i % 2 ? 0.7 : 1.1));
      const medal = out(1.15, 0, 0.012);
      b.flower(medal.p, medal.n, 0.019, 0.004, 0, { slot: Slot.EXTRA, bones: ['Spine1', 'Spine2'], outline: 0.5 }, 0, 0, 18);
      b.flower([medal.p[0] + medal.n[0] * 0.004, medal.p[1], medal.p[2] + medal.n[2] * 0.004], medal.n, 0.011, 0.002, 5, { slot: Slot.EXTRA_ACCENT, bones: ['Spine1', 'Spine2'], outline: 0 }, 0.55, Math.PI / 2, 20);
      break;
    }
    case 'extra.pochete': {
      // Fanny pack on the front of the hips, its belt all the way around, a yellow zip and a buckle.
      const y = 0.905;
      const belt: V3[] = [];
      for (let i = 0; i < 28; i++) belt.push(out(y, (i / 28) * Math.PI * 2, 0.007).p);
      b.loop(belt, 0.011, 0.004, { slot: Slot.EXTRA, bones: ['Hips', 'Spine'] }, 6);
      const front = out(y - 0.012, -0.32, 0.03);
      const rot = facing(front.n);
      b.roundedBox(front.p, [0.075, 0.042, 0.028], { slot: Slot.EXTRA, bones: ['Hips', 'Spine'] }, 4, 16, 10, rot);
      const zipAt: V3 = [front.p[0] + front.n[0] * 0.026, front.p[1] + 0.012, front.p[2] + front.n[2] * 0.026];
      b.roundedBox(zipAt, [0.068, 0.004, 0.004], { slot: Slot.EXTRA_ACCENT, bones: ['Hips', 'Spine'], outline: 0.3 }, 4, 10, 6, rot);
      const buckle = out(y, 0.9, 0.012);
      b.roundedBox(buckle.p, [0.016, 0.013, 0.004], { slot: Slot.EXTRA_DETAIL, bones: ['Hips', 'Spine'], outline: 0.4 }, 4, 10, 6, facing(buckle.n));
      break;
    }
    case 'extra.bag': {
      // Strap from the left shoulder across the chest to the right hip, and across the back.
      const off = Math.max(0.03, fit.d + 0.014);
      const strapBones: BoneName[] = ['Hips', 'Spine', 'Spine1', 'Spine2', 'LeftShoulder', 'RightShoulder'];
      const front: RingSpec[] = [];
      const back: RingSpec[] = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        const y = 1.29 - t * 0.34;
        const x = 0.1 - t * 0.24;
        const r = ringAt(s.torso, 1, y);
        const ex = Math.min(1, Math.abs(x) / (r.ra * fit.k + off));
        const depth = (r.rb * fit.k + off) * Math.sqrt(Math.max(0.05, 1 - ex * ex));
        front.push({ p: [x, y, r.p[2] + depth], ra: 0.016, rb: 0.005 });
        back.push({ p: [x, y, r.p[2] - depth], ra: 0.016, rb: 0.005 });
      }
      b.tube(front, { slot: Slot.EXTRA_ACCENT, bones: strapBones, ref: [1, 1, 0], segments: 6, outline: 0.6 });
      b.tube(back, { slot: Slot.EXTRA_ACCENT, bones: strapBones, ref: [1, 1, 0], segments: 6, outline: 0.6 });
      const r = ringAt(s.torso, 1, 0.92);
      const rot = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationY(-0.6));
      const z = r.p[2] + r.rb * 0.7 + off - 0.01;
      b.roundedBox([-0.135, 0.915, z + 0.03], [0.07, 0.052, 0.03], { slot: Slot.EXTRA, bones: ['Hips', 'Spine'] }, 4, 14, 10, rot);
      b.roundedBox([-0.135, 0.955, z + 0.052], [0.066, 0.016, 0.012], { slot: Slot.EXTRA_ACCENT, bones: ['Hips', 'Spine'], outline: 0.5 }, 4, 10, 6, rot);
      break;
    }
    case 'extra.mochila': {
      // School backpack: padded straps from the top of the bag over each shoulder, down the chest and around the
      // ribs back to its bottom corners; the bag with a front pocket, a zip and a grab handle.
      const strapBones: BoneName[] = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'LeftShoulder', 'RightShoulder'];
      const lift = 0.012;
      const backZ = out(1.06, Math.PI, 0).p[2];
      for (const sx of [1, -1]) {
        const top = out(1.27, sx * 0.42, lift).p;
        const pts: V3[] = [
          out(1.2, sx * 2.78, lift).p,
          [sx * 0.088, 1.296, backZ * 0.35],
          [sx * 0.088, 1.31, top[2] * 0.4],
          top,
          out(1.17, sx * 0.5, lift).p,
          out(1.07, sx * 0.72, lift).p,
          out(1.0, sx * 1.1, lift).p,
          out(0.97, sx * 1.65, lift).p,
          out(0.955, sx * 2.3, lift).p,
        ];
        b.tube(pts.map((p) => ({ p, ra: 0.02, rb: 0.006 })), { slot: Slot.EXTRA_ACCENT, bones: strapBones, ref: [1, 0, 0], segments: 8, capStart: 'flat', capEnd: 'flat' });
        // Strap buckle on the chest.
        const bk = out(1.12, sx * 0.6, lift + 0.006);
        b.roundedBox(bk.p, [0.016, 0.01, 0.004], { slot: Slot.EXTRA_DETAIL, bones: strapBones, outline: 0.5 }, 4, 10, 6, facing(bk.n));
      }
      const bagBones: BoneName[] = ['Spine', 'Spine1', 'Spine2'];
      const bz = backZ - 0.075;
      b.roundedBox([0, 1.06, bz], [0.13, 0.165, 0.065], { slot: Slot.EXTRA, bones: bagBones }, 4, 18, 12);
      b.roundedBox([0, 0.98, bz - 0.062], [0.1, 0.075, 0.026], { slot: Slot.EXTRA_ACCENT, bones: bagBones }, 4, 16, 10);
      b.roundedBox([0, 1.17, bz - 0.04], [0.11, 0.006, 0.006], { slot: Slot.EXTRA_DETAIL, bones: bagBones, outline: 0.4 }, 4, 10, 6);
      b.tube(
        [0, 0.5, 1].map((t) => ({ p: [-0.035 + 0.07 * t, 1.225 + 0.022 * Math.sin(t * Math.PI), bz + 0.005] as V3, ra: 0.006, rb: 0.006 })),
        { slot: Slot.EXTRA_ACCENT, bones: bagBones, ref: [0, 0, 1], segments: 6 },
      );
      break;
    }
    case 'extra.bandeira': {
      // The flag as a cape: green cloth over the back, yellow rhombus, blue globe, ends knotted under the chin.
      const yTop = 1.272;
      const yBot = 0.93;
      /** Cape surface: u ∈ [-1, 1] across the back, v ∈ [0, 1] downward; it hangs further off the back as it falls. */
      const cape = (u: number, v: number, lift = 0) => {
        const y = yTop + (yBot - yTop) * v;
        const spread = (58 + 20 * v) * (Math.PI / 180);
        return out(y, Math.PI + u * spread, 0.012 + 0.05 * v * v + lift);
      };
      const sheet = (f: (i: number, j: number) => V3, rows: number, cols: number): V3[][] => {
        const g: V3[][] = [];
        for (let i = 0; i <= rows; i++) {
          const row: V3[] = [];
          for (let j = 0; j <= cols; j++) row.push(f(i, j));
          g.push(row);
        }
        return g;
      };
      b.slab(sheet((i, j) => cape(-1 + (2 * j) / 14, i / 8).p, 8, 14), 0.008, { slot: Slot.EXTRA, bones: TORSO });
      // Rhombus: corners top (0, 0.12), right (0.82, 0.5), bottom (0, 0.88), left (-0.82, 0.5), bilinear between them.
      const corner = [[0, 0.12], [0.82, 0.5], [0, 0.88], [-0.82, 0.5]] as const;
      const rhombus = (s1: number, t1: number) => {
        const w = [(1 - s1) * (1 - t1), s1 * (1 - t1), s1 * t1, (1 - s1) * t1];
        const u = w.reduce((acc, wi, i) => acc + wi * corner[i]![0], 0);
        const v = w.reduce((acc, wi, i) => acc + wi * corner[i]![1], 0);
        return cape(u, v, 0.007).p;
      };
      b.slab(sheet((i, j) => rhombus(j / 6, i / 6), 6, 6), 0.004, { slot: Slot.EXTRA_ACCENT, bones: TORSO, outline: 0.3 });
      const globe = cape(0, 0.5, 0.012);
      b.flower(globe.p, globe.n, 0.062, 0.004, 0, { slot: Slot.EXTRA_DETAIL, bones: TORSO, outline: 0.3 }, 0, 0, 24);
      // Ends over the shoulders to a knot under the chin.
      const knot = out(1.262, 0, 0.016).p;
      b.ellipsoid(knot, [0.02, 0.016, 0.014], { slot: Slot.EXTRA, bones: ['Spine2', 'Neck'] }, 10, 6);
      for (const sx of [1, -1]) {
        const start = cape(sx, 0.02).p;
        const over = out(1.292, sx * (Math.PI / 2), 0.006).p;
        const ends: RingSpec[] = [
          { p: start, ra: 0.014, rb: 0.006 },
          { p: [over[0], over[1] + 0.006, over[2]], ra: 0.014, rb: 0.006 },
          { p: out(1.276, sx * 0.55, 0.012).p, ra: 0.013, rb: 0.006 },
          { p: knot, ra: 0.012, rb: 0.006 },
        ];
        b.tube(ends, { slot: Slot.EXTRA, bones: ['Spine2', 'Neck', sx > 0 ? 'LeftShoulder' : 'RightShoulder'], ref: [0, 1, 0], segments: 8, capStart: 'flat', capEnd: 'flat' });
      }
      break;
    }
    case 'extra.fitinhas': {
      // Bonfim ribbons tied around the left wrist (over the cuff of a long sleeve), ends dangling.
      const x = s.p.wristX - 0.022;
      const arm = ringAt(s.arm, 0, x);
      const base = Math.max(arm.ra, arm.rb) * (fit.sleeve ? 1.04 : 1) + (fit.sleeve ?? 0) + 0.004;
      const bones: BoneName[] = ['LeftForeArm', 'LeftHand'];
      const slots = [Slot.EXTRA, Slot.EXTRA_ACCENT, Slot.EXTRA_DETAIL, Slot.LEAF] as const;
      slots.forEach((slot, i) => {
        const cx = x - 0.004 - i * 0.0075;
        b.torus([cx, arm.p[1], arm.p[2]], [1, 0, 0], base + 0.0025, 0.0028, { slot, bones, outline: 0.4 }, 16, 5);
        if (i % 2 === 0) {
          const y0 = arm.p[1] - base - 0.002;
          b.tube(
            [
              { p: [cx, y0, arm.p[2] + 0.004], ra: 0.0035, rb: 0.0012 },
              { p: [cx - 0.004 + i * 0.002, y0 - 0.028, arm.p[2] + 0.008 + i * 0.002], ra: 0.0035, rb: 0.0012 },
            ],
            { slot, bones, ref: [1, 0, 0], segments: 5, capStart: 'flat', capEnd: 'flat', outline: 0.3 },
          );
        }
      });
      break;
    }
    default:
      break;
  }
}
