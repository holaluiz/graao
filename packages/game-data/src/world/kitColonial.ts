/**
 * COLONIAL kit: Vila das Lanternas, after the historic towns of Minas (Ouro Preto, Mariana): whitewashed walls with
 * painted corner pilasters (cunhais) and cornices, framed windows with open shutters, tall painted doors, terracotta
 * roofs with deep eaves, two-storey sobrados with iron balconies, stone stairways, retaining walls and arched bridges,
 * a fountain for the square and an original baroque-inspired chapel whose two towers end in great lanterns
 * (docs/world/MG_ARCHITECTURE_KITS.md). Original designs: no real church, house or monument is reproduced.
 */
import {
  KIT,
  addBuilding,
  addPrefab,
  ball,
  box,
  chordXY,
  cone,
  cyl,
  deco,
  foundation,
  gabledRoof,
  ghost,
  hippedRoof,
  near,
  plinth,
  slope,
  span,
  stair,
  stoop,
  wall,
  type KitColor,
  type KitCover,
  type KitDoor,
  type KitPart,
  type KitPiece,
  type WallKind,
  type WallStyle,
} from './kitCore';

const col = (id: string, name: string, cover: KitCover, parts: KitPart[], o: { length?: number; scale?: [number, number]; alignToGround?: boolean; water?: boolean; door?: KitDoor } = {}) =>
  addPrefab({ id, name, category: 'colonial', cover, parts, scale: o.scale ?? [1, 1], ...(o.length ? { length: o.length } : {}), ...(o.alignToGround ? { alignToGround: true } : {}), ...(o.water ? { material: 'water' as const } : {}), ...(o.door ? { door: o.door } : {}) });

// ------------------------------------------------------------------------------------------------ tones

/** House colour schemes: wall, frames/pilasters/cornice, shutters and doors, base band (barrado). */
export interface ColonialTone {
  key: string;
  name: string;
  wall: KitColor;
  frame: KitColor;
  leaf: KitColor;
  barrado: KitColor;
}
export const COLONIAL_TONES: ColonialTone[] = [
  { key: 'azul', name: 'branca e azul', wall: 'cal', frame: 'azulColonial', leaf: 'azulColonial', barrado: 'azulColonial' },
  { key: 'verde', name: 'branca e verde', wall: 'cal', frame: 'verdeColonial', leaf: 'verdeColonial', barrado: 'cantaria' },
  { key: 'vermelha', name: 'branca e vermelha', wall: 'cal', frame: 'cantaria', leaf: 'vermelhoColonial', barrado: 'vermelhoColonial' },
  { key: 'ocre', name: 'ocre', wall: 'calAmarelo', frame: 'cal', leaf: 'verdeColonial', barrado: 'pedraSabao' },
  { key: 'celeste', name: 'celeste', wall: 'calAzul', frame: 'cal', leaf: 'azulColonial', barrado: 'cantaria' },
];
const style = (t: ColonialTone, o: Partial<WallStyle> = {}): WallStyle => ({ color: t.wall, frame: t.frame, leaf: t.leaf, look: 'colonial', plinth: { h: 0.65, color: t.barrado }, ...o });

/** Upper storey height (from the upper floor to the roof). */
const UPPER = 2.8;

/** Cornice (cimalha) along the top of a wall module: the strong line under the eaves. */
const cornice = (len: number, top: number, color: KitColor): KitPart[] => [box(0, top - 0.11, KIT.wallT / 2 + 0.07, len / 2 + 0.02, 0.11, 0.08, color, { ...deco, lod: 'far' })];

for (const t of COLONIAL_TONES) {
  for (const kind of ['cheia', 'janela', 'porta'] as WallKind[]) {
    const tag = kind === 'cheia' ? 'parede' : kind;
    // Door modules leave the opening to the interactive door: two tall painted leaves (game-core interactives.ts).
    const door = kind === 'porta' ? { door: { w: 1.4, h: 2.55, style: 'dupla' as const, color: t.leaf } } : {};
    col(`col-${tag}-2-${t.key}`, `Colonial: ${tag} 2 m (${t.name})`, 'alta', [...wall(2, kind, style(t, { openLeaves: false })), ...cornice(2, KIT.wallTop, t.frame)], { length: 2, ...door });
  }
  // Upper storey: a window, a plain wall, and a balcony door (sacada) with an iron balcony to stand on.
  col(`col-sup-parede-2-${t.key}`, `Colonial: parede superior 2 m (${t.name})`, 'alta', [...wall(2, 'cheia', style(t, { upper: true, height: UPPER })), ...cornice(2, UPPER, t.frame)], { length: 2 });
  col(`col-sup-janela-2-${t.key}`, `Colonial: janela superior 2 m (${t.name})`, 'alta', [...wall(2, 'janela', style(t, { upper: true, height: UPPER })), ...cornice(2, UPPER, t.frame)], { length: 2 });
  col(`col-sup-sacada-2-${t.key}`, `Colonial: sacada 2 m (${t.name})`, 'alta', [...sacada(t), ...cornice(2, UPPER, t.frame)], { length: 2 });
  col(`col-cunhal-${t.key}`, `Colonial: cunhal (${t.name})`, 'alta', [box(0, KIT.wallTop / 2, 0, 0.2, KIT.wallTop / 2, 0.2, t.frame), box(0, KIT.wallTop - 0.1, 0, 0.26, 0.12, 0.26, t.frame, deco)]);
  col(`col-cunhal-sup-${t.key}`, `Colonial: cunhal superior (${t.name})`, 'alta', [box(0, UPPER / 2, 0, 0.2, UPPER / 2, 0.2, t.frame), box(0, UPPER - 0.1, 0, 0.26, 0.12, 0.26, t.frame, deco)]);
}

