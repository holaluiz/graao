/**
 * SERRA and BOSQUE kits: the mountains and the countryside of Minas — the iron-ore ridges and tilted itabirite slabs
 * of the Serra do Curral, the quartzite outcrops, waterfalls and campos rupestres of the Serra do Cipó, the old mines,
 * and the farmhouse yard (sítio) with its porch, wood stove, vegetable beds, orchard and clothesline
 * (docs/world/MG_ARCHITECTURE_KITS.md). Trees here are placed by hand (palms on a square, an ipê by the chapel); the
 * scattered vegetation of each biome is in game-data planet.ts (SCATTER).
 */
import {
  KIT,
  addBuilding,
  addPrefab,
  ball,
  box,
  cone,
  cyl,
  deco,
  foundation,
  ghost,
  hippedRoof,
  near,
  slope,
  span,
  stair,
  wall,
  type KitCategory,
  type KitColor,
  type KitCover,
  type KitDoor,
  type KitPart,
  type WallKind,
} from './kitCore';

const add = (category: KitCategory, id: string, name: string, cover: KitCover, parts: KitPart[], o: { water?: boolean; scale?: [number, number]; alignToGround?: boolean; length?: number; door?: KitDoor } = {}) =>
  addPrefab({ id, name, category, cover, parts, scale: o.scale ?? [1, 1], ...(o.water ? { material: 'water' as const } : {}), ...(o.alignToGround ? { alignToGround: true } : {}), ...(o.length ? { length: o.length } : {}), ...(o.door ? { door: o.door } : {}) });
const serra = (id: string, name: string, cover: KitCover, parts: KitPart[], o?: Parameters<typeof add>[5]) => add('serra', id, name, cover, parts, o);
const bosque = (id: string, name: string, cover: KitCover, parts: KitPart[], o?: Parameters<typeof add>[5]) => add('bosque', id, name, cover, parts, o);

// ------------------------------------------------------------------------------------------------ rocks

/** A faceted boulder from a few overlapping turned boxes (collider: the same boxes). */
function boulder(seed: number, size: number, colors: KitColor[]): KitPart[] {
  let s = seed;
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const parts: KitPart[] = [];
  const n = 3;
  for (let i = 0; i < n; i++) {
    const hx = size * (0.55 + r() * 0.35);
    const hy = size * (0.35 + r() * 0.3);
    const hz = size * (0.5 + r() * 0.35);
    parts.push(box((r() - 0.5) * size * 0.6, hy * 0.7 + (i === 0 ? 0 : size * 0.2), (r() - 0.5) * size * 0.6, hx, hy, hz, colors[i % colors.length]!, { rx: (r() - 0.5) * 24, ry: r() * 90, rz: (r() - 0.5) * 24 }));
  }
  return parts;
}
for (const [i, [size, colors]] of ([[0.8, ['canga', 'ferrugem']], [1.4, ['itabirito', 'canga']], [2.2, ['canga', 'itabirito', 'ferrugem']]] as [number, KitColor[]][]).entries()) {
  serra(`rocha-ferro-${'pmg'[i]}`, `Rocha ferruginosa ${['pequena', 'média', 'grande'][i]}`, i ? 'alta' : 'baixa', boulder(31 + i * 7, size, colors), { scale: [0.8, 1.25] });
}
for (const [i, size] of [1.0, 1.8].entries()) serra(`rocha-quartzito-${i + 1}`, `Afloramento de quartzito ${i + 1}`, 'alta', boulder(71 + i * 13, size, ['quartzito', 'rochaClara']), { scale: [0.8, 1.3] });

/**
 * Tilted itabirite slabs (the layered crests of the Serra do Curral): five slabs leaning the same way along 6 m,
 * 1.5–3 m tall, with gaps to shoot through. High cover.
 */
