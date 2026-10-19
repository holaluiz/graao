/**
 * The planet's authored layout as versioned data: every building, prop and landmark placed on the sphere, plus the
 * chest spots. Client and server load the same file (`planeta-graao.map.json`), so the map is identical for every
 * player of a match; nothing here is random. The dev map editor (`?editor`) reads and writes this file.
 *
 * Positions are latitude/longitude in degrees on the planet (lat 0 / lon 0 is +Z, north pole +Y); `yaw` turns the
 * placement around its local up, clockwise from the local north tangent. The base sits on the terrain under it
 * (raised by `lift`); game-core layout.ts resolves the frames and colliders.
 *
 * `MAP_ID` names the map and its versions; `MAP_HASH` is a digest of the layout and of every kit prefab, sent on join
 * and checked by the server and the client so two builds with different maps never share a match.
 */
import type { ChestSpotDef } from '../loot';
import type { StructureKind } from '../planet';
import MAP_FILE from './planeta-graao.map.json';
import { KIT_BUILDINGS, KIT_PREFABS } from './kit';

export interface MapPlacement {
  /** Stable id (editor, tests, docs). */
  id: string;
  /** A kit prefab, a kit building or a classic structure (STRUCTURE_PREFABS). */
  prefab: string;
  lat: number;
  lon: number;
  /** Degrees clockwise from the local north tangent. */
  yaw: number;
  scale?: number;
  variant?: number;
  /** Base raised this far (m) above the terrain under the placement (floating pieces, footbridges). */
  lift?: number;
  /** Scatter keep-out radius override (degrees of arc). */
  clearDeg?: number;
  /** Region key (REGIONS `key`), for the editor and the docs. */
  region?: string;
  /** Buildings: override how the layout sets it on the ground (KitBuilding `settle`). */
  settle?: 'max' | 'center';
}

/**
 * A navigation waypoint for the bots: a point the nav graph must include (a doorway, the foot and the top of a stair,
 * a roof, a bridge, a balcony), with explicit links to other waypoints for connections the automatic graph cannot see
 * (a stair, a footbridge between roofs). `height` (m) is above the terrain under it, for points on props.
 */
export interface MapWaypoint {
  id: string;
  lat: number;
  lon: number;
  height?: number;
  links: string[];
  region?: string;
  /** What is there: the bots' choice of destinations and the editor's colour. */
  kind?: 'rua' | 'porta' | 'escada' | 'telhado' | 'ponte' | 'mirante' | 'interior' | 'trilha';
}

/**
 * A dirt trail painted on the terrain (docs/world/PLANET_LAYOUT.md, "Caminhos"): a polyline of [lat, lon] points
 * joined by great-circle arcs, `width` m wide. The ground under it keeps its shape (a trail follows every hill and
 * bank of the planet, never a flat tile over a curve); the client paints it into the terrain and the layout keeps wild
 * trees, rocks and grass off it.
 */
export interface MapTrail {
  id: string;
  points: [number, number][];
  width: number;
  region?: string;
}

export interface GraaoMap {
  mapId: string;
  /** Bumped on any layout change. */
  mapVersion: number;
  /**
   * Set by the map editor (`?editor`) when it saves (ISO date): the file then holds hand edits that the region scripts
   * do not know, and `tools/world/seed-map.ts --write` refuses to overwrite it without `--force`.
   */
  editedAt?: string;
  /** Bumped when shared geometry (kit prefabs, classic structures) changes. */
  geometryVersion: number;
  /** Bumped when colliders change. */
  collisionVersion: number;
  placements: MapPlacement[];
  chestSpots: ChestSpotDef[];
  /** Bot navigation waypoints and links (the rest of the nav graph is generated from the terrain and colliders). */
  waypoints?: MapWaypoint[];
  /** Dirt trails painted on the terrain between and inside the regions. */
  trails?: MapTrail[];
}

/**
 * The classic code-built structures (their geometry and colliders live in game-core layout.ts and the client's
 * propGeometry.ts) under map prefab ids, so the editor can place and move them like kit pieces.
 */
export const STRUCTURE_PREFABS: Record<string, { kind: StructureKind; name: string; clearDeg: number }> = {
  'casa-pintada': { kind: 'house', name: 'Casa pintada (fechada)', clearDeg: 4.5 },
  poco: { kind: 'well', name: 'Poço', clearDeg: 3 },
  poste: { kind: 'lamp', name: 'Poste antigo', clearDeg: 1 },
  'muro-pedra': { kind: 'wall', name: 'Muro de pedra 8 m', clearDeg: 3 },
  'torre-observatorio': { kind: 'tower', name: 'Torre do observatório', clearDeg: 5 },
  'arvore-gigante': { kind: 'giant_tree', name: 'Árvore gigante', clearDeg: 7 },
  arco: { kind: 'arch', name: 'Arco de pedra', clearDeg: 3 },
  cristais: { kind: 'crystal_cluster', name: 'Cristais', clearDeg: 3 },
  'lasca-flutuante': { kind: 'floating_shard', name: 'Lasca flutuante', clearDeg: 4 },
};

