/**
 * GRALootSpawner: where chests and ground items go on the spherical planet.
 *
 * Chest spots are authored per region (game-data CHEST_SPOTS, kept in the map file) and checked against the real
 * collision world: the base comes from a ray onto the terrain trimesh (never "radius + height" alone) — or, for spots
 * on a prop surface (a house floor, a flat roof), from a ray down onto the props from just above the authored height —
 * the chest leans with the surface normal, and a spot is refused under water, on steep or bumpy ground, under a
 * structure (unless it is meant to be indoors, then it needs headroom), overlapping a prop, near a spawn point, or
 * without a free side to approach and open it from. A refused spot is nudged up to a few metres to the
 * nearest valid one. Per match the spawner picks which spots hold a chest (seeded, every region represented, kept
 * apart). Items are spread on the local tangent plane around a chest or a fallen player and projected onto the ground.
 *
 * Positions and directions are quantized to what travels on the wire (mm, unit × 10000) so the server and every
 * client build exactly the same colliders.
 */
import { CHEST_REGIONS, CHEST_SPOTS, LOOT_RULES, MATCH_SPAWNS, PLANET, SPAWNS, type ChestSpotDef } from '@graao/game-data';
import { LOOT_DIR_SCALE, POS_SCALE, v3angle, v3cross, v3dot, v3normalize, v3projectOnPlane, v3rotateAxis, type Vec3 } from '@graao/shared';
import { GROUPS_PROP_QUERY, GROUPS_TERRAIN_QUERY, GROUPS_WORLD_QUERY, Group, groups, type GamePhysics } from './physics';
import { headingTangent, latLonToDir } from './sphere';
import type { GameWorld } from './world';

const DEG = Math.PI / 180;
const SEA = PLANET.radius + PLANET.seaLevel;

export interface ChestSpot {
  def: ChestSpotDef;
  /** CHEST_REGIONS index. */
  region: number;
  ok: boolean;
  /** Why it was refused (pt-BR, dev overlay), '' when ok. */
  reason: string;
  /** How far (m) the validator moved it from the authored point. */
  moved: number;
  /** Base point on the ground, up (surface normal) and front, quantized. */
  pos: Vec3;
  up: Vec3;
  forward: Vec3;
}

// ------------------------------------------------------------------------------------------------ quantization

export const quantPos = (p: Vec3): [number, number, number] => [Math.round(p.x * POS_SCALE), Math.round(p.y * POS_SCALE), Math.round(p.z * POS_SCALE)];
export const decodePos = (q: readonly number[], at = 0): Vec3 => ({ x: q[at]! / POS_SCALE, y: q[at + 1]! / POS_SCALE, z: q[at + 2]! / POS_SCALE });
export const quantDir = (d: Vec3): [number, number, number] => [Math.round(d.x * LOOT_DIR_SCALE), Math.round(d.y * LOOT_DIR_SCALE), Math.round(d.z * LOOT_DIR_SCALE)];
/** Unit vector from its wire form (same function on both sides, so both get the same floats). */
export const decodeDir = (q: readonly number[], at = 0): Vec3 => v3normalize({ x: q[at]! / LOOT_DIR_SCALE, y: q[at + 1]! / LOOT_DIR_SCALE, z: q[at + 2]! / LOOT_DIR_SCALE });

/** Front made exactly perpendicular to up (after quantization), as both sides rebuild it. */
export function chestBasis(up: Vec3, forward: Vec3): { up: Vec3; forward: Vec3; side: Vec3 } {
  const f = v3normalize(v3projectOnPlane(forward, up));
  return { up, forward: f, side: v3normalize(v3cross(up, f)) };
}

// ------------------------------------------------------------------------------------------------ spot validation

const add = (a: Vec3, b: Vec3, s: number): Vec3 => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s });
const neg = (a: Vec3): Vec3 => ({ x: -a.x, y: -a.y, z: -a.z });

