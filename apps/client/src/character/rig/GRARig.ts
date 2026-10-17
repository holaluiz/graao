/**
 * GRA_Rig_MixamoCompatible: the canonical graao humanoid skeleton.
 *
 * - Hierarchy and names follow the conventional Mixamo humanoid (without the `mixamorig:` namespace). Gameplay and
 *   rendering code refer to these canonical ids only; `MixamoBoneMap` normalizes external names onto them.
 * - One bind pose for every character and every deforming piece: a T-pose, character facing +Z, up +Y, the
 *   character's LEFT on +X, meters. Every bind rotation is identity, so bone local frames are axis-aligned; clips are
 *   retargeted onto this pose (see `animation/Retargeter.ts`).
 * - Proportions are graao's own (Messenger-inspired principles: ≈ 5.6 heads, legs ≈ 49 %, thin limbs, small hands).
 */
import * as THREE from 'three';

export type BoneName =
  | 'Hips' | 'Spine' | 'Spine1' | 'Spine2' | 'Neck' | 'Head' | 'HeadTop_End'
  | 'LeftShoulder' | 'LeftArm' | 'LeftForeArm' | 'LeftHand'
  | 'LeftHandThumb1' | 'LeftHandThumb2' | 'LeftHandThumb3'
  | 'LeftHandIndex1' | 'LeftHandIndex2' | 'LeftHandIndex3'
  | 'LeftHandMiddle1' | 'LeftHandMiddle2' | 'LeftHandMiddle3'
  | 'LeftHandRing1' | 'LeftHandRing2' | 'LeftHandRing3'
  | 'LeftHandPinky1' | 'LeftHandPinky2' | 'LeftHandPinky3'
  | 'RightShoulder' | 'RightArm' | 'RightForeArm' | 'RightHand'
  | 'RightHandThumb1' | 'RightHandThumb2' | 'RightHandThumb3'
  | 'RightHandIndex1' | 'RightHandIndex2' | 'RightHandIndex3'
  | 'RightHandMiddle1' | 'RightHandMiddle2' | 'RightHandMiddle3'
  | 'RightHandRing1' | 'RightHandRing2' | 'RightHandRing3'
  | 'RightHandPinky1' | 'RightHandPinky2' | 'RightHandPinky3'
  | 'LeftUpLeg' | 'LeftLeg' | 'LeftFoot' | 'LeftToeBase' | 'LeftToe_End'
  | 'RightUpLeg' | 'RightLeg' | 'RightFoot' | 'RightToeBase' | 'RightToe_End';

export interface RigBoneDef {
  name: BoneName;
  parent: BoneName | null;
  /** Bind (T-pose) position in rig space, meters. */
  pos: [number, number, number];
  side: 'L' | 'R' | 'C';
}

/** Body proportions in meters (rig space). Two body types share the skeleton topology. */
export interface RigProportions {
  hipsY: number;
  legSocketX: number;
  kneeY: number;
  ankleY: number;
  spineY: number;
  spine1Y: number;
  chestY: number;
  neckY: number;
  headY: number;
  headTopY: number;
  shoulderY: number;
  clavicleX: number;
  shoulderX: number;
  elbowX: number;
  wristX: number;
  handLen: number;
  toeZ: number;
  toeEndZ: number;
}

export const SLIM: RigProportions = {
  hipsY: 0.86,
  legSocketX: 0.085,
  kneeY: 0.44,
  ankleY: 0.085,
  spineY: 0.96,
  spine1Y: 1.06,
  chestY: 1.16,
  neckY: 1.3,
  headY: 1.37,
  headTopY: 1.62,
  shoulderY: 1.255,
  clavicleX: 0.035,
  shoulderX: 0.155,
  elbowX: 0.415,
  wristX: 0.65,
  handLen: 0.125,
  toeZ: 0.115,
  toeEndZ: 0.2,
};

export const STURDY: RigProportions = { ...SLIM, shoulderX: 0.172, elbowX: 0.43, wristX: 0.665, legSocketX: 0.095 };

