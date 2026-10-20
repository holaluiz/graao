/**
 * GRAAO world kit, core: the types, palette, shared dimensions and part builders every kit family uses
 * (docs/world/MG_ARCHITECTURE_KITS.md). The families register their prefabs and buildings here at import time:
 * kitUrbano.ts (Bairro do Horizonte, BH), kitColonial.ts (Vila das Lanternas, Ouro Preto), kitModernista.ts (Lago
 * Espelho, Pampulha), kitNatural.ts (Serra and Bosque) and kitProps.ts (props brasileiros). kit.ts exports the lot.
 *
 * A **prefab** is a list of parts (boxes, cylinders, cones, balls, gables, hipped roofs) in a local frame — X side
 * (right), Y up, Z forward (a wall's exterior, a building's front) — with the base point at y = 0. Every part says how
 * it plays: `full` blocks movement, shots and sight; `move` blocks movement only (railings, fences: shots pass between
 * the bars); `none` is decoration. Collider-only parts (`visible: false`) sit under decoration that would be bumpy to
 * walk on (a ramp under the steps of a stair). The client draws the visible parts, the server and the client build the
 * same colliders from the same numbers (game-core layout.ts), so what you see is what stops you.
 *
 * A **building** is a rigid composition of prefabs (floor, walls, slab, parapets, stair...) placed in one tangent frame
 * (a building never bends with the planet). Each piece becomes its own placement, so a wall between the camera and
 * the player dissolves alone. A piece's `yaw` turns it clockwise seen from above, like a map yaw: with the frame
 * X = up × forward, yaw 90 faces −X and yaw 270 faces +X. On a slope the layout lifts a building to the highest ground
 * under it and adds a stone base (embasamento) and door steps where the ground falls away (game-core buildingSite).
 *
 * Shared dimensions (m): floor top 0.15, wall 3.0 high from the floor, roof slab 0.2 → flat roof ("laje") top 3.35;
 * doors 1.3 × 2.4; windows 1.0 wide, sill 1.0, top 2.1 (shoot-through, too small to climb through); a character is
 * 1.6 m tall (capsule radius 0.3), jumps ≈ 1.3 m and ≈ 2.4 m with the double jump.
 */

import type { TraversalSurface } from '../traversal';

// ------------------------------------------------------------------------------------------------ palette

/**
 * Flat colours per function (docs/world/MINAS_GERAIS_ART_DIRECTION.md): plaster and whitewash, colonial door and
 * window colours, terracotta, soapstone, iron ore reds, cerrado greens. The ink pass outlines where colours meet, so a
 * colour change is also a drawn line.
 */
export const KIT_PALETTE = {
  // BH plaster (Bairro do Horizonte).
  reboco: '#f3e3c8',
  rebocoRosa: '#f2c4b0',
  rebocoVerde: '#cfe6d4',
  rebocoAzul: '#c8dcef',
  rebocoAmarelo: '#f6dc95',
  rebocoLaranja: '#f0b27a',
  rebocoLilas: '#d9c6e8',
  rodape: '#d6b08d',
  piso: '#cdbfa7',
  laje: '#d8d1c4',
  degrau: '#e2d9c8',
  concreto: '#c4c0b6',
  concretoEscuro: '#8f8c86',
  asfalto: '#6e6b70',
  calcada: '#d9cfbd',
  telha: '#cf6a4c',
  madeira: '#8a6248',
  madeiraClara: '#c09062',
  madeiraEscura: '#5e3d2b',
  pedra: '#b3a593',
  calcamento: '#c7b597',
  terra: '#c9a578',
  terraVermelha: '#b9714f',
  metal: '#8f989e',
  ferro: '#3d3a45',
  aco: '#aab4ba',
  caixaDagua: '#4b77b6',
  lona: '#e0a03a',
  lonaVermelha: '#d4574a',
  lonaAzul: '#4f8fc0',
  lonaVerde: '#5ea36a',
  lanterna: '#ffd879',
  folha: '#6fa84f',
  roupa1: '#e86a5a',
  roupa2: '#f2c14e',
  roupa3: '#5aa7d9',
  roupa4: '#f4f1ea',
  relogio: '#fbf7ee',
  porta: '#3f8f8a',
  plasticoVermelho: '#d8463c',
  plasticoAmarelo: '#f2c230',
  plasticoBranco: '#f1efe9',
  vidro: '#86b9cc',
  muralA: '#e8573f',
  muralB: '#2f8fc9',
  muralC: '#f4c43c',
  muralD: '#3fa66b',
  muralE: '#8b4fc0',
  // Colonial (Vila das Lanternas): whitewash, painted frames, soapstone, terracotta tiles.
  cal: '#f8f2e4',
  calAmarelo: '#f3dc9c',
  calAzul: '#d5e3ef',
  cantaria: '#a9a58f',
  pedraSabao: '#8e9a87',
  pedraEscura: '#857868',
  peDeMoleque: '#a89a86',
  azulColonial: '#2f6fa8',
  verdeColonial: '#2f7d5b',
  vermelhoColonial: '#b33b2e',
  amareloOcre: '#d99a2b',
  telhaColonial: '#c25a3a',
  telhaEscura: '#9e4630',
  ouro: '#e5bd4f',
  sino: '#b9853a',
  // Modernista (Lago Espelho): white concrete, blue tiles, garden greens.
  brancoModerno: '#f4f4ef',
  azulejo: '#3a6db8',
  azulejoClaro: '#e9f0f7',
  pastilha: '#7fb4c9',
  deck: '#a87a52',
  // Natural (Serra and Bosque): iron ore, canga, cerrado and campo rupestre.
  canga: '#7b4b3a',
  ferrugem: '#a55d3f',
  itabirito: '#625a66',
  quartzito: '#d8d2c4',
  rochaClara: '#b9ae9e',
  musgo: '#7f9a52',
  capim: '#c8b66a',
  folhaCerrado: '#7f9a4a',
  folhaEscura: '#4f7a3f',
  ipeAmarelo: '#f2c230',
  ipeRoxo: '#b5609f',
  palmeira: '#5f9a48',
  troncoClaro: '#a58566',
  agua: '#5fb7c8',
  espuma: '#e9f7f9',
  cristal: '#9fe3ef',
  horta: '#4f9a3c',
  abobora: '#e58b2e',
  tomate: '#d9483b',
  cafe: '#6b4630',
  saco: '#d7c29a',
  queijo: '#f2d27a',
  doce: '#c9622e',
  pao: '#d9a35c',
  fruta1: '#e9b13a',
  fruta2: '#d6463a',
  fruta3: '#79b043',
} as const;

