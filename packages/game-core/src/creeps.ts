/**
 * GRACreepSystem: the authoritative creeps of one room (server), with the room as its host (like the loot and ability
 * systems), plus the CreepSpawnDirector that decides where and when they appear.
 *
 * - Areas (game-data CREEP_AREAS) are validated once on the real collision world (`resolveCreepAreas`): candidate
 *   points need terrain under open sky (never inside a house or on a roof), dry gentle ground and room around them.
 * - The director fills the planet up to the room's cap at the match start, schedules a respawn only once a defeated
 *   creep's body is gone (a new id: no XP twice), and spawns it on a valid point of its area away from players and
 *   other creeps, inside the region the Tormenta closes onto. A respawn that finds no valid point retries a few times,
 *   then is dropped. The cap follows the Tormenta: the population shrinks with the playable region.
 * - Each creep runs a small state machine (IDLE → PATROL, ALERT → CHASE → ATTACK, RETURN, DEAD). Movement is
 *   tangential on the sphere: every step probes for walls at knee height and snaps to the ground below (terrain or a
 *   prop surface such as a stair) with a step limit, so creeps follow slopes and stairs, keep out of water and never
 *   walk through walls. Blocked directions are steered around; a chase stuck too long gives up.
 * - Attacks have a telegraphed wind-up, a blow resolved on the server (reach, arc, line of sight), a recovery window
 *   and a cooldown. Damage to players goes through the host; damage to creeps comes in through `damage`.
 * - Death stops the AI at once, hands the XP split to the host exactly once, keeps the body for the defeat effect and
 *   then removes it.
 */
import { CREEPS, CREEP_AREAS, CREEP_RULES, CREEP_TYPE_IDS, PLANET, type CreepAreaDef, type CreepTypeDef, type CreepTypeId } from '@graao/game-data';
import { CREEP_TARGET_BASE, CreepStateCode, FACING_SCALE, POS_SCALE, v3angle, v3cross, v3dot, v3normalize, v3projectOnPlane, v3rotateAxis, type CreepSnap, type GameEvent, type Vec3 } from '@graao/shared';
import type { PlayerHitTarget } from './combat';
import type { MeleeBody } from './melee';
import { Group, groups, type GamePhysics } from './physics';
import { splitCreepXp } from './progression';
import { hashString, mulberry32 } from './rng';
import { latLonToDir, northTangent } from './sphere';

const DEG = Math.PI / 180;
const SEA = PLANET.radius + PLANET.seaLevel;
/** The host supplies a room-filtered query facade for temporary barriers. */
export const CREEP_WALK_QUERY = groups(0xffff, Group.TERRAIN | Group.PROP | Group.RAIL | Group.BARRIER);
/** What blocks a creep's sight and blows (railings and fences do not). */
export const CREEP_SIGHT_QUERY = groups(0xffff, Group.TERRAIN | Group.PROP | Group.BARRIER);

// ------------------------------------------------------------------------------------------------ geometry helpers

const add = (a: Vec3, d: Vec3, s: number): Vec3 => ({ x: a.x + d.x * s, y: a.y + d.y * s, z: a.z + d.z * s });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
const dist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const unit = (a: Vec3): Vec3 => v3normalize(a);
/** Tangent direction from `from` toward `to` on `from`'s ground plane (null when right on top). */
function tangentToward(from: Vec3, to: Vec3): Vec3 | null {
  const up = unit(from);
  const t = v3projectOnPlane(sub(to, from), up);
  const l = len(t);
  return l > 1e-4 ? { x: t.x / l, y: t.y / l, z: t.z / l } : null;
}

// ------------------------------------------------------------------------------------------------ areas

export interface CreepPoint {
  pos: Vec3;
  up: Vec3;
}

export interface CreepArea {
  def: CreepAreaDef;
  index: number;
  centre: Vec3;
  /** Valid spawn points (may be empty: the area is then off). */
  points: CreepPoint[];
  /** How many candidates each check refused (dev overlay, tests). */
  refused: Record<string, number>;
}

/** A random direction within `radiusDeg` of `centre` (uniform over the cap). */
function pointInCap(centre: Vec3, radiusDeg: number, rand: () => number): Vec3 {
  const up = unit(centre);
  const r = radiusDeg * DEG * Math.sqrt(rand());
  const bearing = rand() * Math.PI * 2;
  const t = v3rotateAxis(northTangent(up), up, bearing);
  return unit(v3rotateAxis(up, unit(v3cross(up, t)), r));
}

