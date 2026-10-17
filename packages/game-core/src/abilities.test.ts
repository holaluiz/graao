import { describe, expect, it } from 'vitest';
import { ABILITIES, ABILITY_IDS, ABILITY_RULES, ATTRIBUTES, DEFAULT_LOADOUTS, ULTIMATE_SLOT, type AbilityId, type Loadout } from '@graao/game-data';
import { AbilityReject, HitKind, v3normalize, v3sub, type GameEvent, type Vec3 } from '@graao/shared';
import {
  applyAbilityDamage,
  applyHeal,
  applyKnockback,
  applyShield,
  applySlow,
  areaVictims,
  castOrigin,
  checkCast,
  chestOf,
  lobDirection,
  currentSlow,
  manaShown,
  regenMana,
  resetCooldowns,
  spendCast,
  stepProjectile,
  validateLoadout,
  validateTargetPoint,
  type CastState,
  type ProjectileBody,
  type RayCaster,
} from './abilities';
import { GRAAbilitySystem, type AbilityActor, type AbilityHost } from './abilitySystem';
import { createCharacterState } from './character';
import { newVitals, raySphere } from './combat';

// ------------------------------------------------------------------------------------------------ fake world

/** Analytic world: the planet as a sphere of radius 100 plus optional spherical obstacles ("walls"). */
function fakeWorld(obstacles: { c: Vec3; r: number }[] = []): RayCaster {
  const spheres = [{ c: { x: 0, y: 0, z: 0 }, r: 100 }, ...obstacles];
  return {
    castRay(o, d, max) {
      let best = Infinity;
      for (const s of spheres) {
        const t = raySphere(o, d, s.c, s.r);
        if (t >= 0 && t <= max && t < best) best = t;
      }
      return best < Infinity ? { toi: best, handle: 1 } : null;
    },
  };
}

/** Feet on the planet `meters` along the surface from (0, 0, 100) toward +x. */
const ground = (meters: number, side = 0): Vec3 => {
  const a = meters / 100;
  const b = side / 100;
  return { x: Math.sin(a) * Math.cos(b) * 100, y: Math.sin(b) * 100, z: Math.cos(a) * Math.cos(b) * 100 };
};

function actor(index: number, feet: Vec3, loadout: Loadout = DEFAULT_LOADOUTS[0]!): AbilityActor {
  return {
    index,
    state: createCharacterState(feet, { x: 1, y: 0, z: 0 }),
    vitals: newVitals(),
    loadout: [...loadout] as Loadout,
    cooldownEnds: [0, 0, 0, 0],
    castUntil: 0,
    slowUntil: 0,
    slowFactor: 1,
  };
}

function harness(actors: AbilityActor[], world = fakeWorld()) {
  const events: GameEvent[] = [];
  const dashes: { index: number; dir: Vec3; distance: number; cmdSeq: number }[] = [];
  const state = { fight: true };
  const host: AbilityHost = {
    physics: world,
    actors: () => actors,
    canFight: () => state.fight,
    damage: (by, target, amount, ability) => {
      const r = applyAbilityDamage(target.vitals, amount);
      events.push({ e: 'dmg', by: by.index, target: target.index, amount: r.shieldDamage + r.healthDamage, kinds: r.kinds, health: target.vitals.health, shield: target.vitals.shield, a: ability });
    },
    dash: (a, dir, distance, _duration, cmdSeq) => dashes.push({ index: a.index, dir, distance, cmdSeq }),
    emit: (e) => events.push(e),
  };
  const sys = new GRAAbilitySystem(host);
  /** Runs the system at the server's 20 Hz for `ms`. */
  const run = (from: number, ms: number) => {
    let t = from;
    for (; t < from + ms; t += 50) sys.update(t, 0.05);
    return t;
  };
  return { sys, events, dashes, state, run };
}

const dirTo = (from: Vec3, to: Vec3) => v3normalize(v3sub(to, from));
const slotOf = (l: readonly string[], id: AbilityId) => l.indexOf(id);

// ------------------------------------------------------------------------------------------------ rules

