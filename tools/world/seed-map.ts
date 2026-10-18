/**
 * One-off seed of packages/game-data/src/world/planeta-graao.map.json (World Building 1.0, phase C).
 *
 * The Vila das Lanternas graybox is designed here in metres on the tangent plane of the plaza (x east, z north,
 * yaw clockwise from north) and projected onto the sphere with the exponential map at the plaza: distances along the
 * ground are kept, and every placement gets its own frame and its own yaw relative to its local north (the meridians
 * converge, so a constant "yaw 90" would drift). The footbridge is fitted between the two flat roofs it joins (its
 * height and heading come from the real roof edges). Everything outside the village is copied from the previous
 * hard-coded layout.
 *
 * After this seed, the map file is the source of truth and the dev map editor (`?editor`) edits it. Running the seed
 * again OVERWRITES the file: `pnpm exec tsx tools/world/seed-map.ts --write`.
 */
import { writeFileSync } from 'node:fs';
import { createTerrain, dirToLatLon, headingTangent, latLonToDir, transportTangent } from '@graao/game-core';
import { KIT, PLANET, serializeMap, type ChestSpotDef, type GraaoMap, type MapPlacement } from '@graao/game-data';
import { v3cross, v3dot, v3normalize, type Vec3 } from '@graao/shared';

const terrain = createTerrain();
const R = PLANET.radius;
const PLAZA = { lat: 8, lon: 0 };
const C = latLonToDir(PLAZA.lat, PLAZA.lon);
const N0 = headingTangent(C, 0);
const E0 = headingTangent(C, 90);
const RG = R + terrain.heightAt(C);
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
const add = (a: Vec3, b: Vec3, s = 1): Vec3 => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s });

/** Plaza-plane metres → unit direction (exponential map at the plaza centre). */
function dirAt(x: number, z: number): Vec3 {
  const d = Math.hypot(x, z);
  if (d < 1e-9) return { ...C };
  const t = v3normalize(add({ x: N0.x * (z / d), y: N0.y * (z / d), z: N0.z * (z / d) }, E0, x / d));
  const th = d / RG;
  return v3normalize(add({ x: C.x * Math.cos(th), y: C.y * Math.cos(th), z: C.z * Math.cos(th) }, t, Math.sin(th)));
}

/** Plaza-plane heading (degrees clockwise from north) → yaw relative to the local north at `dir`. */
function yawAt(dir: Vec3, yaw0: number): number {
  const a = (yaw0 * Math.PI) / 180;
  const f0 = v3normalize(add({ x: N0.x * Math.cos(a), y: N0.y * Math.cos(a), z: N0.z * Math.cos(a) }, E0, Math.sin(a)));
  const f = transportTangent(f0, C, dir);
  const n = headingTangent(dir, 0);
  const e = headingTangent(dir, 90);
  return ((Math.atan2(v3dot(f, e), v3dot(f, n)) * 180) / Math.PI + 360) % 360;
}

const placements: MapPlacement[] = [];
const chestSpots: ChestSpotDef[] = [];

/** A placement at plaza-plane (x, z) facing `yaw0`. */
function put(id: string, prefab: string, x: number, z: number, yaw0 = 0, extra: Partial<MapPlacement> = {}): MapPlacement {
  const dir = dirAt(x, z);
  const { lat, lon } = dirToLatLon(dir);
  const p: MapPlacement = { id, prefab, lat: round(lat, 5), lon: round(lon, 5), yaw: round(yawAt(dir, yaw0), 2), region: 'vila', ...extra };
  placements.push(p);
  return p;
}

/** The frame layout.ts builds for a placement (same rounding, same terrain). */
function frameOf(p: MapPlacement) {
  const up = latLonToDir(p.lat, p.lon);
  const forward = headingTangent(up, p.yaw);
  const side = v3normalize(v3cross(up, forward));
  const base = { x: up.x * (R + terrain.heightAt(up) + (p.lift ?? 0)), y: up.y * (R + terrain.heightAt(up) + (p.lift ?? 0)), z: up.z * (R + terrain.heightAt(up) + (p.lift ?? 0)) };
  const at = (lx: number, ly: number, lz: number): Vec3 => add(add(add(base, side, lx), up, ly), forward, lz);
  return { up, forward, side, base, at };
}