/** Ground under a direction: terrain under open sky, dry, gentle, with room around it; else the reason. */
export function checkCreepPoint(physics: GamePhysics, dir: Vec3, radius = CREEP_RULES.propClear): CreepPoint | string {
  const top = add(dir, dir, PLANET.radius + 24 - 1);
  const hit = physics.castRayNormal(top, { x: -dir.x, y: -dir.y, z: -dir.z }, 40, CREEP_WALK_QUERY);
  if (!hit) return 'sem chão';
  if (hit.handle !== physics.terrainHandle) return 'coberto (telhado/estrutura)';
  const pos = add(top, dir, -hit.toi);
  if (len(pos) < SEA + 0.05) return 'água';
  if (v3angle(hit.normal, dir) > CREEP_RULES.maxSlopeDeg * DEG) return 'íngreme';
  if (physics.ballOverlaps(add(pos, dir, 0.75), radius, groups(0xffff, Group.PROP | Group.RAIL))) return 'colado em objeto';
  if (physics.castRay(add(pos, dir, 0.3), dir, CREEP_RULES.skyClear, groups(0xffff, Group.PROP))) return 'sem céu aberto';
  // Somewhere to go: at least two of four short steps around it must be walkable.
  let open = 0;
  const t0 = northTangent(dir);
  for (let k = 0; k < 4; k++) {
    const d = v3rotateAxis(t0, dir, (k * Math.PI) / 2);
    if (walkStep(physics, add(pos, dir, 0.02), d, 1.2, 0.4).ok) open++;
  }
  if (open < 2) return 'encurralado';
  return { pos: add(pos, dir, 0.02), up: dir };
}

/** Validates every creep area once on the static world (deterministic: same world, same points). */
export function resolveCreepAreas(physics: GamePhysics, defs: CreepAreaDef[] = CREEP_AREAS): CreepArea[] {
  return defs.map((def, index) => {
    const centre = latLonToDir(def.lat, def.lon);
    const rand = mulberry32(hashString(def.id));
    const points: CreepPoint[] = [];
    const refused: Record<string, number> = {};
    for (let i = 0; i < CREEP_RULES.candidates && points.length < CREEP_RULES.pointsPerArea; i++) {
      const dir = i === 0 ? centre : pointInCap(centre, def.radiusDeg, rand);
      const r = checkCreepPoint(physics, dir);
      if (typeof r === 'string') {
        refused[r] = (refused[r] ?? 0) + 1;
        continue;
      }
      if (points.some((p) => dist(p.pos, r.pos) < 2.5)) {
        refused['perto de outro ponto'] = (refused['perto de outro ponto'] ?? 0) + 1;
        continue;
      }
      points.push(r);
    }
    return { def, index, centre, points, refused };
  });
}

// ------------------------------------------------------------------------------------------------ walking

export interface WalkResult {
  ok: boolean;
  pos: Vec3;
}

/**
 * One tangential step of `distance` (m) along `dir` from `pos` (feet): a wall at knee height or a steep face blocks
 * it; the new feet snap onto whatever is below (terrain or a prop surface) within the step-up and drop limits; water
 * deeper than a puddle is refused.
 */
export function walkStep(physics: GamePhysics, pos: Vec3, dir: Vec3, distance: number, radius: number): WalkResult {
  const up = unit(pos);
  const R = CREEP_RULES;
  const wall = physics.castRayNormal(add(pos, up, R.probeHeight), dir, distance + radius, CREEP_WALK_QUERY);
  if (wall && v3dot(wall.normal, up) < 0.7) return { ok: false, pos };
  const c = add(pos, dir, distance);
  const cu = unit(c);
  const from = add(c, cu, R.maxStep + 0.4);
  const ground = physics.castRayNormal(from, { x: -cu.x, y: -cu.y, z: -cu.z }, R.maxStep + 0.4 + R.maxDrop, CREEP_WALK_QUERY);
  if (!ground) return { ok: false, pos };
  const g = add(from, cu, -ground.toi);
  if (v3angle(ground.normal, cu) > 42 * DEG) return { ok: false, pos };
  if (len(g) < SEA - R.maxWade) return { ok: false, pos };
  return { ok: true, pos: add(g, cu, 0.01) };
}

// ------------------------------------------------------------------------------------------------ runtime

export interface CreepPlayer {
  index: number;
  pos: Vec3;
  alive: boolean;
}

export interface CreepHost {
  physics: GamePhysics;
  /** The players creeps may see and attack (alive and taking part). */
  players(): Iterable<CreepPlayer>;
  /** The fight has started: creeps may aggro and attack (before it they only wander). */
  hostile(now: number): boolean;
  /** A creep's blow landed on player `target` (the room applies Shield-then-Health damage and its bookkeeping). */
  hurt(creep: CreepRuntime, target: number, amount: number, now: number): void;
  /** Creep defeated by `by` (≥ 0), with the XP each player gets (player index → XP). Called once per creep. */
  defeated(creep: CreepRuntime, by: number, shares: Map<number, number>, now: number): void;
  /** May this player still receive XP (alive, taking part)? */
  eligible(index: number): boolean;
  emit(e: GameEvent): void;
  /** Tormenta: may a new creep appear here, and is a creep standing in the Tormenta? Absent = anywhere / never. */
  spawnable?(pos: Vec3): boolean;
  inStorm?(pos: Vec3): boolean;
  /** 0..1 multiplier on the population cap (the Tormenta's shrinking region); absent = 1. */
  capFactor?(): number;
}

