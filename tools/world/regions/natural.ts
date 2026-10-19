/**
 * The natural regions (docs/world/POI_DESIGN.md):
 *
 * - Fenda de Cristal (the fantastic side of the iron mountains): a water-filled crack between two rocky rims, plank
 *   bridges across it, an old mine gallery cut into the end of the Serra with crystals glowing at its back, iron-ore
 *   boulders and crystal clusters for cover.
 * - Planalto Norte and Serra do Mirante (after the Serra do Curral): open high ground with tilted itabirite crests,
 *   wooden lookouts on the summits (strong but exposed, reached on foot), a pass between the two crests.
 * - Bosque dos Varais (after the Serra do Cipó and the farms of Minas): the giant tree on the hill, a waterfall off a
 *   quartzite cliff with a hidden cleft behind the water, the stream down the hill, a farmhouse with its porch, yard,
 *   vegetable beds, orchard and clothesline, wooden bridges and trails.
 */
import { KIT, PLANET } from '@graao/game-data';
import { frameOf, regionPlane, type MapSink, type RegionPlane } from '../author';

const liftOf = (p: RegionPlane) => (x: number, z: number, h: number) => Math.round((h - p.height(x, z)) * 1000) / 1000;

// ------------------------------------------------------------------------------------------------ Fenda de Cristal

export function authorFenda(sink: MapSink) {
  // Plane: centre (40, −103), z along the crack toward its south-east end, x across it (the crack's water x −5..−1).
  const f = regionPlane(sink, 'fenda', { lat: 40, lon: -103 }, 120.5);
  const { put, ground, chestAt } = f;
  const liftTo = liftOf(f);
  const region = 'Fenda de Cristal';
  // Plank bridges over the water (decks 1 m above the sea level), crossing the crack at two places.
  put('fenda-ponte-norte', 'ponte-tabuas', -3.0, 12.0, 90, { lift: liftTo(-3.0, 12.0, PLANET.seaLevel + 1.7) });
  put('fenda-ponte-sul', 'ponte-tabuas', -3.0, -14.0, 90, { lift: liftTo(-3.0, -14.0, PLANET.seaLevel + 1.7) });
  // The old mine in the end of the Serra (west), its gallery running into the rock (toward −x).
  const mina = put('fenda-boca-mina', 'boca-mina', -14.8, -2.2, 90);
  put('fenda-trilhos-mina', 'marco-trilha', -12.6, 1.4, 90);
  // Crystals and iron-ore boulders on both rims.
  for (const [i, [x, z, s]] of [[-9.4, 8.0, 1.2], [3.6, -4.0, 1.4], [-8.8, -20.0, 1.0], [4.4, 18.0, 1.1]].entries()) put(`fenda-cristal-${i}`, 'cristal-grande', x!, z!, i * 70, { scale: s });
  for (const [i, [x, z, kind]] of ([[-10.6, 2.0, 'rocha-ferro-g'], [5.6, 8.0, 'rocha-ferro-m'], [6.2, -10.0, 'rocha-ferro-g'], [-9.8, -9.0, 'rocha-ferro-m'], [-11.0, 16.0, 'rocha-ferro-p'], [7.6, 22.0, 'rocha-ferro-m']] as [number, number, string][]).entries()) put(`fenda-rocha-${i}`, kind, x, z, i * 53);
  put('fenda-lapa', 'lapa-pedra', 8.6, 2.0, 100);
  put('fenda-degraus', 'degrau-rocha', 3.6, 13.4, 20);
  put('fenda-degraus-2', 'degrau-rocha', -9.6, -15.8, 200);
  // Chests: deep in the mine (covered), under the overhang, by the crystals on the rims, at a bridge's end.
  chestAt({ id: 'fenda-mina', region, hint: 'no fundo da mina, junto aos cristais', yaw: 0, surface: 'prop', covered: true }, frameOf(mina).at(0, 0, -5.4));
  chestAt({ id: 'fenda-lapa', region, hint: 'debaixo da lapa de pedra', yaw: 270, covered: true }, ground(8.8, 2.3));
  chestAt({ id: 'fenda-borda-norte', region, hint: 'na borda da fenda, ao lado do cristal', yaw: 90 }, ground(-10.6, 10.4));
  chestAt({ id: 'fenda-ponte', region, hint: 'na cabeceira da ponte de tábuas', yaw: 270 }, ground(4.6, -15.6));
}

// ------------------------------------------------------------------------------------------------ Planalto and Serra

