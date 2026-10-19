/**
 * GRAAbilitySystem: executes ability definitions on the authoritative server. Not a GAS port: an AbilityDefinition
 * is plain data (`@graao/game-data`) whose `effects` are composed from the primitives in abilities.ts; this class
 * validates requests, commits Mana/cooldowns, runs wind-ups, simulates projectiles and resolves areas over time.
 *
 * The room provides an AbilityHost (players, physics, phase rule, damage/elimination bookkeeping, dash scheduling on
 * the movement stream, event sink), so the whole system runs in unit tests with a fake host.
 */
import { ABILITIES, ABILITY_RULES, MOVEMENT, type AbilityDefinition, type AbilityEffect, type AbilityId, type Loadout } from '@graao/game-data';
import { AbilityReject, DIR_SCALE, POS_SCALE, VEL_SCALE, v3addScaled, v3cross, v3dot, v3len, v3normalize, v3projectOnPlane, v3scale, type AbilityEntityView, type AbilityRevealMsg, type GameEvent, type Vec3 } from '@graao/shared';
import type { CharacterState } from './character';
import { applyTemporaryShield, expireTemporaryShield, raySphere, type PlayerHitTarget, type Vitals } from './combat';
import { applyStatus, cleanseStatusEffects, newAbilityRuntime, statusModifiers, updateStatusEffects, type AbilityRuntime } from './statusEffects';
import { passiveModifiers } from './passives';
import { Group, groups, GROUPS_WORLD_QUERY, type AbilityBarrierFrame, type GamePhysics } from './physics';
import { transportTangent } from './sphere';
import { abilityCloudVolume } from './abilityVolumes';
import { releaseTraversal } from './traversal';
import {
  applyHeal,
  applyKnockback,
  applyShield,
  applySlow,
  areaVictims,
  castOrigin,
  checkCast,
  spendCast,
  stepProjectile,
  validateTargetPoint,
  type ProjectileBody,
  type RayCaster,
  type SlowStatus,
} from './abilities';

/** What the ability system needs to know about a player. The server's ServerPlayer implements it. */
export interface AbilityActor extends SlowStatus {
  readonly index: number;
  state: CharacterState;
  vitals: Vitals;
  loadout: Loadout;
  cooldownEnds: number[];
  castUntil: number;
  runtime?: AbilityRuntime;
  frontShieldUntil?: number;
  frontShieldArc?: number;
}

export interface AbilityHost {
  physics: RayCaster & Partial<Pick<GamePhysics, 'castRayNormal' | 'boxOverlaps' | 'ballOverlaps'>>;
  actors(): Iterable<AbilityActor>;
  /** The match-phase rule shared with weapons (countdown, results, spectators). */
  canFight(a: AbilityActor, now: number): boolean;
  /** Shield-then-Health damage from an ability, with dmg/elim events and match bookkeeping. */
  damage(by: AbilityActor, target: AbilityActor, amount: number, ability: AbilityId, now: number): void;
  /** Starts a dash exactly at movement command `cmdSeq` (client prediction does the same). */
  dash(a: AbilityActor, dir: Vec3, distance: number, duration: number, cmdSeq: number): void;
  emit(e: GameEvent): void;
  /** Other bodies abilities can hit (creeps), with indices that never collide with a player's. */
  others?(): PlayerHitTarget[];
  /** Damage to one of `others` (only damage: slows, knockbacks and the rest are for players). */
  damageOther?(by: AbilityActor, target: number, amount: number, ability: AbilityId, now: number): void;
  /** Private reconnaissance; never broadcast hidden positions to the whole room. */
  sendPrivate?(actor: AbilityActor, message: AbilityRevealMsg): void;
  resources?(): { id: number; at: Vec3; kind: 'chest' | 'pickup' }[];
  createBarrier?(view: AbilityEntityView, frame: AbilityBarrierFrame): { handle: number; dispose(): void };
  /** Teleport acknowledgement and capsule repositioning; only called after both ends validate. */
  teleport?(actor: AbilityActor, feet: Vec3, facing: Vec3): void;
}

export interface AbilityRequest {
  slot: number;
  id: string;
  seq: number;
  /** The caster's movement command at which a dash starts. */
  cmdSeq: number;
  /** Unit direction (projectiles, dashes). */
  dir?: Vec3;
  /** Point target (areas at a point). */
  point?: Vec3;
}

interface PendingCast {
  caster: AbilityActor;
  def: AbilityDefinition;
  req: AbilityRequest;
  at: number;
}

interface FlyingProjectile extends ProjectileBody {
  id: number;
  caster: AbilityActor;
  def: AbilityDefinition;
  onHit: AbilityEffect[];
}

interface PendingArea {
  caster: AbilityActor;
  def: AbilityDefinition;
  effect: Extract<AbilityEffect, { kind: 'area' }>;
  center: Vec3;
  at: number;
  pulse: number;
  entity?: number;
}

interface RuntimeEntity {
  view: AbilityEntityView;
  caster: AbilityActor;
  def: AbilityDefinition;
  center: Vec3;
  effect?: AbilityEffect;
  collider?: { handle: number; dispose(): void };
  nextAt?: number;
  direction?: Vec3;
  traveled?: number;
  hits?: Set<number>;
  exit?: Vec3;
  nextUseAt?: number;
}

interface RevealTracking {
  caster: AbilityActor;
  def: AbilityDefinition;
  target: AbilityActor;
  endsAt: number;
  nextAt: number;
}

interface EffectContext {
  caster: AbilityActor;
  def: AbilityDefinition;
  now: number;
  req?: AbilityRequest;
  /** Victim of a projectile hit or an area pulse. */
  target?: AbilityActor;
  /** A victim that is not a player (a creep's hit index): it only takes the damage effects. */
  other?: number;
  /** Area centre / impact point (knockback source, nested areas). */
  center?: Vec3;
  /** Knockback direction for direct hits (the projectile's flight). */
  push?: Vec3;
  /** Damage scale (area falloff). */
  scale: number;
}