/** A chest spot at a world point (lat/lon + height over the terrain under it). */
function chestAt(def: Omit<ChestSpotDef, 'lat' | 'lon'>, point: Vec3): void {
  const dir = v3normalize(point);
  const { lat, lon } = dirToLatLon(dir);
  const h = Math.hypot(point.x, point.y, point.z) - (R + terrain.heightAt(dir));
  chestSpots.push({ ...def, lat: round(lat, 5), lon: round(lon, 5), ...(def.surface === 'prop' ? { height: round(h, 2) } : {}) });
}
const ground = (x: number, z: number): Vec3 => terrain.surfaceAt(dirAt(x, z));

// ------------------------------------------------------------------------------------------------ Vila das Lanternas

// Plaza: paving, the old well in the middle.
for (const [i, [x, z]] of [-6, -2, 2, 6].flatMap((x) => [-6, -2, 2, 6].map((z) => [x, z])).entries()) put(`vila-praca-${i}`, 'praca-4x4', x!, z!, 0);
put('vila-poco', 'poco', 0, 0, 0);

// North: Casa da Laje and Mercadinho face the plaza across Rua do Norte, joined by a footbridge between their roofs.
const casaLaje = put('vila-casa-laje', 'casa-laje', -5.4, 11.0, 180);
const mercadinho = put('vila-mercadinho', 'mercadinho', 5.4, 11.0, 180);
{
  // Roof edges where the footbridge lands: Casa da Laje's +X edge, Mercadinho's −X edge (slab overhang 0.2 m).
  const a = frameOf(casaLaje).at(3.2, KIT.roofTop, 0);
  const b = frameOf(mercadinho).at(-3.2, KIT.roofTop, 0);
  const mid = v3normalize(add(a, b));
  const { lat, lon } = dirToLatLon(mid);
  const up = latLonToDir(round(lat, 5), round(lon, 5));
  const baseR = R + terrain.heightAt(up);
  const lift = (v3dot(a, up) + v3dot(b, up)) / 2 - baseR;
  const along = v3normalize(add(b, a, -1));
  const n = headingTangent(up, 0);
  const e = headingTangent(up, 90);
  const yaw = ((Math.atan2(v3dot(along, e), v3dot(along, n)) * 180) / Math.PI + 360) % 360;
  placements.push({ id: 'vila-passarela', prefab: 'passarela-5', lat: round(lat, 5), lon: round(lon, 5), yaw: round(yaw, 2), lift: round(lift, 3), region: 'vila' });
  console.log(`passarela: vão ${Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z).toFixed(2)} m, altura ${lift.toFixed(3)} m, desnível entre as lajes ${(v3dot(a, up) - v3dot(b, up)).toFixed(3)} m`);
}
for (const [i, z] of [9.6, 13.8, 18.0, 22.2, 26.4].entries()) put(`vila-rua-norte-${i}`, 'calcamento-3x4', 0, z, 0);
put('vila-varal-lanternas-norte', 'varal-lanternas-5', 0, 7.7, 90, { lift: 4.3 });

// Behind Casa da Laje: a walled backyard with a clothesline (hides, does not stop shots) and a gate to the street.
put('vila-quintal-muro-o1', 'muro-baixo-2', -9.3, 15.3, 90);
put('vila-quintal-muro-o2', 'muro-baixo-2', -9.3, 17.3, 90);
put('vila-quintal-muro-n', 'muro-baixo-2', -8.3, 18.4, 0);
put('vila-quintal-muro-l', 'muro-baixo-2', -2.9, 15.3, 90);
put('vila-quintal-varal', 'varal-roupas-5', -5.8, 15.9, 90);
put('vila-casa-norte-o', 'casa-pintada', -5.6, 20.7, 90, { variant: 1 });
put('vila-casa-norte-l', 'casa-pintada', 6.1, 20.5, 270, { variant: 0 });
put('vila-muro-pedra', 'muro-pedra', -14.0, 19.0, 30);

