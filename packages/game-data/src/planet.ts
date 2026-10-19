/**
 * The MVP planet: an authored, compact, stylized world on a real sphere. Positions are latitude/longitude in degrees
 * (lat 0 / lon 0 is +Z, the north pole is +Y). Everything here is data; `@graao/game-core` turns it into a height
 * function, a collision world and prop placements that are identical on client and server.
 */

/** Planet center is the world origin. Radius is a TEST VALUE (see docs/architecture/SPHERICAL_WORLD.md). */
export const PLANET = {
  radius: 100,
  seed: 20261017,
  /** Water sphere radius offset from `radius` (m). */
  seaLevel: -0.7,
  /** Geodesic subdivision frequency of the terrain mesh (edge ≈ 1.05·R/f). */
  terrainFrequency: 56,
  /** Rolling hills amplitude (m) and base frequency (cycles per radian of arc). */
  hillAmplitude: 2.2,
  hillFrequency: 1.6,
  /** Raises the noise so most land sits above the sea. */
  baseOffset: 0.9,
  /** Radial gravity (m/s²). Stronger than Earth for snappy jumps. */
  gravity: 20,
} as const;

export type TerrainFeature =
  /** Smoothly pulls the terrain toward `height` inside `radiusDeg`, fading over `falloffDeg`. */
  | { kind: 'flatten'; lat: number; lon: number; radiusDeg: number; falloffDeg: number; height: number }
  /** Adds a smooth hill. */
  | { kind: 'mound'; lat: number; lon: number; radiusDeg: number; height: number }
  /** Digs a bowl (lakes, sea). */
  | { kind: 'basin'; lat: number; lon: number; radiusDeg: number; depth: number }
  /** A narrow crack between two points (the crystal fracture). */
  | { kind: 'fissure'; lat1: number; lon1: number; lat2: number; lon2: number; widthDeg: number; depth: number; rimHeight: number }
  /**
   * A watercourse or a valley along a polyline ([lat, lon] points), carved down to an absolute `floor` height (m above
   * the radius) over `widthDeg` either side of the line, with banks blending back to the ground over `bankDeg`. Carved
   * after the flattening, so it cuts through squares and plateaus; a floor under the sea level holds real water.
   */
  | { kind: 'channel'; points: [number, number][]; widthDeg: number; bankDeg: number; floor: number }
  /** A mountain crest between two points: a rounded ridge `height` m high, `widthDeg` either side, a jagged top. */
  | { kind: 'ridge'; lat1: number; lon1: number; lat2: number; lon2: number; widthDeg: number; height: number };

/** Polylines shared by the terrain and the map (docs/world/PLANET_LAYOUT.md). */
export const RIVERS = {
  /** Córrego das Lanternas: a spring east of the vila, under the stone bridge, the viaduct's valley, into the lake. */
  corrego: [[-5.38, 19.39], [-1.82, 10.27], [-0.03, -2.28], [-3.52, -9.69], [-8.7, -14.86], [-13.25, -18.98], [-18.28, -23.89], [-23.71, -29.75]] as [number, number][],
  /** The Bairro do Horizonte's valley (baixada), spanned by the viaduct. */
  baixada: [[-4.1, -10.83], [-8.7, -14.86], [-13.25, -18.98], [-18.28, -23.89]] as [number, number][],
};