/**
 * A 2 m upper wall with a balcony door: the opening (1.1 × 2.2 from the upper floor), the leaves folded in, and a
 * stone balcony slab 0.7 m out with an iron railing (stops people, not shots). The balcony is a place to stand: an
 * elevated position over the street.
 */
function sacada(t: ColonialTone): KitPart[] {
  const top = UPPER;
  const ht = KIT.wallT / 2;
  const w = 1.1;
  const head = 2.25;
  const parts: KitPart[] = [
    span(-1, 0, -ht, -w / 2, top, ht, t.wall),
    span(w / 2, 0, -ht, 1, top, ht, t.wall),
    span(-w / 2, head, -ht, w / 2, top, ht, t.wall),
    // Frame.
    box(-w / 2 - 0.07, head / 2, ht + 0.04, 0.07, head / 2, 0.06, t.frame, near),
    box(w / 2 + 0.07, head / 2, ht + 0.04, 0.07, head / 2, 0.06, t.frame, near),
    box(0, head + 0.1, ht + 0.04, w / 2 + 0.16, 0.1, 0.06, t.frame, near),
    box(-w / 2 + 0.05, head / 2, -ht - 0.3, 0.03, head / 2 - 0.05, 0.28, t.leaf, near),
    box(w / 2 - 0.05, head / 2, -ht - 0.3, 0.03, head / 2 - 0.05, 0.28, t.leaf, near),
    // Balcony slab (walkable) and its stone brackets.
    box(0, -0.06, ht + 0.38, 0.8, 0.08, 0.38, 'cantaria'),
    ...[-0.6, 0.6].map((x) => slope(x, 0.06, ht + 0.05, -0.45, ht + 0.55, -0.12, 0.12, 'cantaria', near)),
    // Iron railing: front and both sides.
    box(0, 0.5, ht + 0.72, 0.8, 0.48, 0.025, 'ferro', { solid: 'move', visible: false }),
    ...[-0.78, 0.78].map((x) => box(x, 0.5, ht + 0.4, 0.025, 0.48, 0.34, 'ferro', { solid: 'move', visible: false })),
    box(0, 0.97, ht + 0.72, 0.82, 0.025, 0.03, 'ferro', near),
    ...[-0.6, -0.3, 0, 0.3, 0.6].map((x) => box(x, 0.5, ht + 0.72, 0.012, 0.45, 0.012, 'ferro', near)),
    ...[-0.78, 0.78].map((x) => box(x, 0.97, ht + 0.4, 0.03, 0.025, 0.34, 'ferro', near)),
  ];
  return parts;
}

// ------------------------------------------------------------------------------------------------ floors, plinths, steps

for (const [w, d] of [[6, 8], [13, 13]] as const) col(`fundacao-${w}x${d}`, `Piso ${w}×${d}`, 'passagem', foundation(w, d, 'pedraEscura', w === 13 ? 'peDeMoleque' : 'madeiraClara'));
col('fundacao-col-6x6', 'Piso colonial 6×6', 'passagem', foundation(6, 6, 'pedraEscura', 'madeiraClara'));
/** Stone bases (embasamento) for every foundation size, picked by the layout on slopes (KIT.plinthDepths). */
for (const [w, d] of [[6, 6], [6, 4], [6, 8], [8, 6], [10, 6], [12, 10], [13, 13]] as const) {
  for (const depth of KIT.plinthDepths) col(`embasamento-${w}x${d}-${depth * 10}`, `Embasamento de pedra ${w}×${d} (${depth} m)`, 'estrutura', plinth(w, d, depth, 'pedraEscura'));
}
for (let n = 1; n <= KIT.stoop.maxSteps; n++) col(`soleira-${n}`, `Soleira de pedra (${n} degraus)`, 'passagem', stoop(n));

/** Upper floor of a 6 × 8 sobrado (wooden boards), open over the internal stair along the left wall. */
col('col-assoalho-6x8', 'Assoalho do sobrado 6×8', 'passagem', [
  span(-1.5, -0.2, -4.2, 3.2, 0, 4.2, 'madeiraClara'),
  span(-3.2, -0.2, -4.2, -1.5, 0, -1.75, 'madeiraClara'),
  span(-3.2, -0.2, 3.1, -1.5, 0, 4.2, 'madeiraClara'),
  // Railing around the stairwell (movement only).
  box(-1.53, 0.5, 0.67, 0.03, 0.5, 2.42, 'madeiraEscura', { solid: 'move' }),
  box(-2.35, 0.5, 3.07, 0.83, 0.5, 0.03, 'madeiraEscura', { solid: 'move' }),
  box(-1.53, 0.0 - 0.21, 0, 0.04, 0.03, 4.2, 'madeiraEscura', near),
]);
/** Inside wooden stair: its landing (1 m) opens onto the upper floor beside the stairwell's railing. */
col('col-escada-interna', 'Escada interna de madeira', 'passagem', stair(-1, { rise: KIT.roofTop - KIT.floorTop, color: 'madeira', railColor: 'madeiraEscura', landing: 1.0, landingSideRail: false }));

// ------------------------------------------------------------------------------------------------ roofs

