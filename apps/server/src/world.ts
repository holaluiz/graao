/** The static game world (terrain trimesh + prop colliders) is identical for every room: build once per process. */
import { createGameWorld, resolveChestSpots, type ChestSpot, type GameWorld } from '@graao/game-core';
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

let spots: ChestSpot[] | null = null;

/** The authored chest spots resolved against the static world (once per process; every room picks from these). */
export function getChestSpots(w: GameWorld): ChestSpot[] {
  if (!spots) {
    const t0 = performance.now();
    spots = resolveChestSpots(w);
    const bad = spots.filter((s) => !s.ok);
    log('chest spots ready', { ms: Math.round(performance.now() - t0), valid: spots.length - bad.length, refused: bad.map((s) => `${s.def.id}: ${s.reason}`) });
  }
  return spots;
}
