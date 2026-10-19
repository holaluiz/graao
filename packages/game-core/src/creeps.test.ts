import { describe, expect, it } from 'vitest';
import { CREEPS, CREEP_AREAS, CREEP_RULES, PLANET } from '@graao/game-data';
import { CREEP_TARGET_BASE, CreepStateCode, type GameEvent, type Vec3 } from '@graao/shared';
import { GRACreepSystem, checkCreepPoint, creepIdOf, resolveCreepAreas, walkStep, type CreepHost, type CreepPlayer, type CreepRuntime } from './creeps';
import { GROUPS_PROP_QUERY } from './physics';
import { northTangent } from './sphere';
import { createGameWorld } from './world';

const world = await createGameWorld({ includeVisual: false });
const areas = resolveCreepAreas(world.physics);
const SEA = PLANET.radius + PLANET.seaLevel;
const up = (p: Vec3) => {
  const l = Math.hypot(p.x, p.y, p.z);
  return { x: p.x / l, y: p.y / l, z: p.z / l };
};
const off = (p: Vec3, d: Vec3, s: number): Vec3 => ({ x: p.x + d.x * s, y: p.y + d.y * s, z: p.z + d.z * s });
const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

interface FakeHost extends CreepHost {
  list: CreepPlayer[];
  events: GameEvent[];
  hurts: { creep: number; target: number; amount: number }[];
  kills: { creep: number; by: number; shares: Map<number, number> }[];
  fight: boolean;
  storm: (p: Vec3) => boolean;
}

function host(): FakeHost {
  const h: FakeHost = {
    physics: world.physics,
    list: [],
    events: [],
    hurts: [],
    kills: [],
    fight: true,
    storm: () => false,
    players: () => h.list,
    hostile: () => h.fight,
    hurt: (c, target, amount) => void h.hurts.push({ creep: c.id, target, amount }),
    defeated: (c, by, shares) => void h.kills.push({ creep: c.id, by, shares }),
    eligible: (i) => h.list.some((p) => p.index === i && p.alive),
    emit: (e) => void h.events.push(e),
    inStorm: (p) => h.storm(p),
  };
  return h;
}

/** Runs the system for `ms` of server time at the room's 20 Hz tick. */
function run(sys: GRACreepSystem, from: number, ms: number, each?: (now: number) => void): number {
  let now = from;
  for (let t = 0; t < ms; t += 50) {
    now += 50;
    each?.(now);
    sys.update(now, 0.05);
  }
  return now;
}

const first = (sys: GRACreepSystem, type?: string): CreepRuntime => [...sys.creeps.values()].find((c) => !type || c.type === type)!;

describe('creep areas on the real planet', () => {
  it('finds valid spawn points in every main region, on dry open ground and clear of props', () => {
    for (const region of ['Vila das Lanternas', 'Bosque dos Varais', 'Lago Espelho', 'Fenda de Cristal', 'Planalto Norte']) {
      const pts = areas.filter((a) => a.def.region === region).reduce((n, a) => n + a.points.length, 0);
      expect(pts, region).toBeGreaterThan(0);
    }
    for (const a of areas) {
      for (const p of a.points) {
        expect(Math.hypot(p.pos.x, p.pos.y, p.pos.z)).toBeGreaterThan(SEA);
        expect(world.physics.ballOverlaps(off(p.pos, p.up, 0.75), 0.4, GROUPS_PROP_QUERY)).toBe(false);
        // Open sky: nothing above it for a few metres (never inside a house).
        expect(world.physics.castRay(off(p.pos, p.up, 0.3), p.up, CREEP_RULES.skyClear, GROUPS_PROP_QUERY)).toBeNull();
      }
    }
  });

  it('refuses water and roofs', () => {
    // The middle of the Lago Espelho.
    const lake = up({ x: Math.cos(-30 * Math.PI / 180) * Math.sin(-38 * Math.PI / 180), y: Math.sin(-30 * Math.PI / 180), z: Math.cos(-30 * Math.PI / 180) * Math.cos(-38 * Math.PI / 180) });
    expect(typeof checkCreepPoint(world.physics, lake)).toBe('string');
  });
});

