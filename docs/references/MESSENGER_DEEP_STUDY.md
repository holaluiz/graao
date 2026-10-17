# Messenger deep study

> Reference: <https://messenger.abeto.co/> (by Abeto; console banner "🌎🌍🌏 by https://abeto.co").
> Studied 2026-10-17 with:
> - **REA** `capture_browser_scenario` (headless Chromium 155, 19.5 s, network/worker/console events, final screenshot).
>   Evidence `ev_aa902e5251fc47e0ad83e8187ec5df0c6670411a9f537a98cc690c533ec94e0d`.
> - The Claude desktop **built-in browser**: playing the intro, the outfit screen and a few seconds of walking; network log
>   of the full session; a read-only WebGL draw-call counter (prototype wrapper, restored after 60 frames).
>
> **Boundaries kept:** read-only. Nothing decrypted, bypassed or downloaded for reuse. No mesh, texture, shader, animation,
> font or sound was extracted, decoded or copied. Draco files were only *listed* (names and order), never decoded.
> Everything below comes from what any visitor's browser receives (file names, request order, screen pixels).
>
> Every finding is tagged **OBSERVED** (seen directly), **INFERRED** (deduced, may be wrong) or **UNKNOWN**.

---

## 1. Character

Measured on full-body screenshots (front view in the outfit screen at 697×728, character ≈ 415 px tall; back and
side views in gameplay).

| # | Finding | Value | Tag |
|---|---|---|---|
| C1 | Total height in heads (hair top → sole) | **≈ 5.3–5.5 heads** | OBSERVED (measured on pixels; ±0.2) |
| C2 | Absolute height | ≈ 1.5–1.65 m (young adult; matches doors and guardrails) | INFERRED |
| C3 | Legs (hip joint → floor) | **≈ 48–50 %** of total height | OBSERVED |
| C4 | Torso (shoulder line → crotch) | ≈ 29 % of height, short and narrow | OBSERVED |
| C5 | Shoulder width (outside of sleeves) | ≈ 1.4–1.5 × head width; shoulders slope gently | OBSERVED |
| C6 | Arms | Long and **thin**; fingertips reach mid-thigh; no muscle definition | OBSERVED |
| C7 | Hands | **Small** (≈ 0.4 head heights), simple mitten-like silhouette, fingers barely separated | OBSERVED |
| C8 | Legs | Thin calves, narrow ankles; slight pigeon-toed stance in idle | OBSERVED |
| C9 | Shoes | **Chunky** (sole thick, toe rounded), ≈ 1.2 × a realistic size; the strongest color accent at the bottom of the silhouette | OBSERVED |
| C10 | Face construction | Flat drawn features on a smooth head: dark almond eyes with a tiny highlight, short straight brows, a nose hinted by one line, a small mouth line. No modeled facial relief visible | OBSERVED |
| C11 | Face placement | Eyes at ≈ 55 % of head height (measured from chin); features compact in the lower-middle of the face, large forehead/hair mass | OBSERVED |
| C12 | Face technique | Texture/decal on the head (lines stay crisp, no geometry shading inside features) | INFERRED |
| C13 | Hair | Chunky helmet-like volume with a few large spikes/strands; reads as 3–6 big shapes, never strands | OBSERVED |
| C14 | Polygon density | Low-to-medium: silhouettes are smooth in close-up but limbs show faceting at the elbows; budget appears in silhouette, not in surface detail | INFERRED |
| C15 | Shading | Two-tone cel (light / shadow) with a hard terminator; no specular; ink outlines on silhouette and major creases | OBSERVED |

**General principle:** appeal comes from a **big head + short torso + long thin limbs + chunky feet**, readable in two
tones, with the face as a few graphic marks. Detail goes into silhouette and color blocking, not surface noise.

**graao reconstruction:** `GRABodyBuilder` builds an independently authored body at **1.62 m, ≈ 5.6 heads**, legs at 49 %,
thin limbs (upper arm r ≈ 4.2 cm, forearm 3.5 cm, thigh 7.5 cm, calf 5.5 cm), small hands (12 cm) and chunky shoes. Faces
are flat ink decals generated as geometry (crisp at any resolution, zero textures). Characters use a cleaner cel material
than the world plus an inverted-hull outline in warm dark ink (not pure black) to keep player readability first.

## 2. Modularity

| # | Finding | Tag |
|---|---|---|
| M1 | Wardrobe files: `geometries/avatar/accessories/base.drc`, `hair1–7`, `top1–9`, `bottom1–7`, `shoes1–7` (Draco). **One file per piece**, four slots plus a base body | OBSERVED (network log) |
| M2 | The outfit screen has exactly **four rows**: head/hair, top, bottom, shoes, each cycled with ◀ ▶; changes apply instantly with no loading | OBSERVED |
| M3 | The "hair" slot also carries head accessories (headphones, a face mask): **hair + headwear is one piece** | OBSERVED (cycling hair4 → others showed headphones/mask variants) |
| M4 | Tops are complete garments with their own volume (a hoodie with hood and drawstrings, a long-sleeve tee with print); a hoodie hides the bag strap | OBSERVED |
| M5 | The base body stays visible where clothes do not cover (forearms, hands, neck, face, shins) | OBSERVED |
| M6 | Pieces deform together with the body during run/idle with no visible gaps | OBSERVED |
| M7 | All pieces are skinned to one shared skeleton (`avatar-bones.drc` loaded once, separate from meshes) | INFERRED (one bones file for the avatar; NPCs each have their own `*-bones.drc`) |
| M8 | Color variants: pieces seem to come with fixed colors (no separate color picker) | OBSERVED (no color UI) |
| M9 | Draw calls per avatar | UNKNOWN (see §4.4: main scene seems to render off the main thread) |
| M10 | Materials: one cel material family shared by body and clothes (same shading, same outline) | INFERRED |

