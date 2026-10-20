/**
 * VERTICAL kit (docs/world/VERTICAL_PREFABS.md, VERTICAL_WORLD_DESIGN.md): what the vertical world is built from —
 * climbable rock faces, rock ledges, trail ramps, floating islands, stepping-stone platforms, grapple anchors, the
 * sineira (an interactive bell), the cruzeiro, and two compositions: the Serra do Mirante massif (three routes to a
 * contested summit) and the islands of the Arquipélago dos Sinos.
 *
 * Gameplay tags, not looks, decide traversal (docs/gameplay/CLIMBING.md): the rock masses are `traversal: 'none'` (their
 * long faces are walls, not ladders), the climbable faces are `'climb'` and stand 0.15 m proud of the mass with their
 * top 5 cm over it, so the wall probe meets the face and the ledge probe meets its top; island tops and platforms are
 * `'ledge'` (whoever falls short can still catch the edge). Every collider is a box, a cylinder or a small convex hull
 * (no trimesh).
 *
 * Rock looks (docs/world/VERTICAL_PREFABS.md): the massif's tiers are boxes drawn broken into facets and banded like
 * itabirito (`relief`, `bands`: visual, within 0.1 m out and 0.2 m in of the collider, the tops flat); boulders and the
 * rock under the islands are convex hulls, drawn from the same points their colliders are built from.
 *
 * Map-level pieces with no prefab: wind volumes (the map's `winds`: WIND_UPDRAFT / WIND_DIRECTIONAL) and loot points
 * on heights (chest spots with `surface: 'prop'` and a `height`).
 */
import {
  addBuilding,
  addPrefab,
  ball,
  box,
  cone,
  cyl,
  deco,
  gabledRoof,
  hull,
  near,
  slope,
  span,
  type KitColor,
  type KitCover,
  type KitPart,
} from './kitCore';
import type { TraversalSurface } from '../traversal';

const vertical = (id: string, name: string, cover: KitCover, parts: KitPart[], traversal?: TraversalSurface, scale: [number, number] = [1, 1]) =>
  addPrefab({ id, name, category: 'vertical', cover, parts, scale, ...(traversal ? { traversal } : {}) });

