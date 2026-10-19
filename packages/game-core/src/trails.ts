/**
 * Dirt trails painted on the terrain (game-data world/map.ts `trails`, docs/world/PLANET_LAYOUT.md): polylines of
 * great-circle arcs on the sphere. The client paints them into the terrain from the signed distance below (so a trail
 * follows every hill and bank instead of laying flat tiles over a curve), and the layout keeps wild trees, rocks and
 * grass off them. Pure math, identical on client and server.
 */
import { GRAAO_MAP, PLANET, type MapTrail } from '@graao/game-data';
import { v3cross, v3dot, v3normalize, type Vec3 } from '@graao/shared';
import { latLonToDir } from './sphere';

interface Arc {
  a: Vec3;
  b: Vec3;
  /** Unit normal of the arc's great circle (a × b). */
  n: Vec3;
}

export interface TrailSet {
  trails: { id: string; half: number; arcs: Arc[]; center: Vec3; cosReach: number }[];
}

/** Precomputes the arcs of the map's trails (and a bounding cap per trail for quick rejection). */
export function buildTrails(list: MapTrail[] = GRAAO_MAP.trails ?? []): TrailSet {
  const trails: TrailSet['trails'] = [];
  for (const t of list) {
    const pts = t.points.map(([lat, lon]) => latLonToDir(lat, lon));
    const arcs: Arc[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const c = v3cross(a, b);
      if (Math.hypot(c.x, c.y, c.z) < 1e-9) continue;
      arcs.push({ a, b, n: v3normalize(c) });
    }
    if (!arcs.length) continue;
    let sx = 0, sy = 0, sz = 0;
    for (const p of pts) {
      sx += p.x;
      sy += p.y;
      sz += p.z;
    }
    const center = v3normalize({ x: sx, y: sy, z: sz });
    let reach = 0;
    for (const p of pts) reach = Math.max(reach, Math.acos(Math.max(-1, Math.min(1, v3dot(center, p)))));
    // The cap covers the points, the bulge of the arcs between them and the trail's half width (plus a margin).
    trails.push({ id: t.id, half: t.width / 2, arcs, center, cosReach: Math.cos(Math.min(Math.PI, reach + 0.05 + (t.width / 2 + 4) / PLANET.radius)) });
  }
  return { trails };
}

/** Surface distance (m) from the unit direction `d` to one great-circle arc. */
function arcDistance(d: Vec3, arc: Arc): number {
  const R = PLANET.radius;
  // Inside the arc's span when d lies between a and b seen from the circle's normal.
  const s = v3dot(d, arc.n);
  const inA = v3dot(v3cross(arc.a, d), arc.n) >= 0;
  const inB = v3dot(v3cross(d, arc.b), arc.n) >= 0;
  if (inA && inB) return Math.asin(Math.min(1, Math.abs(s))) * R;
  const da = Math.acos(Math.max(-1, Math.min(1, v3dot(d, arc.a))));
  const db = Math.acos(Math.max(-1, Math.min(1, v3dot(d, arc.b))));
  return Math.min(da, db) * R;
}

/**
 * Signed distance (m) from `d` to the nearest trail's edge: negative on the trail, positive off it; `limit` when no
 * trail is within `limit` metres of its edge.
 */
export function trailEdgeDistance(set: TrailSet, d: Vec3, limit = 6): number {
  let best = limit;
  for (const t of set.trails) {
    if (v3dot(d, t.center) < t.cosReach) continue;
    for (const arc of t.arcs) {
      const e = arcDistance(d, arc) - t.half;
      if (e < best) best = e;
    }
  }
  return best;
}
