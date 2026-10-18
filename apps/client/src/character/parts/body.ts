/** Base body: torso, the sculpted head with its neck, arms, small mitten hands, legs and bare feet. */
import * as THREE from 'three';
import type { BoneName } from '../rig/GRARig';
import { ARM_Z, FOOT_STATIONS, mirrorRings, type BodyShape } from '../build/anatomy';
import { PartBuilder, Slot, type PrimitiveOpts, type V3 } from '../build/PartBuilder';
import { HEAD_FLAG } from '../build/head';

const TORSO_BONES: BoneName[] = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'LeftShoulder', 'RightShoulder', 'LeftUpLeg', 'RightUpLeg'];

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function buildBody(b: PartBuilder, s: BodyShape): void {
  // Torso: superellipse sweep from crotch to neck base, axis along +Y, `ra` across the shoulders (X).
  b.tube(s.torso, { slot: Slot.SKIN, bones: TORSO_BONES, ref: [1, 0, 0], segments: 18, capStart: 'round', capEnd: 'round', capScale: 0.4 });

  // Head and neck: the sculpted head (build/head.ts). The head is rigid on the Head bone; the neck stub under the jaw
  // blends down into Neck and Spine2 (explicit weights, continuous with the rigid head at the jaw seam); the ears are
  // their own region so long hair can hide them.
  const p = s.p;
  const m = s.head.mesh;
  const head: PrimitiveOpts = { slot: Slot.SKIN, region: 'head', bones: ['Head'] };
  const ears: PrimitiveOpts = { slot: Slot.SKIN, region: 'ears', bones: ['Head'] };
  const neck: PrimitiveOpts = { slot: Slot.SKIN, region: 'neck', bones: ['Spine2', 'Neck', 'Head'] };
  const base = b.pos.length / 3;
  b.mesh(m.positions, m.normals, m.index, head, (i) => (m.flags[i]! & HEAD_FLAG.NECK ? neck : m.flags[i]! & HEAD_FLAG.EAR ? ears : head));
  for (let i = 0; i < m.flags.length; i++) {
    if (!(m.flags[i]! & HEAD_FLAG.NECK)) continue;
    const y = m.positions[i * 3 + 1]!;
    const wHead = smooth(p.neckY + 0.01, p.headY - 0.002, y);
    const wSpine = (1 - smooth(p.neckY - 0.045, p.neckY + 0.005, y)) * (1 - wHead);
    b.setWeights(base + i, [['Head', wHead], ['Neck', 1 - wHead - wSpine], ['Spine2', wSpine]]);
  }

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
    buildHand(b, side, sx, p.wristX, p.shoulderY - 0.003, ARM_Z, p.handLen);
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
    b.tube(
      FOOT_STATIONS.map((f) => ({ p: [sx * p.legSocketX, f.y, f.z] as V3, ra: f.w, rb: f.h, n: 2.5, region: 'feet' as const })),
      { slot: Slot.SKIN, region: 'feet', bones: [`${side}Foot`, `${side}ToeBase`, `${side}Leg`] as BoneName[], ref: [1, 0, 0], segments: 12, capStart: 'round', capEnd: 'round', capScale: 0.7 },
    );
    // Big toe on the inner side of the front (reads as a foot, not a mitten).
    b.ellipsoid([sx * (p.legSocketX - 0.019), 0.017, 0.152], [0.012, 0.0145, 0.016], { slot: Slot.SKIN, region: 'feet', bones: [`${side}ToeBase`, `${side}Foot`] as BoneName[] }, 10, 7);
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
