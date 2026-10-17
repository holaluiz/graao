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
| Anatomy | `character/build/anatomy.ts` | Body ring specs and the head surface function shared by face decals and hair |
| Parts | `character/parts/*.ts` | body, faces (3), hair (4), tops (4), bottoms (4), shoes (3), accessories (3) |
| `CharacterPartLibrary` (CharacterAppearanceController) | `character/CharacterAppearanceController.ts` | Builds/caches part geometry per body, hides covered body regions, merges one geometry, resolves the palette |
| `GraaoCharacter` | `character/GraaoCharacter.ts` | Instance: skeleton, meshes, materials, attachments, pose on the planet |
| `CharacterAnimationController` | `character/CharacterAnimationController.ts` | Semantic state → weighted actions (lower/upper split, upper actions, full-body one-shots) |
| `CharacterCustomizer` (Creator UI) | `ui/Creator.ts` | DOM tabs, instant switches |

## Proportions (independently authored; Messenger principles)

1.62 m, ≈ 5.5 heads (head 0.296 m), legs 49 % (hips 0.86 m), thin limbs (upper arm r 4.2 cm, forearm 3.5 cm, thigh
7.8 cm, calf 5 cm), small mitten hands (12.5 cm), chunky shoes (sole 28 cm). `body.sturdy` widens shoulders, hips and
girth (+14 %) on the same skeleton topology.

## Why it does not clip

- Garments are built from **the body's own ring lists** with outward offsets (`inflate`, `sliceRings`).
- Skin weights come from one function — inverse-distance (power 8) to bone segments over a per-primitive candidate
  set, with left/right gating — so a garment point and the body point under it get the same weights.
- Layering rule: tops sit outside bottoms (pelvis shells use a smaller offset than any top hem).
- `hideBodyRegions` removes covered body triangles (all three corners hidden) before merging.

## Color

Geometry never stores color: each vertex has a palette slot (skin, ink, eye white, hair, top, top accent, bottom,
shoes, sole, accessory…). `buildPalette(appearance)` produces 16 linear colors; the character material and its outline
share the palette array, so a color change is a uniform update.

## Cost

≈ 10 k triangles, ≈ 6 k vertices, 55 bones, 3 draw calls (color, outline, shadow). First build of a new combination
26 – 38 ms; parts are cached per body, so switching back is a merge only.

## Faces

Flat ink decals (eyes with highlight, brows in the hair color, mouth, optional blush) projected analytically onto the
head surface 2 mm above the skin. No textures, no outline.