export type KitColor = keyof typeof KIT_PALETTE;

// ------------------------------------------------------------------------------------------------ parts and prefabs

/** full: blocks movement, shots and sight · move: blocks movement only · none: decoration. */
export type KitSolid = 'full' | 'move' | 'none';

export interface KitPart {
  /**
   * box: half extents hx, hy, hz · cyl: radius hx, half height hy · cone: base radius hx, half height hy (apex up)
   * · ball: radius hx · gable: triangular prism, base on y = 0 from z = −hz to +hz, apex at y = hy, thickness 2·hx
   * · hip: hipped roof, base rectangle 2·hx × 2·hz on y = 0, ridge along X at y = hy, hips at 45° in plan (a square
   * base makes a pyramid) · hull: the convex hull of `pts` (rocks), hx, hy, hz bounding them.
   */
  shape: 'box' | 'cyl' | 'cone' | 'ball' | 'gable' | 'hip' | 'hull';
  /** Centre (box, cyl, cone, ball) or base midpoint (gable, hip) in the prefab frame. */
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
  /** Rotation in degrees, applied like a three.js Euler in 'XYZ' order. */
  rx?: number;
  ry?: number;
  rz?: number;
  color: KitColor;
  /** Default 'full'. */
  solid?: KitSolid;
  /** Default true. False: a collider with nothing drawn (a ramp under steps). */
  visible?: boolean;
  /** Radial segments of cylinders and cones (visual; default 10). */
  seg?: number;
  /** hull: its points (x, y, z triples) around the centre, in the part frame; the collider and the drawing share them. */
  pts?: number[];
  /**
   * Boxes drawn as broken rock (visual; the collider stays the box): the faces break into facets up to `relief` m out
   * of the collider and twice that into it; the top stays flat to walk on.
   */
  relief?: number;
  /** Strata (visual): the sides are banded in the part's colour and these; the top keeps the part's colour. */
  bands?: KitColor[];
  /**
   * Level of detail: 'near' parts are drawn only up close (frames, sills, small props); 'far' keeps a small
   * decoration drawn from far away (a lantern on a tower). Default: small decoration (≤ 0.3 m) is 'near'.
   */
  lod?: 'near' | 'far';
  /** A grapple point (Linha de Varal and other anchors): the part's centre is exported in layout.anchors. */
  anchor?: boolean;
  /** How the part plays for climbing and ledges (TraversalSurface); default: the prefab's, else 'ledge' when solid. */
  traversal?: TraversalSurface;
  /**
   * An interactive bell (docs/world/FLOATING_ISLANDS.md): the part's centre is exported in layout.bells; ringing it
   * (F, server-authoritative) wakes the map's winds whose `trigger` is this placement for a while.
   */
  bell?: boolean;
}

/** How a prefab plays in a fight (docs/world/MG_ARCHITECTURE_KITS.md). */
export type KitCover = 'alta' | 'baixa' | 'destrutivel' | 'ocultacao' | 'passagem' | 'estrutura' | 'decoracao';

/** Editor families (COLONIAL, URBANO_BH, MODERNISTA, SERRA, BOSQUE, PROPS_BRASILEIROS) and street tiles. */
export type KitCategory = 'colonial' | 'urbano_bh' | 'modernista' | 'serra' | 'bosque' | 'props' | 'rua' | 'vertical';

export const KIT_CATEGORY_NAMES: Record<KitCategory, string> = {
  colonial: 'COLONIAL',
  urbano_bh: 'URBANO_BH',
  modernista: 'MODERNISTA',
  serra: 'SERRA',
  bosque: 'BOSQUE',
  props: 'PROPS_BRASILEIROS',
  rua: 'RUAS_E_TRILHAS',
  vertical: 'VERTICAL',
};

export interface KitPrefab {
  id: string;
  /** pt-BR (editor). */
  name: string;
  category: KitCategory;
  cover: KitCover;
  parts: KitPart[];
  /** Lean with the ground (street tiles) instead of standing on the radial up (anything with walls). */
  alignToGround?: boolean;
  /** Scale range the editor allows (buildings and their modules: fixed). */
  scale?: [number, number];
  /** Wall modules: length along X (m), so buildings can lay them end to end. */
  length?: number;
  /** Drawn with the animated water material (streams, waterfalls, fountain basins); always decoration. */
  material?: 'water';
  /**
   * How its solid parts play for climbing and ledges (TraversalSurface, docs/gameplay/CLIMBING.md): default 'ledge'
   * (edges grabbable where the geometry allows); 'climb' for rock faces and cliffs; 'none' for what must not be
   * grabbed. A part's own `traversal` wins.
   */
  traversal?: TraversalSurface;
  /**
   * Door wall modules: the opening holds a door the game opens and closes (game-core interactives.ts). The module's
   * own parts leave the opening empty; the leaves are drawn and collided per room, from these numbers.
   */
  door?: KitDoor;
}

