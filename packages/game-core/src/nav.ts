/**
 * Bot navigation on the spherical world (docs/world/WORLD_DESIGN.md, "Bots"): a graph of the places a character can
 * stand and the straight walks between them, built once from the same terrain and colliders the game runs on, so it
 * knows the houses, the stairs, the lajes, the decks and the bridges without any flat-map assumption.
 *
 * - Nodes: a Fibonacci lattice over the whole sphere (≈ 4.5 m apart, ≈ 2 m inside the main regions). Under each
 *   lattice point a vertical ray collects every walkable surface (terrain, floors, stairs, roofs, decks): one node per
 *   level with room for the capsule above it and footing around it. Deep water has no nodes (bots go round the lake
 *   and over its bridges). Built-up cores get a finer lattice (≈ 1.5 m: alleys, aisles, rooms). Every stair, ramp
 *   and sloped deck of the kit adds nodes along its middle line (a 1.2 m stair is easy to miss with a lattice), every
 *   ground-floor door of a building a node inside and one outside, and the map's authored waypoints come with their
 *   links.
 * - Edges: two nodes close enough, joined by a walk the controller can do (slope under the climb limit, ground all
 *   along, nothing solid at knee, chest and head height, room for the capsule's width); a ledge a bot may step off is a
 *   one-way edge down.
 * - Queries: nearest node to a point (same level first), A* between two points; the server's bot navigator follows
 *   the path with the real character motor, which still owns every collision.
 *
 * Deterministic: same world in, same graph out (no randomness, fixed iteration order).
 */
import { GRAAO_MAP, KIT, KIT_BUILDINGS, KIT_PREFABS, MOVEMENT, PLANET, REGIONS, type GraaoMap } from '@graao/game-data';
import { v3cross, v3dot, v3normalize, type Vec3 } from '@graao/shared';
import { buildingSite, placementToWorld, quatFromEulerDeg, quatRotate, type WorldLayout } from './layout';
import { addCrateColliders, removeColliders } from './interactives';
import { Group, groups, refreshQueries, type GamePhysics } from './physics';
import { headingTangent, latLonToDir } from './sphere';
import type { Terrain } from './terrain';

const SOLID = groups(0xffff, Group.TERRAIN | Group.PROP | Group.RAIL);
const PROPS = groups(0xffff, Group.PROP | Group.RAIL);
const DEG = Math.PI / 180;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
/** Walkable surface: normal within this of the local up (a little under the controller's climb limit). */
const WALK_COS = Math.cos((MOVEMENT.maxSlopeClimbDeg - 4) * DEG);
/** Deeper than this (m under the sea level) a node would make a bot swim: none there. */
const WADE = 0.55;

export interface NavNode {
  pos: Vec3;
  up: Vec3;
  /** Height above the planet radius (m). */
  h: number;
  /** Standing in shallow water (slower: a higher cost). */
  water: boolean;
  /** Not on the terrain: a floor, a stair, a roof, a deck. */
  raised: boolean;
  door: boolean;
}

export interface NavGraph {
  nodes: NavNode[];
  /** CSR adjacency: the edges of node i are adj[start[i] .. start[i + 1]). */
  start: Int32Array;
  adj: Int32Array;
  cost: Float32Array;
  /** Node closest to `p` that a character standing at `p` reaches in a straight line (−1: none within `maxDist`). */
  nearest(p: Vec3, maxDist?: number): number;
  /** Node ids of the cheapest walk between two nodes (both included), or null. */
  route(a: number, b: number, maxExpand?: number): number[] | null;
  /** Points to walk through from `from` to `to` (the last is `to` itself), or null when no walk joins them. */
  path(from: Vec3, to: Vec3): Vec3[] | null;
  /** Component id of every node (nodes that reach each other share it). */
  component: Int32Array;
  stats: { nodes: number; raised: number; doors: number; edges: number; drops: number; largest: number; components: number; ms: number };
}

interface Hit {
  toi: number;
  handle: number;
  normal: Vec3;
}

const add = (a: Vec3, b: Vec3, s: number): Vec3 => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
/** The point at distance `r` from the planet's centre along the unit direction `u`. */
const atRadius = (u: Vec3, r: number): Vec3 => ({ x: u.x * r, y: u.y * r, z: u.z * r });

