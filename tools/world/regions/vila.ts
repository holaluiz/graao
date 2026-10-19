/**
 * Vila das Lanternas (after Ouro Preto and the historic towns of Minas): the largo with its fountain at the foot of
 * the hill, the ladeira climbing north between whitewashed houses on stone bases, the stairway and retaining walls of
 * the adro, the Capela das Lanternas on top, yards (quintais) behind the houses with a way onto the roofs, and the
 * stone bridge over the córrego on the road to the Bairro do Horizonte. docs/world/POI_DESIGN.md has the plan.
 *
 * Plane: x east, z north, metres from the largo's centre (lat 8, lon 0).
 */
import { KIT } from '@graao/game-data';
import { frameOf, groundUnder, regionPlane, type MapSink } from '../author';

export function authorVila(sink: MapSink) {
  const v = regionPlane(sink, 'vila', { lat: 8, lon: 0 });
  const { put, ground, chestAt, height } = v;
  /** Lift that sets a piece's base at an absolute height (m above the radius). */
  const liftTo = (x: number, z: number, h: number) => Math.round((h - height(x, z)) * 1000) / 1000;
  const ADRO = 6.4;
  const region = 'Vila das Lanternas';

  // ---------------------------------------------------------------------------------------------- largo
  // Pé-de-moleque paving over the square (x −10..10, z −6..10) and the fountain in the middle.
  let k = 0;
  for (const x of [-8, -4, 0, 4, 8]) for (const z of [-4, 0, 4, 8]) if (!(Math.abs(x) === 8 && z === -4)) put(`vila-largo-${k++}`, 'pe-de-moleque-4x4', x, z, 0);
  put('vila-chafariz', 'chafariz', 0, 1, 0);
  // Feira: stalls, crates, a cart, benches and planters spread for cover (the square is an open arena).
  put('vila-banca-1', 'banca-frutas', -6.2, -2.6, 20);
  put('vila-banca-2', 'banca-queijos', 6.0, -2.3, 340);
  put('vila-barraca', 'barraca', -7.4, -0.3, 160);
  put('vila-carrinho', 'carrinho', -1.6, 7.6, 70);
  put('vila-caixotes-1', 'pilha-caixotes', 8.4, 1.3, 15);
  put('vila-caixote-1', 'caixote-frutas', -2.8, -5.0, 30);
  put('vila-caixote-2', 'caixote', 2.6, -5.4, 10);
  put('vila-banco-1', 'banco', -1.8, 4.6, 180);
  put('vila-banco-2', 'banco', 3.6, -1.4, 270);
  for (const [i, [x, z]] of [[-9.4, -3.6], [9.4, -3.4], [-9.6, 9.6], [9.6, 9.4]].entries()) put(`vila-lampiao-${i}`, 'lampiao-poste', x!, z!, 0);
  put('vila-potes', 'potes-barro', -9.6, 0.2, 40);

  // ---------------------------------------------------------------------------------------------- around the largo
  // North-west: the Sobrado do Largo, balconies over the square (an elevated position), a shop downstairs.
  const sobrado = put('vila-sobrado', 'sobrado-azul', -6.2, 5.4, 180);
  // North-east: the Casa da Esquina (hipped roof), its back to the east yards.
  const esquina = put('vila-casa-esquina', 'casa-colonial-esquina', 6.6, 5.8, 180);
  // West and east sides, south side (leaving the road to the bridge open at x ≈ −3).
  put('vila-casa-oeste', 'casa-colonial-ocre', -13.4, 0.6, 90);
  put('vila-casa-leste', 'casa-colonial-verde', 13.2, -0.6, 270);
  put('vila-casa-sul-o', 'casa-colonial-celeste-esq', -10.2, -7.4, 0);
  put('vila-casa-sul-l', 'casa-colonial-vermelha', 6.8, -7.2, 0);
  // A crate stack under the sobrado's east balcony: crates, then a double jump onto it.
  put('vila-caixotes-sacada', 'pilha-caixotes', -3.8, 0.6, 0);

  // ---------------------------------------------------------------------------------------------- ladeira
  // The street climbs north from the largo (z 10 → 26, ≈ 17°) between two rows of houses on stone bases; the houses
  // face the street and have their doors on the uphill end (a house's local +X is to the left of its front seen
  // from the street: north for the west row, south for the east row).
  k = 0;
  for (const z of [12.2, 16.4, 20.6, 24.6]) put(`vila-ladeira-${k++}`, 'pe-de-moleque-5x4', 0, z, 0);
  const w1 = put('vila-ladeira-o1', 'casa-colonial-azul-dir', -5.4, 14.0, 90);
  put('vila-ladeira-o2', 'casa-colonial-ocre-dir', -5.4, 20.8, 90);
  put('vila-ladeira-l1', 'casa-colonial-celeste-esq', 5.4, 14.6, 270);
  put('vila-ladeira-l2', 'casa-colonial-vermelha-esq', 5.4, 21.4, 270);
  // Lantern strings across the street (the vila's name), between the facades.
  put('vila-lanternas-1', 'varal-lanternas-5', 0, 12.0, 90, { lift: 3.7 });
  put('vila-lanternas-2', 'varal-lanternas-5', 0, 18.0, 90, { lift: 4.6 });
  put('vila-lanternas-3', 'varal-lanternas-5', 0, 23.6, 90, { lift: 5.4 });

  // ---------------------------------------------------------------------------------------------- adro and capela
  // The adro terrace (6.4 m) is held by stone retaining walls; the stairway continues the ladeira up to it.
  // The stair's top lands on the adro (its base is lifted so rise 2.4 m ends at the terrace height).
  put('vila-escadaria-adro', 'escadaria-pedra-24', 0, 25.4, 0, { lift: liftTo(0, 25.4, ADRO - 2.4) });
  for (const x of [-11.45, -7.45, -3.45, 3.45, 7.45, 11.45]) put(`vila-arrimo-${x < 0 ? 'o' : 'l'}${Math.abs(Math.round(x))}`, 'muro-arrimo-4', x, 28.6, 0, { lift: liftTo(x, 28.6, ADRO) });
  const capela = put('vila-capela', 'capela-lanternas', 0, 41.0, 180);
  put('vila-cruzeiro', 'cruzeiro', 0, 32.2, 0);
  put('vila-ipe-adro-o', 'ipe-amarelo', -8.8, 32.6, 0);
  put('vila-ipe-adro-l', 'ipe-roxo', 9.0, 33.0, 40);
  for (const [i, [x, z]] of [[-4.2, 31.2], [4.2, 31.2]].entries()) put(`vila-lampiao-adro-${i}`, 'lampiao-poste', x!, z!, 0);
  put('vila-banco-adro', 'banco', -6.0, 30.6, 0);
  put('vila-banco-adro-2', 'banco', 6.0, 30.6, 0);

  // ---------------------------------------------------------------------------------------------- east yards (quintais)
  // Behind the east row: walled yards with a clothesline, a vegetable bed, a fountain spout, a chicken coop, and the
  // Casa do Puxado whose lean-to roof (on its uphill back) is the way onto the roofs: crates → lean-to → main roof.
  const puxado = put('vila-casa-puxado', 'casa-colonial-puxado', 14.6, 15.4, 180);
  {
    const fpx = frameOf(puxado);
    // A woodpile (0.7 m) is the first step, the crate stack (1.8 m) stands under the lean-to's eave: two single jumps.
    // (A loose crate would break under fire and cut the route: the woodpile stays.)
    v.putAt('vila-puxado-caixotes', 'pilha-caixotes', fpx.at(1.4, 0, -6.45), 0);
    v.putAt('vila-puxado-caixote', 'lenha', fpx.at(1.4, 0, -7.75), 0);
  }
  put('vila-quintal-muro-n', 'muro-pedra-seca-4', 11.6, 26.4, 0);
  put('vila-quintal-muro-s', 'muro-pedra-seca-4', 17.6, 10.0, 0);
  put('vila-quintal-varal', 'varal-roupas-5', 19.6, 15.6, 0);
  put('vila-quintal-horta', 'horta', 10.8, 23.6, 90);
  put('vila-quintal-bica', 'bica', 19.4, 11.6, 270);
  put('vila-quintal-galinheiro', 'galinheiro', 19.2, 24.2, 200);
  put('vila-quintal-mangueira', 'mangueira', 21.6, 21.6, 0);
  put('vila-quintal-jabuticabeira', 'jabuticabeira', 11.2, 13.4, 0);
  put('vila-arco-leste', 'arco-beco', 19.6, 4.4, 90);
  put('vila-lenha', 'lenha', 16.6, 24.4, 10);

  // ---------------------------------------------------------------------------------------------- west yards
  put('vila-quintal-o-muro', 'muro-pedra-seca-4', -11.8, 18.0, 90);
  put('vila-quintal-o-varal', 'varal-roupas-5', -11.0, 13.0, 0);
  put('vila-quintal-o-arvore', 'mangueira', -13.0, 23.0, 0);
  put('vila-quintal-o-lata', 'lata-flores', -9.4, 25.2, 0);

  // ---------------------------------------------------------------------------------------------- córrego and bridge
  // The stream crosses the south of the vila; the stone bridge carries the road to the Bairro do Horizonte, and the
  // stream bed under its arch is a second, wet way across.
  {
    // The bridge's base is the bank level (the deck ends' ground): lifted from the stream bed under its centre.
    const a = 171 * (Math.PI / 180);
    const [fx, fz] = [Math.sin(a), Math.cos(a)];
    const bank = (height(-4.0 + fx * 4.4, -14.2 + fz * 4.4) + height(-4.0 - fx * 4.4, -14.2 - fz * 4.4)) / 2;
    put('vila-ponte-pedra', 'ponte-pedra', -4.0, -14.2, 171, { lift: liftTo(-4.0, -14.2, bank) });
  }
  k = 0;
  for (const [x, z] of [[-0.6, -5.6], [-2.4, -9.4]]) put(`vila-rua-ponte-${k++}`, 'pe-de-moleque-3x4', x!, z!, 191);
  v.trail('vila-estrada-bairro', [[-4.8, -19.6], [-10, -24.6], [-16, -28.6]], 2.6);

  // ---------------------------------------------------------------------------------------------- chests
  const fs = frameOf(sobrado);
  chestAt({ id: 'vila-sobrado-cima', region, hint: 'no andar de cima do sobrado', yaw: 180, surface: 'prop', covered: true }, fs.at(1.3, KIT.roofTop, -2.0));
  const fc = frameOf(capela);
  chestAt({ id: 'vila-capela', region, hint: 'diante do altar da capela', yaw: 0, surface: 'prop', covered: true }, fc.at(0, KIT.floorTop, -1.8));
  const fp = frameOf(puxado);
  chestAt({ id: 'vila-quintal-puxado', region, hint: 'debaixo do puxado, no quintal', yaw: 0, covered: true }, groundUnder(fp.at(-1.6, 0, -4.4)));
  chestAt({ id: 'vila-quintal-horta', region, hint: 'junto à horta do quintal', yaw: 270 }, ground(13.6, 23.4));
  const fe = frameOf(esquina);
  chestAt({ id: 'vila-casa-esquina', region, hint: 'dentro da Casa da Esquina', yaw: 0, surface: 'prop', covered: true }, fe.at(1.6, KIT.floorTop, -1.6));
  const fw = frameOf(w1);
  chestAt({ id: 'vila-ladeira-casa', region, hint: 'numa casa da ladeira', yaw: 90, surface: 'prop', covered: true }, fw.at(0.8, KIT.floorTop, -1.4));
  chestAt({ id: 'vila-adro', region, hint: 'no adro, ao lado do cruzeiro', yaw: 180 }, ground(-3.4, 33.4));
  chestAt({ id: 'vila-ponte', region, hint: 'na margem, ao pé da ponte de pedra', yaw: 0 }, ground(2.6, -11.0));
  return v;
}
