import { describe, expect, it } from 'vitest';
import { ABILITIES, ABILITY_IDS, ABILITY_RULES, type AbilityId, type Loadout } from '@graao/game-data';
import { AbilityReject, v3addScaled, v3normalize, type AbilityRevealMsg, type GameEvent, type Vec3 } from '@graao/shared';
import { GRAAbilitySystem, type AbilityActor, type AbilityHost } from './abilitySystem';
import { createCharacterState } from './character';
import { applyAbilityDamage, type RayCaster } from './abilities';
import { applyDamage, newVitals, raySphere } from './combat';
import { applyStatus, newAbilityRuntime, statusModifiers } from './statusEffects';
import { passiveModifiers } from './passives';
import { abilityCloudVolume } from './abilityVolumes';

const ground = (meters: number): Vec3 => ({ x: Math.sin(meters / 100) * 100, y: 0, z: Math.cos(meters / 100) * 100 });
const world = (): RayCaster => ({
  castRay(origin, dir, max) {
    const toi = raySphere(origin, dir, { x: 0, y: 0, z: 0 }, 100);
    return toi >= 0 && toi <= max ? { toi, handle: 1 } : null;
  },
});

function actor(index: number, meters = 0, loadout: Loadout = ['wind_step', 'sap_snare', 'leaf_shell', 'sun_meteor']): AbilityActor {
  return {
    index, state: createCharacterState(ground(meters), { x: 1, y: 0, z: 0 }), vitals: newVitals(), loadout: [...loadout],
    cooldownEnds: [0, 0, 0, 0], castUntil: 0, slowUntil: 0, slowFactor: 1, runtime: newAbilityRuntime(0),
  };
}

function harness(players: AbilityActor[], physics: AbilityHost['physics'] = world()) {
  const events: GameEvent[] = [];
  const reveals: { to: number; message: AbilityRevealMsg }[] = [];
  const dashes: { by: number; dir: Vec3; distance: number; duration: number; seq: number }[] = [];
  const barriers: { handle: number; disposed: boolean }[] = [];
  const teleports: { index: number; at: Vec3; facing: Vec3 }[] = [];
  const resources = [{ id: 1, kind: 'chest' as const, at: ground(8) }, { id: 2, kind: 'pickup' as const, at: ground(3) }, { id: 3, kind: 'pickup' as const, at: ground(30) }];
  const host: AbilityHost = {
    actors: () => players, physics, canFight: (a) => a.vitals.alive,
    damage: (_by, target, amount) => { applyAbilityDamage(target.vitals, amount); },
    dash: (a, dir, distance, duration, seq) => { dashes.push({ by: a.index, dir, distance, duration, seq }); },
    emit: (event) => events.push(event), sendPrivate: (a, message) => reveals.push({ to: a.index, message }), resources: () => resources,
    createBarrier: () => {
      const barrier = { handle: barriers.length + 20, disposed: false };
      barriers.push(barrier);
      return { handle: barrier.handle, dispose: () => { barrier.disposed = true; } };
    },
    teleport: (a, at, facing) => teleports.push({ index: a.index, at, facing }),
  };
  const system = new GRAAbilitySystem(host);
  const cast = (a: AbilityActor, id: AbilityId, now = 1000, target?: Vec3, direction?: Vec3) => system.request(a, {
    slot: a.loadout.indexOf(id), id, seq: 1, cmdSeq: 42,
    ...(ABILITIES[id].targetType === 'direction' ? { dir: direction ?? { ...a.state.facing } } : {}),
    ...(ABILITIES[id].targetType === 'point' ? { point: target ?? ground(4) } : {}),
  }, now);
  const tick = (from: number, milliseconds: number) => {
    for (let now = from; now <= from + milliseconds; now += 50) system.update(now, 0.05);
  };
  return { system, cast, tick, events, reveals, dashes, barriers, teleports, host };
}

