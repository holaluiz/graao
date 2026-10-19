/**
 * MODERNISTA kit: Lago Espelho, after the modernist lakeside of Belo Horizonte (Pampulha): free curves, thin
 * columns (pilotis), long canopies, ramps, brise-soleil fins, blue-and-white tile panels and organic gardens
 * (docs/world/MG_ARCHITECTURE_KITS.md). Original pieces in that language — no building or artwork is copied.
 */
import { KIT, addBuilding, addPrefab, ball, box, chordXY, cyl, deco, near, slope, span, type KitColor, type KitCover, type KitPart } from './kitCore';

const mod = (id: string, name: string, cover: KitCover, parts: KitPart[], o: { water?: boolean; scale?: [number, number]; alignToGround?: boolean } = {}) =>
  addPrefab({ id, name, category: 'modernista', cover, parts, scale: o.scale ?? [1, 1], ...(o.water ? { material: 'water' as const } : {}), ...(o.alignToGround ? { alignToGround: true } : {}) });

const DEG = Math.PI / 180;

/** Boxes along a polyline in plan (x, z), each `hw` wide (half), from y0 to y1: curved walls and canopies. */
function along(points: [number, number][], hw: number, y0: number, y1: number, color: KitColor, o: Partial<KitPart> = {}): KitPart[] {
  const out: KitPart[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, z0] = points[i]!;
    const [x1, z1] = points[i + 1]!;
    const len = Math.hypot(x1 - x0, z1 - z0);
    // Each box is a little longer than its chord so neighbours overlap at the joints (no gaps on the curve).
    out.push(box((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, hw, (y1 - y0) / 2, len / 2 + hw * 0.6, color, { ry: (Math.atan2(x1 - x0, z1 - z0) / DEG), ...o }));
  }
  return out;
}
/** Points on a circular arc in plan: centre (cx, cz), radius r, from angle a0 to a1 (degrees, 0 = +Z, clockwise). */
const arc = (cx: number, cz: number, r: number, a0: number, a1: number, n: number): [number, number][] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = (a0 + ((a1 - a0) * i) / n) * DEG;
    return [cx + Math.sin(a) * r, cz + Math.cos(a) * r] as [number, number];
  });

// ------------------------------------------------------------------------------------------------ lakeside pavilion

/**
 * Pavilhão do Lago: a round platform (9.6 m) under a thin round roof on slender columns, half closed by a curved
 * wall clad in blue tiles (cover with two openings), a bar counter inside, and a canopy that snakes from it toward the
 * water on its own columns (a covered walk ending at the deck). Platform 0.3 m (one step).
 */