export interface CreepRuntime {
  id: number;
  type: CreepTypeId;
  def: CreepTypeDef;
  area: number;
  pos: Vec3;
  facing: Vec3;
  /** Where it lives (its spawn point): patrols stay around it and chases are leashed to it. */
  home: Vec3;
  state: CreepStateCode;
  since: number;
  health: number;
  /** Player it is after (-1: nobody). */
  target: number;
  goal: Vec3 | null;
  /** How long it idles before the next patrol leg. */
  idleFor: number;
  /** Next attack in `def.attacks` (looping), and the one winding up now. */
  attackIndex: number;
  windup: { k: number; until: number; target: number } | null;
  recoverUntil: number;
  nextAttackAt: number;
  retreatUntil: number;
  thinkAt: number;
  lostSince: number;
  stuckSince: number;
  /** Turning side preferred when blocked (+1 / -1), flipped when it does not help. */
  side: number;
  /** Valid damage per player (XP credit); cleared when it gives up a chase and heals back. */
  contrib: Map<number, number>;
  /** When each contributor last hurt it (server ms): stale help earns nothing (CREEP_RULES.creditWindowMs). */
  contribAt: Map<number, number>;
  removeAt: number;
  stormSince: number;
}

interface PendingSpawn {
  area: number;
  at: number;
  tries: number;
}

/**
 * CreepSpawnDirector: population, spawn points and respawns over the validated areas. Pure bookkeeping; the creep
 * system asks it what to spawn and tells it when a body is removed.
 */
export class CreepSpawnDirector {
  readonly pending: PendingSpawn[] = [];
  /** Respawns given up because no valid point was found (dev overlay, tests). */
  dropped = 0;

  constructor(
    readonly areas: CreepArea[],
    private rand: () => number,
  ) {}

  reset(seed: number): void {
    this.pending.length = 0;
    this.dropped = 0;
    this.rand = mulberry32(seed ^ 0x2c1b3c6d);
  }

  /** The areas that can hold creeps, and how many each gets at the start for a planet-wide cap (round robin). */
  initialPlan(maxActive: number): number[] {
    const counts = this.areas.map(() => 0);
    const usable = this.areas.filter((a) => a.points.length > 0);
    if (!usable.length) return counts;
    const start = Math.floor(this.rand() * usable.length);
    let total = 0;
    for (let round = 0; total < maxActive; round++) {
      let placed = false;
      for (let k = 0; k < usable.length && total < maxActive; k++) {
        const a = usable[(start + k) % usable.length]!;
        if (counts[a.index]! < Math.min(a.def.max, a.points.length) && counts[a.index]! <= round) {
          counts[a.index]!++;
          total++;
          placed = true;
        }
      }
      if (!placed) break;
    }
    return counts;
  }

  /** Weighted type for a new creep in `area`, respecting the area's per-type caps (null: nothing allowed). */
  pickType(area: CreepArea, living: readonly CreepRuntime[]): CreepTypeId | null {
    const inArea = living.filter((c) => c.area === area.index);
    const options = area.def.types.filter((t) => inArea.filter((c) => c.type === t.v).length < (area.def.maxOf?.[t.v] ?? Infinity));
    if (!options.length) return null;
    let total = 0;
    for (const o of options) total += o.w;
    let r = this.rand() * total;
    for (const o of options) {
      r -= o.w;
      if (r < 0) return o.v;
    }
    return options[options.length - 1]!.v;
  }

  /** A valid point of `area` now: away from living players and other creeps, and where the Tormenta allows. */
  pickPoint(area: CreepArea, players: readonly CreepPlayer[], living: readonly CreepRuntime[], spawnable?: (p: Vec3) => boolean, nearPlayersOk = false): CreepPoint | null {
    const R = CREEP_RULES;
    const ok = area.points.filter((p) =>
      (nearPlayersOk || players.every((q) => !q.alive || dist(q.pos, p.pos) >= R.minPlayerDistance)) &&
      living.every((c) => dist(c.pos, p.pos) >= R.minCreepSpacing) &&
      (!spawnable || spawnable(p.pos)),
    );
    return ok.length ? ok[Math.floor(this.rand() * ok.length)]! : null;
  }

  /** A body was removed: its area gets a creep back after the type's respawn delay. */
  schedule(area: number, def: CreepTypeDef, now: number): void {
    const [lo, hi] = def.respawnMs;
    this.pending.push({ area, at: now + lo + this.rand() * (hi - lo), tries: 0 });
  }

  /** Respawns due now (removed from the queue). */
  due(now: number): PendingSpawn[] {
    const out: PendingSpawn[] = [];
    for (let i = this.pending.length - 1; i >= 0; i--) {
      if (this.pending[i]!.at <= now) out.push(...this.pending.splice(i, 1));
    }
    return out;
  }

  /** A due respawn found no valid point: try again later, or give it up. */
  retry(p: PendingSpawn, now: number): void {
    if (++p.tries > CREEP_RULES.maxRetries) {
      this.dropped++;
      return;
    }
    p.at = now + CREEP_RULES.retryMs;
    this.pending.push(p);
  }
}

export interface CreepDamageResult {
  /** Health actually removed (0: dead already, or walking home immune). */
  dealt: number;
  killed: boolean;
}

export class GRACreepSystem {
  readonly creeps = new Map<number, CreepRuntime>();
  readonly director: CreepSpawnDirector;
  /** Planet-wide cap for this room (0 = no creeps). */
  maxActive: number = CREEP_RULES.maxActive;
  private nextId = 1;
  private running = false;
  private trimAt = 0;

  constructor(
    private readonly host: CreepHost,
    areas: CreepArea[],
  ) {
    this.director = new CreepSpawnDirector(areas, mulberry32(1));
  }

