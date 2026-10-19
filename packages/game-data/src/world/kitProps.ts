/**
 * PROPS_BRASILEIROS: the small things that tell the map's stories — market stalls with fruit, cheese, bread, coffee
 * and sweets (the Mercado), the corner bar's fridge and shelves, coffee sacks, clay pots and pans, vegetable beds.
 * Each one belongs to a place (docs/world/MG_ARCHITECTURE_KITS.md); none is scattered at random.
 */
import { addPrefab, ball, box, crate, cyl, deco, near, type KitColor, type KitCover, type KitPart } from './kitCore';

const prop = (id: string, name: string, cover: KitCover, parts: KitPart[], scale: [number, number] = [1, 1]) => addPrefab({ id, name, category: 'props', cover, parts, scale });

/** Market stall: a counter (low cover), a back board and a canvas roof on posts; `goods` sit on the counter. */
function stall(canvas: KitColor, goods: KitPart[]): KitPart[] {
  return [
    box(0, 0.48, 0.25, 1.35, 0.48, 0.4, 'madeira'),
    box(0, 0.98, 0.25, 1.4, 0.03, 0.45, 'madeiraClara', deco),
    ...[-1.32, 1.32].map((x) => cyl(x, 1.25, -0.45, 0.05, 1.25, 'madeira', { seg: 6 })),
    ...[-1.32, 1.32].map((x) => cyl(x, 1.1, 0.6, 0.04, 1.1, 'madeira', { ...near, seg: 6 })),
    box(0, 2.42, 0.08, 1.45, 0.04, 0.68, canvas, { ...deco, rx: -8 }),
    box(0, 2.28, 0.74, 1.45, 0.1, 0.02, canvas, near),
    box(0, 1.6, -0.47, 1.3, 0.55, 0.03, 'madeiraClara', { solid: 'move' }),
    ...goods,
  ];
}
const pile = (x: number, z: number, color: KitColor, n = 3, r = 0.11): KitPart[] =>
  Array.from({ length: n }, (_, i) => ball(x + (i - (n - 1) / 2) * r * 1.6, 1.08 + (i % 2) * 0.06, z + ((i * 37) % 3 - 1) * 0.05, r, color, near));