export const TERRAIN_FEATURES: TerrainFeature[] = [
  // Vila das Lanternas (after Ouro Preto): the largo at the foot of the chapel hill, the adro terrace on top.
  { kind: 'flatten', lat: 8, lon: 0, radiusDeg: 6.5, falloffDeg: 4, height: 1.1 },
  { kind: 'mound', lat: 30.9, lon: 0, radiusDeg: 20, height: 5.8 },
  { kind: 'flatten', lat: 28.05, lon: 0, radiusDeg: 3.6, falloffDeg: 2.6, height: 6.4 },
  // Bairro do Horizonte (after Belo Horizonte): a plateau cut by the valley of the stream; the viaduct spans it.
  { kind: 'flatten', lat: -12.06, lon: -18.02, radiusDeg: 11, falloffDeg: 5, height: 1.7 },
  { kind: 'channel', points: RIVERS.baixada, widthDeg: 3.0, bankDeg: 2.4, floor: 0.35 },
  { kind: 'channel', points: RIVERS.corrego, widthDeg: 0.75, bankDeg: 0.6, floor: -1.55 },
  // Lago Espelho's island (after the islands of the Pampulha lagoon): low and gentle (≤ 36°), so the footbridges land
  // on a walkable shore.
  { kind: 'mound', lat: -28.31, lon: -42.92, radiusDeg: 5.0, height: 4.6 },
  // Serra do Mirante (after the Serra do Curral): two crests from the Planalto toward the Fenda, a pass between them.
  { kind: 'ridge', lat1: 68.4, lon1: -63.5, lat2: 60.6, lon2: -83.5, widthDeg: 5.2, height: 6.2 },
  { kind: 'ridge', lat1: 57.9, lon1: -87.7, lat2: 49.1, lon2: -96.9, widthDeg: 4.6, height: 5.0 },
  // The chapada the Serra do Mirante massif stands on (docs/world/SERRA_DO_MIRANTE.md): the first crest levelled under
  // its foot and its trail ramp, so the rock rises from the ground on every side.
  { kind: 'flatten', lat: 64.2, lon: -77.5, radiusDeg: 6.8, falloffDeg: 3.6, height: 6.2 },
  // Bosque dos Varais: the giant tree's hill; on its south flank the waterfall's pool terrace, the floor of the cleft
  // behind the falls (level with the pool, so the rock stair stands clear of the ground) and the shelf above the cliff.
  // The step from the cleft's floor to the shelf happens under the cliff's rock (cachoeira-paredao is 10 m deep).
  { kind: 'mound', lat: 34, lon: 62, radiusDeg: 16, height: 7 },
  { kind: 'flatten', lat: 23.8, lon: 62, radiusDeg: 2.6, falloffDeg: 1.4, height: 2.2 },
  { kind: 'flatten', lat: 27.04, lon: 62, radiusDeg: 1.6, falloffDeg: 1.0, height: 2.2 },
  { kind: 'flatten', lat: 31.82, lon: 62, radiusDeg: 1.6, falloffDeg: 1.0, height: 7.2 },
  // The farm's leveled yard (terreiro).
  { kind: 'flatten', lat: 24.89, lon: 74.27, radiusDeg: 4.2, falloffDeg: 2.6, height: 1.1 },
  // Observatory hill.
  { kind: 'mound', lat: -18, lon: 128, radiusDeg: 15, height: 9 },
  { kind: 'flatten', lat: -18, lon: 128, radiusDeg: 3.2, falloffDeg: 2.5, height: 8.6 },
  // Mirror Lake.
  { kind: 'basin', lat: -30, lon: -38, radiusDeg: 15, depth: 5 },
  // Southern sea.
  { kind: 'basin', lat: -78, lon: 20, radiusDeg: 28, depth: 6 },
  // Ruins hill.
  { kind: 'mound', lat: -4, lon: 62, radiusDeg: 10, height: 2.5 },
  // Crystal fracture.
  { kind: 'fissure', lat1: 48, lon1: -120, lat2: 30, lon2: -86, widthDeg: 2.2, depth: 4, rimHeight: 2.4 },
  // Northern highlands.
  { kind: 'mound', lat: 72, lon: -20, radiusDeg: 22, height: 5 },
];

export type StructureKind =
  | 'house'
  | 'tower'
  | 'giant_tree'
  | 'arch'
  | 'crystal_cluster'
  | 'floating_shard'
  | 'lamp'
  | 'well'
  | 'wall';

/**
 * Authored structures and kit pieces live in the versioned map file (world/planeta-graao.map.json, see world/map.ts);
 * classic structures appear there under STRUCTURE_PREFABS ids.
 */

/** Landscapes (docs/world/MINAS_GERAIS_ART_DIRECTION.md): each keeps its own vegetation. */
export type Biome = 'colonial' | 'urbano' | 'orla' | 'serra' | 'mata' | 'campo';

/**
 * Scattered vegetation and rocks: broadleaf trees, araucárias ('pine'), cerrado trees, flowering ipês, jerivá palms,
 * rocks (with colliders), and bushes, grass, flowers, canelas-de-ema and golden grass tufts (decoration).
 */
