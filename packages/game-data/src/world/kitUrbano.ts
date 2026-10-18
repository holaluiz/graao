/**
 * URBANO_BH kit: Bairro do Horizonte, after the corner bars, flat-roofed houses ("laje"), little shops, garage gates,
 * steel shop doors, water tanks, concrete poles and the arched viaduct of Belo Horizonte's old neighbourhoods
 * (docs/world/MG_ARCHITECTURE_KITS.md). Every piece is an original stylized design; no real shop names or brands.
 */
import {
  KIT,
  addBuilding,
  addPrefab,
  ball,
  box,
  crate,
  cyl,
  deco,
  footbridge,
  foundation,
  gabledRoof,
  ghost,
  lanternString,
  near,
  parapet,
  roofTerrace,
  shell,
  sideStair,
  slab,
  slope,
  span,
  stair,
  wall,
  type KitColor,
  type KitCover,
  type KitPart,
  type KitPiece,
  type WallKind,
  type WallStyle,
} from './kitCore';

const urb = (id: string, name: string, cover: KitCover, parts: KitPart[], o: { length?: number; scale?: [number, number] } = {}) =>
  addPrefab({ id, name, category: 'urbano_bh', cover, parts, scale: o.scale ?? [1, 1], ...(o.length ? { length: o.length } : {}) });
const prop = (id: string, name: string, cover: KitCover, parts: KitPart[], scale: [number, number] = [0.85, 1.15]) => addPrefab({ id, name, category: 'props', cover, parts, scale });

// ------------------------------------------------------------------------------------------------ house modules

const BH = (color: KitColor, leaf: KitColor = 'porta'): WallStyle => ({ color, plinth: { h: 0.5, color: 'rodape' }, look: 'bh', leaf });
const TONES: [string, KitColor, KitColor][] = [
  ['', 'reboco', 'porta'],
  ['-rosa', 'rebocoRosa', 'porta'],
  ['-verde', 'rebocoVerde', 'porta'],
  ['-azul', 'rebocoAzul', 'porta'],
  ['-amarelo', 'rebocoAmarelo', 'porta'],
  ['-laranja', 'rebocoLaranja', 'azulColonial'],
  ['-lilas', 'rebocoLilas', 'verdeColonial'],
];
const KIND_NAME: Record<WallKind, string> = { cheia: 'Parede', janela: 'Parede com janela', porta: 'Parede com porta', vitrine: 'Fachada de loja', portao: 'Parede com portão', aco: 'Porta de aço' };
for (const len of [2, 4]) {
  for (const [tag, color, leaf] of TONES) {
    for (const kind of ['cheia', 'janela', 'porta'] as const) {
      const id = kind === 'cheia' ? `parede-${len}${tag}` : `parede-${kind}-${len}${tag}`;
      urb(id, `${KIND_NAME[kind]} ${len} m${tag ? ` (${tag.slice(1)})` : ''}`, 'alta', wall(len, kind, BH(color, leaf)), { length: len });
    }
  }
}
for (const [tag, color] of TONES) {
  urb(`parede-aco-4${tag}`, `Porta de aço 4 m${tag ? ` (${tag.slice(1)})` : ''}`, 'alta', wall(4, 'aco', BH(color)), { length: 4 });
  urb(`parede-portao-4${tag}`, `Garagem 4 m${tag ? ` (${tag.slice(1)})` : ''}`, 'alta', [
    ...wall(4, 'portao', BH(color)),
    // Garage gate leaves pushed open against the inside walls.
    box(-1.15, 1.2, -0.5, 0.03, 1.05, 0.38, 'metal', near),
    box(1.15, 1.2, -0.5, 0.03, 1.05, 0.38, 'metal', near),
  ], { length: 4 });
}
urb('parede-vitrine-4-amarelo', 'Fachada de loja 4 m', 'alta', wall(4, 'vitrine', BH('rebocoAmarelo')), { length: 4 });
urb('parede-vitrine-4-azul', 'Fachada de loja 4 m (azul)', 'alta', wall(4, 'vitrine', BH('rebocoAzul')), { length: 4 });
urb('pilar-canto', 'Pilar de canto', 'alta', [box(0, KIT.wallTop / 2, 0, 0.17, KIT.wallTop / 2, 0.17, 'rodape')]);
urb('pilar-parapeito', 'Pilar do parapeito', 'baixa', [box(0, (KIT.parapetH + 0.1) / 2 - 0.05, 0, 0.13, (KIT.parapetH + 0.1) / 2, 0.13, 'rodape')]);
for (const [w, d] of [[6, 6], [6, 4], [10, 6], [12, 10]] as const) {
  urb(`fundacao-${w}x${d}`, `Piso ${w}×${d}`, 'passagem', foundation(w, d));
  urb(`laje-${w}x${d}`, `Laje ${w}×${d}`, 'passagem', slab(w, d));
}
urb('parapeito-2', 'Parapeito 2 m', 'baixa', parapet(2));
urb('escada-laje-d', 'Escada externa (corrimão à direita)', 'passagem', stair(1));
urb('escada-laje-e', 'Escada externa (corrimão à esquerda)', 'passagem', stair(-1));
urb('passarela-5', 'Passarela 5,6 m', 'passagem', footbridge(5.6));
urb('passarela-4', 'Passarela 4 m', 'passagem', footbridge(4.0));
urb('telhado-6x4', 'Telhado de duas águas 6×4', 'alta', gabledRoof(6, 4, 1.4));
urb('telhado-oficina-6x4', 'Telhado da oficina 6×4', 'alta', [box(0, 0.09, 0, 3.35, 0.09, 2.45, 'telha'), box(0, 0.12, 2.47, 3.38, 0.14, 0.04, 'madeira', deco)]);
urb('telhado-fibro-6x6', 'Telhado de fibrocimento 6×6', 'alta', [slope(0, 3.3, 3.4, 0.0, -3.4, 0.7, 0.07, 'concreto'), ...[-2.4, -0.8, 0.8, 2.4].map((x) => slope(x, 0.04, 3.4, 0.07, -3.4, 0.77, 0.02, 'concretoEscuro', near))]);
urb('caixa-dagua', "Caixa-d'água", 'alta', [
  box(0, 0.08, 0, 0.82, 0.08, 0.82, 'laje'),
  cyl(0, 0.7, 0, 0.75, 0.55, 'caixaDagua', { seg: 14 }),
  cyl(0, 1.28, 0, 0.79, 0.05, 'caixaDagua', { ...deco, seg: 14 }),
]);
urb('antena', 'Antena de TV', 'decoracao', [
  cyl(0, 1.0, 0, 0.03, 1.0, 'metal', { ...deco, seg: 4 }),
  box(0, 1.85, 0, 0.6, 0.015, 0.015, 'metal', { ...deco, lod: 'far' }),
  box(0, 1.6, 0, 0.45, 0.015, 0.015, 'metal', { ...deco, lod: 'far' }),
  box(0, 1.35, 0, 0.3, 0.015, 0.015, 'metal', { ...deco, lod: 'far' }),
]);
urb('balcao-2', 'Balcão 2,4 m', 'baixa', [box(0, 0.5, 0, 1.2, 0.5, 0.35, 'madeira'), box(0, 1.03, 0, 1.28, 0.04, 0.42, 'madeiraClara', deco)]);
urb('toldo-3', 'Toldo 3 m', 'decoracao', [box(0, 0, 0.55, 1.6, 0.04, 0.6, 'lonaVermelha', { ...deco, rx: 14 }), box(0, -0.18, 1.12, 1.6, 0.14, 0.02, 'lonaVermelha', deco)]);
urb('toldo-listrado-4', 'Toldo listrado 4 m', 'decoracao', [
  ...[-1.5, -0.5, 0.5, 1.5].map((x, i) => box(x, 0, 0.6, 0.5, 0.04, 0.65, i % 2 ? 'plasticoBranco' : 'lonaVerde', { ...deco, rx: 16 })),
  box(0, -0.22, 1.22, 2.0, 0.12, 0.02, 'lonaVerde', deco),
]);
urb('placa-loja', 'Placa da loja', 'decoracao', [box(0, 0, 0, 1.1, 0.2, 0.05, 'porta', deco), box(0, 0, 0.06, 0.9, 0.12, 0.01, 'lanterna', near)]);
for (const [id, name, bg, fg] of [
  ['placa-bar', 'Placa do bar', 'vermelhoColonial', 'plasticoAmarelo'],
  ['placa-padaria', 'Placa da padaria', 'amareloOcre', 'plasticoBranco'],
  ['placa-mercado', 'Placa do mercado', 'verdeColonial', 'plasticoBranco'],
] as [string, string, KitColor, KitColor][]) {
  // Painted sign boards: a coloured board and a pale "lettering" band (original, no brands).
  urb(id, name, 'decoracao', [box(0, 0, 0, 1.5, 0.32, 0.05, bg, deco), box(-0.25, 0.04, 0.06, 0.95, 0.1, 0.01, fg, near), box(0.55, -0.13, 0.06, 0.55, 0.05, 0.01, fg, near)]);
}
/** Concrete canopy over the pavement (marquise): a ledge to stand on, held by two brackets. */
urb('marquise-4', 'Marquise 4 m', 'passagem', [box(0, -0.08, 0.7, 2.1, 0.08, 0.72, 'concreto'), ...[-1.7, 1.7].map((x) => slope(x, 0.06, 0.05, -0.75, 1.1, -0.12, 0.12, 'concreto', deco))]);