/** The terrain surface under `dir` by a ray onto the trimesh: point and outward normal. */
export function groundAt(physics: GamePhysics, dir: Vec3): { pos: Vec3; normal: Vec3 } | null {
  const d = v3normalize(dir);
  const from = add({ x: 0, y: 0, z: 0 }, d, PLANET.radius + 40);
  const hit = physics.castRayNormal(from, neg(d), 80, GROUPS_TERRAIN_QUERY);
  if (!hit) return null;
  const n = v3dot(hit.normal, d) < 0 ? neg(hit.normal) : hit.normal;
  return { pos: add(from, neg(d), hit.toi), normal: v3normalize(n) };
}

const SPAWN_DIRS = [...SPAWNS, ...MATCH_SPAWNS].map((s) => latLonToDir(s.lat, s.lon));
const PROPS_AND_CHESTS = groups(0xffff, Group.PROP | Group.CHEST | Group.RAIL);

/** Where a chest stands, beyond its direction (ChestSpotDef fields). */
export type ChestSurface = Pick<ChestSpotDef, 'surface' | 'height' | 'covered'>;

/** The first surface under `from` along −`up` (terrain or props), within `maxDist`: point and outward normal. */
function surfaceBelow(physics: GamePhysics, from: Vec3, up: Vec3, maxDist: number, filter: number): { pos: Vec3; normal: Vec3 } | null {
  const hit = physics.castRayNormal(from, neg(up), maxDist, filter);
  if (!hit) return null;
  const n = v3dot(hit.normal, up) < 0 ? neg(hit.normal) : hit.normal;
  return { pos: add(from, neg(up), hit.toi), normal: v3normalize(n) };
}

/** Checks one chest base under `dir`, preferring to face `yaw`. */
export function checkChestSpot(world: GameWorld, dir: Vec3, yaw: number, where: ChestSurface = {}): { ok: boolean; reason: string; pos: Vec3; up: Vec3; forward: Vec3 } {
  const physics = world.physics;
  const radial = v3normalize(dir);
  const fail = (reason: string, pos: Vec3 = radial) => ({ ok: false, reason, pos, up: radial, forward: headingTangent(radial, yaw) });
  const onProp = where.surface === 'prop';
  const floorQuery = onProp ? GROUPS_WORLD_QUERY : GROUPS_TERRAIN_QUERY;
  let g: { pos: Vec3; normal: Vec3 } | null;
  if (onProp) {
    // A floor or a roof: a short ray down from just above the authored height, onto whatever is there.
    const want = PLANET.radius + world.terrain.heightAt(radial) + (where.height ?? 0);
    g = surfaceBelow(physics, add({ x: 0, y: 0, z: 0 }, radial, want + 1.2), radial, 2.4, GROUPS_WORLD_QUERY);
    if (g && Math.abs(Math.hypot(g.pos.x, g.pos.y, g.pos.z) - want) > 0.5) return fail('fora da superfície', g.pos);
  } else g = groundAt(physics, radial);
  if (!g) return fail('sem chão');
  const p = g.pos;
  if (Math.hypot(p.x, p.y, p.z) - SEA < 0.35) return fail('na água', p);
  if (v3angle(g.normal, radial) > 17 * DEG) return fail('chão inclinado', p);
  for (const s of SPAWN_DIRS) if (v3angle(radial, s) * PLANET.radius < 2.6) return fail('em cima de um spawn', p);
  // Nothing solid overhead (inside a house, under a roof or an arch) — unless it is meant to be indoors: headroom then.
  if (where.covered) {
    if (physics.castRay(add(p, radial, 0.05), radial, 1.9, GROUPS_PROP_QUERY)) return fail('sem espaço em cima', p);
  } else if (physics.castRay(add(p, radial, 0.05), radial, 3.2, GROUPS_PROP_QUERY)) return fail('coberto por estrutura', p);
  const up = g.normal;
  let forward = v3normalize(v3projectOnPlane(headingTangent(radial, yaw), up));
  // Flat enough under the whole footprint: every corner within a few cm of the base plane.
  for (let k = 0; k < 4; k++) {
    const b = chestBasis(up, forward);
    const c = add(add(p, b.side, k & 1 ? 0.45 : -0.45), b.forward, k & 2 ? 0.3 : -0.3);
    const hit = physics.castRay(add(c, up, 0.6), neg(up), 1.2, floorQuery);
    if (!hit || Math.abs(0.6 - hit.toi) > 0.16) return fail('chão irregular', p);
  }
  // A side to open it from: walkable, free of props and in sight of the chest. The preferred front first.
  let approach: Vec3 | null = null;
  for (let k = 0; k < 4 && !approach; k++) {
    const d = v3rotateAxis(forward, up, (-k * Math.PI) / 2);
    const a = add(add(p, d, 1.5), up, 0.95);
    if (physics.ballOverlaps(a, 0.35, PROPS_AND_CHESTS)) continue;
    const ga = onProp ? surfaceBelow(physics, a, up, 1.4, GROUPS_WORLD_QUERY) : groundAt(physics, a);
    if (onProp && ga && v3dot(add(ga.pos, p, -1), up) < -0.3) continue;
    if (!ga || Math.hypot(ga.pos.x, ga.pos.y, ga.pos.z) - SEA < 0.1 || v3angle(ga.normal, v3normalize(a)) > 30 * DEG) continue;
    const center = add(p, up, 0.4);
    const to = { x: center.x - a.x, y: center.y - a.y, z: center.z - a.z };
    const len = Math.hypot(to.x, to.y, to.z);
    if (physics.castRay(a, { x: to.x / len, y: to.y / len, z: to.z / len }, len, GROUPS_WORLD_QUERY)) continue;
    approach = d;
  }
  if (!approach) return fail('sem acesso', p);
  forward = approach;
  const b = chestBasis(up, forward);
  // The chest itself must not cut into a prop (or another chest).
  if (physics.boxOverlaps(add(p, up, 0.38), { x: 0.58, y: 0.34, z: 0.42 }, b.side, b.up, b.forward, PROPS_AND_CHESTS)) return fail('encosta em objeto', p);
  return { ok: true, reason: '', pos: p, up, forward };
}

