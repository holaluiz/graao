/**
 * MixamoClipLoader: loads user-downloaded Mixamo FBX clips during development and retargets them onto
 * GRA_Rig_MixamoCompatible. Mixamo clips are used inside the game but never committed as loose files
 * (`assets/animations/mixamo/raw/` is gitignored).
 *
 * Drop clips (FBX, "Without Skin", "In Place" ticked) into `apps/client/public/assets/v1/animations/mixamo/` and list
 * them in `manifest.json` there, e.g. `{ "idle": "Idle.fbx", "run": "Running.fbx" }`. Keys are graao clip names
 * (see GRAAnimationLibrary). The FBX skeleton's bind pose (Mixamo T-pose) is the retarget reference.
 */
import type * as THREE from 'three';
import type { GRAAssetManager } from '../../assets/GRAAssetManager';
import type { GRARig } from '../rig/GRARig';
import { retarget, type RetargetReport } from './Retargeter';

export async function loadMixamoClips(
  assets: GRAAssetManager,
  rig: GRARig,
): Promise<{ clips: { name: string; clip: THREE.AnimationClip }[]; reports: { file: string; report: RetargetReport }[] }> {
  const empty = { clips: [], reports: [] };
  let manifest: Record<string, string>;
  try {
    const res = await fetch(assets.url('animations/mixamo/manifest.json'), { cache: 'no-cache' });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return empty;
    manifest = (await res.json()) as Record<string, string>;
  } catch {
    return empty;
  }
  const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
  const loader = new FBXLoader();
  const clips: { name: string; clip: THREE.AnimationClip }[] = [];
  const reports: { file: string; report: RetargetReport }[] = [];
  for (const [name, file] of Object.entries(manifest)) {
    try {
      const group = await loader.loadAsync(assets.url(`animations/mixamo/${file}`));
      const source = group.animations[0];
      if (!source) continue;
      // Mixamo FBX is in centimeters with the skeleton at its bind (T) pose before any clip plays.
      const { clips: out, report } = retarget({ root: group, clips: [source] }, rig);
      if (out[0]) {
        out[0].name = name;
        clips.push({ name, clip: out[0] });
        reports.push({ file, report });
      }
    } catch (e) {
      console.warn('[graao] Mixamo clip failed', file, e);
    }
  }
  return { clips, reports };
}