/**
 * A door in a wall module's opening: width and height above the floor top (m), one leaf hinged on the left jamb or two
 * leaves hinged on both jambs (colonial doors, garage gates), their paint. The leaves swing 90° into the building.
 */
export interface KitDoor {
  w: number;
  h: number;
  style: 'simples' | 'dupla';
  color: KitColor;
}

/** A door of a building (its wall module's position and yaw in the building frame): see KitDoor. */
export interface KitLeaf extends KitDoor {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** A piece of a building: a prefab at (x, y, z) in the building frame, turned `yaw` degrees (clockwise from +Z). */
export interface KitPiece {
  prefab: string;
  x: number;
  y?: number;
  z: number;
  yaw?: number;
}

export interface KitBuilding {
  id: string;
  name: string;
  category: KitCategory;
  /** Footprint half extents (m): the editor, scatter clearing, the map overview and the ground check on slopes. */
  halfX: number;
  halfZ: number;
  pieces: KitPiece[];
  /**
   * How the layout sets the building on the terrain: 'max' (default) lifts it to the highest ground under the
   * footprint and adds a stone base where the ground falls away; 'center' keeps the base at the ground under its
   * centre (pavilions, open structures whose posts reach into the ground).
   */
  settle?: 'max' | 'center';
  /** The foundation piece (found by addBuilding: the piece whose prefab starts with `fundacao-`). */
  foundation?: { x: number; z: number; w: number; d: number };
  /**
   * Ground-floor door openings in the building frame (centre of the threshold and the outward direction as a yaw):
   * on a slope the layout adds steps in front of any door the ground falls away from.
   */
  doors?: { x: number; z: number; yaw: number }[];
  /** Interactive doors: every piece whose prefab is a door module (KitPrefab.door), found by checkBuildings. */
  leaves?: KitLeaf[];
  /** Points of interest in the building frame (chest spots, nav links): see the map's chest spots. */
  notes?: string;
}

// ------------------------------------------------------------------------------------------------ registry

const PREFABS: Record<string, KitPrefab> = {};
const BUILDINGS: Record<string, KitBuilding> = {};

/** Registers a prefab (ids are unique across every family). */
export function addPrefab(p: KitPrefab): KitPrefab {
  if (PREFABS[p.id]) throw new Error(`kit: duplicate prefab ${p.id}`);
  PREFABS[p.id] = p;
  return p;
}

export function addBuilding(b: KitBuilding): KitBuilding {
  if (BUILDINGS[b.id] || PREFABS[b.id]) throw new Error(`kit: duplicate building ${b.id}`);
  const f = b.pieces.find((p) => p.prefab.startsWith('fundacao-'));
  const m = f && /(\d+)x(\d+)$/.exec(f.prefab);
  if (f && m) b.foundation = { x: f.x, z: f.z, w: Number(m[1]), d: Number(m[2]) };
  BUILDINGS[b.id] = b;
  return b;
}

export const prefabRegistry = (): Record<string, KitPrefab> => PREFABS;
/**
 * Every building piece names a registered prefab (checked once all families are loaded: see kit.ts), and every door
 * module among its pieces becomes one of its interactive doors (`leaves`).
 */
export function checkBuildings(): void {
  for (const b of Object.values(BUILDINGS)) {
    const leaves: KitLeaf[] = [];
    for (const piece of b.pieces) {
      const p = PREFABS[piece.prefab];
      if (!p) throw new Error(`kit: building ${b.id} uses unknown prefab ${piece.prefab}`);
      if (p.door) leaves.push({ ...p.door, x: piece.x, y: piece.y ?? 0, z: piece.z, yaw: piece.yaw ?? 0 });
    }
    if (leaves.length) b.leaves = leaves;
  }
}
export const buildingRegistry = (): Record<string, KitBuilding> => BUILDINGS;

// ------------------------------------------------------------------------------------------------ dimensions

export const KIT = {
  floorTop: 0.15,
  wallH: 3.0,
  wallT: 0.24,
  slab: 0.2,
  /** Top of a flat roof (laje) above the building base. */
  roofTop: 0.15 + 3.0 + 0.2,
  /** Top of the walls (bottom of the slab). */
  wallTop: 0.15 + 3.0,
  parapetH: 0.85,
  parapetT: 0.16,
  door: { w: 1.3, h: 2.4 },
  window: { w: 1.0, sill: 1.0, top: 2.1 },
  /** A building's foundation goes this deep, so it never floats on gentle slopes. */
  foundation: 0.8,
  stair: { rise: 3.35, run: 4.8, width: 1.2, steps: 16, landing: 1.2 },
  lowWall: 1.1,
  /** Door steps (soleira): rise and tread of one step, most steps a stoop may have. */
  stoop: { rise: 0.19, tread: 0.29, width: 1.7, maxSteps: 9 },
  /** Stone base depths the layout picks from when a building stands on a slope (m below the base). */
  plinthDepths: [1.6, 2.4, 3.2, 4.0],
} as const;

// ------------------------------------------------------------------------------------------------ part helpers

export const DEG = Math.PI / 180;

export const box = (x: number, y: number, z: number, hx: number, hy: number, hz: number, color: KitColor, o: Partial<KitPart> = {}): KitPart => ({ shape: 'box', x, y, z, hx, hy, hz, color, ...o });
export const cyl = (x: number, y: number, z: number, r: number, hh: number, color: KitColor, o: Partial<KitPart> = {}): KitPart => ({ shape: 'cyl', x, y, z, hx: r, hy: hh, hz: r, color, ...o });
export const cone = (x: number, y: number, z: number, r: number, hh: number, color: KitColor, o: Partial<KitPart> = {}): KitPart => ({ shape: 'cone', x, y, z, hx: r, hy: hh, hz: r, color, ...o });
export const ball = (x: number, y: number, z: number, r: number, color: KitColor, o: Partial<KitPart> = {}): KitPart => ({ shape: 'ball', x, y, z, hx: r, hy: r, hz: r, color, ...o });

/** A convex rock: the hull of `pts` (x, y, z triples in the prefab frame), recentred on their bounding box. */
export function hull(pts: number[], color: KitColor, o: Partial<KitPart> = {}): KitPart {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pts.length; i++) {
    lo[i % 3] = Math.min(lo[i % 3]!, pts[i]!);
    hi[i % 3] = Math.max(hi[i % 3]!, pts[i]!);
  }
  const c = [0, 1, 2].map((k) => (lo[k]! + hi[k]!) / 2);
  return { shape: 'hull', x: c[0]!, y: c[1]!, z: c[2]!, hx: (hi[0]! - lo[0]!) / 2, hy: (hi[1]! - lo[1]!) / 2, hz: (hi[2]! - lo[2]!) / 2, pts: pts.map((v, i) => v - c[i % 3]!), color, ...o };
}
export const deco = { solid: 'none' as const };
export const ghost = { visible: false };
export const near = { solid: 'none' as const, lod: 'near' as const };

