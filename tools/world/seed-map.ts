/**
 * Authoring script of packages/game-data/src/world/planeta-graao.map.json (docs/world/WORLD_DESIGN.md).
 *
 * Each region is designed in its own script (tools/world/regions/) in metres on the tangent plane of its centre and
 * projected onto the sphere (tools/world/author.ts); this script composes them with the classic landmarks between
 * them, the trails that join the regions and the chest spots of the open country, then writes the versioned map that
 * the client and the server both load. After a run, the dev map editor (`?editor`) can adjust the file; running the
 * script again OVERWRITES those edits, so port editor changes into the region scripts first.
 *
 *   pnpm exec tsx tools/world/seed-map.ts            (dry run: counts and warnings)
 *   pnpm exec tsx tools/world/seed-map.ts --write    (writes the map file)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { buildingSite, dirToLatLon, latLonToDir } from '@graao/game-core';
import { KIT_BUILDINGS, PLANET, serializeMap, type ChestSpotDef, type GraaoMap, type MapPlacement } from '@graao/game-data';
import { v3angle, v3cross, v3normalize, type Vec3 } from '@graao/shared';
import { round, terrain, type MapSink } from './author';
import { authorBairro } from './regions/bairro';
import { authorLago } from './regions/lago';
import { authorBosque, authorFenda, authorSerra } from './regions/natural';
import { authorVila } from './regions/vila';

const sink: MapSink = { placements: [], chestSpots: [], waypoints: [], trails: [] };

authorVila(sink);
authorBairro(sink);
authorLago(sink);
authorFenda(sink);
authorSerra(sink);
authorBosque(sink);

// ------------------------------------------------------------------------------------------------ classic landmarks

sink.placements.push(
  { id: 'bosque-arvore-gigante', prefab: 'arvore-gigante', lat: 34, lon: 62, yaw: 0, region: 'bosque' },
  { id: 'observatorio-torre', prefab: 'torre-observatorio', lat: -18, lon: 128, yaw: 40, region: 'observatorio' },
  { id: 'arcos-oeste', prefab: 'arco', lat: -4, lon: 58, yaw: 30, region: 'arcos' },
  { id: 'arcos-leste', prefab: 'arco', lat: -6, lon: 66, yaw: 75, region: 'arcos' },
  { id: 'fenda-cristais-norte', prefab: 'cristais', lat: 41.624, lon: -118.201, yaw: 10, scale: 1.4, region: 'fenda' },
  { id: 'fenda-cristais-meio', prefab: 'cristais', lat: 37.2, lon: -98.6, yaw: 80, scale: 1.0, region: 'fenda' },
  { id: 'fenda-cristais-sul', prefab: 'cristais', lat: 33, lon: -91, yaw: 140, scale: 1.2, region: 'fenda' },
  { id: 'lasca', prefab: 'lasca-flutuante', lat: 2, lon: -150, yaw: 0, scale: 1, lift: 16, region: 'lasca' },
);

// ------------------------------------------------------------------------------------------------ trails between regions

/**
 * A dirt trail painted along the great circle from a to b (lat/lon): sampled every `step` m, the runs in the water and
 * near the excluded points (region cores, already paved) are left out; each remaining run is one painted arc.
 */
function trail(id: string, a: [number, number], b: [number, number], step: number, skip: { at: [number, number]; m: number }[] = []) {
  const A = latLonToDir(a[0], a[1]);
  const B = latLonToDir(b[0], b[1]);
  const ang = v3angle(A, B);
  const n = Math.max(1, Math.round((ang * PLANET.radius) / step));
  const axis = v3normalize(v3cross(A, B));
  const ortho = v3cross(axis, A);
  const skipDirs = skip.map((s) => ({ d: latLonToDir(s.at[0], s.at[1]), m: s.m }));
  const runs: [number, number][][] = [];
  let run: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * ang;
    const d: Vec3 = v3normalize({ x: A.x * Math.cos(t) + ortho.x * Math.sin(t), y: A.y * Math.cos(t) + ortho.y * Math.sin(t), z: A.z * Math.cos(t) + ortho.z * Math.sin(t) });
    const keep = terrain.heightAt(d) >= PLANET.seaLevel + 0.25 && !skipDirs.some((s) => v3angle(d, s.d) * PLANET.radius < s.m);
    if (keep) {
      const { lat, lon } = dirToLatLon(d);
      run.push([round(lat, 5), round(lon, 5)]);
    } else if (run.length) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  // A run lies on one great circle: its two ends are the whole arc.
  runs.filter((r) => r.length >= 2).forEach((r, k) => sink.trails.push({ id: `${id}-${k}`, points: [r[0]!, r[r.length - 1]!], width: 2.4, region: 'trilhas' }));
}
const cores = [
  { at: [8, 0] as [number, number], m: 30 },
  { at: [-12.06, -18.02] as [number, number], m: 24 },
  { at: [-30, -38] as [number, number], m: 26 },
  { at: [34, 62] as [number, number], m: 26 },
];
trail('trilha-vila-bosque', [16, 14], [26, 50], 4.2, cores);
trail('trilha-vila-planalto', [26, -8], [58, -18], 4.2, cores);
trail('trilha-bairro-fenda', [-6, -32], [30, -92], 4.2, cores);
trail('trilha-lago-serra', [-18, -52], [52, -88], 4.2, cores);
trail('trilha-bosque-arcos', [22, 62], [2, 62], 4.2, cores);

