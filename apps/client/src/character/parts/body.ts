/** Base body: the sculpted head with its neck, and the sculpted torso, arms, hands, legs and feet (bodySculpt.ts). */
import * as THREE from 'three';
import { createRig, type BoneName } from '../rig/GRARig';
import type { BodyShape } from '../build/anatomy';
import { PartBuilder, Slot, boneSegments, skinWeightsAt, type PrimitiveOpts } from '../build/PartBuilder';
import { HEAD_FLAG } from '../build/head';
import { bodySculpt } from '../build/bodySculpt';

const TORSO_BONES: BoneName[] = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'LeftShoulder', 'RightShoulder', 'LeftUpLeg', 'RightUpLeg'];

/** Bone sets of each limb, the same ones its garments use (sleeves, trouser legs, shoes), so they bend together. */
const side = (s: 'Left' | 'Right', names: string[]) => names.map((n) => `${s}${n}`) as BoneName[];
const LIMB = {
  arm: (s: 'Left' | 'Right') => side(s, ['Shoulder', 'Arm', 'ForeArm', 'Hand']),
  // Mitten-like: the four fingers curl together along the middle finger; the sculpt's thumb is tucked under the palm.
  hand: (s: 'Left' | 'Right') => side(s, ['ForeArm', 'Hand', 'HandMiddle1', 'HandMiddle2', 'HandMiddle3']),
  leg: (s: 'Left' | 'Right') => ['Hips', ...side(s, ['UpLeg', 'Leg', 'Foot'])] as BoneName[],
  foot: (s: 'Left' | 'Right') => side(s, ['Foot', 'ToeBase', 'Leg']),
};

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function buildBody(b: PartBuilder, s: BodyShape): void {
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
  buildSculpt(b, s);
}

/**
 * The sculpted torso, legs and feet. Each vertex is skinned with the trunk's bones, its limb's, or a blend of both
 * across the shoulders and hips (the foot's and the leg's across the ankle): both weightings are the distance-based
 * ones of PartBuilder, so the skin moves exactly like the garment shells built over it.
 */
function buildSculpt(b: PartBuilder, s: BodyShape): void {
  const sc = bodySculpt(s.sturdy);
  const rig = createRig(s.p);
  const segs = boneSegments(rig);
  // Bones are placeholders: every vertex gets explicit weights below. Pieces sunk inside another draw no ink hull.
  const opts = new Map<string, PrimitiveOpts>();
  const optsFor = (i: number) => {
    const region = sc.region[i]!;
    const key = `${region}|${sc.hidden[i]}`;
    let o = opts.get(key);
    if (!o) opts.set(key, (o = { slot: Slot.SKIN, region, bones: TORSO_BONES, outline: sc.hidden[i] ? 0 : 1 }));
    return o;
  };
  const base = b.pos.length / 3;
  b.mesh(sc.positions, sc.normals, sc.index, optsFor(0), optsFor);

  const inPart = (i: number, part: 'torso' | 'legs' | 'feet') => i >= sc.parts[part][0] && i < sc.parts[part][0] + sc.parts[part][1];
  const pt = new THREE.Vector3();
  const weights = new Map<number, number>();
  const add = (list: [number, number][], k: number) => {
    for (const [bone, w] of list) weights.set(bone, (weights.get(bone) ?? 0) + w * k);
  };
  for (let i = 0; i < sc.blend.length; i++) {
    pt.fromArray(sc.positions, i * 3);
    const limbSide = pt.x >= 0 ? 'Left' : 'Right';
    const t = sc.blend[i]!;
    let from: BoneName[];
    let to: BoneName[];
    if (inPart(i, 'feet')) {
      from = LIMB.leg(limbSide);
      to = LIMB.foot(limbSide);
    } else {
      from = TORSO_BONES;
      to = inPart(i, 'legs') ? LIMB.leg(limbSide) : sc.region[i] === 'hands' ? (sc.thumb[i] ? [`${limbSide}Hand`] : LIMB.hand(limbSide)) : LIMB.arm(limbSide);
    }
    weights.clear();
    if (t < 1) add(skinWeightsAt(pt, from, from === TORSO_BONES, segs, rig), 1 - t);
    if (t > 0) add(skinWeightsAt(pt, to, false, segs, rig), t);
    const top = [...weights].sort((x, y) => y[1] - x[1]).slice(0, 4);
    const sum = top.reduce((a, [, w]) => a + w, 0);
    b.setWeights(base + i, top.map(([bone, w]) => [rig.defs[bone]!.name, w / sum]));
  }
}
