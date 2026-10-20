/**
 * Authoring of the vertical world (docs/world/VERTICAL_WORLD_DESIGN.md): the Serra do Mirante massif, the Arquipélago
 * dos Sinos, their winds, chest spots and bot waypoints, written into the versioned map
 * (packages/game-data/src/world/planeta-graao.map.json) next to the editor's hand edits.
 *
 * Idempotent: every entry it owns has an id starting with `vert-`; a run removes the previous ones and writes the new
 * set, leaving everything else (and `editedAt`) as it is. Positions are designed in the massif's own frame (metres:
 * +X east, +Z south, Y up from its base, the frame the game's layout builds for the building) and converted with the
 * same functions the layout uses, so what is computed here (lifts, chest heights, wind columns) lands where the game
 * puts it. After a run, the map editor (`?editor`) can move any of it; run this again only to reset the region.
 *
 *   pnpm exec tsx tools/world/vertical-world.ts            (dry run: terrain under the design, the plan)
 *   pnpm exec tsx tools/world/vertical-world.ts --write    (writes the map file, bumps its versions)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirToLatLon, headingTangent, latLonToDir, transportTangent } from '@graao/game-core';
import { serializeMap, validateMap, type ChestSpotDef, type GraaoMap, type MapPlacement, type MapTraversalLink, type MapWaypoint, type MapWind } from '@graao/game-data';
import { v3dot, v3normalize, type Vec3 } from '@graao/shared';
import { R, frameOf, round, terrain } from './author';

const FILE = new URL('../../packages/game-data/src/world/planeta-graao.map.json', import.meta.url);
const write = process.argv.includes('--write');
const map = JSON.parse(readFileSync(FILE, 'utf8')) as GraaoMap;
const OWN = (id: string) => id.startsWith('vert-');

// ------------------------------------------------------------------------------------------------ the massif frame

/** The massif sits on the crest of the Serra do Mirante's first ridge, its front (the climbing faces) to the south. */
const MASSIF: MapPlacement = { id: 'vert-serra-macico', prefab: 'serra-do-mirante', lat: 64.2, lon: -77.5, yaw: 180, region: 'serra' };
const F = frameOf(MASSIF);
const C = F.up;

const latLonToDirOf = (p: { lat: number; lon: number }) => latLonToDir(p.lat, p.lon);
const llOf = (p: Vec3) => {
  const ll = dirToLatLon(v3normalize(p));
  return { lat: round(ll.lat, 5), lon: round(ll.lon, 5) };
};
/** Yaw (degrees clockwise from the local north at `dir`) of the direction `v` (any vector; its tangent part counts). */
function yawToward(dir: Vec3, v: Vec3): number {
  const n = headingTangent(dir, 0);
  const e = headingTangent(dir, 90);
  return round(((Math.atan2(v3dot(v, e), v3dot(v, n)) * 180) / Math.PI + 360) % 360, 2);
}
/**
 * Yaw at `dir` of the massif's forward (+Z, south) turned by `turn` degrees toward its +X (east): 90 = the massif's
 * +X carried to `dir`.
 */
function yawAt(dir: Vec3, turn = 0): number {
  const a = (turn * Math.PI) / 180;
  const f0 = v3normalize({ x: F.forward.x * Math.cos(a) + F.side.x * Math.sin(a), y: F.forward.y * Math.cos(a) + F.side.y * Math.sin(a), z: F.forward.z * Math.cos(a) + F.side.z * Math.sin(a) });
  return yawToward(dir, transportTangent(f0, C, dir));
}
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const radial = (p: Vec3) => Math.hypot(p.x, p.y, p.z) - R;
/** Terrain height (m over the radius) under massif-frame (x, z). */
const groundH = (x: number, z: number) => terrain.heightAt(v3normalize(F.at(x, 0, z)));
const baseTop = R + terrain.heightAt(C) + F.raise;
/** Radial height (over the radius) of massif-frame height y. */
const massifH = (y: number) => baseTop - R + y;

// ------------------------------------------------------------------------------------------------ the design

