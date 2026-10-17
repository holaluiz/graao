/**
 * Retargets clips from any humanoid source skeleton (Mixamo FBX, Quaternius UAL GLB, …) onto GRA_Rig_MixamoCompatible.
 *
 * World-space delta method with per-bone direction alignment:
 *   C       = rotation from the source character frame (left, up, forward) to the graao frame (+X, +Y, +Z)
 *   Ws(t)   = source bone world rotation at time t (Three evaluates the clip on the source hierarchy)
 *   Wref    = Ralign · Ws(reference pose), where Ralign turns the source reference bone direction onto the graao
 *             bind direction (handles A-pose vs T-pose and posture differences)
 *   Wt(t)   = C · Ws(t) · Wref⁻¹ · C⁻¹       (graao bind world rotations are identity)
 *   Lt(t)   = Wt(parent)⁻¹ · Wt(bone)
 * Hips translation is scaled by the hip-height ratio. Horizontal root motion is removed (movement belongs to the
 * gameplay capsule, never to animation).
 */
import * as THREE from 'three';
import { boneSegments } from '../build/PartBuilder';
import type { BoneName, GRARig } from '../rig/GRARig';
import { normalizeBoneName } from '../rig/MixamoBoneMap';

export interface RetargetSource {
  /** Source scene/hierarchy containing the bones. */
  root: THREE.Object3D;
  clips: THREE.AnimationClip[];
  /** Clip whose first frame is the reference pose (e.g. UAL `A_TPose`); otherwise the hierarchy's current pose. */
  referenceClip?: THREE.AnimationClip;
}

export interface RetargetOptions {
  fps?: number;
  /** Keep vertical hips motion but remove drift on the tangent plane. */
  inPlace?: boolean;
}

export interface RetargetReport {
  mapped: number;
  unmapped: string[];
  facingCorrectionDeg: number;
  hipScale: number;
  armPitchDeg: number;
}