// ------------------------------------------------------------------------------------------------ street furniture

prop('muro-baixo-2', 'Muro baixo 2 m', 'baixa', [box(0, (KIT.lowWall - 0.4) / 2, 0, 1, (KIT.lowWall + 0.4) / 2, 0.15, 'reboco'), box(0, KIT.lowWall + 0.03, 0, 1.03, 0.04, 0.19, 'pedra', near)], [1, 1]);
prop('muro-baixo-4', 'Muro baixo 4 m', 'baixa', [box(0, (KIT.lowWall - 0.4) / 2, 0, 2, (KIT.lowWall + 0.4) / 2, 0.15, 'reboco'), box(0, KIT.lowWall + 0.03, 0, 2.03, 0.04, 0.19, 'pedra', near)], [1, 1]);
/** Wall with an iron fence on top: legs covered, the fence stops people but not shots. */
urb('muro-grade-4', 'Muro com grade 4 m', 'baixa', [
  box(0, 0.15, 0, 2, 0.55, 0.13, 'rebocoAmarelo'),
  box(0, 1.35, 0, 2, 0.65, 0.03, 'ferro', { solid: 'move', visible: false }),
  ...[-1.8, -1.2, -0.6, 0, 0.6, 1.2, 1.8].map((x) => box(x, 1.3, 0, 0.02, 0.6, 0.02, 'ferro', near)),
  box(0, 1.92, 0, 2, 0.025, 0.025, 'ferro', deco),
  box(0, 0.73, 0, 2.02, 0.03, 0.16, 'rodape', near),
]);
urb('muro-alto-4', 'Muro alto 4 m', 'alta', [box(0, 0.8, 0, 2, 1.2, 0.13, 'reboco'), box(0, 2.03, 0, 2.02, 0.04, 0.16, 'rodape', near)]);
urb('portao-4', 'Portão de ferro 4 m', 'ocultacao', [
  box(0, 0.95, 0, 2, 0.95, 0.03, 'ferro', { solid: 'move', visible: false }),
  ...[-1.8, -1.4, -1.0, -0.6, -0.2, 0.2, 0.6, 1.0, 1.4, 1.8].map((x) => box(x, 0.95, 0, 0.02, 0.92, 0.02, 'ferro', near)),
  box(0, 1.88, 0, 2, 0.04, 0.03, 'ferro', deco),
  box(0, 0.08, 0, 2, 0.04, 0.03, 'ferro', deco),
  box(-2.08, 1.0, 0, 0.14, 1.0, 0.14, 'rodape'),
  box(2.08, 1.0, 0, 0.14, 1.0, 0.14, 'rodape'),
]);
prop('banco', 'Banco de praça', 'baixa', [
  box(0, 0.25, 0, 0.9, 0.25, 0.22, 'madeira', ghost),
  box(0, 0.46, 0, 0.9, 0.04, 0.22, 'madeiraClara', deco),
  box(0, 0.75, -0.2, 0.9, 0.2, 0.03, 'madeiraClara', { ...deco, rx: -8 }),
  box(-0.75, 0.22, 0, 0.05, 0.22, 0.2, 'ferro', near),
  box(0.75, 0.22, 0, 0.05, 0.22, 0.2, 'ferro', near),
]);
prop('caixote', 'Caixote', 'destrutivel', crate(0, 0, 0));
prop('pilha-caixotes', 'Pilha de caixotes', 'alta', [...crate(-0.48, 0, 0), ...crate(0.48, 0, 0.05, 0.45, 8), ...crate(0, 0.9, 0, 0.45, -6)]);
prop('barril', 'Barril', 'baixa', [cyl(0, 0.45, 0, 0.36, 0.45, 'lonaAzul', { seg: 12 }), cyl(0, 0.45, 0, 0.38, 0.04, 'ferro', { ...near, seg: 12 }), cyl(0, 0.86, 0, 0.38, 0.03, 'ferro', { ...near, seg: 12 })]);
prop('vaso', 'Floreira', 'baixa', [box(0, 0.25, 0, 0.6, 0.35, 0.6, 'rodape'), { shape: 'ball', x: 0, y: 0.75, z: 0, hx: 0.62, hy: 0.62, hz: 0.62, color: 'folha', solid: 'none' }]);
prop('barraca', 'Barraca de feira', 'baixa', [
  box(0, 0.5, 0.3, 1.2, 0.5, 0.35, 'madeira'),
  box(0, 1.03, 0.3, 1.26, 0.04, 0.4, 'madeiraClara', deco),
  ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => cyl(sx * 1.15, 1.2, sz * 0.6 - 0.1, 0.05, 1.2, 'madeira', { seg: 6 }))),
  box(0, 2.45, -0.1, 1.45, 0.05, 1.0, 'lona', { ...deco, rx: -10 }),
  ...crate(-0.6, 1.07, 0.2, 0.18, 0, 'none'),
  ...crate(0.5, 1.07, 0.3, 0.16, 20, 'none'),
]);
prop('carrinho', 'Carrinho de mão', 'baixa', [
  box(0, 0.65, 0, 0.5, 0.3, 0.75, 'madeira'),
  cyl(-0.55, 0.32, -0.3, 0.3, 0.05, 'ferro', { rz: 90, seg: 10 }),
  cyl(0.55, 0.32, -0.3, 0.3, 0.05, 'ferro', { rz: 90, seg: 10 }),
  box(-0.3, 0.85, 1.05, 0.04, 0.04, 0.4, 'madeiraClara', near),
  box(0.3, 0.85, 1.05, 0.04, 0.04, 0.4, 'madeiraClara', near),
]);
prop('bancada', 'Bancada de oficina', 'baixa', [
  box(0, 0.45, 0, 1.0, 0.45, 0.4, 'madeira', ghost),
  box(0, 0.88, 0, 1.05, 0.05, 0.42, 'madeiraClara', deco),
  ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => box(sx * 0.92, 0.42, sz * 0.32, 0.05, 0.42, 0.05, 'madeira', near))),
  box(0, 0.25, 0, 0.95, 0.03, 0.35, 'madeira', near),
]);
prop('poste-lanterna', 'Poste com lanterna', 'decoracao', [
  cyl(0, 1.55, 0, 0.08, 1.75, 'ferro', { seg: 6 }),
  box(0, 3.25, 0, 0.21, 0.25, 0.21, 'lanterna', { ...deco, lod: 'far' }),
  { shape: 'cone', x: 0, y: 3.62, z: 0, hx: 0.36, hy: 0.15, hz: 0.36, color: 'ferro', solid: 'none', seg: 4, ry: 45 },
], [1, 1]);
/** Concrete utility pole with a crossarm and insulators; `fios-8` hangs the wires between two of them. */
urb('poste-luz', 'Poste de concreto', 'decoracao', [
  cyl(0, 3.6, 0, 0.13, 3.6, 'concreto', { seg: 6 }),
  box(0, 6.6, 0, 0.9, 0.06, 0.07, 'concreto', deco),
  ...[-0.75, 0, 0.75].map((x) => cyl(x, 6.75, 0, 0.04, 0.09, 'plasticoBranco', near)),
  cyl(0.25, 5.6, 0.2, 0.22, 0.35, 'concretoEscuro', { ...deco, seg: 8 }),
]);
urb('fios-8', 'Fios entre postes 8 m', 'decoracao', [-0.75, 0, 0.75].flatMap((x) => lanternString(8, 0.45, []).filter((p) => p.color === 'ferro').map((p) => ({ ...p, x }))));
prop('varal-roupas-5', 'Varal de roupas 5 m', 'ocultacao', [
  cyl(0, 1.0, -2.5, 0.06, 1.2, 'madeira', { seg: 6 }),
  cyl(0, 1.0, 2.5, 0.06, 1.2, 'madeira', { seg: 6 }),
  box(0, 2.05, 0, 0.012, 0.012, 2.5, 'ferro', { ...deco, anchor: true }),
  ...(['roupa1', 'roupa2', 'roupa3', 'roupa4', 'roupa1', 'roupa3'] as KitColor[]).map((c, i) => box(0, 1.62 + (i % 2) * 0.08, -1.9 + i * 0.76, 0.02, 0.38 - (i % 3) * 0.05, 0.3, c, deco)),
], [1, 1]);
prop('varal-lanternas-5', 'Varal de lanternas 5 m', 'decoracao', lanternString(5, 0.35, ['lanterna', 'roupa1', 'lanterna', 'roupa3']), [1, 1]);
prop('varal-lanternas-8', 'Varal de lanternas 8 m', 'decoracao', lanternString(8, 0.5, ['lanterna', 'roupa2', 'lanterna', 'roupa1', 'lanterna', 'roupa3']), [1, 1]);