/** A box from (x0, y0, z0) to (x1, y1, z1). */
export const span = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: KitColor, o: Partial<KitPart> = {}): KitPart =>
  box((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, Math.abs(z1 - z0) / 2, color, o);

/** A thin slab (thickness `th`) from (z0, y0) to (z1, y1) in the YZ plane, centred on x, half width hx: ramps, roof planes. */
export function slope(x: number, hx: number, z0: number, y0: number, z1: number, y1: number, th: number, color: KitColor, o: Partial<KitPart> = {}): KitPart {
  const len = Math.hypot(z1 - z0, y1 - y0);
  const ang = Math.atan2(y1 - y0, z1 - z0);
  // The top face runs through the two points; the centre sits th/2 under it.
  const cz = (z0 + z1) / 2 + Math.sin(ang) * (th / 2);
  const cy = (y0 + y1) / 2 - Math.cos(ang) * (th / 2);
  return box(x, cy, cz, hx, th / 2, len / 2, color, { rx: -ang / DEG, ...o });
}

/** A bar of thickness `th` (depth 2·hz along Z) from (x0, y0) to (x1, y1) in the XY plane: arches seen from the front. */
export function chordXY(x0: number, y0: number, x1: number, y1: number, th: number, hz: number, color: KitColor, o: Partial<KitPart> = {}): KitPart {
  const len = Math.hypot(x1 - x0, y1 - y0);
  return box((x0 + x1) / 2, (y0 + y1) / 2, 0, len / 2 + th * 0.2, th / 2, hz, color, { rz: Math.atan2(y1 - y0, x1 - x0) / DEG, ...o });
}

/** Rotates a list of parts by `yaw` degrees around Y (clockwise from above, like a map yaw) and moves it by (dx, dy, dz). */
export function place(parts: KitPart[], dx: number, dy: number, dz: number, yaw = 0): KitPart[] {
  const a = -yaw * DEG;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return parts.map((p) => {
    const x = p.x * c + p.z * s;
    const z = -p.x * s + p.z * c;
    if (!yaw) return { ...p, x: x + dx, y: p.y + dy, z: z + dz };
    if (p.rx || p.rz) throw new Error('kit: place() with yaw only turns parts without X/Z rotation');
    return { ...p, x: x + dx, y: p.y + dy, z: z + dz, ry: (p.ry ?? 0) + a / DEG };
  });
}

/** Wooden crate with its edge bands (decoration over a solid core). */
export function crate(x: number, y: number, z: number, s = 0.45, ry = 0, solid: KitSolid = 'full', color: KitColor = 'madeiraClara'): KitPart[] {
  return [
    box(x, y + s, z, s, s, s, color, { ry, solid }),
    box(x, y + s, z, s + 0.02, 0.06, s + 0.02, 'madeira', { ...deco, ry }),
    box(x, y + s * 2 - 0.03, z, s + 0.02, 0.04, s + 0.02, 'madeira', { ...deco, ry }),
  ];
}

/** A string of lanterns sagging between two points `len` apart along Z (decoration). */
export function lanternString(len: number, sag: number, colors: KitColor[]): KitPart[] {
  const parts: KitPart[] = [];
  const pts = [0, 0.33, 0.67, 1].map((u) => ({ z: (u - 0.5) * len, y: -4 * sag * u * (1 - u) }));
  for (let i = 0; i < 3; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const l = Math.hypot(b.z - a.z, b.y - a.y);
    parts.push(box(0, (a.y + b.y) / 2, (a.z + b.z) / 2, 0.015, 0.015, l / 2, 'ferro', { ...deco, lod: 'far', rx: -Math.atan2(b.y - a.y, b.z - a.z) / DEG }));
  }
  const n = Math.max(3, Math.round(len / 1.1));
  for (let i = 1; i < n; i++) {
    const u = i / n;
    const y = -4 * sag * u * (1 - u);
    parts.push(box(0, y - 0.22, (u - 0.5) * len, 0.11, 0.14, 0.11, colors[i % colors.length]!, { ...deco, lod: 'far' }));
  }
  return parts;
}

// ------------------------------------------------------------------------------------------------ walls

export type WallKind = 'cheia' | 'janela' | 'porta' | 'vitrine' | 'portao' | 'aco';

export interface WallStyle {
  /** Plaster colour. */
  color: KitColor;
  /** Base band (rodapé / barrado), its height and colour. */
  plinth?: { h: number; color: KitColor };
  /** Window and door frame colour, shutter / door leaf colour. */
  frame?: KitColor;
  leaf?: KitColor;
  /** Colonial: a framed window with two open shutters and a sill; BH: a plain frame with glass. */
  look?: 'colonial' | 'bh';
  /** Wall height above the base (default KIT.wallTop). */
  height?: number;
  /** No base band (upper storeys). */
  upper?: boolean;
  /** Colonial doors: draw the two leaves folded open (default). False: the opening is left for an interactive door. */
  openLeaves?: boolean;
}

/** A wall segment along X (length `len`), exterior toward +Z, from the base to `style.height`. */
export function wall(len: number, kind: WallKind, style: WallStyle): KitPart[] {
  const f = KIT.floorTop;
  const t = KIT.wallT;
  const top = style.height ?? KIT.wallTop;
  const ht = t / 2;
  const color = style.color;
  const frame = style.frame ?? (style.look === 'colonial' ? 'cantaria' : 'porta');
  const leaf = style.leaf ?? 'porta';
  const parts: KitPart[] = [];
  const full = (y0: number, y1: number, x0: number, x1: number) => parts.push(box((x0 + x1) / 2, (y0 + y1) / 2, 0, (x1 - x0) / 2, (y1 - y0) / 2, ht, color));
  const l = len / 2;
  const sill0 = style.upper ? 0.9 : f + KIT.window.sill;
  if (kind === 'cheia') full(0, top, -l, l);
  else if (kind === 'janela') {
    const w = len >= 3 ? 1.4 : KIT.window.w;
    const sill = sill0;
    const lintel = sill0 + (KIT.window.top - KIT.window.sill);
    full(0, sill, -l, l);
    full(lintel, top, -l, l);
    full(sill, lintel, -l, -w / 2);
    full(sill, lintel, w / 2, l);
    if (style.look === 'colonial') {
      // Stone or painted frame (moldura), a sill, two open wooden shutters and a dark recess (the glass behind).
      parts.push(box(0, sill - 0.05, ht + 0.06, w / 2 + 0.16, 0.06, 0.09, frame, near));
      parts.push(box(0, lintel + 0.09, ht + 0.04, w / 2 + 0.16, 0.09, 0.06, frame, near));
      parts.push(box(-w / 2 - 0.07, (sill + lintel) / 2, ht + 0.04, 0.07, (lintel - sill) / 2, 0.06, frame, near));
      parts.push(box(w / 2 + 0.07, (sill + lintel) / 2, ht + 0.04, 0.07, (lintel - sill) / 2, 0.06, frame, near));
      parts.push(box(-w / 2 - 0.42, (sill + lintel) / 2, ht + 0.035, 0.27, (lintel - sill) / 2 - 0.02, 0.025, leaf, near));
      parts.push(box(w / 2 + 0.42, (sill + lintel) / 2, ht + 0.035, 0.27, (lintel - sill) / 2 - 0.02, 0.025, leaf, near));
    } else {
      parts.push(box(0, sill - 0.04, ht + 0.06, w / 2 + 0.1, 0.05, 0.07, 'madeira', near));
      parts.push(box(-w / 2 - 0.22, (sill + lintel) / 2, ht + 0.03, 0.2, (lintel - sill) / 2, 0.03, leaf, near));
      parts.push(box(w / 2 + 0.22, (sill + lintel) / 2, ht + 0.03, 0.2, (lintel - sill) / 2, 0.03, leaf, near));
    }
  } else if (kind === 'aco') {
    // Rolled-up steel shop door (porta de aço de enrolar): a wide opening with the roll box above it.
    const w = 2.8;
    const head = f + 2.5;
    full(0, top, -l, -w / 2);
    full(0, top, w / 2, l);
    full(head, top, -w / 2, w / 2);
    parts.push(box(0, head + 0.1, ht + 0.1, w / 2 + 0.05, 0.1, 0.1, 'aco', deco));
    for (const sx of [-1, 1]) parts.push(box(sx * (w / 2 + 0.04), head / 2, ht + 0.04, 0.05, head / 2, 0.05, 'aco', near));
  } else {
    const w = kind === 'vitrine' ? 2.6 : kind === 'portao' ? 2.4 : style.look === 'colonial' ? 1.4 : KIT.door.w;
    const head = f + (style.look === 'colonial' && kind === 'porta' ? 2.55 : KIT.door.h);
    full(0, top, -l, -w / 2);
    full(0, top, w / 2, l);
    full(head, top, -w / 2, w / 2);
    const fc: KitColor = kind === 'vitrine' ? 'madeira' : frame;
    if (style.look === 'colonial' && kind === 'porta') {
      // Stone door frame (portada) with a lintel, and the two leaves folded open against the inside wall.
      parts.push(box(-w / 2 - 0.09, head / 2, ht + 0.05, 0.09, head / 2, 0.07, fc, near));
      parts.push(box(w / 2 + 0.09, head / 2, ht + 0.05, 0.09, head / 2, 0.07, fc, near));
      parts.push(box(0, head + 0.12, ht + 0.05, w / 2 + 0.2, 0.12, 0.08, fc, near));
      if (style.openLeaves !== false) {
        parts.push(box(-w / 2 + 0.06, (head - 0.1) / 2 + 0.05, -ht - 0.36, 0.035, (head - 0.1) / 2, 0.34, leaf, { ...near, ry: 0 }));
        parts.push(box(w / 2 - 0.06, (head - 0.1) / 2 + 0.05, -ht - 0.36, 0.035, (head - 0.1) / 2, 0.34, leaf, { ...near, ry: 0 }));
      }
    } else {
      parts.push(box(-w / 2 - 0.05, head / 2, ht + 0.03, 0.06, head / 2, 0.04, fc, near));
      parts.push(box(w / 2 + 0.05, head / 2, ht + 0.03, 0.06, head / 2, 0.04, fc, near));
      parts.push(box(0, head + 0.05, ht + 0.03, w / 2 + 0.11, 0.06, 0.04, fc, near));
    }
  }
  // Base band on the outside (split around a door opening).
  if (style.plinth && !style.upper) {
    const ph = style.plinth.h;
    const gap = kind === 'vitrine' ? 2.6 : kind === 'portao' ? 2.4 : kind === 'aco' ? 2.8 : kind === 'porta' ? (style.look === 'colonial' ? 1.4 : KIT.door.w) : 0;
    if (!gap) parts.push(box(0, ph / 2, ht + 0.015, l, ph / 2, 0.015, style.plinth.color, deco));
    else {
      const seg = (len - gap) / 4;
      for (const sx of [-1, 1]) parts.push(box(sx * (gap / 2 + seg), ph / 2, ht + 0.015, seg, ph / 2, 0.015, style.plinth.color, deco));
    }
  }
  return parts;
}

/** Floor slab: a solid foundation (collider) with a plinth and an inset floor colour. */
export function foundation(w: number, d: number, plinth: KitColor = 'rodape', floor: KitColor = 'piso'): KitPart[] {
  const f = KIT.floorTop;
  const deep = KIT.foundation;
  return [
    box(0, (f - deep) / 2, 0, w / 2 + 0.1, (f + deep) / 2, d / 2 + 0.1, plinth, ghost),
    box(0, (f - 0.002 - deep) / 2, 0, w / 2 + 0.1, (f - 0.002 + deep) / 2, d / 2 + 0.1, plinth, deco),
    box(0, f - 0.01, 0, w / 2 - 0.05, 0.012, d / 2 - 0.05, floor, deco),
  ];
}

/** Stone base under a foundation on a slope: from the base down `depth` metres (solid: it is the hillside). */
export function plinth(w: number, d: number, depth: number, color: KitColor): KitPart[] {
  return [
    box(0, -depth / 2 - 0.05, 0, w / 2 + 0.14, depth / 2, d / 2 + 0.14, color),
    box(0, -0.06, 0, w / 2 + 0.2, 0.06, d / 2 + 0.2, 'cantaria', near),
  ];
}

/** Door steps descending from the floor toward +Z: `n` steps of KIT.stoop.rise over a ramp collider. */
export function stoop(n: number, color: KitColor = 'cantaria'): KitPart[] {
  const { rise, tread, width } = KIT.stoop;
  const hw = width / 2;
  const parts: KitPart[] = [];
  const top = n * rise;
  // Step i (0 = top) stands from the ground (y = −top) up to (n − i) · rise, one tread further out each time.
  for (let i = 0; i < n; i++) {
    const h = (n - i) * rise;
    parts.push(box(0, -top + (h - 0.25) / 2, 0.16 + i * tread + tread / 2, hw, (h + 0.25) / 2, tread / 2, color, deco));
  }
  // Ramp collider through the nosings: from the threshold (z = 0.16, y = 0) to the ground one tread past the last.
  parts.push(slope(0, hw, 0.16, 0, 0.16 + n * tread, -top, 0.2, color, ghost));
  return parts;
}

/** Flat roof slab, origin at its top surface. */
export function slab(w: number, d: number, color: KitColor = 'laje'): KitPart[] {
  return [box(0, -KIT.slab / 2, 0, w / 2 + 0.2, KIT.slab / 2, d / 2 + 0.2, color)];
}

/** Parapet segment along X, origin at its base (the slab top). Masonry: low cover on a roof. */
export function parapet(len: number, color: KitColor = 'reboco'): KitPart[] {
  const h = KIT.parapetH;
  return [box(0, (h - 0.05) / 2, 0, len / 2, (h + 0.05) / 2, KIT.parapetT / 2, color), box(0, h + 0.03, 0, len / 2 + 0.02, 0.03, KIT.parapetT / 2 + 0.03, 'rodape', near)];
}

/**
 * Masonry stair rising toward +Z from the ground (z = 0) to `rise`, then a landing. The steps are decoration over a
 * ramp collider through their nosings (smooth to walk up and down); the open side (`rail` = +1 right, −1 left, 0 none)
 * has a railing that stops movement but not shots.
 */
export function stair(rail: 1 | -1 | 0, o: { rise?: number; run?: number; width?: number; steps?: number; landing?: number; color?: KitColor; railColor?: KitColor; base?: boolean; landingSideRail?: boolean } = {}): KitPart[] {
  const rise = o.rise ?? KIT.stair.rise;
  const run = o.run ?? KIT.stair.run;
  const width = o.width ?? KIT.stair.width;
  const steps = o.steps ?? KIT.stair.steps;
  const landing = o.landing ?? KIT.stair.landing;
  const color = o.color ?? 'degrau';
  const r = rise / steps;
  const t = run / steps;
  const hw = width / 2;
  const parts: KitPart[] = [];
  const foot = o.base ? 0.8 : 0.3;
  for (let i = 0; i < steps; i++) {
    const top = (i + 1) * r;
    parts.push(box(0, (top - foot) / 2, i * t + t / 2, hw, (top + foot) / 2, t / 2, i === steps - 1 ? 'laje' : color, deco));
  }
  // Ramp through the nosings: from (z = −t, y = 0) to (z = run − t, y = rise), continued 1.2 m down past the foot so a
  // stair whose foot ends above lower ground (a building on a slope) still meets it as a slope, not a ledge.
  const len = Math.hypot(run, rise);
  const ang = Math.atan2(rise, run);
  const th = 0.15;
  const ext = 1.2;
  const midZ = run / 2 - t;
  const midY = rise / 2;
  const cx = -Math.cos(ang) * (ext / 2);
  const cyy = -Math.sin(ang) * (ext / 2);
  parts.push(box(0, midY + cyy - Math.cos(ang) * th, midZ + cx + Math.sin(ang) * th, hw, th, (len + ext) / 2, color, { ...ghost, rx: -ang / DEG }));
  // Landing (walkable block up to the top).
  if (landing > 0) parts.push(box(0, (rise - foot) / 2, run + landing / 2 - t / 2, hw, (rise + foot) / 2, (landing + t) / 2, 'laje'));
  if (rail) {
    // Railing on the open side, along the flight (from a quarter of the way up, so the first steps can be taken from
    // the side, as on a stair against a wall) and the landing.
    const rc = o.railColor ?? 'metal';
    const rx = rail * (hw - 0.04);
    const rh = 0.5;
    const u0 = 0.25;
    const um = (u0 + 1) / 2;
    parts.push(box(rx, um * rise + Math.cos(ang) * rh, -t + um * run - Math.sin(ang) * rh, 0.04, rh, ((1 - u0) * len) / 2, rc, { solid: 'move', rx: -ang / DEG }));
    if (landing > 0) {
      // An inside stair is left from its landing toward the railing side (the upper floor): no side rail there.
      if (o.landingSideRail ?? true) parts.push(box(rx, rise + rh, run + landing / 2 - t / 2, 0.04, rh, (landing + t) / 2, rc, { solid: 'move' }));
      parts.push(box(0, rise + rh, run + landing - 0.04, hw, rh, 0.04, rc, { solid: 'move' }));
    }
  }
  return parts;
}

/** Footbridge along Z; origin at the deck top centre. Railings: movement only. */
export function footbridge(len: number, w = 1.4, deck: KitColor = 'laje', rail: KitColor = 'metal'): KitPart[] {
  return [
    box(0, -0.09, 0, w / 2, 0.09, len / 2, deck),
    box(w / 2 - 0.04, 0.5, 0, 0.04, 0.5, len / 2, rail, { solid: 'move' }),
    box(-w / 2 + 0.04, 0.5, 0, 0.04, 0.5, len / 2, rail, { solid: 'move' }),
    box(w / 2 - 0.04, 1.02, 0, 0.06, 0.04, len / 2, 'madeira', near),
    box(-w / 2 + 0.04, 1.02, 0, 0.06, 0.04, len / 2, 'madeira', near),
  ];
}

/**
 * Gabled roof over a w × d box, ridge along X; origin at the wall top. A convex hull (walkable: a 30–35° pitch is
 * under the character's 52° limit) with eaves (beiral) `o` metres out and a ridge cap; the gable ends are walls.
 */
export function gabledRoof(w: number, d: number, riseH: number, o: { tile?: KitColor; gable?: KitColor; eave?: number; ridge?: KitColor } = {}): KitPart[] {
  const e = o.eave ?? 0.35;
  const tile = o.tile ?? 'telha';
  const half = d / 2 + e;
  const ang = Math.atan2(riseH, d / 2);
  const len = half / Math.cos(ang);
  const th = 0.08;
  const cz = half / 2 + Math.sin(ang) * th;
  const cy = riseH - (half / 2) * Math.tan(ang) + Math.cos(ang) * th;
  const drop = e * Math.tan(ang);
  return [
    box(0, cy, cz, w / 2 + e, th, len / 2, tile, { rx: ang / DEG, solid: 'none' }),
    box(0, cy, -cz, w / 2 + e, th, len / 2, tile, { rx: -ang / DEG, solid: 'none' }),
    // One convex collider for both planes (no seam at the ridge), from the eaves to the ridge.
    { shape: 'gable', x: 0, y: -drop, z: 0, hx: w / 2 + e, hy: riseH + drop + th * 1.5, hz: half, color: tile, visible: false },
    ...eaveBoards(w / 2 + e, half, -drop, ['front', 'back'], tile),
    { shape: 'gable', x: w / 2, y: 0, z: 0, hx: KIT.wallT / 2, hy: riseH, hz: d / 2, color: o.gable ?? 'reboco' },
    { shape: 'gable', x: -w / 2, y: 0, z: 0, hx: KIT.wallT / 2, hy: riseH, hz: d / 2, color: o.gable ?? 'reboco' },
    box(0, riseH + th * 2.2, 0, w / 2 + e + 0.05, 0.07, 0.13, o.ridge ?? tile, deco),
  ];
}

/**
 * Eave boards (testeira): collider-only strips along the eave edges of a pitched roof (half extents hx × hz, eave tip at
 * height y). The roof collider ends in a knife edge there; the board gives the eave a short vertical face, so the edge
 * can be grabbed and pulled up over like any ledge (docs/gameplay/CLIMBING.md) — from outside the eave, never under it.
 */
function eaveBoards(hx: number, hz: number, y: number, sides: ('front' | 'back' | 'left' | 'right')[], color: KitColor): KitPart[] {
  const t = 0.05;
  const lo = 0.22;
  const hi = 0.03;
  const cy = y + (hi - lo) / 2;
  const hh = (hi + lo) / 2;
  const o = { ...ghost, traversal: 'ledge' as const };
  return sides.map((s) =>
    s === 'front' || s === 'back'
      ? box(0, cy, (s === 'front' ? 1 : -1) * (hz - t), hx, hh, t, color, o)
      : box((s === 'right' ? 1 : -1) * (hx - t), cy, 0, t, hh, hz - 2 * t, color, o));
}

/** Hipped roof (telhado de quatro águas) over a w × d box; origin at the wall top. Eaves `e` m out. */
export function hippedRoof(w: number, d: number, riseH: number, tile: KitColor, e = 0.45): KitPart[] {
  const hx = w / 2 + e;
  const hz = d / 2 + e;
  const k = riseH / (d / 2);
  return [
    { shape: 'hip', x: 0, y: -e * k, z: 0, hx, hy: riseH + e * k, hz, color: tile },
    ...eaveBoards(hx, hz, -e * k, ['front', 'back', 'left', 'right'], tile),
    // Ridge cap.
    box(0, riseH + 0.05, 0, Math.max(0.15, hx - hz), 0.06, 0.12, 'telhaEscura', deco),
  ];
}

// ------------------------------------------------------------------------------------------------ building helpers

export const W2 = KIT.wallT / 2;

/**
 * Four walls of a w × d box (wall modules laid end to end), corner pieces and the foundation. `walls` lists front,
 * back, right, left; front and back run from −X to +X, right and left from back (−Z) to front (+Z).
 */
export function shell(w: number, d: number, walls: { front: string[]; back: string[]; right: string[]; left: string[] }, o: { corner?: string; base?: string; y?: number } = {}): KitPiece[] {
  const y = o.y ?? 0;
  const pieces: KitPiece[] = o.base === '' ? [] : [{ prefab: o.base ?? `fundacao-${w}x${d}`, x: 0, z: 0 }];
  const along = (list: string[], total: number) => {
    const out: { prefab: string; c: number }[] = [];
    let at = -total / 2;
    for (const p of list) {
      const len = PREFABS[p]?.length;
      if (!len) throw new Error(`kit: ${p} is not a wall module`);
      out.push({ prefab: p, c: at + len / 2 });
      at += len;
    }
    if (Math.abs(at - total / 2) > 1e-6) throw new Error(`kit: walls ${list.join(', ')} do not add up to ${total} m`);
    return out;
  };
  const at = (p: KitPiece): KitPiece => (y ? { ...p, y } : p);
  for (const m of along(walls.front, w)) pieces.push(at({ prefab: m.prefab, x: m.c, z: d / 2, yaw: 0 }));
  for (const m of along(walls.back, w)) pieces.push(at({ prefab: m.prefab, x: m.c, z: -d / 2, yaw: 180 }));
  for (const m of along(walls.right, d)) pieces.push(at({ prefab: m.prefab, x: w / 2, z: m.c, yaw: 270 }));
  for (const m of along(walls.left, d)) pieces.push(at({ prefab: m.prefab, x: -w / 2, z: m.c, yaw: 90 }));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) pieces.push(at({ prefab: o.corner ?? 'pilar-canto', x: (sx * w) / 2, z: (sz * d) / 2 }));
  return pieces;
}