prop('banca-frutas', 'Banca de frutas', 'baixa', stall('lonaVerde', [
  ...crate(-0.85, 1.0, 0.3, 0.22, 4, 'none'),
  ...crate(0, 1.0, 0.3, 0.22, -3, 'none'),
  ...crate(0.85, 1.0, 0.3, 0.22, 6, 'none'),
  ...pile(-0.85, 0.3, 'fruta1', 3).map((p) => ({ ...p, y: p.y + 0.45 })),
  ...pile(0, 0.3, 'fruta2', 3).map((p) => ({ ...p, y: p.y + 0.45 })),
  ...pile(0.85, 0.3, 'fruta3', 3).map((p) => ({ ...p, y: p.y + 0.45 })),
]));
prop('banca-queijos', 'Banca de queijos', 'baixa', stall('lonaAzul', [
  ...[-0.9, -0.3, 0.3, 0.9].map((x, i) => cyl(x, 1.1, 0.25 + (i % 2) * 0.12, 0.2, 0.09, 'queijo', { ...near, seg: 12 })),
  ...[-0.6, 0, 0.6].map((x) => cyl(x, 1.29, 0.3, 0.16, 0.08, 'queijo', { ...near, seg: 12 })),
  // Cheeses hanging from the canvas frame.
  ...[-0.8, 0, 0.8].map((x) => ball(x, 1.95, -0.3, 0.13, 'queijo', near)),
]));
prop('banca-paes', 'Banca de pães', 'baixa', stall('lona', [
  ...[-0.9, -0.45, 0, 0.45, 0.9].map((x, i) => ball(x, 1.08, 0.2 + (i % 2) * 0.15, 0.12, 'pao', near)),
  box(0, 1.08, 0.45, 1.0, 0.07, 0.12, 'madeiraClara', near),
  ...[-0.7, 0, 0.7].map((x) => ball(x, 1.2, 0.45, 0.09, 'pao', near)),
]));
prop('banca-cafe', 'Banca de café', 'baixa', stall('lonaVermelha', [
  ...[-0.85, 0, 0.85].map((x) => cyl(x, 1.17, 0.25, 0.2, 0.17, 'saco', { ...near, seg: 8 })),
  ...[-0.85, 0, 0.85].map((x) => cyl(x, 1.35, 0.25, 0.17, 0.02, 'cafe', { ...near, seg: 8 })),
  cyl(1.1, 1.13, 0.55, 0.08, 0.12, 'ferro', { ...near, seg: 8 }),
]));
prop('banca-doces', 'Banca de doces', 'baixa', stall('ipeRoxo', [
  // Jars of doce de leite, goiabada bars and cocadas.
  ...[-1.0, -0.6, -0.2, 0.2].map((x) => cyl(x, 1.12, 0.3, 0.1, 0.13, 'doce', { ...near, seg: 8 })),
  ...[-1.0, -0.6, -0.2, 0.2].map((x) => cyl(x, 1.27, 0.3, 0.1, 0.02, 'cal', { ...near, seg: 8 })),
  box(0.75, 1.06, 0.3, 0.3, 0.05, 0.15, 'vermelhoColonial', near),
  box(0.75, 1.16, 0.3, 0.25, 0.04, 0.12, 'cal', near),
]));
prop('pilha-sacos-cafe', 'Pilha de sacos de café', 'alta', [
  ...[-0.45, 0.45].map((x) => box(x, 0.28, 0, 0.42, 0.28, 0.3, 'saco')),
  ...[-0.45, 0.45].map((x) => box(x, 0.84, 0, 0.42, 0.28, 0.3, 'saco')),
  box(0, 1.38, 0, 0.42, 0.26, 0.3, 'saco'),
  ...[-0.45, 0.45].map((x) => box(x, 0.84, 0.31, 0.2, 0.12, 0.005, 'cafe', near)),
]);
prop('geladeira', 'Geladeira do bar', 'alta', [box(0, 0.95, 0, 0.4, 0.95, 0.35, 'plasticoBranco'), box(0, 1.2, 0.36, 0.33, 0.6, 0.01, 'vidro', near), box(0.3, 0.9, 0.37, 0.02, 0.15, 0.02, 'metal', near)]);
prop('prateleira-bar', 'Prateleira com garrafas', 'decoracao', [
  box(0, 1.1, 0, 1.2, 1.1, 0.16, 'madeira', { solid: 'move' }),
  ...[0.75, 1.3, 1.85].flatMap((y) => [-0.9, -0.55, -0.2, 0.15, 0.5, 0.85].map((x, i) => cyl(x, y + 0.13, 0.05, 0.05, 0.13, (['cafe', 'verdeColonial', 'amareloOcre'] as KitColor[])[i % 3]!, { ...near, seg: 6 }))),
]);
/** A narrower shelf, for a back wall shared with a door (its open leaf stands beside it). */
prop('prateleira-curta', 'Prateleira curta com garrafas', 'decoracao', [
  box(0, 1.1, 0, 0.8, 1.1, 0.16, 'madeira', { solid: 'move' }),
  ...[0.75, 1.3, 1.85].flatMap((y) => [-0.6, -0.3, 0, 0.3, 0.6].map((x, i) => cyl(x, y + 0.13, 0.05, 0.05, 0.13, (['cafe', 'verdeColonial', 'amareloOcre'] as KitColor[])[i % 3]!, { ...near, seg: 6 }))),
]);
prop('balcao-paes', 'Balcão de pães', 'baixa', [
  box(0, 0.5, 0, 1.6, 0.5, 0.4, 'madeira'),
  box(0, 1.1, 0.05, 1.6, 0.1, 0.35, 'vidro', deco),
  ...[-1.1, -0.5, 0.1, 0.7, 1.2].map((x) => ball(x, 1.05, 0.05, 0.12, 'pao', near)),
]);
prop('panelas', 'Panelas e fogareiro', 'decoracao', [
  box(0, 0.35, 0, 0.45, 0.35, 0.3, 'pedraEscura'),
  cyl(-0.18, 0.82, 0, 0.17, 0.12, 'ferro', { ...near, seg: 10 }),
  cyl(0.2, 0.8, 0, 0.14, 0.1, 'cafe', { ...near, seg: 10 }),
  ...[-0.3, 0, 0.3].map((x) => cyl(x, 0.06, 0.45, 0.12, 0.06, 'terraVermelha', { ...near, seg: 8 })),
]);
prop('potes-barro', 'Potes de barro', 'decoracao', [
  ball(0, 0.32, 0, 0.32, 'terraVermelha'),
  ball(0.55, 0.22, 0.2, 0.22, 'terraVermelha', near),
  ball(-0.45, 0.2, 0.25, 0.2, 'telhaColonial', near),
  cyl(0, 0.66, 0, 0.13, 0.05, 'terraVermelha', { ...deco, seg: 8 }),
], [0.8, 1.2]);
prop('lata-flores', 'Latas de flores', 'decoracao', [
  ...[-0.35, 0, 0.35].map((x, i) => cyl(x, 0.17, 0, 0.13, 0.17, i === 1 ? 'aco' : 'vermelhoColonial', { ...deco, seg: 8 })),
  ...[-0.35, 0, 0.35].map((x, i) => ball(x, 0.42, 0, 0.17, i === 1 ? 'ipeRoxo' : 'folha', near)),
]);
prop('horta', 'Canteiro de horta', 'decoracao', [
  box(0, 0.12, 0, 1.6, 0.12, 0.55, 'terra', deco),
  ...[-1.2, -0.6, 0, 0.6, 1.2].flatMap((x, i) => [ball(x, 0.32, -0.25, 0.15, i % 2 ? 'horta' : 'folhaEscura', near), ball(x + 0.3, 0.3, 0.2, 0.13, 'horta', near)]),
  ...[-0.9, 0.9].map((x) => ball(x, 0.3, 0.42, 0.12, 'tomate', near)),
  ball(0.2, 0.28, 0.4, 0.16, 'abobora', near),
], [0.9, 1.1]);
prop('galinheiro', 'Galinheiro', 'baixa', [
  box(0, 0.6, 0, 0.9, 0.6, 0.6, 'madeiraClara', { solid: 'move' }),
  { shape: 'gable', x: 0, y: 1.2, z: 0, hx: 0.95, hy: 0.45, hz: 0.7, color: 'telhaColonial' },
  ...[-0.6, 0, 0.6].map((x) => box(x, 0.6, 0.61, 0.02, 0.55, 0.01, 'madeira', near)),
  ball(0.3, 0.12, 0.9, 0.12, 'cal', near),
  ball(-0.4, 0.12, 1.1, 0.12, 'amareloOcre', near),
]);
prop('lenha', 'Pilha de lenha', 'baixa', [
  ...[0, 1, 2].flatMap((row) => [-0.45, 0, 0.45].map((x) => cyl(x + (row % 2) * 0.22, 0.13 + row * 0.24, 0, 0.12, 0.6, 'madeira', { seg: 7, rx: 90, solid: row === 0 && x === 0 ? 'full' : 'none' }))),
  box(0, 0.36, 0, 0.7, 0.36, 0.6, 'madeira', { visible: false }),
]);
prop('caixote-frutas', 'Caixote de frutas', 'destrutivel', [...crate(0, 0, 0, 0.3, 0, 'full'), ...pile(0, 0, 'fruta1', 3, 0.1).map((p) => ({ ...p, y: p.y - 0.4 }))]);