for (const t of COLONIAL_TONES) {
  col(`col-telhado-6x6-${t.key}`, `Telhado colonial 6×6 (${t.name})`, 'alta', gabledRoof(6, 6, 1.7, { tile: 'telhaColonial', gable: t.wall, eave: 0.55, ridge: 'telhaEscura' }));
}
col('col-telhado-4aguas-6x6', 'Telhado de quatro águas 6×6', 'alta', hippedRoof(6, 6, 1.75, 'telhaColonial', 0.55));
col('col-telhado-4aguas-6x8', 'Telhado de quatro águas 6×8', 'alta', hippedRoof(6, 8, 1.75, 'telhaColonial', 0.55));
/**
 * Lean-to roof (puxado) on posts at the back of a house: from 2.95 m at the wall down to 2.2 m at the posts, 2.6 m
 * deep. From a garden wall a jump lands on it; from it the main roof's eave is a step up (the way onto the roofs).
 */
col('col-puxado-6', 'Puxado com telhado 6 m', 'passagem', [
  slope(0, 3.35, 0.05, 2.95, 2.75, 2.15, 0.12, 'telhaColonial'),
  // Posts reach 1.5 m into the ground (the yard may fall away from the house).
  ...[-2.9, 2.9].map((x) => cyl(x, 0.3, 2.5, 0.09, 1.8, 'madeira', { seg: 6 })),
  box(0, 2.08, 2.55, 3.0, 0.06, 0.08, 'madeira', near),
  box(0, 2.1, 2.8, 3.3, 0.03, 0.05, 'telhaEscura', near),
]);

// ------------------------------------------------------------------------------------------------ buildings

const tone = (key: string) => COLONIAL_TONES.find((t) => t.key === key)!;
type DoorAt = 'meio' | 'esq' | 'dir';

/**
 * Single-storey colonial house 6 × 6: the street front with two windows and a tall door (in the middle, or toward one
 * side so it sits on the uphill end of a slope), a back door to the yard, a gabled roof with the ridge along the
 * street. Optional lean-to at the back (the way onto the roofs).
 */
function casaColonial(id: string, name: string, t: ColonialTone, door: DoorAt, o: { puxado?: boolean; hip?: boolean; extra?: KitPiece[] } = {}) {
  const j = `col-janela-2-${t.key}`;
  const p = `col-porta-2-${t.key}`;
  const c = `col-parede-2-${t.key}`;
  const front = door === 'meio' ? [j, p, j] : door === 'esq' ? [p, j, j] : [j, j, p];
  const doorX = door === 'meio' ? 0 : door === 'esq' ? -2 : 2;
  const pieces: KitPiece[] = [
    { prefab: 'fundacao-col-6x6', x: 0, z: 0 },
    ...front.map((m, i) => ({ prefab: m, x: -2 + i * 2, z: 3, yaw: 0 })),
    ...[c, p, c].map((m, i) => ({ prefab: m, x: -2 + i * 2, z: -3, yaw: 180 })),
    ...[c, j, c].map((m, i) => ({ prefab: m, x: 3, z: -2 + i * 2, yaw: 270 })),
    ...[c, c, c].map((m, i) => ({ prefab: m, x: -3, z: -2 + i * 2, yaw: 90 })),
    ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => ({ prefab: `col-cunhal-${t.key}`, x: sx * 3, z: sz * 3 }))),
    { prefab: o.hip ? 'col-telhado-4aguas-6x6' : `col-telhado-6x6-${t.key}`, x: 0, y: KIT.wallTop, z: 0 },
    ...(o.puxado ? [{ prefab: 'col-puxado-6', x: 0, z: -3.12, yaw: 180 }] : []),
    { prefab: 'lampiao-parede', x: doorX + 1.0, y: 2.55, z: 3.14 },
    ...(o.extra ?? []),
  ];
  addBuilding({ id, name, category: 'colonial', halfX: 3.6, halfZ: o.puxado ? 6.0 : 3.6, pieces, doors: [{ x: doorX, z: 3, yaw: 0 }, { x: 0, z: -3, yaw: 180 }] });
}

for (const t of COLONIAL_TONES) {
  casaColonial(`casa-colonial-${t.key}`, `Casa colonial ${t.name}`, t, 'meio');
  casaColonial(`casa-colonial-${t.key}-esq`, `Casa colonial ${t.name} (porta à esquerda)`, t, 'esq');
  casaColonial(`casa-colonial-${t.key}-dir`, `Casa colonial ${t.name} (porta à direita)`, t, 'dir');
}
casaColonial('casa-colonial-puxado', 'Casa do Puxado (telhado acessível)', tone('verde'), 'meio', {
  puxado: true,
  extra: [{ prefab: 'potes-barro', x: -2.0, y: KIT.floorTop, z: -2.2 }],
});
casaColonial('casa-colonial-esquina', 'Casa da Esquina (quatro águas)', tone('vermelha'), 'meio', { hip: true });

/**
 * Sobrado do Largo: a two-storey house 6 × 8. Ground floor: a small shop (venda) with a counter, doors front and
 * back. Upper floor: reached by a wooden stair along the left wall, two balconies over the square (elevated cover).
 * Hipped roof.
 */