describe('Ability v2 first vertical slice', () => {
  it('wind step spends mana, schedules the real movement command and rejects a second cast on cooldown', () => {
    const a = actor(0);
    const h = harness([a]);
    expect(h.cast(a, 'wind_step')).toBe(AbilityReject.OK);
    expect(a.vitals.mana).toBe(100 - ABILITIES.wind_step.manaCost);
    expect(h.dashes).toEqual([{ by: 0, dir: a.state.facing, distance: 6, duration: 0.2, seq: 42 }]);
    expect(h.cast(a, 'wind_step', 1001)).toBe(AbilityReject.COOLDOWN);
  });

  it('sap pool controls enemies repeatedly without damage and recovers after its final pulse', () => {
    const a = actor(0);
    const b = actor(1, 5);
    const h = harness([a, b]);
    expect(h.cast(a, 'sap_snare', 1000, ground(4))).toBe(AbilityReject.OK);
    h.tick(1000, 4000);
    expect(statusModifiers(b.runtime, 5000).speedFactor).toBeCloseTo(0.65);
    expect(b.vitals).toMatchObject({ health: 100, shield: 100 });
    h.tick(5050, 3000);
    expect(statusModifiers(b.runtime, 8050).speedFactor).toBe(1);
    expect(a.runtime!.effects).toHaveLength(0);
  });

  it('leaf shell is separate protection, absorbs damage first and expires without inflating normal shield', () => {
    const a = actor(0);
    a.vitals.shield = 20;
    const h = harness([a]);
    expect(h.cast(a, 'leaf_shell')).toBe(AbilityReject.OK);
    expect(a.vitals).toMatchObject({ shield: 20, temporaryShield: 40 });
    applyDamage(a.vitals, 25, false);
    expect(a.vitals).toMatchObject({ health: 100, shield: 20, temporaryShield: 15 });
    h.system.update(8000, 0.05);
    expect(a.vitals).toMatchObject({ shield: 20, temporaryShield: 0 });
  });

  it('steady hand is automatic, changes real handling factors, and rejects manual activation without mana spend', () => {
    const a = actor(0, 0, ['steady_hand', 'wind_step', 'leaf_shell', 'sun_meteor']);
    const h = harness([a]);
    expect(passiveModifiers(a.loadout, a.runtime!.passive, 1000).weaponRecoil).toBe(0.88);
    expect(passiveModifiers(a.loadout, a.runtime!.passive, 1000).weaponSpread).toBe(0.88);
    expect(h.cast(a, 'steady_hand')).toBe(AbilityReject.PASSIVE);
    expect(a.vitals.mana).toBe(100);
    expect(h.events).toHaveLength(0);
  });

  it('firefly scout privately reveals only real nearby chests and pickups to its owner', () => {
    const a = actor(0, 0, ['firefly_scout', 'wind_step', 'leaf_shell', 'sun_meteor']);
    const h = harness([a, actor(1, 3)]);
    expect(h.cast(a, 'firefly_scout')).toBe(AbilityReject.OK);
    h.tick(1000, 500);
    expect(h.reveals).toHaveLength(1);
    expect(h.reveals[0]).toMatchObject({ to: 0, message: { kind: 'loot', by: 0, a: 'firefly_scout', targets: [{ id: 1, kind: 'chest' }, { id: 2, kind: 'pickup' }] } });
    expect(h.events.some((event) => (event as { kind?: string }).kind === 'loot')).toBe(false);
  });

  it('solar meteor warns before a moderate authoritative impact and leaves the caster unharmed', () => {
    const a = actor(0);
    const b = actor(1, 5);
    const h = harness([a, b]);
    expect(h.cast(a, 'sun_meteor', 1000, ground(4))).toBe(AbilityReject.OK);
    expect(h.events[0]).toMatchObject({ e: 'cast', a: 'sun_meteor', by: 0 });
    h.tick(1000, 1000);
    expect(b.vitals.shield).toBe(100);
    h.tick(2050, 1000);
    expect(b.vitals.shield).toBe(65);
    expect(a.vitals.health).toBe(100);
    expect(a.vitals.shield).toBe(100);
    expect(a.vitals.mana).toBe(50);
  });

  it('resolves a meteor once when its victim death removes an earlier persistent area', () => {
    const a = actor(0);
    const b = actor(1, 4);
    const c = actor(2, 5);
    b.vitals.health = 1; b.vitals.shield = 0;
    const h = harness([a, b, c]);
    h.host.damage = (_by, target, amount) => {
      if (applyAbilityDamage(target.vitals, amount).eliminated) h.system.cancelFor(target.index);
    };
    expect(h.cast(b, 'sap_snare', 1000, ground(4))).toBe(AbilityReject.OK);
    expect(h.cast(a, 'sun_meteor', 1000, ground(4))).toBe(AbilityReject.OK);
    h.tick(1000, 1800);
    expect(b.vitals.alive).toBe(false);
    expect(c.vitals.shield).toBe(65);
    expect(h.events.filter((event) => event.e === 'area' && event.a === 'sun_meteor')).toHaveLength(1);
    expect(h.system.pendingCount).toBe(0);
  });

  it('does not resolve any remaining areas after a match-end callback clears the ability engine', () => {
    const a = actor(0);
    const b = actor(1, 4, ['pollen_burst', 'sap_snare', 'leaf_shell', 'sun_meteor']);
    const h = harness([a, b]);
    h.host.damage = (_by, target, amount) => { applyAbilityDamage(target.vitals, amount); h.system.clear(); };
    expect(h.cast(a, 'sun_meteor', 1000, ground(4))).toBe(AbilityReject.OK);
    expect(h.cast(b, 'pollen_burst', 2200, ground(0))).toBe(AbilityReject.OK);
    h.tick(1000, 2200);
    expect(b.vitals.shield).toBe(65);
    expect(h.events.filter((event) => event.e === 'area' && event.a === 'sun_meteor')).toHaveLength(1);
    expect(h.events.filter((event) => event.e === 'area' && event.a === 'pollen_burst')).toHaveLength(0);
    expect(h.system.pendingCount).toBe(0);
  });
});