const mm = (v: Vec3): [number, number, number] => [Math.round(v.x * POS_SCALE), Math.round(v.y * POS_SCALE), Math.round(v.z * POS_SCALE)];
const distance = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const dirTuple = (v: Vec3): [number, number, number] => [Math.round(v.x * DIR_SCALE), Math.round(v.y * DIR_SCALE), Math.round(v.z * DIR_SCALE)];
const subtract = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const finite = (v: Vec3): boolean => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
const surfaceDistance = (a: Vec3, b: Vec3): number => Math.acos(Math.max(-1, Math.min(1, v3dot(v3normalize(a), v3normalize(b))))) * (v3len(a) + v3len(b)) / 2;

export class GRAAbilitySystem {
  private readonly casts: PendingCast[] = [];
  private readonly projectiles: FlyingProjectile[] = [];
  private readonly areas: PendingArea[] = [];
  private readonly persistent = new Map<number, RuntimeEntity>();
  private readonly tracking: RevealTracking[] = [];
  private readonly trails = new Map<number, { at: number; pos: Vec3 }[]>();
  /** Separate movement anchors survive history expiry: a motionless actor must not create a fresh footprint. */
  private readonly lastTrackedPositions = new Map<number, Vec3>();
  private readonly activity = new Map<number, number>();
  private trailAt = -Infinity;
  private nextId = 1;

  constructor(private readonly host: AbilityHost) {}

  /** Live projectiles (tests, F3). */
  get projectileCount(): number {
    return this.projectiles.length;
  }

  get pendingCount(): number {
    return this.casts.length + this.areas.length;
  }

  /** Current public entities for reconnect/loading; callers cannot mutate engine state through the returned view. */
  get entities(): AbilityEntityView[] {
    return [...this.persistent.values()].map(({ view }) => ({ ...view, at: [...view.at], ...(view.dir ? { dir: [...view.dir] } : {}), ...(view.size ? { size: [...view.size] } : {}) }));
  }

  recordActivity(index: number, now: number): void {
    this.activity.set(index, now);
  }

  /** A positive handle belongs to real cover; negative handles identify a destructible beacon. */
  damageBarrier(handle: number, amount: number): boolean {
    for (const entity of this.persistent.values()) {
      if (entity.collider?.handle !== handle && -entity.view.id - 2 !== handle) continue;
      if (entity.view.health === undefined) return false;
      entity.view.health = Math.max(0, entity.view.health - Math.max(0, amount));
      if (entity.view.health <= 0) this.endEntity(entity.view.id);
      else this.host.emit({ e: 'abilityEntity', entity: { ...entity.view } });
      return true;
    }
    return false;
  }

  /** Analytic opaque cloud volume and the small destructible beacon body, scoped to this ability engine's room. */
  occludeRay(origin: Vec3, direction: Vec3, maxDistance: number): { toi: number; handle: number } | null {
    let closest: { toi: number; handle: number } | null = null;
    for (const entity of this.persistent.values()) {
      if (entity.effect?.kind !== 'cloud' && entity.view.kind !== 'beacon') continue;
      const volume = entity.effect?.kind === 'cloud' ? abilityCloudVolume(entity.center, entity.effect.radius) : { center: v3addScaled(entity.center, v3normalize(entity.center), 1.2), radius: 0.5 };
      const { center, radius } = volume;
      const toi = distance(origin, center) <= radius ? 0 : raySphere(origin, direction, center, radius);
      if (toi < 0 || toi > maxDistance || (closest && toi >= closest.toi)) continue;
      closest = { toi, handle: -entity.view.id - 2 };
    }
    return closest;
  }

  attackLocked(actor: AbilityActor, now: number): boolean {
    return actor.state.abilityMovement?.mode === 'flight' || now < (actor.frontShieldUntil ?? 0);
  }

  blocksAttack(target: AbilityActor, from: Vec3, now: number): boolean {
    if (!target.vitals.alive || now >= (target.frontShieldUntil ?? 0)) return false;
    const up = v3normalize(target.state.pos);
    const toward = v3normalize(v3projectOnPlane(subtract(from, target.state.pos), up));
    const forward = v3normalize(v3projectOnPlane(target.state.facing, up));
    return v3dot(toward, forward) >= Math.cos(((target.frontShieldArc ?? 110) * Math.PI) / 360);
  }

  /** Validates and, when accepted, commits a cast. Returns the reason (OK = accepted). */
  request(caster: AbilityActor, req: AbilityRequest, now: number): AbilityReject {
    caster.runtime ??= newAbilityRuntime(now);
    const reason = checkCast(
      { alive: caster.vitals.alive, canFight: this.host.canFight(caster, now), mana: caster.vitals.mana, loadout: caster.loadout, cooldownEnds: caster.cooldownEnds, castUntil: caster.castUntil, silenced: statusModifiers(caster.runtime, now).silenced },
      req.slot,
      req.id,
      now,
    );
    if (reason !== AbilityReject.OK) return reason;
    const def = ABILITIES[req.id as AbilityId];
    if (this.attackLocked(caster, now)) return AbilityReject.BUSY;
    // Target checks.
    if (def.targetType === 'direction') {
      if (!req.dir || !finite(req.dir) || Math.abs(v3len(req.dir) - 1) > 0.05) return AbilityReject.BAD_TARGET;
    } else if (def.targetType === 'point') {
      if (!req.point) return AbilityReject.BAD_TARGET;
      const r = validateTargetPoint(this.host.physics, caster.state.pos, req.point, def.range);
      if (r !== AbilityReject.OK) return r;
    }
    const condition = this.validateEffects(caster, def, req, now);
    if (condition !== AbilityReject.OK) return condition;
    const until = spendCast(caster, req.slot, def, now);
    this.recordActivity(caster.index, now);
    this.host.emit({
      e: 'cast',
      by: caster.index,
      a: def.id,
      k: req.slot,
      s: req.seq,
      until,
      ...(req.dir ? { d: [Math.round(req.dir.x * 10000), Math.round(req.dir.y * 10000), Math.round(req.dir.z * 10000)] as [number, number, number] } : {}),
      ...(req.point ? { p: mm(req.point) } : {}),
    });
    const cast: PendingCast = { caster, def, req, at: until };
    if (def.castTime <= 0) this.resolveCast(cast, now);
    else this.casts.push(cast);
    return AbilityReject.OK;
  }

