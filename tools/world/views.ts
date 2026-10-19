/**
 * Camera views of the planet's regions (docs/world/screenshots, docs/world/WORLD_PERFORMANCE.md): each one is authored
 * on its region's plane (tools/world/author.ts) and resolved to a lat/lon target and a local yaw, so the capture script
 * and the in-page helper agree on the same shot.
 *
 *   pnpm exec tsx tools/world/views.ts      (prints the resolved views as JSON)
 */
import { regionPlane } from './author';

export interface View {
  name: string;
  /** pt-BR caption (docs). */
  caption: string;
  lat: number;
  lon: number;
  /** Camera heading at the target (degrees clockwise from north): the camera stands `dist` behind it. */
  yaw: number;
  dist: number;
  height: number;
  /** Height above the target the camera looks at. */
  look: number;
  fov: number;
}

const sink = { placements: [], chestSpots: [], waypoints: [], trails: [] };
const planes = {
  vila: regionPlane(sink, 'vila', { lat: 8, lon: 0 }),
  bairro: regionPlane(sink, 'bairro', { lat: -12.06, lon: -18.02 }, 42.8),
  lago: regionPlane(sink, 'lago', { lat: -30, lon: -38 }, 50),
  fenda: regionPlane(sink, 'fenda', { lat: 40, lon: -103 }, 120.5),
  planalto: regionPlane(sink, 'planalto', { lat: 72, lon: -20 }, -81.8),
  serra: regionPlane(sink, 'serra', { lat: 60.5, lon: -82 }, -130),
  bosque: regionPlane(sink, 'bosque', { lat: 34, lon: 62 }, 0),
};

/** A view of `region` aimed at plane (x, z), the camera looking along plane heading `heading`. */
function view(name: string, caption: string, region: keyof typeof planes, x: number, z: number, heading: number, dist: number, height: number, look = 1.5, fov = 60): View {
  const p = planes[region];
  const { lat, lon } = p.latLon(x, z);
  return { name, caption, lat, lon, yaw: Math.round(p.yawAt(p.dirAt(x, z), heading) * 100) / 100, dist, height, look, fov };
}

export const VIEWS: View[] = [
  view('vila-largo', 'Vila das Lanternas: o largo com o chafariz, o sobrado azul e a capela no alto da ladeira', 'vila', 0, 6, 0, 22, 7, 4),
  view('vila-ladeira', 'A ladeira de pé-de-moleque entre os casarios, com os varais de lanternas', 'vila', 0, 14, 0, 7, 1.7, 2.2),
  view('vila-capela', 'O adro e a Capela das Lanternas (original, inspirada no barroco mineiro)', 'vila', 0, 38, 0, 18, 3, 6),
  view('vila-ponte', 'A ponte de pedra sobre o córrego, na estrada para o Bairro', 'vila', -4, -14.2, 81, 10, 2.5, 0.5),
  view('vila-quintais', 'Quintais com varal, horta e o puxado: a rota para os telhados', 'vila', 15, 19, 200, 10, 5, 1.5),
  view('bairro-viaduto', 'Bairro do Horizonte: o Viaduto dos Arcos sobre a baixada e a linha do trem', 'bairro', 0, 0, 180, 24, 4, 3),
  view('bairro-bares', 'A Rua dos Bares: bar de esquina com mesas na calçada, padaria e postes', 'bairro', -14, 4, 70, 8, 2, 1.8),
  view('bairro-mercado', 'O Mercado do Horizonte e a Praça do Coreto', 'bairro', 27, 0, 60, 10, 3, 1.5),
  view('lago-orla', 'Lago Espelho: o pavilhão de cobertura curva, a marquise e as palmeiras da orla', 'lago', 6, 20, 200, 16, 5, 2),
  view('lago-ilha', 'A passarela até a ilha e o quiosque de teto ondulado', 'lago', -7.2, 6, 180, 14, 4, 0.5),
  view('lago-pilotis', 'O bloco sobre pilotis com a rampa, na margem oeste', 'lago', -27, 10, 290, 18, 4, 2.5),
  view('planalto', 'Planalto Norte: cristas de itabirito, campo rupestre e o mirante de madeira', 'planalto', 0, 0, 20, 18, 5, 1.5),
  view('serra', 'Serra do Mirante: o mirante no pico e a lapa no passo', 'serra', 0, 5, 200, 16, 5, 2),
  view('fenda', 'Fenda de Cristal: a racha com água, pontes de tábuas, cristais e a boca da mina', 'fenda', -3, 6, 180, 16, 7, 0),
  view('bosque-cachoeira', 'Bosque dos Varais: a cachoeira de quartzito com a fenda escondida atrás da queda', 'bosque', 0, -17, 0, 13, 3, 3),
  view('bosque-sitio', 'O sítio: varanda, horta, varal, galinheiro e pomar', 'bosque', 22, -15, 60, 13, 4, 1.5),
];

if (process.argv[1]?.endsWith('views.ts')) console.log(JSON.stringify(VIEWS, null, 1));