const placements: MapPlacement[] = [MASSIF];
const chests: ChestSpotDef[] = [];
const winds: MapWind[] = [];
const waypoints: MapWaypoint[] = [];
const links: MapTraversalLink[] = [];

/** An island (building) whose walking surface is `top` m over the radius, centred on massif-frame (x, z). */
function islandAt(id: string, prefab: string, x: number, z: number, top: number, turn = 0): MapPlacement {
  const dir = v3normalize(F.at(x, 0, z));
  const { lat, lon } = llOf(dir);
  const p: MapPlacement = { id, prefab, lat, lon, yaw: yawAt(dir, turn), lift: round(top - terrain.heightAt(dir), 2), region: 'serra' };
  placements.push(p);
  return p;
}
/** A placement standing on the ground (or lifted to `top` over the radius) at massif-frame (x, z). */
function pieceAt(id: string, prefab: string, x: number, z: number, o: { top?: number; turn?: number; scale?: number } = {}): MapPlacement {
  const dir = v3normalize(F.at(x, 0, z));
  const { lat, lon } = llOf(dir);
  const p: MapPlacement = { id, prefab, lat, lon, yaw: yawAt(dir, o.turn ?? 0), region: 'serra', ...(o.top !== undefined ? { lift: round(o.top - terrain.heightAt(dir), 2) } : {}), ...(o.scale ? { scale: o.scale } : {}) };
  placements.push(p);
  return p;
}
/**
 * A wind column at massif-frame (x, z) from radial height `from` to `to` (m over the radius). Directional winds blow
 * toward massif-frame direction `toward` (degrees: 0 = +Z/south, 90 = +X/east).
 */
function windAt(w: Omit<MapWind, 'lat' | 'lon' | 'base' | 'height' | 'yaw' | 'region'> & { x: number; z: number; from: number; to: number; toward?: number }): MapWind {
  const dir = v3normalize(F.at(w.x, 0, w.z));
  const g = terrain.heightAt(dir);
  const { x: _x, z: _z, from, to, toward, ...rest } = w;
  const out: MapWind = { ...rest, ...llOf(dir), base: round(from - g, 2), height: round(to - from, 2), region: 'serra' };
  // The frame's +Z is the massif's forward (south): turn = toward.
  if (toward !== undefined) out.yaw = yawAt(dir, toward);
  winds.push(out);
  return out;
}
/** A chest spot standing on a prop surface at world point `p` (its feet), facing massif turn `turn` (90: east). */
function chestOn(id: string, p: Vec3, hint: string, turn: number, o: Partial<ChestSpotDef> = {}): void {
  const dir = v3normalize(p);
  chests.push({ id, region: 'Trilhas', ...llOf(dir), hint, surface: 'prop', height: round(radial(p) - terrain.heightAt(dir), 2), yaw: yawAt(dir, turn), ...o });
}
/** A wind column centred on the radial through world point `p`, from radial height `from` to `to`. */
function windOn(w: Omit<MapWind, 'lat' | 'lon' | 'base' | 'height' | 'region'> & { from: number; to: number }, p: Vec3): MapWind {
  const dir = v3normalize(p);
  const g = terrain.heightAt(dir);
  const { from, to, ...rest } = w;
  const out: MapWind = { ...rest, ...llOf(dir), base: round(from - g, 2), height: round(to - from, 2), region: 'serra' };
  winds.push(out);
  return out;
}
/**
 * A waypoint at massif-frame (x, z), its feet at frame height `y` (null: on the terrain). The frame is a tangent plane:
 * away from its centre the same `y` stands higher over the planet (d²/2R), so the height comes from the world point.
 */
function wp(id: string, x: number, z: number, y: number | null, links: string[], kind: MapWaypoint['kind']): void {
  const p = F.at(x, y ?? 0, z);
  const dir = v3normalize(p);
  const h = y === null ? 0 : radial(p) - terrain.heightAt(dir);
  waypoints.push({ id, ...llOf(dir), ...(h > 0.25 ? { height: round(h, 2) } : {}), links, region: 'serra', kind });
}