  /** Advances wind-ups, projectiles and areas. `now` in server ms, `dt` in seconds. */
  update(now: number, dt: number): void {
    for (const actor of this.host.actors()) {
      expireTemporaryShield(actor.vitals, now);
      if (actor.runtime) updateStatusEffects(actor.runtime, now, actor.vitals.alive);
    }
    for (let i = 0; i < this.casts.length; ) {
      const c = this.casts[i]!;
      if (!c.caster.vitals.alive || statusModifiers(c.caster.runtime, now).silenced) {
        c.caster.castUntil = Math.min(c.caster.castUntil, now);
        this.casts.splice(i, 1);
      }
      else if (now >= c.at) {
        this.casts.splice(i, 1);
        this.resolveCast(c, now);
      } else i++;
    }
    if (this.projectiles.length) {
      const targets = this.targets();
      for (let i = 0; i < this.projectiles.length; ) {
        const p = this.projectiles[i]!;
        let hitHandle: number | undefined;
        const physics: RayCaster = { castRay: (origin, direction, max, groups) => {
          const hit = this.host.physics.castRay(origin, direction, max, groups);
          if (hit) hitHandle = hit.handle;
          return hit;
        } };
        const r = stepProjectile(physics, p, dt, targets, p.caster.index);
        if (r.kind === 'flying') {
          i++;
          continue;
        }
        this.projectiles.splice(i, 1);
        this.host.emit({ e: 'projEnd', id: p.id, at: mm(r.point), t: r.kind === 'player' ? r.target : r.kind === 'world' ? -1 : -2 });
        if (r.kind === 'world' && hitHandle !== undefined) this.damageBarrier(hitHandle, this.effectDamage(p.onHit));
        if (r.kind === 'expired') continue;
        // Nested areas centre slightly back along the flight so walls do not swallow their own impact.
        const sp = v3len(p.vel) || 1;
        const back = v3addScaled(r.point, p.vel, -0.2 / sp);
        const target = r.kind === 'player' ? this.actor(r.target) : undefined;
        const other = r.kind === 'player' && !target ? r.target : undefined;
        this.run(p.onHit, { caster: p.caster, def: p.def, now, target, other, center: back, push: v3scale(p.vel, 1 / sp), scale: 1 });
      }
    }
    // A damage callback may synchronously cancel a victim's areas or clear the engine on match end.
    // Iterate a snapshot and remove by identity so those callbacks cannot shift a finished area into another pulse.
    for (const a of [...this.areas]) {
      if (!this.areas.includes(a)) continue;
      if (a.effect.follow && !a.caster.vitals.alive) {
        this.areas.splice(this.areas.indexOf(a), 1);
        continue;
      }
      if (now < a.at) {
        continue;
      }
      if (a.effect.follow) a.center = { ...a.caster.state.pos };
      this.pulse(a, now);
      if (!this.areas.includes(a)) continue;
      a.pulse++;
      if (a.pulse >= a.effect.pulses) {
        this.areas.splice(this.areas.indexOf(a), 1);
        if (a.entity !== undefined) this.endEntity(a.entity);
      }
      else {
        a.at += a.effect.interval * 1000;
      }
    }
    this.updateEntities(now, dt);
    this.updateReconnaissance(now);
  }

  /** A player died or respawned: drop their wind-ups and the areas that follow them. Projectiles keep flying. */
  cancelFor(index: number): void {
    for (let i = this.casts.length - 1; i >= 0; i--) if (this.casts[i]!.caster.index === index) this.casts.splice(i, 1);
    for (let i = this.areas.length - 1; i >= 0; i--) if (this.areas[i]!.caster.index === index) this.areas.splice(i, 1);
    for (const entity of [...this.persistent.values()]) if (entity.caster.index === index) this.endEntity(entity.view.id);
    for (let i = this.tracking.length - 1; i >= 0; i--) if (this.tracking[i]!.caster.index === index || this.tracking[i]!.target.index === index) this.tracking.splice(i, 1);
    this.trails.delete(index);
    this.lastTrackedPositions.delete(index);
    this.activity.delete(index);
    const actor = this.actor(index);
    if (actor) { delete actor.state.abilityMovement; actor.frontShieldUntil = 0; }
  }

  /** Match start: nothing from the warmup carries over. */
  clear(): void {
    this.casts.length = 0;
    this.projectiles.length = 0;
    this.areas.length = 0;
    for (const entity of [...this.persistent.values()]) this.endEntity(entity.view.id);
    this.tracking.length = 0;
    this.trails.clear();
    this.lastTrackedPositions.clear();
    this.activity.clear();
    this.trailAt = -Infinity;
    for (const actor of this.host.actors()) { delete actor.state.abilityMovement; actor.frontShieldUntil = 0; }
  }

  // ------------------------------------------------------------------------------------------------ internals

  private targets(): PlayerHitTarget[] {
    const out: PlayerHitTarget[] = [];
    for (const a of this.host.actors()) out.push({ index: a.index, feet: a.state.pos, alive: a.vitals.alive });
    if (this.host.others) out.push(...this.host.others());
    return out;
  }

  private actor(index: number): AbilityActor | undefined {
    for (const a of this.host.actors()) if (a.index === index) return a;
    return undefined;
  }

