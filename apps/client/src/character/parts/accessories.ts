/** Accessories: rigid head pieces (glasses, headphones) and a skinned crossbody bag. Fixed colors per piece. */
import * as THREE from 'three';
import type { BoneName } from '../rig/GRARig';
import { ringAt, type BodyShape } from '../build/anatomy';
import { PartBuilder, Slot, type V3 } from '../build/PartBuilder';

export const ACCESSORY_COLORS: Record<string, { acc: string; accent: string }> = {
  'acc.none': { acc: '#2b2a33', accent: '#2b2a33' },
  'acc.glasses': { acc: '#2b2a33', accent: '#c9a45c' },
  'acc.headphones': { acc: '#f1e8d6', accent: '#3a3a42' },
  'acc.bag': { acc: '#e6b83c', accent: '#6b4a2f' },
};

export function buildAccessory(b: PartBuilder, s: BodyShape, accId: string): void {
  const h = s.head;
  const c = h.center;
  switch (accId) {
    case 'acc.glasses': {
      const lens: V3[] = [];
      for (const sx of [1, -1]) {
        const f = h.frontPoint(sx * 0.044, -0.006, 0.016);
        if (!f) continue;
        lens.push(f.p);
        b.torus(f.p, f.n, 0.025, 0.0034, { slot: Slot.ACC, bones: ['Head'], outline: 0.6 }, 18, 6);
        // Temple arm back to the ear.
        b.tube(
          [
            { p: [f.p[0] + sx * 0.024, f.p[1] + 0.004, f.p[2] - 0.004], ra: 0.003, rb: 0.003 },
            { p: [sx * (h.a + 0.01), c[1] + 0.0, c[2] + 0.03], ra: 0.003, rb: 0.003 },
            { p: [sx * (h.a + 0.006), c[1] - 0.008, c[2] - 0.03], ra: 0.003, rb: 0.003 },
          ],
          { slot: Slot.ACC, bones: ['Head'], ref: [0, 1, 0], segments: 6, outline: 0.5 },
        );
      }
      if (lens.length === 2) {
        const [l, r] = lens as [V3, V3];
        b.tube(
          [
            { p: [l[0] - 0.024, l[1] + 0.003, l[2]], ra: 0.003, rb: 0.003 },
            { p: [0, (l[1] + r[1]) / 2 + 0.008, (l[2] + r[2]) / 2 + 0.004], ra: 0.003, rb: 0.003 },
            { p: [r[0] + 0.024, r[1] + 0.003, r[2]], ra: 0.003, rb: 0.003 },
          ],
          { slot: Slot.ACC, bones: ['Head'], ref: [0, 1, 0], segments: 6, outline: 0.5 },
        );
      }
      break;
    }
    case 'acc.headphones': {
      const cupX = h.a * 1.24 + 0.012;
      const cy = c[1] - 0.006;
      const cz = c[2] - 0.01;
      const band: { p: V3; ra: number; rb: number }[] = [];
      for (let i = 0; i <= 8; i++) {
        const t = (i / 8) * Math.PI;
        const x = Math.cos(t) * (cupX - 0.004);
        const y = cy + 0.03 + Math.sin(t) * (h.b * 1.26 - 0.01);
        band.push({ p: [x, y, cz], ra: 0.011, rb: 0.017 });
      }
      b.tube(band, { slot: Slot.ACC, bones: ['Head'], ref: [0, 0, 1], segments: 8, outline: 0.8 });
      for (const sx of [1, -1]) {
        const rot = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationZ(sx * 0.08));
        b.roundedBox([sx * cupX, cy, cz], [0.024, 0.044, 0.04], { slot: Slot.ACC, bones: ['Head'] }, 3, 14, 10, rot);
        b.ellipsoid([sx * (cupX - 0.022), cy, cz], [0.012, 0.038, 0.034], { slot: Slot.ACC_ACCENT, bones: ['Head'] }, 10, 6);
      }
      break;
    }
    case 'acc.bag': {
      // Strap from the left shoulder across the chest to the right hip, and across the back.
      const strapBones: BoneName[] = ['Hips', 'Spine', 'Spine1', 'Spine2', 'LeftShoulder', 'RightShoulder'];
      const front: { p: V3; ra: number; rb: number }[] = [];
      const back: { p: V3; ra: number; rb: number }[] = [];
      const n = 8;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const y = 1.29 - t * 0.34;
        const x = 0.1 - t * 0.24;
        const r = ringAt(s.torso, 1, y);
        const halfW = r.ra;
        const ex = Math.min(1, Math.abs(x) / (halfW + 0.04));
        const zf = r.p[2] + (r.rb + 0.04) * Math.sqrt(Math.max(0.05, 1 - ex * ex));
        front.push({ p: [x, y, zf], ra: 0.016, rb: 0.005 });
        back.push({ p: [x, y, r.p[2] - (r.rb + 0.04) * Math.sqrt(Math.max(0.05, 1 - ex * ex))], ra: 0.016, rb: 0.005 });
      }
      b.tube(front, { slot: Slot.ACC_ACCENT, bones: strapBones, ref: [1, 1, 0], segments: 6, outline: 0.6 });
      b.tube(back, { slot: Slot.ACC_ACCENT, bones: strapBones, ref: [1, 1, 0], segments: 6, outline: 0.6 });
      // Pouch at the right hip.
      const r = ringAt(s.torso, 1, 0.92);
      const rot = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationY(-0.6));
      b.roundedBox([-0.135, 0.915, r.p[2] + r.rb * 0.7 + 0.03], [0.07, 0.052, 0.03], { slot: Slot.ACC, bones: ['Hips', 'Spine'] }, 4, 14, 10, rot);
      b.roundedBox([-0.135, 0.955, r.p[2] + r.rb * 0.7 + 0.052], [0.066, 0.016, 0.012], { slot: Slot.ACC_ACCENT, bones: ['Hips', 'Spine'], outline: 0.5 }, 4, 10, 6, rot);
      break;
    }
    default:
      break;
  }
}