// Serra do Mirante: summit chest (exposed, risk), route C's updraft and the corrente over to the summit.
const T1 = 4.2;
const T2 = 8.0;
const T3 = 11.6;
chestOn('vert-cume-mirante', F.at(-0.6, T3, 0.4), 'Cume da Serra do Mirante: exposto, alcançável pelas três rotas', 0);
windAt({ id: 'vert-corrente-mirante-subida', kind: 'updraft', x: -10.9, z: -0.8, radius: 2.4, strength: 6.5, from: groundH(-10.9, -0.8) - 0.5, to: massifH(T3) + 6.0 });
windAt({ id: 'vert-corrente-mirante-travessia', kind: 'directional', x: -7.2, z: -0.8, radius: 3.6, strength: 6, from: massifH(T3) + 1.0, to: massifH(T3) + 7.5, toward: 90 });

// Arquipélago dos Sinos, east and south of the massif (over the low ground): the Ilha do Sino, the Ilha do Oratório
// across a rope bridge, the Ilha da Torre up a stair of floating stones (or the bell's updraft).
const A = { x: 17, z: 8 };
const TOP = massifH(T3) - 2.2;
const sino = { x: A.x, z: A.z, top: TOP };
const oratorio = { x: A.x + 5.5 + 7.0 + 3.5, z: A.z, top: TOP };
const torre = { x: A.x + 4.0, z: A.z - 13.5, top: TOP + 7.0 };
const ilhaSino = islandAt('vert-ilha-do-sino', 'ilha-do-sino', sino.x, sino.z, sino.top);
const ilhaOratorio = islandAt('vert-ilha-do-oratorio', 'ilha-do-oratorio', oratorio.x, oratorio.z, oratorio.top);
const ilhaTorre = islandAt('vert-ilha-da-torre', 'ilha-da-torre', torre.x, torre.z, torre.top);
// Everything on or beside an island is placed in that island's own frame (the frame the game builds for it).
const SF = frameOf(ilhaSino);
const OF = frameOf(ilhaOratorio);
const TF = frameOf(ilhaTorre);
/** A piece centred on world point `p`, its forward along `along` (a world vector), lifted to `p`'s radial height. */
function pieceOn(id: string, prefab: string, p: Vec3, along: Vec3, scale?: number): MapPlacement {
  const dir = v3normalize(p);
  const q: MapPlacement = { id, prefab, ...llOf(dir), yaw: yawToward(dir, along), lift: round(radial(p) - terrain.heightAt(dir), 2), region: 'serra', ...(scale ? { scale } : {}) };
  placements.push(q);
  return q;
}
// The rope bridge (ponte-tabuas runs 7 m along its Z) from the Ilha do Sino's east edge to the Oratório's west edge.
{
  const a = SF.at(5.5, 0, 0);
  const b = OF.at(-3.5, 0, 0);
  pieceOn('vert-ponte-sino-oratorio', 'ponte-tabuas', { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }, sub(b, a));
}
// The stair of floating stones from the Oratório's north edge up to just south of the Ilha da Torre's south face
// (≈ 1 m up and ≈ 2.2 m apart each, zigzagging), whose edge is then a ledge 1.25 m over the last stone.
{
  const s = OF.at(-1.0, 0.95, -4.9);
  const e = TF.at(1.2, -1.25, 3.6);
  const n = 6;
  const across = v3normalize({ x: (e.y - s.y) * 0 + (v3normalize(s).y * (e.z - s.z) - v3normalize(s).z * (e.y - s.y)), y: v3normalize(s).z * (e.x - s.x) - v3normalize(s).x * (e.z - s.z), z: v3normalize(s).x * (e.y - s.y) - v3normalize(s).y * (e.x - s.x) });
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const zig = i === 0 || i === n - 1 ? 0 : i % 2 ? 0.7 : -0.7;
    const p = { x: s.x + (e.x - s.x) * t + across.x * zig, y: s.y + (e.y - s.y) * t + across.y * zig, z: s.z + (e.z - s.z) * t + across.z * zig };
    pieceOn(`vert-pedra-${i}`, 'plataforma-pedra', p, headingTangent(v3normalize(p), i * 37));
  }
}
// The trail marker at the foot of route A (on the terrain: the massif's frame floats over the ground at its edges).
pieceAt('vert-marco-trilha', 'marco-trilha', 10.8, 8.4, { turn: 200 });
// A stone under the summit's corrente too (a landing if the glide falls short of the island).
pieceAt('vert-pedra-mirante-0', 'plataforma-pedra', 9.4, 3.2, { top: massifH(T2) + 0.6, turn: 15, scale: 1.3 });
// The universal way up: the Corrente do Sino, an updraft beside the Ilha do Sino's west edge.
{
  const p = SF.at(-7.9, 0, 0.6);
  windOn({ id: 'vert-corrente-do-sino', kind: 'updraft', radius: 2.3, strength: 6.5, from: terrain.heightAt(v3normalize(p)) - 0.5, to: sino.top + 5.5 }, p);
}
// The summit bell's corrente: from the summit's east side over to the Ilha do Sino (event wind), along the line
// from the summit to the island's west edge.
{
  const from = F.at(0, T3, 0);
  const to = SF.at(-4.5, 0, 0);
  const p = F.at(8.8, 0, 4.4);
  windOn({ id: 'vert-corrente-cume-ilha', kind: 'directional', radius: 5.2, strength: 9, from: TOP - 1.0, to: massifH(T3) + 4.0, trigger: MASSIF.id, yaw: yawToward(v3normalize(p), sub(to, from)) }, p);
}
// The Ilha do Sino's bell: an updraft from beside its north edge up to the Ilha da Torre (event wind).
windOn({ id: 'vert-corrente-torre', kind: 'updraft', radius: 2.2, strength: 6.5, from: TOP - 3.0, to: torre.top + 3.5, trigger: ilhaSino.id }, SF.at(2.6, 0, -7.6));
// Chests: inside the capelinha (covered, facing its opening to the island's +X), on top of the Ilha da Torre (exposed).
chestOn('vert-ilha-sino-capelinha', SF.at(-2.4, 0.12, -0.4), 'Ilha do Sino: dentro da capelinha (coberto, uma entrada)', 90, { covered: true });
chestOn('vert-ilha-torre', TF.at(0.6, 0, 0.4), 'Ilha da Torre: a mais alta, sem cobertura', 0);