  private validateEffects(caster: AbilityActor, def: AbilityDefinition, req: AbilityRequest, now: number): AbilityReject {
    for (const effect of def.effects) {
      if (effect.kind === 'mobility' || effect.kind === 'dash') {
        if (statusModifiers(caster.runtime, now).rooted || caster.state.swimming || caster.state.diving) return AbilityReject.BLOCKED;
        if (effect.kind === 'mobility') {
          if (effect.mode === 'jump' && (caster.state.grounded || caster.state.abilityJumpUsed)) return AbilityReject.BAD_TARGET;
          if (effect.mode === 'glide' && caster.state.grounded) return AbilityReject.BAD_TARGET;
          if (effect.mode === 'grapple' && !this.grappleAnchor(caster, req, effect.surfaceRange ?? def.range)) return AbilityReject.BAD_TARGET;
          if (effect.mode === 'ricochet' && !this.nearWall(caster, req, effect.surfaceRange ?? 1.8)) return AbilityReject.BAD_TARGET;
        }
      }
      if (effect.kind === 'barrier' && (!this.host.createBarrier || !this.planBarriers(caster, req.point ?? caster.state.pos, effect))) return AbilityReject.BAD_TARGET;
      if (effect.kind === 'portal') {
        if (!req.point) return AbilityReject.BAD_TARGET;
        if (surfaceDistance(caster.state.pos, req.point) > effect.range + 0.5) return AbilityReject.BAD_TARGET;
        if (!this.validStand(req.point, caster.index)) return AbilityReject.BAD_TARGET;
        const up = v3normalize(caster.state.pos);
        const facing = req.dir ?? v3normalize(v3projectOnPlane(subtract(req.point, caster.state.pos), up));
        const entry = this.surfacePoint(v3addScaled(caster.state.pos, facing, 1.6));
        if (!entry) return AbilityReject.BAD_TARGET;
        if (!this.validStand(entry, caster.index)) return AbilityReject.BAD_TARGET;
      }
    }
    return AbilityReject.OK;
  }

  private grappleAnchor(caster: AbilityActor, req: AbilityRequest, range: number): Vec3 | null {
    const dir = req.dir ?? caster.state.aim;
    const origin = castOrigin(caster.state.pos, dir);
    const hit = this.solidRay(origin, dir, range);
    if (!hit || hit.toi < 1 || hit.toi > range) return null;
    const up = v3normalize(caster.state.pos);
    return v3addScaled(v3addScaled(origin, dir, Math.max(0, hit.toi - 0.8)), up, -1.1);
  }

  private nearWall(caster: AbilityActor, req: AbilityRequest, range: number): Vec3 | null {
    if (!this.host.physics.castRayNormal) return null;
    const up = v3normalize(caster.state.pos);
    const front = v3normalize(v3projectOnPlane(req.dir ?? caster.state.facing, up));
    const side = v3normalize(v3cross(up, front));
    const origin = v3addScaled(caster.state.pos, up, 1);
    const directions = [front, v3scale(front, -1), side, v3scale(side, -1)];
    for (const direction of directions) {
      const hit = this.host.physics.castRayNormal(origin, direction, range, GROUPS_WORLD_QUERY);
      if (hit && Math.abs(v3dot(hit.normal, up)) < 0.7) return { ...hit.normal };
    }
    return null;
  }

  private surfacePoint(near: Vec3): Vec3 | null {
    const up = v3normalize(near);
    const origin = v3addScaled(near, up, 3);
    const down = v3scale(up, -1);
    const hit = this.solidRay(origin, down, 8);
    return hit ? v3addScaled(origin, down, Math.max(0, hit.toi - 0.01)) : null;
  }

  private validStand(feet: Vec3, ignore: number): boolean {
    if (!finite(feet) || v3len(feet) < 1) return false;
    const up = v3normalize(feet);
    const forward = v3normalize(v3projectOnPlane(Math.abs(up.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 }, up));
    const side = v3normalize(v3cross(up, forward));
    const center = v3addScaled(feet, up, 0.95);
    if (this.host.physics.boxOverlaps?.(center, { x: MOVEMENT.capsuleRadius, y: 0.8, z: MOVEMENT.capsuleRadius }, side, up, forward, groups(0xffff, Group.PROP | Group.BARRIER))) {
      return false;
    }
    for (const actor of this.host.actors()) {
      if (actor.index !== ignore && actor.vitals.alive && distance(actor.state.pos, feet) < 1) return false;
    }
    const down = this.solidRay(v3addScaled(feet, up, 0.4), v3scale(up, -1), 1);
    return !!down;
  }

  /** Surface/movement queries ignore opaque spell volumes, while line-of-sight and shots keep using castRay. */
  private solidRay(origin: Vec3, direction: Vec3, range: number): { toi: number; handle: number } | null {
    const physics = this.host.physics;
    const hit = physics.castRayNormal ? physics.castRayNormal(origin, direction, range, GROUPS_WORLD_QUERY) : physics.castRay(origin, direction, range, GROUPS_WORLD_QUERY);
    return hit && hit.handle >= 0 ? hit : null;
  }

  private planBarriers(caster: AbilityActor, base: Vec3, effect: Extract<AbilityEffect, { kind: 'barrier' }>): AbilityBarrierFrame[] | null {
    const frames: AbilityBarrierFrame[] = [];
    const up = v3normalize(base);
    let forward = v3projectOnPlane(subtract(base, caster.state.pos), up);
    if (v3len(forward) < 0.1) forward = v3projectOnPlane(caster.state.facing, up);
    v3normalize(forward, forward);
    const side = v3normalize(v3cross(up, forward));
    for (let index = 0; index < effect.count; index++) {
      const offset = (index - (effect.count - 1) / 2) * (effect.width + 0.8);
      let near = v3addScaled(base, side, offset);
      // A self-centred garden creates cover beside its owner instead of inside their capsule.
      if (distance(base, caster.state.pos) < 1) near = v3addScaled(near, forward, 2.2);
      const ground = this.surfacePoint(near);
      if (!ground || validateTargetPoint(this.host.physics, caster.state.pos, ground, Math.max(8, distance(caster.state.pos, base) + effect.width * effect.count)) !== AbilityReject.OK) return null;
      const frameUp = v3normalize(ground);
      const frameForward = v3normalize(v3projectOnPlane(forward, frameUp));
      const frameSide = v3normalize(v3cross(frameUp, frameForward));
      const center = v3addScaled(ground, frameUp, effect.height / 2 + 0.05);
      const frame: AbilityBarrierFrame = { center, up: frameUp, forward: frameForward, side: frameSide, width: effect.width, height: effect.height, depth: effect.depth };
      if (this.host.physics.boxOverlaps?.(center, { x: effect.width / 2, y: effect.height / 2 - 0.04, z: effect.depth / 2 }, frameSide, frameUp, frameForward, groups(0xffff, Group.PROP | Group.BARRIER))) return null;
      for (const actor of this.host.actors()) {
        if (!actor.vitals.alive) continue;
        const chest = v3addScaled(actor.state.pos, v3normalize(actor.state.pos), 1);
        const delta = subtract(chest, center);
        if (Math.abs(v3dot(delta, frameSide)) < effect.width / 2 + 0.55 && Math.abs(v3dot(delta, frameUp)) < effect.height / 2 + 0.85 && Math.abs(v3dot(delta, frameForward)) < effect.depth / 2 + 0.55) return null;
      }
      frames.push(frame);
    }
    return frames;
  }