**General principle:** a base body + **one piece per slot** + a shared skeleton makes swapping trivial: changing a slot
is swapping one mesh, everything already shares bones and shading.

**graao reconstruction:** `CharacterAppearance` holds IDs per slot (body, face, skin, hair, top, bottom, shoes, accessory)
**plus color IDs** (graao separates geometry from color, which Messenger does not appear to do). Every piece is built
on `GRA_Rig_MixamoCompatible` with the same skin-weight function as the body, so co-located points move identically.
Pieces carry a per-vertex *palette slot*; the character shader resolves colors from a per-character palette, so a color
change is a uniform update. The visible parts are merged into **one skinned mesh per character** (1 draw + 1 outline +
1 shadow) because graao targets 20 players. Clothes declare `hideBodyRegions` so covered body regions are not merged.

## 3. Animation

| # | Finding | Tag |
|---|---|---|
| A1 | Player clips: `avatar-idle`, `avatar-run`, `avatar-sprint`, `avatar-air`, `avatar-afk1–3` — **7 clips** | OBSERVED (network log) |
| A2 | Clips are separate files from the mesh and the bones | OBSERVED |
| A3 | Skeleton: ordinary humanoid; idle shows breathing and weight shift, run swings bent arms | OBSERVED (screens) / INFERRED (humanoid hierarchy) |
| A4 | Turns: the character turns toward the movement direction; the camera does not auto-swing behind | OBSERVED (walking toward the camera made the character face it) |
| A5 | Jump: a single "air" clip covers jump and fall | INFERRED (no separate start/land clip in the network list) |
| A6 | Blending: short cross-fades between idle/run/sprint | INFERRED |
| A7 | NPCs have per-character idle/talk/walk clips on their own skeletons | OBSERVED (`npcs/present/<name>/<name>-idle.drc`, `-bones.drc`) |

**General principle:** a very small clip set (idle, run, sprint, air, a few idles-of-boredom) is enough when the clips
are good and the transitions are short.

**graao reconstruction:** a slightly larger but still small set, retargeted onto the Mixamo-compatible rig: idle, walk,
jog, sprint, jump start, air, land, rifle idle/aim, fire, reload, hit, death, cast, victory. Movement stays capsule-driven
(server-authoritative); clips are in-place.

## 4. Rendering

| # | Finding | Tag |
|---|---|---|
| R1 | Cel shading: two flat tones per material, hard terminator, colored (not black) shadows | OBSERVED |
| R2 | **Ink outlines** with slightly irregular width on silhouettes and creases, also on terrain patches and clouds | OBSERVED |
| R3 | Terrain colored by **thresholded noise** patches (green grass with beige/sand islands with dark outlines) | OBSERVED (screens) / INFERRED (`images/noises-terrain.ktx2`) |
| R4 | Sky with flat, hard-edged painted cloud masses on teal | OBSERVED / INFERRED (`clouds_noise_512.ktx2`, `clouds_noise_64.ktx2`) |
| R5 | A color LUT (`images/lut.ktx2`) for final grading | OBSERVED (file) / INFERRED (purpose) |
| R6 | Textures are KTX2 (Basis); geometry is Draco (`.drc`); decoders run in workers (`dracoworker`, `basis_transcoder`) | OBSERVED |
| R7 | Glyph rendering worker + WASM (`glyphworker`, `glyph.wasm`), custom fonts as `.font` | OBSERVED / INFERRED (SDF/MSDF text in WebGL; the outfit and dialogue UI is drawn inside WebGL, the DOM has 49 elements and no reachable canvas) |
| R8 | Long soft cel shadows from one sun; a dark blob-like contact shadow under the character | OBSERVED |
| R9 | Main-thread WebGL2 calls measured over 60 frames: ≈ 19 draws/frame, ≈ 12 k triangles/frame | OBSERVED |
| R10 | That count is far too low for the visible city, and `geometryworker`, `bitmapworker` and a `blob:` worker exist | INFERRED: the main scene is rendered **off the main thread** (OffscreenCanvas in a worker). True per-frame cost is UNKNOWN |

**General principle:** a strong identity from *few* shading rules applied everywhere (two tones + ink + thresholded noise
for patches) and a final LUT. Detail is graphic, not physical.