// East: Casa do Beco (a shortcut through the block), the Lantern Tower, the Ladeira toward the Bosque.
put('vila-casa-beco', 'casa-beco', 12.4, -2.0, 270);
put('vila-torre', 'torre-lanterna', 15.0, 6.4, 225);
for (const [i, [x, z]] of [[12.6, 11.4], [15.6, 14.4], [18.6, 17.4], [21.6, 20.4]].entries()) put(`vila-ladeira-${i}`, 'calcamento-3x4', x!, z!, 45);
put('vila-varal-lanternas-ladeira', 'varal-lanternas-5', 11.0, 9.6, 135, { lift: 3.8 });
put('vila-casa-ladeira', 'casa-pintada', 19.6, 11.2, 315, { variant: 2 });
put('vila-casa-sudeste', 'casa-pintada', 16.8, -11.6, 315, { variant: 1 });
for (const [i, [x, z]] of [[16.8, -2.0], [21.0, -2.0], [25.2, -2.3]].entries()) put(`vila-beco-terra-${i}`, 'terra-3x4', x!, z!, 90);
put('vila-barril-beco-1', 'barril', 9.7, -6.1, 0);
put('vila-barril-beco-2', 'barril', 10.5, -6.6, 0);

// South-west: the Oficina by Rua do Lago (toward Lago Espelho); west: a dirt path toward the Fenda.
put('vila-oficina', 'oficina', -9.4, -10.8, 0);
for (const [i, [x, z]] of [[-2.8, -8.8], [-4.24, -12.75], [-5.67, -16.7], [-7.11, -20.64], [-8.55, -24.59]].entries()) put(`vila-rua-lago-${i}`, 'calcamento-3x4', x!, z!, 200);
put('vila-casa-sul', 'casa-pintada', 6.9, -10.8, 330, { variant: 0 });
put('vila-casa-oeste', 'casa-pintada', -15.2, 1.6, 90, { variant: 2 });
for (const [i, [x, z]] of [[-10.8, -2.6], [-14.9, -3.7], [-18.9, -4.8]].entries()) put(`vila-trilha-oeste-${i}`, 'terra-3x4', x!, z!, 255);

// Plaza cover: market stalls, benches, planters, crates, a cart, a low wall; lantern posts on the corners.
put('vila-barraca-1', 'barraca', -4.6, 3.6, 180);
put('vila-barraca-2', 'barraca', 4.2, -4.0, 0);
put('vila-banco-1', 'banco', 2.8, 4.0, 180);
put('vila-banco-2', 'banco', -2.4, -4.2, 0);
for (const [i, [x, z]] of [[-7.0, -5.8], [7.2, -5.6], [-7.4, 5.4], [7.4, 5.2]].entries()) put(`vila-vaso-${i}`, 'vaso', x!, z!, 0);
put('vila-pilha-praca', 'pilha-caixotes', 8.7, 3.4, 20);
put('vila-caixote-1', 'caixote', -7.8, -1.6, 10);
put('vila-caixote-2', 'caixote', -6.9, -2.7, 35);
put('vila-carrinho', 'carrinho', -1.2, -6.7, 70);
put('vila-muro-praca', 'muro-baixo-4', 3.8, -7.9, 0);
for (const [i, [x, z]] of [[-8.0, 0.3], [8.0, 0.3], [2.1, 8.2], [-2.2, -8.3]].entries()) put(`vila-poste-${i}`, 'poste-lanterna', x!, z!, 0);

