/**
 * GRAAbilitySystem: executes ability definitions on the authoritative server. Not a GAS port: an AbilityDefinition
 * is plain data (`@graao/game-data`) whose `effects` are composed from the primitives in abilities.ts; this class
 * validates requests, commits Mana/cooldowns, runs wind-ups, simulates projectiles and resolves areas over time.
 *
 * The room provides an AbilityHost (players, physics, phase rule, damage/elimination bookkeeping, dash scheduling on
 * the movement stream, event sink), so the whole system runs in unit tests with a fake host.
 */
import { ABILITIES, type AbilityDefinition, type AbilityEffect, type AbilityId, type Loadout } from '@graao/game-data';
import { AbilityReject, POS_SCALE, VEL_SCALE, v3addScaled, v3len, v3normalize, v3scale, type GameEvent, type Vec3 } from '@graao/shared';
import type { CharacterState } from './character';
import type { PlayerHitTarget, Vitals } from './combat';
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
}

export interface AbilityHost {
  physics: RayCaster;
  actors(): Iterable<AbilityActor>;
  /** The match-phase rule shared with weapons (countdown, results, spectators). */
  canFight(a: AbilityActor, now: number): boolean;
  /** Shield-then-Health damage from an ability, with dmg/elim events and match bookkeeping. */
  damage(by: AbilityActor, target: AbilityActor, amount: number, ability: AbilityId, now: number): void;
  /** Starts a dash exactly at movement command `cmdSeq` (client prediction does the same). */
  dash(a: AbilityActor, dir: Vec3, distance: number, duration: number, cmdSeq: number): void;
  emit(e: GameEvent): void;
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
}

interface EffectContext {
  caster: AbilityActor;
  def: AbilityDefinition;
  now: number;
  req?: AbilityRequest;
  /** Victim of a projectile hit or an area pulse. */
  target?: AbilityActor;
  /** Area centre / impact point (knockback source, nested areas). */
  center?: Vec3;
  /** Knockback direction for direct hits (the projectile's flight). */
  push?: Vec3;
  /** Damage scale (area falloff). */
  scale: number;
}

const mm = (v: Vec3): [number, number, number] => [Math.round(v.x * POS_SCALE), Math.round(v.y * POS_SCALE), Math.round(v.z * POS_SCALE)];

export class GRAAbilitySystem {
  private readonly casts: PendingCast[] = [];
  private readonly projectiles: FlyingProjectile[] = [];
  private readonly areas: PendingArea[] = [];
  private nextId = 1;

  constructor(private readonly host: AbilityHost) {}

  /** Live projectiles (tests, F3). */
  get projectileCount(): number {
    return this.projectiles.length;
  }

  get pendingCount(): number {
    return this.casts.length + this.areas.length;
  }