/** Plastic bar table with four chairs (the corner bar's pavement): low cover, shots pass over the chairs. */
prop('mesa-bar', 'Mesa de bar com cadeiras', 'baixa', [
  cyl(0, 0.37, 0, 0.42, 0.37, 'plasticoVermelho', { visible: false, seg: 8 }),
  cyl(0, 0.72, 0, 0.45, 0.03, 'plasticoVermelho', { ...deco, seg: 12 }),
  cyl(0, 0.36, 0, 0.05, 0.36, 'plasticoVermelho', { ...near, seg: 6 }),
  ...[0, 90, 180, 270].flatMap((a) => {
    const s = Math.sin((a * Math.PI) / 180);
    const c = Math.cos((a * Math.PI) / 180);
    return [
      box(s * 0.72, 0.42, c * 0.72, 0.21, 0.03, 0.21, 'plasticoVermelho', { ...near, ry: a }),
      box(s * 0.92, 0.68, c * 0.92, 0.21, 0.24, 0.025, 'plasticoVermelho', { ...near, ry: a }),
      box(s * 0.72, 0.2, c * 0.72, 0.18, 0.2, 0.18, 'plasticoVermelho', { solid: 'move', visible: false, ry: a }),
    ];
  }),
], [1, 1]);
prop('mesa-bar-amarela', 'Mesa de bar amarela', 'baixa', [
  cyl(0, 0.37, 0, 0.42, 0.37, 'plasticoAmarelo', { visible: false, seg: 8 }),
  cyl(0, 0.72, 0, 0.45, 0.03, 'plasticoAmarelo', { ...deco, seg: 12 }),
  cyl(0, 0.36, 0, 0.05, 0.36, 'plasticoAmarelo', { ...near, seg: 6 }),
  ...[45, 225].flatMap((a) => {
    const s = Math.sin((a * Math.PI) / 180);
    const c = Math.cos((a * Math.PI) / 180);
    return [box(s * 0.72, 0.42, c * 0.72, 0.21, 0.03, 0.21, 'plasticoAmarelo', { ...near, ry: a }), box(s * 0.92, 0.68, c * 0.92, 0.21, 0.24, 0.025, 'plasticoAmarelo', { ...near, ry: a })];
  }),
], [1, 1]);
prop('engradados', 'Engradados de garrafas', 'baixa', [
  ...[0, 1, 2].map((i) => box(0, 0.16 + i * 0.3, 0, 0.3, 0.15, 0.2, i % 2 ? 'plasticoVermelho' : 'plasticoAmarelo')),
  ...[-0.15, 0, 0.15].map((x) => cyl(x, 0.98, 0, 0.04, 0.09, 'cafe', near)),
]);
prop('bicicleta', 'Bicicleta encostada', 'decoracao', [
  cyl(0, 0.34, -0.5, 0.33, 0.02, 'ferro', { ...deco, rz: 90, seg: 12 }),
  cyl(0, 0.34, 0.5, 0.33, 0.02, 'ferro', { ...deco, rz: 90, seg: 12 }),
  slope(0, 0.025, -0.45, 0.4, 0.15, 0.75, 0.05, 'vermelhoColonial', deco),
  slope(0, 0.025, 0.15, 0.75, 0.5, 0.4, 0.05, 'vermelhoColonial', deco),
  box(0, 0.88, 0.42, 0.25, 0.02, 0.02, 'ferro', near),
  box(0, 0.82, -0.32, 0.08, 0.03, 0.12, 'ferro', near),
]);
prop('lixeira', 'Lixeira laranja', 'decoracao', [cyl(0, 0.45, 0, 0.04, 0.45, 'metal', { ...deco, seg: 4 }), cyl(0, 0.85, 0.12, 0.2, 0.22, 'rebocoLaranja', { ...deco, seg: 10 })]);
/** Bus stop shelter (ponto de ônibus): a bench under a roof, open at the front. */
urb('ponto-onibus', 'Ponto de ônibus', 'baixa', [
  box(0, 2.45, 0, 1.6, 0.06, 0.75, 'concreto'),
  ...[-1.45, 1.45].map((x) => box(x, 1.2, -0.55, 0.06, 1.2, 0.06, 'metal')),
  box(0, 1.25, -0.62, 1.5, 0.95, 0.03, 'vidro', { solid: 'move' }),
  box(0, 0.45, -0.35, 1.3, 0.04, 0.2, 'madeiraClara', deco),
  box(0, 2.62, 0.7, 0.35, 0.16, 0.03, 'azulColonial', near),
]);