function sobrado(id: string, name: string, t: ColonialTone) {
  const k = t.key;
  const y = KIT.roofTop;
  const pieces: KitPiece[] = [
    { prefab: 'fundacao-6x8', x: 0, z: 0 },
    ...[`col-janela-2-${k}`, `col-porta-2-${k}`, `col-janela-2-${k}`].map((m, i) => ({ prefab: m, x: -2 + i * 2, z: 4, yaw: 0 })),
    ...[`col-parede-2-${k}`, `col-porta-2-${k}`, `col-parede-2-${k}`].map((m, i) => ({ prefab: m, x: -2 + i * 2, z: -4, yaw: 180 })),
    ...[`col-parede-2-${k}`, `col-janela-2-${k}`, `col-parede-2-${k}`, `col-janela-2-${k}`].map((m, i) => ({ prefab: m, x: 3, z: -3 + i * 2, yaw: 270 })),
    ...[`col-parede-2-${k}`, `col-parede-2-${k}`, `col-parede-2-${k}`, `col-parede-2-${k}`].map((m, i) => ({ prefab: m, x: -3, z: -3 + i * 2, yaw: 90 })),
    ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => ({ prefab: `col-cunhal-${k}`, x: sx * 3, z: sz * 4 }))),
    // Upper floor and its walls (from the floor at the laje height).
    { prefab: 'col-assoalho-6x8', x: 0, y, z: 0 },
    ...[`col-sup-sacada-2-${k}`, `col-sup-janela-2-${k}`, `col-sup-sacada-2-${k}`].map((m, i) => ({ prefab: m, x: -2 + i * 2, y, z: 4, yaw: 0 })),
    ...[`col-sup-parede-2-${k}`, `col-sup-janela-2-${k}`, `col-sup-parede-2-${k}`].map((m, i) => ({ prefab: m, x: -2 + i * 2, y, z: -4, yaw: 180 })),
    ...[`col-sup-parede-2-${k}`, `col-sup-janela-2-${k}`, `col-sup-janela-2-${k}`, `col-sup-parede-2-${k}`].map((m, i) => ({ prefab: m, x: 3, y, z: -3 + i * 2, yaw: 270 })),
    ...[`col-sup-parede-2-${k}`, `col-sup-janela-2-${k}`, `col-sup-parede-2-${k}`, `col-sup-parede-2-${k}`].map((m, i) => ({ prefab: m, x: -3, y, z: -3 + i * 2, yaw: 90 })),
    ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => ({ prefab: `col-cunhal-sup-${k}`, x: sx * 3, y, z: sz * 4 }))),
    // Floor band between the storeys.
    { prefab: 'col-faixa-sobrado', x: 0, y: y - 0.12, z: 0 },
    { prefab: 'col-telhado-4aguas-6x8', x: 0, y: y + UPPER, z: 0 },
    // Internal stair along the left wall, rising toward the back.
    { prefab: 'col-escada-interna', x: -2.22, y: KIT.floorTop, z: 3.05, yaw: 180 },
    { prefab: 'balcao-2', x: 1.3, y: KIT.floorTop, z: 1.8 },
    { prefab: 'prateleira-curta', x: 1.75, y: KIT.floorTop, z: -3.62 },
    { prefab: 'pilha-sacos-cafe', x: 2.3, y: KIT.floorTop, z: -1.6, yaw: 90 },
    { prefab: 'lampiao-parede', x: 1.0, y: 2.55, z: 4.14 },
  ];
  addBuilding({ id, name, category: 'colonial', halfX: 3.6, halfZ: 4.9, pieces, doors: [{ x: 0, z: 4, yaw: 0 }, { x: 0, z: -4, yaw: 180 }] });
}
col('col-faixa-sobrado', 'Faixa entre pavimentos', 'decoracao', [
  box(0, 0, 4.2, 3.18, 0.1, 0.08, 'cantaria', { ...deco, lod: 'far' }),
  box(0, 0, -4.2, 3.18, 0.1, 0.08, 'cantaria', { ...deco, lod: 'far' }),
  box(3.2, 0, 0, 0.08, 0.1, 4.18, 'cantaria', { ...deco, lod: 'far' }),
  box(-3.2, 0, 0, 0.08, 0.1, 4.18, 'cantaria', { ...deco, lod: 'far' }),
]);
sobrado('sobrado-azul', 'Sobrado azul', tone('azul'));
sobrado('sobrado-ocre', 'Sobrado ocre', tone('ocre'));

// ------------------------------------------------------------------------------------------------ chapel

/**
 * Capela das Lanternas: nave 7 × 11 m (walls 6.5 m), a front with a curved pediment between two square towers that
 * end in bell chambers, onion caps and great lanterns (the village's name). Main door in a soapstone frame, a side
 * door on the right, pews inside (low cover) and a gilded altar. The towers are solid; the nave is explorable.
 * Origin: the base centre; front toward +Z.
 */