  private spawnEntity(caster: AbilityActor, def: AbilityDefinition, kind: AbilityEntityView['kind'], center: Vec3, duration: number, now: number, view: Partial<AbilityEntityView> = {}): RuntimeEntity {
    const owned = [...this.persistent.values()].filter((entity) => entity.caster.index === caster.index);
    if (owned.length >= ABILITY_RULES.maxEntitiesPerCaster) this.endEntity(owned[0]!.view.id);
    if (this.persistent.size >= ABILITY_RULES.maxEntities) this.endEntity(this.persistent.keys().next().value!);
    const entity: RuntimeEntity = { caster, def, center: { ...center }, view: { id: this.nextId++, a: def.id, by: caster.index, kind, at: mm(center), endsAt: now + duration * 1000, ...view } };
    this.persistent.set(entity.view.id, entity);
    this.host.emit({ e: 'abilityEntity', entity: { ...entity.view } });
    return entity;
  }

  private endEntity(id: number): void {
    const entity = this.persistent.get(id);
    if (!entity) return;
    this.persistent.delete(id);
    entity.collider?.dispose();
    this.host.emit({ e: 'abilityEntityEnd', id });
    if (entity.view.link !== undefined) this.endEntity(entity.view.link);
  }

  private effectDamage(effects: readonly AbilityEffect[]): number {
    return effects.reduce((total, effect) => total + (effect.kind === 'damage' ? effect.amount : effect.kind === 'area' ? this.effectDamage(effect.effects) : 0), 0);
  }

  private updateEntities(now: number, dt: number): void {
    for (const entity of [...this.persistent.values()]) {
      if (!this.persistent.has(entity.view.id)) continue;
      if (now >= entity.view.endsAt || !entity.caster.vitals.alive || !this.actor(entity.caster.index)) {
        this.endEntity(entity.view.id);
        continue;
      }
      const effect = entity.effect;
      if (effect?.kind === 'trap') {
        const victims = areaVictims(this.host.physics, entity.center, effect.radius, 1, this.targets(), entity.caster.index);
        const victim = victims.map((v) => this.actor(v.index)).find((a) => a && this.host.canFight(a, now));
        if (victim) {
          this.run(effect.effects, { caster: entity.caster, def: entity.def, now, target: victim, center: entity.center, scale: 1 });
          this.host.emit({ e: 'area', by: entity.caster.index, a: entity.def.id, at: mm(entity.center), r: Math.round(effect.radius * 100), n: 0 });
          this.endEntity(entity.view.id);
        }
      } else if (effect?.kind === 'wave' && entity.direction) {
        const moved = Math.min(effect.distance - (entity.traveled ?? 0), effect.distance * Math.min(dt, 0.1) / Math.max(0.1, effect.duration));
        const oldUp = v3normalize(entity.center);
        const near = v3addScaled(entity.center, entity.direction, moved);
        const next = this.surfacePoint(near);
        if (!next) { this.endEntity(entity.view.id); continue; }
        const path = subtract(v3addScaled(next, v3normalize(next), 0.7), v3addScaled(entity.center, oldUp, 0.7));
        const length = v3len(path);
        if (length > 0 && this.solidRay(v3addScaled(entity.center, oldUp, 0.7), v3scale(path, 1 / length), length)) {
          this.endEntity(entity.view.id);
          continue;
        }
        entity.direction = transportTangent(entity.direction, oldUp, v3normalize(next));
        entity.center = next;
        entity.traveled = (entity.traveled ?? 0) + moved;
        for (const victim of areaVictims(this.host.physics, next, effect.width / 2, 1, this.targets(), entity.caster.index)) {
          if (entity.hits?.has(victim.index)) continue;
          const target = this.actor(victim.index);
          if (!target || !this.host.canFight(target, now)) continue;
          entity.hits?.add(target.index);
          applyKnockback(target.state, null, Math.min(ABILITY_RULES.maxKnockbackSpeed, effect.strength), effect.lift, entity.direction);
          this.host.emit({ e: 'fx', by: entity.caster.index, target: target.index, k: 'knock', v: Math.round(effect.strength * 10) });
        }
        entity.view.at = mm(next);
        entity.view.dir = dirTuple(entity.direction);
        if (now >= (entity.nextAt ?? 0)) {
          this.host.emit({ e: 'abilityEntity', entity: { ...entity.view } });
          entity.nextAt = now + 100;
        }
        if (entity.traveled >= effect.distance - 1e-3) this.endEntity(entity.view.id);
      } else if (effect?.kind === 'portal' && entity.exit) {
        const owner = entity.caster;
        if (now >= (entity.nextUseAt ?? 0) && distance(owner.state.pos, entity.center) <= ABILITY_RULES.portalRadius && this.validStand(entity.exit, owner.index)) {
          const oldUp = v3normalize(owner.state.pos);
          const newUp = v3normalize(entity.exit);
          const facing = transportTangent(owner.state.facing, oldUp, newUp);
          owner.state.pos = v3addScaled(entity.exit, newUp, 0.05);
          owner.state.facing = facing;
          owner.state.vel = { x: 0, y: 0, z: 0 };
          owner.state.dashSteps = 0;
          owner.state.grounded = false;
          delete owner.state.abilityMovement;
          this.host.teleport?.(owner, { ...owner.state.pos }, { ...facing });
          const nextAt = now + effect.reentry * 1000;
          entity.nextUseAt = nextAt;
          const pair = entity.view.link !== undefined ? this.persistent.get(entity.view.link) : undefined;
          if (pair) pair.nextUseAt = nextAt;
        }
      } else if (effect?.kind === 'reveal' && effect.mode === 'beacon' && now >= (entity.nextAt ?? 0)) {
        this.revealBearings(entity.caster, entity.def, entity.center, effect.radius, now, Math.min(1.5, effect.duration));
        entity.nextAt = now + (effect.interval ?? 1) * 1000;
      }
    }
  }