// Bot waypoints along route A (the only route bots can follow: no climbing or gliding for bots yet).
wp('vert-wp-pe-trilha', 10.2, 9.0, null, ['vert-wp-rampa1-pe'], 'trilha');
wp('vert-wp-rampa1-pe', 8.9, 7.2, null, ['vert-wp-pe-trilha', 'vert-wp-rampa1-topo'], 'trilha');
wp('vert-wp-rampa1-topo', 8.9, -5.6, T1, ['vert-wp-rampa1-pe', 'vert-wp-t1-fundo-oeste'], 'trilha');
wp('vert-wp-t1-fundo-oeste', -7.0, -5.4, T1, ['vert-wp-rampa1-topo', 'vert-wp-rampa2-topo'], 'trilha');
wp('vert-wp-rampa2-topo', -7.0, 4.0, T2, ['vert-wp-t1-fundo-oeste', 'vert-wp-t2-frente'], 'trilha');
wp('vert-wp-t2-frente', 2.0, 2.9, T2, ['vert-wp-rampa2-topo', 'vert-wp-rampa3-pe'], 'trilha');
wp('vert-wp-rampa3-pe', 3.6, 3.45, T2 + 0.03, ['vert-wp-t2-frente', 'vert-wp-rampa3-topo'], 'trilha');
wp('vert-wp-rampa3-topo', 3.6, -3.6, T3, ['vert-wp-rampa3-pe', 'vert-wp-cume'], 'trilha');
wp('vert-wp-cume', 0.2, 0.2, T3, ['vert-wp-rampa3-topo', 'vert-wp-cume-leste'], 'mirante');
// The summit's east edge, where a glide on the summit bell's corrente makes the Ilha do Sino (from the middle it falls
// short: tools/world probe, 19/10).
wp('vert-wp-cume-leste', 2.3, 0.9, T3, ['vert-wp-cume'], 'mirante');

