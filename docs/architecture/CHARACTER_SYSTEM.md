# Character system

```
PlayerRoot (aligned to localUp, at the capsule's feet)            ← gameplay capsule lives in game-core
└── CharacterVisualRoot
      ├── Hips … GRA_Rig_MixamoCompatible (55 bones)
      ├── mesh     SkinnedMesh: body + face + hair + top + bottom + shoes + accessory (ONE draw)
      └── outline  same geometry, inverted-hull ink (ONE draw, no shadow)
```

| Class | File | Role |
|---|---|---|
| `GRA_Rig_MixamoCompatible` | `character/rig/GRARig.ts` | Canonical hierarchy, T-pose bind, identity bind rotations, two body proportion sets |
| `MixamoBoneMap` / normalizer | `character/rig/MixamoBoneMap.ts` | `mixamorig:` / `mixamorig1:` / `mixamorig_` / sanitized prefixes + UE/UAL names → canonical ids |
| `PartBuilder` | `character/build/PartBuilder.ts` | Code-authored geometry: tubes (superellipse sweeps), star surfaces, tori, decals; palette slot, region, outline per vertex; shared skin-weight function |
| Anatomy | `character/build/anatomy.ts` | Body ring specs (torso, arms, legs, feet) |
| Head | `character/build/head.ts` + `head-data.json` | The sculpted head mesh, its skull surface (hair, hats, beards), the face surface (decals) and face landmarks |
| Parts | `character/parts/*.ts` | body, faces (6), beards (4), hair (13 + bald), tops (10), bottoms (8), shoes (7), hats (9), face accessories (5), body extras (5) |
| `CharacterPartLibrary` (CharacterAppearanceController) | `character/CharacterAppearanceController.ts` | Builds/caches part geometry per body, hides covered body regions, merges one geometry, resolves the palette |
| `GraaoCharacter` | `character/GraaoCharacter.ts` | Instance: skeleton, meshes, materials, attachments, pose on the planet |
| `CharacterAnimationController` | `character/CharacterAnimationController.ts` | Semantic state → weighted actions (lower/upper split, upper actions, full-body one-shots) |
| `CharacterCustomizer` (Creator UI) | `ui/Creator.ts` | DOM tabs, instant switches |

## Proportions (independently authored; Messenger principles)

1.62 m, ≈ 5.5 heads (head 0.296 m, sculpted — see Head), legs 49 % (hips 0.86 m), thin limbs (upper arm r 4.2 cm, forearm 3.5 cm, thigh
7.8 cm, calf 5 cm), small mitten hands (12.5 cm), chunky shoes (sole 28 cm). `body.sturdy` widens shoulders, hips and
girth (+14 %) on the same skeleton topology.

## Why it does not clip

- Garments are built from **the body's own ring lists** with outward offsets (`inflate`, `sliceRings`).
- Skin weights come from one function — inverse-distance (power 8) to bone segments over a per-primitive candidate
  set, with left/right gating — so a garment point and the body point under it get the same weights.
- Layering rule: tops sit outside bottoms (pelvis shells use a smaller offset than any top hem).
- `hideBodyRegions` removes covered body triangles (all three corners hidden) before merging.
- Pieces that depend on other pieces carry them in their cache key: hats sit over the hair (`hatSeat`, `hairOuter`),
  hair drops buns and crests under a hat, side accessories move out with the hair, body extras sit just outside the
  current top (`TOP_FIT`).

## Color

Geometry never stores color: each vertex has a palette slot (skin, ink, eye white, hair, top, top accent, bottom,
shoes, sole, accessory…). `buildPalette(appearance)` produces 32 linear colors (`PALETTE_SIZE`); the character material and its outline
share the palette array, so a color change is a uniform update.

## Cost

≈ 10 k triangles, ≈ 6 k vertices, 55 bones, 3 draw calls (color, outline, shadow). First build of a new combination
26 – 38 ms; parts are cached per body, so switching back is a merge only.

## Head

A sculpted bald head (stylized, faceted) replaces the old analytic one; only its shape is used, colored by the skin
slot like the rest of the body. `tools/blender/build_head.py` turns `assets/characters/head-base.glb` (4.5 k triangles,
decimated from the 2 M-triangle source) into `character/build/head-data.json`:

- the mesh scaled to the old head's skull (crown to chin 0.298 m, same center), with the lid folds and brow ledge
  smoothed away (they were carved for painted eyes and would cut through the eye decals);
- vertex flags: the neck stub (stretched to end inside the torso; explicit Head → Neck → Spine2 weights continuous
  with the rigid head at the jaw) and the ears (region `ears`);
- the skull as a radial table (2°, each node the highest skin around it) with the ears and nose filled in: hair
  shells, hats, beards and side accessories are laid over `surface(dir, scale)`;
- an ear-volume table: hair and wrapped cloth swell over the ears (`clearEars`) instead of letting them through;
- face landmarks (eyes, brows, nose, mouth, ear lobe/top) where the sculpt carves them.

After regenerating the head, run `pnpm tsx tools/character/dump-body.ts` and `tools/blender/build_hero.py` so the
Blender-authored wavy hair is rebuilt over the new skull.

## Faces

Flat ink decals following the sculpt's painted style — almond eyes under a heavy lash line with a flick, a tall iris
clipped by the lids, a catch light, thin lower lid and lid fold; thick angled brows in the hair color; a mouth line
under a tinted upper lip; optional blush — projected onto the real face (`frontPoint` casts against the head mesh)
2 mm above the skin. Expressions bend the same shapes. No textures, no outline.