/** Every collider surface along a ray (first hit per collider), nearest first. */
function hitsAlong(physics: GamePhysics, origin: Vec3, dir: Vec3, maxDist: number, filter = SOLID): Hit[] {
  const out: Hit[] = [];
  const ray = new physics.R.Ray(origin, dir);
  physics.world.intersectionsWithRay(ray, maxDist, true, (h) => {
    out.push({ toi: h.timeOfImpact, handle: h.collider.handle, normal: { x: h.normal.x, y: h.normal.y, z: h.normal.z } });
    return true;
  }, undefined, filter);
  out.sort((a, b) => a.toi - b.toi);
  return out;
}

/** Two unit tangents at `up`. */
function tangents(up: Vec3): [Vec3, Vec3] {
  const ref = Math.abs(up.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const t1 = v3normalize(v3cross(ref, up));
  return [t1, v3cross(up, t1)];
}

export interface NavOptions {
  map?: GraaoMap;
  /** Lattice spacing outside the main regions, inside them and inside their built-up cores (m). */
  spacing?: number;
  denseSpacing?: number;
  builtSpacing?: number;
}

export function buildNavGraph(world: { terrain: Terrain; physics: GamePhysics; layout: WorldLayout }, opts: NavOptions = {}): NavGraph {
  const { terrain, physics, layout } = world;
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  // Breakable crates stand where the map puts them until someone breaks them, so the graph goes round them; their
  // colliders belong to the rooms (interactives.ts), so the build adds its own and takes them away at the end.
  const crateColliders = (layout.crates ?? []).flatMap((p) => addCrateColliders(physics, p, false));
  if (crateColliders.length) refreshQueries(physics);
  const R = PLANET.radius;
  const map = opts.map ?? GRAAO_MAP;
  const far = opts.spacing ?? 4.5;
  const dense = opts.denseSpacing ?? 2.0;
  const built = opts.builtSpacing ?? 1.5;
  const nodes: NavNode[] = [];
  const spacingOf: number[] = [];

  // ---------------------------------------------------------------------------------------------- standing spots
  /** Can a capsule stand on the surface at `p` (up `up`)? Footing on four sides and room above. */
  const standable = (p: Vec3, up: Vec3): boolean => {
    const [t1, t2] = tangents(up);
    for (const t of [t1, t2]) {
      for (const s of [-0.3, 0.3]) {
        const o = add(add(p, t, s), up, 0.6);
        const hit = physics.castRay(o, { x: -up.x, y: -up.y, z: -up.z }, 1.0, SOLID);
        if (!hit || Math.abs(0.6 - hit.toi) > 0.38) return false;
      }
    }
    for (const hgt of [0.5, 1.0, 1.45]) if (physics.ballOverlaps(add(p, up, hgt), 0.26, PROPS)) return false;
    return true;
  };
  /** Every walkable level under the direction `d` (top down), as standing points. */
  const levels = (d: Vec3): { p: Vec3; raised: boolean; water: boolean }[] => {
    // Over deep water only raised surfaces (decks, footbridges) hold nodes: terrain hits there are skipped below.
    const th = terrain.heightAt(d);
    const top = R + Math.max(th, PLANET.seaLevel) + 24;
    const origin = { x: d.x * top, y: d.y * top, z: d.z * top };
    const down = { x: -d.x, y: -d.y, z: -d.z };
    const hits = hitsAlong(physics, origin, down, top - (R + th) + 1.0);
    const out: { p: Vec3; raised: boolean; water: boolean }[] = [];
    for (const hit of hits) {
      if (v3dot(hit.normal, d) < WALK_COS) continue;
      const p = add(origin, down, hit.toi);
      const h = len(p) - R;
      const isTerrain = hit.handle === physics.terrainHandle;
      if (isTerrain && h < PLANET.seaLevel - WADE) continue;
      if (out.some((o) => Math.abs(len(o.p) - R - h) < 1.7)) continue;
      if (!standable(p, d)) continue;
      out.push({ p, raised: !isTerrain, water: h < PLANET.seaLevel - 0.05 });
    }
    return out;
  };
  const pushNode = (p: Vec3, raised: boolean, water: boolean, spacing: number, door = false): number => {
    // Nothing a bot would have to swim to (a stream bed, a sunken step).
    if (len(p) - R < PLANET.seaLevel - WADE) return -1;
    const up = v3normalize(p);
    nodes.push({ pos: p, up, h: len(p) - R, water, raised, door });
    spacingOf.push(spacing);
    return nodes.length - 1;
  };

  const main = REGIONS.filter((r) => r.main).map((r) => ({ c: latLonToDir(r.lat, r.lon), rad: r.radiusDeg * 0.78 * DEG }));
  const cores = REGIONS.filter((r) => r.builtDeg).map((r) => ({ c: latLonToDir(r.lat, r.lon), rad: (r.builtDeg! + 1) * DEG }));
  const inCore = (d: Vec3) => cores.some((m) => Math.acos(Math.min(1, v3dot(d, m.c))) < m.rad);
  const inDense = (d: Vec3) => main.some((m) => Math.acos(Math.min(1, v3dot(d, m.c))) < m.rad);
  const lattice = (spacing: number, keep: (d: Vec3) => boolean) => {
    const n = Math.round((4 * Math.PI * R * R) / (spacing * spacing * 0.866));
    for (let i = 0; i < n; i++) {
      const y = 1 - (2 * (i + 0.5)) / n;
      const r = Math.sqrt(1 - y * y);
      const phi = i * GOLDEN;
      const d = { x: r * Math.cos(phi), y, z: r * Math.sin(phi) };
      if (!keep(d)) continue;
      for (const l of levels(d)) pushNode(l.p, l.raised, l.water, spacing);
    }
  };
  lattice(far, (d) => !inDense(d) && !inCore(d));
  lattice(dense, (d) => inDense(d) && !inCore(d));
  lattice(built, inCore);

  // Stairs, ramps and sloped decks: nodes every ≈ 0.9 m along the middle of every inclined walkable box of the kit
  // (a stair's ramp through its nosings, a ramp, a bridge's humps), so the lattice never misses a way up.
  for (const pl of layout.placements) {
    const prefab = pl.prefab ? KIT_PREFABS[pl.prefab] : undefined;
    if (!prefab) continue;
    const s = pl.scale;
    for (const part of prefab.parts) {
      if (part.shape !== 'box' || (part.solid ?? 'full') === 'none' || part.ry || part.rz) continue;
      const tilt = Math.abs(part.rx ?? 0);
      if (tilt < 6 || tilt > MOVEMENT.maxSlopeClimbDeg - 6 || part.hz < 0.9 || part.hx < 0.45) continue;
      const q = quatFromEulerDeg(part.rx, 0, 0);
      const n = Math.max(2, Math.round((part.hz * 2) / 0.9));
      for (let k = 0; k <= n; k++) {
        const zz = -part.hz + 0.25 + ((part.hz * 2 - 0.5) * k) / n;
        const [lx, ly, lz] = quatRotate(q, 0, part.hy, zz);
        const top = placementToWorld(pl, (part.x + lx) * s, (part.y + ly) * s, (part.z + lz) * s);
        const up = v3normalize(top);
        // The walking surface right there (another collider may lie on top of the ramp: a landing, a deck).
        const hit = physics.castRay(add(top, up, 0.5), { x: -up.x, y: -up.y, z: -up.z }, 0.8, SOLID);
        if (!hit) continue;
        const p = add(top, up, 0.5 - hit.toi);
        if (!standable(p, up)) continue;
        if (len(p) - R < PLANET.seaLevel - WADE && hit.handle === physics.terrainHandle) continue;
        pushNode(p, true, false, 0.9);
      }
    }
  }

  // Doors: a node a step outside and one inside every ground-floor door, joined through the opening.
  const doorPairs: [number, number][] = [];
  for (const mp of map.placements) {
    const b = KIT_BUILDINGS[mp.prefab];
    if (!b?.doors?.length) continue;
    const up = latLonToDir(mp.lat, mp.lon);
    const forward = headingTangent(up, mp.yaw);
    const side = v3normalize(v3cross(up, forward));
    const site = buildingSite(terrain, b, mp);
    const base = atRadius(up, R + terrain.heightAt(up) + (mp.lift ?? 0) + site.raise);
    const at = (x: number, y: number, z: number) => add(add(add(base, side, x), up, y), forward, z);
    for (const door of b.doors) {
      const a = door.yaw * DEG;
      const ox = -Math.sin(a);
      const oz = Math.cos(a);
      const inside = at(door.x - ox * 0.8, KIT.floorTop, door.z - oz * 0.8);
      const outsideTop = at(door.x + ox * 0.9, KIT.floorTop + 1.2, door.z + oz * 0.9);
      const u = v3normalize(outsideTop);
      const hit = physics.castRay(outsideTop, { x: -u.x, y: -u.y, z: -u.z }, 6, SOLID);
      if (!hit) continue;
      const outside = add(outsideTop, u, -hit.toi);
      const ui = v3normalize(inside);
      const fi = physics.castRay(add(inside, ui, 0.4), { x: -ui.x, y: -ui.y, z: -ui.z }, 0.8, SOLID);
      if (!fi) continue;
      const floor = add(inside, ui, 0.4 - fi.toi);
      if (!standable(floor, ui)) continue;
      const i = pushNode(floor, true, false, dense, true);
      const o = pushNode(outside, hit.handle !== physics.terrainHandle, false, dense, true);
      if (i >= 0 && o >= 0) doorPairs.push([i, o]);
    }
  }
  // Authored waypoints (map file) with their explicit links.
  const authored = new Map<string, number>();
  for (const w of map.waypoints ?? []) {
    const d = latLonToDir(w.lat, w.lon);
    const p = atRadius(d, R + terrain.heightAt(d) + (w.height ?? 0));
    const id = pushNode(p, (w.height ?? 0) > 0.25, false, dense);
    if (id >= 0) authored.set(w.id, id);
  }

  // ---------------------------------------------------------------------------------------------- spatial hash
  const CELL = 7;
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const cells = new Map<string, number[]>();
  for (let i = 0; i < nodes.length; i++) {
    const p = nodes[i]!.pos;
    const k = key(Math.floor(p.x / CELL), Math.floor(p.y / CELL), Math.floor(p.z / CELL));
    (cells.get(k) ?? cells.set(k, []).get(k)!).push(i);
  }
  const around = (p: Vec3, r: number, visit: (j: number) => void) => {
    const cx = Math.floor(p.x / CELL), cy = Math.floor(p.y / CELL), cz = Math.floor(p.z / CELL);
    const span = Math.ceil(r / CELL);
    for (let x = cx - span; x <= cx + span; x++) for (let y = cy - span; y <= cy + span; y++) for (let z = cz - span; z <= cz + span; z++) {
      const list = cells.get(key(x, y, z));
      if (list) for (const j of list) visit(j);
    }
  };

  // ---------------------------------------------------------------------------------------------- walks
  /** Nothing solid at knee, chest and head height along a→b (and room for the capsule's width at chest height). */
  const clear = (a: Vec3, ua: Vec3, b: Vec3, ub: Vec3): boolean => {
    const along = sub(b, a);
    const l = len(along);
    if (l < 1e-3) return true;
    const dir = { x: along.x / l, y: along.y / l, z: along.z / l };
    for (const hgt of [0.45, 1.05, 1.55]) {
      const o = add(a, ua, hgt);
      const t = add(b, ub, hgt);
      const dd = sub(t, o);
      const dl = len(dd);
      if (physics.castRay(o, { x: dd.x / dl, y: dd.y / dl, z: dd.z / dl }, dl, PROPS)) return false;
    }
    const cross = v3cross(ua, dir);
    if (len(cross) < 0.2) return true;
    const lateral = v3normalize(cross);
    // Not the full capsule radius: the controller slides along a wall it brushes, and a lattice node is rarely on the
    // middle line of an alley or an aisle.
    for (const s of [-0.18, 0.18]) {
      const o = add(add(a, ua, 1.05), lateral, s);
      const t = add(add(b, ub, 1.05), lateral, s);
      const dd = sub(t, o);
      const dl = len(dd);
      if (physics.castRay(o, { x: dd.x / dl, y: dd.y / dl, z: dd.z / dl }, dl, PROPS)) return false;
    }
    return true;
  };
  /** Ground all along a walk from a to b: footing near the straight line at a quarter, half and three quarters. */
  const grounded = (a: NavNode, b: NavNode): boolean => {
    for (const t of [0.25, 0.5, 0.75]) {
      const m = { x: a.pos.x + (b.pos.x - a.pos.x) * t, y: a.pos.y + (b.pos.y - a.pos.y) * t, z: a.pos.z + (b.pos.z - a.pos.z) * t };
      const up = v3normalize(m);
      const want = len(m) - R;
      const tol = 0.45 + Math.abs(a.h - b.h) * 0.3;
      const hits = hitsAlong(physics, atRadius(up, R + want + tol + 0.6), { x: -up.x, y: -up.y, z: -up.z }, (tol + 0.6) * 2);
      const ok = hits.some((h) => {
        if (v3dot(h.normal, up) < WALK_COS - 0.1) return false;
        const hh = R + want + tol + 0.6 - h.toi - R;
        if (h.handle === physics.terrainHandle && hh < PLANET.seaLevel - WADE) return false;
        return Math.abs(hh - want) <= tol;
      });
      if (!ok) return false;
    }
    return true;
  };

  const edges: { a: number; b: number; c: number }[] = [];
  let drops = 0;
  const seen = new Set<string>();
  const link = (i: number, j: number, c: number, oneWay = false) => {
    const k = `${i}>${j}`;
    if (seen.has(k)) return;
    seen.add(k);
    edges.push({ a: i, b: j, c });
    if (!oneWay) {
      seen.add(`${j}>${i}`);
      edges.push({ a: j, b: i, c });
    }
  };
  const costOf = (a: NavNode, b: NavNode) => len(sub(b.pos, a.pos)) * (a.water || b.water ? 2.5 : 1);
  for (let i = 0; i < nodes.length; i++) {
    const A = nodes[i]!;
    const reachA = spacingOf[i]! * (spacingOf[i]! < 1.8 ? 1.75 : 1.55);
    around(A.pos, Math.max(reachA, far * 1.55), (j) => {
      if (j <= i) return;
      const B = nodes[j]!;
      const reach = Math.max(reachA, spacingOf[j]! * (spacingOf[j]! < 1.8 ? 1.75 : 1.55));
      const flat = sub(B.pos, A.pos);
      const vertical = B.h - A.h;
      const horizontal = len(add(flat, A.up, -v3dot(flat, A.up)));
      if (horizontal > reach || horizontal < 0.05) return;
      if (Math.abs(vertical) <= 0.4 + horizontal * 1.1) {
        if (clear(A.pos, A.up, B.pos, B.up) && grounded(A, B)) link(i, j, costOf(A, B));
        return;
      }
      // A ledge one may step off (a balcony, a terrace, a roof edge): down only, short and clear at the top.
      if (horizontal > 2.6 || Math.abs(vertical) > 3.4) return;
      const [hi, lo] = vertical < 0 ? [i, j] : [j, i];
      const H = nodes[hi]!;
      const L = nodes[lo]!;
      const above = atRadius(L.up, R + H.h);
      if (clear(H.pos, H.up, above, L.up) && clear(above, L.up, L.pos, L.up)) {
        link(hi, lo, costOf(H, L) + 1.5, true);
        drops++;
      }
    });
  }
  for (const [i, o] of doorPairs) if (clear(nodes[i]!.pos, nodes[i]!.up, nodes[o]!.pos, nodes[o]!.up)) link(i, o, costOf(nodes[i]!, nodes[o]!));
  for (const w of map.waypoints ?? []) for (const l of w.links) {
    const a = authored.get(w.id);
    const b = authored.get(l);
    if (a !== undefined && b !== undefined) link(a, b, costOf(nodes[a]!, nodes[b]!));
  }

  // ---------------------------------------------------------------------------------------------- CSR + components
  edges.sort((x, y) => x.a - y.a || x.b - y.b);
  const start = new Int32Array(nodes.length + 1);
  const adj = new Int32Array(edges.length);
  const cost = new Float32Array(edges.length);
  for (const e of edges) start[e.a + 1]!++;
  for (let i = 0; i < nodes.length; i++) start[i + 1]! += start[i]!;
  edges.forEach((e, k) => {
    adj[k] = e.b;
    cost[k] = e.c;
  });
  // Components over the undirected graph (a drop still joins two places).
  const component = new Int32Array(nodes.length).fill(-1);
  const undirected: number[][] = nodes.map(() => []);
  for (const e of edges) {
    undirected[e.a]!.push(e.b);
    undirected[e.b]!.push(e.a);
  }
  let components = 0;
  const sizes: number[] = [];
  for (let s = 0; s < nodes.length; s++) {
    if (component[s] !== -1) continue;
    const stack = [s];
    component[s] = components;
    let size = 0;
    while (stack.length) {
      const v = stack.pop()!;
      size++;
      for (const w of undirected[v]!) if (component[w] === -1) {
        component[w] = components;
        stack.push(w);
      }
    }
    sizes.push(size);
    components++;
  }

  // ---------------------------------------------------------------------------------------------- queries
  const g = new Float64Array(nodes.length);
  const from = new Int32Array(nodes.length);
  const stamp = new Uint32Array(nodes.length);
  const closedStamp = new Uint32Array(nodes.length);
  let gen = 0;

  const nearest = (p: Vec3, maxDist = 9): number => {
    const up = v3normalize(p);
    const h = len(p) - R;
    let best = -1;
    let bestScore = Infinity;
    around(p, maxDist, (j) => {
      const n = nodes[j]!;
      const d = len(sub(n.pos, p));
      if (d > maxDist) return;
      // Same level first: a node a floor above or below costs as if it were far away.
      const score = d + Math.max(0, Math.abs(n.h - h) - 0.9) * 6;
      if (score >= bestScore) return;
      if (!clear(p, up, n.pos, n.up)) return;
      best = j;
      bestScore = score;
    });
    return best;
  };

  const route = (a: number, b: number, maxExpand = 60000): number[] | null => {
    if (a < 0 || b < 0) return null;
    if (component[a] !== component[b]) return null;
    gen++;
    const target = nodes[b]!.pos;
    // Binary heap of (f, node).
    const heapF: number[] = [];
    const heapN: number[] = [];
    const push = (f: number, n: number) => {
      heapF.push(f);
      heapN.push(n);
      let i = heapF.length - 1;
      while (i > 0) {
        const pa = (i - 1) >> 1;
        if (heapF[pa]! <= heapF[i]!) break;
        [heapF[pa], heapF[i]] = [heapF[i]!, heapF[pa]!];
        [heapN[pa], heapN[i]] = [heapN[i]!, heapN[pa]!];
        i = pa;
      }
    };
    const pop = (): number => {
      const top = heapN[0]!;
      const lf = heapF.pop()!;
      const ln = heapN.pop()!;
      if (heapF.length) {
        heapF[0] = lf;
        heapN[0] = ln;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1;
          const r = l + 1;
          let m = i;
          if (l < heapF.length && heapF[l]! < heapF[m]!) m = l;
          if (r < heapF.length && heapF[r]! < heapF[m]!) m = r;
          if (m === i) break;
          [heapF[m], heapF[i]] = [heapF[i]!, heapF[m]!];
          [heapN[m], heapN[i]] = [heapN[i]!, heapN[m]!];
          i = m;
        }
      }
      return top;
    };
    g[a] = 0;
    from[a] = -1;
    stamp[a] = gen;
    push(len(sub(target, nodes[a]!.pos)), a);
    let expanded = 0;
    while (heapF.length) {
      const v = pop();
      if (closedStamp[v] === gen) continue;
      closedStamp[v] = gen;
      if (v === b) {
        const out: number[] = [];
        for (let k = b; k !== -1; k = from[k]!) out.push(k);
        return out.reverse();
      }
      if (++expanded > maxExpand) return null;
      for (let k = start[v]!; k < start[v + 1]!; k++) {
        const w = adj[k]!;
        if (closedStamp[w] === gen) continue;
        const ng = g[v]! + cost[k]!;
        if (stamp[w] === gen && ng >= g[w]!) continue;
        stamp[w] = gen;
        g[w] = ng;
        from[w] = v;
        push(ng + len(sub(target, nodes[w]!.pos)), w);
      }
    }
    return null;
  };

  const path = (p: Vec3, q: Vec3): Vec3[] | null => {
    const a = nearest(p);
    const b = nearest(q, 12);
    const ids = route(a, b);
    if (!ids) return null;
    return [...ids.map((i) => nodes[i]!.pos), q];
  };

  if (crateColliders.length) {
    removeColliders(physics, crateColliders);
    refreshQueries(physics);
  }
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    nodes,
    start,
    adj,
    cost,
    component,
    nearest,
    route,
    path,
    stats: {
      nodes: nodes.length,
      raised: nodes.filter((n) => n.raised).length,
      doors: doorPairs.length,
      edges: edges.length,
      drops,
      largest: Math.max(0, ...sizes),
      components,
      ms: Math.round(t1 - t0),
    },
  };
}
