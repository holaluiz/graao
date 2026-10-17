import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { buildSkeleton, createRig } from '../rig/GRARig';
import { normalizeBoneName } from '../rig/MixamoBoneMap';
import { retarget } from './Retargeter';

async function loadPack(n: 1 | 2) {
  const buf = readFileSync(new URL(`../../../public/assets/v1/animations/ual${n}-clips.glb`, import.meta.url));
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader.parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, '');
}

/** Bone positions relative to the hips, in a character frame (left, up, forward) of the hierarchy at time t. */
function relativePose(root: THREE.Object3D, clip: THREE.AnimationClip | null, t: number, names: string[], frameFrom: THREE.Object3D) {
  const mixer = new THREE.AnimationMixer(root);
  if (clip) {
    mixer.clipAction(clip).play();
    mixer.setTime(t);
  }
  root.updateMatrixWorld(true);
  const byCanon = new Map<string, THREE.Object3D>();
  root.traverse((o) => {
    const c = normalizeBoneName(o.name);
    if (c && !byCanon.has(c)) byCanon.set(c, o);
  });
  void frameFrom;
  const P = (n: string) => byCanon.get(n)!.getWorldPosition(new THREE.Vector3());
  const hips = P('Hips');
  const out: Record<string, THREE.Vector3> = {};
  for (const n of names) out[n] = P(n).sub(hips);
  mixer.stopAllAction();
  return out;
}

describe('Retargeter (UAL → GRA_Rig_MixamoCompatible)', async () => {
  const gltf = await loadPack(1);
  const rig = createRig();
  const ref = gltf.animations.find((a) => a.name === 'A_TPose')!;
  const idle = gltf.animations.find((a) => a.name === 'Idle_Loop')!;
  const run = gltf.animations.find((a) => a.name === 'Jog_Fwd_Loop')!;
  const { clips, report } = retarget({ root: gltf.scene, clips: [ref, idle, run], referenceClip: ref }, rig);

  it('maps every humanoid bone and finds a T-pose reference', () => {
    expect(report.mapped).toBeGreaterThanOrEqual(50);
    expect(Math.abs(report.armPitchDeg)).toBeLessThan(10);
  });

  it('reproduces the source limb directions on the graao skeleton', () => {
    // Source: canonical frame from its reference pose.
    const srcRef = relativePose(gltf.scene, ref, 0, ['Head', 'LeftArm', 'RightArm'], gltf.scene);
    const up = srcRef.Head!.clone().normalize();
    const left = srcRef.LeftArm!.clone().sub(srcRef.RightArm!);
    left.addScaledVector(up, -left.dot(up)).normalize();
    const fwd = new THREE.Vector3().crossVectors(left, up);
    const toFrame = (v: THREE.Vector3) => new THREE.Vector3(v.dot(left), v.dot(up), v.dot(fwd));

    const segments: [string, string][] = [
      ['LeftArm', 'LeftForeArm'], ['LeftForeArm', 'LeftHand'], ['RightArm', 'RightForeArm'], ['RightForeArm', 'RightHand'],
      ['LeftUpLeg', 'LeftLeg'], ['LeftLeg', 'LeftFoot'], ['RightUpLeg', 'RightLeg'], ['RightLeg', 'RightFoot'],
      ['Spine1', 'Neck'], ['Neck', 'Head'], ['LeftFoot', 'LeftToeBase'],
    ];
    const names = [...new Set(segments.flat())];
    for (const [clip, t] of [
      [idle, 0.5],
      [run, 0.3],
    ] as const) {
      const src = relativePose(gltf.scene, clip, t, names, gltf.scene);
      const { root } = buildSkeleton(rig);
      const holder = new THREE.Group();
      holder.add(root);
      const out = clips.find((c) => c.name === clip.name)!;
      const tgt = relativePose(holder, out, t, names, holder);
      for (const [p, c] of segments) {
        const a = toFrame(src[c]!.clone().sub(src[p]!)).normalize();
        const b = tgt[c]!.clone().sub(tgt[p]!).normalize();
        const angle = THREE.MathUtils.radToDeg(a.angleTo(b));
        // Retargeting must preserve every bone direction (proportions may differ, directions may not).
        expect(angle, `${clip.name} ${p}→${c}: src ${a.toArray().map((x) => x.toFixed(2))} tgt ${b.toArray().map((x) => x.toFixed(2))}`).toBeLessThan(4);
      }
    }
  });

  it('keeps in-place clips in place (no horizontal root drift)', () => {
    const out = clips.find((c) => c.name === 'Jog_Fwd_Loop')!;
    const track = out.tracks.find((t) => t.name === 'Hips.position')!;
    const v = track.values;
    const n = v.length / 3;
    expect(Math.abs(v[0]! - v[(n - 1) * 3]!)).toBeLessThan(1e-4);
    expect(Math.abs(v[2]! - v[(n - 1) * 3 + 2]!)).toBeLessThan(1e-4);
  });
});