// Bot traversal links (docs/world/VERTICAL_BOT_NAVIGATION.md): the climbing faces of route B, the updrafts of route C
// and of the islands, the floating stones, and glides down from the summit and the islands. Every spot below was probed
// standable (tools/world probe, 19/10); the island waypoints are linked by hand (the automatic graph leaves the
// islands, the bridge and the front terrace of tier 1 as separate pieces).
/** A waypoint whose feet stand at world point `p` (an island, a stone, a terrace) — or on the terrain under it. */
function wpOn(id: string, p: Vec3, wpLinks: string[], kind: MapWaypoint['kind'], onGround = false): void {
  const dir = v3normalize(p);
  const h = onGround ? 0 : radial(p) - terrain.heightAt(dir);
  waypoints.push({ id, ...llOf(dir), ...(h > 0.25 ? { height: round(h, 2) } : {}), links: wpLinks, region: 'serra', kind });
}
function link(id: string, from: string, to: string, kind: MapTraversalLink['kind'], o: Partial<MapTraversalLink> = {}): void {
  links.push({ id, from, to, kind, region: 'serra', ...o });
}
// Route B: the three faces, the terraces between them, and a way on foot from the front terrace of tier 1 round its
// east side to the trail (a bot that falls off face 2 walks back).
wp('vert-wp-paredao1-pe', 0.4, 7.6, null, [], 'paredao');
wp('vert-wp-t1-paredao2', 0.4, 4.6, T1, ['vert-wp-t1-frente-leste'], 'paredao');
wp('vert-wp-t1-frente-leste', 3.0, 4.4, T1, ['vert-wp-t1-paredao2', 'vert-wp-t1-leste'], 'trilha');
wp('vert-wp-t1-leste', 6.6, 4.4, T1, ['vert-wp-t1-frente-leste', 'vert-wp-t1-leste-meio'], 'trilha');
wp('vert-wp-t1-leste-meio', 6.6, 0, T1, ['vert-wp-t1-leste', 'vert-wp-t1-leste-fundo'], 'trilha');
wp('vert-wp-t1-leste-fundo', 6.6, -5.3, T1, ['vert-wp-t1-leste-meio', 'vert-wp-rampa1-topo'], 'trilha');
wp('vert-wp-t2-paredao3', 0.4, 2.75, T2, ['vert-wp-t2-frente'], 'paredao');
link('vert-lk-paredao-1', 'vert-wp-paredao1-pe', 'vert-wp-t1-paredao2', 'escalada', { risk: 0.2 });
link('vert-lk-paredao-2', 'vert-wp-t1-paredao2', 'vert-wp-t2-paredao3', 'escalada', { risk: 0.2 });
link('vert-lk-paredao-3', 'vert-wp-t2-paredao3', 'vert-wp-cume', 'escalada', { risk: 0.2 });
// Route C: the west updraft (with the corrente across) onto the summit; a glide down the front.
wp('vert-wp-corrente-mirante', -10.9, -0.8, null, [], 'corrente');
link('vert-lk-corrente-mirante', 'vert-wp-corrente-mirante', 'vert-wp-cume', 'corrente', { wind: 'vert-corrente-mirante-subida', risk: 0.4 });
wp('vert-wp-pouso-cume', 0.5, 12.0, null, [], 'trilha');
link('vert-lk-planagem-cume', 'vert-wp-cume', 'vert-wp-pouso-cume', 'planagem', { risk: 0.3 });
// The Arquipélago dos Sinos: the Corrente do Sino up, a walk across the island and the rope bridge, the stones to the
// Ilha da Torre (or its bell's updraft), and a glide down from each island.
const groundAt = (p: Vec3): Vec3 => terrain.surfaceAt(v3normalize(p));
wpOn('vert-wp-corrente-sino', groundAt(SF.at(-7.9, 0, 0.6)), [], 'corrente', true);
wpOn('vert-wp-sino-oeste', SF.at(-3.8, 0, 2.4), ['vert-wp-sino-sul', 'vert-wp-sino-fundos-sul'], 'ilha');
// The strip between the capelinha's back wall and the west edge (where the summit's corrente lands a glider), open to
// the south: no lattice node sees into it past the chapel (tools/world probe, 19/10).
wpOn('vert-wp-sino-fundos', SF.at(-5.1, 0, 0.2), ['vert-wp-sino-fundos-sul'], 'ilha');
wpOn('vert-wp-sino-fundos-sul', SF.at(-5.0, 0, 2.3), ['vert-wp-sino-fundos', 'vert-wp-sino-oeste'], 'ilha');
wpOn('vert-wp-sino-sul', SF.at(-1.0, 0, 2.6), ['vert-wp-sino-oeste', 'vert-wp-sino-centro'], 'ilha');
wpOn('vert-wp-sino-centro', SF.at(1.5, 0, 1.5), ['vert-wp-sino-sul', 'vert-wp-sino-leste', 'vert-wp-sino-nordeste'], 'ilha');
wpOn('vert-wp-sino-nordeste', SF.at(4.2, 0, -1.8), ['vert-wp-sino-centro', 'vert-wp-sino-norte'], 'ilha');
wpOn('vert-wp-sino-norte', SF.at(2.6, 0, -3.6), ['vert-wp-sino-nordeste'], 'ilha');
wpOn('vert-wp-sino-leste', SF.at(4.6, 0, 0), ['vert-wp-sino-centro', 'vert-wp-oratorio-oeste'], 'ponte');
wpOn('vert-wp-oratorio-oeste', OF.at(-2.4, 0, 0), ['vert-wp-sino-leste', 'vert-wp-oratorio-norte', 'vert-wp-oratorio-leste'], 'ilha');
wpOn('vert-wp-oratorio-norte', OF.at(-0.6, 0, -3.0), ['vert-wp-oratorio-oeste'], 'ilha');
wpOn('vert-wp-oratorio-leste', OF.at(2.8, 0, 1.2), ['vert-wp-oratorio-oeste'], 'ilha');
wpOn('vert-wp-torre', TF.at(0.6, 0, 0.9), [], 'ilha');
link('vert-lk-corrente-sino', 'vert-wp-corrente-sino', 'vert-wp-sino-oeste', 'corrente', { wind: 'vert-corrente-do-sino', risk: 0.3 });
link('vert-lk-corrente-torre', 'vert-wp-sino-norte', 'vert-wp-torre', 'corrente', { wind: 'vert-corrente-torre', risk: 0.5 });
{
  const stones = placements.filter((p) => /^vert-pedra-\d$/.test(p.id));
  let prev = 'vert-wp-oratorio-norte';
  stones.forEach((st, i) => {
    const id = `vert-wp-pedra-${i}`;
    wpOn(id, frameOf(st).base, [], 'ilha');
    link(`vert-lk-salto-${i}`, prev, id, 'salto', { risk: 0.5 });
    prev = id;
  });
  link('vert-lk-salto-torre', prev, 'vert-wp-torre', 'salto', { risk: 0.5 });
}
wpOn('vert-wp-pouso-sino', groundAt(SF.at(3.0, 0, 12.0)), [], 'trilha', true);
wpOn('vert-wp-pouso-oratorio', groundAt(OF.at(10.0, 0, 3.0)), [], 'trilha', true);
wpOn('vert-wp-pouso-torre', groundAt(TF.at(0, 0, -8.0)), [], 'trilha', true);
link('vert-lk-planagem-sino', 'vert-wp-sino-sul', 'vert-wp-pouso-sino', 'planagem', { risk: 0.2 });
link('vert-lk-planagem-oratorio', 'vert-wp-oratorio-leste', 'vert-wp-pouso-oratorio', 'planagem', { risk: 0.2 });
link('vert-lk-planagem-torre', 'vert-wp-torre', 'vert-wp-pouso-torre', 'planagem', { risk: 0.3 });
// The summit bell's corrente: a glide from the summit's east edge across to the Ilha do Sino, only while that bell rings
// (a bot at the summit rings it first).
link('vert-lk-corrente-cume-ilha', 'vert-wp-cume-leste', 'vert-wp-sino-fundos', 'planagem', { wind: 'vert-corrente-cume-ilha', risk: 0.4 });