describe('mana', () => {
  it('regenerates while alive, capped at the maximum, and shows the floor', () => {
    const v = newVitals();
    v.mana = 10;
    regenMana(v, 1);
    expect(v.mana).toBeCloseTo(10 + ABILITY_RULES.manaRegen, 6);
    regenMana(v, 100);
    expect(v.mana).toBe(ATTRIBUTES.maxMana);
    v.mana = 39.99;
    expect(manaShown(v)).toBe(39);
    v.alive = false;
    v.mana = 0;
    regenMana(v, 5);
    expect(v.mana).toBe(0);
  });
});

describe('loadouts', () => {
  it('accepts the defaults and rejects duplicates, wrong slots, unknown ids and wrong sizes', () => {
    for (const l of DEFAULT_LOADOUTS) expect(validateLoadout(l)).toEqual(l);
    expect(validateLoadout(['sun_orb', 'sun_orb', 'pollen_burst', 'sun_meteor'])).toBeNull();
    expect(validateLoadout(['sun_meteor', 'wind_step', 'pollen_burst', 'sun_orb'])).toBeNull();
    expect(validateLoadout(['sun_orb', 'wind_step', 'pollen_burst', 'nope'])).toBeNull();
    expect(validateLoadout(['sun_orb', 'wind_step', 'pollen_burst'])).toBeNull();
    expect(validateLoadout('sun_orb')).toBeNull();
  });

  it('has an original MVP set: projectile, dash, area, defensive and big Ultimates with marks', () => {
    const effectKinds = (id: AbilityId) => JSON.stringify(ABILITIES[id].effects);
    expect(ABILITY_IDS.filter((id) => ABILITIES[id].slotType === 'basic').length).toBeGreaterThanOrEqual(8);
    expect(ABILITY_IDS.filter((id) => ABILITIES[id].slotType === 'ultimate').length).toBeGreaterThanOrEqual(3);
    expect(ABILITY_IDS.some((id) => effectKinds(id).includes('"projectile"'))).toBe(true);
    expect(ABILITY_IDS.some((id) => effectKinds(id).includes('"dash"'))).toBe(true);
    expect(ABILITY_IDS.some((id) => effectKinds(id).includes('"area"'))).toBe(true);
    expect(ABILITY_IDS.some((id) => ABILITIES[id].tags.includes('defensive'))).toBe(true);
    for (const id of ABILITY_IDS) {
      const d = ABILITIES[id];
      if (d.slotType === 'ultimate') {
        expect(d.presentation.mark, id).toBeTruthy();
        // Counterplay: an Ultimate warns for 0.5–1.5 s (wind-up plus ground delay) or is a visible projectile.
        expect(d.presentation.telegraph, id).toBeTruthy();
      }
      expect(d.name.length, id).toBeGreaterThan(3);
    }
  });
});