describe('all forty catalog abilities execute through the authoritative engine', () => {
  it.each(ABILITY_IDS)('%s has a playable active cast or an automatic passive', (id) => {
    const definition = ABILITIES[id];
    const loadout: Loadout = definition.slotType === 'ultimate'
      ? ['wind_step', 'sap_snare', 'leaf_shell', id]
      : [id, id === 'wind_step' ? 'sun_orb' : 'wind_step', id === 'leaf_shell' ? 'bloom' : 'leaf_shell', 'sun_meteor'];
    const a = actor(0, 0, loadout);
    const b = actor(1, 5);
    const physics: AbilityHost['physics'] = {
      ...world(),
      castRay: (origin, dir, max) => (id === 'clothesline' ? { toi: 8, handle: 2 } : world().castRay(origin, dir, max)),
      castRayNormal: () => ({ toi: id === 'clothesline' ? 6 : 0.6, handle: 2, normal: { x: -1, y: 0, z: 0 } }),
    };
    const h = harness([a, b], physics);
    const direction = id === 'clothesline' ? { x: 1 / Math.hypot(1, 0.2), y: 0, z: -0.2 / Math.hypot(1, 0.2) } : undefined;
    const accepted = h.cast(a, id, 1000, id === 'chalk_shortcut' ? ground(20) : undefined, direction);
    if (definition.kind === 'passive') {
      expect(accepted).toBe(AbilityReject.PASSIVE);
      expect(a.vitals.mana).toBe(100);
      expect(a.cooldownEnds).toEqual([0, 0, 0, 0]);
      expect(definition.passive).toBeDefined();
    } else {
      expect(accepted).toBe(AbilityReject.OK);
      expect(a.vitals.mana).toBe(100 - definition.manaCost);
      expect(a.cooldownEnds[a.loadout.indexOf(id)]).toBe(1000 + definition.cooldown * 1000);
      h.tick(1000, 1500);
      expect(h.events.filter((event) => event.e === 'cast')).toHaveLength(1);
      expect(Object.values(a.state.pos).every(Number.isFinite)).toBe(true);
      expect(Object.values(a.state.vel).every(Number.isFinite)).toBe(true);
    }
  });
});

