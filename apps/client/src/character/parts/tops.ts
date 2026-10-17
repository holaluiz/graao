/** Tops, built from the body's own torso and arm rings with outward offsets (no clipping by construction). */
import type { BoneName } from '../rig/GRARig';
import { inflate, mirrorRings, ringAt, sliceRings, type BodyShape } from '../build/anatomy';
import { PartBuilder, Slot, type RingSpec, type SlotId, type V3 } from '../build/PartBuilder';

const TORSO_BONES: BoneName[] = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'LeftShoulder', 'RightShoulder', 'LeftUpLeg', 'RightUpLeg'];
const armBones = (side: 'Left' | 'Right'): BoneName[] => [`${side}Shoulder`, `${side}Arm`, `${side}ForeArm`, `${side}Hand`] as BoneName[];

/** Torso shell between two heights; optional hem flare. */
function torsoShell(s: BodyShape, y0: number, y1: number, d: number, k: number, flare: number, count = 10): RingSpec[] {
  const rings = inflate(sliceRings(s.torso, 1, y0, y1, count), d, k);
  return rings.map((r, i) => {
    const t = 1 - i / (rings.length - 1);
    const f = flare * Math.pow(t, 3);
    return { ...r, ra: r.ra + f, rb: r.rb + f * 0.8, n: Math.max(2.2, (r.n ?? 2) - 0.2) };
  });
}

/** Sleeve along the arm from the shoulder to `x1` (left side x values). */
function sleeve(s: BodyShape, side: 'Left' | 'Right', x0: number, x1: number, d: number, endFlare: number, count = 6): RingSpec[] {
  let rings = inflate(sliceRings(s.arm, 0, x0, x1, count), d, 1.04);
  rings = rings.map((r, i) => {
    const t = i / (rings.length - 1);
    return { ...r, ra: r.ra + endFlare * t * t, rb: r.rb + endFlare * t * t };
  });
  return side === 'Left' ? rings : mirrorRings(rings);
}

/** Splits a ring list into colored bands of `period` along `axis` (crisp stripes need separate vertex rings). */
function bands(rings: RingSpec[], axis: 0 | 1, period: number, slots: [SlotId, SlotId]): { rings: RingSpec[]; slot: SlotId }[] {
  const a = rings[0]!.p[axis];
  const z = rings[rings.length - 1]!.p[axis];
  const dir = Math.sign(z - a);
  const out: { rings: RingSpec[]; slot: SlotId }[] = [];
  let v = a;
  let n = 0;
  while ((z - v) * dir > 1e-4) {
    const next = dir > 0 ? Math.min(z, v + period) : Math.max(z, v - period);
    out.push({ rings: [ringAt(rings, axis, v), ringAt(rings, axis, (v + next) / 2), ringAt(rings, axis, next)], slot: slots[n % 2]! });
    v = next;
    n++;
  }
  return out;
}

function frontZ(s: BodyShape, y: number, d: number): number {
  const r = ringAt(s.torso, 1, y);
  return r.p[2] + r.rb + d;
}