  get active(): boolean {
    return this.running;
  }

  /** Living creeps (not counting bodies still on the ground). */
  get alive(): number {
    let n = 0;
    for (const c of this.creeps.values()) if (c.state !== CreepStateCode.DEAD) n++;
    return n;
  }

  /**
   * A new population for a match: everything from before is gone, the director fills the areas round robin (its
   * initial plan first). A place that cannot take its share (the Tormenta's next region leaves it out, no free
   * point) gives it to the others, so the planet still gets its cap whenever the areas can hold it.
   */
  start(seed: number, now: number, maxActive: number = this.maxActive): void {
    this.clear();
    this.maxActive = Math.max(0, Math.floor(maxActive));
    this.running = this.maxActive > 0;
    this.director.reset(seed);
    if (!this.running) return;
    const plan = this.director.initialPlan(this.maxActive);
    const players = [...this.host.players()];
    // At the start nobody has landed yet: the player-distance rule does not apply.
    const place = (area: CreepArea): boolean => {
      const living = [...this.creeps.values()];
      const type = this.director.pickType(area, living);
      const point = type && this.director.pickPoint(area, players, living, this.host.spawnable, true);
      if (!type || !point) return false;
      this.spawn(type, area.index, point, now);
      return true;
    };
    plan.forEach((n, ai) => {
      for (let k = 0; k < n; k++) if (!place(this.director.areas[ai]!)) break;
    });
    this.refill(this.maxActive, (area) => place(area));
  }

  /** Round robin over the areas with room left (their own cap and valid points) until `cap` creeps live or none can take one. */
  private refill(cap: number, place: (area: CreepArea) => boolean): void {
    const areas = this.director.areas.filter((a) => a.points.length > 0);
    for (let progress = true; progress && this.alive < cap; ) {
      progress = false;
      for (const area of areas) {
        if (this.alive >= cap) break;
        const inArea = [...this.creeps.values()].filter((c) => c.area === area.index && c.state !== CreepStateCode.DEAD).length;
        if (inArea >= Math.min(area.def.max, area.points.length)) continue;
        if (place(area)) progress = true;
      }
    }
  }

  /** No creeps at all (lobby, results). */
  clear(): void {
    this.creeps.clear();
    this.director.pending.length = 0;
    this.running = false;
  }

  /** Hit targets for weapons and abilities (index = CREEP_TARGET_BASE + id). */
  hitTargets(): PlayerHitTarget[] {
    const out: PlayerHitTarget[] = [];
    for (const c of this.creeps.values()) {
      if (c.state === CreepStateCode.DEAD) continue;
      out.push({ index: CREEP_TARGET_BASE + c.id, feet: c.pos, alive: true, box: c.def.hitbox });
    }
    return out;
  }

  /** Bodies a punch can reach. */
  meleeBodies(): MeleeBody[] {
    const out: MeleeBody[] = [];
    for (const c of this.creeps.values()) {
      if (c.state === CreepStateCode.DEAD) continue;
      out.push({ id: c.id, creep: true, feet: c.pos, alive: true, bottom: c.def.hitbox.bottom, top: c.def.hitbox.top, radius: c.def.hitbox.radius });
    }
    return out;
  }

  snapshot(): CreepSnap[] {
    const out: CreepSnap[] = [];
    for (const c of this.creeps.values()) {
      out.push([
        c.id,
        CREEP_TYPE_IDS.indexOf(c.type),
        Math.round(c.pos.x * POS_SCALE),
        Math.round(c.pos.y * POS_SCALE),
        Math.round(c.pos.z * POS_SCALE),
        Math.round(c.facing.x * FACING_SCALE),
        Math.round(c.facing.y * FACING_SCALE),
        Math.round(c.facing.z * FACING_SCALE),
        c.state,
        Math.max(0, Math.ceil(c.health)),
        c.target,
      ]);
    }
    return out;
  }

  // ------------------------------------------------------------------------------------------------ damage

  /**
   * Player `by` hurt creep `id` (weapon, punch or ability). Provokes it (and its pack), credits the damage and, on
   * the killing blow, ends it exactly once. Walking home after a chase, it is immune (no leash abuse).
   */
  damage(id: number, by: number, amount: number, now: number, extra: { a?: string; m?: 1 } = {}): CreepDamageResult {
    const c = this.creeps.get(id);
    if (!c || c.state === CreepStateCode.DEAD || amount <= 0) return { dealt: 0, killed: false };
    if (c.state === CreepStateCode.RETURN) {
      this.host.emit({ e: 'creepHit', id, by, amount: 0, health: Math.ceil(c.health), ...extra });
      return { dealt: 0, killed: false };
    }
    const dealt = Math.min(Math.ceil(c.health), Math.max(1, Math.round(amount)));
    c.health -= dealt;
    c.contrib.set(by, (c.contrib.get(by) ?? 0) + dealt);
    c.contribAt.set(by, now);
    this.host.emit({ e: 'creepHit', id, by, amount: dealt, health: Math.max(0, Math.ceil(c.health)), ...extra });
    if (c.health <= 0) {
      this.kill(c, by, now);
      return { dealt, killed: true };
    }
    this.provoke(c, by, now);
    for (const o of this.creeps.values()) {
      if (o !== c && o.area === c.area && dist(o.pos, c.pos) < CREEP_RULES.packRange) this.provoke(o, by, now);
    }
    return { dealt, killed: false };
  }