const PAV = { r: 4.8, roof: 3.6 };
mod('pavilhao-piso', 'Pavilhão: plataforma', 'passagem', [
  cyl(0, -0.3, 0, PAV.r, 0.6, 'brancoModerno', { seg: 20 }),
  cyl(0, 0.302, 0, PAV.r - 0.15, 0.004, 'pastilha', { ...deco, seg: 20 }),
]);
mod('pavilhao-parede', 'Pavilhão: parede curva de azulejos', 'alta', [
  // Curved wall from 120° to 330° (clockwise from +Z), with two door gaps.
  ...along(arc(0, 0, PAV.r - 0.6, 125, 185, 4), 0.14, 0.3, 3.3, 'brancoModerno'),
  ...along(arc(0, 0, PAV.r - 0.6, 200, 270, 5), 0.14, 0.3, 3.3, 'brancoModerno'),
  ...along(arc(0, 0, PAV.r - 0.6, 285, 330, 3), 0.14, 0.3, 3.3, 'brancoModerno'),
  // Blue tile cladding on the outer face (a band of panels: original pattern of squares and waves).
  ...along(arc(0, 0, PAV.r - 0.43, 125, 185, 4), 0.02, 0.4, 3.0, 'azulejo', deco),
  ...along(arc(0, 0, PAV.r - 0.43, 200, 270, 5), 0.02, 0.4, 3.0, 'azulejo', deco),
  ...along(arc(0, 0, PAV.r - 0.43, 285, 330, 3), 0.02, 0.4, 3.0, 'azulejo', deco),
  ...along(arc(0, 0, PAV.r - 0.41, 128, 182, 4), 0.012, 1.2, 1.5, 'azulejoClaro', near),
  ...along(arc(0, 0, PAV.r - 0.41, 203, 267, 5), 0.012, 2.0, 2.3, 'azulejoClaro', near),
  ...along(arc(0, 0, PAV.r - 0.41, 288, 327, 3), 0.012, 1.4, 1.7, 'azulejoClaro', near),
  // Bar counter (curved) inside.
  ...along(arc(0, 0, 2.2, 200, 290, 4), 0.3, 0.3, 1.3, 'pastilha'),
]);
mod('pavilhao-cobertura', 'Pavilhão: laje redonda e colunas', 'estrutura', [
  cyl(0, PAV.roof, 0, PAV.r + 0.4, 0.14, 'brancoModerno', { seg: 20 }),
  cyl(0, PAV.roof + 0.16, 0, PAV.r + 0.25, 0.03, 'concreto', { ...deco, seg: 20 }),
  ...Array.from({ length: 8 }, (_, i) => {
    const a = ((i + 0.5) / 8) * Math.PI * 2;
    return cyl(Math.sin(a) * (PAV.r - 0.35), (PAV.roof + 0.3) / 2, Math.cos(a) * (PAV.r - 0.35), 0.11, (PAV.roof - 0.3) / 2, 'brancoModerno', { seg: 8 });
  }),
]);
/** The snaking canopy (marquise sinuosa): an S-curve 2.6 m wide at 3.0 m on slender columns, about 16 m long. */
// Placed on its own (origin at its middle, so the 16 m curve follows the planet within a few cm): it starts at the
// pavilion's edge (local z = −8) and ends over the deck (z = +8). Columns reach 2.5 m into the ground for slopes.
const CANOPY: [number, number][] = [[0, -7.9], [0.6, -5.7], [2.0, -3.7], [3.8, -2.1], [4.8, 0], [4.6, 2.3], [3.4, 4.3], [1.8, 5.9], [0.8, 7.9]];
mod('marquise-sinuosa', 'Marquise sinuosa', 'estrutura', [
  ...along(CANOPY, 1.3, 2.86, 3.06, 'brancoModerno'),
  ...along(CANOPY, 1.32, 2.8, 2.86, 'concreto', deco),
  ...CANOPY.filter((_, i) => i % 2 === 1).map(([x, z]) => cyl(x, 0.18, z, 0.09, 2.68, 'brancoModerno', { seg: 8 })),
]);
mod('deck-pavilhao', 'Deck do pavilhão', 'passagem', [box(0, -0.1, 0, 2.6, 0.12, 2.2, 'deck'), ...[-2.4, 2.4].flatMap((x) => [-1.9, 1.9].map((z) => cyl(x, -1.6, z, 0.12, 1.5, 'madeiraEscura', { seg: 6 }))), ...[-1.8, -0.6, 0.6, 1.8].map((x) => box(x, 0.025, 0, 0.02, 0.005, 2.2, 'madeiraEscura', near))]);
addBuilding({
  id: 'pavilhao-lago',
  name: 'Pavilhão do Lago',
  category: 'modernista',
  halfX: 5.3,
  halfZ: 5.3,
  settle: 'center',
  pieces: [
    { prefab: 'pavilhao-piso', x: 0, z: 0 },
    { prefab: 'pavilhao-parede', x: 0, z: 0 },
    { prefab: 'pavilhao-cobertura', x: 0, z: 0 },
  ],
  notes: 'Baú: atrás do balcão curvo (coberto). A marquise sinuosa (peça à parte) sai da frente para o deck na água.',
});

// ------------------------------------------------------------------------------------------------ pilotis block with a ramp