  private updateReconnaissance(now: number): void {
    if (now - this.trailAt >= ABILITY_RULES.trailSampleMs) {
      this.trailAt = now;
      const alive = new Set<number>();
      const perActor = Math.max(1, Math.min(Math.ceil(ABILITY_RULES.trailHistoryMs / ABILITY_RULES.trailSampleMs) + 1, Math.floor(ABILITY_RULES.maxTrailPoints / Math.max(1, [...this.host.actors()].length))));
      for (const actor of this.host.actors()) {
        if (!actor.vitals.alive) continue;
        alive.add(actor.index);
        let history = this.trails.get(actor.index) ?? [];
        const last = this.lastTrackedPositions.get(actor.index);
        if (!last) this.lastTrackedPositions.set(actor.index, { ...actor.state.pos });
        else if (distance(last, actor.state.pos) >= 0.2) {
          const pos = { ...actor.state.pos };
          history.push({ at: now, pos });
          this.lastTrackedPositions.set(actor.index, pos);
        }
        history = history.filter((point) => now - point.at <= ABILITY_RULES.trailHistoryMs).slice(-perActor);
        this.trails.set(actor.index, history);
      }
      for (const index of this.trails.keys()) if (!alive.has(index)) this.trails.delete(index);
      for (const index of this.lastTrackedPositions.keys()) if (!alive.has(index)) this.lastTrackedPositions.delete(index);
    }
    for (let index = this.tracking.length - 1; index >= 0; index--) {
      const reveal = this.tracking[index]!;
      if (now >= reveal.endsAt || !reveal.caster.vitals.alive || !reveal.target.vitals.alive || !this.actor(reveal.caster.index) || !this.actor(reveal.target.index)) {
        this.tracking.splice(index, 1);
        continue;
      }
      if (now >= reveal.nextAt) {
        this.host.sendPrivate?.(reveal.caster, { kind: 'enemy', by: reveal.caster.index, a: reveal.def.id, endsAt: reveal.endsAt, targets: [{ index: reveal.target.index, at: mm(reveal.target.state.pos) }] });
        reveal.nextAt = now + 250;
      }
    }
  }

  private revealBearings(caster: AbilityActor, def: AbilityDefinition, center: Vec3, radius: number, now: number, duration: number, recent?: number): void {
    const up = v3normalize(caster.state.pos);
    const forward = v3normalize(v3projectOnPlane(caster.state.facing, up));
    const side = v3normalize(v3cross(up, forward));
    const bearings: { direction: [number, number, number]; strength?: number }[] = [];
    for (const actor of this.host.actors()) {
      if (actor.index === caster.index || !actor.vitals.alive || !this.host.canFight(actor, now) || distance(actor.state.pos, center) > radius) continue;
      if (recent !== undefined && now - (this.activity.get(actor.index) ?? -Infinity) > recent * 1000) continue;
      const delta = v3projectOnPlane(subtract(actor.state.pos, caster.state.pos), up);
      const angle = Math.round(Math.atan2(v3dot(delta, side), v3dot(delta, forward)) / (Math.PI / 6)) * (Math.PI / 6);
      const direction = v3addScaled(v3scale(forward, Math.cos(angle)), side, Math.sin(angle));
      bearings.push({ direction: dirTuple(direction), strength: distance(actor.state.pos, center) < radius / 3 ? 3 : distance(actor.state.pos, center) < 2 * radius / 3 ? 2 : 1 });
    }
    this.host.sendPrivate?.(caster, { kind: 'bearing', by: caster.index, a: def.id, endsAt: now + duration * 1000, bearings });
  }

  private resolveCast(c: PendingCast, now: number): void {
    this.run(c.def.effects, { caster: c.caster, def: c.def, now, req: c.req, center: c.req.point, scale: 1 });
  }

  private pulse(a: PendingArea, now: number): void {
    const e = a.effect;
    this.host.emit({ e: 'area', by: a.caster.index, a: a.def.id, at: mm(a.center), r: Math.round(e.radius * 100), n: a.pulse });
    const targets = e.target === 'self' ? this.targets().filter((target) => target.index === a.caster.index) : this.targets();
    for (const v of areaVictims(this.host.physics, a.center, e.radius, e.edge, targets, e.target === 'self' || e.target === 'all' ? -1 : a.caster.index)) {
      const target = this.actor(v.index);
      if (!target) {
        if (this.host.damageOther) this.run(e.effects, { caster: a.caster, def: a.def, now, other: v.index, center: a.center, scale: v.scale });
        continue;
      }
      this.run(e.effects, { caster: a.caster, def: a.def, now, target, center: a.center, scale: v.scale });
    }
  }

