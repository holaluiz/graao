/**
 * Face and head accessories, rigid on the Head bone, fixed colors per piece. Pieces at the sides of the head
 * (headphones, the flower) move out with the hair volume (`hairOuter`).
 */
import * as THREE from 'three';
import type { BodyShape, HeadShape } from '../build/anatomy';
import { PartBuilder, Slot, facing, frame, type V3 } from '../build/PartBuilder';
import { dirOf, hairOuter } from './hair';

export const ACCESSORY_COLORS: Record<string, { acc: string; accent: string }> = {
  'acc.none': { acc: '#2b2a33', accent: '#2b2a33' },
  'acc.glasses': { acc: '#2b2a33', accent: '#c9a45c' },
  'acc.shades': { acc: '#2b2a33', accent: '#4cc3d9' },
  'acc.headphones': { acc: '#f1e8d6', accent: '#3a3a42' },
  'acc.hoops': { acc: '#e2b13c', accent: '#fff0a8' },
  'acc.flor': { acc: '#e8475f', accent: '#ffd36e' },
};

const BONES = ['Head' as const];
const DEG = Math.PI / 180;

/** Frame bridge and temple arms shared by both glasses: the arms run back over the temples to rest on the ears. */
function glassesFrame(b: PartBuilder, h: HeadShape, lens: V3[], halfW: number): void {
  const c = h.center;
  const top = h.lm.earTop;
  lens.forEach((p, i) => {
    const sx = i === 0 ? 1 : -1;
    const temple = h.surface(dirOf(sx * 72 * DEG, 95 * DEG), 1.08);
    const rest = h.surface(new THREE.Vector3(sx * top[0], top[1] + 0.012, top[2] + 0.012), 1.03);
    b.tube(
      [
        { p: [p[0] + sx * halfW, p[1] + 0.004, p[2] - 0.004], ra: 0.003, rb: 0.003 },
        { p: [temple[0], temple[1] + 0.004, temple[2]], ra: 0.003, rb: 0.003 },
        { p: rest, ra: 0.003, rb: 0.003 },
        { p: [rest[0] - sx * 0.002, rest[1] - 0.01, rest[2] - 0.012], ra: 0.003, rb: 0.003 },
      ],
      { slot: Slot.ACC, bones: BONES, ref: [0, 1, 0], segments: 6, outline: 0.5 },
    );
  });
  if (lens.length === 2) {
    const [l, r] = lens as [V3, V3];
    // Over the nose, from the upper third of each rim.
    const rise = halfW * 0.32;
    const reach = Math.sqrt(halfW * halfW - rise * rise);
    const bridge = h.frontPoint(0, (l[1] + r[1]) / 2 - c[1] + rise + 0.004, 0.011);
    b.tube(
      [
        { p: [l[0] - reach, l[1] + rise, l[2]], ra: 0.003, rb: 0.003 },
        { p: bridge ? bridge.p : [0, (l[1] + r[1]) / 2 + rise + 0.004, (l[2] + r[2]) / 2 + 0.004], ra: 0.003, rb: 0.003 },
        { p: [r[0] + reach, r[1] + rise, r[2]], ra: 0.003, rb: 0.003 },
      ],
      { slot: Slot.ACC, bones: BONES, ref: [0, 1, 0], segments: 6, outline: 0.5 },
    );
  }
}

/** Center of the eye opening (face coordinates, side `sx`): where lenses sit. */
function eyeCenter(h: HeadShape, sx: number): [number, number] {
  return [sx * (h.lm.eye[0] - 0.003), h.lm.eye[1] - 0.0012];
}