// ------------------------------------------------------------------------------------------------ report and write

const out = (v: number) => v.toFixed(2).padStart(6);
console.log(`maciço: base radial ${out(baseTop - R)} m (terreno ${out(terrain.heightAt(C))}, raise ${out(F.raise)}), cume ${out(massifH(T3))} m`);
console.log('terreno sob o maciço (x, z → altura relativa à base):');
for (const z of [-8, -6, -3, 0, 3, 6, 8]) {
  const row: string[] = [];
  for (const x of [-12, -10, -8, -4, 0, 4, 8, 10, 12]) row.push(out(groundH(x, z) - (baseTop - R)));
  console.log(`  z ${String(z).padStart(3)} |${row.join('')}`);
}
for (const p of placements) console.log(`${p.id.padEnd(34)} ${p.prefab.padEnd(22)} ${p.lat.toFixed(3)} ${p.lon.toFixed(3)} yaw ${p.yaw}${p.lift !== undefined ? ` lift ${p.lift}` : ''}`);
for (const w of winds) console.log(`${w.id.padEnd(34)} ${w.kind.padEnd(12)} base ${w.base} altura ${w.height} r ${w.radius}${w.yaw !== undefined ? ` yaw ${w.yaw}` : ''}${w.trigger ? ` gatilho ${w.trigger}` : ''}`);
for (const c of chests) console.log(`${c.id.padEnd(34)} baú h ${c.height}`);
for (const l of links) console.log(`${l.id.padEnd(34)} ${l.kind.padEnd(12)} ${l.from} → ${l.to}${l.wind ? ` (${l.wind})` : ''}`);