const NAVE = { w: 7.4, d: 11.6, h: 6.5, t: 0.4 };
function capela(): KitPart[] {
  const { w, d, h, t } = NAVE;
  const hw = w / 2;
  const hd = d / 2;
  const P: KitPart[] = [];
  // Side walls (the right one with a door near the front) and the back wall.
  P.push(span(-hw, 0, -hd, -hw + t, h, hd, 'cal'));
  P.push(span(hw - t, 0, -hd, hw, h, hd - 3.6, 'cal'), span(hw - t, 0, hd - 2.2, hw, h, hd, 'cal'), span(hw - t, 2.6, hd - 3.6, hw, h, hd - 2.2, 'cal'));
  P.push(box(hw + 0.05, 1.3, hd - 2.9, 0.06, 1.3, 0.8, 'pedraSabao', near));
  P.push(span(-hw, 0, -hd, hw, h, -hd + t, 'cal'));
  // Wall bands, corner pilasters and the cornice.
  for (const sx of [-1, 1]) P.push(box(sx * (hw + 0.03), 0.45, 0, 0.04, 0.45, hd, 'pedraSabao', deco), box(sx * (hw + 0.06), h - 0.15, 0, 0.1, 0.15, hd + 0.05, 'pedraSabao', { ...deco, lod: 'far' }));
  P.push(box(0, h - 0.15, -hd - 0.06, hw + 0.08, 0.15, 0.1, 'pedraSabao', { ...deco, lod: 'far' }));
  P.push(...[-1, 1].map((sx) => box(sx * (hw - 0.05), h / 2, -hd + 0.05, 0.25, h / 2, 0.25, 'pedraSabao')));
  // High side windows (decoration: above head height, the walls stay solid).
  for (const sx of [-1, 1]) for (const z of [-2.8, 1.0]) P.push(box(sx * (hw + 0.03), 4.3, z, 0.03, 0.8, 0.45, 'madeiraEscura', near), box(sx * (hw + 0.05), 4.3, z, 0.04, 0.9, 0.55, 'pedraSabao', near));
  // Facade (z = hd .. hd + 0.5): wall with the main door, coro windows, curved pediment, a cross on top.
  const fz = hd + 0.25;
  const door = { w: 2.0, h: 3.4 };
  P.push(span(-hw, 0, hd, -door.w / 2, 8.0, hd + 0.5, 'cal'), span(door.w / 2, 0, hd, hw, 8.0, hd + 0.5, 'cal'), span(-door.w / 2, door.h, hd, door.w / 2, 8.0, hd + 0.5, 'cal'));
  // Portada: soapstone jambs, lintel, a medallion and a crest above the door.
  P.push(box(-door.w / 2 - 0.15, door.h / 2, fz + 0.3, 0.15, door.h / 2, 0.1, 'pedraSabao', near));
  P.push(box(door.w / 2 + 0.15, door.h / 2, fz + 0.3, 0.15, door.h / 2, 0.1, 'pedraSabao', near));
  P.push(box(0, door.h + 0.18, fz + 0.3, door.w / 2 + 0.35, 0.18, 0.12, 'pedraSabao', { ...deco, lod: 'far' }));
  P.push(cyl(0, door.h + 0.95, fz + 0.32, 0.5, 0.06, 'pedraSabao', { ...deco, rx: 90, seg: 14, lod: 'far' }), ball(0, door.h + 0.95, fz + 0.38, 0.22, 'ouro', near));
  P.push(box(0, door.h + 1.6, fz + 0.3, 0.55, 0.12, 0.08, 'pedraSabao', near));
  // Door leaves (open, blue), against the inside of the facade.
  for (const sx of [-1, 1]) P.push(box(sx * (door.w / 2 - 0.05), door.h / 2, hd - 0.55, 0.04, door.h / 2 - 0.05, 0.5, 'azulColonial', near));
  // Coro windows with frames.
  for (const sx of [-1, 1]) P.push(box(sx * 1.9, 5.3, fz + 0.27, 0.45, 0.75, 0.03, 'madeiraEscura', near), box(sx * 1.9, 5.3, fz + 0.29, 0.6, 0.9, 0.03, 'pedraSabao', near), box(sx * 1.9, 4.45, fz + 0.36, 0.7, 0.07, 0.12, 'pedraSabao', near));
  // Pilasters framing the facade and the entablature.
  for (const sx of [-1, 1]) P.push(box(sx * (hw - 0.15), 4.0, fz + 0.32, 0.22, 4.0, 0.1, 'pedraSabao', { ...deco, lod: 'far' }));
  P.push(box(0, 8.1, fz + 0.05, hw + 0.15, 0.2, 0.36, 'pedraSabao', { ...deco, lod: 'far' }));
  // Curved pediment: a gable flanked by volutes, crowned by a rounded top and a cross.
  P.push({ shape: 'gable', x: 0, y: 8.25, z: fz, hx: 0.25, hy: 1.6, hz: 2.6, color: 'cal', ry: 90 });
  for (const sx of [-1, 1]) P.push(cyl(sx * 2.75, 8.65, fz, 0.42, 0.25, 'pedraSabao', { rx: 90, seg: 12 }), cyl(sx * 2.75, 8.65, fz + 0.27, 0.22, 0.03, 'ouro', { ...near, rx: 90, seg: 10 }));
  P.push(cyl(0, 9.75, fz, 0.75, 0.25, 'cal', { rx: 90, seg: 14 }), cyl(0, 9.0, fz + 0.27, 0.42, 0.03, 'madeiraEscura', { ...deco, rx: 90, seg: 14 }), cyl(0, 9.0, fz + 0.29, 0.5, 0.02, 'pedraSabao', { ...deco, rx: 90, seg: 14, lod: 'far' }));
  P.push(box(0, 10.95, fz, 0.07, 0.55, 0.07, 'ferro', { ...deco, lod: 'far' }), box(0, 11.15, fz, 0.32, 0.06, 0.06, 'ferro', { ...deco, lod: 'far' }));
  // Towers: square shafts, a cornice, the bell chamber with arched openings, an onion cap and the lantern.
  for (const sx of [-1, 1]) {
    const tx = sx * (hw + 1.25);
    const tz = hd - 0.6;
    P.push(box(tx, 5.5, tz, 1.25, 5.5, 1.35, 'cal'));
    P.push(...[-1, 1].flatMap((cx) => [-1, 1].map((cz) => box(tx + cx * 1.17, 5.5, tz + cz * 1.27, 0.14, 5.5, 0.14, 'pedraSabao', { ...deco, lod: 'far' }))));
    P.push(box(tx, 0.45, tz, 1.3, 0.45, 1.4, 'pedraSabao', deco));
    P.push(box(tx, 11.1, tz, 1.4, 0.18, 1.5, 'pedraSabao', { ...deco, lod: 'far' }));
    P.push(box(tx, 5.6, tz + 1.36, 0.35, 0.55, 0.02, 'madeiraEscura', near), box(tx, 5.6, tz + 1.37, 0.48, 0.68, 0.02, 'pedraSabao', near));
    // Bell chamber: four corner piers and a slab; bells inside.
    for (const cx of [-1, 1]) for (const cz of [-1, 1]) P.push(box(tx + cx * 0.95, 12.25, tz + cz * 1.05, 0.28, 1.0, 0.28, 'cal'));
    P.push(box(tx, 13.35, tz, 1.3, 0.12, 1.4, 'pedraSabao'));
    P.push(cone(tx, 12.05, tz, 0.32, 0.38, 'sino', { ...near, seg: 10 }), ball(tx, 12.5, tz, 0.12, 'sino', near));
    // Onion cap (coruchéu) and the lantern: the beacon the village is named after.
    P.push(cyl(tx, 13.75, tz, 0.95, 0.28, 'telhaColonial', { seg: 8 }));
    P.push(ball(tx, 14.35, tz, 0.78, 'telhaColonial', { lod: 'far' }));
    P.push(cone(tx, 15.25, tz, 0.42, 0.45, 'telhaEscura', { ...deco, seg: 8, lod: 'far' }));
    P.push(box(tx, 15.95, tz, 0.26, 0.3, 0.26, 'lanterna', { ...deco, lod: 'far', anchor: true }));
    P.push(cone(tx, 16.42, tz, 0.3, 0.16, 'ferro', { ...deco, seg: 4, ry: 45, lod: 'far' }));
  }
  // Interior: pews in two rows (low cover), the altar steps and a gilded retable.
  for (const z of [-2.4, -0.6, 1.2, 3.0]) for (const sx of [-1, 1]) P.push(box(sx * 1.75, 0.55, z, 1.25, 0.25, 0.22, 'madeira'), box(sx * 1.75, 0.95, z - 0.24, 1.25, 0.2, 0.04, 'madeira', near));
  P.push(box(0, 0.16, -hd + 1.6, 2.4, 0.16, 1.2, 'pedraSabao'));
  P.push(box(0, 2.6, -hd + t + 0.35, 1.8, 2.1, 0.3, 'ouro'), box(0, 4.95, -hd + t + 0.3, 1.2, 0.35, 0.25, 'ouro', { ...deco, lod: 'far' }), ball(0, 5.5, -hd + t + 0.3, 0.38, 'ouro', near));
  P.push(box(0, 1.0, -hd + 1.9, 0.9, 0.5, 0.45, 'cal'), box(0, 1.53, -hd + 1.9, 1.0, 0.04, 0.5, 'vermelhoColonial', near));
  return P;
}
col('capela-corpo', 'Capela das Lanternas (corpo, fachada e torres)', 'estrutura', capela());
col('capela-telhado', 'Telhado da nave', 'alta', gabledRoof(NAVE.d, NAVE.w, 2.4, { tile: 'telhaColonial', gable: 'cal', eave: 0.35, ridge: 'telhaEscura' }));
addBuilding({
  id: 'capela-lanternas',
  name: 'Capela das Lanternas',
  category: 'colonial',
  halfX: 6.6,
  halfZ: 6.6,
  pieces: [
    { prefab: 'fundacao-13x13', x: 0, z: 0 },
    { prefab: 'capela-corpo', x: 0, y: KIT.floorTop, z: -0.2 },
    // Ridge along the nave (building Z): the roof's own X runs along Z with yaw 90.
    { prefab: 'capela-telhado', x: 0, y: KIT.floorTop + NAVE.h, z: -0.4, yaw: 90 },
  ],
  doors: [{ x: 0, z: NAVE.d / 2 + 0.3, yaw: 0 }, { x: NAVE.w / 2, z: NAVE.d / 2 - 3.1, yaw: 270 }],
  notes: 'Baú: diante do altar (coberto). Portas: principal ao sul (frente) e lateral à direita.',
});