  /** Validates and, when accepted, commits a cast. Returns the reason (OK = accepted). */
  request(caster: AbilityActor, req: AbilityRequest, now: number): AbilityReject {
    const reason = checkCast(
      { alive: caster.vitals.alive, canFight: this.host.canFight(caster, now), mana: caster.vitals.mana, loadout: caster.loadout, cooldownEnds: caster.cooldownEnds, castUntil: caster.castUntil },
      req.slot,
      req.id,
      now,
    );
    if (reason !== AbilityReject.OK) return reason;
    const def = ABILITIES[req.id as AbilityId];
    // Target checks.
    if (def.targetType === 'direction') {
      if (!req.dir || Math.abs(v3len(req.dir) - 1) > 0.05) return AbilityReject.BAD_TARGET;
    } else if (def.targetType === 'point') {
      if (!req.point) return AbilityReject.BAD_TARGET;
      const r = validateTargetPoint(this.host.physics, caster.state.pos, req.point, def.range);
      if (r !== AbilityReject.OK) return r;
    }
    const until = spendCast(caster, req.slot, def, now);
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
    for (let i = 0; i < this.casts.length; ) {
      const c = this.casts[i]!;
      if (!c.caster.vitals.alive) this.casts.splice(i, 1);
      else if (now >= c.at) {
        this.casts.splice(i, 1);
        this.resolveCast(c, now);
      } else i++;
    }
    if (this.projectiles.length) {
      const targets = this.targets();
      for (let i = 0; i < this.projectiles.length; ) {
        const p = this.projectiles[i]!;
        const r = stepProjectile(this.host.physics, p, dt, targets, p.caster.index);
        if (r.kind === 'flying') {
          i++;
          continue;
        }
        this.projectiles.splice(i, 1);
        this.host.emit({ e: 'projEnd', id: p.id, at: mm(r.point), t: r.kind === 'player' ? r.target : r.kind === 'world' ? -1 : -2 });
        if (r.kind === 'expired') continue;
        // Nested areas centre slightly back along the flight so walls do not swallow their own impact.
        const sp = v3len(p.vel) || 1;
        const back = v3addScaled(r.point, p.vel, -0.2 / sp);
        const target = r.kind === 'player' ? this.actor(r.target) : undefined;
        this.run(p.onHit, { caster: p.caster, def: p.def, now, target, center: back, push: v3scale(p.vel, 1 / sp), scale: 1 });
      }
    }
    for (let i = 0; i < this.areas.length; ) {
      const a = this.areas[i]!;
      if (a.effect.follow && !a.caster.vitals.alive) {
        this.areas.splice(i, 1);
        continue;
      }
      if (now < a.at) {
        i++;
        continue;
      }
      if (a.effect.follow) a.center = { ...a.caster.state.pos };
      this.pulse(a, now);
      a.pulse++;
      if (a.pulse >= a.effect.pulses) this.areas.splice(i, 1);
      else {
        a.at += a.effect.interval * 1000;
        i++;
      }
    }
  }

  /** A player died or respawned: drop their wind-ups and the areas that follow them. Projectiles keep flying. */
  cancelFor(index: number): void {
    for (let i = this.casts.length - 1; i >= 0; i--) if (this.casts[i]!.caster.index === index) this.casts.splice(i, 1);
    for (let i = this.areas.length - 1; i >= 0; i--) if (this.areas[i]!.caster.index === index && this.areas[i]!.effect.follow) this.areas.splice(i, 1);
  }

  /** Match start: nothing from the warmup carries over. */
  clear(): void {
    this.casts.length = 0;
    this.projectiles.length = 0;
    this.areas.length = 0;
  }

  // ------------------------------------------------------------------------------------------------ internals

  private targets(): PlayerHitTarget[] {
    const out: PlayerHitTarget[] = [];
    for (const a of this.host.actors()) out.push({ index: a.index, feet: a.state.pos, alive: a.vitals.alive });
    return out;
  }

  private actor(index: number): AbilityActor | undefined {
    for (const a of this.host.actors()) if (a.index === index) return a;
    return undefined;
  }

  private resolveCast(c: PendingCast, now: number): void {
    this.run(c.def.effects, { caster: c.caster, def: c.def, now, req: c.req, center: c.req.point, scale: 1 });
  }

  private pulse(a: PendingArea, now: number): void {
    const e = a.effect;
    this.host.emit({ e: 'area', by: a.caster.index, a: a.def.id, at: mm(a.center), r: Math.round(e.radius * 100), n: a.pulse });
    for (const v of areaVictims(this.host.physics, a.center, e.radius, e.edge, this.targets(), a.caster.index)) {
      const target = this.actor(v.index);
      if (!target) continue;
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
          break;
        case 'slow':
          if (ctx.target && ctx.target.vitals.alive && this.host.canFight(ctx.target, now)) {
            applySlow(ctx.target, e.factor, e.duration * 1000, now);
            this.host.emit({ e: 'fx', by: caster.index, target: ctx.target.index, k: 'slow', v: Math.round(e.duration * 1000) });
          }
          break;
        case 'knockback':
          if (ctx.target && ctx.target.vitals.alive && this.host.canFight(ctx.target, now)) {
            applyKnockback(ctx.target.state, ctx.push ? null : (ctx.center ?? caster.state.pos), e.strength, e.lift, ctx.push);
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
          if (e.delay <= 0 && e.pulses <= 1) this.pulse(area, now);
          else this.areas.push(area);
          break;
        }
      }
    }
  }
}