  /** Runs one effect list in a context. Victim effects need a target; self effects apply to the caster. */
  private run(effects: AbilityEffect[], ctx: EffectContext): void {
    const { caster, def, now } = ctx;
    for (const e of effects) {
      switch (e.kind) {
        case 'damage':
          if (ctx.target && ctx.target.vitals.alive && this.host.canFight(ctx.target, now)) this.host.damage(caster, ctx.target, e.amount * ctx.scale, def.id, now);
          else if (!ctx.target && ctx.other !== undefined && this.host.canFight(caster, now)) this.host.damageOther?.(caster, ctx.other, e.amount * ctx.scale, def.id, now);
          break;
        case 'slow':
          if (ctx.target && ctx.target.vitals.alive && this.host.canFight(ctx.target, now)) {
            applySlow(ctx.target, e.factor, e.duration * 1000, now);
            ctx.target.runtime ??= newAbilityRuntime(now);
            const resistance = passiveModifiers(ctx.target.loadout, ctx.target.runtime.passive, now).statusResistance;
            applyStatus(ctx.target.runtime, 'slow', e.factor, e.duration, now, caster.index, resistance);
            this.host.emit({ e: 'fx', by: caster.index, target: ctx.target.index, k: 'slow', v: Math.round(e.duration * 1000) });
          }
          break;
        case 'temporaryShield': {
          const target = ctx.target ?? caster;
          const got = applyTemporaryShield(target.vitals, e.amount, e.duration, now);
          this.host.emit({ e: 'fx', by: caster.index, target: target.index, k: 'shield', v: got });
          break;
        }
        case 'status': {
          const target = ctx.target ?? caster;
          if (!target.vitals.alive || !this.host.canFight(target, now)) break;
          target.runtime ??= newAbilityRuntime(now);
          const resistance = passiveModifiers(target.loadout, target.runtime.passive, now).statusResistance;
          const applied = applyStatus(target.runtime, e.status, e.factor ?? 1, e.duration, now, caster.index, resistance);
          if (applied) {
            if (e.status === 'slow') {
              applySlow(target, e.factor ?? 1, e.duration * 1000, now);
              this.host.emit({ e: 'fx', by: caster.index, target: target.index, k: 'slow', v: Math.round(e.duration * 1000) });
            } else if (e.status === 'silence') {
              for (let i = this.casts.length - 1; i >= 0; i--) if (this.casts[i]!.caster.index === target.index) this.casts.splice(i, 1);
              target.castUntil = now;
            }
          }
          break;
        }
        case 'cleanse': {
          const target = ctx.target ?? caster;
          target.runtime ??= newAbilityRuntime(now);
          cleanseStatusEffects(target.runtime, e.statuses, now, e.resistance, e.duration);
          if (e.statuses.includes('slow')) { target.slowUntil = 0; target.slowFactor = 1; }
          this.host.emit({ e: 'fx', by: caster.index, target: target.index, k: 'heal', v: 0 });
          break;
        }
        case 'reveal': {
          if (e.mode === 'resources') this.host.sendPrivate?.(caster, {
            kind: 'loot', by: caster.index, a: def.id, endsAt: now + e.duration * 1000,
            targets: (this.host.resources?.() ?? []).filter((resource) => distance(resource.at, caster.state.pos) <= e.radius)
              .map((resource) => ({ id: resource.id, kind: resource.kind, at: mm(resource.at) })),
          });
          else if (e.mode === 'target' && ctx.target?.vitals.alive) {
            const target = ctx.target;
            const endsAt = now + e.duration * 1000;
            this.host.sendPrivate?.(caster, { kind: 'enemy', by: caster.index, a: def.id, endsAt, targets: [{ index: target.index, at: mm(target.state.pos) }] });
            const current = this.tracking.find((entry) => entry.caster === caster && entry.target === target && entry.def === def);
            if (current) current.endsAt = endsAt;
            else this.tracking.push({ caster, target, def, endsAt, nextAt: now + 250 });
          } else if (e.mode === 'trails') {
            const points: [number, number, number][] = [];
            for (const [index, history] of this.trails) {
              if (index === caster.index) continue;
              for (const point of history) if (now - point.at <= Math.min(e.history ?? 8, ABILITY_RULES.trailHistoryMs / 1000) * 1000 && distance(point.pos, caster.state.pos) <= e.radius) points.push(mm(point.pos));
            }
            this.host.sendPrivate?.(caster, { kind: 'trail', by: caster.index, a: def.id, endsAt: now + e.duration * 1000, points: points.slice(-ABILITY_RULES.maxTrailPoints) });
          } else if (e.mode === 'activity') this.revealBearings(caster, def, caster.state.pos, e.radius, now, e.duration, e.history ?? 8);
          else if (e.mode === 'beacon') {
            const center = ctx.center ?? caster.state.pos;
            const entity = this.spawnEntity(caster, def, 'beacon', center, e.duration, now, { radius: Math.round(e.radius * 100), health: e.health ?? 60, maxHealth: e.health ?? 60 });
            entity.effect = e;
            entity.nextAt = now;
          }
          break;
        }
        case 'frontShield':
          caster.frontShieldUntil = now + e.duration * 1000;
          caster.frontShieldArc = e.arc;
          this.host.emit({ e: 'fx', by: caster.index, target: caster.index, k: 'shield', v: 0 });
          break;
        case 'mobility': {
          const dir = ctx.req?.dir ?? caster.state.facing;
          const up = v3normalize(caster.state.pos);
          // Magic movement takes over any traversal (the glider folds; ledges and walls are let go of).
          releaseTraversal(caster.state, 0);
          if (e.mode === 'jump') {
            if (caster.state.grounded || caster.state.abilityJumpUsed) break;
            const along = v3dot(caster.state.vel, up);
            v3addScaled(caster.state.vel, up, (e.lift ?? MOVEMENT.airJumpSpeed) - along, caster.state.vel);
            caster.state.grounded = false;
            caster.state.airJumped = true;
            caster.state.abilityJumpUsed = true;
            caster.state.airTime = 1;
          } else if (e.mode === 'slide') this.host.dash(caster, dir, e.distance ?? 5, e.duration ?? 0.35, ctx.req?.cmdSeq ?? -1);
          else if (e.mode === 'ricochet') {
            const normal = this.nearWall(caster, ctx.req ?? { slot: 0, id: def.id, seq: 0, cmdSeq: -1 }, e.surfaceRange ?? 2);
            if (!normal) break;
            applyKnockback(caster.state, null, Math.min(ABILITY_RULES.maxKnockbackSpeed, e.speed ?? 14), e.lift ?? 6, normal);
          } else {
            const anchor = e.mode === 'grapple' ? this.grappleAnchor(caster, ctx.req ?? { slot: 0, id: def.id, seq: 0, cmdSeq: -1 }, e.surfaceRange ?? def.range) : null;
            if (e.mode === 'grapple' && !anchor) break;
            caster.state.dashSteps = 0;
            caster.state.abilityMovement = {
              mode: e.mode, remaining: e.duration ?? 1, speed: Math.min(ABILITY_RULES.maxKnockbackSpeed, e.speed ?? MOVEMENT.runSpeed),
              gravityFactor: e.gravityFactor ?? (e.mode === 'grapple' ? 0 : 0.2), airControl: e.airControl ?? 1,
              lift: e.lift ?? (e.mode === 'flight' ? 3 : 3.5),
              originHeight: v3len(caster.state.pos), ...(anchor ? { anchor } : {}),
            };
            if (e.mode === 'flight') { caster.state.grounded = false; caster.state.airTime = 1; }
          }
          this.host.emit({ e: 'fx', by: caster.index, target: caster.index, k: 'dash', v: Math.round((e.duration ?? 0.3) * 1000) });
          break;
        }
        case 'barrier': {
          const frames = this.planBarriers(caster, ctx.center ?? caster.state.pos, e);
          if (!frames || !this.host.createBarrier) break;
          for (const frame of frames) {
            const entity = this.spawnEntity(caster, def, 'barrier', frame.center, e.duration, now, {
              dir: dirTuple(frame.forward), size: [Math.round(e.width * 100), Math.round(e.height * 100), Math.round(e.depth * 100)], health: e.health, maxHealth: e.health,
            });
            entity.collider = this.host.createBarrier(entity.view, frame);
          }
          break;
        }
        case 'cloud': {
          const entity = this.spawnEntity(caster, def, 'cloud', ctx.center ?? caster.state.pos, e.duration, now, { radius: Math.round(e.radius * 100) });
          entity.effect = e;
          break;
        }
        case 'trap': {
          const entity = this.spawnEntity(caster, def, 'trap', ctx.center ?? caster.state.pos, e.duration, now, { radius: Math.round(e.radius * 100) });
          entity.effect = e;
          break;
        }
        case 'wave': {
          const direction = v3normalize(v3projectOnPlane(ctx.req?.dir ?? caster.state.facing, v3normalize(caster.state.pos)));
          const entity = this.spawnEntity(caster, def, 'wave', caster.state.pos, e.duration + 0.1, now, { radius: Math.round(e.width * 50), dir: dirTuple(direction) });
          entity.effect = e;
          entity.direction = direction;
          entity.traveled = 0;
          entity.hits = new Set();
          break;
        }
        case 'portal': {
          if (!ctx.req?.point || !this.validStand(ctx.req.point, caster.index)) break;
          const up = v3normalize(caster.state.pos);
          const facing = ctx.req.dir ?? v3normalize(v3projectOnPlane(subtract(ctx.req.point, caster.state.pos), up));
          const entry = this.surfacePoint(v3addScaled(caster.state.pos, facing, 1.6));
          if (!entry || !this.validStand(entry, caster.index)) break;
          const exitId = this.nextId + 1;
          const source = this.spawnEntity(caster, def, 'portal', entry, e.duration, now, { radius: Math.round(ABILITY_RULES.portalRadius * 100), dir: dirTuple(facing), link: exitId });
          const exit = this.spawnEntity(caster, def, 'portal', ctx.req.point, e.duration, now, { radius: Math.round(ABILITY_RULES.portalRadius * 100), dir: dirTuple(transportTangent(facing, v3normalize(entry), v3normalize(ctx.req.point))), link: source.view.id });
          source.effect = exit.effect = e;
          source.exit = { ...ctx.req.point };
          exit.exit = { ...entry };
          source.nextUseAt = exit.nextUseAt = now + 350;
          break;
        }
        case 'knockback':
          if (ctx.target && ctx.target.vitals.alive && this.host.canFight(ctx.target, now)) {
            applyKnockback(ctx.target.state, ctx.push ? null : (ctx.center ?? caster.state.pos), Math.min(ABILITY_RULES.maxKnockbackSpeed, e.strength), e.lift, ctx.push);
            this.host.emit({ e: 'fx', by: caster.index, target: ctx.target.index, k: 'knock', v: Math.round(e.strength * 10) });
          }
          break;
        case 'shield': {
          const t = ctx.target ?? caster;
          const got = applyShield(t.vitals, e.amount);
          this.host.emit({ e: 'fx', by: caster.index, target: t.index, k: 'shield', v: got });
          break;
        }
        case 'heal': {
          const t = ctx.target ?? caster;
          const got = applyHeal(t.vitals, e.amount);
          this.host.emit({ e: 'fx', by: caster.index, target: t.index, k: 'heal', v: got });
          break;
        }
        case 'dash':
          if (ctx.req?.dir) {
            this.host.dash(caster, ctx.req.dir, e.distance, e.duration, ctx.req.cmdSeq);
            this.host.emit({ e: 'fx', by: caster.index, target: caster.index, k: 'dash', v: Math.round(e.duration * 1000) });
          }
          break;
        case 'projectile': {
          const dir = ctx.req?.dir;
          if (!dir) break;
          const from = castOrigin(caster.state.pos, dir);
          const vel = v3scale(v3normalize(dir), e.speed);
          const p: FlyingProjectile = { id: this.nextId++, caster, def, onHit: e.onHit, pos: from, vel, gravity: e.gravity, radius: e.radius, life: e.lifetime };
          this.projectiles.push(p);
          this.host.emit({
            e: 'proj',
            id: p.id,
            by: caster.index,
            a: def.id,
            s: ctx.req?.seq ?? -1,
            from: mm(from),
            v: [Math.round(vel.x * VEL_SCALE), Math.round(vel.y * VEL_SCALE), Math.round(vel.z * VEL_SCALE)],
          });
          break;
        }
        case 'area': {
          const center = e.follow ? { ...caster.state.pos } : ctx.center ? { ...ctx.center } : { ...caster.state.pos };
          const area: PendingArea = { caster, def, effect: e, center, at: now + e.delay * 1000, pulse: 0 };
          if (e.pulses > 1) {
            const entity = this.spawnEntity(caster, def, e.target === 'self' ? 'garden' : 'cloud', center, Math.max(0.1, e.delay + (e.pulses - 1) * e.interval + 0.1), now, { radius: Math.round(e.radius * 100) });
            area.entity = entity.view.id;
          }
          if (e.delay <= 0 && e.pulses <= 1) this.pulse(area, now);
          else this.areas.push(area);
          break;
        }
      }
    }
  }
}