serra('crista-itabirito', 'Crista de itabirito', 'alta', [
  ...[-2.4, -1.2, 0, 1.2, 2.4].map((x, i) => box(x, 0.9 + (i % 3) * 0.35, 0, 0.42, 1.2 + (i % 3) * 0.4, 0.35 + (i % 2) * 0.1, i % 2 ? 'itabirito' : 'canga', { rz: 28, rx: (i % 2 ? 4 : -3) })),
  box(0, 0.25, 0, 3.0, 0.35, 0.7, 'ferrugem', { rz: 4 }),
], { scale: [0.8, 1.3] });
/** A flat-topped rock pillar to jump onto (1.2 m) with a lower step (0.6 m): a perch with a way up. */
serra('degrau-rocha', 'Degraus de rocha', 'baixa', [box(0, 0.6, 0, 1.1, 0.6, 0.9, 'quartzito', { ry: 8 }), box(1.3, 0.3, 0.3, 0.8, 0.3, 0.7, 'rochaClara', { ry: -12 })], { scale: [0.9, 1.2] });
/** A rock overhang (lapa): a slab on two boulders, a small shelter to hide under. */
serra('lapa-pedra', 'Lapa de pedra', 'estrutura', [
  ...boulder(5, 1.2, ['canga', 'itabirito']).map((p) => ({ ...p, x: p.x - 2.1 })),
  ...boulder(9, 1.1, ['itabirito', 'ferrugem']).map((p) => ({ ...p, x: p.x + 2.1 })),
  box(0, 2.5, 0, 3.2, 0.45, 1.8, 'canga', { rz: -5, rx: 3 }),
  box(0.4, 3.0, 0.2, 2.2, 0.25, 1.3, 'musgo', { ...deco, rz: -5 }),
]);

// ------------------------------------------------------------------------------------------------ serra structures

/** Wooden lookout (mirante): a deck at 2.4 m on posts, a stair up one side, railings (movement only). */
serra('mirante-madeira', 'Mirante de madeira', 'passagem', [
  box(0, 2.3, 0, 1.9, 0.1, 1.9, 'madeira'),
  ...[-1.75, 1.75].flatMap((x) => [-1.75, 1.75].map((z) => cyl(x, 0.6, z, 0.12, 1.7, 'madeiraEscura', { seg: 6 }))),
  ...[-1, 1].map((sx) => box(sx * 1.88, 2.9, 0, 0.04, 0.5, 1.9, 'madeiraEscura', { solid: 'move' })),
  box(0, 2.9, -1.88, 1.9, 0.5, 0.04, 'madeiraEscura', { solid: 'move' }),
  box(-0.95, 2.9, 1.88, 0.95, 0.5, 0.04, 'madeiraEscura', { solid: 'move' }),
  ...[-1, 1].map((sx) => box(sx * 1.88, 3.42, 0, 0.06, 0.04, 1.92, 'madeira', near)),
  // Stair on the front right, rising toward −Z... from z = 5.6 down at ground to the deck edge at z = 1.9.
  ...stair(1, { rise: 2.4, run: 3.7, steps: 12, width: 0.9, landing: 0, color: 'madeira', railColor: 'madeiraEscura' }).map((p) => ({ ...p, x: p.x + 1.0, z: 5.55 - p.z, rx: p.rx ? -p.rx : p.rx })),
  // A sign board with a painted arrow (trail marker).
  box(-1.4, 3.6, 1.95, 0.4, 0.18, 0.03, 'amareloOcre', near),
]);
serra('marco-trilha', 'Marco de trilha', 'decoracao', [cyl(0, 0.7, 0, 0.07, 0.7, 'madeiraEscura', { seg: 6 }), box(0.18, 1.2, 0, 0.25, 0.08, 0.03, 'amareloOcre', near), cone(0.45, 1.2, 0, 0.1, 0.08, 'amareloOcre', { ...near, rz: -90, seg: 3 })]);
/** Narrow plank bridge, 7 m along Z, 1.2 m wide, rope railings (movement only), posts down into the rock. */
serra('ponte-tabuas', 'Ponte de tábuas 7 m', 'passagem', [
  ...Array.from({ length: 14 }, (_, i) => box(0, -0.05 - Math.sin(((i + 0.5) / 14) * Math.PI) * 0.22, -3.25 + i * 0.5, 0.6, 0.05, 0.23, i % 3 ? 'madeiraClara' : 'madeira', i % 2 ? near : {})),
  // Walkable surface: two ramps meeting at the sag.
  slope(0, 0.6, -3.55, 0.0, 0, -0.22, 0.12, 'madeira', ghost),
  slope(0, 0.6, 0, -0.22, 3.55, 0.0, 0.12, 'madeira', ghost),
  ...[-1, 1].flatMap((sx) => [
    box(sx * 0.62, 0.55, 0, 0.02, 0.55, 3.5, 'madeira', { solid: 'move', visible: false }),
    box(sx * 0.62, 0.85, 0, 0.015, 0.015, 3.5, 'saco', near),
    ...[-3.5, 3.5].map((z) => cyl(sx * 0.62, -0.2, z, 0.07, 1.2, 'madeiraEscura', { seg: 6 })),
  ]),
]);
/**
 * Old mine entrance (boca de mina) cut into a rock mass: a timbered portal, a 6 m gallery (a small cave with cover
 * inside), rails and a minecart. Origin: the floor at the portal; the gallery goes toward −Z.
 */
