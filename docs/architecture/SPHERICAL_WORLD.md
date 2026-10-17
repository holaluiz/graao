# Spherical world

The gameplay world is a real sphere. There is no rectangular boundary; walking straight brings you back to the start.

## Conventions

- Planet center = world origin. `PLANET.radius = 100 m` (**test value**, see below).
- For any entity: `localUp = normalize(position)`, gravity = `-localUp × 20 m/s²`.
- Nothing assumes global Y is up. lat/lon (degrees) only exist in authored data (`latLonToDir`).
- Headings are **tangent vectors**, parallel-transported with the minimal rotation when `localUp` changes
  (`transportTangent`). No global yaw angle exists, so there is no pole singularity (tested over a full lap).

## Terrain

`createTerrain().heightAt(dir)`: 3-octave gradient noise (±2.2 m) + small detail + authored features
(`TERRAIN_FEATURES`: flatten, mound, basin, fissure). Each feature has a cosine early-out. The render mesh and the
Rapier trimesh are the same geodesic icosphere (frequency 56 → 62,720 triangles, edge ≈ 1.9 m), deduplicated, with
smooth normals over the whole sphere; the client splits it into 20 chunks (icosahedron faces) for frustum culling.
Water is a sphere at `radius + seaLevel` (−0.7 m).

## Layout

`buildLayout()` resolves `STRUCTURES` (village houses, well, lamps, wall, giant tree, observatory, arches, crystal
clusters, floating sky shard) and deterministic `SCATTER` rules (trees, pines, rocks with colliders; bushes, grass,
flowers visual only). Each placement has a local frame (X side = up × forward, Y up, Z forward) and collider primitives
(cuboid, cylinder, ball, convex hull) that the visual builders mirror.

## Character controller (GraaoSphericalCharacterController)

`CharacterMotor.step(body, state, input, dt)` (`packages/game-core/src/character.ts`):

1. project the world-space wish direction onto the tangent plane of the character's own up, clamp length ≤ 1;
2. accelerate horizontal velocity toward `wish × speed` (run 5.6, sprint 7.8, aim 3.4 m/s);
3. buffered jump (0.12 s) with coyote time (0.1 s), jump speed 7.2 m/s;
4. radial gravity on the vertical component;
5. Rapier `KinematicCharacterController` with `setUp(localUp)` every step (slopes ≤ 52°, autostep 0.38 m, snap 0.32 m);
6. transport facing/velocity to the new tangent plane, turn facing toward movement (or aim), derive `MovementState`.

## Camera

`GraaoThirdPersonCamera` keeps a transported heading + clamped pitch, shoulder pivot (0.42 m right, 1.62 m up),
distance 4.4 m (aim 2.3 m, FOV 70 → 52°), terrain-only pull-in (snap in, ease out), local up as camera up.
Props never snap the camera: `Obstruction` dissolves them.

## Horizon as gameplay

| Eye height | Horizon distance (R = 100 m) |
|---|---|
| 1.7 m (head) | 18.5 m |
| 2.5 m (camera) | 22.5 m |
| 9 m (observatory hill) | 43 m |
| 25 m (giant tree canopy) | 75 m |

Two standing players see each other's heads up to ≈ 37 m. Curvature limits sniping, hides flanks, and makes high
ground valuable. Circumference 628 m (≈ 112 s lap at run speed).

**To evaluate:** travel time between landmarks, 1v1 encounter frequency, weapon/ability ranges vs. 37 m mutual
visibility, UFO overview readability. Radius is one constant (`PLANET.radius`); everything scales from it.

## Future zone

Represent a safe region as `{ centerDirection, angularRadius }`; inside test = `angle(normalize(pos), center) <
angularRadius`. The zone will be a world state read by every material through a shared uniform.