**graao reconstruction:** graao's direction is painterly/watercolor rather than anime-ink, so it takes the *discipline*,
not the look: one `GRAStylizedMaterial` family with a shadow ramp, warm sun / cool shadow colors and world-space pigment
breakup for the environment; a cleaner variant for characters; outlines only on characters and key landmarks (readability).
LUT grading is deferred until measured.

## 5. World

| # | Finding | Tag |
|---|---|---|
| W1 | The world is a real small planet: the title screen shows the whole sphere; walking, the road visibly bends down to a near horizon | OBSERVED |
| W2 | Apparent planet radius | **≈ 30–60 m** (title screen: a two-storey house ≈ 1/8–1/10 of the planet diameter) | INFERRED (perspective makes this rough) |
| W3 | Character / planet radius | ≈ 1 : 20–35 | INFERRED |
| W4 | Horizon | Very close (tens of meters); buildings rise over it as you walk | OBSERVED |
| W5 | Camera | Close third person, slightly above head height, character ≈ 40–44 % of screen height, centered | OBSERVED |
| W6 | Camera on terrain | Pitches down on slopes; does not auto-rotate behind the character | OBSERVED |
| W7 | Obstruction | A guardrail between camera and character stayed opaque (no fade seen) | OBSERVED (single case) |
| W8 | World geometry in 10 chunks (`full_0–9`) × 3 extra LOD levels (`full-lod-1/2/3_N`) + 5 separate collision meshes (`hitmesh_0–4`) | OBSERVED |
| W9 | Instanced decor: `grass`, `tree-leaves_0–4`, `butterflies`, `birds`, `cables` as separate files | OBSERVED |

**General principle:** a tiny planet makes the horizon part of the composition: everything is discovered by walking over
the curve. Collision is separate, simplified geometry.

**graao reconstruction:** graao is a shooter, so the planet must be larger than Messenger's: **R = 100 m test value**
(horizon from the camera ≈ 22 m; standing players mutually visible to ≈ 37 m; a 25 m landmark visible from ≈ 90 m).
Curvature is used as gameplay (sightline limiter, high ground matters). Visual terrain and the Rapier collision trimesh are
generated from the same deterministic height function; props use primitive colliders. Obstruction is handled by a
dithered "paper dissolve" (original graao solution) instead of camera snapping.

## 6. Loading

| # | Finding | Tag |
|---|---|---|
| L1 | Shell: HTML + `webgl-*.js` + `App3D-*.js` + CSS | OBSERVED |
| L2 | Title screen first: intro planet (`planets/present/intro/*.drc`), title geometry, button, galaxies | OBSERVED |
| L3 | All UI/intro sounds (≈ 50 `.ogg`) are fetched during the title screen | OBSERVED |
| L4 | After BEGIN: collision meshes → **current outfit first** (`base`, `hair4`, `top9`, `bottom7`, `shoes2`) → `avatar-bones` → the 7 clips → **every other wardrobe piece** → world chunks → LODs → water/VFX → NPCs | OBSERVED (request order) |
| L5 | Wardrobe swaps are instant because the whole wardrobe (30 pieces) is preloaded right after the current outfit | INFERRED (from L4 + M2) |
| L6 | Caching headers | UNKNOWN (header values not captured) |

**General principle:** load the **visible outfit first**, then preload the rest of the wardrobe in the background; the
outfit screen never waits.

**graao reconstruction:** `GRAAssetManager` groups (CORE → MENU → CHARACTER_CREATOR → DRAFT → MATCH). graao's procedural
pieces cost zero downloads; generated geometry is cached per piece ID so going back to a piece is instant. When authored
GLB pieces arrive, the creator loads the current outfit first, then the open category, then the rest lazily.

## 7. Behavior → principle → graao (summary)

| Messenger behavior | General principle | graao reconstruction |
|---|---|---|
| 5.4-head body, long thin limbs, chunky shoes | Proportion and silhouette carry the appeal | 1.62 m, ≈ 5.6 heads, legs 49 %, chunky shoes |
| Flat drawn face | Faces as graphic marks stay readable at small size | Ink decal faces built as geometry |
| Four wardrobe slots + base + shared bones | One piece per slot on one skeleton | Body/Hair/Top/Bottom/Shoes/Accessory on `GRA_Rig_MixamoCompatible` |
| Fixed colors per piece | — | graao adds palette color IDs (geometry ≠ color) |
| Outfit first, then the whole wardrobe | Never block customization on downloads | Current-outfit-first loading, cached parts |
| 7 small in-place clips | Few good clips + short blends | ~15 retargeted in-place clips, semantic network state |
| Cel + ink + noise patches + LUT | Few rules applied everywhere | One material family, warm/cool ramp, pigment breakup |
| Tiny planet, near horizon | The curve is the level design | R = 100 m, horizon as a sightline mechanic |
| Chunked world + LODs + separate hit meshes | Collision ≠ render geometry | Shared height function → render mesh and Rapier trimesh; primitive prop colliders |

## 8. Not copied

No Messenger mesh, texture, shader, clip, font, sound, UI art, code or layout is used in graao. graao's characters,
faces, clothes, materials, planet and UI are authored independently in this repository.