/**
 * Bloco sobre pilotis: an upper volume 9 × 5 raised on six columns (the ground under it stays open: cover between the
 * columns), a long ramp with low parapets up to it, brise-soleil fins on the long front (shots pass between the
 * fins), a closed back and ends, a roof terrace edge. The upper floor is at the laje height (3.35 m).
 */
const PIL = { w: 9, d: 5, floor: KIT.roofTop, h: 3.0 };
mod('pilotis-volume', 'Bloco sobre pilotis: volume', 'alta', (() => {
  const { w, d, floor, h } = PIL;
  const hw = w / 2;
  const hd = d / 2;
  const P: KitPart[] = [
    // Columns.
    ...[-3.5, 0, 3.5].flatMap((x) => [-1.6, 1.6].map((z) => cyl(x, floor / 2 - 0.1, z, 0.2, floor / 2 - 0.1, 'brancoModerno', { seg: 10 }))),
    // Floor slab, roof slab.
    span(-hw, floor - 0.3, -hd, hw, floor, hd, 'brancoModerno'),
    span(-hw - 0.2, floor + h, -hd - 0.2, hw + 0.2, floor + h + 0.3, hd + 0.2, 'brancoModerno'),
    // Closed back wall and ends; the ramp enters at the left end (−X) through a door.
    span(-hw, floor, -hd, hw, floor + h, -hd + 0.2, 'pastilha'),
    span(hw - 0.2, floor, -hd, hw, floor + h, hd, 'brancoModerno'),
    span(-hw, floor, -hd, -hw + 0.2, floor + h, -0.5, 'brancoModerno'),
    span(-hw, floor, 0.9, -hw + 0.2, floor + h, hd, 'brancoModerno'),
    span(-hw, floor + 2.4, -0.5, -hw + 0.2, floor + h, 0.9, 'brancoModerno'),
    // Front: a waist-high sill and vertical fins (brise-soleil).
    span(-hw, floor, hd - 0.2, hw, floor + 0.9, hd, 'brancoModerno'),
    ...Array.from({ length: 15 }, (_, i) => box(-hw + 0.45 + i * 0.58, floor + 0.9 + (h - 0.9) / 2, hd - 0.1, 0.06, (h - 0.9) / 2, 0.32, 'brancoModerno')),
    // Ceiling band, azulejo panel on the closed end.
    box(hw + 0.01, floor + h / 2, 0, 0.012, h / 2 - 0.2, hd - 0.4, 'azulejo', deco),
    box(hw + 0.02, floor + h / 2 + 0.3, 0.6, 0.012, 0.5, 0.9, 'azulejoClaro', near),
  ];
  return P;
})());
mod('rampa-pilotis', 'Rampa com guarda-corpo', 'passagem', [
  // Ramp rising toward +Z from the ground to the upper floor (20°), on a central wall; it runs on 3.2 m into the ground
  // past its foot, so it meets the garden as a slope wherever the ground under the block falls away.
  slope(0, 0.95, -3.2, (-3.2 * PIL.floor) / 9.2, 9.2, PIL.floor, 0.3, 'brancoModerno'),
  ...[-1, 1].map((sx) => slope(sx * 1.02, 0.08, 0, 0.9, 9.2, PIL.floor + 0.9, 0.9, 'brancoModerno')),
  // Support wall under the ramp, up to its underside.
  span(-0.3, -0.5, 6.2, 0.3, (6.2 * PIL.floor) / 9.2 - 0.35, 6.8, 'brancoModerno'),
  span(-0.95, PIL.floor - 0.3, 9.1, 0.95, PIL.floor, 10.4, 'brancoModerno'),
  ...[-1, 1].map((sx) => span(sx * 0.95, PIL.floor, 9.1, sx * 1.1, PIL.floor + 0.9, 10.4, 'brancoModerno')),
]);
addBuilding({
  id: 'bloco-pilotis',
  name: 'Bloco sobre pilotis',
  category: 'modernista',
  halfX: 10.2,
  halfZ: 3.0,
  pieces: [
    { prefab: 'pilotis-volume', x: 5, z: 0 },
    // The ramp runs along the building's axis, rising toward +X, and lands at the left end door (x = 0.5).
    { prefab: 'rampa-pilotis', x: -10, z: 0.2, yaw: 270 },
    { prefab: 'banco-curvo', x: 6.5, z: -0.2, yaw: 90 },
  ],
  notes: 'Baú: no salão de cima (coberto). Embaixo, entre os pilotis: cobertura baixa.',
});

