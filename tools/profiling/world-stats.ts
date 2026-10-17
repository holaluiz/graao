/** Prints world build cost and content counts: `pnpm tsx tools/profiling/world-stats.ts` */
import { createGameWorld, horizonDistance } from '@graao/game-core';
import { PLANET } from '@graao/game-data';

for (const includeVisual of [false, true]) {
  const t0 = performance.now();
  const w = await createGameWorld({ includeVisual });
  const ms = performance.now() - t0;
  const byKind = new Map<string, number>();
  for (const p of w.layout.placements) byKind.set(p.kind, (byKind.get(p.kind) ?? 0) + 1);
  let min = Infinity, max = -Infinity;
  for (const h of w.mesh.heights) { min = Math.min(min, h); max = Math.max(max, h); }
  console.log(`includeVisual=${includeVisual} build ${ms.toFixed(0)} ms`);
  console.log(`  terrain ${w.mesh.positions.length / 3} verts, ${w.mesh.indices.length / 3} tris, height ${min.toFixed(1)}..${max.toFixed(1)} m`);
  console.log(`  colliders ${w.physics.propByCollider.size}, placements ${[...byKind].map(([k, n]) => `${k}:${n}`).join(' ')}`);
  w.physics.dispose();
}
console.log(`radius ${PLANET.radius} m, circumference ${(2 * Math.PI * PLANET.radius).toFixed(0)} m, horizon from 2.5 m eye ${horizonDistance(PLANET.radius, 2.5).toFixed(1)} m, from 25 m tower ${horizonDistance(PLANET.radius, 25).toFixed(1)} m`);