// ------------------------------------------------------------------------------------------------ square and streets

/** Fountain (chafariz) for the square: an octagonal basin (low cover), a pedestal with a bowl and four spouts. */
col('chafariz-pedra', 'Chafariz colonial', 'baixa', [
  cyl(0, 0.38, 0, 2.0, 0.38, 'pedraSabao', { seg: 8 }),
  cyl(0, 0.79, 0, 2.08, 0.05, 'cantaria', { ...deco, seg: 8 }),
  cyl(0, 0.5, 0, 1.72, 0.12, 'pedraEscura', { ...deco, seg: 8 }),
  cyl(0, 1.25, 0, 0.42, 1.2, 'pedraSabao', { seg: 8 }),
  cyl(0, 2.2, 0, 0.85, 0.12, 'pedraSabao', { seg: 10 }),
  cyl(0, 2.55, 0, 0.22, 0.3, 'pedraSabao', { ...deco, seg: 8 }),
  ball(0, 2.98, 0, 0.24, 'pedraSabao', { ...deco, lod: 'far' }),
  ...[0, 90, 180, 270].map((a) => {
    const s = Math.sin((a * Math.PI) / 180);
    const c = Math.cos((a * Math.PI) / 180);
    return box(s * 0.5, 1.75, c * 0.5, 0.05, 0.05, 0.12, 'ferro', { ...near, ry: a });
  }),
]);
// The water lies just over the stone (the basin and the bowl are solid: low cover), inside their rims.
col('chafariz-agua', 'Água do chafariz', 'decoracao', [
  cyl(0, 0.86, 0, 1.72, 0.02, 'agua', { ...deco, seg: 8 }),
  cyl(0, 2.34, 0, 0.72, 0.02, 'agua', { ...deco, seg: 10 }),
  ...[0, 90, 180, 270].map((a) => {
    const s = Math.sin((a * Math.PI) / 180);
    const c = Math.cos((a * Math.PI) / 180);
    return cyl(s * 0.68, 1.2, c * 0.68, 0.035, 0.55, 'espuma', { ...deco, seg: 5 });
  }),
], { water: true });
addBuilding({ id: 'chafariz', name: 'Chafariz do Largo', category: 'colonial', halfX: 2.2, halfZ: 2.2, pieces: [{ prefab: 'chafariz-pedra', x: 0, z: 0 }, { prefab: 'chafariz-agua', x: 0, z: 0 }] });

