/**
 * GRAAnimationLibrary: semantic clip set for graao characters, retargeted once onto GRA_Rig_MixamoCompatible.
 *
 * Sources, in priority order:
 *   1. Mixamo FBX clips listed in `animations/mixamo/manifest.json` (optional; user-downloaded, not redistributed)
 *   2. Quaternius Universal Animation Library (CC0), in-place variant, packed by tools/animation/build-animations.mjs
 *   3. Procedural graao poses built on the T-pose bind (the skydive, the ledge hang, the glide), see `skydiveClip`
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { GRAAssetManager } from '../../assets/GRAAssetManager';
import { createRig } from '../rig/GRARig';
import { retarget, type RetargetReport } from './Retargeter';
import { loadMixamoClips } from './MixamoClipLoader';

export type ClipName =
  | 'idle'
  | 'walk'
  | 'run'
  | 'sprint'
  | 'jumpStart'
  | 'air'
  | 'fall'
  | 'land'
  | 'rifleIdle'
  | 'aim'
  | 'aimUp'
  | 'aimDown'
  | 'fire'
  | 'reload'
  | 'hit'
  | 'hitHeavy'
  | 'death'
  | 'cast'
  | 'castEnter'
  | 'castHold'
  | 'dash'
  | 'shield'
  | 'throw'
  | 'victory'
  | 'cheer'
  | 'emote'
  | 'swim'
  | 'swimIdle'
  | 'punchL'
  | 'punchR'
  | 'skydive'
  /** Vertical traversal (docs/gameplay/TRAVERSAL_STATES.md): the climbing cycle, the pull-up, the hang, the glide. */
  | 'climb'
  | 'mantle'
  | 'hang'
  | 'glide';

type UalClip = Exclude<ClipName, 'skydive' | 'hang' | 'glide'>;

/** Semantic name → source clip name in the UAL packs. */
const UAL_SOURCES: Record<UalClip, { pack: 1 | 2; clip: string }> = {
  idle: { pack: 1, clip: 'Idle_Loop' },
  walk: { pack: 1, clip: 'Walk_Loop' },
  run: { pack: 1, clip: 'Jog_Fwd_Loop' },
  sprint: { pack: 1, clip: 'Sprint_Loop' },
  jumpStart: { pack: 1, clip: 'Jump_Start' },
  air: { pack: 1, clip: 'Jump_Loop' },
  fall: { pack: 2, clip: 'NinjaJump_Idle_Loop' },
  land: { pack: 1, clip: 'Jump_Land' },
  rifleIdle: { pack: 1, clip: 'Pistol_Idle_Loop' },
  aim: { pack: 1, clip: 'Pistol_Aim_Neutral' },
  aimUp: { pack: 1, clip: 'Pistol_Aim_Up' },
  aimDown: { pack: 1, clip: 'Pistol_Aim_Down' },
  fire: { pack: 1, clip: 'Pistol_Shoot' },
  reload: { pack: 1, clip: 'Pistol_Reload' },
  hit: { pack: 1, clip: 'Hit_Chest' },
  hitHeavy: { pack: 2, clip: 'Hit_Knockback' },
  death: { pack: 1, clip: 'Death01' },
  cast: { pack: 1, clip: 'Spell_Simple_Shoot' },
  castEnter: { pack: 1, clip: 'Spell_Simple_Enter' },
  castHold: { pack: 1, clip: 'Spell_Simple_Idle_Loop' },
  dash: { pack: 1, clip: 'Roll' },
  shield: { pack: 2, clip: 'Idle_Shield_Loop' },
  throw: { pack: 2, clip: 'OverhandThrow' },
  victory: { pack: 1, clip: 'Dance_Loop' },
  cheer: { pack: 2, clip: 'Yes' },
  emote: { pack: 2, clip: 'Idle_FoldArms_Loop' },
  swim: { pack: 1, clip: 'Swim_Fwd_Loop' },
  swimIdle: { pack: 1, clip: 'Swim_Idle_Loop' },
  // Empty hands: a left jab and a right cross, alternated.
  punchL: { pack: 1, clip: 'Punch_Jab' },
  punchR: { pack: 1, clip: 'Punch_Cross' },
  // In place (the pelvis only bobs): the capsule's controller does the moving, the clip only the reaching and pulling.
  climb: { pack: 2, clip: 'ClimbUp_1m' },
  mantle: { pack: 2, clip: 'ClimbUp_1m' },
};

export interface LibraryReport {
  source: Record<ClipName, 'mixamo' | 'ual' | 'procedural' | 'missing'>;
  ual: RetargetReport[];
  mixamo: { file: string; report: RetargetReport }[];
  ms: number;
}

export class GRAAnimationLibrary {
  readonly clips = new Map<ClipName, THREE.AnimationClip>();
  report: LibraryReport | null = null;

  constructor(private readonly assets: GRAAssetManager) {}

