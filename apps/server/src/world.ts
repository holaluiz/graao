/** The static game world (terrain trimesh + prop colliders) is identical for every room: build once per process. */
import { createGameWorld, type GameWorld } from '@graao/game-core';
import { log } from './log';

let world: Promise<GameWorld> | null = null;

export function getWorld(): Promise<GameWorld> {
  world ??= (async () => {
    const t0 = performance.now();
    const w = await createGameWorld({ includeVisual: false });
    log('world ready', { ms: Math.round(performance.now() - t0), colliders: w.physics.propByCollider.size, terrainTris: w.mesh.indices.length / 3 });
    return w;
  })();
  return world;
}
