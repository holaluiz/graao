/**
 * Bairro do Horizonte (after Belo Horizonte's old neighbourhoods, Santa Tereza and the arched viaducts downtown): the
 * stream's valley crosses the middle with the railway beside it, the Viaduto dos Arcos spans it at roof height, the
 * Rua dos Bares runs on the north-west rim (corner bar with plastic tables, bakery, houses with garages, blocks with
 * painted gables), the flat-roofed houses with the footbridge stand at the south-east end of the viaduct, and beyond
 * Rua do Mercado lie the Praça do Coreto and the Mercado do Horizonte. docs/world/POI_DESIGN.md has the plan.
 *
 * Plane: centre (lat −12.06, lon −18.02), z toward the Vila das Lanternas (up the valley), x to the south-east.
 */
import { dirToLatLon, headingTangent } from '@graao/game-core';
import { KIT, KIT_BUILDINGS } from '@graao/game-data';
import { v3dot, v3normalize, type Vec3 } from '@graao/shared';
import { add, frameOf, regionPlane, terrain, type MapSink } from '../author';

export function authorBairro(sink: MapSink) {
  const b = regionPlane(sink, 'bairro', { lat: -12.06, lon: -18.02 }, 42.8);
  const { put, ground, chestAt, path, trail } = b;
  const region = 'Bairro do Horizonte';

  // ---------------------------------------------------------------------------------------------- viaduct
  // Along x (yaw 90 in the plane), centred over the valley. Its base is fitted so both end stairs land on the rims.
  {
    const via = KIT_BUILDINGS['viaduto']!;
    const reach = via.halfZ - 0.3;
    const probe = put('bairro-viaduto', 'viaduto', 0, 0, 90, { settle: 'center', lift: 0 });
    // Ground under the stair feet, along the viaduct's up, relative to the unlifted base.
    const f = frameOf(probe);
    const rel = [reach, -reach].map((z) => {
      const p = f.at(0, 0, z);
      const g = terrain.surfaceAt(v3normalize(p));
      return v3dot(add(g, f.base, -1), f.up);
    });
    probe.lift = Math.round(((rel[0]! + rel[1]!) / 2) * 1000) / 1000;
  }
  // Railway on the flat valley floor (south-east of the stream), between the two banks where the valley rises.
  path('bairro-trilhos', 'trilhos-6', [[4.2, -18], [4.2, 18]], 6.0);
  // Under the viaduct: painted walls and crates between the pillars (the lower level's cover).
  put('bairro-baixio-mural-1', 'mural-muro', -6.4, 5.6, 90);
  put('bairro-baixio-mural-2', 'mural-muro', 8.4, -6.2, 90);
  put('bairro-baixio-caixotes', 'pilha-caixotes', -5.8, -4.2, 30);
  put('bairro-baixio-engradados', 'engradados', 7.8, 4.4, 0);
  put('bairro-baixio-barril', 'barril', -7.2, -6.0, 0);

  // ---------------------------------------------------------------------------------------------- Rua dos Bares (north-west)
  path('bairro-rua-bares', 'asfalto-4x4', [[-20.0, -20], [-20.0, 20]], 4.2);
  path('bairro-calcada-bares', 'calcada-2x4', [[-17.0, -18], [-17.0, 18]], 4.1, { avoid: [[-17, 0, 2.2]] });
  // Between the street and the valley rim, facing the street (yaw 270): the corner bar at the viaduct's end, the
  // bakery across the viaduct street, houses with garages.
  // (Facing -x, a building's local +X is -z: the bar's second front and the bakery's blind side face the viaduct.)
  const bar = put('bairro-bar', 'bar-esquina', -13.6, 6.2, 270);
  const padaria = put('bairro-padaria', 'padaria', -13.6, -6.6, 270);
  put('bairro-casa-garagem-1', 'casa-garagem-1', -13.6, 12.6, 270);
  put('bairro-casa-garagem-2', 'casa-garagem-2', -13.6, -14.0, 270);
  // Pavement tables of the corner bar.
  put('bairro-mesa-1', 'mesa-bar', -18.6, 7.6, 0);
  put('bairro-mesa-2', 'mesa-bar-amarela', -18.8, 4.4, 20);
  put('bairro-mesa-3', 'mesa-bar', -19.0, 10.6, 45);
  put('bairro-engradados-bar', 'engradados', -17.2, 2.6, 10);
  // Across the street (facing it, yaw 90): blocks with painted gables, a house with a garage, a bus stop.
  put('bairro-predio-1', 'predio-1', -25.4, 7.0, 90);
  put('bairro-casa-garagem-3', 'casa-garagem-3', -25.4, 0.4, 90);
  put('bairro-predio-2', 'predio-2', -25.4, -6.2, 90);
  put('bairro-predio-3', 'predio-3', -25.4, -13.0, 90);
  put('bairro-ponto-onibus', 'ponto-onibus', -22.8, 13.0, 90);
  put('bairro-bicicleta', 'bicicleta', -22.4, 3.6, 0);
  put('bairro-lixeira', 'lixeira', -17.6, 9.8, 90);
  // Utility poles along the street, wires between them.
  for (const [i, z] of [-16, -8, 0, 8, 16].entries()) {
    put(`bairro-poste-o${i}`, 'poste-luz', -22.3, z, 0);
    if (i < 4) put(`bairro-fios-o${i}`, 'fios-8', -22.3, z + 4, 0, { lift: 5.2 });
  }
  // The station's clock tower by the railway, on the north-west rim.
  put('bairro-torre-relogio', 'torre-lanterna', -9.6, 18.2, 120);

  // ---------------------------------------------------------------------------------------------- south-east end of the viaduct
  // Casa da Laje and the Mercearia face Rua do Mercado; a footbridge joins their roofs over the foot of the viaduct's
  // stair, high enough above it to walk down underneath (facing +x, a building's local +X is +z: the Casa da Laje's
  // right-side gap and the Mercearia's left-side gap meet, 2 m toward the street).
  const casaLaje = put('bairro-casa-laje', 'casa-laje', 13.8, -6.5, 90);
  const mercearia = put('bairro-mercearia', 'mercadinho', 13.8, 6.5, 90);
  {
    // Fitted between the two roof edges (the parapet gaps): its height and heading come from the real edges.
    const a = frameOf(casaLaje).at(3.2, KIT.roofTop, 2);
    const c = frameOf(mercearia).at(-3.2, KIT.roofTop, 2);
    const mid = v3normalize(add(a, c));
    const { lat, lon } = dirLatLon(mid);
    const up = v3normalize(mid);
    const baseR = terrain.radius + terrain.heightAt(up);
    const lift = (v3dot(a, up) + v3dot(c, up)) / 2 - baseR;
    const along = v3normalize(add(c, a, -1));
    const yaw = headingOf(up, along);
    sink.placements.push({ id: 'bairro-passarela', prefab: 'passarela-7', lat, lon, yaw: Math.round(yaw * 100) / 100, lift: Math.round(lift * 1000) / 1000, region: 'bairro' });
  }
  put('bairro-oficina', 'oficina', 14.2, 14.4, 90);
  put('bairro-casa-beco', 'casa-beco', 14.2, 21.0, 90);
  path('bairro-rua-mercado', 'asfalto-4x4', [[20.0, -20], [20.0, 20]], 4.2);
  for (const [i, z] of [-16, -8, 0, 8, 16].entries()) {
    put(`bairro-poste-l${i}`, 'poste-luz', 22.3, z, 0);
    if (i < 4) put(`bairro-fios-l${i}`, 'fios-8', 22.3, z + 4, 0, { lift: 5.2 });
  }

  // ---------------------------------------------------------------------------------------------- Praça do Coreto
  // A square of geometric paths, hedges and benches around a bandstand, imperial palms along its edge, ipês.
  const P = { x: 29.6, z: 9.0 };
  let k = 0;
  for (const dx of [-6, -2, 2, 6]) for (const dz of [-6, -2, 2, 6]) {
    const onPath = Math.abs(dx) === 2 || Math.abs(dz) === 2 || Math.abs(dx) === Math.abs(dz);
    if (onPath) put(`bairro-praca-passeio-${k++}`, (dx + dz) % 4 === 0 ? 'passeio-onda-4x4' : 'passeio-4x4', P.x + dx, P.z + dz, 0);
  }
  put('bairro-coreto', 'coreto', P.x, P.z, 0);
  for (const [i, [dx, dz, yaw]] of [[-6.2, -4.0, 0], [6.2, -4.0, 0], [-6.2, 4.0, 0], [6.2, 4.0, 0], [-4.0, 6.4, 90], [4.0, 6.4, 90], [-4.0, -6.4, 90], [4.0, -6.4, 90]].entries()) {
    put(`bairro-canteiro-${i}`, 'canteiro-4', P.x + dx!, P.z + dz!, yaw!);
  }
  for (const [i, [dx, dz, yaw]] of [[-3.6, -3.6, 45], [3.6, 3.6, 225], [3.6, -3.6, 315], [-3.6, 3.6, 135]].entries()) put(`bairro-banco-praca-${i}`, 'banco', P.x + dx!, P.z + dz!, yaw!);
  for (const [i, [dx, dz]] of [[-8.6, -8.6], [-8.6, 0], [-8.6, 8.6], [8.6, -8.6], [8.6, 0], [8.6, 8.6]].entries()) put(`bairro-palmeira-${i}`, 'palmeira-imperial', P.x + dx!, P.z + dz!, i * 40);
  put('bairro-ipe-1', 'ipe-amarelo', P.x - 1.0, P.z + 9.4, 0);
  put('bairro-ipe-2', 'ipe-roxo', P.x + 1.6, P.z - 9.4, 30);
  for (const [i, [dx, dz]] of [[-6.2, 0], [6.2, 0]].entries()) put(`bairro-flores-${i}`, 'canteiro-flores', P.x + dx!, P.z + dz!, 0);

  // ---------------------------------------------------------------------------------------------- Mercado do Horizonte
  const mercado = put('bairro-mercado', 'mercado', 28.4, -10.4, 270);
  put('bairro-mercado-caixotes', 'caixote-frutas', 21.4, -15.0, 0);
  put('bairro-mercado-carrinho', 'carrinho', 21.8, -2.4, 300);
  put('bairro-mercado-sacos', 'pilha-sacos-cafe', 35.6, -2.4, 20);

  // ---------------------------------------------------------------------------------------------- the way to the vila and the lake
  trail('bairro-estrada-vila', [[-4, 22], [-6, 32]], 2.6);

  // ---------------------------------------------------------------------------------------------- chests
  const fm = frameOf(mercado);
  chestAt({ id: 'bairro-mercado', region, hint: 'no corredor do Mercado, entre as bancas', yaw: 0, surface: 'prop', covered: true }, fm.at(-1.8, KIT.floorTop, 0.2));
  chestAt({ id: 'bairro-mercado-laje', region, hint: 'na laje do Mercado (escada dos fundos)', yaw: 0, surface: 'prop' }, fm.at(3.4, 4.44, -3.6));
  const fb = frameOf(bar);
  chestAt({ id: 'bairro-bar', region, hint: 'atrás do balcão do Bar da Esquina', yaw: 0, surface: 'prop', covered: true }, fb.at(-1.2, KIT.floorTop, -0.2));
  const fpad = frameOf(padaria);
  chestAt({ id: 'bairro-padaria', region, hint: 'dentro da padaria', yaw: 180, surface: 'prop', covered: true }, fpad.at(-1.6, KIT.floorTop, -1.5));
  chestAt({ id: 'bairro-casa-laje', region, hint: 'na laje da Casa da Laje', yaw: 0, surface: 'prop' }, frameOf(casaLaje).at(1.2, KIT.roofTop, -1.6));
  chestAt({ id: 'bairro-baixio', region, hint: 'debaixo do viaduto, junto ao córrego', yaw: 90, covered: true }, ground(-4.2, -1.2));
  chestAt({ id: 'bairro-coreto', region, hint: 'no palco do coreto', yaw: 0, surface: 'prop', covered: true }, add(ground(P.x + 1.4, P.z + 1.2), v3normalize(ground(P.x + 1.4, P.z + 1.2)), 0.9));
  chestAt({ id: 'bairro-praca', region, hint: 'entre os canteiros da praça', yaw: 270 }, ground(P.x - 4.4, P.z - 8.6));
  return b;
}

// ------------------------------------------------------------------------------------------------ local helpers

const r5 = (v: number) => Math.round(v * 1e5) / 1e5;
function dirLatLon(d: Vec3) {
  const ll = dirToLatLon(v3normalize(d));
  return { lat: r5(ll.lat), lon: r5(ll.lon) };
}
function headingOf(up: Vec3, along: Vec3): number {
  const n = headingTangent(up, 0);
  const e = headingTangent(up, 90);
  return ((Math.atan2(v3dot(along, e), v3dot(along, n)) * 180) / Math.PI + 360) % 360;
}