// ------------------------------------------------------------------------------------------------ murals and blocks

/**
 * Original abstract mural: big colour shapes on a wall face, `w` × `h` from height `y0`, on the plane `face` = +offset
 * along Z ('z') or along X ('x'), facing outward. A flat graphic composition (no figures copied from real murals).
 */
function mural(w: number, h: number, y0: number, offset: number, seed: number, face: 'z' | 'x' | '-z' = 'z'): KitPart[] {
  const colors: KitColor[] = ['muralA', 'muralB', 'muralC', 'muralD', 'muralE', 'cal'];
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  // u runs along the wall, v up; d is the small offset off the wall.
  const panel = (u: number, v: number, d: number, hu: number, hv: number, color: KitColor, tilt = 0, o: Partial<KitPart> = {}): KitPart =>
    face === 'x' ? box(offset + d, v, -u, 0.008, hv, hu, color, { ...deco, rx: tilt, ...o }) : box(face === 'z' ? u : -u, v, face === 'z' ? offset + d : -offset - d, hu, hv, 0.008, color, { ...deco, rz: face === 'z' ? tilt : -tilt, ...o });
  const parts: KitPart[] = [panel(0, y0 + h / 2, 0.012, w / 2, h / 2, colors[seed % 5]!)];
  for (let i = 0; i < 5; i++) {
    const bw = w * (0.25 + rnd() * 0.35);
    const bh = h * (0.12 + rnd() * 0.2);
    const u = (rnd() - 0.5) * (w - bw);
    const v = y0 + bh / 2 + rnd() * (h - bh);
    parts.push(panel(u, v, 0.02 + i * 0.004, bw / 2, bh / 2, colors[(seed + i + 1) % colors.length]!, (rnd() - 0.5) * 30));
  }
  const r = Math.min(w, h) * 0.16;
  const u = w * 0.22;
  const v = y0 + h * 0.68;
  parts.push(face === 'x' ? cyl(offset + 0.045, v, -u, r, 0.01, 'muralC', { ...deco, rz: 90, seg: 16 }) : cyl(face === 'z' ? u : -u, v, face === 'z' ? offset + 0.045 : -offset - 0.045, r, 0.01, 'muralC', { ...deco, rx: 90, seg: 16 }));
  return parts;
}

for (const [i, base] of (['rebocoAzul', 'rebocoRosa', 'rebocoAmarelo'] as KitColor[]).entries()) {
  // Three-storey block (prédio) 6 × 6, a mural on its blind side wall (+X), windows on the front, a water tank and an
  // antenna on top: the neighbourhood's skyline. Solid (not enterable).
  const h = 9.6 + i * 1.6;
  const floors = Math.floor(h / 3.0);
  const parts: KitPart[] = [box(0, h / 2 - 0.4, 0, 3, h / 2 + 0.4, 3, base), box(0, h + 0.4, 0, 3.08, 0.4, 3.08, 'rodape')];
  for (let f = 0; f < floors; f++) {
    for (const x of [-1.5, 1.5]) {
      parts.push(box(x, 1.6 + f * 3.0, 3.02, 0.6, 0.6, 0.02, 'vidro', deco), box(x, 1.0 + f * 3.0, 3.06, 0.72, 0.05, 0.07, 'rodape', near));
    }
    parts.push(box(0, 3.0 * (f + 1) - 0.1, 3.03, 3.05, 0.06, 0.04, 'rodape', near));
  }
  parts.push(box(0, 1.25, 3.02, 0.65, 1.1, 0.03, 'ferro', deco));
  parts.push(...mural(5.6, h - 1.2, 0.6, 3.0, 7 + i * 3, 'x'));
  parts.push(box(-1.2, h + 0.85, -1.0, 0.82, 0.08, 0.82, 'laje'), cyl(-1.2, h + 1.45, -1.0, 0.75, 0.55, 'caixaDagua', { seg: 14 }));
  parts.push(cyl(1.4, h + 1.8, 1.4, 0.03, 1.0, 'metal', { ...deco, seg: 4 }), box(1.4, h + 2.6, 1.4, 0.5, 0.015, 0.015, 'metal', { ...deco, lod: 'far' }));
  urb(`predio-${i + 1}`, `Prédio de ${floors} andares com mural`, 'alta', parts);
}
urb('mural-muro', 'Muro com mural', 'alta', [box(0, 1.5, 0, 2, 1.5, 0.15, 'cal'), ...mural(3.9, 2.8, 0.1, 0.15, 21, 'z'), ...mural(3.9, 2.8, 0.1, 0.15, 33, '-z')]);

// ------------------------------------------------------------------------------------------------ viaduct

/**
 * Viaduto dos Arcos: a 24 m deck at laje height (3.35 m) on paired pillars, with two great concrete arches over it —
 * the silhouette of the arched viaducts of Belo Horizonte, not a copy of any of them. Upper level: the deck and its
 * low parapets; lower level: the railway under it, between the pillars; stairs at both ends and a side stair from the
 * middle of the deck down to the tracks. The arch crowns are anchor points.
 */
