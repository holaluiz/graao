# Summer Afternoon study

> Reference: <https://summer-afternoon.vlucendo.com/> ("A WebGL experiment by Vicente Lucendo").
> Sources: (1) the read-only study done on 2026-10-17 for the abandoned `Fractalia-Web` attempt
> (`D:\meus documentos\Fractalia-Web\docs\references\SUMMER_AFTERNOON_STUDY.md`, REA `capture_browser_scenario` + built-in
> browser), re-read and summarized here; (2) a new pass on 2026-10-17 in the built-in browser: screenshots and a
> read-only WebGL draw-call counter over 60 frames.
>
> **Boundaries kept:** nothing decrypted, bypassed or copied; no model, texture, shader, sound or code reused.
> Tags: **OBSERVED**, **INFERRED**, **UNKNOWN**.

## 1. Loading

| # | Finding | Tag |
|---|---|---|
| 1.1 | Tiny shell (0.7 KB HTML, 6.5 KB entry JS); the 3D app is a separate 462 KB chunk | OBSERVED (prior pass) |
| 1.2 | Loading screen = title + spinner on cream, no video | OBSERVED |
| 1.3 | Draco (82 KB) and Basis/KTX2 (227 KB) WASM decoders fetched early; decoding in workers | OBSERVED |
| 1.4 | ≈ 80 requests, ≈ 8 MB: geometry 680 KB, KTX2 2.6 MB, audio 3.0 MB | OBSERVED |
| 1.5 | Audio starts downloading ≈ 4 s after open, once the world is on screen | OBSERVED |
| 1.6 | Two texture qualities: a small version first, a `-highq` version ≈ 5 s later | OBSERVED (names, times) / INFERRED (progressive swap) |

**Principle:** show something in < 1 s; the 3D engine comes in its own chunk; what the first frame does not need
arrives later. **graao:** minimal HTML shell with logo + real progress; Three.js/Rapier/Colyseus in a dynamic import;
procedural audio first (zero bytes), music after ENTER.

## 2. Geometry, instancing, LOD, collision

| # | Finding | Tag |
|---|---|---|
| 2.1 | One `.bin` per mesh type plus separate `*-instances.bin` placement files (tree, bush, grass, rock, lightposts) | OBSERVED |
| 2.2 | File-level LODs (`tree-lod2/3`, `bush-lod2/3`) | OBSERVED |
| 2.3 | Separate collision mesh (`collider.bin`) and `blockers` | OBSERVED / INFERRED (simplified collision) |
| 2.4 | The whole world fits in 680 KB of geometry | OBSERVED |

**graao:** one `InstancedMesh` per prop type with placements from shared map data (the same data the server uses for
colliders); collision via primitives + the terrain trimesh, never the render mesh of props.

## 3. Rendering

| # | Finding | Tag |
|---|---|---|
| 3.1 | Soft flat shading with gentle gradients, no outlines; long soft shadows from a low warm sun | OBSERVED |
| 3.2 | Strong aerial perspective: distant trees and houses fade toward the sky blue | OBSERVED (2026-10-17 screenshot) |
| 3.3 | Warm elements (skin, straw hat, roofs) pop against a cool grey road | OBSERVED |
| 3.4 | A 3D LUT texture for grading; one `masks.ktx2` with packed masks | OBSERVED (names) / INFERRED (purpose) |
| 3.5 | Painted cloud dome (`clouds_top`, `skyflow`, `skydome`) | OBSERVED / INFERRED |
| 3.6 | **≈ 64 draw calls / frame** (19 `drawElements`, 41 `drawElementsInstanced`, 4 `drawArrays`) and **≈ 245 k triangles / frame** (shadow pass included), 59 fps in the Claude desktop browser pane | OBSERVED (read-only counter, 60 frames, 2026-10-17) |

**Principle:** few shared materials, heavy instancing, a painted sky and one grading pass give a rich image for
≈ 64 draws. **graao budget anchor:** HIGH ≤ 150 draws and ≤ 500 k tris/frame with 2 players; LOW ≤ 80 draws.

## 4. Character, camera, movement

| # | Finding | Tag |
|---|---|---|
| 4.1 | Third-person camera high and behind; character in the lower third, ≈ 25 % of screen height | OBSERVED |
| 4.2 | WASD; the character turns toward the movement direction | OBSERVED |
| 4.3 | 4 character clips (idle, run, air, bored) | OBSERVED (file names) |
| 4.4 | Behavior when a house blocks the camera | UNKNOWN (synthetic key events were ignored by the page in the 2026-10-17 pass, so the character could not be driven behind a building) |
| 4.5 | Grass interaction | UNKNOWN |

**graao:** shoulder camera (it is a shooter, the reticle sits at screen center), camera collision with the world, and an
**original "paper dissolve"** (screen-space dither driven by a per-instance fade) on props that block the character,
instead of snapping the camera forward. Grass bends around the local player through a position uniform (local only, never
networked).

## 5. Multiplayer

| # | Finding | Tag |
|---|---|---|
| 5.1 | One WebSocket to a Cloud Run service after the world loads | OBSERVED (prior REA pass) |
| 5.2 | First server message: short JSON with an id and the server time | OBSERVED |
| 5.3 | Room by name request, then small binary frames (≈ 35 B sent / 37 B received, a few per second idle) | OBSERVED |
| 5.4 | Remote kids walking smoothly near the player | OBSERVED |
| 5.5 | Frame contents and interpolation method | UNKNOWN (binary not decoded, on purpose) |

**Principle:** presence fits in tens of bytes per message; the server clock comes first. **graao:** Colyseus room by
code, a WELCOME with server time and tick rate, compact quantized snapshots measured in the F3 overlay — but graao's
server is **authoritative** (combat), not presence-only.

## 6. UI

DOM UI (Svelte) with inline SVG icons, warm cream/grey palette, nothing over the screen center (OBSERVED).
**graao:** HUD and menus in DOM/CSS/SVG; Three.js draws only the world.

## 7. Not copied

No model, texture, shader, sound, font, layout or code. graao's camera, grass, obstruction dissolve, water and intro
transition are original.