/** Pé-de-moleque paving (irregular river stones): street tiles that lean with the slope. */
for (const [id, name, w, d] of [['pe-de-moleque-3x4', 'Calçamento pé-de-moleque 3×4', 3.4, 4.2], ['pe-de-moleque-4x4', 'Calçamento pé-de-moleque 4×4', 4.1, 4.1], ['pe-de-moleque-5x4', 'Ladeira de pé-de-moleque 5×4', 5.0, 4.2]] as [string, string, number, number][]) {
  addPrefab({
    id,
    name,
    category: 'rua',
    cover: 'decoracao',
    alignToGround: true,
    scale: [1, 1],
    parts: [
      box(0, -0.11, 0, w / 2, 0.14, d / 2, 'peDeMoleque', deco),
      // A darker stone gutter down the middle and a few big stones: the hand-laid look.
      box(0, 0.035, 0, 0.18, 0.008, d / 2, 'pedraEscura', near),
      ...[[-0.8, -1.2], [0.9, 0.5], [-1.1, 1.3], [0.6, -1.6], [-0.3, 0.2], [1.2, 1.7]].filter(([x]) => Math.abs(x!) < w / 2 - 0.2).map(([x, z]) => box(x!, 0.035, z!, 0.16, 0.01, 0.12, 'pedraEscura', { ...near, ry: x! * 40 })),
    ],
  });
}

/**
 * Stone stairway (escadaria) up a terrace: steps over a ramp collider, low stone side walls (cover), a top landing and
 * a masonry base that reaches into the hillside. Variants by height; the map puts each where the ground rises by it.
 */
for (const [rise, run, steps] of [[1.6, 2.8, 9], [2.4, 4.0, 13], [3.35, 5.6, 18]] as const) {
  const id = `escadaria-pedra-${Math.round(rise * 10)}`;
  col(id, `Escadaria de pedra (${rise} m)`, 'passagem', [
    ...stair(0, { rise, run, steps, width: 2.2, landing: 1.4, color: 'cantaria', base: true }),
    ...[-1, 1].map((sx) => slope(sx * 1.25, 0.15, -0.4, 0.75, run - 0.1, rise + 0.75, 1.6, 'pedraEscura')),
    ...[-1, 1].map((sx) => span(sx * 1.1, rise - 0.8, run - 0.1, sx * 1.4, rise + 0.75, run + 1.3, 'pedraEscura')),
    ...[-1, 1].map((sx) => box(sx * 1.25, 0.4, -0.3, 0.2, 0.4, 0.2, 'cantaria', near)),
  ]);
}

/** Stone retaining wall (muro de arrimo), 4 m long: from 4 m below an upper terrace to a 0.7 m parapet above it. */
col('muro-arrimo-4', 'Muro de arrimo de pedra 4 m', 'alta', [
  box(0, -1.65, 0, 2.0, 2.35, 0.32, 'pedraEscura'),
  box(0, 0.62, 0, 2.02, 0.08, 0.36, 'cantaria', { ...deco, lod: 'far' }),
  ...[-1.4, -0.3, 0.8].flatMap((x, i) => [box(x, -0.7 - i * 0.6, 0.33, 0.3, 0.12, 0.01, 'pedra', near), box(x + 0.5, -1.6 + i * 0.3, 0.33, 0.25, 0.1, 0.01, 'cantaria', near)]),
]);
col('muro-pedra-seca-4', 'Muro de pedra seca 4 m', 'baixa', [
  box(0, 0.35, 0, 2.0, 0.55, 0.3, 'pedra'),
  ...[-1.5, -0.5, 0.5, 1.5].map((x, i) => box(x, 0.92, 0, 0.45, 0.05 + (i % 2) * 0.03, 0.27, 'cantaria', near)),
]);

/**
 * Stone bridge (ponte de pedra) over a stream, along Z: a humped deck 8 m long (0.6 m crown), low parapets (cover),
 * an arch over the water (open below: the stream is a second way through) and abutments down into the banks.
 * Origin: the deck ends' ground level.
 */