/** Deterministic little random stream for decoration (same parts on every machine). */
function rng(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

// ------------------------------------------------------------------------------------------------ rock

/** Broken-rock look of the massif's boxes (visual: facets ≤ 0.1 m out and ≤ 0.2 m into the collider, flat tops). */
const RELIEF = 0.1;

/**
 * A rock mass from (x0, y0, z0) to (x1, y1, z1): one box collider, drawn broken into facets and banded in `colors`
 * like itabirito (KitPart `relief`, `bands`), moss on its top. Climbable faces stand 0.25 m proud of it, clear of the
 * facets.
 */
function rockMass(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, colors: KitColor[], seed: number): KitPart[] {
  const r = rng(seed);
  const P: KitPart[] = [span(x0, y0, z0, x1, y1, z1, colors[0]!, { relief: RELIEF, bands: colors.slice(1) })];
  const w = x1 - x0;
  const d = z1 - z0;
  // Moss and campo rupestre on the top (a few patches, under the walking height).
  for (let i = 0; i < Math.max(2, Math.round((w * d) / 14)); i++) {
    const px = x0 + 0.6 + r() * (w - 1.2);
    const pz = z0 + 0.6 + r() * (d - 1.2);
    P.push(box(px, y1 + 0.015, pz, 0.5 + r() * 0.7, 0.015, 0.4 + r() * 0.6, i % 3 ? 'musgo' : 'capim', { ...near, ry: r() * 90 }));
  }
  return P;
}

/** An icosahedron's corners (scaled so the farthest coordinate is 1) and the six axis points: a boulder's cloud. */
const PHI = (1 + Math.sqrt(5)) / 2;
const BOULDER_CLOUD: [number, number, number][] = [
  ...[-1, 1].flatMap((a) => [-1, 1].flatMap((b): [number, number, number][] => [[0, a / PHI, b], [a / PHI, b, 0], [b, 0, a / PHI]])),
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

/**
 * A boulder about hx × hy × hz around (x, y, z), never past that box: a convex hull of the cloud above, each point
 * pulled in a little at random. The collider is the same hull (cover is what it looks like).
 */
function boulder(x: number, y: number, z: number, hx: number, hy: number, hz: number, color: KitColor, seed: number, o: Partial<KitPart> = {}): KitPart {
  const r = rng(seed);
  const pts: number[] = [];
  for (const [a, b, c] of BOULDER_CLOUD) {
    const k = 0.78 + 0.22 * r();
    pts.push(x + a * hx * k, y + b * hy * k, z + c * hz * k);
  }
  return hull(pts, color, o);
}

/** The rock under a floating island narrows from under its slab to a point: ring scale by depth fraction. */
const SPIRE: [number, number][] = [[0, 0.8], [0.18, 0.8], [0.42, 0.58], [0.66, 0.34], [0.85, 0.15], [1, 0]];
const spireScale = (f: number): number => {
  for (let i = 1; i < SPIRE.length; i++) {
    const [f1, k1] = SPIRE[i]!;
    const [f0, k0] = SPIRE[i - 1]!;
    if (f <= f1) return k0 + ((k1 - k0) * (f - f0)) / (f1 - f0);
  }
  return 0;
};

/**
 * The rock under a slab of half extents hw × hd whose bottom is at `y0`: rings of points down to a tip `depth` below,
 * each ring a rounded rectangle pulled in a little at random (never wider than 0.8 of the slab: someone hanging from
 * its edge clears it), banded in strata. One convex hull: shots and bodies meet the rock that is drawn.
 */
function spire(hw: number, hd: number, y0: number, depth: number, seed: number, colors: KitColor[]): KitPart {
  const r = rng(seed);
  const pts: number[] = [];
  for (const [f, k] of SPIRE.slice(0, -1)) {
    for (let i = 0; i < 10; i++) {
      const a = ((i + 0.35 * r()) / 10) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      // Superellipse (exponent 4): the ring keeps something of the slab's corners.
      const e = (c ** 4 + s ** 4) ** -0.25;
      const j = k * (0.8 + 0.2 * r());
      pts.push(c * e * hw * j, y0 - depth * (f ? f + (r() - 0.5) * 0.08 : 0), s * e * hd * j);
    }
  }
  pts.push((r() - 0.5) * hw * 0.3, y0 - depth, (r() - 0.5) * hd * 0.3);
  return hull(pts, colors[0]!, { traversal: 'none', bands: colors.slice(1) });
}

/**
 * A rock blade of a crest, its foot `w` wide (along X) and `t` deep (from z0 back to z0 − t), from `y0` (in the ground)
 * up: the front face plumb at z = z0 up to `plumb` (flush with what stands in front: no crevice to slip into), then
 * leaning back `lean` m by its ridge at height `h`. A convex hull, banded like the massif, not grabbable.
 */
function blade(x: number, z0: number, w: number, t: number, y0: number, plumb: number, h: number, lean: number, seed: number, colors: KitColor[]): KitPart {
  const r = rng(seed);
  const hw = w / 2;
  const ym = plumb + (h - plumb) * 0.55;
  const ridge = (r() - 0.5) * hw * 0.6;
  const pts = [
    // Foot, then the plumb shoulder (front corners straight up, the back pulled in).
    x - hw, y0, z0, x + hw, y0, z0, x - hw * (0.8 + 0.2 * r()), y0, z0 - t, x + hw * (0.8 + 0.2 * r()), y0, z0 - t,
    x - hw * 0.92, plumb, z0, x + hw * 0.92, plumb, z0, x - hw * 0.7, plumb, z0 - t * 0.85, x + hw * 0.75, plumb, z0 - t * 0.8,
    // Narrower and leaning back, then a ridge of two points off the middle.
    x - hw * 0.6, ym, z0 - lean * 0.5, x + hw * 0.55, ym, z0 - lean * 0.45, x - hw * 0.4, ym, z0 - t * 0.7 - lean * 0.5, x + hw * 0.45, ym, z0 - t * 0.75 - lean * 0.5,
    x + ridge - hw * 0.18, h, z0 - lean - t * 0.3, x + ridge + hw * 0.12, h - 0.6 - r() * 0.8, z0 - lean - t * 0.35,
  ];
  return hull(pts, colors[0]!, { traversal: 'none', bands: colors.slice(1) });
}

/**
 * A climbable rock face `w` wide, from `y0` to `y1` over the base (docs/gameplay/CLIMBING.md): the slab stands 0.25 m
 * proud of the mass behind it (its face toward +Z at z = 0.25, clear of the mass's facets) and its top 5 cm over the
 * mass, so both probes meet it.
 * Pale quartzite with cracks and handholds reads as "climb here" from afar.
 */
function climbFace(w: number, y0: number, y1: number, seed: number): KitPart[] {
  const r = rng(seed);
  const h = y1 - y0;
  const P: KitPart[] = [span(-w / 2, y0, -0.45, w / 2, y1, 0.25, 'quartzito', { traversal: 'climb' })];
  // Handholds and footholds: small pale knobs scattered over the face.
  const rows = Math.max(3, Math.round(h / 0.55));
  for (let i = 0; i < rows; i++) {
    for (let k = 0; k < Math.max(2, Math.round(w / 0.9)); k++) {
      const x = -w / 2 + 0.3 + r() * (w - 0.6);
      const y = Math.max(0.2, y0) + (i + r() * 0.6) * ((y1 - Math.max(0.2, y0)) / rows);
      P.push(box(x, y, 0.29, 0.09 + r() * 0.06, 0.05, 0.05, i % 2 ? 'rochaClara' : 'pedraSabao', { ...near, rz: (r() - 0.5) * 40 }));
    }
  }
  // Vertical cracks and the lip of moss on top.
  for (let k = 0; k < 2; k++) P.push(box(-w / 4 + k * (w / 2) + (r() - 0.5) * 0.4, Math.max(0, y0) + h * 0.5, 0.265, 0.025, h * 0.4, 0.02, 'pedraEscura', { ...near, rz: (r() - 0.5) * 8 }));
  P.push(box(0, y1 + 0.02, -0.1, w / 2, 0.03, 0.35, 'musgo', near));
  return P;
}

for (const [id, w, y0, y1, label] of [
  ['paredao-escalada-4', 4.0, -0.5, 4.25, '4 m'],
  ['paredao-escalada-38', 3.5, 0, 3.85, '3,8 m'],
  ['paredao-escalada-36', 3.0, 0, 3.65, '3,6 m'],
] as [string, number, number, number, string][]) {
  vertical(id, `Paredão de escalada ${label}`, 'alta', climbFace(w, y0, y1, id.length * 97 + Math.round(w * 13)), 'climb');
}

/** A rock lip (beirada) to hang from: 3 m along X, its top 0.4 m over the base, 0.7 m deep, grabbable from +Z. */
vertical('beirada-pedra', 'Beirada de pedra 3 m', 'baixa', [
  span(-1.5, -0.3, -0.7, 1.5, 0.4, 0, 'itabirito', { traversal: 'ledge' }),
  box(0, 0.42, -0.35, 1.45, 0.02, 0.3, 'musgo', near),
  box(0, 0.05, 0.03, 1.4, 0.04, 0.02, 'rochaClara', near),
], 'ledge');

/**
 * Trail ramp (trilha) `len` m along Z rising `rise` m toward +Z, 1.8 m wide: the walking slab over stone fill (so nobody
 * is caught under it), a row of edge stones on both sides (knee-high, not a railing: the trail is exposed).
 */
function trailRamp(len: number, rise: number, seed: number): KitPart[] {
  const r = rng(seed);
  const hw = 0.9;
  const z0 = -len / 2;
  const z1 = len / 2;
  const P: KitPart[] = [slope(0, hw, z0, 0, z1, rise, 0.3, 'terraVermelha', { traversal: 'none' })];
  // Fill under the slab: steps of stone that stay 6 cm under the walking surface.
  const n = Math.max(2, Math.ceil(rise / 0.7));
  for (let i = 0; i < n; i++) {
    const za = z0 + (i / n) * len;
    const zb = z0 + ((i + 1) / n) * len;
    const top = (i / n) * rise - 0.06;
    if (top <= -0.3) continue;
    P.push(span(-hw + 0.05, -0.6, za, hw - 0.05, top, zb, i % 2 ? 'canga' : 'itabirito', { traversal: 'none' }));
  }
  // Edge stones (decoration, near) and a few pebbles on the trail.
  for (const sx of [-1, 1]) {
    for (let k = 0; k < Math.round(len / 1.4); k++) {
      const z = z0 + 0.5 + k * 1.4 + r() * 0.4;
      if (z > z1 - 0.3) break;
      const y = ((z - z0) / len) * rise;
      P.push(box(sx * (hw - 0.12), y + 0.12, z, 0.14 + r() * 0.06, 0.12, 0.2 + r() * 0.1, k % 2 ? 'rochaClara' : 'canga', { ...near, ry: r() * 40 }));
    }
  }
  P.push(slope(0, hw - 0.3, z0, 0.012, z1, rise + 0.012, 0.02, 'terra', { ...near, traversal: 'none' }));
  return P;
}
vertical('rampa-trilha-13', 'Rampa de trilha 13 m', 'passagem', trailRamp(13.2, 4.8, 5), 'none');
vertical('rampa-trilha-9', 'Rampa de trilha 9 m', 'passagem', trailRamp(9.0, 3.8, 9), 'none');
vertical('rampa-trilha-7', 'Rampa de trilha 7 m', 'passagem', trailRamp(7.0, 3.6, 13), 'none');

/** Floating stepping stone (plataforma): a 1.8 m mossy rock top at the base, a rough point of rock under it. Grabbable edges. */
vertical('plataforma-pedra', 'Plataforma de pedra flutuante', 'baixa', [
  span(-0.9, -0.5, -0.9, 0.9, 0, 0.9, 'itabirito', { traversal: 'ledge', relief: 0.04 }),
  spire(0.9, 0.9, -0.5, 1.4, 61, ['canga', 'itabirito']),
  box(0, 0.015, 0, 0.75, 0.015, 0.7, 'musgo', near),
  box(0.5, -0.3, 0.92, 0.3, 0.12, 0.02, 'rochaClara', near),
], 'ledge', [0.8, 1.4]);

/** Grapple anchor (âncora): a stone post with an iron ring on top — a Linha de Varal target. */
vertical('ancora-gancho', 'Âncora de gancho', 'decoracao', [
  cyl(0, 0.6, 0, 0.18, 0.6, 'pedraSabao', { seg: 7, traversal: 'none' }),
  cyl(0, 1.32, 0, 0.2, 0.03, 'ferro', { ...deco, rx: 90, seg: 10, anchor: true }),
  box(0, 0.06, 0, 0.3, 0.06, 0.3, 'canga', near),
], 'none');

// ------------------------------------------------------------------------------------------------ landmarks

/**
 * Sineira: the bell frame of Minas chapels (two whitewashed piers, a beam, a tiled cap) with an interactive bell
 * (VERTICAL_OBJECTIVE): ringing it wakes the event winds tied to its placement (game-core interactives.ts).
 */
vertical('sineira', 'Sineira (sino interativo)', 'baixa', [
  box(0, 0.12, 0, 1.35, 0.12, 0.55, 'pedraSabao'),
  ...[-1, 1].map((sx) => box(sx * 0.95, 1.55, 0, 0.24, 1.4, 0.24, 'cal')),
  ...[-1, 1].map((sx) => box(sx * 0.95, 0.4, 0, 0.27, 0.16, 0.27, 'pedraSabao', near)),
  box(0, 3.05, 0, 1.3, 0.12, 0.2, 'madeiraEscura'),
  { shape: 'gable', x: 0, y: 3.17, z: 0, hx: 1.45, hy: 0.45, hz: 0.42, color: 'telhaColonial', solid: 'none' },
  // The bell and its clapper, hanging from the beam.
  cone(0, 2.45, 0, 0.36, 0.4, 'sino', { ...deco, seg: 12, bell: true }),
  ball(0, 2.08, 0, 0.09, 'ferro', near),
  box(0, 2.88, 0, 0.04, 0.06, 0.04, 'ferro', near),
  // A rope down to hand height.
  box(0.28, 1.7, 0, 0.012, 0.75, 0.012, 'saco', near),
], 'ledge');

/** Cruzeiro: the big wooden cross of Minas hilltops on a stepped stone base; its crossbar is a grapple anchor. */
vertical('cruzeiro-serra', 'Cruzeiro da serra (grande, âncora)', 'alta', [
  box(0, 0.25, 0, 1.0, 0.25, 1.0, 'pedraSabao', { traversal: 'ledge' }),
  box(0, 0.7, 0, 0.65, 0.2, 0.65, 'cantaria', { traversal: 'ledge' }),
  box(0, 3.15, 0, 0.16, 2.25, 0.16, 'madeiraEscura', { traversal: 'none' }),
  box(0, 4.15, 0, 1.15, 0.13, 0.15, 'madeiraEscura', { traversal: 'none', anchor: true }),
  box(0, 4.15, 0.17, 0.25, 0.25, 0.02, 'cal', near),
  box(0, 5.38, 0, 0.12, 0.05, 0.12, 'madeira', near),
], 'none');

/**
 * Capelinha (oratório de beira de estrada), the island's shelter: 3.6 × 4.2 m, whitewash with blue corners and frames, a
 * tiled gable roof, an open arched front toward +Z, a little altar inside (the chest goes here: covered, but the only
 * way in is the front).
 */
function capelinha(): KitPart[] {
  const w = 3.6;
  const d = 4.2;
  const h = 2.9;
  const t = 0.24;
  const P: KitPart[] = [
    span(-w / 2, -0.1, -d / 2, w / 2, 0.12, d / 2, 'pedraSabao'),
    span(-w / 2, 0.12, -d / 2, -w / 2 + t, h, d / 2, 'cal'),
    span(w / 2 - t, 0.12, -d / 2, w / 2, h, d / 2, 'cal'),
    span(-w / 2, 0.12, -d / 2, w / 2, h, -d / 2 + t, 'cal'),
    // Front: two short walls beside a 1.5 m opening, a lintel over it.
    span(-w / 2, 0.12, d / 2 - t, -0.75, h, d / 2, 'cal'),
    span(0.75, 0.12, d / 2 - t, w / 2, h, d / 2, 'cal'),
    span(-0.75, 2.35, d / 2 - t, 0.75, h, d / 2, 'cal'),
    // Corner pilasters, frames, a small window on each side (decoration).
    ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => box(sx * (w / 2 - 0.08), h / 2, sz * (d / 2 - 0.08), 0.13, h / 2 + 0.02, 0.13, 'azulColonial', near))),
    box(0, 2.42, d / 2 + 0.02, 0.85, 0.08, 0.03, 'azulColonial', near),
    ...[-1, 1].map((sx) => box(sx * 0.82, 1.2, d / 2 + 0.02, 0.07, 1.15, 0.03, 'azulColonial', near)),
    ...[-1, 1].map((sx) => box(sx * (w / 2 + 0.02), 1.7, 0, 0.03, 0.35, 0.3, 'madeiraEscura', near)),
    // Altar and its candles.
    box(0, 0.55, -d / 2 + 0.55, 0.8, 0.43, 0.3, 'cal'),
    box(0, 1.0, -d / 2 + 0.55, 0.85, 0.03, 0.33, 'vermelhoColonial', near),
    box(0, 1.55, -d / 2 + 0.3, 0.3, 0.45, 0.05, 'ouro', near),
    ...[-0.5, 0.5].map((x) => cyl(x, 1.12, -d / 2 + 0.55, 0.03, 0.1, 'plasticoBranco', near)),
  ];
  for (const p of gabledRoof(w, d, 1.3, { tile: 'telhaColonial', gable: 'cal', eave: 0.3, ridge: 'telhaEscura' })) P.push({ ...p, y: p.y + h });
  return P;
}
vertical('capelinha', 'Capelinha (oratório)', 'estrutura', capelinha());