export function authorSerra(sink: MapSink) {
  // Planalto Norte: plane centre (72, −20), z toward the Serra (heading −81.8).
  const p = regionPlane(sink, 'planalto', { lat: 72, lon: -20 }, -81.8);
  const regionP = 'Planalto Norte';
  const mirante = p.put('planalto-mirante', 'mirante-madeira', 0, 0, 200);
  for (const [i, [x, z, yaw]] of [[-9, 6, 30], [8, -7, 120], [-4, -14, 75], [12, 9, 160], [3, 16, 20]].entries()) p.put(`planalto-crista-${i}`, 'crista-itabirito', x!, z!, yaw!);
  for (const [i, [x, z, kind]] of ([[6, 4, 'rocha-ferro-m'], [-7, -4, 'rocha-ferro-g'], [14, -2, 'rocha-quartzito-2'], [-14, 12, 'rocha-quartzito-1'], [2, -9, 'degrau-rocha']] as [number, number, string][]).entries()) p.put(`planalto-rocha-${i}`, kind, x, z, i * 47);
  p.put('planalto-lapa', 'lapa-pedra', -12, -10, 40);
  p.put('planalto-marco', 'marco-trilha', 4, 22, 0);
  p.chestAt({ id: 'planalto-mirante', region: regionP, hint: 'no alto do mirante do planalto', yaw: 200, surface: 'prop' }, frameOf(mirante).at(-0.8, 2.4, -0.6));
  p.chestAt({ id: 'planalto-crista', region: regionP, hint: 'atrás das lajes de itabirito', yaw: 300 }, p.ground(-10.4, 8.8));
  p.chestAt({ id: 'planalto-lapa', region: regionP, hint: 'debaixo da lapa', yaw: 40, covered: true }, p.ground(-12, -10));

  // Serra do Mirante: plane centre (60.5, −82), z along the crests toward the Fenda (heading ≈ −130 there).
  const s = regionPlane(sink, 'serra', { lat: 60.5, lon: -82 }, -130);
  const regionS = 'Serra do Mirante';
  // The summit lookout on the highest smooth point of the first crest, stone steps up its flank, a lapa in the pass.
  const top = bestSpot(s, -14, 14, -14, 14, (h, slope) => h - slope * 6);
  const mir = s.put('serra-mirante', 'mirante-madeira', top.x, top.z, 0);
  for (const [i, [x, z, yaw]] of [[top.x - 6, top.z + 4, 60], [top.x + 5, top.z - 5, 150], [top.x + 9, top.z + 6, 20]].entries()) s.put(`serra-crista-${i}`, 'crista-itabirito', x!, z!, yaw!);
  // The lapa on the flattest ground of the pass (its chest sits under the slab, between the boulders).
  const lapa = bestSpot(s, -3, 1, 15, 18, (_h, slope) => -slope);
  s.put('serra-lapa', 'lapa-pedra', lapa.x, lapa.z, 130);
  s.put('serra-marco-passo', 'marco-trilha', 1, 9, 0);
  for (const [i, [x, z, kind]] of ([[-6, 13, 'rocha-ferro-g'], [8, 8, 'rocha-ferro-m'], [-3, -18, 'rocha-quartzito-1']] as [number, number, string][]).entries()) s.put(`serra-rocha-${i}`, kind, x, z, i * 61);
  s.chestAt({ id: 'serra-mirante', region: regionS, hint: 'no mirante do pico da serra', yaw: 0, surface: 'prop' }, frameOf(mir).at(0.6, 2.4, -0.8));
  s.chestAt({ id: 'serra-passo', region: regionS, hint: 'debaixo da lapa, no passo da serra', yaw: 130, covered: true }, s.ground(lapa.x, lapa.z));
}

/** The point of a plane rectangle that maximises score(height, slope), sampled every metre. */
function bestSpot(p: RegionPlane, x0: number, x1: number, z0: number, z1: number, score: (h: number, slope: number) => number) {
  let best = { x: 0, z: 0, v: -Infinity };
  for (let x = x0; x <= x1; x += 1) {
    for (let z = z0; z <= z1; z += 1) {
      const h = p.height(x, z);
      const slope = Math.max(Math.abs(p.height(x + 1.5, z) - p.height(x - 1.5, z)), Math.abs(p.height(x, z + 1.5) - p.height(x, z - 1.5))) / 3;
      const v = score(h, slope);
      if (v > best.v) best = { x, z, v };
    }
  }
  return best;
}

// ------------------------------------------------------------------------------------------------ Bosque dos Varais

