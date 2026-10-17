/** One-call construction of the deterministic game world shared by client and server. */
import { buildLayout, type WorldLayout } from './layout';
import { createPhysics, initRapier, type GamePhysics } from './physics';
import { buildTerrainMesh, createTerrain, type Terrain, type TerrainMesh } from './terrain';

export interface GameWorld {
  terrain: Terrain;
  mesh: TerrainMesh;
  layout: WorldLayout;
  physics: GamePhysics;
}

export async function createGameWorld(opts: { includeVisual: boolean }): Promise<GameWorld> {
  const R = await initRapier();
  const terrain = createTerrain();
  const mesh = buildTerrainMesh(terrain);
  const layout = buildLayout(terrain, { includeVisual: opts.includeVisual });
  const physics = createPhysics(R, mesh, layout);
  return { terrain, mesh, layout, physics };
}
