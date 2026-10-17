/** Base body: torso, neck, head (nose, ears), arms, small mitten hands, legs and bare feet. */
import * as THREE from 'three';
import type { BoneName } from '../rig/GRARig';
import { mirrorRings, type BodyShape } from '../build/anatomy';
import { PartBuilder, Slot, type V3 } from '../build/PartBuilder';

const TORSO_BONES: BoneName[] = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'LeftShoulder', 'RightShoulder', 'LeftUpLeg', 'RightUpLeg'];

export function buildBody(b: PartBuilder, s: BodyShape): void {
  // Torso: superellipse sweep from crotch to neck base, axis along +Y, `ra` across the shoulders (X).
  b.tube(s.torso, { slot: Slot.SKIN, bones: TORSO_BONES, ref: [1, 0, 0], segments: 18, capStart: 'round', capEnd: 'round', capScale: 0.4 });

  // Neck.
  const p = s.p;
  b.tube(
    [
      { p: [0, 1.255, -0.016], ra: 0.042, rb: 0.04, region: 'neck' },
      { p: [0, 1.33, -0.012], ra: 0.037, rb: 0.035, region: 'neck' },
      { p: [0, 1.395, -0.004], ra: 0.036, rb: 0.034, region: 'neck' },
    ],
    { slot: Slot.SKIN, bones: ['Spine2', 'Neck', 'Head'], ref: [1, 0, 0], segments: 10, capStart: 'flat', capEnd: 'flat' },
  );

  // Head.
  const h = s.head;
  b.starSurface((d) => h.surface(d), 22, 16, { slot: Slot.SKIN, region: 'head', bones: ['Head'] });
  // Ears (mostly hidden by hair; they keep the side silhouette human).
  for (const sx of [1, -1]) {
    b.ellipsoid([sx * (h.a * 0.93), h.center[1] - 0.012, h.center[2] - 0.008], [0.018, 0.03, 0.022], { slot: Slot.SKIN, region: 'head', bones: ['Head'] }, 8, 6);
  }
  // Nose: a small soft wedge.
  const nose = h.frontPoint(0, -0.03, -0.004);
  if (nose) b.ellipsoid([nose.p[0], nose.p[1], nose.p[2]], [0.011, 0.017, 0.012], { slot: Slot.SKIN, region: 'head', bones: ['Head'], outline: 0.5 }, 8, 6);

  // Arms and hands.
  for (const side of ['Left', 'Right'] as const) {
    const sx = side === 'Left' ? 1 : -1;
    const rings = side === 'Left' ? s.arm : mirrorRings(s.arm);
    b.tube(rings, {
      slot: Slot.SKIN,
      bones: [`${side}Shoulder`, `${side}Arm`, `${side}ForeArm`, `${side}Hand`] as BoneName[],
      ref: [0, 1, 0],
      segments: 12,
      capStart: 'round',
      capEnd: 'round',
      capScale: 0.6,
    });
    buildHand(b, side, sx, p.wristX, p.shoulderY - 0.003, -0.015, p.handLen);
  }

  // Legs and feet.
  for (const side of ['Left', 'Right'] as const) {
    const sx = side === 'Left' ? 1 : -1;
    const rings = side === 'Left' ? s.leg : mirrorRings(s.leg);
    b.tube(rings, {
      slot: Slot.SKIN,
      bones: ['Hips', `${side}UpLeg`, `${side}Leg`, `${side}Foot`] as BoneName[],
      ref: [1, 0, 0],
      segments: 12,
      capStart: 'round',
      capEnd: 'round',
      capScale: 0.5,
    });
    b.ellipsoid([sx * p.legSocketX, 0.04, 0.045], [0.04, 0.038, 0.1], {
      slot: Slot.SKIN,
      region: 'feet',
      bones: [`${side}Foot`, `${side}ToeBase`, `${side}Leg`] as BoneName[],
    }, 10, 8);
  }
}

/** Mitten-like hand: palm, a single finger block (follows the middle finger) and a thumb. */
function buildHand(b: PartBuilder, side: 'Left' | 'Right', sx: number, wx: number, y: number, z: number, len: number): void {
  const bones = (names: string[]) => names.map((n) => `${side}${n}`) as BoneName[];
  b.ellipsoid([sx * (wx + len * 0.28), y - 0.004, z], [len * 0.33, 0.017, 0.034], { slot: Slot.SKIN, region: 'hands', bones: bones(['Hand', 'ForeArm']) }, 10, 8);
  b.ellipsoid([sx * (wx + len * 0.72), y - 0.006, z - 0.002], [len * 0.3, 0.0135, 0.031], {
    slot: Slot.SKIN,
    region: 'hands',
    bones: bones(['Hand', 'HandMiddle1', 'HandMiddle2', 'HandMiddle3']),
  }, 10, 8);
  const t0: V3 = [sx * (wx + 0.012), y - 0.01, z + 0.02];
  const t1: V3 = [sx * (wx + 0.04), y - 0.016, z + 0.04];
  const t2: V3 = [sx * (wx + 0.062), y - 0.018, z + 0.05];
  b.tube(
    [
      { p: t0, ra: 0.012, rb: 0.012, region: 'hands' },
      { p: t1, ra: 0.0115, rb: 0.011, region: 'hands' },
      { p: t2, ra: 0.0095, rb: 0.0095, region: 'hands' },
    ],
    { slot: Slot.SKIN, bones: bones(['Hand', 'HandThumb1', 'HandThumb2', 'HandThumb3']), ref: [0, 1, 0], segments: 8 },
  );
}

/** Rotation helper for parts that need tilted primitives. */
export function rotY(rad: number): THREE.Matrix3 {
  return new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationY(rad));
}