const VIA = { len: 24, w: 6.4, deck: KIT.roofTop, th: 0.55, archRise: 5.2 };
function viaductDeck(): KitPart[] {
  const { len, w, deck, th } = VIA;
  const parts: KitPart[] = [
    box(0, deck - th / 2, 0, w / 2, th / 2, len / 2, 'concreto'),
    box(0, deck - th - 0.25, 0, w / 2 - 0.6, 0.25, len / 2 - 0.2, 'concretoEscuro', deco),
    // Asphalt band and kerbs on the deck.
    box(0, deck + 0.005, 0, w / 2 - 1.1, 0.01, len / 2, 'asfalto', deco),
    ...[-1, 1].map((sx) => box(sx * (w / 2 - 0.75), deck + 0.06, 0, 0.35, 0.06, len / 2, 'calcada', deco)),
  ];
  // Parapets: low concrete walls (cover to the waist), with a gap on the +X side where the side stair leaves.
  for (const sx of [-1, 1]) {
    for (const [z0, z1] of sx > 0 ? [[-len / 2, -1.1], [1.1, len / 2]] : [[-len / 2, len / 2]]) {
      parts.push(span(sx * (w / 2 - 0.12), deck, z0!, sx * (w / 2 + 0.06), deck + 1.05, z1!, 'concreto'));
      parts.push(span(sx * (w / 2 - 0.16), deck + 1.05, z0!, sx * (w / 2 + 0.1), deck + 1.12, z1!, 'concretoEscuro', near));
    }
  }
  // Pillars in pairs every 6 m, with a cross beam (the lower level's cover).
  for (const z of [-9, -3, 3, 9]) {
    for (const sx of [-1, 1]) parts.push(box(sx * 2.2, (deck - th) / 2 - 0.2, z, 0.32, (deck - th) / 2 + 0.2, 0.32, 'concreto'));
    parts.push(box(0, deck - th - 0.2, z, 2.6, 0.2, 0.35, 'concretoEscuro', deco));
  }
  return parts;
}
/** One great arch along the deck edge at x: a parabola of box segments springing from the deck at the two ends. */
function viaductArch(x: number): KitPart[] {
  const { len, deck, archRise } = VIA;
  const n = 14;
  const parts: KitPart[] = [];
  const half = len / 2 - 0.6;
  const yAt = (z: number) => deck + 1.0 + archRise * (1 - (z / half) ** 2);
  for (let i = 0; i < n; i++) {
    const z0 = -half + (i / n) * 2 * half;
    const z1 = -half + ((i + 1) / n) * 2 * half;
    const crown = i >= n / 2 - 2 && i < n / 2 + 2;
    parts.push(slope(x, 0.26, z0, yAt(z0) + 0.3, z1, yAt(z1) + 0.3, 0.6, 'concreto', crown ? { anchor: true } : {}));
  }
  // Springers on the parapet at both ends.
  for (const sz of [-1, 1]) parts.push(box(x, deck + 0.9, sz * (len / 2 - 0.4), 0.3, 0.9, 0.45, 'concreto'));
  // Ties from the arch down to the parapet (hangers).
  for (let i = 1; i < 6; i++) {
    const z = -half + (i / 6) * 2 * half;
    const top = yAt(z);
    parts.push(box(x, (deck + 1.05 + top) / 2, z, 0.05, (top - deck - 1.05) / 2, 0.05, 'concretoEscuro', { ...deco, lod: 'far' }));
  }
  return parts;
}
urb('viaduto-tabuleiro', 'Viaduto: tabuleiro e pilares', 'estrutura', viaductDeck());
urb('viaduto-arco', 'Viaduto: arco', 'estrutura', viaductArch(0));
urb('escada-viaduto', 'Escada do viaduto', 'passagem', stair(0, { width: 2.4, landing: 0, color: 'concreto' }).concat(
  // Low side walls instead of railings: cover on the way up.
  ...[-1, 1].map((sx) => slope(sx * 1.32, 0.12, -0.2, 0.9, KIT.stair.run, KIT.stair.rise + 0.9, 0.9, 'concreto')),
));
urb('escada-viaduto-lateral', 'Escada lateral do viaduto', 'passagem', stair(-1, { width: 1.6, landing: 0, color: 'concreto', railColor: 'ferro' }));
/** Railway under the viaduct: two rails on sleepers over a gravel bed (decoration, leans with the ground). */
addPrefab({
  id: 'trilhos-6',
  name: 'Trilhos 6 m',
  category: 'rua',
  cover: 'decoracao',
  alignToGround: true,
  scale: [1, 1],
  parts: [
    box(0, -0.06, 0, 1.4, 0.1, 3.05, 'pedraEscura', deco),
    ...[-2.5, -1.5, -0.5, 0.5, 1.5, 2.5].map((z) => box(0, 0.06, z, 1.1, 0.04, 0.12, 'madeiraEscura', near)),
    ...[-0.72, 0.72].map((x) => box(x, 0.13, 0, 0.04, 0.05, 3.05, 'aco', deco)),
  ],
});

// ------------------------------------------------------------------------------------------------ square (praça)

/** Bandstand (coreto): a raised octagonal stage with steps on two sides, eight thin columns and a roof. */
urb('coreto', 'Coreto', 'estrutura', [
  cyl(0, 0.45, 0, 3.0, 0.45, 'cal', { seg: 8 }),
  cyl(0, 0.92, 0, 3.12, 0.04, 'cantaria', { ...deco, seg: 8 }),
  ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
    const a = ((i + 0.5) / 8) * Math.PI * 2;
    return cyl(Math.sin(a) * 2.75, 2.35, Math.cos(a) * 2.75, 0.09, 1.45, 'ferro', { seg: 6 });
  }),
  // Iron balustrade between the columns, open at the two stairs (front and back).
  ...[1, 2, 5, 6].map((i) => {
    const a = (i / 8) * Math.PI * 2;
    return box(Math.sin(a) * 2.88, 1.4, Math.cos(a) * 2.88, 1.1, 0.45, 0.03, 'ferro', { solid: 'move', ry: (a * 180) / Math.PI });
  }),
  { shape: 'cone', x: 0, y: 4.35, z: 0, hx: 3.6, hy: 0.6, hz: 3.6, color: 'vermelhoColonial', seg: 8 },
  cyl(0, 4.0, 0, 3.5, 0.06, 'cal', { ...deco, seg: 8 }),
  ball(0, 5.05, 0, 0.22, 'ouro', { ...deco, lod: 'far' }),
  ...[1, -1].flatMap((sz) => [0, 1, 2].map((k) => box(0, 0.15 + k * 0.29, sz * (3.15 + (2 - k) * 0.3), 0.85, 0.15 + k * 0.15, 0.15, 'cantaria'))),
]);
addPrefab({ id: 'canteiro-4', name: 'Canteiro com cerca viva 4 m', category: 'urbano_bh', cover: 'ocultacao', scale: [1, 1], parts: [box(0, 0.15, 0, 2, 0.15, 0.6, 'cantaria'), box(0, 0.55, 0, 1.9, 0.3, 0.5, 'folhaEscura', { solid: 'move' }), ...[-1.2, 0, 1.2].map((x) => ball(x, 0.85, 0, 0.32, 'folha', near))] });
addPrefab({ id: 'canteiro-flores', name: 'Canteiro de flores', category: 'urbano_bh', cover: 'decoracao', alignToGround: true, scale: [0.8, 1.3], parts: [box(0, 0.08, 0, 1.4, 0.08, 1.4, 'cantaria', deco), box(0, 0.2, 0, 1.25, 0.08, 1.25, 'horta', deco), ...[[-0.6, -0.5], [0.4, -0.7], [0.6, 0.5], [-0.4, 0.6], [0, 0]].map(([x, z], i) => ball(x!, 0.32, z!, 0.18, i % 2 ? 'ipeRoxo' : 'fruta1', near))] });
/** Paving of the square's geometric paths (pedra portuguesa: pale with dark bands). */
for (const [id, name, a, b] of [
  ['passeio-4x4', 'Passeio da praça 4×4', 'calcada', 'pedraEscura'],
  ['passeio-onda-4x4', 'Passeio de ondas 4×4', 'plasticoBranco', 'itabirito'],
] as [string, string, KitColor, KitColor][]) {
  addPrefab({ id, name, category: 'rua', cover: 'decoracao', alignToGround: true, scale: [1, 1], parts: [box(0, -0.11, 0, 2.05, 0.14, 2.05, a, deco), ...[-1.3, 0, 1.3].map((z, i) => box(Math.sin(i * 1.7) * 0.4, 0.035, z, 2.0, 0.006, 0.16, b, { ...near, ry: i % 2 ? 18 : -18 }))] });
}

