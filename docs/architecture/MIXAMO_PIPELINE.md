# Mixamo pipeline

graao's humanoid rig follows the Mixamo hierarchy and naming (without the namespace), so Mixamo clips are a speed tool:
download, drop in, play.

## Rig

`GRA_Rig_MixamoCompatible` (`apps/client/src/character/rig/GRARig.ts`): Hips → Spine → Spine1 → Spine2 → Neck → Head →
HeadTop_End; Left/Right Shoulder → Arm → ForeArm → Hand → Thumb/Index/Middle/Ring/Pinky 1–3; Left/Right UpLeg → Leg →
Foot → ToeBase → Toe_End. 55 bones. One bind pose for everything: T-pose, facing +Z, up +Y, character's left on +X,
meters, identity bind rotations.

## Name normalization

`normalizeBoneName()` strips `mixamorig:`, `mixamorig1:`, `mixamorig_` and the sanitized `mixamorig` prefix, accepts
canonical names and aliases, and maps the UE/Quaternius names (`pelvis`, `spine_01`, `upperarm_l`, `thumb_02_r`…).
Gameplay and rendering code only use canonical ids.

## Retargeting (why, and how)

Mixamo clips are baked for the source character's rest pose, and graao's proportions differ, so clips are retargeted
once at load time (`animation/Retargeter.ts`):

- `C` rotates the source character frame (left, up, forward from its reference pose) onto graao's frame;
- each source bone's reference world rotation is aligned so its bone direction matches graao's bind direction
  (handles T-pose vs A-pose and posture differences);
- `Wt(t) = C · Ws(t) · Wref⁻¹ · C⁻¹`, then local = parent⁻¹ · world; hips translation scaled by hip height;
- horizontal root drift is removed (movement belongs to the gameplay capsule — **no root motion**).

Test: every bone direction of idle and jog matches the source within 4° (`Retargeter.test.ts`).

## Sources

| Source | Status | License |
|---|---|---|
| Quaternius Universal Animation Library 1 & 2, in-place variant | **in use** (36 clips, 913 KB packed) | CC0 1.0 |
| Mixamo FBX clips | supported, **not yet supplied** | Adobe Mixamo terms: use in the game, no redistribution as loose files |

### Adding Mixamo clips

1. On mixamo.com pick a clip, **Format FBX, Skin: Without Skin, In Place: on**, 30 fps.
2. Save into `apps/client/public/assets/v1/animations/mixamo/` (keep raw downloads out of public git:
   `assets/animations/mixamo/raw/` is ignored).
3. List them in `manifest.json` there, keyed by graao clip names:
   `{ "idle": "Idle.fbx", "run": "Running.fbx", "sprint": "Fast Run.fbx", "air": "Falling Idle.fbx", "aim": "Rifle Aiming Idle.fbx", "fire": "Firing Rifle.fbx", "reload": "Reloading.fbx", "hit": "Hit Reaction.fbx", "death": "Dying.fbx", "cast": "Standing 1H Magic Attack 01.fbx", "victory": "Victory Idle.fbx" }`
4. Reload: `GRAAnimationLibrary` loads FBXLoader only when the manifest exists, retargets with the FBX bind pose as
   reference, and the clips override the CC0 ones (F3 shows `src mixamo/ual`).

Production later: bake retargeted clips into one compressed GLB at build time instead of retargeting in the browser.

## Semantic clip names

idle, walk, run, sprint, jumpStart, air, fall, land, rifleIdle, aim, aimUp, aimDown, fire, reload, hit, hitHeavy,
death, cast, castEnter, castHold, dash, shield, throw, victory, cheer, emote. Remote players choose clips locally from
replicated `MovementState` / `ActionState`; no skeletal data crosses the network.