serra('boca-mina', 'Boca de mina', 'estrutura', [
  // Rock mass around the gallery (walls, roof, back).
  span(-4.2, -0.6, -7.6, -1.2, 3.6, 0.2, 'itabirito'),
  span(1.2, -0.6, -7.6, 4.2, 3.6, 0.2, 'itabirito'),
  span(-4.2, 2.6, -7.6, 4.2, 4.4, 0.2, 'canga'),
  span(-1.2, -0.6, -7.6, 1.2, 2.6, -6.8, 'itabirito'),
  box(0, 4.5, -3.6, 3.6, 0.4, 3.4, 'musgo', deco),
  box(-2.6, 3.0, 0.15, 1.5, 1.0, 0.1, 'ferrugem', near),
  // Timber frames along the gallery.
  ...[0.05, -2.2, -4.6].flatMap((z) => [
    box(-1.05, 1.25, z, 0.12, 1.25, 0.12, 'madeiraEscura', z ? near : {}),
    box(1.05, 1.25, z, 0.12, 1.25, 0.12, 'madeiraEscura', z ? near : {}),
    box(0, 2.5, z, 1.2, 0.12, 0.14, 'madeiraEscura', near),
  ]),
  // Rails and a minecart (low cover).
  ...[-0.38, 0.38].map((x) => box(x, 0.05, -2.0, 0.03, 0.04, 5.2, 'aco', near)),
  box(0, 0.55, -3.4, 0.55, 0.35, 0.75, 'ferro'),
  box(0, 0.88, -3.4, 0.45, 0.05, 0.65, 'canga', near),
  ...[-0.5, 0.5].flatMap((z) => [-0.5, 0.5].map((x) => cyl(x, 0.17, -3.4 + z, 0.15, 0.04, 'ferro', { ...near, rz: 90, seg: 8 }))),
  // Crystals glowing at the back of the gallery.
  ...[[-0.7, -6.4, 0.9], [0.3, -6.6, 1.3], [0.8, -6.3, 0.7]].map(([x, z, h]) => cone(x!, h! / 2, z!, 0.22, h! / 2, 'cristal', { ...deco, seg: 5 })),
]);
serra('cristal-grande', 'Cristal grande', 'alta', [
  cone(0, 1.4, 0, 0.55, 1.4, 'cristal', { seg: 6 }),
  cone(0.6, 0.7, 0.3, 0.3, 0.7, 'cristal', { seg: 5, rz: -18 }),
  cone(-0.5, 0.55, -0.2, 0.26, 0.55, 'cristal', { seg: 5, rz: 22 }),
  box(0, 0.12, 0, 0.9, 0.2, 0.8, 'itabirito', { ry: 20 }),
], { scale: [0.8, 1.5] });

// ------------------------------------------------------------------------------------------------ water

/** Stream (riacho) tile, 2.4 × 4: a water ribbon with pebbles at its banks (leans with the ground; decoration). */
bosque('riacho-4', 'Riacho 4 m', 'decoracao', [box(0, 0.04, 0, 1.0, 0.02, 2.1, 'agua', deco)], { water: true, alignToGround: true });
bosque('margem-riacho-4', 'Margem do riacho 4 m', 'decoracao', [
  box(0, -0.04, 0, 1.25, 0.06, 2.15, 'pedraEscura', deco),
  ...[[-1.15, -1.2], [1.1, -0.2], [-1.05, 0.9], [1.2, 1.6], [0.95, -1.7]].map(([x, z], i) => ball(x!, 0.04, z!, 0.18 + (i % 2) * 0.07, i % 2 ? 'rochaClara' : 'quartzito', near)),
], { alignToGround: true });
bosque('pedras-travessia', 'Pedras de travessia', 'decoracao', [...[[-0.9, 0.1], [0, -0.2], [0.9, 0.15]].map(([x, z]) => cyl(x!, 0.08, z!, 0.32, 0.14, 'rochaClara', { seg: 7 }))]);
/**
 * Waterfall (cachoeira): a quartzite cliff 5 m high, 10 m wide and 10 m deep with a ledge on top where the stream leaves
 * it, the pool at its foot, and a cleft behind the falling water — a hidden way from the pool up a rock stair to the
 * ledge. The rock covers the terrain's step from the pool level to the shelf behind (planet.ts flattens the cleft's
 * floor to the pool's level). Origin: the pool's edge level; the cliff face toward +Z.
 */