export function buildAccessory(b: PartBuilder, s: BodyShape, accId: string, hairId: string): void {
  const h = s.head;
  const c = h.center;
  switch (accId) {
    case 'acc.glasses': {
      const lens: V3[] = [];
      for (const sx of [1, -1]) {
        const f = h.frontPoint(...eyeCenter(h, sx), 0.017);
        if (!f) continue;
        lens.push(f.p);
        b.torus(f.p, f.n, 0.03, 0.0034, { slot: Slot.ACC, bones: BONES, outline: 0.6 }, 20, 6);
      }
      glassesFrame(b, h, lens, 0.029);
      break;
    }
    case 'acc.shades': {
      // Mirrored sunglasses: wide oval lenses filled with the mirror color, thick frame.
      const lens: V3[] = [];
      for (const sx of [1, -1]) {
        const f = h.frontPoint(...eyeCenter(h, sx), 0.017);
        if (!f) continue;
        lens.push(f.p);
        const { e1, e2 } = frame(f.n);
        const rim: V3[] = [];
        for (let i = 0; i < 20; i++) {
          const a = (i / 20) * Math.PI * 2;
          // Slightly cat-eye: higher on the outer side.
          const lift = 0.004 * Math.max(0, Math.cos(a) * sx) * Math.max(0, Math.sin(a));
          const x = Math.cos(a) * 0.033;
          const y = Math.sin(a) * 0.022 + lift;
          rim.push([f.p[0] + e1.x * x + e2.x * y, f.p[1] + e1.y * x + e2.y * y, f.p[2] + e1.z * x + e2.z * y]);
        }
        b.loop(rim, 0.004, 0.004, { slot: Slot.ACC, bones: BONES, outline: 0.6 }, 6);
        b.ellipsoid(f.p, [0.032, 0.021, 0.004], { slot: Slot.ACC_ACCENT, bones: BONES, outline: 0 }, 14, 6, facing(f.n));
      }
      glassesFrame(b, h, lens, 0.033);
      break;
    }
    case 'acc.headphones': {
      // Cups clear the hair at ear height; the band clears the top of the hair.
      const ear = h.lm;
      const cy = c[1] + (ear.earTop[1] + ear.earLobe[1]) / 2;
      const cz = c[2] + (ear.earTop[2] + ear.earLobe[2]) / 2;
      const side = hairOuter(h, hairId, new THREE.Vector3(1, cy - c[1], cz - c[2]).normalize());
      const top = hairOuter(h, hairId, dirOf(0, 0));
      const cupX = Math.max(ear.earOut + 0.026, side[0] - c[0] + 0.018);
      const rise = Math.max(h.b * 1.26 - 0.01, top[1] - cy - 0.03 + 0.012);
      const band: { p: V3; ra: number; rb: number }[] = [];
      for (let i = 0; i <= 8; i++) {
        const t = (i / 8) * Math.PI;
        band.push({ p: [c[0] + Math.cos(t) * (cupX - 0.004), cy + 0.03 + Math.sin(t) * rise, cz], ra: 0.011, rb: 0.017 });
      }
      b.tube(band, { slot: Slot.ACC, bones: BONES, ref: [0, 0, 1], segments: 8, outline: 0.8 });
      for (const sx of [1, -1]) {
        const rot = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationZ(sx * 0.08));
        b.roundedBox([c[0] + sx * cupX, cy, cz], [0.024, 0.044, 0.04], { slot: Slot.ACC, bones: BONES }, 3, 14, 10, rot);
        b.ellipsoid([c[0] + sx * (cupX - 0.022), cy, cz], [0.012, 0.038, 0.034], { slot: Slot.ACC_ACCENT, bones: BONES }, 10, 6);
      }
      break;
    }
    case 'acc.hoops': {
      // Big gold hoops hanging from the earlobes of the sculpt.
      const lobe = h.lm.earLobe;
      for (const sx of [1, -1]) {
        const ear: V3 = [c[0] + sx * (lobe[0] + 0.002), c[1] + lobe[1], c[2] + lobe[2] + 0.004];
        b.torus([ear[0], ear[1] - 0.02, ear[2]], [1, 0, 0], 0.022, 0.0028, { slot: Slot.ACC, bones: BONES, outline: 0.5 }, 22, 6);
      }
      break;
    }
    case 'acc.flor': {
      // A hibiscus tucked over the left ear, with two leaves behind it.
      const d = dirOf(76 * Math.PI / 180, 64 * Math.PI / 180);
      const n: V3 = [d.x, d.y, d.z];
      const p = hairOuter(h, hairId, d, 0.008);
      const { e1, e2 } = frame(n);
      for (const [u, v, a] of [[0.032, -0.02, 0.5], [-0.028, -0.026, -0.6]] as const) {
        const lp: V3 = [p[0] + e1.x * u + e2.x * v - d.x * 0.004, p[1] + e1.y * u + e2.y * v - d.y * 0.004, p[2] + e1.z * u + e2.z * v - d.z * 0.004];
        const rot = facing(n).multiply(new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationZ(a)));
        b.ellipsoid(lp, [0.03, 0.013, 0.004], { slot: Slot.LEAF, bones: BONES, outline: 0.4 }, 10, 5, rot);
      }
      b.flower(p, n, 0.044, 0.01, 5, { slot: Slot.ACC, bones: BONES, outline: 0.6 }, 0.3, 0.3, 30);
      const heart: V3 = [p[0] + d.x * 0.009, p[1] + d.y * 0.009, p[2] + d.z * 0.009];
      b.ellipsoid(heart, [0.011, 0.011, 0.006], { slot: Slot.ACC_ACCENT, bones: BONES, outline: 0.3 }, 10, 5, facing(n));
      b.tube(
        [
          { p: heart, ra: 0.0025, rb: 0.0025 },
          { p: [heart[0] + d.x * 0.02 + e2.x * 0.01, heart[1] + d.y * 0.02 + e2.y * 0.01, heart[2] + d.z * 0.02 + e2.z * 0.01], ra: 0.0022, rb: 0.0022 },
        ],
        { slot: Slot.ACC_ACCENT, bones: BONES, ref: [0, 1, 0], segments: 5, capStart: 'flat', capEnd: 'round', outline: 0.3 },
      );
      break;
    }
    default:
      break;
  }
}