describe('cast validation', () => {
  const base = (): CastState => ({ alive: true, canFight: true, mana: 100, loadout: DEFAULT_LOADOUTS[0]!, cooldownEnds: [0, 0, 0, 0], castUntil: 0 });

  it('checks alive → owned → phase → busy → cooldown → mana, in that order', () => {
    const now = 10_000;
    expect(checkCast(base(), 0, 'sun_orb', now)).toBe(AbilityReject.OK);
    expect(checkCast({ ...base(), alive: false }, 0, 'sun_orb', now)).toBe(AbilityReject.DEAD);
    expect(checkCast(base(), 0, 'leaf_shell', now)).toBe(AbilityReject.NOT_OWNED);
    expect(checkCast(base(), 1, 'sun_orb', now)).toBe(AbilityReject.NOT_OWNED);
    expect(checkCast(base(), 7, 'sun_orb', now)).toBe(AbilityReject.NOT_OWNED);
    expect(checkCast({ ...base(), canFight: false }, 0, 'sun_orb', now)).toBe(AbilityReject.PHASE);
    expect(checkCast({ ...base(), castUntil: now + 100 }, 0, 'sun_orb', now)).toBe(AbilityReject.BUSY);
    expect(checkCast({ ...base(), cooldownEnds: [now + 1, 0, 0, 0] }, 0, 'sun_orb', now)).toBe(AbilityReject.COOLDOWN);
    expect(checkCast({ ...base(), cooldownEnds: [now, 0, 0, 0] }, 0, 'sun_orb', now)).toBe(AbilityReject.OK);
    expect(checkCast({ ...base(), mana: ABILITIES.sun_orb.manaCost - 0.5 }, 0, 'sun_orb', now)).toBe(AbilityReject.NO_MANA);
    expect(checkCast({ ...base(), mana: ABILITIES.sun_orb.manaCost }, 0, 'sun_orb', now)).toBe(AbilityReject.OK);
  });

  it('spending a cast takes Mana, starts the cooldown and the wind-up; respawn charges the Ultimate', () => {
    const c = { vitals: newVitals(), cooldownEnds: [0, 0, 0, 0], castUntil: 0 };
    const until = spendCast(c, 2, ABILITIES.pollen_burst, 1000);
    expect(c.vitals.mana).toBe(100 - ABILITIES.pollen_burst.manaCost);
    expect(c.cooldownEnds[2]).toBe(1000 + ABILITIES.pollen_burst.cooldown * 1000);
    expect(until).toBe(1000 + ABILITIES.pollen_burst.castTime * 1000);
    resetCooldowns(c.cooldownEnds, 5000);
    expect(c.cooldownEnds.slice(0, 3)).toEqual([0, 0, 0]);
    expect(c.cooldownEnds[ULTIMATE_SLOT]).toBe(5000 + ABILITY_RULES.ultimateInitialCharge * 1000);
  });

  it('validates point targets: range, surface and line of sight', () => {
    const feet = ground(0);
    expect(validateTargetPoint(fakeWorld(), feet, ground(10), 22)).toBe(AbilityReject.OK);
    expect(validateTargetPoint(fakeWorld(), feet, ground(30), 22)).toBe(AbilityReject.OUT_OF_RANGE);
    // Floating 6 m in the air: no surface under it.
    const air = ground(10);
    const up = v3normalize(air);
    expect(validateTargetPoint(fakeWorld(), feet, { x: air.x + up.x * 6, y: air.y + up.y * 6, z: air.z + up.z * 6 }, 22)).toBe(AbilityReject.BAD_TARGET);
    // A boulder between the caster and the point.
    const mid = ground(5);
    const wall = { c: { x: mid.x + v3normalize(mid).x * 1.2, y: mid.y + v3normalize(mid).y * 1.2, z: mid.z + v3normalize(mid).z * 1.2 }, r: 1.3 };
    expect(validateTargetPoint(fakeWorld([wall]), feet, ground(10), 22)).toBe(AbilityReject.BLOCKED);
  });
});

// ------------------------------------------------------------------------------------------------ primitives