const FALL = { h: 5.0, w: 10, d: 10 };
serra('cachoeira-paredao', 'Cachoeira: paredão', 'estrutura', [
  // Two cliff blocks with the cleft between them (x −1.0 .. 1.0), the rock closing the cleft, and the upper ledge.
  span(-FALL.w / 2, -1.0, -FALL.d, -1.0, FALL.h, -0.6, 'quartzito'),
  span(1.0, -1.0, -FALL.d, FALL.w / 2, FALL.h, -0.6, 'quartzito'),
  span(-1.0, -1.0, -FALL.d, 1.0, FALL.h, -6.15, 'quartzito'),
  box(-3.2, FALL.h + 0.04, -5.0, 2.2, 0.06, 4.6, 'musgo', deco),
  box(3.0, FALL.h + 0.04, -5.0, 2.0, 0.06, 4.6, 'musgo', deco),
  ...boulder(3, 1.0, ['rochaClara', 'quartzito']).map((p) => ({ ...p, x: p.x - 4.4, z: p.z + 0.3 })),
  ...boulder(8, 0.8, ['quartzito', 'musgo']).map((p) => ({ ...p, x: p.x + 4.5, z: p.z + 0.2 })),
  // Strata lines on the face.
  ...[1.2, 2.6, 3.9].flatMap((y, i) => [box(-3.0, y, -0.58, 2.0, 0.05, 0.02, 'rochaClara', near), box(3.0, y + (i % 2) * 0.3, -0.58, 2.0, 0.05, 0.02, 'rochaClara', near)]),
  // Quartzite ledges and blocks breaking the cliff's planes (campo rupestre rock: pale, tilted, mossy on top).
  ...([[-3.9, 1.6, 0.9, 0.35, -8, 'rochaClara'], [-2.0, 3.1, 1.3, 0.3, 6, 'quartzito'], [-4.2, 4.3, 0.8, 0.45, -4, 'rochaClara'], [2.4, 0.9, 1.1, 0.4, 7, 'rochaClara'], [3.8, 2.4, 0.9, 0.3, -6, 'quartzito'], [2.2, 4.1, 1.2, 0.4, 5, 'rochaClara']] as [number, number, number, number, number, KitColor][]).flatMap(([x, y, hx, hy, rz, c]) => [
    box(x, y, -0.45, hx, hy, 0.28, c, { ...deco, rz }),
    box(x, y + hy + 0.04, -0.45, hx * 0.8, 0.05, 0.22, 'musgo', { ...near, rz }),
  ]),
  // Rounded blocks on the rim and a jagged skyline.
  ...([[-4.2, -1.5, 0.9], [-1.6, -2.4, 0.7], [1.8, -1.9, 0.8], [4.3, -3.2, 1.0], [-3.6, -8.6, 1.1], [3.4, -7.4, 0.9]] as [number, number, number][]).map(([x, z, r], i) => box(x, FALL.h + r * 0.45, z, r, r * 0.55, r * 0.8, i % 2 ? 'quartzito' : 'rochaClara', { ry: i * 37 })),
  // Rock stair inside the cleft, from the pool up to the ledge (rising toward −Z, 42°).
  ...stair(0, { rise: FALL.h, run: 5.6, steps: 18, width: 1.8, landing: 0, color: 'rochaClara' }).map((p) => ({ ...p, z: -0.5 - p.z, rx: p.rx ? -p.rx : p.rx })),
]);
serra('cachoeira-agua', 'Cachoeira: queda e poço', 'decoracao', [
  // Falling sheet just in front of the cleft, the foam at the bottom, the pool.
  box(0, FALL.h / 2 + 0.1, -0.35, 1.3, FALL.h / 2 + 0.1, 0.06, 'agua', deco),
  box(0, 0.2, 0.2, 1.6, 0.25, 0.5, 'espuma', deco),
  cyl(0, 0.05, 2.6, 3.6, 0.03, 'agua', { ...deco, seg: 14 }),
  // Stream on the upper ledge, toward the edge.
  box(0, FALL.h + 0.06, -5.2, 0.9, 0.02, 4.7, 'agua', deco),
], { water: true });
bosque('poco-borda', 'Borda de pedras do poço', 'baixa', [
  ...Array.from({ length: 9 }, (_, i) => {
    const a = (-0.35 + (i / 8) * 0.7) * Math.PI * 2;
    return box(Math.sin(a) * 3.9, 0.2, 2.6 + Math.cos(a) * 3.9, 0.7, 0.35, 0.45, i % 2 ? 'rochaClara' : 'quartzito', { ry: (a * 180) / Math.PI });
  }),
]);
addBuilding({
  id: 'cachoeira',
  name: 'Cachoeira do Bosque',
  category: 'bosque',
  halfX: 5.5,
  halfZ: 10.0,
  settle: 'center',
  pieces: [
    { prefab: 'cachoeira-paredao', x: 0, z: 0 },
    { prefab: 'cachoeira-agua', x: 0, z: 0 },
    { prefab: 'poco-borda', x: 0, z: 0 },
  ],
  notes: 'Passagem escondida: atrás da queda, a fenda com degraus leva do poço ao alto do paredão.',
});