export function authorBosque(sink: MapSink) {
  // Plane: centre (34, 62) — the giant tree on the hilltop — x east, z north.
  const b = regionPlane(sink, 'bosque', { lat: 34, lon: 62 }, 0);
  const { put, ground, chestAt, path, trail } = b;
  const region = 'Bosque dos Varais';
  // Waterfall on the south flank: the pool terrace (2.2 m) at the cliff's foot, the shelf (7.2 m) behind it.
  const fall = put('bosque-cachoeira', 'cachoeira', 0, -16.6, 180, { settle: 'center' });
  // The stream: from the shelf, over the falls, into the pool, then down the hill to the south-east (decoration).
  path('bosque-riacho-alto', 'riacho-4', [[0, -2.4], [0, -6.2]], 3.8);
  path('bosque-riacho', 'riacho-4', [[0.6, -22.4], [3.0, -26.0], [7.0, -29.0], [12.0, -31.0]], 3.8);
  put('bosque-ponte-riacho', 'ponte-madeira', 4.8, -27.4, 140);
  // Farmhouse (sítio) at the foot of the hill, east: porch toward the trail, yard behind with beds, orchard, clothes.
  const sitio = put('bosque-casa-sitio', 'casa-sitio', 20.4, -15.6, 270);
  put('bosque-horta-1', 'horta', 27.4, -19.4, 0);
  put('bosque-horta-2', 'horta', 27.4, -17.0, 0);
  put('bosque-varal', 'varal-roupas-5', 27.0, -11.4, 0);
  put('bosque-galinheiro', 'galinheiro', 25.6, -8.4, 300);
  put('bosque-lenha', 'lenha', 24.6, -22.6, 20);
  put('bosque-mesa', 'mesa-madeira', 13.4, -11.6, 80);
  put('bosque-banco', 'banco', 13.0, -19.6, 90);
  for (const [i, [x, z, kind]] of ([[31.0, -14.0, 'mangueira'], [30.0, -7.0, 'jabuticabeira'], [31.6, -21.0, 'bananeira'], [29.4, -24.6, 'bananeira'], [21.0, -26.4, 'mangueira']] as [number, number, string][]).entries()) put(`bosque-pomar-${i}`, kind, x, z, i * 70);
  for (const [i, [x, z, yaw]] of [[24.0, -27.4, 0], [28.0, -27.4, 0], [33.6, -17.0, 90], [33.6, -13.0, 90], [33.6, -9.0, 90]].entries()) put(`bosque-cerca-${i}`, 'cerca-madeira-4', x!, z!, yaw!);
  put('bosque-porteira', 'porteira', 18.0, -27.4, 0);
  // Trails: the main one from the south-west (from the vila) past the pool and the farm, up the hill's east side;
  // a narrow one behind the falls (the cleft) up the shelf to the summit.
  trail('bosque-trilha', [[-22, -26], [-12, -22], [-5, -21.4], [6, -20], [12.6, -17.6], [12.6, -6], [8, 6], [2, 9]], 2.2);
  trail('bosque-trilha-alto', [[-2.6, -6.2], [-3, -2.4]], 1.6);
  for (const [i, [x, z, kind]] of ([[-8, -12, 'tronco-caido'], [-14, -4, 'rocha-quartzito-1'], [10, 12, 'rocha-quartzito-2'], [-6, 14, 'tronco-caido'], [-16, 8, 'rocha-quartzito-1']] as [number, number, string][]).entries()) put(`bosque-cobertura-${i}`, kind, x, z, i * 41);
  for (const [i, [x, z]] of [[-10, -24], [6, -23.4], [-4, -18.6], [3.4, -18.4]].entries()) put(`bosque-touceira-${i}`, 'touceira-capim', x!, z!, i * 30);
  put('bosque-marco', 'marco-trilha', -20, -24.6, 70);
  // Chests: inside the farmhouse (covered), on the cliff top by the stream (reached through the cleft or around the
  // hill), by the pool, under the orchard.
  chestAt({ id: 'bosque-sitio', region, hint: 'na cozinha do sítio, junto ao fogão', yaw: 0, surface: 'prop', covered: true }, frameOf(sitio).at(-1.2, KIT.floorTop, -1.6));
  chestAt({ id: 'bosque-paredao', region, hint: 'no alto da cachoeira', yaw: 180, surface: 'prop' }, frameOf(fall).at(-3.2, 5.0, -4.0));
  chestAt({ id: 'bosque-poco', region, hint: 'na beira do poço da cachoeira', yaw: 0 }, ground(-5.0, -21.8));
  chestAt({ id: 'bosque-pomar', region, hint: 'no pomar do sítio', yaw: 90 }, ground(29.0, -10.6));
  chestAt({ id: 'bosque-arvore', region, hint: 'entre as raízes da árvore gigante', yaw: 90 }, ground(4.6, 0.4));
}
