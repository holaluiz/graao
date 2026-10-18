# UFO deployment (Phase 7)

Status: TESTING — the full journey READY → draft → UFO → drop → combat runs in the browser (against the network bot)
and in the integration suite; not yet played person vs person on two machines.

## The ritual

| Moment | What the player sees and does | Who decides |
|---|---|---|
| Reveal (4.5 s) | A paper wipe opens onto the whole planet from afar, in an orbit dusk with a warm halo; the ship's route is a dotted line (sun-yellow over the jump window), the ground track under the window is a dotted line on the surface, landmarks are named (DOM labels facing the camera). The camera then swoops onto the ship. | Server: route and timings |
| Aboard | Orbit camera around the UFO (mouse), the planet below. Panel: "SALTE QUANDO QUISER", the ESPAÇO key cap, the window bar, "salto automático em N s". | Server: window open/close |
| Jump | ESPAÇO sends `UFO_JUMP`; the dive starts on the server's `jump` event (one round trip, covered by the hatch sound and "SALTANDO…"). Whoever is still aboard when the window closes is dropped ("SALTO AUTOMÁTICO"). | Server: jump time and start state |
| Drop (≈ 3.5–5 s) | Skydive: belly-down box pose, WASD steers on the tangent plane, Shift dives head-first. Camera pitched down, FOV widens with the fall speed, camera-local speed lines, wind, a pale ribbon and petal puffs behind every diver (opponents read where you land), altimeter. The view levels out over the last metres. | Client predicts, server simulates the same commands |
| Landing | Feet-first flare, a dust ring and shockwave (or a splash in water), a landing impulse and thud; an opponent's landing is a threat sound, panned and attenuated. "NO CHÃO · esperando N pousar". | Server: first ground contact |
| Fight | When every participant is down the match starts where they landed, after the usual countdown (weapons locked until then). | Server |

## Rules and numbers (`@graao/game-data` `UFO`, `MOVEMENT.dive*`)

- Orbit radius 200 m (100 m above the sea), a great circle through a point ≤ 10° from the arena centre (Lantern
  Village) with a random heading. The jump window is one full lap (360°): the hatch opens 10° before that point and
  closes when the ship is back there, so a player can drop anywhere under the route (plus the steering reach either
  side), while jumping at once or being dropped at the close still lands by the village. The ship flies at 41.9 m/s
  (the ground track moves at 20.9 m/s).
- Reveal 4.5 s, window 30 s (solo too, with a 3.4 s reveal). Out of the hatch: 3 m under the hull, 6 m/s along the
  course.
- Skydive: terminal 22 m/s (head-first with Shift 38 m/s, braking back at 30 m/s²), steering 13 m/s (6 m/s head-first),
  acceleration 16 m/s². Measured over 10 routes from the middle of the window (`tools/profiling/dive-stats.ts`):
  4.9 s to the ground, 3.4 s head-first, ≈ 42 m of reach steering straight ahead.
- A diver still airborne 20 s after the window closed is set down on the ground under them (safety net).
- Nobody can deal or take damage during the UFO phase; the Ultimate charge starts with the fight.
- An opponent leaving during the deployment hands the win to whoever is still there (same rule as the match).

## How it works

- **Route** (`game-core/deploy.ts`): `makeUfoRoute` picks the closest approach `c`, the heading `h` and the angular
  speed; everything travels as integers (`UfoRouteMsg`, µ-units and ms) so `ufoPosition(route, t)` gives the same
  numbers on the server and every client. Clients only derive the ship's position; it is never streamed.
- **Server** (`GraaoMatchRoom`): `startDeploy` boards the participants (fresh vitals, ammo, abilities). Riders are not
  simulated: their queued commands are acknowledged and dropped, their position follows the ship, snapshots flag
  them `ON_SHIP`. `UFO_JUMP` inside the window (or the close) calls `jump`: the state comes from
  `diveStart(route, t)`, quantized exactly like the `jump` event (`at` mm, `v` cm/s), with `diving = true`. From then
  on the rider's commands drive the shared controller; the first ground contact clears `diving` → `land` event,
  deploy state LANDED. `everyoneLanded` → MATCH with the countdown, positions kept.
- **Shared controller** (`character.ts`): `diving` caps the fall and widens steering, ignores jump/aim/fire, and ends
  on the first ground contact. Client prediction and server run the same steps, so the jumper's reconciliation
  error stays at ≈ 0.1 cm (measured in the browser against the server).
- **Client** (`DeployDirector`): reveal and orbit cameras while riding (the local player is not simulated), the dive
  presentation, landing detection from its own prediction, remote divers' trails and landings, the deploy panel and
  altimeter (`Hud.setDeploy`, HUD modes `ufo` / `drop` hide the combat widgets). `UfoModel` (code-authored saucer,
  6.0 k tris in 4 draw calls: hull, ink shell, running lights, beam), `UfoRoutePath` (one Points draw call), `SpeedLines` (one instanced draw call).
  The skydive pose is a procedural clip on the T-pose bind plus a forward tilt of the character's visual root.
- **Atmosphere by altitude** (`GRARenderer.setAltitude`): the ground haze thins as the camera climbs, the sky blends
  into an orbit dusk with a halo hugging the planet's limb and a few stars, a fresnel shell glows on the limb, the
  near plane moves out for depth precision, and grass/flowers are skipped from high up (they are sub-pixel there).
- **Solo** starts with the same ritual offline (shorter reveal; the jump is applied locally). `?nodrop` skips it.

## Measurements (2026-10-17, HIGH, 697×728, Claude browser pane)

| View | Draw calls | Triangles (incl. shadows) | CPU frame |
|---|---|---|---|
| Reveal (whole planet) | 79 | 313 k | 2.7 ms |
| Aboard (orbit camera) | 72 | 296 k | 2.2 ms |
| High in the dive | 61 | 273 k | 3.2 ms |
| On the ground after landing | 87 | 638 k | 3.0 ms |

Before skipping grass/flowers from high up the reveal drew 122 calls and 1.01 M triangles.

## Known gaps

- The jump starts on the server's confirmation (one round trip). Predicting it would need the client to agree on the
  jump time; the hatch sound and panel cover the wait today.
- Landing spots are free: with the full-lap window two players can land on opposite sides of the planet, and the
  first one down may wait up to the whole window for the other. There is no closing zone yet (see the directive's
  spherical zone design: centre direction + angular radius).
- One great circle reaches a band ≈ 40 m wide either side of the ground track (about 40 % of the surface); the
  poles of the route stay out of reach in a given match (a new random heading every match moves the band).
- The route ignores where players currently stand; with more than 2 players a wider window or several passes may be
  needed.
