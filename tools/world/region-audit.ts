/**
 * Planet audit (docs/world/PLANET_LAYOUT.md): region-to-region surface distances and running times, and how much of
 * the surface lies far from every point of interest. `pnpm exec tsx tools/world/region-audit.ts`
 */
import { createTerrain, latLonToDir } from '@graao/game-core';
import { MOVEMENT, PLANET, REGIONS } from '@graao/game-data';
import { v3angle } from '@graao/shared';

const R = PLANET.radius;
const terrain = createTerrain();
const pois = REGIONS.filter((r) => r.name !== 'Mar do Sul');
console.log(`raio ${R} m · circunferência ${(2 * Math.PI * R).toFixed(0)} m · área ${(4 * Math.PI * R * R).toFixed(0)} m² · 1° = ${((Math.PI / 180) * R).toFixed(2)} m`);
console.log(`antípoda ${(Math.PI * R).toFixed(0)} m = ${(Math.PI * R / MOVEMENT.runSpeed).toFixed(0)} s correndo, ${(Math.PI * R / MOVEMENT.sprintSpeed).toFixed(0)} s em disparada`);
console.log('\nDistâncias pela superfície (m) e tempo correndo (s):');
for (let i = 0; i < pois.length; i++) {
  const a = pois[i]!;
  const row: string[] = [];
  for (let j = 0; j < pois.length; j++) {
    const b = pois[j]!;
    if (j <= i) continue;
    const d = v3angle(latLonToDir(a.lat, a.lon), latLonToDir(b.lat, b.lon)) * R;
    row.push(`${b.name}: ${d.toFixed(0)} m / ${(d / MOVEMENT.runSpeed).toFixed(0)} s`);
  }
  if (row.length) console.log(`  ${a.name} → ${row.join(' · ')}`);
}
// Coverage: Fibonacci samples on land; distance to the nearest POI edge.
const N = 20000;
let land = 0;
const bins = [0, 0, 0, 0];
for (let k = 0; k < N; k++) {
  const y = 1 - (2 * (k + 0.5)) / N;
  const r = Math.sqrt(1 - y * y);
  const phi = k * Math.PI * (3 - Math.sqrt(5));
  const d = { x: r * Math.cos(phi), y, z: r * Math.sin(phi) };
  if (terrain.heightAt(d) < PLANET.seaLevel + 0.2) continue;
  land++;
  let best = Infinity;
  for (const p of pois) best = Math.min(best, v3angle(d, latLonToDir(p.lat, p.lon)) * R - (p.radiusDeg * Math.PI / 180) * R);
  bins[best <= 0 ? 0 : best < 25 ? 1 : best < 50 ? 2 : 3]!++;
}
console.log(`\nTerra firme: ${((land / N) * 100).toFixed(0)} % da superfície`);
console.log(`  dentro de uma região: ${((bins[0]! / land) * 100).toFixed(0)} % · até 25 m da borda: ${((bins[1]! / land) * 100).toFixed(0)} % · 25–50 m: ${((bins[2]! / land) * 100).toFixed(0)} % · mais de 50 m: ${((bins[3]! / land) * 100).toFixed(0)} %`);
