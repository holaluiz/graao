/** Bottoms: pelvis shell from the torso rings + leg tubes from the leg rings, with flares and bands. */
import type { BoneName } from '../rig/GRARig';
import { inflate, mirrorRings, ringAt, sliceRings, torsoPoint, type BodyShape } from '../build/anatomy';
import { PartBuilder, Slot, type RingSpec, type V3 } from '../build/PartBuilder';

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

/** Track stripe down the outer side of a leg tube. */
function sideStripe(b: PartBuilder, rings: RingSpec[], side: 'Left' | 'Right', width: number): void {
  const sx = side === 'Left' ? 1 : -1;
  b.tube(
    rings.map((r) => ({ p: [r.p[0] + sx * (r.ra + 0.0015), r.p[1], r.p[2]] as V3, ra: 0.0025, rb: width })),
    { slot: Slot.BOTTOM_DETAIL, bones: legBones(side), ref: [sx, 0, 0], segments: 6, capStart: 'flat', capEnd: 'flat', outline: 0.2 },
  );
}

/** Band around a leg tube between two heights, standing `lift` off it. */
function legBand(b: PartBuilder, rings: RingSpec[], side: 'Left' | 'Right', yTop: number, yBottom: number, lift: number, slot: (typeof Slot)[keyof typeof Slot]): void {
  const band = [ringAt(rings, 1, yTop), ringAt(rings, 1, yBottom)].map((r) => ({ ...r, ra: r.ra + lift, rb: r.rb + lift }));
  b.tube(band, { slot, bones: legBones(side), ref: [1, 0, 0], segments: 16, capStart: 'open', capEnd: 'open' });
}

/** Full skirt from a (y, ra, rb) profile, centered under the hips, with pleat ripple. */
function skirtRings(s: BodyShape, profile: [number, number, number][], dz = 0.0025): RingSpec[] {
  return profile.map(([y, ra, rb], i) => ({ p: [0, y, -0.01 + i * dz], ra: ra * s.girth, rb: rb * s.girth, n: 2.1 }));
}
const SKIRT_BONES: BoneName[] = ['Hips', 'Spine', 'LeftUpLeg', 'RightUpLeg'];

