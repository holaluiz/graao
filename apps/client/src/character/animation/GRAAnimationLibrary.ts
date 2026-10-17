/**
 * GRAAnimationLibrary: semantic clip set for graao characters, retargeted once onto GRA_Rig_MixamoCompatible.
 *
 * Sources, in priority order:
 *   1. Mixamo FBX clips listed in `animations/mixamo/manifest.json` (optional; user-downloaded, not redistributed)
 *   2. Quaternius Universal Animation Library (CC0), in-place variant, packed by tools/animation/build-animations.mjs
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
  | 'emote';

/** Semantic name → source clip name in the UAL packs. */
const UAL_SOURCES: Record<ClipName, { pack: 1 | 2; clip: string }> = {
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
};

export interface LibraryReport {
  source: Record<ClipName, 'mixamo' | 'ual' | 'missing'>;
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
    const source = {} as Record<ClipName, 'mixamo' | 'ual' | 'missing'>;
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
    for (const [name, s] of Object.entries(UAL_SOURCES) as [ClipName, { pack: 1 | 2; clip: string }][]) {
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