/** Laje with parapets on every edge but the listed gaps (centre positions of 2 m openings along that edge). */
export function roofTerrace(w: number, d: number, gaps: { front?: number[]; back?: number[]; right?: number[]; left?: number[] }, o: { parapet?: string; y?: number } = {}): KitPiece[] {
  const y = o.y ?? KIT.roofTop;
  const e = 0.12;
  const pp = o.parapet ?? 'parapeito-2';
  const pieces: KitPiece[] = [{ prefab: `laje-${w}x${d}`, x: 0, y, z: 0 }];
  const edge = (len: number, skip: number[] = [], put: (c: number) => KitPiece) => {
    for (let c = -len / 2 + 1; c < len / 2; c += 2) if (!skip.some((g) => Math.abs(g - c) < 0.01)) pieces.push(put(c));
  };
  edge(w, gaps.front, (c) => ({ prefab: pp, x: c, y, z: d / 2 + e, yaw: 0 }));
  edge(w, gaps.back, (c) => ({ prefab: pp, x: c, y, z: -d / 2 - e, yaw: 180 }));
  edge(d, gaps.right, (c) => ({ prefab: pp, x: w / 2 + e, y, z: c, yaw: 270 }));
  edge(d, gaps.left, (c) => ({ prefab: pp, x: -w / 2 - e, y, z: c, yaw: 90 }));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) pieces.push({ prefab: 'pilar-parapeito', x: sx * (w / 2 + e), y, z: sz * (d / 2 + e) });
  return pieces;
}

/** External stair along the right (+X, `side` 1) or left (−X, −1) wall, rising from the front to the back. */
export function sideStair(w: number, d: number, side: 1 | -1): KitPiece {
  // Rising toward −Z (yaw 180): the stair's own +X is the building's −X, so its railing side flips.
  return { prefab: side === 1 ? 'escada-laje-e' : 'escada-laje-d', x: side * (w / 2 + W2 + KIT.stair.width / 2 + 0.02), z: d / 2 - 0.1, yaw: 180 };
}
