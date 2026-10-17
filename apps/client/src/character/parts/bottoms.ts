/** Bottoms: pelvis shell from the torso rings + leg tubes from the leg rings, with flares and bands. */
import type { BoneName } from '../rig/GRARig';
import { inflate, mirrorRings, sliceRings, type BodyShape } from '../build/anatomy';
import { PartBuilder, Slot, type RingSpec } from '../build/PartBuilder';

const PELVIS_BONES: BoneName[] = ['Hips', 'Spine', 'LeftUpLeg', 'RightUpLeg'];
const legBones = (side: 'Left' | 'Right'): BoneName[] => ['Hips', `${side}UpLeg`, `${side}Leg`, `${side}Foot`] as BoneName[];

function pelvis(b: PartBuilder, s: BodyShape, top: number, d: number): void {
  b.tube(inflate(sliceRings(s.torso, 1, 0.735, top, 7), d, 1.05), { slot: Slot.BOTTOM, bones: PELVIS_BONES, ref: [1, 0, 0], segments: 18, capStart: 'round', capEnd: 'open', capScale: 0.35 });
  b.tube(inflate(sliceRings(s.torso, 1, top - 0.03, top + 0.004, 2), d + 0.004, 1.05), { slot: Slot.BOTTOM_ACCENT, bones: PELVIS_BONES, ref: [1, 0, 0], segments: 18, capStart: 'open', capEnd: 'open' });
}

/** Leg tube from the hip down to `hemY`, radius offset `d` growing by `flare` toward the hem. */
function legTube(s: BodyShape, side: 'Left' | 'Right', hemY: number, d: number, flare: number, count = 8): RingSpec[] {
  const top = s.p.hipsY - 0.02;
  let rings = inflate(sliceRings(s.leg, 1, top, hemY, count), d, 1.0);
  rings = rings.map((r, i) => {
    const t = i / (rings.length - 1);
    const grow = flare * t;
    // Wide legs hang straight: center the tube a little forward/outward as it widens.
    return { ...r, ra: r.ra + grow, rb: r.rb + grow * 0.92, p: [r.p[0] + grow * 0.25, r.p[1], r.p[2] + grow * 0.1] };
  });
  return side === 'Left' ? rings : mirrorRings(rings);
}

export function buildBottom(b: PartBuilder, s: BodyShape, bottomId: string): void {
  switch (bottomId) {
    case 'bottom.shorts': {
      pelvis(b, s, 0.95, 0.014);
      for (const side of ['Left', 'Right'] as const) {
        b.tube(legTube(s, side, 0.565, 0.024, 0.014, 5), { slot: Slot.BOTTOM, bones: legBones(side), ref: [1, 0, 0], segments: 14, capStart: 'round', capEnd: 'open' });
        const cuff = inflate(sliceRings(s.leg, 1, 0.598, 0.56, 2), 0.043, 1.0);
        b.tube(side === 'Left' ? cuff : mirrorRings(cuff), {
          slot: Slot.BOTTOM_ACCENT,
          bones: legBones(side),
          ref: [1, 0, 0],
          segments: 14,
          capStart: 'open',
          capEnd: 'open',
        });
      }
      break;
    }
    case 'bottom.pants': {
      pelvis(b, s, 0.95, 0.014);
      for (const side of ['Left', 'Right'] as const) {
        b.tube(legTube(s, side, 0.105, 0.018, 0.012, 10), { slot: Slot.BOTTOM, bones: legBones(side), ref: [1, 0, 0], segments: 14, capStart: 'round', capEnd: 'open' });
      }
      break;
    }
    case 'bottom.skirt': {
      pelvis(b, s, 0.95, 0.014);
      // Narrow at the waist (stays inside long tops), flaring below the hip line.
      const profile: [number, number, number][] = [
        [0.94, 0.132, 0.095],
        [0.86, 0.148, 0.106],
        [0.78, 0.172, 0.13],
        [0.7, 0.2, 0.158],
        [0.62, 0.226, 0.182],
        [0.56, 0.242, 0.196],
      ];
      const rings: RingSpec[] = profile.map(([y, ra, rb], i) => ({ p: [0, y, -0.01 + i * 0.0025], ra: ra * s.girth, rb: rb * s.girth, n: 2.1 }));
      b.tube(rings, {
        slot: Slot.BOTTOM,
        bones: ['Hips', 'Spine', 'LeftUpLeg', 'RightUpLeg'],
        ref: [1, 0, 0],
        segments: 28,
        capStart: 'open',
        capEnd: 'open',
        ripple: { amp: 0.04, freq: 14 },
      });
      break;
    }
    case 'bottom.culottes':
    default: {
      pelvis(b, s, 0.95, 0.014);
      for (const side of ['Left', 'Right'] as const) {
        b.tube(legTube(s, side, 0.27, 0.026, 0.05, 9), { slot: Slot.BOTTOM, bones: legBones(side), ref: [1, 0, 0], segments: 16, capStart: 'round', capEnd: 'open' });
      }
      break;
    }
  }
}