describe('effect primitives', () => {
  it('Damage: shield first, tagged ABILITY (before ELIMINATION)', () => {
    const v = newVitals();
    expect(applyAbilityDamage(v, 30).kinds).toEqual([HitKind.SHIELD, HitKind.ABILITY]);
    v.shield = 0;
    v.health = 10;
    const r = applyAbilityDamage(v, 30);
    expect(r.kinds).toEqual([HitKind.BODY, HitKind.ABILITY, HitKind.ELIMINATION]);
    expect(r.eliminated).toBe(true);
  });

  it('Shield and Heal restore up to the maximum and never revive', () => {
    const v = newVitals();
    v.shield = 70;
    v.health = 80;
    expect(applyShield(v, 50)).toBe(30);
    expect(v.shield).toBe(ATTRIBUTES.maxShield);
    expect(applyHeal(v, 50)).toBe(20);
    expect(v.health).toBe(ATTRIBUTES.maxHealth);
    v.alive = false;
    v.health = 0;
    expect(applyHeal(v, 50)).toBe(0);
    expect(applyShield(v, 50)).toBe(0);
  });

  it('Slow: the stronger factor wins, a weaker one only extends the time', () => {
    const t = { slowUntil: 0, slowFactor: 1 };
    applySlow(t, 0.5, 1000, 0);
    expect(currentSlow(t, 500)).toBe(0.5);
    applySlow(t, 0.8, 3000, 500);
    expect(t.slowFactor).toBe(0.5);
    expect(t.slowUntil).toBe(3500);
    applySlow(t, 0.3, 200, 600);
    expect(t.slowFactor).toBe(0.3);
    expect(t.slowUntil).toBe(3500);
    expect(currentSlow(t, 3500)).toBe(1);
  });

  it('Knockback pushes away along the ground, lifts and ungrounds', () => {
    const s = createCharacterState(ground(3), { x: 1, y: 0, z: 0 });
    s.grounded = true;
    applyKnockback(s, ground(0), 10, 5);
    const up = v3normalize(s.pos);
    const vUp = s.vel.x * up.x + s.vel.y * up.y + s.vel.z * up.z;
    expect(vUp).toBeCloseTo(5, 5);
    // Away from the source: toward +x here.
    expect(s.vel.x).toBeGreaterThan(9);
    expect(s.grounded).toBe(false);
    // A direct hit pushes along the given direction.
    const t = createCharacterState(ground(3), { x: 1, y: 0, z: 0 });
    applyKnockback(t, null, 8, 0, { x: 0, y: 1, z: 0 });
    expect(t.vel.y).toBeCloseTo(8, 1);
  });

  it('Area: radius, falloff to the rim, walls protect, never the caster or the eliminated', () => {
    const center = ground(0);
    const players = [
      { index: 0, feet: ground(0), alive: true },
      { index: 1, feet: ground(1), alive: true },
      { index: 2, feet: ground(3.5), alive: true },
      { index: 3, feet: ground(6), alive: true },
      { index: 4, feet: ground(1, 1), alive: false },
    ];
    const hit = areaVictims(fakeWorld(), center, 3.8, 0.5, players, 0);
    expect(hit.map((h) => h.index)).toEqual([1, 2]);
    expect(hit[0]!.scale).toBeGreaterThan(hit[1]!.scale);
    expect(hit[1]!.scale).toBeGreaterThanOrEqual(0.5);
    // A boulder between the centre and player 2.
    const mid = ground(2.2);
    const u = v3normalize(mid);
    const wall = { c: { x: mid.x + u.x * 1, y: mid.y + u.y * 1, z: mid.z + u.z * 1 }, r: 0.6 };
    expect(areaVictims(fakeWorld([wall]), center, 3.8, 1, players, 0).map((h) => h.index)).toEqual([1]);
  });

  it('Projectile: flies straight, bends under radial gravity, hits players (inflated) and the world, expires', () => {
    const from = castOrigin(ground(0), { x: 1, y: 0, z: 0 });
    const straight: ProjectileBody = { pos: { ...from }, vel: { x: 40, y: 0, z: 0 }, gravity: 0, radius: 0.3, life: 1 };
    expect(stepProjectile(fakeWorld(), straight, 0.1, [], 0).kind).toBe('flying');
    expect(straight.pos.x).toBeCloseTo(from.x + 4, 6);

    // Radial gravity pulls an arc down into the ground.
    const arc: ProjectileBody = { pos: { ...from }, vel: { x: 12, y: 0, z: 0 }, gravity: 14, radius: 0.3, life: 5 };
    let r = stepProjectile(fakeWorld(), arc, 2, [], 0);
    expect(r.kind).toBe('world');
    if (r.kind === 'world') expect(Math.hypot(r.point.x, r.point.y, r.point.z)).toBeCloseTo(100, 1);

    // A player 8 m ahead, slightly off the line: the inflated radius still catches it; never the owner.
    const target = { index: 1, feet: ground(8, 0.45), alive: true };
    const owner = { index: 0, feet: ground(0), alive: true };
    const dir = dirTo(from, chestOf(ground(8)));
    const p: ProjectileBody = { pos: { ...from }, vel: { x: dir.x * 40, y: dir.y * 40, z: dir.z * 40 }, gravity: 0, radius: 0.35, life: 1 };
    r = stepProjectile(fakeWorld(), p, 0.5, [owner, target], 0);
    expect(r.kind).toBe('player');
    if (r.kind === 'player') expect(r.target).toBe(1);

    const miss: ProjectileBody = { pos: { ...from }, vel: { x: dir.x * 40, y: dir.y * 40, z: dir.z * 40 }, gravity: 0, radius: 0.05, life: 1 };
    const far = { index: 1, feet: ground(8, 1.2), alive: true };
    expect(stepProjectile(fakeWorld(), miss, 0.5, [owner, far], 0).kind).toBe('flying');
    expect(stepProjectile(fakeWorld(), miss, 0.6, [owner, far], 0).kind).toBe('expired');
  });
});