export function rigDefinition(p: RigProportions = SLIM): RigBoneDef[] {
  const defs: RigBoneDef[] = [
    { name: 'Hips', parent: null, pos: [0, p.hipsY, 0], side: 'C' },
    { name: 'Spine', parent: 'Hips', pos: [0, p.spineY, -0.005], side: 'C' },
    { name: 'Spine1', parent: 'Spine', pos: [0, p.spine1Y, -0.01], side: 'C' },
    { name: 'Spine2', parent: 'Spine1', pos: [0, p.chestY, -0.012], side: 'C' },
    { name: 'Neck', parent: 'Spine2', pos: [0, p.neckY, -0.015], side: 'C' },
    { name: 'Head', parent: 'Neck', pos: [0, p.headY, -0.005], side: 'C' },
    { name: 'HeadTop_End', parent: 'Head', pos: [0, p.headTopY, -0.005], side: 'C' },
  ];
  for (const s of ['Left', 'Right'] as const) {
    const sx = s === 'Left' ? 1 : -1;
    const side = s === 'Left' ? 'L' : 'R';
    const y = p.shoulderY;
    const z = -0.015;
    defs.push(
      { name: `${s}Shoulder`, parent: 'Spine2', pos: [sx * p.clavicleX, y + 0.005, -0.01], side },
      { name: `${s}Arm`, parent: `${s}Shoulder`, pos: [sx * p.shoulderX, y, z], side },
      { name: `${s}ForeArm`, parent: `${s}Arm`, pos: [sx * p.elbowX, y, z], side },
      { name: `${s}Hand`, parent: `${s}ForeArm`, pos: [sx * p.wristX, y, z], side },
    );
    const hx = p.wristX;
    const L = p.handLen;
    // Fingers: palm ≈ 55 % of the hand, three phalanges over the rest. Thumb leaves forward (+Z) and down a bit.
    const fingers: [string, number][] = [
      ['Index', 0.022],
      ['Middle', 0.004],
      ['Ring', -0.013],
      ['Pinky', -0.028],
    ];
    for (const [f, fz] of fingers) {
      const base = hx + L * 0.55;
      const seg = (L * 0.45) / 3;
      defs.push(
        { name: `${s}Hand${f}1` as BoneName, parent: `${s}Hand`, pos: [sx * base, y, z + fz], side },
        { name: `${s}Hand${f}2` as BoneName, parent: `${s}Hand${f}1` as BoneName, pos: [sx * (base + seg), y, z + fz], side },
        { name: `${s}Hand${f}3` as BoneName, parent: `${s}Hand${f}2` as BoneName, pos: [sx * (base + seg * 2), y, z + fz], side },
      );
    }
    defs.push(
      { name: `${s}HandThumb1` as BoneName, parent: `${s}Hand`, pos: [sx * (hx + 0.022), y - 0.012, z + 0.022], side },
      { name: `${s}HandThumb2` as BoneName, parent: `${s}HandThumb1` as BoneName, pos: [sx * (hx + 0.045), y - 0.016, z + 0.04], side },
      { name: `${s}HandThumb3` as BoneName, parent: `${s}HandThumb2` as BoneName, pos: [sx * (hx + 0.065), y - 0.018, z + 0.052], side },
    );
  }
  for (const s of ['Left', 'Right'] as const) {
    const sx = s === 'Left' ? 1 : -1;
    const side = s === 'Left' ? 'L' : 'R';
    const x = sx * p.legSocketX;
    defs.push(
      { name: `${s}UpLeg`, parent: 'Hips', pos: [x, p.hipsY - 0.06, 0], side },
      { name: `${s}Leg`, parent: `${s}UpLeg`, pos: [x, p.kneeY, 0.012], side },
      { name: `${s}Foot`, parent: `${s}Leg`, pos: [x, p.ankleY, -0.012], side },
      { name: `${s}ToeBase`, parent: `${s}Foot`, pos: [x, 0.025, p.toeZ], side },
      { name: `${s}Toe_End`, parent: `${s}ToeBase`, pos: [x, 0.025, p.toeEndZ], side },
    );
  }
  return defs;
}

export interface GRARig {
  defs: RigBoneDef[];
  byName: Map<BoneName, RigBoneDef>;
  index: Map<BoneName, number>;
  proportions: RigProportions;
}

export function createRig(p: RigProportions = SLIM): GRARig {
  const defs = rigDefinition(p);
  return {
    defs,
    byName: new Map(defs.map((d) => [d.name, d])),
    index: new Map(defs.map((d, i) => [d.name, i])),
    proportions: p,
  };
}

/** Builds a live THREE.Skeleton for the rig (one per character instance). Bone local positions are parent-relative. */
export function buildSkeleton(rig: GRARig): { root: THREE.Bone; bones: THREE.Bone[]; skeleton: THREE.Skeleton } {
  const bones: THREE.Bone[] = [];
  const byName = new Map<string, THREE.Bone>();
  for (const d of rig.defs) {
    const b = new THREE.Bone();
    b.name = d.name;
    const parent = d.parent ? rig.byName.get(d.parent)! : null;
    b.position.set(d.pos[0] - (parent?.pos[0] ?? 0), d.pos[1] - (parent?.pos[1] ?? 0), d.pos[2] - (parent?.pos[2] ?? 0));
    if (d.parent) byName.get(d.parent)!.add(b);
    byName.set(d.name, b);
    bones.push(b);
  }
  const root = bones[0]!;
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  return { root, bones, skeleton };
}

/** Bones that deform the mesh (fingertip/end bones only exist for clip compatibility). */
export const END_BONES: ReadonlySet<BoneName> = new Set(['HeadTop_End', 'LeftToe_End', 'RightToe_End']);