export type ScatterKind = 'tree' | 'pine' | 'cerrado' | 'ipe' | 'palm' | 'rock' | 'bush' | 'grass' | 'flower' | 'canela' | 'capim';

export interface ScatterRule {
  kind: ScatterKind;
  count: number;
  /** Minimum terrain height above sea level. */
  minHeight: number;
  /** Maximum slope (radians) allowed. */
  maxSlope: number;
  /** Optional preference: keep only where hill noise > threshold (forests). */
  density?: { frequency: number; threshold: number };
  /** Client-only decoration: no collider. */
  visualOnly: boolean;
  seed: number;
  /** Where it grows: acceptance per biome (missing biome = never). Without it, everywhere. */
  biomes?: Partial<Record<Biome, number>>;
}

export const SCATTER: ScatterRule[] = [
  // Broadleaf woods: dense in the Bosque's mata, scattered in the open country.
  { kind: 'tree', count: 130, minHeight: 0.6, maxSlope: 0.6, density: { frequency: 2.4, threshold: 0.05 }, visualOnly: false, seed: 11, biomes: { mata: 1, campo: 0.55, colonial: 0.5, orla: 0.35, urbano: 0.25 } },
  // Araucárias on the higher ground.
  { kind: 'pine', count: 55, minHeight: 1.6, maxSlope: 0.7, density: { frequency: 3.1, threshold: 0.15 }, visualOnly: false, seed: 12, biomes: { campo: 0.5, mata: 0.7, serra: 0.2 } },
  // Cerrado: twisted trees with flat crowns, the serra and the open country.
  { kind: 'cerrado', count: 95, minHeight: 0.5, maxSlope: 0.8, visualOnly: false, seed: 17, biomes: { serra: 1, campo: 0.75, mata: 0.15, orla: 0.2 } },
  // Ipês flowering in the towns and along the lake.
  { kind: 'ipe', count: 30, minHeight: 0.5, maxSlope: 0.5, visualOnly: false, seed: 18, biomes: { urbano: 1, colonial: 1, orla: 0.8, campo: 0.25 } },
  // Jerivá palms by the water and the farms.
  { kind: 'palm', count: 34, minHeight: 0.3, maxSlope: 0.5, visualOnly: false, seed: 19, biomes: { orla: 1, mata: 0.5, campo: 0.3, urbano: 0.3 } },
  { kind: 'rock', count: 110, minHeight: -0.4, maxSlope: 1.2, visualOnly: false, seed: 13, biomes: { serra: 1, campo: 0.6, mata: 0.6, orla: 0.3, colonial: 0.3, urbano: 0.1 } },
  { kind: 'bush', count: 160, minHeight: 0.4, maxSlope: 0.8, visualOnly: true, seed: 14 },
  // Campo rupestre: canelas-de-ema and golden grass on the serra.
  { kind: 'canela', count: 320, minHeight: 0.5, maxSlope: 1.0, visualOnly: true, seed: 20, biomes: { serra: 1, campo: 0.08 } },
  { kind: 'capim', count: 1100, minHeight: 0.4, maxSlope: 0.9, visualOnly: true, seed: 21, biomes: { serra: 1, campo: 0.35, orla: 0.2 } },
  { kind: 'grass', count: 42000, minHeight: 0.35, maxSlope: 0.75, density: { frequency: 3.4, threshold: -0.35 }, visualOnly: true, seed: 15 },
  { kind: 'flower', count: 1800, minHeight: 0.5, maxSlope: 0.6, density: { frequency: 5.1, threshold: 0.1 }, visualOnly: true, seed: 16, biomes: { campo: 1, mata: 1, orla: 1, colonial: 0.6, urbano: 0.35, serra: 0.45 } },
];

/**
 * Free-roam spawn points (also used as fallback landing points): the open ground of the Vila das Lanternas' largo
 * (between the fountain, the stalls and the sobrado, each with room to run north) and a few spots in the open country.
 */
