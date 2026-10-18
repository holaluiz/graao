/**
 * Map authoring helpers (tools/world/seed-map.ts and the region scripts in tools/world/regions/).
 *
 * Each region is designed in metres on the tangent plane of its centre — x to the right, z forward, where "forward"
 * is `heading` degrees clockwise from north — and projected onto the sphere with the exponential map at the centre:
 * distances along the ground are kept, and every placement gets its own frame and its own yaw relative to its local
 * north (the meridians converge, so a constant "yaw 90" would drift). Buildings are set on the terrain exactly as the
 * game's layout does (game-core buildingSite), so chest spots and links computed here land where the game puts them.
 */
import { buildingSite, createTerrain, dirToLatLon, headingTangent, latLonToDir, transportTangent, type Terrain } from '@graao/game-core';
import { KIT_BUILDINGS, PLANET, type ChestSpotDef, type MapPlacement, type MapWaypoint } from '@graao/game-data';
import { v3cross, v3dot, v3normalize, type Vec3 } from '@graao/shared';

export const terrain: Terrain = createTerrain();
export const R = PLANET.radius;
export const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
export const add = (a: Vec3, b: Vec3, s = 1): Vec3 => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s });
const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });

export interface Frame {
  up: Vec3;
  forward: Vec3;
  side: Vec3;
  /** Lifted base point (buildings: after buildingSite's raise). */
  base: Vec3;
  /** World point at local (x, y, z) in this frame. */
  at(lx: number, ly: number, lz: number): Vec3;
  raise: number;
}

/** The frame the game's layout builds for a placement (same rounding, same terrain, same building site). */
export function frameOf(p: MapPlacement): Frame {
  const up = latLonToDir(p.lat, p.lon);
  const forward = headingTangent(up, p.yaw);
  const side = v3normalize(v3cross(up, forward));
  const b = KIT_BUILDINGS[p.prefab];
  const raise = b ? buildingSite(terrain, b, p).raise : 0;
  const r = R + terrain.heightAt(up) + (p.lift ?? 0) + raise;
  const base = scale(up, r);
  const at = (lx: number, ly: number, lz: number): Vec3 => add(add(add(base, side, lx), up, ly), forward, lz);
  return { up, forward, side, base, at, raise };
}

export interface MapSink {
  placements: MapPlacement[];
  chestSpots: ChestSpotDef[];
  waypoints: MapWaypoint[];
}

/** A region's authoring plane. */
export function regionPlane(sink: MapSink, region: string, center: { lat: number; lon: number }, heading = 0) {
  const C = latLonToDir(center.lat, center.lon);
  const N0 = headingTangent(C, heading);
  const E0 = headingTangent(C, heading + 90);
  const RG = R + terrain.heightAt(C);

  /** Plane metres → unit direction. */
  const dirAt = (x: number, z: number): Vec3 => {
    const d = Math.hypot(x, z);
    if (d < 1e-9) return { ...C };
    const t = v3normalize(add(scale(N0, z / d), E0, x / d));
    const th = d / RG;
    return v3normalize(add(scale(C, Math.cos(th)), t, Math.sin(th)));
  };
  /** Plane heading (degrees clockwise from the plane's forward) → yaw relative to the local north at `dir`. */
  const yawAt = (dir: Vec3, yaw0: number): number => {
    const a = (yaw0 * Math.PI) / 180;
    const f0 = v3normalize(add(scale(N0, Math.cos(a)), E0, Math.sin(a)));
    const f = transportTangent(f0, C, dir);
    const n = headingTangent(dir, 0);
    const e = headingTangent(dir, 90);
    return ((Math.atan2(v3dot(f, e), v3dot(f, n)) * 180) / Math.PI + 360) % 360;
  };
  const latLon = (x: number, z: number) => {
    const ll = dirToLatLon(dirAt(x, z));
    return { lat: round(ll.lat, 5), lon: round(ll.lon, 5) };
  };
  /** A placement at plane (x, z) facing `yaw0` (plane degrees). */
  const put = (id: string, prefab: string, x: number, z: number, yaw0 = 0, extra: Partial<MapPlacement> = {}): MapPlacement => {
    const dir = dirAt(x, z);
    const { lat, lon } = dirToLatLon(dir);
    const p: MapPlacement = { id, prefab, lat: round(lat, 5), lon: round(lon, 5), yaw: round(yawAt(dir, yaw0), 2), region, ...extra };
    sink.placements.push(p);
    return p;
  };
  /** Ground point under plane (x, z). */
  const ground = (x: number, z: number): Vec3 => terrain.surfaceAt(dirAt(x, z));
  /** Terrain height above the radius under plane (x, z). */
  const height = (x: number, z: number): number => terrain.heightAt(dirAt(x, z));
  /** A chest spot at a world point (lat/lon + height over the terrain under it for prop surfaces). */
  const chestAt = (def: Omit<ChestSpotDef, 'lat' | 'lon'>, point: Vec3): ChestSpotDef => {
    const dir = v3normalize(point);
    const { lat, lon } = dirToLatLon(dir);
    const h = Math.hypot(point.x, point.y, point.z) - (R + terrain.heightAt(dir));
    const c: ChestSpotDef = { ...def, lat: round(lat, 5), lon: round(lon, 5), ...(def.surface === 'prop' ? { height: round(h, 2) } : {}) };
    sink.chestSpots.push(c);
    return c;
  };
  /** A bot waypoint at a world point (feet), linked to others by id. */
  const waypoint = (id: string, point: Vec3, links: string[] = [], o: Partial<MapWaypoint> = {}): MapWaypoint => {
    const dir = v3normalize(point);
    const { lat, lon } = dirToLatLon(dir);
    const h = Math.hypot(point.x, point.y, point.z) - (R + terrain.heightAt(dir));
    const w: MapWaypoint = { id, lat: round(lat, 5), lon: round(lon, 5), ...(h > 0.25 ? { height: round(h, 2) } : {}), links, region, ...o };
    sink.waypoints.push(w);
    return w;
  };
  /**
   * Street or trail tiles along a polyline of plane points, `step` metres apart, each turned along the line (the
   * tiles lean with the ground). Points closer than `skip` to any of `avoid` are left out (bridges, buildings).
   */
  const path = (idBase: string, prefab: string, pts: [number, number][], step: number, o: { avoid?: [number, number, number][]; yawOffset?: number } = {}): MapPlacement[] => {
    const out: MapPlacement[] = [];
    let k = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, z0] = pts[i]!;
      const [x1, z1] = pts[i + 1]!;
      const len = Math.hypot(x1 - x0, z1 - z0);
      const yaw0 = (Math.atan2(x1 - x0, z1 - z0) * 180) / Math.PI + (o.yawOffset ?? 0);
      const n = Math.max(1, Math.round(len / step));
      for (let j = i === 0 ? 0 : 1; j <= n; j++) {
        const x = x0 + ((x1 - x0) * j) / n;
        const z = z0 + ((z1 - z0) * j) / n;
        if (o.avoid?.some(([ax, az, r]) => Math.hypot(x - ax, z - az) < r)) continue;
        out.push(put(`${idBase}-${k++}`, prefab, x, z, yaw0));
      }
    }
    return out;
  };
  return { C, dirAt, yawAt, latLon, put, ground, height, chestAt, waypoint, path, region };
}

export type RegionPlane = ReturnType<typeof regionPlane>;