// ------------------------------------------------------------------------------------------------ floating islands

/**
 * A floating island (FLOATING_ISLAND): a walkable top slab `w` × `d` with its surface at the base (y = 0; the map's
 * `lift` is the height of the walking surface over the terrain), a stepped rock underside tapering to a point,
 * crystals and dangling roots under it, grass and stones on top. The top's edges are ledges (a short jump can still be
 * saved); the underside is not grabbable.
 */
function island(w: number, d: number, seed: number): KitPart[] {
  const r = rng(seed);
  const P: KitPart[] = [span(-w / 2, -0.9, -d / 2, w / 2, 0, d / 2, 'terraVermelha', { traversal: 'ledge', relief: 0.06, bands: ['canga'] })];
  // Rim stones and the grass cover.
  P.push(box(0, 0.012, 0, w / 2 - 0.25, 0.012, d / 2 - 0.25, 'musgo', near));
  for (let i = 0; i < Math.round((w + d) / 1.6); i++) {
    const a = r() * Math.PI * 2;
    const x = Math.cos(a) * (w / 2 - 0.4) * (0.6 + r() * 0.4);
    const z = Math.sin(a) * (d / 2 - 0.4) * (0.6 + r() * 0.4);
    P.push(box(x, 0.1, z, 0.18 + r() * 0.12, 0.1, 0.15 + r() * 0.1, i % 2 ? 'rochaClara' : 'canga', { ...near, ry: r() * 90 }));
  }
  // Underside: one banded rock narrowing to a point (its collider is the same hull: shots and bodies meet it, nobody
  // grabs it).
  const depth = 7.4;
  P.push(spire(w / 2, d / 2, -0.9, depth, seed * 7 + 1, ['itabirito', 'canga', 'ferrugem']));
  // Crystals growing out of the rock halfway down, pointing down and out (the arquipélago glows a little at dusk).
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + r();
    const f = 0.3 + r() * 0.25;
    const k = spireScale(f) * 0.84;
    P.push(cone(Math.cos(a) * (w / 2) * k, -0.9 - depth * f, Math.sin(a) * (d / 2) * k, 0.16, 0.45, 'cristal', { ...deco, rx: 180 - 35 * Math.sin(a), rz: -35 * Math.cos(a), seg: 5 }));
  }
  // Roots hanging from the slab's overhang, outside the rock.
  for (let i = 0; i < 6; i++) {
    const a = r() * Math.PI * 2;
    const len = 0.8 + r() * 1.6;
    P.push(cyl(Math.cos(a) * (w / 2) * 0.9, -0.9 - len / 2, Math.sin(a) * (d / 2) * 0.9, 0.035, len / 2, i % 2 ? 'musgo' : 'madeiraEscura', { ...near, seg: 4, rz: (r() - 0.5) * 12 }));
  }
  return P;
}
vertical('ilha-flutuante-g', 'Ilha flutuante grande 11×9', 'estrutura', island(11, 9, 41), 'ledge');
vertical('ilha-flutuante-m', 'Ilha flutuante média 7×7', 'estrutura', island(7, 7, 43), 'ledge');
vertical('ilha-flutuante-p', 'Ilha flutuante pequena 5×5', 'estrutura', island(5, 5, 47), 'ledge');

