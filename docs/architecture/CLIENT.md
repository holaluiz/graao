# Client

Vite + TypeScript, Three.js r186 `WebGLRenderer` (WebGL2), DOM/CSS/SVG UI. Entry `apps/client/src/main.ts`.

## Boot

`index.html` paints the logo and a real progress bar inline (no script needed). `main.ts` (3.5 KB) dynamically imports
the engine chunk, then `GraaoApp.load()` reports progress: world (terrain, layout, Rapier) → planet view → animation
retargeting → local character → shader warm-up. **ENTER GRAAO** unlocks audio and starts a paper→world reveal.
`?auto` skips ENTER (development and tests); `?quality=LOW|MEDIUM|HIGH`; `?lineup=N` spawns N random characters;
`?nodrop` starts solo play on the ground instead of from the UFO.

## Phases (GRAHudDirector, `app/GraaoApp.ts`)

`MENU` (character framed on the plaza), `CHARACTER_CREATOR` (front framing, drag/zoom), `MATCH` (free roam or online).
Each phase sets visible UI, input enablement and camera context. Inside MATCH the server's phases are presented by
the CombatDirector (warmup, countdown, results), the DraftScreen (ABILITY_DRAFT) and the DeployDirector (UFO and DROP:
reveal, ride, dive, landing; HUD modes `ufo` / `drop` hide the combat widgets). Later: ROOM.

## Frame (`GraaoApp.frame`)

input → camera look → local fixed-step prediction (60 Hz accumulator) → net (send inputs, interpolate remotes) →
camera (terrain pull-in) → combat → deploy → character pose/animation → obstruction dissolve → sun rig → planet
uniforms → atmosphere by camera altitude → render → F3. Aboard the UFO the ride camera replaces the prediction and the
third-person camera (the local player is not simulated until the server's `jump`).

## Quality

Players always run HIGH (the menu has no selector); LOW and MEDIUM are only reachable through `?quality=`.

| | LOW | MEDIUM | HIGH |
|---|---|---|---|
| Pixel ratio cap | 1 | 1.25 | 2 |
| Shadow map | 1024 | 2048 | 2048 |
| Grass | 35 % | 70 % | 100 % |
| Flowers | off | on | on |

LOW never removes players, projectiles, telegraphs or Ultimate Marks.

## Debug

F3 overlay; `window.__graao` in dev builds.