export function buildBottom(b: PartBuilder, s: BodyShape, bottomId: string): void {
  switch (bottomId) {
    case 'bottom.tactel': {
      // Long, wide nylon shorts past the knee, with a track stripe on each side.
      pelvis(b, s, 0.95, 0.014);
      for (const side of ['Left', 'Right'] as const) {
        const rings = legTube(s, side, 0.4, 0.03, 0.03, 8);
        b.tube(rings, { slot: Slot.BOTTOM, bones: legBones(side), ref: [1, 0, 0], segments: 16, capStart: 'round', capEnd: 'open' });
        sideStripe(b, rings.slice(1), side, 0.009);
        legBand(b, rings, side, 0.425, 0.4, 0.003, Slot.BOTTOM_ACCENT);
      }
      break;
    }
    case 'bottom.jogger': {
      // Tapered sweatpants gathered into ankle cuffs, side stripe.
      pelvis(b, s, 0.95, 0.014);
      for (const side of ['Left', 'Right'] as const) {
        const rings = legTube(s, side, 0.15, 0.022, -0.004, 10);
        b.tube(rings, { slot: Slot.BOTTOM, bones: legBones(side), ref: [1, 0, 0], segments: 14, capStart: 'round', capEnd: 'open' });
        sideStripe(b, rings.slice(1), side, 0.007);
        const cuff = inflate(sliceRings(s.leg, 1, 0.165, 0.1, 3), 0.014, 1.0);
        b.tube(side === 'Left' ? cuff : mirrorRings(cuff), { slot: Slot.BOTTOM_ACCENT, bones: legBones(side), ref: [1, 0, 0], segments: 14, capStart: 'open', capEnd: 'open' });
      }
      break;
    }
    case 'bottom.capoeira': {
      // Loose abadá pants with a corda tied low on the hips: knot on the left front, two ends with tips.
      pelvis(b, s, 0.95, 0.016);
      for (const side of ['Left', 'Right'] as const) {
        const rings = legTube(s, side, 0.12, 0.03, 0.035, 10);
        b.tube(rings, { slot: Slot.BOTTOM, bones: legBones(side), ref: [1, 0, 0], segments: 16, capStart: 'round', capEnd: 'open' });
        legBand(b, rings, side, 0.15, 0.12, 0.004, Slot.BOTTOM_ACCENT);
      }
      const cord: V3[] = [];
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        cord.push(torsoPoint(s, 0.836 - 0.008 * Math.cos(a), a, 0.028, 1.05).p);
      }
      b.loop(cord, 0.0065, 0.0065, { slot: Slot.BOTTOM_DETAIL, bones: ['Hips', 'Spine'] }, 6);
      const knot = torsoPoint(s, 0.83, 0.5, 0.034, 1.05).p;
      b.ellipsoid(knot, [0.014, 0.012, 0.01], { slot: Slot.BOTTOM_DETAIL, bones: ['Hips', 'LeftUpLeg'] }, 10, 6);
      for (const [dx, len] of [[0.008, 0.2], [-0.012, 0.165]] as const) {
        const end: V3 = [knot[0] + dx, knot[1] - len, knot[2] + 0.014];
        b.tube(
          [
            { p: knot, ra: 0.0055, rb: 0.0055 },
            { p: [knot[0] + dx * 0.5, knot[1] - len * 0.45, knot[2] + 0.016], ra: 0.0055, rb: 0.0055 },
            { p: end, ra: 0.0055, rb: 0.0055 },
          ],
          { slot: Slot.BOTTOM_DETAIL, bones: ['Hips', 'LeftUpLeg'], ref: [1, 0, 0], segments: 6, capStart: 'round', capEnd: 'flat' },
        );
        b.ellipsoid([end[0], end[1] - 0.008, end[2]], [0.009, 0.014, 0.009], { slot: Slot.POLLEN, bones: ['Hips', 'LeftUpLeg'] }, 8, 5);
      }
      break;
    }
    case 'bottom.rodada': {
      // Festa junina skirt: long and full, two ribbons around it and a ruffled hem.
      pelvis(b, s, 0.95, 0.014);
      const pleats = { amp: 0.05, freq: 12 };
      const rings = skirtRings(s, [
        [0.94, 0.132, 0.095],
        [0.86, 0.152, 0.11],
        [0.76, 0.19, 0.15],
        [0.64, 0.235, 0.195],
        [0.52, 0.27, 0.23],
        [0.42, 0.29, 0.25],
        [0.34, 0.3, 0.262],
      ]);
      b.tube(rings, { slot: Slot.BOTTOM, bones: SKIRT_BONES, ref: [1, 0, 0], segments: 32, capStart: 'open', capEnd: 'open', ripple: pleats });
      for (const [y, slot] of [[0.56, Slot.BOTTOM_DETAIL], [0.5, Slot.POLLEN]] as const) {
        const band = [ringAt(rings, 1, y + 0.012), ringAt(rings, 1, y - 0.012)].map((r) => ({ ...r, ra: r.ra + 0.008, rb: r.rb + 0.008 }));
        b.tube(band, { slot, bones: SKIRT_BONES, ref: [1, 0, 0], segments: 32, capStart: 'open', capEnd: 'open', ripple: pleats });
      }
      b.tube(
        skirtRings(s, [
          [0.36, 0.305, 0.266],
          [0.3, 0.33, 0.29],
          [0.25, 0.336, 0.296],
        ], 0.002).map((r) => ({ ...r, p: [0, r.p[1], 0.008 + r.p[2]] as V3 })),
        { slot: Slot.BOTTOM_ACCENT, bones: SKIRT_BONES, ref: [1, 0, 0], segments: 44, capStart: 'open', capEnd: 'open', ripple: { amp: 0.07, freq: 22 } },
      );
      break;
    }
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