  private provoke(c: CreepRuntime, by: number, now: number): void {
    if (c.state === CreepStateCode.IDLE || c.state === CreepStateCode.PATROL) {
      c.target = by;
      this.enter(c, CreepStateCode.ALERT, now);
    } else if ((c.state === CreepStateCode.CHASE || c.state === CreepStateCode.ALERT) && c.target < 0) c.target = by;
  }

  private kill(c: CreepRuntime, by: number, now: number): void {
    c.health = 0;
    c.windup = null;
    c.target = -1;
    c.goal = null;
    this.enter(c, CreepStateCode.DEAD, now);
    c.removeAt = now + c.def.corpseMs;
    this.host.emit({ e: 'creepDie', id: c.id, by });
    if (by >= 0) this.host.defeated(c, by, splitCreepXp(c.def.xp, this.credit(c, by, now), by, (i) => this.host.eligible(i)), now);
    c.contrib.clear();
    c.contribAt.clear();
  }

  /** The damage that earns XP at the defeat: the final blow's, and each helper's whose help is recent and close by. */
  private credit(c: CreepRuntime, by: number, now: number): Map<number, number> {
    const R = CREEP_RULES;
    const near = new Map<number, Vec3>();
    for (const p of this.host.players()) near.set(p.index, p.pos);
    const out = new Map<number, number>();
    for (const [i, d] of c.contrib) {
      if (i !== by) {
        if (now - (c.contribAt.get(i) ?? -Infinity) > R.creditWindowMs) continue;
        const at = near.get(i);
        if (!at || dist(at, c.pos) > R.creditRange) continue;
      }
      out.set(i, d);
    }
    return out;
  }

  /** Gone without a fight (Tormenta, population trim): no XP. */
  private dissolve(c: CreepRuntime, now: number): void {
    c.health = 0;
    c.windup = null;
    c.target = -1;
    this.enter(c, CreepStateCode.DEAD, now);
    c.removeAt = now + 900;
    c.contrib.clear();
    c.contribAt.clear();
    this.host.emit({ e: 'creepDie', id: c.id, by: -1 });
  }

  // ------------------------------------------------------------------------------------------------ spawning

  private spawn(type: CreepTypeId, area: number, point: CreepPoint, now: number): CreepRuntime {
    const def = CREEPS[type];
    const facing = v3rotateAxis(northTangent(point.up), point.up, (this.nextId * 2.39996) % (Math.PI * 2));
    const c: CreepRuntime = {
      id: this.nextId++,
      type,
      def,
      area,
      pos: { ...point.pos },
      facing,
      home: { ...point.pos },
      state: CreepStateCode.IDLE,
      since: now,
      health: def.health,
      target: -1,
      goal: null,
      idleFor: 600 + (this.nextId % 5) * 400,
      attackIndex: 0,
      windup: null,
      recoverUntil: 0,
      nextAttackAt: 0,
      retreatUntil: 0,
      thinkAt: now + (this.nextId % 5) * 40,
      lostSince: 0,
      stuckSince: 0,
      side: this.nextId % 2 ? 1 : -1,
      contrib: new Map(),
      contribAt: new Map(),
      removeAt: 0,
      stormSince: 0,
    };
    this.creeps.set(c.id, c);
    this.host.emit({ e: 'creepSpawn', id: c.id, ty: CREEP_TYPE_IDS.indexOf(type), at: [Math.round(c.pos.x * POS_SCALE), Math.round(c.pos.y * POS_SCALE), Math.round(c.pos.z * POS_SCALE)] });
    return c;
  }

  /** Population cap now (the Tormenta shrinks it). */
  cap(): number {
    const f = this.host.capFactor ? Math.max(CREEP_RULES.minFactor, Math.min(1, this.host.capFactor())) : 1;
    return Math.ceil(this.maxActive * f);
  }

  private respawns(now: number, players: CreepPlayer[]): void {
    for (const p of this.director.due(now)) {
      const area = this.director.areas[p.area]!;
      const living = [...this.creeps.values()].filter((c) => c.state !== CreepStateCode.DEAD);
      if (living.length >= this.cap() || living.filter((c) => c.area === p.area).length >= area.def.max) {
        // Full right now (the Tormenta shrank the cap): later, maybe.
        this.director.retry(p, now);
        continue;
      }
      const type = this.director.pickType(area, living);
      const point = type ? this.director.pickPoint(area, players, living, this.host.spawnable) : null;
      if (type && point) {
        this.spawn(type, p.area, point, now);
        continue;
      }
      // Its own place cannot take it now (the Tormenta took it, players stand on every point): another area with room
      // inside the safe region gets it instead; else it waits and tries again.
      let moved = false;
      const others = this.director.areas.filter((a) => a.index !== p.area && a.points.length > 0);
      const start = Math.floor(now / 1000) % Math.max(1, others.length);
      for (let k = 0; k < others.length && !moved; k++) {
        const o = others[(start + k) % others.length]!;
        if (living.filter((c) => c.area === o.index).length >= Math.min(o.def.max, o.points.length)) continue;
        const ot = this.director.pickType(o, living);
        const op = ot ? this.director.pickPoint(o, players, living, this.host.spawnable) : null;
        if (ot && op) {
          this.spawn(ot, o.index, op, now);
          moved = true;
        }
      }
      if (!moved) this.director.retry(p, now);
    }
  }

