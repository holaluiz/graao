/**
 * Creep areas on the real collision world: valid spawn points per area and why candidates were refused.
 *   pnpm exec tsx tools/profiling/creep-areas.ts
 */
import { resolveCreepAreas } from '@graao/game-core';
import { getWorld } from '../../apps/server/src/world';

const world = await getWorld();
const areas = resolveCreepAreas(world.physics);
let total = 0;
for (const a of areas) {
  total += Math.min(a.def.max, a.points.length);
  console.log(`${a.def.id.padEnd(22)} ${a.def.region.padEnd(20)} pontos ${String(a.points.length).padStart(2)} / max ${a.def.max}  recusas ${JSON.stringify(a.refused)}`);
}
console.log(`capacidade inicial (soma de min(max, pontos)): ${total}`);
process.exit(0);