// ------------------------------------------------------------------------------------------------ farmhouse (sítio)

/** Rural house walls: whitewash with a blue frame, a dark barrado; tall wooden doors. */
const SITIO = { color: 'cal' as KitColor, frame: 'azulColonial' as KitColor, leaf: 'azulColonial' as KitColor, look: 'colonial' as const, plinth: { h: 0.6, color: 'terraVermelha' as KitColor } };
for (const kind of ['cheia', 'janela', 'porta'] as WallKind[]) {
  bosque(`sitio-${kind}-2`, `Sítio: ${kind} 2 m`, 'alta', wall(2, kind, { ...SITIO, openLeaves: false }), { length: 2, ...(kind === 'porta' ? { door: { w: 1.4, h: 2.55, style: 'dupla' as const, color: SITIO.leaf } } : {}) });
}
bosque('fundacao-sitio-8x6', 'Piso do sítio 8×6', 'passagem', foundation(8, 6, 'terraVermelha', 'telhaColonial'));
/** Porch (varanda) along the front: a brick floor, wooden posts and a lean-to roof continuing the main one. */
bosque('varanda-8', 'Varanda 8 m', 'passagem', [
  span(-4.3, -0.6, 0, 4.3, KIT.floorTop, 2.4, 'telhaColonial'),
  ...[-4.1, -1.4, 1.4, 4.1].map((x) => cyl(x, 1.45, 2.2, 0.1, 1.45, 'madeiraEscura', { seg: 6 })),
  slope(0, 4.55, -0.1, 3.0, 2.75, 2.35, 0.12, 'telhaColonial'),
  box(0, 2.42, 2.25, 4.3, 0.06, 0.08, 'madeira', near),
  // A low parapet between the end posts (sit and lean on it: low cover).
  ...[-1, 1].map((sx) => span(sx * 4.2, KIT.floorTop, 0.2, sx * 4.0, KIT.floorTop + 0.7, 2.2, 'cal')),
  box(-2.7, KIT.floorTop + 0.45, 1.9, 0.9, 0.04, 0.25, 'madeira', near),
]);
/** Wood stove (fogão a lenha) with a chimney through the roof. */
bosque('fogao-lenha', 'Fogão a lenha', 'baixa', [
  box(0, 0.42, 0, 0.9, 0.42, 0.42, 'cal'),
  box(0, 0.86, 0, 0.92, 0.03, 0.44, 'ferro', deco),
  ...[-0.4, 0.35].map((x) => cyl(x, 0.98, 0, 0.16, 0.1, 'ferro', { ...near, seg: 8 })),
  box(0.6, 3.2, -0.25, 0.25, 2.4, 0.2, 'cal'),
  box(-0.2, 0.25, 0.43, 0.25, 0.12, 0.01, 'ferro', near),
]);
bosque('mesa-madeira', 'Mesa de madeira com bancos', 'baixa', [
  box(0, 0.4, 0, 1.0, 0.4, 0.45, 'madeira', { visible: false }),
  box(0, 0.78, 0, 1.05, 0.04, 0.48, 'madeiraClara', deco),
  ...[-0.85, 0.85].flatMap((x) => [-0.35, 0.35].map((z) => box(x, 0.38, z, 0.05, 0.38, 0.05, 'madeira', near))),
  ...[-1, 1].map((sz) => box(0, 0.25, sz * 0.8, 1.0, 0.25, 0.16, 'madeira')),
]);
bosque('sitio-telhado', 'Telhado do sítio 8×6', 'alta', hippedRoof(8, 6, 1.6, 'telhaColonial', 0.5));
addBuilding({
  id: 'casa-sitio',
  name: 'Casa do Sítio',
  category: 'bosque',
  halfX: 4.6,
  halfZ: 5.8,
  pieces: [
    { prefab: 'fundacao-sitio-8x6', x: 0, z: 0 },
    ...['sitio-janela-2', 'sitio-porta-2', 'sitio-cheia-2', 'sitio-janela-2'].map((m, i) => ({ prefab: m, x: -3 + i * 2, z: 3, yaw: 0 })),
    ...['sitio-cheia-2', 'sitio-janela-2', 'sitio-porta-2', 'sitio-cheia-2'].map((m, i) => ({ prefab: m, x: -3 + i * 2, z: -3, yaw: 180 })),
    ...['sitio-cheia-2', 'sitio-janela-2', 'sitio-cheia-2'].map((m, i) => ({ prefab: m, x: 4, z: -2 + i * 2, yaw: 270 })),
    ...['sitio-cheia-2', 'sitio-cheia-2', 'sitio-janela-2'].map((m, i) => ({ prefab: m, x: -4, z: -2 + i * 2, yaw: 90 })),
    ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => ({ prefab: 'col-cunhal-azul', x: sx * 4, z: sz * 3 }))),
    { prefab: 'sitio-telhado', x: 0, y: KIT.wallTop, z: 0 },
    { prefab: 'varanda-8', x: 0, z: 3.1 },
    { prefab: 'fogao-lenha', x: -2.6, y: KIT.floorTop, z: -2.3 },
    { prefab: 'mesa-madeira', x: 1.0, y: KIT.floorTop, z: 0.2 },
    { prefab: 'panelas', x: -0.9, y: KIT.floorTop, z: -2.4 },
    { prefab: 'potes-barro', x: 3.2, y: KIT.floorTop, z: 2.1 },
  ],
  doors: [{ x: -1, z: 5.5, yaw: 0 }, { x: 1, z: -3, yaw: 180 }],
  notes: 'Baú: dentro da casa, junto ao fogão (coberto). Varanda: cobertura baixa.',
});