/** A twisted cerrado tree for the islands (trunk collider only, a flat crown). */
vertical('arvore-ilha', 'Árvore da ilha', 'decoracao', [
  cyl(0, 1.0, 0, 0.16, 1.0, 'madeiraEscura', { seg: 6, rz: 7, traversal: 'none' }),
  cyl(0.35, 2.1, 0, 0.08, 0.45, 'madeiraEscura', { ...deco, seg: 5, rz: -35 }),
  cyl(0.2, 2.45, 0.1, 1.15, 0.22, 'folhaCerrado', { ...deco, seg: 8 }),
  cyl(-0.3, 2.2, -0.2, 0.75, 0.18, 'folhaEscura', { ...deco, seg: 7 }),
], 'none', [0.8, 1.3]);

// ------------------------------------------------------------------------------------------------ Serra do Mirante

/**
 * Serra do Mirante (docs/world/SERRA_DO_MIRANTE.md): a three-tier iron-ore massif on the ridge, 16 × 12 m at its foot,
 * the summit 11.6 m over the base. Frame: +Z = the front (the climbing face), +X = the side of the trail.
 *
 * - Route A, trilha (no magic, the longest): ramp 1 up the +X side (z 6.5 → −5.2), the back terrace of tier 1 to the
 *   −X side, ramp 2 up to tier 2's front terrace (−5.2 → 3.2), across it to ramp 3 on the +X side of tier 3
 *   (3.2 → −3.0), and onto the summit from its back corner.
 * - Route B, escalada (the shortest, the most exposed): three climbable faces on the front, one per tier, with the
 *   terraces between them as rest ledges (each face ≈ 40–45 stamina, the terraces refill it).
 * - Route C, aérea: the map's updraft on the −X side and a directional wind from its top across to the summit (winds
 *   are map data, see tools/world/vertical-world.ts).
 * - Summit: the cruzeiro (a landmark and a grapple anchor), a sineira whose bell wakes the corrente toward the
 *   Arquipélago dos Sinos, a chest spot and two boulders: some cover, never a bunker; every route is a way down too.
 */