// ------------------------------------------------------------------------------------------------ street tiles

const rua = (id: string, name: string, w: number, d: number, color: KitColor, extra: KitPart[] = []) =>
  addPrefab({ id, name, category: 'rua', cover: 'decoracao', alignToGround: true, scale: [1, 1], parts: [box(0, -0.11, 0, w / 2, 0.14, d / 2, color, deco), ...extra] });
rua('calcamento-3x4', 'Calçamento 3×4', 3.2, 4.2, 'calcamento');
rua('praca-4x4', 'Piso da praça 4×4', 4.1, 4.1, 'calcamento');
rua('terra-3x4', 'Caminho de terra 3×4', 3.0, 4.2, 'terra');
rua('asfalto-4x4', 'Rua de asfalto 4×4', 4.2, 4.2, 'asfalto', [box(0, 0.035, 0, 0.08, 0.006, 1.0, 'plasticoAmarelo', near)]);
rua('calcada-2x4', 'Calçada 2×4', 2.0, 4.1, 'calcada', [box(-0.95, 0.04, 0, 0.08, 0.05, 2.05, 'concreto', near)]);

// Landmark: the Lantern Tower (clock and a great lantern) — the old station's clock tower by the viaduct.
urb('torre-lanterna', 'Torre do relógio da estação', 'alta', [
  box(0, 0.1, 0, 1.55, 0.5, 1.55, 'pedra'),
  box(0, 4.1, 0, 1.2, 3.5, 1.2, 'rebocoAmarelo'),
  box(0, 3.6, 0, 1.24, 0.08, 1.24, 'rodape', deco),
  box(0, 7.45, 0, 1.3, 0.15, 1.3, 'rodape', deco),
  box(0, 7.75, 0, 1.45, 0.15, 1.45, 'pedra'),
  ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => box(sx * 1.15, 8.9, sz * 1.15, 0.15, 1.0, 0.15, 'rodape'))),
  box(0, 8.85, 0, 0.62, 0.72, 0.62, 'lanterna', { anchor: true }),
  box(0, 9.98, 0, 1.45, 0.1, 1.45, 'telha', deco),
  { shape: 'cone', x: 0, y: 10.85, z: 0, hx: 2.0, hy: 0.8, hz: 2.0, color: 'telha', seg: 4, ry: 45 },
  ...[0, 90, 180, 270].flatMap((a) => {
    const s = Math.sin((a * Math.PI) / 180);
    const c = Math.cos((a * Math.PI) / 180);
    return [
      cyl(s * 1.22, 6.1, c * 1.22, 0.62, 0.03, 'relogio', { ...deco, lod: 'far', ...(a % 180 === 0 ? { rx: 90 } : { rz: 90 }), seg: 16 }),
      box(s * 1.27, 6.28, c * 1.27, 0.035, 0.22, 0.012, 'ferro', { ...near, ry: a }),
      box(s * 1.27 + c * 0.13, 6.1, c * 1.27 - s * 0.13, 0.15, 0.03, 0.012, 'ferro', { ...near, ry: a }),
    ];
  }),
]);

// ------------------------------------------------------------------------------------------------ buildings

/** A flat-roofed BH house of w × d with walls in `tone`, plus extras (stairs, tanks, furniture). */
function lajeHouse(id: string, name: string, w: number, d: number, walls: Parameters<typeof shell>[2], gaps: Parameters<typeof roofTerrace>[2], extra: KitPiece[], doors: { x: number; z: number; yaw: number }[]) {
  addBuilding({ id, name, category: 'urbano_bh', halfX: w / 2 + 1.4, halfZ: d / 2 + 0.2, pieces: [...shell(w, d, walls), ...roofTerrace(w, d, gaps), ...extra], doors });
}

// Explorable house with a flat roof: front and back doors, an external stair up the left side (−X) to the laje,
// a water tank, and a parapet gap on the right (+X) where a footbridge can land.
lajeHouse('casa-laje', 'Casa da Laje', 6, 6, {
  front: ['parede-janela-2-rosa', 'parede-porta-2-rosa', 'parede-janela-2-rosa'],
  back: ['parede-2-rosa', 'parede-porta-2-rosa', 'parede-janela-2-rosa'],
  right: ['parede-janela-2-rosa', 'parede-2-rosa', 'parede-janela-2-rosa'],
  left: ['parede-2-rosa', 'parede-2-rosa', 'parede-2-rosa'],
}, { left: [-2], right: [0] }, [
  sideStair(6, 6, -1),
  { prefab: 'caixa-dagua', x: -1.5, y: KIT.roofTop, z: 1.7 },
  { prefab: 'antena', x: 2.2, y: KIT.roofTop, z: -2.2 },
  { prefab: 'caixote', x: -2.1, y: KIT.floorTop, z: -2.0 },
], [{ x: 0, z: 3, yaw: 0 }, { x: 0, z: -3, yaw: 180 }]);

// Corner shop: wide shop front with a counter inside, back door, stair up the right side (+X), footbridge gap on
// the left (−X), crates on the laje.
lajeHouse('mercadinho', 'Mercearia', 6, 6, {
  front: ['parede-vitrine-4-amarelo', 'parede-janela-2-amarelo'],
  back: ['parede-janela-2-amarelo', 'parede-2-amarelo', 'parede-porta-2-amarelo'],
  right: ['parede-2-amarelo', 'parede-2-amarelo', 'parede-2-amarelo'],
  left: ['parede-janela-2-amarelo', 'parede-2-amarelo', 'parede-janela-2-amarelo'],
}, { right: [-2], left: [0] }, [
  sideStair(6, 6, 1),
  { prefab: 'balcao-2', x: -1, y: KIT.floorTop, z: 1.3 },
  { prefab: 'toldo-3', x: -1, y: 2.62, z: 3.12 },
  { prefab: 'placa-loja', x: -1, y: 2.96, z: 3.18 },
  { prefab: 'pilha-caixotes', x: 1.3, y: KIT.roofTop, z: 1.7 },
  { prefab: 'barril', x: 2.2, y: KIT.floorTop, z: -2.2 },
], [{ x: -1, z: 3, yaw: 0 }, { x: 2, z: -3, yaw: 180 }]);