// Village chests: indoors, on a roof, behind walls; each one reachable on foot.
chestAt({ id: 'vila-casa-laje', region: 'Vila das Lanternas', hint: 'dentro da Casa da Laje', yaw: 0, surface: 'prop', covered: true }, frameOf(casaLaje).at(2.0, KIT.floorTop, -1.9));
chestAt({ id: 'vila-mercadinho-laje', region: 'Vila das Lanternas', hint: 'na laje do Mercadinho (subir pela escada ou pela passarela)', yaw: 0, surface: 'prop' }, frameOf(mercadinho).at(-1.4, KIT.roofTop, -1.8));
chestAt({ id: 'vila-oficina', region: 'Vila das Lanternas', hint: 'debaixo do telhado da oficina', yaw: 0, surface: 'prop', covered: true }, frameOf(placements.find((p) => p.id === 'vila-oficina')!).at(-1.4, KIT.floorTop, 0.6));
chestAt({ id: 'vila-quintal', region: 'Vila das Lanternas', hint: 'no quintal atrás da Casa da Laje', yaw: 90 }, ground(-8.2, 17.5));
chestAt({ id: 'vila-beco', region: 'Vila das Lanternas', hint: 'atrás da Casa do Beco', yaw: 0 }, ground(15.2, -4.4));
chestAt({ id: 'vila-poco', region: 'Vila das Lanternas', hint: 'ao lado do poço', yaw: 200 }, ground(2.4, 1.2));
chestAt({ id: 'vila-torre', region: 'Vila das Lanternas', hint: 'ao pé da Torre da Lanterna', yaw: 270 }, ground(15.4, 3.4));

// ------------------------------------------------------------------------------------------------ rest of the planet

const classic: MapPlacement[] = [
  { id: 'bosque-arvore-gigante', prefab: 'arvore-gigante', lat: 34, lon: 62, yaw: 0, region: 'bosque' },
  { id: 'observatorio-torre', prefab: 'torre-observatorio', lat: -18, lon: 128, yaw: 40, region: 'observatorio' },
  { id: 'arcos-oeste', prefab: 'arco', lat: -4, lon: 58, yaw: 30, region: 'arcos' },
  { id: 'arcos-leste', prefab: 'arco', lat: -6, lon: 66, yaw: 75, region: 'arcos' },
  { id: 'fenda-cristais-norte', prefab: 'cristais', lat: 44, lon: -112, yaw: 10, scale: 1.4, region: 'fenda' },
  { id: 'fenda-cristais-meio', prefab: 'cristais', lat: 38, lon: -100, yaw: 80, scale: 1.0, region: 'fenda' },
  { id: 'fenda-cristais-sul', prefab: 'cristais', lat: 33, lon: -91, yaw: 140, scale: 1.2, region: 'fenda' },
  { id: 'lasca', prefab: 'lasca-flutuante', lat: 2, lon: -150, yaw: 0, scale: 1, lift: 16, region: 'lasca' },
];
placements.push(...classic);