export const SPAWNS: { lat: number; lon: number }[] = [
  { lat: 6.4, lon: 1.39 },
  { lat: 8.47, lon: 1.97 },
  { lat: 7.35, lon: -1.65 },
  { lat: 22, lon: 30 },
  { lat: -10, lon: 95 },
  { lat: 30, lon: -60 },
  { lat: -15, lon: -150 },
  { lat: 4, lon: -2 },
  { lat: 11.19, lon: -1.28 },
  { lat: 7.87, lon: 4.0 },
];

/** Centre of the MVP arena (Lantern Village plaza). Match spawns face it. */
export const ARENA_CENTER = { lat: 8, lon: 0 };

/**
 * Match start points around the village, ≈ 50 m apart for a 1v1, so players meet after a few seconds with houses as
 * cover in between. (The UFO drop replaces this in Phase 7.)
 */
export const MATCH_SPAWNS: { lat: number; lon: number }[] = [
  { lat: 4, lon: -15 },
  { lat: 12, lon: 15 },
  { lat: -7, lon: 7 },
  { lat: 23, lon: -7 },
  { lat: 18, lon: 19 },
  { lat: -3, lon: -12 },
  { lat: 18, lon: -15 },
  { lat: -3, lon: 18 },
  { lat: 24, lon: 10 },
  { lat: 5, lon: -24 },
];

/** Scattered props keep this far from every spawn point (degrees of arc). */
export const SPAWN_CLEAR_DEG = 2;

/**
 * Named regions for HUD location labels, the UFO overview and the map. The five `main` regions are the points of
 * interest the planet is designed around (docs/world/PLANET_LAYOUT.md); the rest are smaller landmarks between them.
 * A position takes the name of the closest region whose radius contains it.
 */
export interface RegionDef {
  /** Stable key (map placements, docs). */
  key: string;
  name: string;
  lat: number;
  lon: number;
  radiusDeg: number;
  main?: boolean;
  /** Landscape (vegetation): see Biome. */
  biome?: Biome;
  /** Built-up core (degrees of arc): no wild trees or rocks inside, the streets stay clear. */
  builtDeg?: number;
  /** What the place is after (docs and the editor). */
  inspiration?: string;
}

export const REGIONS: RegionDef[] = [
  { key: 'vila', name: 'Vila das Lanternas', lat: 14.5, lon: 0, radiusDeg: 18, main: true, biome: 'colonial', builtDeg: 15.5, inspiration: 'Ouro Preto, Mariana e as cidades históricas mineiras' },
  { key: 'bairro', name: 'Bairro do Horizonte', lat: -12.06, lon: -18.02, radiusDeg: 11, main: true, biome: 'urbano', builtDeg: 10.5, inspiration: 'Belo Horizonte: Santa Tereza, viadutos, praças e o Mercado' },
  { key: 'lago', name: 'Lago Espelho', lat: -30, lon: -38, radiusDeg: 15, main: true, biome: 'orla', inspiration: 'A orla modernista da Pampulha' },
  { key: 'bosque', name: 'Bosque dos Varais', lat: 34, lon: 62, radiusDeg: 17, main: true, biome: 'mata', inspiration: 'Serra do Cipó, sítios e quintais mineiros' },
  { key: 'fenda', name: 'Fenda de Cristal', lat: 40, lon: -103, radiusDeg: 15, main: true, biome: 'serra', inspiration: 'Rochas ferruginosas e minas antigas' },
  { key: 'planalto', name: 'Planalto Norte', lat: 72, lon: -20, radiusDeg: 20, main: true, biome: 'serra', inspiration: 'Campos e mirantes da Serra do Curral' },
  { key: 'serra', name: 'Serra do Mirante', lat: 60.5, lon: -82, radiusDeg: 11, biome: 'serra', inspiration: 'As cristas de itabirito da Serra do Curral' },
  { key: 'observatorio', name: 'Velho Observatório', lat: -18, lon: 128, radiusDeg: 15, biome: 'campo' },
  { key: 'lasca', name: 'Lasca do Céu', lat: 2, lon: -150, radiusDeg: 12, biome: 'serra' },
  { key: 'arcos', name: 'Arcos Afundados', lat: -5, lon: 62, radiusDeg: 10, biome: 'mata' },
  { key: 'mar', name: 'Mar do Sul', lat: -78, lon: 20, radiusDeg: 28 },
];