describe('persistent tactical entities and mobility', () => {
  it('requires a valid grapple surface, an airborne jump and a nearby wall before spending mana', () => {
    const a = actor(0, 0, ['kite_jump', 'clothesline', 'ricochet', 'sun_meteor']);
    const h = harness([a]);
    a.state.grounded = true;
    expect(h.cast(a, 'kite_jump')).toBe(AbilityReject.BAD_TARGET);
    expect(h.cast(a, 'clothesline')).toBe(AbilityReject.BAD_TARGET);
    expect(h.cast(a, 'ricochet')).toBe(AbilityReject.BAD_TARGET);
    expect(a.vitals.mana).toBe(100);
    a.state.grounded = false;
    expect(h.cast(a, 'kite_jump')).toBe(AbilityReject.OK);
    expect(a.state.abilityJumpUsed).toBe(true);
    expect(a.state.vel.z).toBeGreaterThan(0);
    a.cooldownEnds[0] = 0;
    expect(h.cast(a, 'kite_jump', 20000)).toBe(AbilityReject.BAD_TARGET);
  });

  it('barriers have independent health and dispose their collision handle on destruction or reset', () => {
    const a = actor(0, 0, ['paper_wall', 'wind_step', 'leaf_shell', 'paper_city']);
    const h = harness([a]);
    expect(h.cast(a, 'paper_wall', 1000, ground(4))).toBe(AbilityReject.OK);
    h.tick(1000, 1000);
    expect(h.system.entities).toHaveLength(1);
    expect(h.system.damageBarrier(h.barriers[0]!.handle, 30)).toBe(true);
    expect(h.system.entities[0]?.health).toBe(60);
    expect(h.barriers[0]?.disposed).toBe(false);
    h.system.damageBarrier(h.barriers[0]!.handle, 60);
    expect(h.barriers[0]?.disposed).toBe(true);
    expect(h.system.entities).toHaveLength(0);
    a.vitals.mana = 100;
    expect(h.cast(a, 'paper_city', 3000, ground(6))).toBe(AbilityReject.OK);
    h.tick(3000, 1000);
    expect(h.system.entities).toHaveLength(3);
    h.system.clear();
    expect(h.barriers.every((barrier) => barrier.disposed)).toBe(true);
  });

  it('rejects overlapping cover or missing physical host support before spending mana', () => {
    const a = actor(0, 0, ['paper_wall', 'wind_step', 'leaf_shell', 'sun_meteor']);
    const h = harness([a, actor(1, 4)]);
    expect(h.cast(a, 'paper_wall', 1000, ground(4))).toBe(AbilityReject.BAD_TARGET);
    expect(a.vitals.mana).toBe(100);
    const solo = harness([a]);
    delete solo.host.createBarrier;
    expect(solo.cast(a, 'paper_wall')).toBe(AbilityReject.BAD_TARGET);
    expect(a.vitals.mana).toBe(100);
  });

  it('clouds occlude authoritative rays, expire, and do not leak into a second room engine', () => {
    const a = actor(0, 0, ['chalk_cloud', 'wind_step', 'leaf_shell', 'sun_meteor']);
    const h = harness([a]);
    expect(h.cast(a, 'chalk_cloud')).toBe(AbilityReject.OK);
    h.tick(1000, 600);
    expect(h.system.occludeRay({ x: -10, y: 0, z: 102 }, { x: 1, y: 0, z: 0 }, 30)).not.toBeNull();
    expect(harness([actor(0)]).system.occludeRay({ x: -10, y: 0, z: 102 }, { x: 1, y: 0, z: 0 }, 30)).toBeNull();
    h.tick(1650, 6000);
    expect(h.system.occludeRay({ x: -10, y: 0, z: 102 }, { x: 1, y: 0, z: 0 }, 30)).toBeNull();
  });

  it('cloud rays stop at the shared upper and lateral boundaries and pass immediately outside them', () => {
    const a = actor(0, 0, ['chalk_cloud', 'wind_step', 'leaf_shell', 'sun_meteor']);
    const h = harness([a]);
    expect(h.cast(a, 'chalk_cloud', 1000, ground(0))).toBe(AbilityReject.OK);
    h.tick(1000, 600);
    const { center, radius } = abilityCloudVolume(ground(0), 5);
    for (const axis of ['y', 'z'] as const) {
      for (const margin of [-0.05, 0.05]) {
        const origin = { ...center, x: center.x - 10, [axis]: center[axis] + radius + margin };
        const hit = h.system.occludeRay(origin, { x: 1, y: 0, z: 0 }, 30);
        if (margin < 0) expect(hit).not.toBeNull();
        else expect(hit).toBeNull();
      }
    }
    // This elevation was above the old flattened mesh, but is still inside the authoritative cloud.
    expect(h.system.occludeRay({ x: -10, y: 0, z: 104 }, { x: 1, y: 0, z: 0 }, 30)).not.toBeNull();
  });

  it('traps trigger once against an enemy and leave neither permanent roots nor live entities', () => {
    const a = actor(0, 0, ['thorn_seed', 'wind_step', 'leaf_shell', 'sun_meteor']);
    const b = actor(1, 9);
    const h = harness([a, b]);
    expect(h.cast(a, 'thorn_seed', 1000, ground(4))).toBe(AbilityReject.OK);
    h.tick(1000, 1000);
    expect(h.system.entities[0]?.kind).toBe('trap');
    b.state.pos = ground(4.5);
    h.system.update(2050, 0.05);
    expect(statusModifiers(b.runtime, 2050).rooted).toBe(true);
    expect(h.system.entities).toHaveLength(0);
    expect(statusModifiers(b.runtime, 3000).rooted).toBe(false);
  });

  it('umbrella protects its front sector, permits rear damage and blocks only its owner attacks', () => {
    const a = actor(0, 0, ['magic_umbrella', 'wind_step', 'leaf_shell', 'sun_meteor']);
    const h = harness([a]);
    expect(h.cast(a, 'magic_umbrella')).toBe(AbilityReject.OK);
    expect(h.system.attackLocked(a, 1100)).toBe(true);
    expect(h.system.blocksAttack(a, ground(4), 1100)).toBe(true);
    expect(h.system.blocksAttack(a, ground(-4), 1100)).toBe(false);
    expect(h.system.attackLocked(a, 4100)).toBe(false);
  });

  it('owner-only portals validate surfaces, preserve radial facing and enforce a reentry interval', () => {
    const a = actor(0, 0, ['wind_step', 'sap_snare', 'leaf_shell', 'chalk_shortcut']);
    const b = actor(1, 5);
    const h = harness([a, b]);
    expect(h.cast(a, 'chalk_shortcut', 1000, { x: 0, y: 0, z: 150 })).not.toBe(AbilityReject.OK);
    expect(a.vitals.mana).toBe(100);
    expect(h.cast(a, 'chalk_shortcut', 1000, ground(20))).toBe(AbilityReject.OK);
    h.tick(1000, 1000);
    const entry = h.system.entities.find((entity) => entity.kind === 'portal')!;
    expect(h.system.entities).toHaveLength(2);
    b.state.pos = { x: entry.at[0] / 1000, y: entry.at[1] / 1000, z: entry.at[2] / 1000 };
    h.system.update(2100, 0.05);
    expect(h.teleports).toHaveLength(0);
    a.state.pos = { ...b.state.pos };
    h.system.update(2150, 0.05);
    expect(h.teleports).toHaveLength(1);
    expect(Math.hypot(a.state.pos.x - ground(20).x, a.state.pos.z - ground(20).z)).toBeLessThan(0.1);
    expect(a.state.pos.x * a.state.facing.x + a.state.pos.z * a.state.facing.z).toBeCloseTo(0, 5);
    h.system.update(2200, 0.05);
    expect(h.teleports).toHaveLength(1);
  });

  it('cleanse removes permitted effects, while independent slows preserve each source duration', () => {
    const a = actor(0, 0, ['rain_bath', 'wind_step', 'leaf_shell', 'sun_meteor']);
    applyStatus(a.runtime!, 'slow', 0.5, 1, 100, 1);
    applyStatus(a.runtime!, 'slow', 0.7, 5, 100, 2);
    expect(statusModifiers(a.runtime, 500).speedFactor).toBe(0.5);
    expect(statusModifiers(a.runtime, 1500).speedFactor).toBe(0.7);
    const h = harness([a]);
    expect(h.cast(a, 'rain_bath', 1600)).toBe(AbilityReject.OK);
    h.tick(1600, 500);
    expect(statusModifiers(a.runtime, 2100).speedFactor).toBe(1);
    expect(applyStatus(a.runtime!, 'slow', 0.5, 2, 2100, 1)).toBe(true);
    expect(statusModifiers(a.runtime, 2500).speedFactor).toBe(0.5);
    expect(statusModifiers(a.runtime, 3000).speedFactor).toBe(1);
  });

  it('death and restart clear owner entities, movement and private target tracking', () => {
    const a = actor(0, 0, ['chalk_cloud', 'wind_step', 'leaf_shell', 'kite_flight']);
    const h = harness([a]);
    h.cast(a, 'chalk_cloud'); h.tick(1000, 600);
    a.vitals.mana = 100;
    h.cast(a, 'kite_flight', 2000); h.tick(2000, 700);
    expect(a.state.abilityMovement?.mode).toBe('flight');
    a.vitals.alive = false;
    h.system.cancelFor(a.index);
    expect(h.system.entities).toHaveLength(0);
    expect(a.state.abilityMovement).toBeUndefined();
    h.system.clear();
    expect(h.system.pendingCount).toBe(0);
    expect(h.system.projectileCount).toBe(0);
    expect(h.reveals).toHaveLength(0);
  });

  it('bounds public entities under repeated accepted casts', () => {
    const a = actor(0, 0, ['chalk_cloud', 'wind_step', 'leaf_shell', 'sun_meteor']);
    const h = harness([a]);
    for (let index = 0; index < ABILITY_RULES.maxEntitiesPerCaster + 4; index++) {
      a.vitals.mana = 100;
      a.cooldownEnds[0] = 0;
      a.castUntil = 0;
      h.cast(a, 'chalk_cloud', 1000 + index);
      h.system.update(1500 + index, 0.01);
    }
    expect(h.system.entities.length).toBeLessThanOrEqual(ABILITY_RULES.maxEntitiesPerCaster);
  });
});