  async load(onProgress?: (f: number) => void): Promise<void> {
    const t0 = performance.now();
    const rig = createRig();
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const source = {} as Record<ClipName, 'mixamo' | 'ual' | 'procedural' | 'missing'>;
    const ualReports: RetargetReport[] = [];

    const packs: Record<1 | 2, Map<string, THREE.AnimationClip>> = { 1: new Map(), 2: new Map() };
    let done = 0;
    for (const pack of [1, 2] as const) {
      const url = this.assets.url(`animations/ual${pack}-clips.glb`);
      const gltf = await this.assets.track(loader.loadAsync(url), `ual${pack}`);
      const reference = gltf.animations.find((a) => a.name === 'A_TPose');
      const wanted = new Set(Object.values(UAL_SOURCES).filter((s) => s.pack === pack).map((s) => s.clip));
      const { clips, report } = retarget({ root: gltf.scene, clips: gltf.animations.filter((a) => wanted.has(a.name)), referenceClip: reference }, rig);
      ualReports.push(report);
      for (const c of clips) packs[pack].set(c.name, c);
      onProgress?.(++done / 3);
    }
    for (const [name, s] of Object.entries(UAL_SOURCES) as [UalClip, { pack: 1 | 2; clip: string }][]) {
      const c = packs[s.pack].get(s.clip);
      if (c) {
        const clip = c.clone();
        clip.name = name;
        // The UAL idles stand in a wide, staggered "ready" stance; graao's everyday people stand more relaxed.
        if (name === 'idle' || name === 'rifleIdle' || name === 'castHold') {
          relaxTowardBind(clip, { LeftUpLeg: 0.55, RightUpLeg: 0.55, LeftLeg: 0.4, RightLeg: 0.4, LeftFoot: 0.4, RightFoot: 0.4 }, 0.45, rig.byName.get('Hips')!.pos[1]);
        }
        this.clips.set(name, clip);
        source[name] = 'ual';
      } else source[name] = 'missing';
    }
    this.clips.set('skydive', skydiveClip());
    source.skydive = 'procedural';
    this.clips.set('hang', hangClip());
    source.hang = 'procedural';
    this.clips.set('glide', glideClip());
    source.glide = 'procedural';

    // Optional Mixamo overrides (same retargeter; FBX loader is only fetched when a manifest exists).
    const mixamo = await loadMixamoClips(this.assets, rig);
    for (const m of mixamo.clips) {
      this.clips.set(m.name as ClipName, m.clip);
      source[m.name as ClipName] = 'mixamo';
    }
    onProgress?.(1);
    this.report = { source, ual: ualReports, mixamo: mixamo.reports, ms: performance.now() - t0 };
  }

  get(name: ClipName): THREE.AnimationClip | undefined {
    return this.clips.get(name) ?? this.clips.get('idle');
  }
}

/**
 * Skydive (graao-authored, procedural): the classic box position on the T-pose bind (identity rotations, so it fits
 * both bodies) — upper arms out and a little raised, elbows bent so the hands come up by the head, knees bent with
 * the shins up, head raised, back slightly arched — with a slow flutter. GraaoCharacter tilts the whole visual root
 * belly-down on top of it while diving. Rig frame: facing +Z, up +Y, the character's left on +X.
 */
export function skydiveClip(): THREE.AnimationClip {
  const dur = 1.8;
  const times = [0, dur * 0.25, dur * 0.5, dur * 0.75, dur];
  const tracks: THREE.KeyframeTrack[] = [];
  const e = new THREE.Euler();
  const q = new THREE.Quaternion();
  const track = (bone: string, f: (wave: number) => [number, number, number]) => {
    const values: number[] = [];
    for (const t of times) {
      const [x, y, z] = f(Math.sin((t / dur) * Math.PI * 2));
      values.push(...q.setFromEuler(e.set(x, y, z)).toArray());
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, values));
  };
  track('Spine', () => [-0.08, 0, 0]);
  track('Spine1', () => [-0.1, 0, 0]);
  track('Spine2', () => [-0.1, 0, 0]);
  track('Neck', () => [-0.32, 0, 0]);
  track('Head', () => [-0.3, 0, 0]);
  // Left arm points +X: +Z rotation raises it, −Y brings it forward. The right side mirrors.
  track('LeftArm', (w) => [0, -0.2, 0.3 + w * 0.05]);
  track('RightArm', (w) => [0, 0.2, -0.3 - w * 0.05]);
  track('LeftForeArm', (w) => [0, 0, 1.35 + w * 0.06]);
  track('RightForeArm', (w) => [0, 0, -1.35 - w * 0.06]);
  track('LeftHand', () => [0, 0, -0.2]);
  track('RightHand', () => [0, 0, 0.2]);
  // Legs point −Y: +Z spreads the left leg outward, −X flexes the hip forward; +X bends the knee (shin backward).
  track('LeftUpLeg', (w) => [-0.22 + w * 0.05, 0, 0.16]);
  track('RightUpLeg', (w) => [-0.22 - w * 0.05, 0, -0.16]);
  track('LeftLeg', (w) => [1.1 - w * 0.08, 0, 0]);
  track('RightLeg', (w) => [1.1 + w * 0.08, 0, 0]);
  track('LeftFoot', () => [0.35, 0, 0]);
  track('RightFoot', () => [0.35, 0, 0]);
  return new THREE.AnimationClip('skydive', dur, tracks);
}