export type PrefabRef =
  | { type: 'structure'; kind: StructureKind; clearDeg: number }
  | { type: 'kit'; prefab: (typeof KIT_PREFABS)[string] }
  | { type: 'building'; building: (typeof KIT_BUILDINGS)[string] };

/** What a map prefab id names, or null. */
export function resolvePrefab(id: string): PrefabRef | null {
  const s = STRUCTURE_PREFABS[id];
  if (s) return { type: 'structure', kind: s.kind, clearDeg: s.clearDeg };
  const k = KIT_PREFABS[id];
  if (k) return { type: 'kit', prefab: k };
  const b = KIT_BUILDINGS[id];
  if (b) return { type: 'building', building: b };
  return null;
}

/** Checks a map file's shape and references; returns the problems found (empty = valid). */
export function validateMap(m: GraaoMap): string[] {
  const out: string[] = [];
  const ids = new Set<string>();
  for (const p of m.placements) {
    if (ids.has(p.id)) out.push(`id repetido: ${p.id}`);
    ids.add(p.id);
    if (!resolvePrefab(p.prefab)) out.push(`${p.id}: prefab desconhecido ${p.prefab}`);
    if (![p.lat, p.lon, p.yaw].every(Number.isFinite) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) out.push(`${p.id}: posição inválida`);
    const k = KIT_PREFABS[p.prefab];
    const s = p.scale ?? 1;
    if (k?.scale && (s < k.scale[0] - 1e-6 || s > k.scale[1] + 1e-6)) out.push(`${p.id}: escala ${s} fora de ${k.scale.join('–')}`);
  }
  const spots = new Set<string>();
  for (const c of m.chestSpots) {
    if (spots.has(c.id)) out.push(`baú repetido: ${c.id}`);
    spots.add(c.id);
  }
  const wps = new Set((m.waypoints ?? []).map((w) => w.id));
  if (wps.size !== (m.waypoints ?? []).length) out.push('waypoint repetido');
  for (const w of m.waypoints ?? []) for (const l of w.links) if (!wps.has(l)) out.push(`${w.id}: ligação para waypoint desconhecido ${l}`);
  const trails = new Set<string>();
  for (const t of m.trails ?? []) {
    if (trails.has(t.id)) out.push(`trilha repetida: ${t.id}`);
    trails.add(t.id);
    if (t.points.length < 2 || !t.points.every(([la, lo]) => Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180)) out.push(`${t.id}: pontos inválidos`);
    if (!(t.width > 0.4 && t.width < 8)) out.push(`${t.id}: largura ${t.width} fora de 0,4–8 m`);
  }
  return out;
}

export const GRAAO_MAP: GraaoMap = MAP_FILE as unknown as GraaoMap;
{
  const problems = validateMap(GRAAO_MAP);
  if (problems.length) throw new Error(`planeta-graao.map.json: ${problems.join('; ')}`);
}

/** The map file's text: one placement or chest spot per line, so diffs and reviews stay readable. */
export function serializeMap(m: GraaoMap): string {
  const head = JSON.stringify({ mapId: m.mapId, mapVersion: m.mapVersion, ...(m.editedAt ? { editedAt: m.editedAt } : {}), geometryVersion: m.geometryVersion, collisionVersion: m.collisionVersion }, null, 2).slice(0, -2);
  const list = (items: unknown[]) => (items.length ? `[\n    ${items.map((i) => JSON.stringify(i)).join(',\n    ')}\n  ]` : '[]');
  return `${head},\n  "placements": ${list(m.placements)},\n  "chestSpots": ${list(m.chestSpots)},\n  "waypoints": ${list(m.waypoints ?? [])},\n  "trails": ${list(m.trails ?? [])}\n}\n`;
}

/** FNV-1a (32 bit) of a string, as 8 hex digits. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Map identity: id and versions, readable in logs and error messages. */
export const MAP_ID = `${GRAAO_MAP.mapId}@${GRAAO_MAP.mapVersion}.${GRAAO_MAP.geometryVersion}.${GRAAO_MAP.collisionVersion}`;
/** Digest of the layout and every kit prefab and building: two builds agree on the map iff their hashes match. */
export const MAP_HASH = `${MAP_ID}#${fnv1a(JSON.stringify([GRAAO_MAP, KIT_PREFABS, KIT_BUILDINGS]))}`;