const rename = (r: string) => (r === 'A Árvore Gigante' ? 'Bosque dos Varais' : r);
const OTHER_CHESTS: ChestSpotDef[] = [
  { id: 'arvore-raiz', region: 'A Árvore Gigante', lat: 34.6, lon: 66.2, hint: 'entre as raízes', yaw: 90 },
  { id: 'arvore-sombra', region: 'A Árvore Gigante', lat: 30.6, lon: 59.4, hint: 'na sombra da copa', yaw: 200 },
  { id: 'arvore-encosta', region: 'A Árvore Gigante', lat: 40.5, lon: 70.0, hint: 'na encosta, longe da trilha', yaw: 30 },
  { id: 'obs-plato', region: 'Velho Observatório', lat: -16.0, lon: 131.6, hint: 'no platô, ao pé da torre', yaw: 60 },
  { id: 'obs-subida', region: 'Velho Observatório', lat: -29.0, lon: 119.5, hint: 'no pé do morro, lado sul', yaw: 40 },
  { id: 'obs-base', region: 'Velho Observatório', lat: -9.5, lon: 136.0, hint: 'na base do morro', yaw: 30 },
  { id: 'lago-margem-norte', region: 'Lago Espelho', lat: -15.2, lon: -37.0, hint: 'na margem norte', yaw: 180 },
  { id: 'lago-margem-leste', region: 'Lago Espelho', lat: -29.0, lon: -20.5, hint: 'na margem leste', yaw: 270 },
  { id: 'lago-margem-oeste', region: 'Lago Espelho', lat: -34.0, lon: -56.5, hint: 'na margem oeste', yaw: 90 },
  { id: 'fenda-cristal-alto', region: 'Fenda de Cristal', lat: 47.0, lon: -106.5, hint: 'junto aos cristais grandes', yaw: 160 },
  { id: 'fenda-borda', region: 'Fenda de Cristal', lat: 36.5, lon: -103.5, hint: 'na borda da fenda', yaw: 30 },
  { id: 'fenda-cristal-sul', region: 'Fenda de Cristal', lat: 31.0, lon: -95.0, hint: 'atrás do cristal do sul', yaw: 200 },
  { id: 'lasca-sombra', region: 'Lasca do Céu', lat: 2.5, lon: -148.5, hint: 'debaixo da lasca flutuante', yaw: 0 },
  { id: 'lasca-pedras', region: 'Lasca do Céu', lat: -4.5, lon: -154.0, hint: 'entre as pedras', yaw: 300 },
  { id: 'arcos-meio', region: 'Arcos Afundados', lat: -6.4, lon: 61.8, hint: 'entre os arcos', yaw: 30 },
  { id: 'arcos-atras', region: 'Arcos Afundados', lat: -1.0, lon: 56.0, hint: 'atrás do arco oeste', yaw: 300 },
  { id: 'planalto-topo', region: 'Planalto Norte', lat: 71.0, lon: -18.0, hint: 'no alto do planalto', yaw: 180 },
  { id: 'planalto-beira', region: 'Planalto Norte', lat: 62.0, lon: -2.0, hint: 'na beira do planalto', yaw: 200 },
  { id: 'planalto-oeste', region: 'Planalto Norte', lat: 70.0, lon: -60.0, hint: 'no planalto, lado oeste', yaw: 120 },
  { id: 'trilha-leste', region: 'Trilhas', lat: 20.0, lon: 33.5, hint: 'a caminho do bosque', yaw: 60 },
  { id: 'trilha-sudeste', region: 'Trilhas', lat: -12.5, lon: 96.0, hint: 'a caminho do observatório', yaw: 100 },
  { id: 'trilha-noroeste', region: 'Trilhas', lat: 27.5, lon: -57.5, hint: 'a caminho da fenda', yaw: 300 },
  { id: 'trilha-sul', region: 'Trilhas', lat: -40.0, lon: 70.0, hint: 'no campo ao sul dos arcos', yaw: 180 },
  { id: 'trilha-oeste', region: 'Trilhas', lat: -18.0, lon: -100.0, hint: 'entre o lago e a lasca', yaw: 250 },
  { id: 'trilha-nordeste', region: 'Trilhas', lat: 50.0, lon: 125.0, hint: 'no campo do nordeste', yaw: 40 },
  { id: 'trilha-antipoda', region: 'Trilhas', lat: 12.0, lon: 175.0, hint: 'do outro lado do planeta', yaw: 0 },
  { id: 'trilha-sudoeste', region: 'Trilhas', lat: -45.0, lon: -125.0, hint: 'no vale do sudoeste', yaw: 150 },
];
chestSpots.push(...OTHER_CHESTS.map((c) => ({ ...c, region: rename(c.region) })));

const map: GraaoMap = { mapId: 'planeta-graao', mapVersion: 1, geometryVersion: 1, collisionVersion: 1, placements, chestSpots };
const out = new URL('../../packages/game-data/src/world/planeta-graao.map.json', import.meta.url);
const json = serializeMap(map);
console.log(`${placements.length} posicionamentos (${placements.filter((p) => p.region === 'vila').length} na vila), ${chestSpots.length} pontos de baú`);
if (process.argv.includes('--write')) {
  writeFileSync(out, json);
  console.log(`gravado em ${out.pathname}`);
} else console.log('(simulação: use --write para gravar)');