  // ------------------------------------------------------------------------------------------------ simulation

  /** Advances every creep (`now` server ms, `dt` s). */
  update(now: number, dt: number): void {
    if (!this.running) return;
    const players = [...this.host.players()].filter((p) => p.alive);
    const hostile = this.host.hostile(now);
    for (const c of [...this.creeps.values()]) {
      if (c.state === CreepStateCode.DEAD) {
        if (now >= c.removeAt) {
          this.creeps.delete(c.id);
          this.director.schedule(c.area, c.def, now);
        }
        continue;
      }
      // The Tormenta took this place: a creep caught in it dissolves after a grace period.
      if (this.host.inStorm?.(c.pos)) {
        c.stormSince ||= now;
        if (now - c.stormSince > CREEP_RULES.tormentaGraceMs) {
          this.dissolve(c, now);
          continue;
        }
      } else c.stormSince = 0;
      const awake = c.state !== CreepStateCode.IDLE && c.state !== CreepStateCode.PATROL ? true : players.some((p) => dist(p.pos, c.pos) < CREEP_RULES.awakeRange);
      if (!awake) continue;
      if (now >= c.thinkAt) {
        c.thinkAt = now + 1000 / CREEP_RULES.thinkHz;
        this.think(c, players, hostile, now);
      }
      this.act(c, players, hostile, now, dt);
    }
    this.trim(now, players);
    this.respawns(now, players);
  }

  /** Too many creeps for the region left: the calmest one far from everybody dissolves (one per second). */
  private trim(now: number, players: CreepPlayer[]): void {
    if (now < this.trimAt) return;
    this.trimAt = now + 1000;
    const living = [...this.creeps.values()].filter((c) => c.state !== CreepStateCode.DEAD);
    if (living.length <= this.cap()) return;
    const calm = living.filter((c) => c.state === CreepStateCode.IDLE || c.state === CreepStateCode.PATROL);
    if (!calm.length) return;
    const far = (c: CreepRuntime) => Math.min(Infinity, ...players.map((p) => dist(p.pos, c.pos)));
    calm.sort((a, b) => far(b) - far(a));
    this.dissolve(calm[0]!, now);
  }

  private player(players: CreepPlayer[], index: number): CreepPlayer | undefined {
    return players.find((p) => p.index === index);
  }

  /** Clear line from this creep's chest to a player's chest. */
  private sees(c: CreepRuntime, p: CreepPlayer): boolean {
    const from = add(c.pos, unit(c.pos), Math.min(1.1, c.def.hitbox.top * 0.7));
    const to = add(p.pos, unit(p.pos), 1.1);
    const d = sub(to, from);
    const l = len(d);
    return l < 0.3 || !this.host.physics.castRay(from, { x: d.x / l, y: d.y / l, z: d.z / l }, l - 0.1, CREEP_SIGHT_QUERY);
  }

  private enter(c: CreepRuntime, s: CreepStateCode, now: number): void {
    c.state = s;
    c.since = now;
    c.stuckSince = 0;
    if (s === CreepStateCode.RETURN) {
      c.target = -1;
      c.windup = null;
      c.contrib.clear();
      c.goal = { ...c.home };
      c.contribAt.clear();
    }
    if (s === CreepStateCode.IDLE) {
      c.goal = null;
      const [lo, hi] = CREEP_RULES.idleMs;
      c.idleFor = lo + ((c.id * 7919 + now) % 1000) / 1000 * (hi - lo);
    }
  }

  /** Perception and decisions (a few times a second). */
  private think(c: CreepRuntime, players: CreepPlayer[], hostile: boolean, now: number): void {
    const def = c.def;
    if (!hostile) {
      if (c.state === CreepStateCode.ALERT || c.state === CreepStateCode.CHASE || c.state === CreepStateCode.ATTACK) this.enter(c, CreepStateCode.RETURN, now);
      return;
    }
    if (c.state === CreepStateCode.IDLE || c.state === CreepStateCode.PATROL) {
      if (!def.aggressive) return;
      let best: CreepPlayer | undefined;
      let bestD = def.detectRange;
      for (const p of players) {
        const d = dist(p.pos, c.pos);
        if (d < bestD && dist(p.pos, c.home) < def.leashRange && this.sees(c, p)) {
          bestD = d;
          best = p;
        }
      }
      if (best) {
        c.target = best.index;
        this.enter(c, CreepStateCode.ALERT, now);
      }
      return;
    }
    if (c.state === CreepStateCode.CHASE || c.state === CreepStateCode.ALERT) {
      const t = this.player(players, c.target);
      if (!t) {
        this.enter(c, CreepStateCode.RETURN, now);
        return;
      }
      if (dist(c.pos, c.home) > def.leashRange || dist(t.pos, c.home) > def.leashRange + 6) {
        this.enter(c, CreepStateCode.RETURN, now);
        return;
      }
      const far = dist(t.pos, c.pos) > def.loseRange || !this.sees(c, t);
      if (far) {
        c.lostSince ||= now;
        if (now - c.lostSince > 3000) this.enter(c, CreepStateCode.RETURN, now);
      } else c.lostSince = 0;
    }
  }