/** A looping pose clip on the T-pose bind: each bone's Euler (x, y, z) as a function of a slow sine wave. */
function poseClip(name: string, dur: number, bones: Record<string, (wave: number) => [number, number, number]>): THREE.AnimationClip {
  const times = [0, dur * 0.25, dur * 0.5, dur * 0.75, dur];
  const e = new THREE.Euler();
  const q = new THREE.Quaternion();
  const tracks = Object.entries(bones).map(([bone, f]) => {
    const values: number[] = [];
    for (const t of times) {
      const [x, y, z] = f(Math.sin((t / dur) * Math.PI * 2));
      values.push(...q.setFromEuler(e.set(x, y, z)).toArray());
    }
    return new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, values);
  });
  return new THREE.AnimationClip(name, dur, tracks);
}

/**
 * Ledge hang (graao-authored, procedural): both arms straight up and a little forward with the hands on the edge, the
 * head tilted up toward it, the legs hanging loose with a slow sway. Same rig conventions as the skydive.
 */
export function hangClip(): THREE.AnimationClip {
  return poseClip('hang', 2.4, {
    Spine: () => [0.06, 0, 0],
    Spine1: () => [0.04, 0, 0],
    Spine2: () => [0.02, 0, 0],
    Neck: () => [-0.18, 0, 0],
    Head: () => [-0.22, 0, 0],
    LeftShoulder: () => [0, 0, 0.35],
    RightShoulder: () => [0, 0, -0.35],
    LeftArm: () => [0, -0.32, 1.25],
    RightArm: () => [0, 0.32, -1.25],
    LeftForeArm: () => [0, 0, 0.12],
    RightForeArm: () => [0, 0, -0.12],
    LeftHand: () => [-0.5, 0, 0],
    RightHand: () => [-0.5, 0, 0],
    LeftUpLeg: (w) => [-0.12 + w * 0.06, 0, 0.04],
    RightUpLeg: (w) => [-0.06 - w * 0.06, 0, -0.04],
    LeftLeg: (w) => [0.32 - w * 0.08, 0, 0],
    RightLeg: (w) => [0.22 + w * 0.08, 0, 0],
    LeftFoot: () => [0.25, 0, 0],
    RightFoot: () => [0.25, 0, 0],
  });
}

/**
 * Glide (graao-authored, procedural): hands up holding the kite's cross-bar over the head, elbows bent, legs together
 * and trailing a little, a gentle flutter. GraaoCharacter leans the body forward on top of it and shows the kite.
 */
export function glideClip(): THREE.AnimationClip {
  return poseClip('glide', 1.6, {
    Spine: () => [-0.06, 0, 0],
    Spine1: () => [-0.05, 0, 0],
    Neck: () => [-0.25, 0, 0],
    Head: () => [-0.2, 0, 0],
    LeftArm: (w) => [0, -0.15, 1.0 + w * 0.04],
    RightArm: (w) => [0, 0.15, -1.0 - w * 0.04],
    LeftForeArm: () => [0, 0, 0.75],
    RightForeArm: () => [0, 0, -0.75],
    LeftUpLeg: (w) => [0.12 + w * 0.05, 0, 0.03],
    RightUpLeg: (w) => [0.12 - w * 0.05, 0, -0.03],
    LeftLeg: (w) => [0.35 + w * 0.06, 0, 0],
    RightLeg: (w) => [0.35 - w * 0.06, 0, 0],
    LeftFoot: () => [0.45, 0, 0],
    RightFoot: () => [0.45, 0, 0],
  });
}

/** Blends selected bone rotations toward the bind pose (identity) and the hips height toward rest. */
export function relaxTowardBind(clip: THREE.AnimationClip, weights: Record<string, number>, hipsFactor: number, restHipsY: number): void {
  const q = new THREE.Quaternion();
  const id = new THREE.Quaternion();
  for (const t of clip.tracks) {
    const [bone, prop] = t.name.split('.') as [string, string];
    if (prop === 'quaternion' && weights[bone] !== undefined) {
      const w = weights[bone]!;
      for (let i = 0; i < t.values.length; i += 4) {
        q.fromArray(t.values, i).slerp(id, w).toArray(t.values, i);
      }
    } else if (bone === 'Hips' && prop === 'position') {
      for (let i = 1; i < t.values.length; i += 3) t.values[i] = t.values[i]! + (restHipsY - t.values[i]!) * hipsFactor;
    }
  }
}