describe('authoritative information and spherical waves', () => {
  it('announces an early motor stop once and clears movement tracking on cancel and reset', () => {
    const a = actor(0, 0, ['paper_wings', 'wind_step', 'leaf_shell', 'kite_flight']);
    a.state.grounded = false;
    const h = harness([a]);
    const ends = () => h.events.filter((e) => e.e === 'fx' && e.k === 'dash' && e.v === 0);
    expect(h.cast(a, 'paper_wings', 1000)).toBe(AbilityReject.OK);
    h.system.update(1100, .05);
    expect(ends()).toHaveLength(0);
    delete a.state.abilityMovement; // The character motor does this when the glide lands or is interrupted.
    h.system.update(1150, .05);
    expect(ends()).toEqual([{ e: 'fx', by: 0, target: 0, k: 'dash', v: 0 }]);
    h.system.update(1200, .05);
    expect(ends()).toHaveLength(1);
    a.cooldownEnds.fill(0); a.vitals.mana = 100;
    expect(h.cast(a, 'paper_wings', 1300)).toBe(AbilityReject.OK);
    h.system.cancelFor(0);
    h.system.update(1350, .05);
    expect(ends()).toHaveLength(2);
    a.cooldownEnds.fill(0); a.vitals.mana = 100;
    expect(h.cast(a, 'paper_wings', 1400)).toBe(AbilityReject.OK);
    h.system.clear();
    h.system.update(1450, .05);
    expect(ends()).toHaveLength(2);
  });

  it('solar orb reveals only the first real hit player to its owner, then follows actual snapshots without damage', () => {
    const a = actor(0, 0, ['sun_orb', 'wind_step', 'leaf_shell', 'sun_meteor']);
    const b = actor(1, 5);
    const h = harness([a, b, actor(2, 12)]);
    expect(h.cast(a, 'sun_orb')).toBe(AbilityReject.OK);
    h.tick(1000, 800);
    const initial = h.reveals.find((reveal) => reveal.message.kind === 'enemy');
    expect(initial).toMatchObject({ to: 0, message: { kind: 'enemy', targets: [{ index: 1 }] } });
    expect(h.reveals.every((reveal) => reveal.to === 0)).toBe(true);
    expect(b.vitals).toMatchObject({ health: 100, shield: 100 });
    b.state.pos = ground(8);
    h.tick(1850, 500);
    const latest = h.reveals.at(-1)!.message;
    expect(latest.kind === 'enemy' && latest.targets[0]?.at[0]).toBe(Math.round(b.state.pos.x * 1000));
    const before = h.reveals.length;
    b.vitals.alive = false;
    h.tick(2400, 1000);
    expect(h.reveals.length).toBe(before);
  });

  it('echo returns bounded real movement history privately and discards points older than eight seconds', () => {
    const a = actor(0, 0, ['footstep_echo', 'wind_step', 'leaf_shell', 'sun_meteor']);
    const b = actor(1, 3);
    const h = harness([a, b]);
    for (let now = 0; now <= 4000; now += 500) {
      b.state.pos = ground(3 + now / 1000);
      h.system.update(now, 0.05);
    }
    expect(h.cast(a, 'footstep_echo', 4100)).toBe(AbilityReject.OK);
    h.tick(4100, 500);
    const trail = h.reveals.find((reveal) => reveal.message.kind === 'trail');
    expect(trail?.to).toBe(0);
    expect(trail?.message.kind === 'trail' && trail.message.points.length).toBeGreaterThan(1);
    expect(trail?.message.kind === 'trail' && trail.message.points.length).toBeLessThanOrEqual(ABILITY_RULES.maxTrailPoints);
    a.cooldownEnds[0] = 0; a.castUntil = 0; a.vitals.mana = 100;
    b.vitals.alive = false;
    h.system.update(15000, 0.05);
    h.cast(a, 'footstep_echo', 15050);
    h.tick(15050, 500);
    expect(h.reveals.at(-1)?.message).toMatchObject({ kind: 'trail', points: [] });
  });

  it('echo never invents trails for stationary actors at spawn or after real footprints expire', () => {
    const a = actor(0, 0, ['footstep_echo', 'wind_step', 'leaf_shell', 'sun_meteor']);
    const b = actor(1, 3);
    const h = harness([a, b]);
    const revealAt = (now: number) => {
      a.cooldownEnds[0] = 0; a.castUntil = 0; a.vitals.mana = 100;
      expect(h.cast(a, 'footstep_echo', now)).toBe(AbilityReject.OK);
      h.tick(now, 200);
      return h.reveals.at(-1)?.message;
    };
    h.tick(0, 9000);
    expect(revealAt(9100)).toMatchObject({ kind: 'trail', points: [] });
    b.state.pos = ground(3.4);
    h.system.update(9600, 0.05);
    const moving = revealAt(9700);
    expect(moving?.kind === 'trail' && moving.points).toHaveLength(1);
    h.tick(10000, 10000);
    expect(revealAt(20100)).toMatchObject({ kind: 'trail', points: [] });
    h.system.cancelFor(b.index);
    b.state.pos = ground(8);
    h.tick(20500, 1000);
    expect(revealAt(21600)).toMatchObject({ kind: 'trail', points: [] });
    h.system.clear();
    b.state.pos = ground(12);
    h.tick(22000, 1000);
    expect(revealAt(23100)).toMatchObject({ kind: 'trail', points: [] });
  });

  it('activity sensing reports only recent attackers in coarse bearings with no position fields', () => {
    const a = actor(0, 0, ['backyard_eye', 'wind_step', 'leaf_shell', 'sun_meteor']);
    const h = harness([a, actor(1, 5), actor(2, 8)]);
    h.system.recordActivity(1, 1000);
    expect(h.cast(a, 'backyard_eye', 1100)).toBe(AbilityReject.OK);
    h.tick(1100, 500);
    const reveal = h.reveals.at(-1)!.message;
    expect(reveal.kind).toBe('bearing');
    expect(reveal.kind === 'bearing' && reveal.bearings).toHaveLength(1);
    expect(JSON.stringify(reveal)).not.toContain('"at"');
    expect(JSON.stringify(reveal)).not.toContain('"targets"');
  });

  it('a visible beacon periodically sends coarse bearings and is destructible before its duration ends', () => {
    const a = actor(0, 0, ['wind_step', 'sap_snare', 'leaf_shell', 'firefly_beacon']);
    const h = harness([a, actor(1, 12)]);
    expect(h.cast(a, 'firefly_beacon', 1000, ground(5))).toBe(AbilityReject.OK);
    h.tick(1000, 3000);
    const beacon = h.system.entities.find((entity) => entity.kind === 'beacon')!;
    expect(beacon.health).toBe(60);
    expect(h.reveals.filter((reveal) => reveal.message.kind === 'bearing').length).toBeGreaterThan(1);
    expect(h.system.damageBarrier(-beacon.id - 2, 60)).toBe(true);
    const before = h.reveals.length;
    h.tick(4050, 3000);
    expect(h.reveals.length).toBe(before);
  });

  it('lets a shot aimed at the visible beacon lamp damage and destroy it, but misses above it', () => {
    const a = actor(0, 0, ['wind_step', 'sap_snare', 'leaf_shell', 'firefly_beacon']);
    const h = harness([a]);
    expect(h.cast(a, 'firefly_beacon', 1000, ground(5))).toBe(AbilityReject.OK);
    h.tick(1000, 500);
    const beacon = h.system.entities.find((entity) => entity.kind === 'beacon')!;
    const at = { x: beacon.at[0] / 1000, y: beacon.at[1] / 1000, z: beacon.at[2] / 1000 };
    const up = v3normalize(at);
    const lamp = v3addScaled(at, up, 2.6);
    const direction = { x: up.z, y: 0, z: -up.x };
    const from = v3addScaled(lamp, direction, -4);
    expect(h.system.occludeRay(v3addScaled(from, up, .51), direction, 8)).toBeNull();
    const hit = h.system.occludeRay(from, direction, 8)!;
    expect(hit).not.toBeNull();
    // The rendered anchor is quantized to millimetres; the authoritative centre retains full precision.
    expect(hit.toi).toBeCloseTo(3.5, 3);
    h.system.damageBarrier(hit.handle, 30);
    expect(h.system.entities.find((entity) => entity.id === beacon.id)?.health).toBe(30);
    h.system.damageBarrier(hit.handle, 30);
    expect(h.system.entities.some((entity) => entity.id === beacon.id)).toBe(false);
    expect(h.system.occludeRay(from, direction, 8)).toBeNull();
  });

  it.each(['dawn_lance', 'ink_tide'] as const)('%s follows the curved surface and pushes each enemy once without damage', (id) => {
    const a = actor(0, 0, ['wind_step', 'sap_snare', 'leaf_shell', id]);
    const b = actor(1, 8);
    const h = harness([a, b]);
    expect(h.cast(a, id)).toBe(AbilityReject.OK);
    h.tick(1000, 3000);
    expect(h.events.filter((event) => event.e === 'fx' && event.k === 'knock' && event.target === 1)).toHaveLength(1);
    expect(b.vitals).toMatchObject({ health: 100, shield: 100 });
    const positions = h.events.flatMap((event) => event.e === 'abilityEntity' && event.entity.kind === 'wave' ? [event.entity.at] : []);
    expect(positions.length).toBeGreaterThan(3);
    expect(positions.every((p) => Math.abs(Math.hypot(...p) / 1000 - 100) < 0.03)).toBe(true);
  });
});