  /** Movement and attacks (every tick). */
  private act(c: CreepRuntime, players: CreepPlayer[], hostile: boolean, now: number, dt: number): void {
    const def = c.def;
    switch (c.state) {
      case CreepStateCode.IDLE:
        if (now - c.since >= c.idleFor) {
          c.goal = this.patrolGoal(c, now);
          this.enter(c, CreepStateCode.PATROL, now);
        }
        break;
      case CreepStateCode.PATROL: {
        if (!c.goal || dist(c.pos, c.goal) < 0.6) {
          this.enter(c, CreepStateCode.IDLE, now);
          break;
        }
        if (!this.move(c, c.goal, def.walkSpeed, dt, players, 0)) {
          c.stuckSince ||= now;
          if (now - c.stuckSince > 1500) this.enter(c, CreepStateCode.IDLE, now);
        } else c.stuckSince = 0;
        break;
      }
      case CreepStateCode.ALERT: {
        const t = this.player(players, c.target);
        if (t) this.face(c, t.pos, def.turnRate * 1.5, dt);
        if (now - c.since >= def.alertMs) this.enter(c, t ? CreepStateCode.CHASE : CreepStateCode.RETURN, now);
        break;
      }
      case CreepStateCode.CHASE: {
        const t = this.player(players, c.target);
        if (!t) {
          this.enter(c, CreepStateCode.RETURN, now);
          break;
        }
        if (now < c.retreatUntil) {
          // Agile creeps back off between blows.
          const away = tangentToward(t.pos, c.pos);
          if (away) this.move(c, add(c.pos, away, 2), def.runSpeed * 0.8, dt, players, 0, false);
          this.face(c, t.pos, def.turnRate, dt);
          break;
        }
        const atk = def.attacks[c.attackIndex % def.attacks.length]!;
        const reach = this.reachTo(c, t);
        if (reach <= atk.range * (atk.area ? 0.7 : 0.9) && now >= c.nextAttackAt && this.sees(c, t)) {
          this.face(c, t.pos, def.turnRate * 2, dt);
          c.windup = { k: c.attackIndex % def.attacks.length, until: now + atk.windupMs, target: t.index };
          this.enter(c, CreepStateCode.ATTACK, now);
          this.host.emit({ e: 'creepAtk', id: c.id, k: c.windup.k, ph: 0, t: atk.area ? -1 : t.index, until: c.windup.until });
          break;
        }
        // Close in, stopping just inside the reach.
        if (reach > atk.range * 0.75) {
          if (!this.move(c, t.pos, def.runSpeed, dt, players, atk.range * 0.7)) {
            c.stuckSince ||= now;
            if (now - c.stuckSince > CREEP_RULES.stuckMs) this.enter(c, CreepStateCode.RETURN, now);
          } else c.stuckSince = 0;
        } else this.face(c, t.pos, def.turnRate, dt);
        break;
      }
      case CreepStateCode.ATTACK: {
        const w = c.windup;
        if (w) {
          const t = this.player(players, w.target);
          if (t) this.face(c, t.pos, def.turnRate * 0.5, dt);
          if (now >= w.until) this.strike(c, players, hostile, now);
        } else if (now >= c.recoverUntil) {
          if (def.retreat) c.retreatUntil = now + def.retreat.ms;
          this.enter(c, c.target >= 0 && this.player(players, c.target) ? CreepStateCode.CHASE : CreepStateCode.RETURN, now);
        }
        break;
      }
      case CreepStateCode.RETURN: {
        c.health = Math.min(def.health, c.health + def.health * CREEP_RULES.returnHealPerSecond * dt);
        if (dist(c.pos, c.home) < 1) {
          c.health = def.health;
          this.enter(c, CreepStateCode.IDLE, now);
          break;
        }
        if (!this.move(c, c.home, def.runSpeed, dt, players, 0)) {
          c.stuckSince ||= now;
          // Truly stuck on the way home: it is put back (out of sight it does not matter how).
          if (now - c.stuckSince > 6000) {
            c.pos = { ...c.home };
            c.health = def.health;
            this.enter(c, CreepStateCode.IDLE, now);
          }
        } else c.stuckSince = 0;
        break;
      }
    }
  }