/** Farm gate (porteira) open, between two posts, and a barbed-wire fence (posts and wires: movement only). */
bosque('porteira', 'Porteira', 'decoracao', [
  ...[-1.8, 1.8].map((x) => cyl(x, 0.75, 0, 0.12, 0.85, 'madeiraEscura', { seg: 6 })),
  ...[0.4, 0.8, 1.2].map((y) => box(-1.0, y, 1.35, 0.04, 0.05, 1.3, 'madeiraClara', near)),
  box(-1.0, 0.8, 1.35, 0.04, 0.45, 0.04, 'madeiraClara', { ...near, rx: 40 }),
]);
bosque('cerca-arame-4', 'Cerca de arame 4 m', 'decoracao', [
  box(0, 0.6, 0, 2.0, 0.6, 0.04, 'ferro', { solid: 'move', visible: false }),
  ...[-2, 0, 2].map((x) => cyl(x, 0.65, 0, 0.06, 0.65, 'madeiraEscura', { seg: 5 })),
  ...[0.35, 0.7, 1.05].map((y) => box(0, y, 0, 2.0, 0.006, 0.006, 'ferro', { ...deco, lod: 'far' })),
]);
bosque('cerca-madeira-4', 'Cerca de madeira 4 m', 'ocultacao', [
  box(0, 0.5, 0, 2, 0.55, 0.05, 'madeiraClara', { solid: 'move', visible: false }),
  ...[-2, -1, 0, 1, 2].map((x) => box(x * 0.98, 0.45, 0, 0.05, 0.6, 0.05, 'madeira', near)),
  box(0, 0.75, 0, 2, 0.04, 0.03, 'madeiraClara', deco),
  box(0, 0.35, 0, 2, 0.04, 0.03, 'madeiraClara', deco),
]);
/** Wooden footbridge over a stream, 5 m along Z, gently arched, handrails (movement only). */
bosque('ponte-madeira', 'Ponte de madeira 5 m', 'passagem', [
  slope(0, 0.8, -2.6, 0.0, -0.8, 0.35, 0.18, 'madeira'),
  span(-0.8, 0.17, -0.85, 0.8, 0.35, 0.85, 'madeira'),
  slope(0, 0.8, 0.8, 0.35, 2.6, 0.0, 0.18, 'madeira'),
  ...[-1, 1].flatMap((sx) => [
    box(sx * 0.78, 0.85, 0, 0.03, 0.5, 2.5, 'madeiraEscura', { solid: 'move', visible: false }),
    box(sx * 0.78, 1.25, 0, 0.04, 0.04, 2.55, 'madeiraClara', near),
    ...[-2.4, -0.8, 0.8, 2.4].map((z) => box(sx * 0.78, 0.7, z, 0.05, 0.5, 0.05, 'madeiraEscura', near)),
  ]),
  ...[-0.5, 0, 0.5].map((x) => box(x, 0.36, 0, 0.012, 0.005, 0.85, 'madeiraEscura', near)),
]);
bosque('tronco-caido', 'Tronco caído', 'baixa', [cyl(0, 0.38, 0, 0.38, 2.2, 'madeira', { rz: 90, seg: 9 }), cyl(-1.4, 0.75, 0.1, 0.12, 0.35, 'madeiraEscura', { ...near, rz: 30, seg: 5 }), ball(1.6, 0.3, 0.3, 0.3, 'musgo', near)], { scale: [0.8, 1.2] });

