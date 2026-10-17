# Materials

`GRAStylizedMaterial` (`apps/client/src/render/materials/GRAStylizedMaterial.ts`) is one ShaderMaterial (lights, fog,
shadows) with variants chosen by defines:

| Variant | Used by | Specifics |
|---|---|---|
| world | props (vertex colors, instanced) | pigment breakup, macro variation, edge pooling, instance fade |
| foliage | trees, bushes, flowers | softer ramp, finer pigment |
| terrain | planet chunks | grass / dry / sand / rock / cliff from height + slope + world-space patches |
| character | merged character mesh | 16-slot palette uniform, crisp ramp, light warm rim, unlit ink and eye slots |

Common controls: `uSunColor`, `uShadowTint`, `uSkyFill` / `uGroundFill` (hemisphere fill around the fragment's own
local up), `uRampCenter` / `uRampSoftness` (graphic shadow ramp × shadow map), `uPigment`, `uMacro`, `uEdgePooling`,
`uRim`, `uFade` / `instanceFade` (paper dissolve for camera obstruction).

Others: `GRAOutline` (inverted hull, palette-tinted ink, roughly constant screen width), `GRASky`, `GRAWater`
(fresnel, noise ripples, painted glints, translucent shallows), `GRAGrass` (instanced tufts, wind, player bend,
shadow receiving, distance shrink). The fine paper grain is a CSS multiply overlay (no shader cost).