  /** The blow of the attack that wound up: resolved now against where the players are now. */
  private strike(c: CreepRuntime, players: CreepPlayer[], hostile: boolean, now: number): void {
    const w = c.windup!;
    const atk = c.def.attacks[w.k]!;
    c.windup = null;
    c.recoverUntil = now + atk.recoverMs;
    c.nextAttackAt = now + atk.cooldownMs;
    c.attackIndex = (w.k + 1) % c.def.attacks.length;
    this.host.emit({ e: 'creepAtk', id: c.id, k: w.k, ph: 1, t: atk.area ? -1 : w.target, until: now });
    if (!hostile) return;
    const up = unit(c.pos);
    const cosArc = Math.cos(((atk.arcDeg / 2) * Math.PI) / 180);
    for (const p of players) {
      if (!atk.area && p.index !== w.target) continue;
      // A little slack on the reach: the blow was telegraphed, so stepping out of it is the counterplay.
      if (this.reachTo(c, p) > atk.range + 0.3) continue;
      if (!atk.area) {
        const d = tangentToward(c.pos, p.pos);
        if (d && v3dot(d, c.facing) < cosArc && dist(c.pos, p.pos) > c.def.radius + 0.4) continue;
      }
      if (!this.sees(c, p)) continue;
      // The slam reaches along the ground: not someone standing on a roof above.
      if (atk.area && Math.abs(v3dot(sub(p.pos, c.pos), up)) > 1.4) continue;
      this.host.hurt(c, p.index, atk.damage, now);
    }
  }

  /** Distance from the creep's body surface to a player's body surface (along the ground, both capsules upright). */
  private reachTo(c: CreepRuntime, p: CreepPlayer): number {
    return Math.max(0, dist(c.pos, p.pos) - c.def.radius - 0.32);
  }

  private patrolGoal(c: CreepRuntime, now: number): Vec3 | null {
    const area = this.director.areas[c.area]!;
    const rand = mulberry32((c.id * 2654435761) ^ now);
    const [lo, hi] = CREEP_RULES.patrolLeg;
    // Mostly a valid point of its area (known good ground), sometimes a short wander from where it stands.
    if (area.points.length && rand() < 0.55) return area.points[Math.floor(rand() * area.points.length)]!.pos;
    const up = unit(c.pos);
    const d = v3rotateAxis(c.facing, up, (rand() - 0.5) * Math.PI * 1.6);
    const goal = add(c.pos, d, lo + rand() * (hi - lo));
    // Never far from home.
    if (dist(goal, c.home) > Math.max(4, area.def.radiusDeg * DEG * PLANET.radius)) return { ...c.home };
    return goal;
  }

  /** Turns the facing toward a point at `rate` rad/s. */
  private face(c: CreepRuntime, to: Vec3, rate: number, dt: number): void {
    const want = tangentToward(c.pos, to);
    if (!want) return;
    this.turn(c, want, rate, dt);
  }

  private turn(c: CreepRuntime, want: Vec3, rate: number, dt: number): void {
    const up = unit(c.pos);
    const f = v3normalize(v3projectOnPlane(c.facing, up));
    const ang = v3angle(f, want);
    const maxA = rate * dt;
    if (ang <= maxA || ang < 1e-3) {
      c.facing = { ...want };
      return;
    }
    const sign = v3dot(v3cross(f, want), up) >= 0 ? 1 : -1;
    c.facing = v3normalize(v3rotateAxis(f, up, sign * maxA));
  }

  /**
   * Walks toward `to` at `speed` (stopping `stopAt` m short), steering around what blocks the way and keeping clear
   * of other creeps. Returns false when every direction tried was blocked.
   */
  private move(c: CreepRuntime, to: Vec3, speed: number, dt: number, players: CreepPlayer[], stopAt: number, turnToMove = true): boolean {
    const d0 = dist(c.pos, to);
    if (d0 <= stopAt + 0.05) return true;
    const want = tangentToward(c.pos, to);
    if (!want) return true;
    const up = unit(c.pos);
    // Keep apart from other creeps and from players' bodies.
    let push = { x: 0, y: 0, z: 0 };
    for (const o of this.creeps.values()) {
      if (o === c || o.state === CreepStateCode.DEAD) continue;
      const dd = dist(o.pos, c.pos);
      const min = o.def.radius + c.def.radius + 0.2;
      if (dd < min && dd > 1e-3) push = add(push, sub(c.pos, o.pos), (min - dd) / dd);
    }
    for (const p of players) {
      const dd = dist(p.pos, c.pos);
      const min = c.def.radius + 0.35;
      if (dd < min && dd > 1e-3) push = add(push, sub(c.pos, p.pos), (min - dd) / dd);
    }
    const dir0 = v3normalize(v3projectOnPlane(add(want, push, 1.5), up));
    const step = Math.min(speed * dt, Math.max(0, d0 - stopAt));
    const tries = [0, 35, -35, 70, -70, 110, -110];
    for (const a of tries) {
      const d = a === 0 ? dir0 : v3rotateAxis(dir0, up, a * DEG * c.side);
      const r = walkStep(this.host.physics, c.pos, d, step, c.def.radius);
      if (!r.ok) continue;
      c.pos = r.pos;
      if (turnToMove) this.turn(c, v3normalize(v3projectOnPlane(d, unit(c.pos))), c.def.turnRate, dt);
      else c.facing = v3normalize(v3projectOnPlane(c.facing, unit(c.pos)));
      if (a !== 0 && Math.abs(a) >= 70) c.side = -c.side;
      return true;
    }
    c.side = -c.side;
    c.facing = v3normalize(v3projectOnPlane(c.facing, up));
    return false;
  }
}

/** Creep id from a hit-target index, or -1 when the index is a player's. */
export const creepIdOf = (target: number): number => (target >= CREEP_TARGET_BASE ? target - CREEP_TARGET_BASE : -1);