// ------------------------------------------------------------------------------------------------ open-country chests

const OTHER_CHESTS: ChestSpotDef[] = [
  { id: 'obs-plato', region: 'Velho Observatório', lat: -16.0, lon: 131.6, hint: 'no platô, ao pé da torre', yaw: 60 },
  { id: 'obs-subida', region: 'Velho Observatório', lat: -29.0, lon: 119.5, hint: 'no pé do morro, lado sul', yaw: 40 },
  { id: 'obs-base', region: 'Velho Observatório', lat: -9.5, lon: 136.0, hint: 'na base do morro', yaw: 30 },
  { id: 'lasca-sombra', region: 'Lasca do Céu', lat: 2.5, lon: -148.5, hint: 'debaixo da lasca flutuante', yaw: 0 },
  { id: 'lasca-pedras', region: 'Lasca do Céu', lat: -4.5, lon: -154.0, hint: 'entre as pedras', yaw: 300 },
  { id: 'arcos-meio', region: 'Arcos Afundados', lat: -6.4, lon: 61.8, hint: 'entre os arcos', yaw: 30 },
  { id: 'arcos-atras', region: 'Arcos Afundados', lat: -1.0, lon: 56.0, hint: 'atrás do arco oeste', yaw: 300 },
  { id: 'trilha-leste', region: 'Trilhas', lat: 20.0, lon: 33.5, hint: 'a caminho do bosque', yaw: 60 },
  { id: 'trilha-sudeste', region: 'Trilhas', lat: -12.5, lon: 96.0, hint: 'a caminho do observatório', yaw: 100 },
  { id: 'trilha-noroeste', region: 'Trilhas', lat: 27.5, lon: -57.5, hint: 'a caminho da fenda', yaw: 300 },
  { id: 'trilha-sul', region: 'Trilhas', lat: -40.0, lon: 70.0, hint: 'no campo ao sul dos arcos', yaw: 180 },
  { id: 'trilha-oeste', region: 'Trilhas', lat: -18.0, lon: -100.0, hint: 'entre o lago e a lasca', yaw: 250 },
  { id: 'trilha-nordeste', region: 'Trilhas', lat: 50.0, lon: 125.0, hint: 'no campo do nordeste', yaw: 40 },
  { id: 'trilha-antipoda', region: 'Trilhas', lat: 12.0, lon: 175.0, hint: 'do outro lado do planeta', yaw: 0 },
  { id: 'trilha-sudoeste', region: 'Trilhas', lat: -45.0, lon: -125.0, hint: 'no vale do sudoeste', yaw: 150 },
];
sink.chestSpots.push(...OTHER_CHESTS);

// ------------------------------------------------------------------------------------------------ checks and output

const warnings: string[] = [];
for (const p of sink.placements as MapPlacement[]) {
  const b = KIT_BUILDINGS[p.prefab];
  if (!b) continue;
  const site = buildingSite(terrain, b, p);
  for (const w of site.warnings) warnings.push(`${p.id}: ${w}`);
}
const map: GraaoMap = { mapId: 'planeta-graao', mapVersion: 4, geometryVersion: 4, collisionVersion: 4, placements: sink.placements, chestSpots: sink.chestSpots, waypoints: sink.waypoints, trails: sink.trails };
const byRegion = new Map<string, number>();
for (const p of map.placements) byRegion.set(p.region ?? '-', (byRegion.get(p.region ?? '-') ?? 0) + 1);
console.log(`${map.placements.length} posicionamentos: ${[...byRegion].map(([r, n]) => `${r} ${n}`).join(' · ')}`);
console.log(`${map.chestSpots.length} pontos de baú, ${map.waypoints?.length ?? 0} waypoints, ${map.trails?.length ?? 0} trilhas`);
for (const w of warnings) console.log(`  aviso: ${w}`);
const out = new URL('../../packages/game-data/src/world/planeta-graao.map.json', import.meta.url);
// A file saved by the map editor holds hand edits these scripts do not know: never overwrite it silently.
const current = JSON.parse(readFileSync(out, 'utf8')) as GraaoMap;
if (current.editedAt && process.argv.includes('--write') && !process.argv.includes('--force')) {
  const mine = new Map(map.placements.map((p) => [p.id, JSON.stringify(p)]));
  const theirs = new Map(current.placements.map((p) => [p.id, JSON.stringify(p)]));
  const changed = [...theirs].filter(([id, t]) => mine.get(id) !== t).map(([id]) => id);
  const gone = [...mine.keys()].filter((id) => !theirs.has(id));
  console.log(`
O mapa foi editado no editor (${current.editedAt}, versão ${current.mapVersion}) e difere destes scripts:`);
  console.log(`  ${changed.length} posicionamentos novos ou mudados no arquivo: ${changed.slice(0, 20).join(', ')}${changed.length > 20 ? '…' : ''}`);
  console.log(`  ${gone.length} posicionamentos apagados no editor: ${gone.slice(0, 20).join(', ')}${gone.length > 20 ? '…' : ''}`);
  console.log('Leve essas mudanças para tools/world/regions/ e rode de novo com --force (ou mantenha o arquivo do editor).');
  process.exit(1);
}
if (process.argv.includes('--write')) {
  writeFileSync(out, serializeMap(map));
  console.log(`gravado em ${decodeURIComponent(out.pathname)}`);
} else console.log('(simulação: use --write para gravar)');