col('ponte-pedra', 'Ponte de pedra em arco', 'passagem', [
  // Deck: two ramps and a crown, walkable (14°).
  slope(0, 1.25, -4.2, 0.0, -1.4, 0.65, 0.5, 'cantaria'),
  span(-1.25, 0.15, -1.45, 1.25, 0.65, 1.45, 'cantaria'),
  slope(0, 1.25, 1.4, 0.65, 4.2, 0.0, 0.5, 'cantaria'),
  // Parapets following the hump.
  ...[-1, 1].flatMap((sx) => [
    slope(sx * 1.38, 0.17, -4.2, 0.75, -1.4, 1.4, 0.75, 'pedraEscura'),
    span(sx * 1.21, 0.65, -1.45, sx * 1.55, 1.4, 1.45, 'pedraEscura'),
    slope(sx * 1.38, 0.17, 1.4, 1.4, 4.2, 0.75, 0.75, 'pedraEscura'),
    box(sx * 1.38, 1.44, 0, 0.21, 0.05, 1.5, 'cantaria', near),
  ]),
  // Arch ring and spandrels on both faces (above the opening only).
  ...Array.from({ length: 9 }, (_, i) => {
    const a0 = Math.PI * (i / 9);
    const a1 = Math.PI * ((i + 1) / 9);
    const r = 2.45;
    const cy = -2.35;
    return slope(0, 1.5, -Math.cos(a0) * r, cy + Math.sin(a0) * r, -Math.cos(a1) * r, cy + Math.sin(a1) * r, 0.35, 'pedraEscura', { solid: 'none' });
  }),
  ...[-1, 1].flatMap((sz) => [span(-1.3, -1.1, sz * 2.0, 1.3, 0.2, sz * 2.9, 'pedra'), span(-1.3, -0.1, sz * 1.0, 1.3, 0.2, sz * 2.0, 'pedra')]),
  // Abutments into the banks.
  ...[-1, 1].map((sz) => span(-1.6, -3.2, sz * 2.45, 1.6, 0.05, sz * 4.6, 'pedraEscura')),
  // Deck underside over the opening (solid crown so nobody pops up through it).
  span(-1.3, 0.0, -1.0, 1.3, 0.2, 1.0, 'pedra', ghost),
]);

/** Colonial lanterns: an iron post with a four-sided lantern, and a wall bracket lantern. */
col('lampiao-poste', 'Lampião colonial', 'decoracao', [
  cyl(0, 1.35, 0, 0.07, 1.35, 'ferro', { seg: 6 }),
  cyl(0, 0.12, 0, 0.18, 0.12, 'pedraSabao', { ...deco, seg: 8 }),
  box(0, 2.95, 0, 0.2, 0.28, 0.2, 'lanterna', { ...deco, lod: 'far' }),
  cone(0, 3.35, 0, 0.3, 0.14, 'ferro', { ...deco, seg: 4, ry: 45 }),
  ball(0, 3.55, 0, 0.06, 'ferro', near),
]);
col('lampiao-parede', 'Lampião de parede', 'decoracao', [
  box(0, 0, 0.18, 0.03, 0.03, 0.18, 'ferro', near),
  box(0, -0.15, 0.36, 0.13, 0.18, 0.13, 'lanterna', { ...deco, lod: 'far' }),
  cone(0, 0.1, 0.36, 0.18, 0.08, 'ferro', { ...near, seg: 4, ry: 45 }),
]);
/** Stone arch over an alley (passagem em arco): two piers and a little tiled roof; 2.2 m wide, 2.7 m clear. */
col('arco-beco', 'Arco de pedra do beco', 'estrutura', [
  ...[-1, 1].map((sx) => box(sx * 1.45, 1.6, 0, 0.35, 1.6, 0.4, 'cal')),
  ...[-1, 1].map((sx) => box(sx * 1.45, 0.3, 0, 0.38, 0.3, 0.43, 'cantaria', deco)),
  span(-1.8, 2.7, -0.4, 1.8, 3.3, 0.4, 'cal'),
  ...Array.from({ length: 6 }, (_, i) => {
    const a0 = Math.PI * (i / 6);
    const a1 = Math.PI * ((i + 1) / 6);
    return chordXY(-Math.cos(a0) * 1.1, 2.15 + Math.sin(a0) * 0.55, -Math.cos(a1) * 1.1, 2.15 + Math.sin(a1) * 0.55, 0.16, 0.42, 'cantaria', near);
  }),
  { shape: 'gable', x: 0, y: 3.3, z: 0, hx: 1.95, hy: 0.5, hz: 0.6, color: 'telhaColonial' },
]);
/** Wooden cross on a stone pedestal (cruzeiro), in front of the chapel. */
col('cruzeiro', 'Cruzeiro', 'baixa', [
  box(0, 0.3, 0, 0.7, 0.3, 0.7, 'pedraSabao'),
  box(0, 0.75, 0, 0.45, 0.15, 0.45, 'cantaria'),
  box(0, 2.6, 0, 0.1, 1.7, 0.1, 'madeiraEscura'),
  box(0, 3.4, 0, 0.6, 0.08, 0.08, 'madeiraEscura', { ...deco, lod: 'far' }),
]);
/** Wall-mounted fountain (bica) for a yard or an alley: a stone back with a spout and a trough. */
col('bica-pedra', 'Bica de pedra', 'baixa', [
  box(0, 1.0, -0.15, 0.9, 1.0, 0.15, 'pedraSabao'),
  { shape: 'gable', x: 0, y: 2.0, z: -0.15, hx: 0.15, hy: 0.35, hz: 0.9, color: 'pedraSabao', ry: 90 },
  box(0, 0.3, 0.3, 0.8, 0.3, 0.3, 'cantaria'),
  box(0, 1.1, 0.12, 0.04, 0.04, 0.15, 'ferro', near),
]);
col('bica-agua', 'Água da bica', 'decoracao', [box(0, 0.62, 0.3, 0.68, 0.02, 0.24, 'agua', deco), cyl(0, 0.86, 0.27, 0.03, 0.25, 'espuma', { ...deco, seg: 5 })], { water: true });
addBuilding({ id: 'bica', name: 'Bica do quintal', category: 'colonial', halfX: 1.0, halfZ: 0.7, pieces: [{ prefab: 'bica-pedra', x: 0, z: 0 }, { prefab: 'bica-agua', x: 0, z: 0 }] });
