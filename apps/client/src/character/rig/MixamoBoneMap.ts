/**
 * MixamoBoneNormalizer / MixamoBoneMap: maps bone names from external rigs onto canonical `GRA_Rig_MixamoCompatible`
 * ids. Handles Mixamo namespaces (`mixamorig:Hips`, `mixamorig1:Hips`, `mixamorig_Hips`, and `mixamorigHips` after
 * Three's PropertyBinding sanitization) and the UE/Quaternius naming used by the CC0 Universal Animation Library.
 */
import type { BoneName } from './GRARig';

const CANONICAL: readonly BoneName[] = [
  'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'HeadTop_End',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
  'LeftHandThumb1', 'LeftHandThumb2', 'LeftHandThumb3',
  'LeftHandIndex1', 'LeftHandIndex2', 'LeftHandIndex3',
  'LeftHandMiddle1', 'LeftHandMiddle2', 'LeftHandMiddle3',
  'LeftHandRing1', 'LeftHandRing2', 'LeftHandRing3',
  'LeftHandPinky1', 'LeftHandPinky2', 'LeftHandPinky3',
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
  'RightHandThumb1', 'RightHandThumb2', 'RightHandThumb3',
  'RightHandIndex1', 'RightHandIndex2', 'RightHandIndex3',
  'RightHandMiddle1', 'RightHandMiddle2', 'RightHandMiddle3',
  'RightHandRing1', 'RightHandRing2', 'RightHandRing3',
  'RightHandPinky1', 'RightHandPinky2', 'RightHandPinky3',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'LeftToe_End',
  'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase', 'RightToe_End',
];
const CANONICAL_SET: ReadonlySet<string> = new Set(CANONICAL);

/** UE5 / Quaternius UAL names → canonical. Fingers `_04_leaf` are tip helpers and map to nothing. */
const UE_MAP: Record<string, BoneName> = {
  pelvis: 'Hips',
  spine_01: 'Spine',
  spine_02: 'Spine1',
  spine_03: 'Spine2',
  neck_01: 'Neck',
  head: 'Head',
  clavicle_l: 'LeftShoulder',
  upperarm_l: 'LeftArm',
  lowerarm_l: 'LeftForeArm',
  hand_l: 'LeftHand',
  clavicle_r: 'RightShoulder',
  upperarm_r: 'RightArm',
  lowerarm_r: 'RightForeArm',
  hand_r: 'RightHand',
  thigh_l: 'LeftUpLeg',
  calf_l: 'LeftLeg',
  foot_l: 'LeftFoot',
  ball_l: 'LeftToeBase',
  ball_leaf_l: 'LeftToe_End',
  thigh_r: 'RightUpLeg',
  calf_r: 'RightLeg',
  foot_r: 'RightFoot',
  ball_r: 'RightToeBase',
  ball_leaf_r: 'RightToe_End',
};
const UE_FINGERS: Record<string, string> = { thumb: 'Thumb', index: 'Index', middle: 'Middle', ring: 'Ring', pinky: 'Pinky' };

/** Known alternate spellings seen in Mixamo exports and other humanoid rigs. */
const ALIASES: Record<string, BoneName> = {
  Chest: 'Spine2',
  UpperChest: 'Spine2',
  LeftToe: 'LeftToeBase',
  RightToe: 'RightToeBase',
  HeadTop: 'HeadTop_End',
  LeftUpperLeg: 'LeftUpLeg',
  RightUpperLeg: 'RightUpLeg',
  LeftLowerLeg: 'LeftLeg',
  RightLowerLeg: 'RightLeg',
  LeftUpperArm: 'LeftArm',
  RightUpperArm: 'RightArm',
  LeftLowerArm: 'LeftForeArm',
  RightLowerArm: 'RightForeArm',
};

/** Strips Mixamo namespaces: `mixamorig:`, `mixamorig1:`, `mixamorig_`, and the sanitized `mixamorig` prefix. */
export function stripMixamoPrefix(name: string): string {
  return name.replace(/^mixamorig\d*[:_]?/i, '').replace(/^.*[:|]/, '');
}

/** Returns the canonical bone id for an external bone name, or null when it has no counterpart. */
export function normalizeBoneName(name: string): BoneName | null {
  const stripped = stripMixamoPrefix(name);
  if (CANONICAL_SET.has(stripped)) return stripped as BoneName;
  const alias = ALIASES[stripped];
  if (alias) return alias;
  const lower = stripped.toLowerCase();
  const ue = UE_MAP[lower];
  if (ue) return ue;
  const m = /^(thumb|index|middle|ring|pinky)_0([1-3])_([lr])$/.exec(lower);
  if (m) {
    const side = m[3] === 'l' ? 'Left' : 'Right';
    return `${side}Hand${UE_FINGERS[m[1]!]}${m[2]}` as BoneName;
  }
  return null;
}

/** Builds a source-name → canonical map for a list of source bone names (unmapped names are omitted). */
export function buildBoneMap(sourceNames: Iterable<string>): Map<string, BoneName> {
  const out = new Map<string, BoneName>();
  for (const n of sourceNames) {
    const c = normalizeBoneName(n);
    if (c && ![...out.values()].includes(c)) out.set(n, c);
  }
  return out;
}

export const CANONICAL_BONES = CANONICAL;