export function buildTop(b: PartBuilder, s: BodyShape, topId: string): void {
  const p = s.p;
  const sh = p.shoulderX;
  switch (topId) {
    case 'top.hoodie': {
      b.tube(torsoShell(s, 0.835, 1.296, 0.026, 1.06, 0.012), { slot: Slot.TOP, bones: TORSO_BONES, ref: [1, 0, 0], segments: 18, capStart: 'open', capEnd: 'open' });
      // Ribbed hem.
      b.tube(inflate(sliceRings(s.torso, 1, 0.8, 0.842, 3), 0.038, 1.06), { slot: Slot.TOP_ACCENT, bones: TORSO_BONES, ref: [1, 0, 0], segments: 18, capStart: 'open', capEnd: 'open' });
      for (const side of ['Left', 'Right'] as const) {
        b.tube(sleeve(s, side, sh - 0.05, p.wristX - 0.035, 0.022, 0.008, 9), { slot: Slot.TOP, bones: armBones(side), ref: [0, 1, 0], segments: 12, capStart: 'round', capEnd: 'open' });
        b.tube(sleeve(s, side, p.wristX - 0.04, p.wristX - 0.005, 0.016, 0, 3), { slot: Slot.TOP_ACCENT, bones: armBones(side), ref: [0, 1, 0], segments: 12, capStart: 'open', capEnd: 'open' });
      }
      // Hood: a rolled collar around the back of the neck plus the hood mass on the upper back.
      const hood: V3[] = [
        [0.085, 1.29, 0.02],
        [0.08, 1.325, -0.05],
        [0.0, 1.34, -0.095],
        [-0.08, 1.325, -0.05],
        [-0.085, 1.29, 0.02],
      ];
      b.tube(hood.map((q) => ({ p: q, ra: 0.034, rb: 0.03 })), { slot: Slot.TOP, bones: ['Spine2', 'Neck', 'LeftShoulder', 'RightShoulder'], ref: [0, 1, 0], segments: 10 });
      b.ellipsoid([0, 1.215, -0.112], [0.11, 0.09, 0.045], { slot: Slot.TOP, bones: ['Spine2', 'Spine1'] }, 12, 8);
      // Kangaroo pocket and drawstrings.
      b.roundedBox([0, 0.935, frontZ(s, 0.935, 0.03)], [0.095, 0.05, 0.012], { slot: Slot.TOP_ACCENT, bones: ['Spine', 'Hips', 'Spine1'] }, 5, 14, 8);
      for (const sx of [1, -1]) {
        b.tube(
          [
            { p: [sx * 0.026, 1.27, frontZ(s, 1.27, 0.035)], ra: 0.005, rb: 0.005 },
            { p: [sx * 0.029, 1.2, frontZ(s, 1.2, 0.036)], ra: 0.005, rb: 0.005 },
            { p: [sx * 0.03, 1.15, frontZ(s, 1.15, 0.036)], ra: 0.006, rb: 0.006 },
          ],
          { slot: Slot.SOLE, bones: ['Spine2', 'Spine1'], ref: [1, 0, 0], segments: 6, outline: 0.4 },
        );
      }
      break;
    }
    case 'top.longsleeve': {
      for (const band of bands(torsoShell(s, 0.86, 1.296, 0.014, 1.04, 0.008, 14), 1, 0.055, [Slot.TOP, Slot.TOP_ACCENT])) {
        b.tube(band.rings, { slot: band.slot, bones: TORSO_BONES, ref: [1, 0, 0], segments: 18, capStart: 'open', capEnd: 'open' });
      }
      b.tube(inflate(sliceRings(s.torso, 1, 1.283, 1.3, 2), 0.019, 1.04), { slot: Slot.TOP_ACCENT, bones: TORSO_BONES, ref: [1, 0, 0], segments: 18, capStart: 'open', capEnd: 'open' });
      for (const side of ['Left', 'Right'] as const) {
        const rings = sleeve(s, side, sh - 0.05, p.wristX - 0.01, 0.016, 0.004, 12);
        b.tube(rings.slice(0, 2), { slot: Slot.TOP, bones: armBones(side), ref: [0, 1, 0], segments: 12, capStart: 'round', capEnd: 'open' });
        for (const band of bands(rings.slice(1), 0, 0.055, [Slot.TOP_ACCENT, Slot.TOP])) {
          b.tube(band.rings, { slot: band.slot, bones: armBones(side), ref: [0, 1, 0], segments: 12, capStart: 'open', capEnd: 'open' });
        }
      }
      break;
    }
    case 'top.vest': {
      // Under-shirt (accent) with short sleeves.
      b.tube(torsoShell(s, 0.87, 1.296, 0.012, 1.03, 0.004), { slot: Slot.TOP_ACCENT, bones: TORSO_BONES, ref: [1, 0, 0], segments: 18, capStart: 'open', capEnd: 'open' });
      for (const side of ['Left', 'Right'] as const) {
        b.tube(sleeve(s, side, sh - 0.05, sh + 0.11, 0.016, 0.01, 5), { slot: Slot.TOP_ACCENT, bones: armBones(side), ref: [0, 1, 0], segments: 12, capStart: 'round', capEnd: 'open' });
      }
      // Vest shell.
      b.tube(torsoShell(s, 0.845, 1.262, 0.034, 1.07, 0.016, 10), { slot: Slot.TOP, bones: TORSO_BONES, ref: [1, 0, 0], segments: 18, capStart: 'open', capEnd: 'open' });
      // Shoulder straps over the top.
      for (const sx of [1, -1]) {
        b.tube(
          [
            { p: [sx * 0.095, 1.255, frontZ(s, 1.255, 0.03)], ra: 0.03, rb: 0.012 },
            { p: [sx * 0.105, 1.29, -0.012], ra: 0.03, rb: 0.012 },
            { p: [sx * 0.095, 1.255, -0.012 - 0.1], ra: 0.03, rb: 0.012 },
          ],
          { slot: Slot.TOP, bones: ['Spine2', sx > 0 ? 'LeftShoulder' : 'RightShoulder'], ref: [1, 0, 0], segments: 8 },
        );
        // Chest pockets.
        b.roundedBox([sx * 0.07, 1.1, frontZ(s, 1.1, 0.04)], [0.04, 0.038, 0.01], { slot: Slot.TOP, bones: ['Spine1', 'Spine2'] }, 5, 12, 8);
        b.roundedBox([sx * 0.075, 0.92, frontZ(s, 0.92, 0.042)], [0.045, 0.035, 0.01], { slot: Slot.TOP, bones: ['Spine', 'Hips'] }, 5, 12, 8);
      }
      // Zip line.
      b.roundedBox([0, 1.05, frontZ(s, 1.05, 0.036)], [0.006, 0.19, 0.005], { slot: Slot.TOP_ACCENT, bones: ['Spine', 'Spine1', 'Spine2'], outline: 0.3 }, 4, 8, 10);
      break;
    }
    case 'top.tee':
    default: {
      b.tube(torsoShell(s, 0.865, 1.296, 0.014, 1.05, 0.02), { slot: Slot.TOP, bones: TORSO_BONES, ref: [1, 0, 0], segments: 18, capStart: 'open', capEnd: 'open' });
      // Collar band.
      b.tube(inflate(sliceRings(s.torso, 1, 1.28, 1.3, 2), 0.02, 1.05), { slot: Slot.TOP_ACCENT, bones: TORSO_BONES, ref: [1, 0, 0], segments: 18, capStart: 'open', capEnd: 'open' });
      for (const side of ['Left', 'Right'] as const) {
        b.tube(sleeve(s, side, sh - 0.05, sh + 0.125, 0.018, 0.014, 5), { slot: Slot.TOP, bones: armBones(side), ref: [0, 1, 0], segments: 12, capStart: 'round', capEnd: 'open' });
        b.tube(sleeve(s, side, sh + 0.115, sh + 0.135, 0.026, 0.0, 2), { slot: Slot.TOP_ACCENT, bones: armBones(side), ref: [0, 1, 0], segments: 12, capStart: 'open', capEnd: 'open' });
      }
      // A graphic chest patch so the tee reads from distance (shape, not only color).
      b.roundedBox([0.05, 1.12, frontZ(s, 1.12, 0.017)], [0.032, 0.032, 0.004], { slot: Slot.TOP_ACCENT, bones: ['Spine1', 'Spine2'], outline: 0.3 }, 3, 10, 6);
      break;
    }
  }
}
