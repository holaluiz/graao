/** The static game world (terrain trimesh + prop colliders) is identical for every room: build once per process. */
import { buildNavGraph, createGameWorld, resolveChestSpots, resolveCreepAreas, type ChestSpot, type CreepArea, type GameWorld, type NavGraph } from '@graao/game-core';
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

const creepAreas = new WeakMap<GameWorld, CreepArea[]>();

/** The creep areas validated against the static world (once per process; every room spawns from these). */
export function getCreepAreas(w: GameWorld): CreepArea[] {
  let areas = creepAreas.get(w);
  if (!areas) {
    const t0 = performance.now();
    areas = resolveCreepAreas(w.physics);
    creepAreas.set(w, areas);
    log('creep areas ready', { ms: Math.round(performance.now() - t0), points: areas.map((a) => `${a.def.id}: ${a.points.length}`), off: areas.filter((a) => !a.points.length).map((a) => `${a.def.id} ${JSON.stringify(a.refused)}`) });
  }
  return areas;
}

const navs = new WeakMap<GameWorld, NavGraph>();

/** The bots' navigation graph of the static world (built on first use, once per process: about 2 s). */
export function getNav(w: GameWorld): NavGraph {
  let nav = navs.get(w);
  if (!nav) {
    nav = buildNavGraph(w);
    navs.set(w, nav);
    log('nav graph ready', nav.stats);
  }
  return nav;
}
