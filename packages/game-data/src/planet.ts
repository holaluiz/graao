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
  | { kind: 'fissure'; lat1: number; lon1: number; lat2: number; lon2: number; widthDeg: number; depth: number; rimHeight: number };

export const TERRAIN_FEATURES: TerrainFeature[] = [
  // Lantern Village plaza.
  { kind: 'flatten', lat: 8, lon: 0, radiusDeg: 13, falloffDeg: 7, height: 1.1 },
  // Giant Tree hill.
  { kind: 'mound', lat: 34, lon: 62, radiusDeg: 16, height: 7 },
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

export interface StructurePlacement {
  kind: StructureKind;
  lat: number;
  lon: number;
  /** Heading around the local up (degrees, 0 = toward the north pole tangent). */
  yaw: number;
  /** Uniform scale or variant-specific size. */
  scale?: number;
  variant?: number;
  /** Extra height above the terrain (floating pieces). */
  lift?: number;
  /** Keeps scattered props away (degrees of arc). */
  clearDeg?: number;
}

export const STRUCTURES: StructurePlacement[] = [
  // Lantern Village: houses around a small plaza with a well.
  { kind: 'well', lat: 8, lon: 0, yaw: 0, clearDeg: 3 },
  { kind: 'house', lat: 13.2, lon: -3.5, yaw: 170, variant: 0, clearDeg: 4.5 },
  { kind: 'house', lat: 12.5, lon: 5.5, yaw: 200, variant: 1, clearDeg: 4.5 },
  { kind: 'house', lat: 6.5, lon: 8.5, yaw: 265, variant: 2, clearDeg: 4.5 },
  { kind: 'house', lat: 1.8, lon: 4.0, yaw: 330, variant: 0, clearDeg: 4.5 },
  { kind: 'house', lat: 2.5, lon: -6.0, yaw: 30, variant: 1, clearDeg: 4.5 },
  { kind: 'house', lat: 8.5, lon: -9.5, yaw: 95, variant: 2, clearDeg: 4.5 },
  { kind: 'lamp', lat: 10.5, lon: 1.5, yaw: 0, clearDeg: 1 },
  { kind: 'lamp', lat: 5.2, lon: -2.2, yaw: 0, clearDeg: 1 },
  { kind: 'lamp', lat: 8.0, lon: 4.2, yaw: 0, clearDeg: 1 },
  { kind: 'wall', lat: 16.5, lon: 1, yaw: 90, scale: 1, clearDeg: 3 },
  // Landmarks.
  { kind: 'giant_tree', lat: 34, lon: 62, yaw: 0, scale: 1, clearDeg: 7 },
  { kind: 'tower', lat: -18, lon: 128, yaw: 40, scale: 1, clearDeg: 5 },
  { kind: 'arch', lat: -4, lon: 58, yaw: 30, clearDeg: 3 },
  { kind: 'arch', lat: -6, lon: 66, yaw: 75, clearDeg: 3 },
  { kind: 'crystal_cluster', lat: 44, lon: -112, yaw: 10, scale: 1.4, clearDeg: 3 },
  { kind: 'crystal_cluster', lat: 38, lon: -100, yaw: 80, scale: 1.0, clearDeg: 3 },
  { kind: 'crystal_cluster', lat: 33, lon: -91, yaw: 140, scale: 1.2, clearDeg: 3 },
  { kind: 'floating_shard', lat: 2, lon: -150, yaw: 0, scale: 1, lift: 16, clearDeg: 4 },
];

export interface ScatterRule {
  kind: 'tree' | 'pine' | 'rock' | 'bush' | 'grass' | 'flower';
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
}

export const SCATTER: ScatterRule[] = [
  { kind: 'tree', count: 130, minHeight: 0.6, maxSlope: 0.6, density: { frequency: 2.4, threshold: 0.05 }, visualOnly: false, seed: 11 },
  { kind: 'pine', count: 70, minHeight: 1.6, maxSlope: 0.7, density: { frequency: 3.1, threshold: 0.15 }, visualOnly: false, seed: 12 },
  { kind: 'rock', count: 90, minHeight: -0.4, maxSlope: 1.2, visualOnly: false, seed: 13 },
  { kind: 'bush', count: 160, minHeight: 0.4, maxSlope: 0.8, visualOnly: true, seed: 14 },
  { kind: 'grass', count: 42000, minHeight: 0.35, maxSlope: 0.75, density: { frequency: 3.4, threshold: -0.35 }, visualOnly: true, seed: 15 },
  { kind: 'flower', count: 1800, minHeight: 0.5, maxSlope: 0.6, density: { frequency: 5.1, threshold: 0.1 }, visualOnly: true, seed: 16 },
];

/** Free-roam spawn points (also used as fallback landing points). */
export const SPAWNS: { lat: number; lon: number }[] = [
  { lat: 7, lon: -2 },
  { lat: 9, lon: 2.5 },
  { lat: 22, lon: 30 },
  { lat: -10, lon: 95 },
  { lat: 30, lon: -60 },
  { lat: -15, lon: -150 },
  { lat: 4, lon: -2 },
  { lat: 11, lon: -2 },
  { lat: 7, lon: 6 },
  { lat: 11, lon: -6 },
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

/** Named regions for HUD location labels and the UFO overview. */
export const REGIONS: { name: string; lat: number; lon: number; radiusDeg: number }[] = [
  { name: 'Vila das Lanternas', lat: 8, lon: 0, radiusDeg: 16 },
  { name: 'A Árvore Gigante', lat: 34, lon: 62, radiusDeg: 16 },
  { name: 'Velho Observatório', lat: -18, lon: 128, radiusDeg: 15 },
  { name: 'Lago Espelho', lat: -30, lon: -38, radiusDeg: 16 },
  { name: 'Fenda de Cristal', lat: 40, lon: -103, radiusDeg: 18 },
  { name: 'Lasca do Céu', lat: 2, lon: -150, radiusDeg: 12 },
  { name: 'Arcos Afundados', lat: -5, lon: 62, radiusDeg: 10 },
  { name: 'Mar do Sul', lat: -78, lon: 20, radiusDeg: 28 },
  { name: 'Planalto Norte', lat: 72, lon: -20, radiusDeg: 22 },
];