const MACICO = {
  t1: { x0: -8, x1: 8, z0: -6, z1: 6, top: 4.2 },
  t2: { x0: -6, x1: 5, z0: -4.5, z1: 3.6, top: 8.0 },
  t3: { x0: -3.5, x1: 2.5, z0: -3.4, z1: 2.0, top: 11.6 },
} as const;
const { t1, t2, t3 } = MACICO;

vertical('macico-mirante-base', 'Serra do Mirante: maciço (base)', 'estrutura', [
  ...rockMass(t1.x0, -3, t1.z0, t1.x1, t1.top, t1.z1, ['itabirito', 'canga', 'ferrugem'], 101),
  // Ramp 1's landing at the back corner, flush with the terrace.
  span(t1.x1, -1, -6.6, 9.8, t1.top, -4.6, 'canga', { relief: RELIEF, bands: ['itabirito'] }),
  // Boulders at the foot (low cover on the approach), reaching 1 m into the ground: the massif's frame is a tangent
  // plane, so 10 m from its centre the planet's surface is already ≈ 0.5 m under its y = 0.
  ...[[-6.5, 7.6, 0.8], [4.8, 7.4, 0.7], [-9.2, -3.5, 0.9], [9.0, 3.6, 0.6]].map(([x, z, s], i) => boulder(x!, (s! * 1.2 - 1) / 2, z!, s!, (s! * 1.2 + 1) / 2, s! * 0.85, i % 2 ? 'canga' : 'itabirito', 110 + i, { ry: i * 33 + 10 })),
], 'none');
vertical('macico-mirante-meio', 'Serra do Mirante: maciço (meio)', 'estrutura', [
  ...rockMass(t2.x0, t1.top - 0.3, t2.z0, t2.x1, t2.top, t2.z1, ['canga', 'itabirito', 'ferrugem'], 202),
  // Ramp 2's landing pillar, beside tier 2's front terrace.
  span(-8, t1.top - 0.2, 3.2, t2.x0, t2.top, 4.8, 'itabirito', { relief: RELIEF, bands: ['canga', 'ferrugem'] }),
  // A low wall of stones on the front terrace of tier 1 (cover while resting from the climb), sunk a little into it.
  ...[-5.2, 4.2].map((x, i) => boulder(x, t1.top + 0.34, 5.3, 0.9, 0.46, 0.35, i ? 'rochaClara' : 'canga', 210 + i, { ry: i ? -8 : 6 })),
], 'none');
vertical('macico-mirante-cume', 'Serra do Mirante: maciço (cume)', 'estrutura', [
  ...rockMass(t3.x0, t2.top - 0.3, t3.z0, t3.x1, t3.top, t3.z1, ['itabirito', 'ferrugem', 'canga'], 303),
  // Ramp 3's landing pillar at tier 3's back corner.
  span(t3.x1, t2.top - 0.2, -4.4, 4.6, t3.top, -3.0, 'canga', { relief: RELIEF, bands: ['itabirito'] }),
  // Two boulders on the summit: some cover, open sky over them (clear of the climb's arrival and ramp 3's way in),
  // sunk a little into the summit so no point of them floats.
  boulder(-2.9, t3.top + 0.39, 1.1, 0.55, 0.51, 0.48, 'rochaClara', 310, { ry: 8 }),
  boulder(2.0, t3.top + 0.29, 0.0, 0.45, 0.41, 0.42, 'canga', 311, { ry: -6 }),
], 'none');
/**
 * The crest behind the massif (its silhouette from afar: a serra, not a stepped block): three rock blades rising from
 * the ground along the back of tier 1 to 12–17 m (the tallest shows over the summit seen from the front, under the
 * cruzeiro's top), flush with its back face up to 1.4 m over the back terrace, with gaps between them (the trail
 * there stays exposed in places). Out of reach without magic; their ridges are knife edges, no perch. Its own piece, so it dissolves alone between the camera and someone
 * on the back terrace. Clear of the three routes, ramp 1's landing and the west updraft.
 */