// ------------------------------------------------------------------------------------------------ water edge

/** Deck on stilts (absolute height above the water: the map sets the lift), 5.2 × 4.4. */
mod('deck-madeira', 'Deck de madeira', 'passagem', [
  box(0, -0.1, 0, 2.6, 0.12, 2.2, 'deck'),
  ...[-2.4, 0, 2.4].flatMap((x) => [-2.0, 2.0].map((z) => cyl(x, -3.0, z, 0.13, 2.9, 'madeiraEscura', { seg: 6 }))),
  ...[-1.8, -0.6, 0.6, 1.8].map((x) => box(x, 0.025, 0, 0.02, 0.005, 2.2, 'madeiraEscura', near)),
  // Railing on the water side (+Z), the back left open.
  box(0, 0.5, 2.15, 2.6, 0.5, 0.04, 'madeiraEscura', { solid: 'move', visible: false }),
  box(0, 1.0, 2.15, 2.6, 0.04, 0.05, 'madeiraEscura', near),
  ...[-2.5, -1.25, 0, 1.25, 2.5].map((x) => box(x, 0.5, 2.15, 0.04, 0.5, 0.04, 'madeiraEscura', near)),
]);
/**
 * Footbridges over the water along Z, 1.8 m wide, railings (movement only) and stilts every ≈ 4 m. Each end runs on
 * as a gentle ramp 0.6 m down into the bank, so a shore a little under the deck is a slope, not a ledge.
 */