/** One authored spot, nudged to the nearest valid point within ~4 m when needed. Quantized. */
export function resolveChestSpot(world: GameWorld, def: ChestSpotDef): ChestSpot {
  const center = latLonToDir(def.lat, def.lon);
  const north = headingTangent(center, 0);
  const region = Math.max(0, CHEST_REGIONS.findIndex((r) => r.name === def.region));
  let first: ReturnType<typeof checkChestSpot> | null = null;
  for (const ring of [0, 0.8, 1.6, 2.4, 3.2, 4.0]) {
    const steps = ring === 0 ? 1 : 8;
    for (let k = 0; k < steps; k++) {
      const t = v3rotateAxis(north, center, (k / steps) * Math.PI * 2);
      const dir = v3normalize(v3rotateAxis(center, v3normalize(v3cross(center, t)), ring / PLANET.radius));
      const r = checkChestSpot(world, dir, def.yaw ?? 0, def);
      first ??= r;
      if (r.ok) return quantize(def, region, true, '', ring, r);
    }
  }
  return quantize(def, region, false, first!.reason, 0, first!);
}

function quantize(def: ChestSpotDef, region: number, ok: boolean, reason: string, moved: number, r: { pos: Vec3; up: Vec3; forward: Vec3 }): ChestSpot {
  const up = decodeDir(quantDir(r.up));
  const b = chestBasis(up, decodeDir(quantDir(r.forward)));
  return { def, region, ok, reason, moved, pos: decodePos(quantPos(r.pos)), up, forward: decodeDir(quantDir(b.forward)) };
}

/** Every authored spot, resolved (in CHEST_SPOTS order). */
export function resolveChestSpots(world: GameWorld, defs: ChestSpotDef[] = CHEST_SPOTS): ChestSpot[] {
  return defs.map((d) => resolveChestSpot(world, d));
}

// ------------------------------------------------------------------------------------------------ per-match selection

/**
 * The match's chests: each region first gets its minimum (random spots, kept apart), then the rest goes to the spot
 * farthest from every chest so far (with a little randomness), so chests spread over the whole planet.
 */