vertical('crista-mirante', 'Serra do Mirante: crista dos fundos', 'alta', [
  blade(-6.4, t1.z0, 3.0, 2.6, -1.6, t1.top + 1.4, 12.0, 1.4, 401, ['itabirito', 'canga', 'ferrugem']),
  blade(-1.6, t1.z0, 3.6, 2.8, -1.6, t1.top + 1.4, 17.0, 2.2, 402, ['itabirito', 'ferrugem', 'canga']),
  blade(3.0, t1.z0, 3.2, 2.6, -1.6, t1.top + 1.4, 14.5, 1.8, 403, ['canga', 'itabirito', 'ferrugem']),
], 'none');

addBuilding({
  id: 'serra-do-mirante',
  name: 'Serra do Mirante (maciço com 3 rotas)',
  category: 'vertical',
  halfX: 10,
  halfZ: 10,
  settle: 'center',
  pieces: [
    { prefab: 'macico-mirante-base', x: 0, z: 0 },
    { prefab: 'macico-mirante-meio', x: 0, z: 0 },
    { prefab: 'macico-mirante-cume', x: 0, z: 0 },
    { prefab: 'crista-mirante', x: 0, z: 0 },
    // Route B: one climbable face per tier, on the front.
    { prefab: 'paredao-escalada-4', x: 0, z: t1.z1 },
    { prefab: 'paredao-escalada-38', x: 0.2, y: t1.top, z: t2.z1 },
    { prefab: 'paredao-escalada-36', x: 0.5, y: t2.top, z: t3.z1 },
    // Route A: the three trail ramps (yaw 180 turns a ramp to rise toward −Z). The first starts 0.6 m under the base:
    // 12 m from the centre the ground lies that far under the massif's (tangent) frame.
    { prefab: 'rampa-trilha-13', x: 8.9, y: -0.6, z: 1.35, yaw: 180 },
    { prefab: 'rampa-trilha-9', x: -7.0, y: t1.top, z: -1.0 },
    { prefab: 'rampa-trilha-7', x: 3.6, y: t2.top, z: 0.1, yaw: 180 },
    // The summit.
    { prefab: 'cruzeiro-serra', x: -2.4, y: t3.top, z: -1.4 },
    { prefab: 'sineira', x: 0, y: t3.top, z: -2.7 },
  ],
  notes: 'Rotas: A (rampas pelo lado +X), B (paredões na frente), C (corrente ascendente no lado −X). Baú no cume (exposto).',
});

