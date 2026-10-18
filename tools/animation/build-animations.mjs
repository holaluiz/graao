#!/usr/bin/env node
// Builds graao's runtime animation packs from the CC0 Quaternius Universal Animation Library (in-place variant).
// Keeps the skeleton nodes (needed as the retarget source rest pose), drops meshes/materials, keeps only the clips
// graao uses, keeps rotation tracks for every bone and translation only for the pelvis, resamples and compresses with
// meshopt. Output: apps/client/public/assets/v1/animations/ual{1,2}-clips.glb
//   node tools/animation/build-animations.mjs
import { mkdirSync, statSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, resample } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const OUT = 'apps/client/public/assets/v1/animations';
const PACKS = [
  {
    src: 'assets/animations/quaternius/UAL1_Standard.glb',
    out: `${OUT}/ual1-clips.glb`,
    clips: [
      'A_TPose', 'Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Jump_Start', 'Jump_Loop', 'Jump_Land',
      'Pistol_Idle_Loop', 'Pistol_Aim_Neutral', 'Pistol_Aim_Up', 'Pistol_Aim_Down', 'Pistol_Shoot', 'Pistol_Reload',
      'Hit_Chest', 'Hit_Head', 'Death01', 'Spell_Simple_Enter', 'Spell_Simple_Shoot', 'Spell_Simple_Idle_Loop', 'Roll',
      'Dance_Loop', 'Idle_Talking_Loop', 'Interact', 'Crouch_Idle_Loop', 'Swim_Fwd_Loop', 'Swim_Idle_Loop',
    ],
  },
  {
    src: 'assets/animations/quaternius/UAL2_Standard.glb',
    out: `${OUT}/ual2-clips.glb`,
    clips: ['A_TPose', 'Hit_Knockback', 'Idle_Shield_Loop', 'Idle_Shield_Break', 'OverhandThrow', 'Shield_Dash', 'NinjaJump_Idle_Loop', 'NinjaJump_Land', 'Yes', 'Idle_FoldArms_Loop', 'Shield_OneShot'],
  },
];

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
mkdirSync(OUT, { recursive: true });

for (const pack of PACKS) {
  const doc = await io.read(pack.src);
  const root = doc.getRoot();
  const keep = new Set(pack.clips);
  for (const anim of root.listAnimations()) {
    if (!keep.has(anim.getName())) {
      for (const smp of anim.listSamplers()) smp.dispose();
      anim.dispose();
      continue;
    }
    for (const ch of anim.listChannels()) {
      const path = ch.getTargetPath();
      const name = ch.getTargetNode()?.getName() ?? '';
      if (path === 'scale' || (path === 'translation' && name !== 'pelvis')) {
        const smp = ch.getSampler();
        ch.dispose();
        smp?.dispose();
      }
    }
  }
  const missing = pack.clips.filter((c) => !root.listAnimations().some((a) => a.getName() === c));
  if (missing.length) console.warn(`  missing clips in ${pack.src}: ${missing.join(', ')}`);
  for (const node of root.listNodes()) node.setMesh(null).setSkin(null);
  for (const m of root.listMeshes()) m.dispose();
  for (const s of root.listSkins()) s.dispose();
  for (const m of root.listMaterials()) m.dispose();
  for (const t of root.listTextures()) t.dispose();
  await doc.transform(prune({ keepLeaves: true, keepAttributes: false }), resample({ tolerance: 1e-4 }), dedup(), prune({ keepLeaves: true }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(pack.out, doc);
  console.log(`${pack.out}: ${root.listAnimations().length} clips, ${(statSync(pack.out).size / 1024).toFixed(0)} KB (source ${(statSync(pack.src).size / 1024).toFixed(0)} KB)`);
}