// A small house with doors front and back on one line: a shortcut through the block.
addBuilding({
  id: 'casa-beco',
  name: 'Casa do Beco',
  category: 'urbano_bh',
  halfX: 3.4,
  halfZ: 2.4,
  pieces: [
    ...shell(6, 4, {
      front: ['parede-janela-2-verde', 'parede-porta-2-verde', 'parede-janela-2-verde'],
      back: ['parede-2-verde', 'parede-porta-2-verde', 'parede-2-verde'],
      right: ['parede-2-verde', 'parede-janela-2-verde'],
      left: ['parede-janela-2-verde', 'parede-2-verde'],
    }),
    { prefab: 'telhado-6x4', x: 0, y: KIT.wallTop, z: 0 },
    { prefab: 'caixote', x: 2.0, y: KIT.floorTop, z: -1.0 },
  ],
  doors: [{ x: 0, z: 2, yaw: 0 }, { x: 0, z: -2, yaw: 180 }],
});

// Open workshop (oficina / garagem): a back wall, a windowed right side, a waist-high left side to shoot over, an open
// front.
addBuilding({
  id: 'oficina',
  name: 'Oficina',
  category: 'urbano_bh',
  halfX: 3.4,
  halfZ: 2.4,
  pieces: [
    { prefab: 'fundacao-6x4', x: 0, z: 0 },
    { prefab: 'parede-2-azul', x: -2, z: -2, yaw: 180 },
    { prefab: 'parede-2-azul', x: 0, z: -2, yaw: 180 },
    { prefab: 'parede-2-azul', x: 2, z: -2, yaw: 180 },
    { prefab: 'parede-2-azul', x: 3, z: -1, yaw: 270 },
    { prefab: 'parede-janela-2-azul', x: 3, z: 1, yaw: 270 },
    { prefab: 'muro-baixo-2', x: -3, z: -1, yaw: 90 },
    { prefab: 'muro-baixo-2', x: -3, z: 1, yaw: 90 },
    { prefab: 'pilar-canto', x: -3, z: -2 },
    { prefab: 'pilar-canto', x: 3, z: -2 },
    { prefab: 'pilar-canto', x: -3, z: 2 },
    { prefab: 'pilar-canto', x: 3, z: 2 },
    { prefab: 'telhado-oficina-6x4', x: 0, y: KIT.wallTop, z: 0 },
    { prefab: 'bancada', x: 1.4, y: KIT.floorTop, z: -1.3 },
    { prefab: 'pilha-caixotes', x: 2.1, y: KIT.floorTop, z: 1.0, yaw: 90 },
    { prefab: 'barril', x: -0.6, y: KIT.floorTop, z: -1.4 },
  ],
  doors: [{ x: 0, z: 2, yaw: 0 }],
});

// Corner bar (bar de esquina): steel doors on two street fronts (front and right), a counter, fridges and shelves
// inside, a concrete canopy over the pavement tables, a painted sign; laje on top with a tank.
lajeHouse('bar-esquina', 'Bar da Esquina', 6, 6, {
  front: ['parede-aco-4-laranja', 'parede-janela-2-laranja'],
  back: ['parede-2-laranja', 'parede-porta-2-laranja', 'parede-2-laranja'],
  right: ['parede-2-laranja', 'parede-aco-4-laranja'],
  left: ['parede-2-laranja', 'parede-2-laranja', 'parede-janela-2-laranja'],
}, {}, [
  { prefab: 'marquise-4', x: -1, y: 3.05, z: 3.12 },
  { prefab: 'marquise-4', x: 3.12, y: 3.05, z: 1, yaw: 270 },
  { prefab: 'placa-bar', x: -1, y: 3.37, z: 4.52 },
  { prefab: 'balcao-2', x: 0.6, y: KIT.floorTop, z: -1.2 },
  { prefab: 'geladeira', x: -2.35, y: KIT.floorTop, z: -2.3 },
  { prefab: 'prateleira-bar', x: 1.0, y: KIT.floorTop, z: -2.68 },
  { prefab: 'engradados', x: 2.4, y: KIT.floorTop, z: -2.4 },
  { prefab: 'caixa-dagua', x: 1.3, y: KIT.roofTop, z: -1.5 },
], [{ x: -1, z: 3, yaw: 0 }, { x: 3, z: 1, yaw: 270 }, { x: 0, z: -3, yaw: 180 }]);

// Bakery (padaria): shop window and steel door, striped awning, a long counter with bread, a back door.
lajeHouse('padaria', 'Padaria', 6, 6, {
  front: ['parede-janela-2-azul', 'parede-aco-4-azul'],
  back: ['parede-porta-2-azul', 'parede-2-azul', 'parede-2-azul'],
  right: ['parede-2-azul', 'parede-janela-2-azul', 'parede-2-azul'],
  left: ['parede-2-azul', 'parede-2-azul', 'parede-2-azul'],
}, {}, [
  { prefab: 'toldo-listrado-4', x: 1, y: 3.0, z: 3.12 },
  { prefab: 'placa-padaria', x: 1, y: 3.5, z: 3.2 },
  { prefab: 'balcao-paes', x: 0.4, y: KIT.floorTop, z: 0.4 },
  { prefab: 'prateleira-bar', x: 0.6, y: KIT.floorTop, z: -2.68 },
  { prefab: 'caixa-dagua', x: -1.2, y: KIT.roofTop, z: 1.4 },
  { prefab: 'antena', x: 2, y: KIT.roofTop, z: -2 },
], [{ x: 1, z: 3, yaw: 0 }, { x: -2, z: -3, yaw: 180 }]);

// House with a garage (casa com garagem), for rows of semi-detached houses: garage gate and door on the street, a
// fibre-cement roof over a back room... kept simple: laje with a tank, gate open.
for (const [tone, i] of [['-verde', 1], ['-lilas', 2], ['-rosa', 3]] as const) {
  lajeHouse(`casa-garagem-${i}`, `Casa com garagem ${i}`, 6, 6, {
    front: [`parede-portao-4${tone}`, `parede-porta-2${tone}`],
    back: [`parede-2${tone}`, `parede-janela-2${tone}`, `parede-2${tone}`],
    right: [`parede-2${tone}`, `parede-janela-2${tone}`, `parede-2${tone}`],
    left: [`parede-2${tone}`, `parede-2${tone}`, `parede-2${tone}`],
  }, {}, [
    { prefab: 'caixa-dagua', x: 1.4, y: KIT.roofTop, z: -1.4 },
    ...(i === 2 ? [{ prefab: 'antena', x: -2, y: KIT.roofTop, z: 1.8 }] : []),
    { prefab: i === 1 ? 'bicicleta' : 'carrinho', x: -1.2, y: KIT.floorTop, z: 0.4, yaw: i === 1 ? 90 : 20 },
  ], [{ x: -1, z: 3, yaw: 0 }, { x: 2, z: 3, yaw: 0 }]);
}