// ------------------------------------------------------------------------------------------------ Arquipélago dos Sinos

/** Ilha do Sino: the big island with the capelinha (a covered chest), the sineira and two anchors on its rim. */
addBuilding({
  id: 'ilha-do-sino',
  name: 'Ilha do Sino (capelinha e sineira)',
  category: 'vertical',
  halfX: 5.5,
  halfZ: 4.5,
  settle: 'center',
  pieces: [
    { prefab: 'ilha-flutuante-g', x: 0, z: 0 },
    { prefab: 'capelinha', x: -2.6, z: -0.4, yaw: 270 },
    { prefab: 'sineira', x: 2.6, z: -2.6 },
    { prefab: 'arvore-ilha', x: 3.4, z: 2.4 },
    { prefab: 'arvore-ilha', x: -4.3, z: 3.3 },
    { prefab: 'ancora-gancho', x: -5.0, z: -3.9 },
    { prefab: 'ancora-gancho', x: 5.0, z: 3.9 },
  ],
  notes: 'Acesso universal: corrente ascendente no lado oeste + planagem. Baú dentro da capelinha. O sino acorda a corrente para a Ilha da Torre.',
});
/** Ilha do Oratório: the middle island, joined to the Ilha do Sino by a rope bridge; ruins for cover. */
addBuilding({
  id: 'ilha-do-oratorio',
  name: 'Ilha do Oratório (ruína)',
  category: 'vertical',
  halfX: 3.5,
  halfZ: 3.5,
  settle: 'center',
  pieces: [
    { prefab: 'ilha-flutuante-m', x: 0, z: 0 },
    { prefab: 'ruina-mureta', x: -1.2, z: 1.6 },
    { prefab: 'ruina-pilar', x: 1.8, z: -1.6 },
    { prefab: 'ancora-gancho', x: 3.0, z: -3.0 },
  ],
  notes: 'Ponte suspensa a oeste (Ilha do Sino); plataformas de pedra ao norte sobem para a Ilha da Torre.',
});
/** Ilha da Torre: the highest and smallest island, open to the sky (the chest is exposed). */
addBuilding({
  id: 'ilha-da-torre',
  name: 'Ilha da Torre (a mais alta)',
  category: 'vertical',
  halfX: 2.5,
  halfZ: 2.5,
  settle: 'center',
  pieces: [
    { prefab: 'ilha-flutuante-p', x: 0, z: 0 },
    { prefab: 'ruina-pilar', x: -1.4, z: -1.4 },
    { prefab: 'ancora-gancho', x: 1.9, z: 1.9 },
  ],
  notes: 'Acesso: plataformas de pedra (sem magia) ou a corrente do sino da Ilha do Sino.',
});

/** Ruins for the islands: a broken low wall (low cover) and a broken pillar (high cover). */
vertical('ruina-mureta', 'Ruína: mureta quebrada', 'baixa', [
  span(-1.4, 0, -0.2, 0.6, 0.9, 0.2, 'cantaria'),
  span(0.6, 0, -0.2, 1.4, 0.5, 0.2, 'cantaria'),
  box(-0.4, 0.95, 0, 0.8, 0.05, 0.22, 'musgo', near),
  box(1.7, 0.12, 0.3, 0.25, 0.12, 0.2, 'cantaria', { ...near, ry: 30 }),
]);
vertical('ruina-pilar', 'Ruína: pilar quebrado', 'alta', [
  box(0, 0.12, 0, 0.5, 0.12, 0.5, 'pedraSabao'),
  box(0, 1.2, 0, 0.32, 1.0, 0.32, 'cal'),
  box(0.05, 2.35, 0, 0.3, 0.15, 0.3, 'cal', { rz: 9 }),
  box(0.55, 0.15, 0.4, 0.3, 0.15, 0.22, 'cal', { ...near, ry: 25, rz: 12 }),
]);