function lakeFootbridge(len: number): KitPart[] {
  const h = len / 2;
  const posts = Math.max(2, Math.round(len / 3.8) + 1);
  return [
    box(0, -0.1, 0, 0.9, 0.12, h, 'deck'),
    slope(0, 0.9, -h - 2.0, -0.6, -h + 0.1, 0, 0.24, 'deck'),
    slope(0, 0.9, h - 0.1, 0, h + 2.0, -0.6, 0.24, 'deck'),
    ...[-1, 1].flatMap((sx) => [
      box(sx * 0.88, 0.5, 0, 0.03, 0.5, h, 'brancoModerno', { solid: 'move', visible: false }),
      box(sx * 0.88, 1.0, 0, 0.04, 0.04, h, 'brancoModerno', near),
      ...Array.from({ length: posts }, (_, i) => box(sx * 0.88, 0.5, -h + 0.1 + (i * (len - 0.2)) / (posts - 1), 0.03, 0.5, 0.03, 'brancoModerno', near)),
    ]),
    ...Array.from({ length: posts }, (_, i) => -h + 0.3 + (i * (len - 0.6)) / (posts - 1)).flatMap((z) => [-0.75, 0.75].map((x) => cyl(x, -3.0, z, 0.1, 2.9, 'brancoModerno', { seg: 6 }))),
  ];
}
mod('passarela-lago', 'Passarela sobre o lago 8 m', 'passagem', lakeFootbridge(8.2));
/** The long footbridge from the north shore to the island (one rigid piece: on a 100 m planet it rises 0.35 m at the ends). */
mod('passarela-ilha', 'Passarela da ilha 17 m', 'passagem', lakeFootbridge(16.8));
/** Blue-and-white tile panel on a white frame (freestanding cover, 4 × 2.6 m); original pattern. */
mod('painel-azulejo', 'Painel de azulejos', 'alta', [
  box(0, 1.4, 0, 2.1, 1.4, 0.15, 'brancoModerno'),
  ...[-1, 1].flatMap((sz) => [
    box(0, 1.45, sz * 0.16, 1.9, 1.2, 0.01, 'azulejoClaro', deco),
    ...Array.from({ length: 6 }, (_, i) => box(-1.6 + i * 0.64, 1.45 + Math.sin(i * 1.3) * 0.45, sz * 0.172, 0.24, 0.24, 0.006, 'azulejo', { ...deco, rz: 45 })),
    box(0, 0.6, sz * 0.172, 1.9, 0.12, 0.006, 'azulejo', near),
    box(0, 2.3, sz * 0.172, 1.9, 0.08, 0.006, 'azulejo', near),
  ]),
]);
/** Curved concrete bench (low cover). */
mod('banco-curvo', 'Banco curvo', 'baixa', along(arc(0, -2.2, 2.2, -40, 40, 4), 0.25, 0, 0.48, 'brancoModerno'));
/** Organic garden bed (Burle Marx-inspired kidney shape): low hedges that stop people, colour patches. */
mod('jardim-curvo', 'Jardim de curvas', 'ocultacao', [
  ...along([[-3, 0], [-2, 1.4], [0, 1.8], [2, 1.0], [3, -0.4], [2.2, -1.6], [0.4, -1.2], [-1.4, -1.6], [-3, 0]], 0.35, 0, 0.7, 'folhaEscura', { solid: 'move' }),
  ...[[-1.6, 0.2, 'ipeRoxo'], [0, 0.4, 'ipeAmarelo'], [1.5, -0.1, 'fruta2'], [0.6, 0.9, 'folha'], [-0.8, -0.6, 'ipeAmarelo']].map(([x, z, c]) => ball(x as number, 0.35, z as number, 0.45, c as KitColor, near)),
], { scale: [0.8, 1.2] });
/** Reflecting pool (espelho-d'água): a low rim and a water plane. */
mod('espelho-dagua-borda', "Espelho-d'água: borda", 'decoracao', [span(-4, 0, -2.2, 4, 0.3, -1.9, 'brancoModerno', deco), span(-4, 0, 1.9, 4, 0.3, 2.2, 'brancoModerno', deco), span(-4, 0, -2.2, -3.7, 0.3, 2.2, 'brancoModerno', deco), span(3.7, 0, -2.2, 4, 0.3, 2.2, 'brancoModerno', deco), box(0, 0.02, 0, 3.7, 0.02, 1.9, 'azulejo', deco)]);
mod('espelho-dagua-agua', "Espelho-d'água: água", 'decoracao', [box(0, 0.2, 0, 3.7, 0.02, 1.9, 'agua', deco)], { water: true });
addBuilding({ id: 'espelho-dagua', name: "Espelho-d'água", category: 'modernista', halfX: 4.1, halfZ: 2.3, pieces: [{ prefab: 'espelho-dagua-borda', x: 0, z: 0 }, { prefab: 'espelho-dagua-agua', x: 0, z: 0 }] });
/** A low kiosk with a wavy roof (two shallow curves): shade and a counter on the lakeside walk. */
mod('quiosque-onda', 'Quiosque de teto ondulado', 'estrutura', [
  ...Array.from({ length: 8 }, (_, i) => {
    const x0 = -3 + i * 0.75;
    const x1 = x0 + 0.75;
    const y = (x: number) => 2.9 + 0.35 * Math.cos((x / 3) * Math.PI * 2);
    return chordXY(x0, y(x0), x1, y(x1), 0.14, 1.8, 'brancoModerno');
  }),
  ...[-2.6, 2.6].flatMap((x) => [-1.4, 1.4].map((z) => cyl(x, 1.4, z, 0.08, 1.4, 'brancoModerno', { seg: 8 }))),
  box(0, 0.55, -0.9, 1.8, 0.55, 0.35, 'pastilha'),
  box(0, 1.13, -0.9, 1.9, 0.03, 0.45, 'brancoModerno', deco),
]);
export const PILOTIS = PIL;
