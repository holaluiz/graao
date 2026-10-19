/**
 * ASCII height map of a region plane (authoring aid): `pnpm exec tsx tools/world/heightmap.ts <lat> <lon> [heading] [half] [step]`.
 * Each cell prints the terrain height above the radius in whole metres ('~' = water, under the sea level); the centre
 * row and column are marked. Rows run from +z (top) to −z, columns from −x to +x.
 */
import { PLANET } from '@graao/game-data';
import { regionPlane } from './author';

const [lat, lon, heading = '0', half = '40', step = '2'] = process.argv.slice(2);
const sink = { placements: [], chestSpots: [], waypoints: [], trails: [] };
const plane = regionPlane(sink, 'x', { lat: Number(lat), lon: Number(lon) }, Number(heading));
const H = Number(half);
const S = Number(step);
const cols: number[] = [];
for (let x = -H; x <= H + 1e-9; x += S) cols.push(x);
console.log('      ' + cols.map((x) => (Math.round(x) % 10 === 0 ? String(Math.round(x)).padStart(3) : '   ')).join(''));
for (let z = H; z >= -H - 1e-9; z -= S) {
  const row = cols.map((x) => {
    const h = plane.height(x, z);
    const c = h < PLANET.seaLevel ? '  ~' : h.toFixed(0).padStart(3);
    return c;
  });
  console.log(String(Math.round(z)).padStart(5) + ' ' + row.join(''));
}
