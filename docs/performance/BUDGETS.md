# Performance budgets and measurements

Measure, don't guess. Numbers below were taken on 2026-10-17 on the development PC in the Claude desktop browser pane
(Chromium, 697×728, DPR 1, quality HIGH) unless noted. Re-measure with F3 after any content change.

## Budgets (MVP, desktop Chrome/Edge)

| Metric | HIGH | LOW | Why |
|---|---|---|---|
| Frame time | ≤ 16.7 ms at 1080p | ≤ 16.7 ms on integrated GPUs | 60 fps |
| Draw calls | ≤ 150 (2 players) / ≤ 220 (20) | ≤ 80 | Summer Afternoon runs ≈ 64 (measured, see references) |
| Triangles / frame (incl. shadow pass) | ≤ 600 k | ≤ 250 k | |
| Character | ≤ 12 k tris, 1 skinned mesh + outline, 55 bones | same geometry, no outline optional | 20 players = 40 skinned draws |
| Initial download to menu | ≤ 3 MB gzip | | Shell paints immediately |
| Load to ENTER | ≤ 2 s on a mid PC | | |
| Server tick (20 Hz) | ≤ 5 ms with 20 players | | |
| Snapshot | ≤ 50 B per player | | |

## Measurements

| Metric | Value | How |
|---|---|---|
| Frame time (menu, village) | 16.7 ms median, 17.4 ms p95 (vsync-locked) | 120 rAF frames |
| CPU frame (update + render submit) | 1.0 ms | `frameMs` in F3 |
| Draw calls | 72 (menu) – 82 (village, play) | `renderer.info` |
| Triangles / frame | 366 k (menu) – 420 k (village) incl. shadow pass | `renderer.info` |
| Character | 9,996 – 10,912 tris, 5.9 – 6.3 k verts, 55 bones | `GraaoCharacter.stats` (7-character lineup) |
| Character build (all parts uncached) | 26 – 38 ms; cached part switch: merge only | `stats.buildMs` |
| Terrain | 62,720 tris in 20 culled chunks | `PlanetView.stats` |
| Props | 330 solid placements, 160 bushes, 42 k grass tufts (chunked), 1.8 k flowers | layout |
| Load (world / planet view / animations / shaders / total) | 355 / 253 / 194 / 14 / 943 ms | `GraaoApp.loadMs` |
| World build, Node (server, colliders only) | 400 – 1,060 ms (cold) | server log |
| Animation packs | 625 KB + 288 KB (36 clips, meshopt) from 15 MB CC0 sources | `tools/animation/build-animations.mjs` |
| Retarget at load | ≈ 200 ms for 26 clips | `anims.report.ms` |
| Client JS (gzip) | entry 1.8 KB · app 49 KB · net 51 KB · three 192 KB · rapier 1.67 MB | `pnpm build` |
| Snapshot (2 players) | 92 – 95 B at 20 Hz | F3 |
| Network (2 players) | ≈ 1.5 KB/s in, ≈ 1.2 KB/s out per client | F3 |
| Server tick cost (2 players) | 0.5 – 1.1 ms | PONG `tick` |
| Remote smoothness (60 Hz replay of real arrivals) | 0.5 % extrapolated frames, p95 frame-to-frame speed change 1.3 m/s while running over terrain | `tests/multiplayer.test.ts` |

## Known costs and next optimizations

1. **Rapier compat bundle is 1.67 MB gzip** (WASM embedded as base64). Switch the client to `@dimforge/rapier3d`
   (separate `.wasm`, streaming compile) when the deploy pipeline is in place: expected ≈ −1 MB.
2. **Shadow pass renders terrain chunks again**: fine at 82 draws; if needed, a dedicated low-res shadow terrain.
3. **Grass**: 42 k tufts; LOW keeps 35 %. GPU shrinks tufts beyond 34 m (horizon is ≈ 22 m on foot).
4. **20 players**: 40 skinned draws + 20 shadow draws. Outline can be disabled beyond 30 m if needed.
