# GRAVFXSystem (Phase 3: IN USE)

`apps/client/src/render/vfx/GRAVFXSystem.ts`. Two pooled GPU primitives, one draw call each, no Object3D per effect:

- **Beams** (96 slots): camera-facing ribbons between two points with a travelling bright head; width and alpha fade
  over life. Tracers for both weapons.
- **Particles** (1024 slots): billboards animated entirely in the vertex shader (drag, radial gravity toward the
  planet centre). Shapes by SDF: DOT, SPARK (stretched along velocity), RING (expands), PETAL, SHARD.

Spawning writes one slot of a ring buffer (`beam`, `burst`, `flash`, `ring`); attributes upload once per frame when
dirty. Measured cost: +2 draw calls, +2 240 triangles (constant). The F3 overlay shows live slots ("VFX ativos").

Categories: GameplayCritical, CombatBurst, PersistentMark, Environment, CinematicOnly, DeploymentTrail. Quality scales
burst counts (LOW 0.45, MEDIUM 0.75, HIGH 1) except GameplayCritical, which is never reduced (tracers, hit feedback,
shield breaks, eliminations).

Still to build: Trail, Shockwave on the ground, GroundDecal (ability telegraphs), Dissolve, the Ultimate Mark
(PersistentMark).