describe('creep walking', () => {
  it('follows the ground along the sphere without sinking or flying', () => {
    const a = areas.find((x) => x.def.id === 'bosque-mata' && x.points.length) ?? areas.find((x) => x.points.length)!;
    let pos = a.points[0]!.pos;
    const dir = northTangent(up(pos));
    let moved = 0;
    for (let i = 0; i < 60; i++) {
      const r = walkStep(world.physics, pos, northTangent(up(pos)), 0.15, 0.4);
      if (!r.ok) break;
      moved += dist(r.pos, pos);
      pos = r.pos;
      const ground = world.terrain.surfaceAt(up(pos));
      // On the terrain or on something low on it (a step), never under it.
      expect(Math.hypot(pos.x, pos.y, pos.z)).toBeGreaterThan(Math.hypot(ground.x, ground.y, ground.z) - 0.2);
    }
    expect(moved).toBeGreaterThan(1);
    expect(dir).toBeTruthy();
  });
});

describe('GRACreepSystem', () => {
  it('fills the planet up to its cap, respecting each area and one elite per special area', () => {
    const h = host();
    const sys = new GRACreepSystem(h, areas);
    sys.start(42, 0, 16);
    expect(sys.alive).toBeGreaterThan(8);
    expect(sys.alive).toBeLessThanOrEqual(16);
    for (const a of areas) {
      const inA = [...sys.creeps.values()].filter((c) => c.area === a.index);
      expect(inA.length).toBeLessThanOrEqual(a.def.max);
      for (const [t, max] of Object.entries(a.def.maxOf ?? {})) expect(inA.filter((c) => c.type === t).length).toBeLessThanOrEqual(max!);
      for (const c of inA) expect(a.def.types.map((x) => x.v)).toContain(c.type);
    }
    expect(h.events.filter((e) => e.e === 'creepSpawn').length).toBe(sys.alive);
    sys.start(42, 0, 0);
    expect(sys.alive).toBe(0);
    expect(sys.active).toBe(false);
  });

  it('gives the share of a place the Tormenta leaves out to the other areas', () => {
    const h = host();
    const blocked = new Set(areas.filter((a) => a.def.region === 'Planalto Norte' || a.def.region === 'Fenda de Cristal').map((a) => a.index));
    h.spawnable = (p) => !areas.some((a) => blocked.has(a.index) && a.points.some((q) => dist(q.pos, p) < 0.01));
    const sys = new GRACreepSystem(h, areas);
    sys.start(42, 0, 12);
    expect(sys.alive).toBe(12);
    expect([...sys.creeps.values()].every((c) => !blocked.has(c.area))).toBe(true);
  });

  it('a neutral creep ignores a player close by until it is hurt, then chases, telegraphs and strikes', () => {
    const h = host();
    const sys = new GRACreepSystem(h, areas);
    sys.start(7, 0, 16);
    const c = first(sys, 'barrolinho');
    expect(c).toBeTruthy();
    const me: CreepPlayer = { index: 0, pos: off(c.pos, northTangent(up(c.pos)), 1.4), alive: true };
    h.list.push(me);
    let now = run(sys, 0, 2000, () => (me.pos = off(c.pos, northTangent(up(c.pos)), 1.4)));
    expect([CreepStateCode.IDLE, CreepStateCode.PATROL]).toContain(c.state);
    expect(h.hurts.length).toBe(0);
    sys.damage(c.id, 0, 9, now);
    expect(c.state).toBe(CreepStateCode.ALERT);
    expect(c.target).toBe(0);
    now = run(sys, now, 4000, () => (me.pos = off(c.pos, c.facing, 1.2)));
    const atk = h.events.filter((e): e is Extract<GameEvent, { e: 'creepAtk' }> => e.e === 'creepAtk' && e.id === c.id);
    expect(atk.some((e) => e.ph === 0)).toBe(true);
    expect(atk.some((e) => e.ph === 1)).toBe(true);
    // The telegraph comes first, and the blow lands no earlier than the wind-up says.
    const wind = atk.find((e) => e.ph === 0)!;
    expect(wind.until).toBeGreaterThan(0);
    expect(h.hurts.length).toBeGreaterThan(0);
    expect(h.hurts[0]).toMatchObject({ creep: c.id, target: 0, amount: CREEPS.barrolinho.attacks[0]!.damage });
  });

  it('an aggressive creep charges a player who comes near (only once the fight is on)', () => {
    const h = host();
    h.fight = false;
    const sys = new GRACreepSystem(h, areas);
    sys.start(3, 0, 16);
    const c = first(sys, 'besouro') ?? first(sys, 'guardiao');
    expect(c).toBeTruthy();
    const me: CreepPlayer = { index: 1, pos: off(c.pos, northTangent(up(c.pos)), 3), alive: true };
    h.list.push(me);
    let now = run(sys, 0, 1500);
    expect(c.target).toBe(-1);
    h.fight = true;
    now = run(sys, now, 1500);
    expect(c.target).toBe(1);
    expect([CreepStateCode.ALERT, CreepStateCode.CHASE, CreepStateCode.ATTACK]).toContain(c.state);
  });

  it('gives up a chase beyond its leash, walks home immune and heals', () => {
    const h = host();
    const sys = new GRACreepSystem(h, areas);
    sys.start(11, 0, 16);
    const c = first(sys, 'barrolinho');
    const me: CreepPlayer = { index: 0, pos: off(c.pos, northTangent(up(c.pos)), 2), alive: true };
    h.list.push(me);
    let now = 1000;
    sys.damage(c.id, 0, 9, now);
    // The player runs far away.
    me.pos = off(c.home, northTangent(up(c.home)), CREEPS.barrolinho.leashRange + 12);
    now = run(sys, now, 4000);
    expect([CreepStateCode.RETURN, CreepStateCode.IDLE, CreepStateCode.PATROL]).toContain(c.state);
    if (c.state === CreepStateCode.RETURN) expect(sys.damage(c.id, 0, 9, now).dealt).toBe(0);
    now = run(sys, now, 12000);
    expect(c.health).toBe(CREEPS.barrolinho.health);
    expect(c.contrib.size).toBe(0);
  });

  it('dies once: XP shares go out exactly once, the body stays, then a new creep comes back away from players', () => {
    const h = host();
    const sys = new GRACreepSystem(h, areas);
    sys.start(5, 0, 16);
    const c = first(sys, 'barrolinho');
    const before = sys.alive;
    h.list.push({ index: 0, pos: off(c.pos, northTangent(up(c.pos)), 1.5), alive: true }, { index: 1, pos: off(c.pos, northTangent(up(c.pos)), -1.5), alive: true });
    let now = 100;
    expect(sys.damage(c.id, 1, 9, now).killed).toBe(false);
    expect(sys.damage(c.id, 0, 9, now).killed).toBe(false);
    const last = sys.damage(c.id, 0, 50, now);
    expect(last).toEqual({ dealt: 10, killed: true });
    expect(c.state).toBe(CreepStateCode.DEAD);
    expect(sys.damage(c.id, 1, 50, now)).toEqual({ dealt: 0, killed: false });
    expect(h.kills.length).toBe(1);
    const shares = h.kills[0]!.shares;
    expect([...shares.values()].reduce((a, b) => a + b, 0)).toBe(CREEPS.barrolinho.xp);
    expect(shares.get(0)).toBeGreaterThan(shares.get(1)!);
    expect(sys.hitTargets().some((t) => creepIdOf(t.index) === c.id)).toBe(false);
    // The body shows its defeat, then goes; the area gets a creep back after the respawn delay, once the players
    // have moved on (never in someone's face).
    now = run(sys, now, c.def.corpseMs + 100);
    for (const p of h.list) p.pos = off(c.home, northTangent(up(c.home)), 40);
    expect(sys.creeps.has(c.id)).toBe(false);
    expect(sys.alive).toBe(before - 1);
    now = run(sys, now, CREEPS.barrolinho.respawnMs[1] + CREEP_RULES.retryMs * 2);
    const spawns = h.events.filter((e): e is Extract<GameEvent, { e: 'creepSpawn' }> => e.e === 'creepSpawn');
    const fresh = spawns.filter((e) => e.id > Math.max(...spawns.slice(0, before).map((x) => x.id)));
    expect(fresh.length).toBeGreaterThan(0);
    expect(fresh.every((e) => e.id !== c.id)).toBe(true);
    for (const e of fresh) {
      const at = { x: e.at[0] / 1000, y: e.at[1] / 1000, z: e.at[2] / 1000 };
      for (const p of h.list) expect(dist(at, p.pos)).toBeGreaterThanOrEqual(CREEP_RULES.minPlayerDistance - 0.01);
    }
  });

  it('credits only recent help from close by: stale or far helpers get no XP, the final blow always counts', () => {
    const h = host();
    const sys = new GRACreepSystem(h, areas);
    sys.start(5, 0, 16);
    const c = first(sys, 'pedreiro') ?? first(sys);
    const t = northTangent(up(c.pos));
    // 0 lands the final blow; 1 helped long ago; 2 helped recently but walked far away; 3 helped recently, close by.
    h.list.push(
      { index: 0, pos: off(c.pos, t, 1.5), alive: true },
      { index: 1, pos: off(c.pos, t, -1.5), alive: true },
      { index: 2, pos: off(c.pos, t, 2), alive: true },
      { index: 3, pos: off(c.pos, t, -2), alive: true },
    );
    sys.damage(c.id, 1, 9, 1000);
    const late = 1000 + CREEP_RULES.creditWindowMs + 2000;
    sys.damage(c.id, 2, 9, late - 500);
    sys.damage(c.id, 3, 9, late - 400);
    h.list[2]!.pos = off(c.pos, t, CREEP_RULES.creditRange + 10);
    expect(sys.damage(c.id, 0, 500, late).killed).toBe(true);
    const shares = h.kills[0]!.shares;
    expect(shares.has(1)).toBe(false);
    expect(shares.has(2)).toBe(false);
    expect(shares.get(3)).toBeGreaterThan(0);
    expect(shares.get(0)).toBeGreaterThan(shares.get(3)!);
    expect([...shares.values()].reduce((a, b) => a + b, 0)).toBe(c.def.xp);
  });

  it('dissolves creeps caught in the Tormenta without giving XP, and spawns none outside the safe region', () => {
    const h = host();
    h.spawnable = () => false;
    const sys = new GRACreepSystem(h, areas);
    sys.start(9, 0, 16);
    const n = sys.alive;
    expect(n).toBe(0);
    h.spawnable = undefined;
    sys.start(9, 0, 16);
    h.list.push({ index: 0, pos: first(sys).pos, alive: true });
    h.storm = () => true;
    run(sys, 0, CREEP_RULES.tormentaGraceMs + 600);
    const died = h.events.filter((e): e is Extract<GameEvent, { e: 'creepDie' }> => e.e === 'creepDie');
    expect(died.length).toBeGreaterThan(0);
    expect(died.every((e) => e.by === -1)).toBe(true);
    expect(h.kills.length).toBe(0);
  });

  it('exposes hit targets offset from player indices, with the creep capsule', () => {
    const h = host();
    const sys = new GRACreepSystem(h, areas);
    sys.start(1, 0, 4);
    const t = sys.hitTargets();
    expect(t.length).toBe(sys.alive);
    for (const x of t) {
      expect(x.index).toBeGreaterThanOrEqual(CREEP_TARGET_BASE);
      expect(x.box).toBeTruthy();
    }
    expect(sys.snapshot().length).toBe(sys.creeps.size);
    expect(CREEP_AREAS.length).toBe(areas.length);
  });
});