// Mercado do Horizonte: a covered market hall 12 × 10 on concrete pillars, waist-high walls between them with three
// entrances, a laje roof reached by a stair at the back, rows of stalls inside (fruit, cheese, bread, coffee,
// sweets). Interiors, corridors between the stalls, an upper level over the square.
urb('pilar-mercado', 'Pilar do mercado', 'alta', [box(0, 2.05, 0, 0.22, 2.05, 0.22, 'concreto'), box(0, 3.95, 0, 0.3, 0.12, 0.3, 'concretoEscuro', near)]);
urb('mureta-mercado-2', 'Mureta do mercado 2 m', 'baixa', [box(0, 0.6, 0, 1, 0.6, 0.12, 'rebocoVerde'), box(0, 1.23, 0, 1.03, 0.03, 0.15, 'cantaria', near)], { length: 2 });
urb('mureta-mercado-3', 'Mureta do mercado 3,3 m', 'baixa', [box(0, 0.6, 0, 1.65, 0.6, 0.12, 'rebocoVerde'), box(0, 1.23, 0, 1.68, 0.03, 0.15, 'cantaria', near)], { length: 3.3 });
urb('escada-mercado', 'Escada do mercado', 'passagem', stair(-1, { rise: 4.44, run: 6.0, steps: 20, landing: 1.0, color: 'concreto', railColor: 'ferro' }));
urb('laje-mercado', 'Cobertura do mercado 12×10', 'passagem', [
  box(0, -0.12, 0, 6.3, 0.12, 5.3, 'concreto'),
  box(0, -0.35, 0, 6.35, 0.1, 5.35, 'verdeColonial', deco),
  // Clerestory band (lanternim) over the middle aisle: a raised strip to hide behind on the roof.
  box(0, 0.45, 0, 4.0, 0.45, 0.9, 'rebocoVerde'),
  box(0, 0.93, 0, 4.1, 0.05, 1.0, 'telha', deco),
]);
{
  const pieces: KitPiece[] = [{ prefab: 'fundacao-12x10', x: 0, z: 0 }];
  const H = 4.2;
  for (const x of [-6, -3, 0, 3, 6]) for (const z of [-5, 5]) pieces.push({ prefab: 'pilar-mercado', x, z });
  for (const z of [-1.7, 1.7]) for (const x of [-6, 6]) pieces.push({ prefab: 'pilar-mercado', x, z });
  // Waist-high walls: front (+Z) open at x = ±1.5 (entrance in the middle), back open at the stair, sides open at z = 0.
  const front = [-5, -3, 3, 5];
  for (const x of front) pieces.push({ prefab: 'mureta-mercado-2', x, z: 5, yaw: 0 });
  for (const x of [-5, -1, 1, 3]) pieces.push({ prefab: 'mureta-mercado-2', x, z: -5, yaw: 180 });
  for (const z of [-3.35, 3.35]) {
    pieces.push({ prefab: 'mureta-mercado-3', x: 6, z, yaw: 270 });
    pieces.push({ prefab: 'mureta-mercado-3', x: -6, z, yaw: 90 });
  }
  pieces.push({ prefab: 'laje-mercado', x: 0, y: H + 0.24, z: 0 });
  pieces.push({ prefab: 'placa-mercado', x: 0, y: H - 0.15, z: 5.38 });
  // Stalls: two rows facing the middle aisle.
  pieces.push({ prefab: 'banca-frutas', x: -3.6, y: KIT.floorTop, z: 2.3, yaw: 180 });
  pieces.push({ prefab: 'banca-queijos', x: 0, y: KIT.floorTop, z: 2.3, yaw: 180 });
  pieces.push({ prefab: 'banca-paes', x: 3.6, y: KIT.floorTop, z: 2.3, yaw: 180 });
  pieces.push({ prefab: 'banca-cafe', x: -3.6, y: KIT.floorTop, z: -2.3 });
  pieces.push({ prefab: 'banca-doces', x: 0, y: KIT.floorTop, z: -2.3 });
  pieces.push({ prefab: 'pilha-sacos-cafe', x: 3.8, y: KIT.floorTop, z: -2.6 });
  // Back stair to the roof (rising toward +X along the back wall, outside).
  pieces.push({ prefab: 'escada-mercado', x: 2.6, z: -6.1, yaw: 90 });
  addBuilding({ id: 'mercado', name: 'Mercado do Horizonte', category: 'urbano_bh', halfX: 6.4, halfZ: 6.8, pieces, doors: [{ x: 0, z: 5, yaw: 0 }, { x: 6, z: 0, yaw: 270 }, { x: -6, z: 0, yaw: 90 }] });
}

urb('patamar-viaduto', 'Patamar da escada lateral', 'passagem', [
  box(0, KIT.roofTop / 2 - 0.4, 0, 0.85, KIT.roofTop / 2 + 0.4, 1.0, 'concreto'),
  box(0.81, KIT.roofTop + 0.5, 0, 0.04, 0.5, 1.0, 'ferro', { solid: 'move' }),
  box(0, KIT.roofTop + 0.5, -0.96, 0.85, 0.5, 0.04, 'ferro', { solid: 'move' }),
]);

// Viaduto dos Arcos as one rigid building (24 m stays within 3 cm of the curvature of a 100 m planet): deck, two
// arches, the two end stairs continuing the street, the side stair down to the railway.
addBuilding({
  id: 'viaduto',
  name: 'Viaduto dos Arcos',
  category: 'urbano_bh',
  halfX: 4.5,
  halfZ: VIA.len / 2 + KIT.stair.run + 0.4,
  pieces: [
    { prefab: 'viaduto-tabuleiro', x: 0, z: 0 },
    { prefab: 'viaduto-arco', x: -(VIA.w / 2 - 0.25), z: 0 },
    { prefab: 'viaduto-arco', x: VIA.w / 2 - 0.25, z: 0 },
    // End stairs: the north one rises toward −Z onto the deck, the south one toward +Z.
    { prefab: 'escada-viaduto', x: 0, z: VIA.len / 2 + KIT.stair.run - KIT.stair.run / KIT.stair.steps + 0.02, yaw: 180 },
    { prefab: 'escada-viaduto', x: 0, z: -(VIA.len / 2 + KIT.stair.run - KIT.stair.run / KIT.stair.steps + 0.02), yaw: 0 },
    // Side stair from the deck's +X gap down to the tracks, along the deck (rising toward −Z... from the ground at
    // z = +4.8 up to the deck edge at z = 0).
    { prefab: 'escada-viaduto-lateral', x: VIA.w / 2 + 0.85, z: KIT.stair.run - KIT.stair.run / KIT.stair.steps + 0.95, yaw: 180 },
    { prefab: 'patamar-viaduto', x: VIA.w / 2 + 0.85, z: 0 },
  ],
});