// Older serra pieces the massif would bury move out of its footprint (once: afterwards they are outside it).
const RELOCATE: Record<string, [number, number]> = { 'serra-crista-1': [14.5, -7.0] };
const inFootprint = (p: MapPlacement) => {
  const d = v3normalize(latLonToDirOf(p));
  const q = { x: d.x * (baseTop) - F.base.x, y: d.y * baseTop - F.base.y, z: d.z * baseTop - F.base.z };
  return Math.abs(v3dot(q, F.side)) < 10.5 && Math.abs(v3dot(q, F.forward)) < 8.5;
};
const kept = map.placements.filter((p) => !OWN(p.id)).map((p) => {
  const to = RELOCATE[p.id];
  if (!to || !inFootprint(p)) return p;
  const dir = v3normalize(F.at(to[0], 0, to[1]));
  console.log(`realocado: ${p.id} → (${to.join(', ')}) no referencial do maciço`);
  return { ...p, ...llOf(dir), yaw: yawAt(dir, p.yaw) };
});

const next: GraaoMap = {
  ...map,
  placements: [...kept, ...placements],
  chestSpots: [...map.chestSpots.filter((c) => !OWN(c.id)), ...chests],
  waypoints: [...(map.waypoints ?? []).filter((w) => !OWN(w.id)), ...waypoints],
  trails: map.trails ?? [],
  winds: [...(map.winds ?? []).filter((w) => !OWN(w.id)), ...winds],
  traversalLinks: [...(map.traversalLinks ?? []).filter((l) => !OWN(l.id)), ...links],
};
const problems = validateMap(next);
if (problems.length) throw new Error(problems.join('\n'));
if (write) {
  // One version step per change of the vertical set (a re-run that changes nothing writes nothing new).
  const same = JSON.stringify(next) === JSON.stringify(map);
  if (same) {
    console.log('nada mudou: mapa intacto');
    process.exit(0);
  }
  next.mapVersion = map.mapVersion + 1;
  next.geometryVersion = map.geometryVersion + 1;
  next.collisionVersion = map.collisionVersion + 1;
  writeFileSync(FILE, serializeMap(next));
  console.log(`gravado: mapVersion ${next.mapVersion}`);
} else console.log('(simulação: use --write para gravar)');