export function retarget(src: RetargetSource, rig: GRARig, opts: RetargetOptions = {}): { clips: THREE.AnimationClip[]; report: RetargetReport } {
  const fps = opts.fps ?? 30;
  const inPlace = opts.inPlace ?? true;

  // Map canonical → source node (first match wins).
  const nodes = new Map<BoneName, THREE.Object3D>();
  const unmapped: string[] = [];
  src.root.traverse((o) => {
    const c = normalizeBoneName(o.name);
    if (c && !nodes.has(c)) nodes.set(c, o);
    else if (!c && (o as THREE.Bone).isBone) unmapped.push(o.name);
  });

  const mixer = new THREE.AnimationMixer(src.root);
  const sampleTo = (clip: THREE.AnimationClip | undefined, t: number) => {
    if (clip) {
      mixer.stopAllAction();
      const a = mixer.clipAction(clip);
      a.reset();
      a.play();
      mixer.setTime(t);
    }
    src.root.updateMatrixWorld(true);
  };

  // Reference pose.
  sampleTo(src.referenceClip, 0);
  const refPos = new Map<BoneName, THREE.Vector3>();
  const refQuat = new Map<BoneName, THREE.Quaternion>();
  for (const [name, n] of nodes) {
    refPos.set(name, n.getWorldPosition(new THREE.Vector3()));
    refQuat.set(name, n.getWorldQuaternion(new THREE.Quaternion()));
  }

  // Source character frame.
  const P = (n: BoneName) => refPos.get(n) ?? new THREE.Vector3();
  const up = P('Head').clone().sub(P('Hips')).normalize();
  const left = P('LeftArm').clone().sub(P('RightArm'));
  left.addScaledVector(up, -left.dot(up)).normalize();
  const fwd = new THREE.Vector3().crossVectors(left, up).normalize();
  const basis = new THREE.Matrix4().makeBasis(left, up, fwd);
  const qBasis = new THREE.Quaternion().setFromRotationMatrix(basis);
  const qC = qBasis.clone().invert();
  const qCi = qBasis.clone();

  const sourceHip = P('Hips').clone().sub(P('LeftFoot')).dot(up);
  const targetHip = rig.byName.get('Hips')!.pos[1] - rig.byName.get('LeftFoot')!.pos[1];
  const hipScale = targetHip / Math.max(1e-6, sourceHip);

  // Per-bone alignment of reference directions onto graao bind directions.
  const segs = boneSegments(rig);
  const wRef = new Map<BoneName, THREE.Quaternion>();
  const childOf = (b: BoneName): BoneName | null => {
    const s = segs.get(b);
    if (!s) return null;
    for (const d of rig.defs) {
      const dp = new THREE.Vector3(...d.pos);
      if (dp.distanceToSquared(s.b) < 1e-10 && d.name !== b) return d.name;
    }
    return null;
  };
  for (const [name, q] of refQuat) {
    let align = new THREE.Quaternion();
    const child = name === 'Hips' ? 'Spine' : childOf(name);
    if (child && nodes.has(child) && rig.byName.has(name)) {
      const ds = P(child).clone().sub(P(name)).normalize();
      const rb = rig.byName.get(name)!;
      const rc = rig.byName.get(child)!;
      const dt = new THREE.Vector3(rc.pos[0] - rb.pos[0], rc.pos[1] - rb.pos[1], rc.pos[2] - rb.pos[2]).normalize().applyQuaternion(qCi);
      if (ds.lengthSq() > 0.5 && dt.lengthSq() > 0.5) align = new THREE.Quaternion().setFromUnitVectors(ds, dt);
    }
    wRef.set(name, align.multiply(q.clone()));
  }
  const wRefInv = new Map<BoneName, THREE.Quaternion>([...wRef].map(([k, v]) => [k, v.clone().invert()]));

  // Diagnostic: how far the source "reference" arm is from horizontal (T ≈ 0°, A ≈ 35–50°).
  const armDir = P('LeftForeArm').clone().sub(P('LeftArm')).normalize();
  const armPitchDeg = (Math.asin(Math.max(-1, Math.min(1, armDir.dot(up)))) * 180) / Math.PI;

  const hipsRest = new THREE.Vector3(...rig.byName.get('Hips')!.pos);
  const refHips = P('Hips').clone();
  const order = rig.defs.map((d) => d.name);
  const out: THREE.AnimationClip[] = [];
  const wt = new Map<BoneName, THREE.Quaternion>();
  const tmpQ = new THREE.Quaternion();
  const tmpV = new THREE.Vector3();

  for (const clip of src.clips) {
    if (clip === src.referenceClip) continue;
    const n = Math.max(2, Math.round(clip.duration * fps) + 1);
    const times = new Float32Array(n);
    const qValues = new Map<BoneName, Float32Array>(order.map((b) => [b, new Float32Array(n * 4)]));
    const hips = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const t = (clip.duration * i) / (n - 1);
      times[i] = t;
      sampleTo(clip, Math.min(t, clip.duration - 1e-4));
      for (const d of rig.defs) {
        const parentW = d.parent ? wt.get(d.parent)! : new THREE.Quaternion();
        const node = nodes.get(d.name);
        let w: THREE.Quaternion;
        if (node && wRefInv.has(d.name)) {
          node.getWorldQuaternion(tmpQ);
          w = qC.clone().multiply(tmpQ).multiply(wRefInv.get(d.name)!).multiply(qCi);
        } else {
          w = parentW.clone();
        }
        wt.set(d.name, w);
        const local = parentW.clone().invert().multiply(w);
        const arr = qValues.get(d.name)!;
        if (i > 0) {
          const k = (i - 1) * 4;
          if (arr[k]! * local.x + arr[k + 1]! * local.y + arr[k + 2]! * local.z + arr[k + 3]! * local.w < 0) {
            local.set(-local.x, -local.y, -local.z, -local.w);
          }
        }
        arr.set([local.x, local.y, local.z, local.w], i * 4);
      }
      const hipNode = nodes.get('Hips');
      if (hipNode) {
        hipNode.getWorldPosition(tmpV).sub(refHips).applyQuaternion(qC).multiplyScalar(hipScale);
        hips.set([hipsRest.x + tmpV.x, hipsRest.y + tmpV.y, hipsRest.z + tmpV.z], i * 3);
      } else {
        hips.set([hipsRest.x, hipsRest.y, hipsRest.z], i * 3);
      }
    }
    if (inPlace) {
      // Remove linear drift on X/Z so loops stay in place.
      const x0 = hips[0]!, z0 = hips[2]!;
      const x1 = hips[(n - 1) * 3]!, z1 = hips[(n - 1) * 3 + 2]!;
      for (let i = 0; i < n; i++) {
        const f = i / (n - 1);
        hips[i * 3] = hips[i * 3]! - (x0 + (x1 - x0) * f) + hipsRest.x;
        hips[i * 3 + 2] = hips[i * 3 + 2]! - (z0 + (z1 - z0) * f) + hipsRest.z;
      }
    }
    const tracks: THREE.KeyframeTrack[] = [new THREE.VectorKeyframeTrack('Hips.position', times, hips)];
    for (const b of order) {
      const arr = qValues.get(b)!;
      // Skip constant identity tracks.
      let constant = true;
      for (let i = 0; i < n && constant; i++) {
        if (Math.abs(arr[i * 4 + 3]!) < 0.99999) constant = false;
      }
      if (!constant) tracks.push(new THREE.QuaternionKeyframeTrack(`${b}.quaternion`, times, arr));
    }
    out.push(new THREE.AnimationClip(clip.name, clip.duration, tracks));
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(src.root);

  const facingCorrectionDeg = (2 * Math.acos(Math.min(1, Math.abs(qC.w))) * 180) / Math.PI;
  return { clips: out, report: { mapped: nodes.size, unmapped, facingCorrectionDeg, hipScale, armPitchDeg } };
}