export function pickChestSpots(spots: ChestSpot[], count: number, rand: () => number, minSpacingDeg: number = LOOT_RULES.minChestSpacingDeg, forced: string[] = []): ChestSpot[] {
  const pool = spots.filter((s) => s.ok);
  const chosen: ChestSpot[] = [];
  for (const id of forced) {
    const s = pool.find((x) => x.def.id === id);
    if (s && !chosen.includes(s) && chosen.length < count) chosen.push(s);
  }
  const dirOf = (s: ChestSpot) => v3normalize(s.pos);
  const minAngle = (s: ChestSpot) => chosen.reduce((m, c) => Math.min(m, v3angle(dirOf(s), dirOf(c))), Math.PI);
  const spaced = (s: ChestSpot) => !chosen.includes(s) && minAngle(s) >= minSpacingDeg * DEG;
  for (const [ri, r] of CHEST_REGIONS.entries()) {
    for (let k = 0; k < r.min && chosen.length < count; k++) {
      const options = pool.filter((s) => s.region === ri && spaced(s));
      if (options.length) chosen.push(options[Math.floor(rand() * options.length)]!);
    }
  }
  while (chosen.length < count) {
    const options = pool.filter(spaced).map((s) => ({ s, score: minAngle(s) * (0.85 + rand() * 0.3) }));
    if (!options.length) break;
    options.sort((a, b) => b.score - a.score);
    chosen.push(options[0]!.s);
  }
  return chosen;
}

// ------------------------------------------------------------------------------------------------ items on the ground

/**
 * `n` resting points around `base` on its tangent plane: a fan in front of `forward` (a chest's opening side) or a full
 * ring (`ring`, a fallen player), each projected onto the ground (terrain or the top of a prop, never inside one).
 * A point over water floats on the surface. Quantized like everything on the wire.
 */
export function scatterOnGround(physics: GamePhysics, base: Vec3, forward: Vec3, n: number, opts: { radius?: number; stepDeg?: number; ring?: boolean } = {}): Vec3[] {
  const up = v3normalize(base);
  const f = v3normalize(v3projectOnPlane(forward, up));
  const radius = opts.radius ?? LOOT_RULES.scatterRadius;
  const step = (opts.ring ? 360 / Math.max(1, n) : (opts.stepDeg ?? LOOT_RULES.scatterStepDeg)) * DEG;
  const out: Vec3[] = [];
  for (let k = 0; k < n; k++) {
    const a0 = opts.ring ? k * step : (k - (n - 1) / 2) * step;
    const r = opts.ring && n > 6 ? radius + (k % 2) * 0.55 : radius;
    let placed: Vec3 | null = null;
    // Preferred angle, then sideways and backward alternatives, then closer in.
    for (const [da, rr] of [[0, r], [0.5, r], [-0.5, r], [Math.PI, r], [0, r * 0.6], [Math.PI / 2, r * 0.6], [-Math.PI / 2, r * 0.6]] as const) {
      const d = v3rotateAxis(f, up, a0 + da);
      const t = add(base, d, rr);
      const tu = v3normalize(t);
      const hit = physics.castRayNormal(add(t, tu, 1.6), neg(tu), 4, GROUPS_WORLD_QUERY);
      if (!hit || v3angle(hit.normal, tu) > 40 * DEG) continue;
      const p = add(add(t, tu, 1.6), neg(tu), hit.toi);
      // Not inside a crowd of props: a small ball just above the resting point must be free.
      if (physics.ballOverlaps(add(p, tu, 0.35), 0.18, GROUPS_PROP_QUERY)) continue;
      placed = add(p, tu, 0.04);
      break;
    }
    if (!placed) placed = add(base, up, 0.1);
    // In a lake or the sea: float on the surface (reachable by swimming), never on the bottom.
    const r2 = Math.hypot(placed.x, placed.y, placed.z);
    if (r2 < SEA) placed = add({ x: 0, y: 0, z: 0 }, v3normalize(placed), SEA + 0.05);
    out.push(decodePos(quantPos(placed)));
  }
  return out;
}