// ------------------------------------------------------------------------------------------------ hand-placed trees

/** A crown of overlapping balls (decoration) over a trunk (collider). */
function crown(trunkH: number, trunkR: number, crowns: [number, number, number, number, KitColor][], trunk: KitColor = 'madeira'): KitPart[] {
  return [cyl(0, trunkH / 2 - 0.3, 0, trunkR, trunkH / 2 + 0.3, trunk, { seg: 7 }), ...crowns.map(([x, y, z, r, c]) => ball(x, y, z, r, c, { solid: 'none' as const }))];
}
bosque('palmeira-imperial', 'Palmeira-imperial', 'decoracao', [
  cyl(0, 5.5, 0, 0.26, 5.8, 'quartzito', { seg: 8 }),
  cyl(0, 11.6, 0, 0.3, 0.6, 'palmeira', { ...deco, seg: 8 }),
  ...Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * 360;
    return box(Math.sin((a * Math.PI) / 180) * 1.5, 12.0, Math.cos((a * Math.PI) / 180) * 1.5, 0.3, 0.04, 1.6, 'palmeira', { ...deco, ry: a, rx: 25, lod: 'far' });
  }),
], { scale: [0.85, 1.1] });
bosque('palmeira-jeriva', 'Palmeira jerivá', 'decoracao', [
  cyl(0, 2.8, 0, 0.18, 3.0, 'troncoClaro', { seg: 7, rz: 4 }),
  ...Array.from({ length: 7 }, (_, i) => {
    const a = (i / 7) * 360;
    return box(Math.sin((a * Math.PI) / 180) * 1.1, 5.9, Math.cos((a * Math.PI) / 180) * 1.1, 0.25, 0.04, 1.2, 'palmeira', { ...deco, ry: a, rx: 32 });
  }),
  ...[0, 120, 240].map((a) => ball(Math.sin((a * Math.PI) / 180) * 0.3, 5.5, Math.cos((a * Math.PI) / 180) * 0.3, 0.16, 'amareloOcre', near)),
], { scale: [0.85, 1.15] });
bosque('ipe-amarelo', 'Ipê-amarelo', 'decoracao', crown(3.4, 0.2, [[0, 4.2, 0, 1.6, 'ipeAmarelo'], [1.0, 3.8, 0.4, 1.0, 'ipeAmarelo'], [-0.9, 3.9, -0.4, 1.1, 'plasticoAmarelo'], [0.2, 4.9, -0.6, 0.9, 'ipeAmarelo']], 'troncoClaro'), { scale: [0.8, 1.2] });
bosque('ipe-roxo', 'Ipê-roxo', 'decoracao', crown(3.2, 0.2, [[0, 4.0, 0, 1.5, 'ipeRoxo'], [1.0, 3.7, 0.3, 0.95, 'ipeRoxo'], [-0.8, 3.8, -0.5, 1.0, 'muralE'], [0.3, 4.7, -0.4, 0.85, 'ipeRoxo']], 'troncoClaro'), { scale: [0.8, 1.2] });
bosque('mangueira', 'Mangueira', 'decoracao', crown(2.2, 0.28, [[0, 3.6, 0, 2.0, 'folhaEscura'], [1.3, 3.1, 0.5, 1.2, 'folha'], [-1.2, 3.2, -0.6, 1.3, 'folhaEscura'], [0.6, 2.8, 1.3, 0.12, 'abobora']]), { scale: [0.8, 1.2] });
bosque('jabuticabeira', 'Jabuticabeira', 'decoracao', [
  ...crown(1.6, 0.18, [[0, 2.7, 0, 1.6, 'folhaEscura'], [0.9, 2.4, 0.3, 1.0, 'folha']], 'troncoClaro'),
  ...[[0.2, 1.0, 0.2], [-0.15, 1.3, 0.17], [0.1, 0.7, -0.2], [-0.2, 1.5, -0.12]].map(([x, y, z]) => ball(x!, y!, z!, 0.05, 'itabirito', near)),
], { scale: [0.85, 1.15] });
bosque('bananeira', 'Bananeira', 'decoracao', [
  cyl(0, 1.0, 0, 0.16, 1.1, 'musgo', { seg: 7 }),
  ...[0, 72, 144, 216, 288].map((a) => box(Math.sin((a * Math.PI) / 180) * 0.7, 2.25, Math.cos((a * Math.PI) / 180) * 0.7, 0.35, 0.03, 0.85, 'palmeira', { ...deco, ry: a, rx: 30 })),
  cyl(0.2, 1.6, 0.25, 0.12, 0.3, 'abobora', { ...near, seg: 6 }),
], { scale: [0.85, 1.2] });
/** Cerrado tree (pequizeiro / barbatimão style): a twisted dark trunk, a few low branches, a flat sparse crown. */
bosque('arvore-cerrado', 'Árvore do cerrado', 'decoracao', [
  cyl(0, 0.9, 0, 0.17, 1.2, 'madeiraEscura', { seg: 6, rz: 9 }),
  cyl(0.45, 2.2, 0.1, 0.1, 0.65, 'madeiraEscura', { ...deco, seg: 5, rz: -38 }),
  cyl(-0.4, 2.1, -0.1, 0.09, 0.6, 'madeiraEscura', { ...deco, seg: 5, rz: 40 }),
  ...[[0.8, 2.75, 0.2, 1.0], [-0.8, 2.6, -0.2, 0.9], [0, 3.0, 0.4, 0.85]].map(([x, y, z, r]) => cyl(x!, y!, z!, r!, r! * 0.28, 'folhaCerrado', { ...deco, seg: 7 })),
], { scale: [0.8, 1.3] });
/** Canela-de-ema (Vellozia, campo rupestre): forked dark stems ending in tufts. Decoration. */
serra('canela-de-ema', 'Canela-de-ema', 'decoracao', [
  cyl(0, 0.35, 0, 0.07, 0.4, 'itabirito', { ...deco, seg: 5 }),
  cyl(0.15, 0.9, 0, 0.05, 0.3, 'itabirito', { ...deco, seg: 5, rz: -25 }),
  cyl(-0.12, 0.85, 0.05, 0.05, 0.28, 'itabirito', { ...deco, seg: 5, rz: 28 }),
  ...[[0.3, 1.2, 0], [-0.25, 1.12, 0.06], [0, 0.85, -0.12]].map(([x, y, z]) => cone(x!, y!, z!, 0.18, 0.2, 'musgo', { ...deco, seg: 6 })),
  cone(0.28, 1.28, 0.02, 0.06, 0.08, 'ipeRoxo', { ...near, seg: 5 }),
], { scale: [0.7, 1.4] });
bosque('touceira-capim', 'Touceira de capim-dourado', 'decoracao', Array.from({ length: 6 }, (_, i) => cone(Math.sin(i * 2.1) * 0.25, 0.4, Math.cos(i * 2.1) * 0.25, 0.08, 0.4, i % 2 ? 'capim' : 'amareloOcre', { ...deco, seg: 4, rx: Math.cos(i * 2.1) * 14, rz: -Math.sin(i * 2.1) * 14 })), { scale: [0.7, 1.4] });
