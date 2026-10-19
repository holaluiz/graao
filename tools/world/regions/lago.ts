/**
 * Lago Espelho (after the modernist lakeside of Pampulha): the promenade (orla) along the north-east shore toward the
 * Bairro, the round Pavilhão do Lago with its snaking canopy down to a deck on the water, the block on pilotis with
 * its ramp, a footbridge out to the island and its kiosk, gardens of curves, tile panels and imperial palms.
 * docs/world/POI_DESIGN.md has the plan.
 *
 * Plane: centre (lat −30, lon −38), z toward the Bairro do Horizonte (north-east), x to the south-east.
 */
import { KIT, PLANET } from '@graao/game-data';
import { frameOf, groundUnder, regionPlane, type MapSink } from '../author';

/** Deck tops stand this high above the water (m). */
const DECK = PLANET.seaLevel + 0.7;

export function authorLago(sink: MapSink) {
  const l = regionPlane(sink, 'lago', { lat: -30, lon: -38 }, 50);
  const { put, ground, chestAt, height, path } = l;
  const region = 'Lago Espelho';
  const liftTo = (x: number, z: number, h: number) => Math.round((h - height(x, z)) * 1000) / 1000;

  // ---------------------------------------------------------------------------------------------- orla
  // Promenade along the north-east shore (calçada), palms and benches, gardens of curves inland.
  path('lago-orla', 'passeio-onda-4x4', [[-20, 18], [-10, 19.5], [0, 20.5], [10, 19.5], [20, 16.5]], 4.1, { avoid: [[0, 20.5, 2.4], [10.6, 21.4, 5.6]] });
  for (const [i, x] of [-18, -10, -2, 3.6, 16].entries()) put(`lago-palmeira-${i}`, 'palmeira-imperial', x, 22.6 + (i % 2) * 0.4, i * 33);
  for (const [i, [x, z, yaw]] of [[-14, 16.8, 180], [3.0, 18.0, 170], [18.0, 14.2, 200]].entries()) put(`lago-banco-${i}`, 'banco-curvo', x!, z!, yaw!);
  for (const [i, [x, z, yaw]] of [[-6.0, 25.4, 10], [17, 25.6, 160], [-22, 22.6, 70]].entries()) put(`lago-jardim-${i}`, 'jardim-curvo', x!, z!, yaw!);
  put('lago-painel-1', 'painel-azulejo', -4.6, 23.2, 0);
  put('lago-painel-2', 'painel-azulejo', 22.8, 10.8, 290);
  // The stream's mouth: a footbridge on the promenade, level with the banks it joins.
  put('lago-ponte-foz', 'passarela-lago', 0, 20.5, 90, { lift: liftTo(0, 20.5, (height(-4.1, 20.5) + height(4.1, 20.5)) / 2) });

  // ---------------------------------------------------------------------------------------------- pavilion and canopy
  const pav = put('lago-pavilhao', 'pavilhao-lago', 10.6, 21.4, 200);
  // The canopy leaves the pavilion's east edge and snakes along the promenade (a covered walk on the orla); it is its
  // own placement on its own tangent frame (origin at the middle of its 16 m curve).
  {
    const h = (107 * Math.PI) / 180;
    const [dx, dz] = [Math.sin(h), Math.cos(h)];
    put('lago-marquise', 'marquise-sinuosa', 10.6 + dx * (5.2 + 7.9), 21.4 + dz * (5.2 + 7.9), 107);
  }
  put('lago-deck-pavilhao', 'deck-madeira', 7.5, 12.9, 200, { lift: liftTo(7.5, 12.9, DECK) });
  put('lago-deck-leste', 'deck-madeira', 16.0, -1.0, 250, { lift: liftTo(16.0, -1.0, DECK) });

  // ---------------------------------------------------------------------------------------------- pilotis block
  // On the west shore, its long side along the water, facing the lake (away from the Bairro's houses).
  const bloco = put('lago-bloco-pilotis', 'bloco-pilotis', -27.0, 10.0, 110);
  put('lago-espelho-dagua', 'espelho-dagua', -16.2, 31.0, 0);

  // ---------------------------------------------------------------------------------------------- island
  // From the north shore, one long footbridge out to the island (an exposed crossing, 17 m over the water: risk and
  // reward); it lands where the shore and the island's beach meet the deck's height. The kiosk shades a chest.
  {
    const x = -7.2;
    const shore = (from: number, to: number) => {
      const s = Math.sign(to - from);
      for (let z = from; s * (to - z) > 0; z += s * 0.1) if (height(x, z) <= DECK) return z;
      return to;
    };
    const north = shore(22, 8);
    const south = shore(-2, 8);
    put('lago-passarela-ilha', 'passarela-ilha', x, (north + south) / 2, 180, { lift: liftTo(x, (north + south) / 2, DECK) });
  }
  const quiosque = put('lago-quiosque-ilha', 'quiosque-onda', -7.0, -3.6, 0);
  put('lago-ilha-palmeira', 'palmeira-jeriva', -9.0, -5.6, 0);

  // ---------------------------------------------------------------------------------------------- the way to the bairro
  path('lago-acesso-bairro', 'calcada-2x4', [[2, 24.5], [4, 32]], 4.1);

  // ---------------------------------------------------------------------------------------------- chests
  const fp = frameOf(pav);
  chestAt({ id: 'lago-pavilhao', region, hint: 'atrás do balcão curvo do pavilhão', yaw: 30, surface: 'prop', covered: true }, fp.at(-1.0, 0.3, -2.4));
  const fb = frameOf(bloco);
  chestAt({ id: 'lago-pilotis-salao', region, hint: 'no salão do bloco sobre pilotis (subir pela rampa)', yaw: 180, surface: 'prop', covered: true }, fb.at(6.8, KIT.roofTop, -0.6));
  chestAt({ id: 'lago-pilotis-baixo', region, hint: 'entre os pilotis', yaw: 90, covered: true }, groundUnder(fb.at(5.0, 0, 0)));
  const fq = frameOf(quiosque);
  chestAt({ id: 'lago-ilha', region, hint: 'na ilha, debaixo do quiosque', yaw: 0, covered: true }, groundUnder(fq.at(1.2, 0, 0.3)));
  chestAt({ id: 'lago-deck', region, hint: 'no deck da margem leste', yaw: 250, surface: 'prop' }, frameOf(sink.placements.find((p) => p.id === 'lago-deck-leste')!).at(0.6, 0, -0.8));
  chestAt({ id: 'lago-orla-jardim', region, hint: 'entre os jardins da orla', yaw: 180 }, ground(-9.6, 24.0));
  return l;
}