describe('aiming helpers', () => {
  it('lobs an arcing projectile so it lands on the aimed point', () => {
    const seed = ABILITIES.thorn_seed.effects[0]! as { speed: number; gravity: number };
    for (const meters of [6, 14, 24, 30]) {
      const from = castOrigin(ground(0), { x: 1, y: 0, z: 0 });
      const aim = ground(meters);
      const dir = lobDirection(from, aim, seed.speed, seed.gravity);
      const p: ProjectileBody = { pos: { ...from }, vel: { x: dir.x * seed.speed, y: dir.y * seed.speed, z: dir.z * seed.speed }, gravity: seed.gravity, radius: 0.3, life: 5 };
      const r = stepProjectile(fakeWorld(), p, 5, [], 0);
      expect(r.kind).toBe('world');
      if (r.kind === 'world') expect(Math.hypot(r.point.x - aim.x, r.point.y - aim.y, r.point.z - aim.z), `${meters} m`).toBeLessThan(0.5);
    }
  });
});

// ------------------------------------------------------------------------------------------------ the system

describe('GRAAbilitySystem (server execution with a fake host)', () => {
  it('a projectile ability travels, hits the target and reports cast → proj → projEnd → dmg', () => {
    const a = actor(0, ground(0));
    const b = actor(1, ground(10), DEFAULT_LOADOUTS[1]!);
    const h = harness([a, b]);
    const dir = dirTo(castOrigin(a.state.pos, { x: 1, y: 0, z: 0 }), chestOf(b.state.pos));
    expect(h.sys.request(a, { slot: 0, id: 'sun_orb', seq: 1, cmdSeq: 0, dir }, 1000)).toBe(AbilityReject.OK);
    expect(a.vitals.mana).toBe(100 - ABILITIES.sun_orb.manaCost);
    expect(h.events.map((e) => e.e)).toEqual(['cast', 'proj']);
    expect(h.sys.projectileCount).toBe(1);
    h.run(1050, 400);
    const kinds = h.events.map((e) => e.e);
    expect(kinds).toContain('projEnd');
    const dmg = h.events.find((e) => e.e === 'dmg');
    expect(dmg && dmg.e === 'dmg' && dmg.target === 1 && dmg.amount === 26 && dmg.kinds.includes(HitKind.ABILITY)).toBe(true);
    expect(h.sys.projectileCount).toBe(0);
    // Spam: same slot again is on cooldown; an ability A does not own is refused.
    expect(h.sys.request(a, { slot: 0, id: 'sun_orb', seq: 2, cmdSeq: 0, dir }, 1500)).toBe(AbilityReject.COOLDOWN);
    expect(h.sys.request(a, { slot: 1, id: 'leaf_shell', seq: 3, cmdSeq: 0 }, 1500)).toBe(AbilityReject.NOT_OWNED);
    expect(h.sys.request(a, { slot: 0, id: 'sun_orb', seq: 4, cmdSeq: 0 }, 9000)).toBe(AbilityReject.BAD_TARGET);
  });

  it('an area at a point waits for its ground warning, then damages and slows everyone inside', () => {
    const a = actor(0, ground(0));
    const b = actor(1, ground(12));
    const h = harness([a, b]);
    const s = slotOf(a.loadout, 'pollen_burst');
    expect(h.sys.request(a, { slot: s, id: 'pollen_burst', seq: 1, cmdSeq: 0, point: ground(12.5) }, 1000)).toBe(AbilityReject.OK);
    // Busy while winding up.
    expect(h.sys.request(a, { slot: 0, id: 'sun_orb', seq: 2, cmdSeq: 0, dir: { x: 1, y: 0, z: 0 } }, 1100)).toBe(AbilityReject.BUSY);
    const warnMs = (ABILITIES.pollen_burst.castTime + 0.65) * 1000;
    h.run(1000, warnMs - 60);
    expect(h.events.some((e) => e.e === 'dmg')).toBe(false);
    h.run(1000 + warnMs - 60, 200);
    expect(h.events.some((e) => e.e === 'area')).toBe(true);
    expect(b.vitals.shield).toBe(100 - 34);
    expect(b.slowFactor).toBe(0.55);
    expect(currentSlow(b, 1000 + warnMs + 500)).toBe(0.55);
    // Out of range point.
    a.cooldownEnds[s] = 0;
    a.castUntil = 0;
    expect(h.sys.request(a, { slot: s, id: 'pollen_burst', seq: 3, cmdSeq: 0, point: ground(40) }, 20_000)).toBe(AbilityReject.OUT_OF_RANGE);
  });

  it('an arcing seed bursts in an area where it lands', () => {
    // Lob it at several angles: some landing lands next to B, and the burst (not a direct hit) damages B.
    let dealt = 0;
    for (let tilt = 0; tilt < 0.6 && dealt === 0; tilt += 0.05) {
      const a = actor(0, ground(0), DEFAULT_LOADOUTS[1]!);
      const b = actor(1, ground(9));
      const h = harness([a, b]);
      const up = v3normalize(a.state.pos);
      const d = v3normalize({ x: 1 + up.x * tilt, y: up.y * tilt, z: up.z * tilt });
      h.sys.request(a, { slot: 0, id: 'thorn_seed', seq: 1, cmdSeq: 0, dir: d }, 1000);
      h.run(1050, 2500);
      const dmg = h.events.find((e) => e.e === 'dmg');
      if (dmg && dmg.e === 'dmg') {
        dealt = dmg.amount;
        expect(h.events.some((e) => e.e === 'area')).toBe(true);
        expect(h.sys.projectileCount).toBe(0);
      }
    }
    expect(dealt).toBeGreaterThan(0);
  });

  it('the cyclone Ultimate follows its caster and pulses several times; self abilities shield, heal and dash', () => {
    const a = actor(0, ground(0), DEFAULT_LOADOUTS[1]!);
    const b = actor(1, ground(3));
    const h = harness([a, b]);
    a.cooldownEnds[ULTIMATE_SLOT] = 0;
    expect(h.sys.request(a, { slot: ULTIMATE_SLOT, id: 'petal_cyclone', seq: 1, cmdSeq: 0 }, 1000)).toBe(AbilityReject.OK);
    h.run(1000, 4000);
    const pulses = h.events.filter((e) => e.e === 'area');
    expect(pulses.length).toBe(4);
    expect(h.events.filter((e) => e.e === 'dmg' && e.target === 1).length).toBe(4);

    a.vitals.shield = 20;
    expect(h.sys.request(a, { slot: slotOf(a.loadout, 'leaf_shell'), id: 'leaf_shell', seq: 2, cmdSeq: 0 }, 6000)).toBe(AbilityReject.OK);
    expect(a.vitals.shield).toBe(70);

    const c = actor(2, ground(0, 5), DEFAULT_LOADOUTS[2]!);
    const h3 = harness([c]);
    c.vitals.health = 40;
    expect(h3.sys.request(c, { slot: slotOf(c.loadout, 'bloom'), id: 'bloom', seq: 1, cmdSeq: 0 }, 1000)).toBe(AbilityReject.OK);
    expect(c.vitals.health).toBe(75);
    expect(h3.sys.request(c, { slot: slotOf(c.loadout, 'wind_step'), id: 'wind_step', seq: 2, cmdSeq: 77, dir: { x: 1, y: 0, z: 0 } }, 1000)).toBe(AbilityReject.OK);
    expect(h3.dashes).toEqual([{ index: 2, dir: { x: 1, y: 0, z: 0 }, distance: 7, cmdSeq: 77 }]);
  });

  it('refuses everything outside fighting phases and drops the wind-up of an eliminated caster', () => {
    const a = actor(0, ground(0));
    const b = actor(1, ground(10));
    const h = harness([a, b]);
    h.state.fight = false;
    expect(h.sys.request(a, { slot: 0, id: 'sun_orb', seq: 1, cmdSeq: 0, dir: { x: 1, y: 0, z: 0 } }, 1000)).toBe(AbilityReject.PHASE);
    h.state.fight = true;
    a.cooldownEnds[ULTIMATE_SLOT] = 0;
    expect(h.sys.request(a, { slot: ULTIMATE_SLOT, id: 'sun_meteor', seq: 2, cmdSeq: 0, point: b.state.pos }, 1000)).toBe(AbilityReject.OK);
    a.vitals.alive = false;
    h.run(1000, 3000);
    expect(h.events.some((e) => e.e === 'area' || e.e === 'dmg')).toBe(false);
    a.vitals.alive = true;
    a.vitals.mana = 10;
    expect(h.sys.request(a, { slot: 1, id: 'wind_step', seq: 3, cmdSeq: 0, dir: { x: 1, y: 0, z: 0 } }, 5000)).toBe(AbilityReject.NO_MANA);
  });
});
