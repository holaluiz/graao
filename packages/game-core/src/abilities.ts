/**
 * Ability rules shared by the server (authoritative) and the client (mirror for prediction and presentation only):
 * Mana, cooldowns, cast validation, loadouts, target points, and the pure effect primitives the GRAAbilitySystem
 * composes (Damage, Projectile, Area, Dash [see `startDash` in character.ts], Shield, Heal, Slow, Knockback).
 */
import {
  ABILITIES,
  ABILITY_RULES,
  ATTRIBUTES,
  DEFAULT_LOADOUTS,
  LOADOUT_SLOTS,
  ULTIMATE_SLOT,
  isAbilityId,
  type AbilityDefinition,
  type AbilityId,
  type Loadout,
} from '@graao/game-data';
import {
  AbilityReject,
  HitKind,
  v3,
  v3addScaled,
  v3dot,
  v3len,
  v3normalize,
  v3projectOnPlane,
  v3set,
  type Vec3,
} from '@graao/shared';
import type { CharacterState } from './character';
import { applyDamage, castAimRay, HITBOX, rayPlayers, type DamageResult, type PlayerHitTarget, type Vitals } from './combat';
import { GROUPS_WORLD_QUERY, type GamePhysics } from './physics';
import { releaseTraversal } from './traversal';

/** The part of GamePhysics ability rules need (lets unit tests pass a fake world). */
export type RayCaster = Pick<GamePhysics, 'castRay'> & Partial<Pick<GamePhysics, 'castRayNormal'>>;

// ------------------------------------------------------------------------------------------------ mana

/** Regenerates Mana while alive, capped at the maximum. Mana is fractional on the server; players see the floor. */
export function regenMana(v: Vitals, dt: number, rate: number = ABILITY_RULES.manaRegen): void {
  if (!v.alive || dt <= 0) return;
  v.mana = Math.min(v.maxMana ?? ATTRIBUTES.maxMana, v.mana + rate * (v.manaRegen ?? 1) * dt);
}

/** What the HUD and the network show (integer); the same number the cost check effectively compares against. */
export const manaShown = (v: Pick<Vitals, 'mana'>): number => Math.floor(v.mana + 1e-6);

// ------------------------------------------------------------------------------------------------ loadouts

/** A valid loadout: three different basics on keys 1–3 and one Ultimate on key 4. */
export function validateLoadout(ids: unknown): Loadout | null {
  if (!Array.isArray(ids) || ids.length !== LOADOUT_SLOTS) return null;
  if (!ids.every(isAbilityId)) return null;
  const l = ids as AbilityId[];
  for (let i = 0; i < LOADOUT_SLOTS; i++) {
    const want = i === ULTIMATE_SLOT ? 'ultimate' : 'basic';
    if (ABILITIES[l[i]!].slotType !== want) return null;
  }
  if (new Set(l).size !== LOADOUT_SLOTS) return null;
  if (l.filter((id) => ABILITIES[id].kind === 'passive').length > ABILITY_RULES.maxPassives) return null;
  return [...l] as Loadout;
}

export const defaultLoadout = (playerIndex: number): Loadout => [...DEFAULT_LOADOUTS[playerIndex % DEFAULT_LOADOUTS.length]!] as Loadout;

// ------------------------------------------------------------------------------------------------ cooldowns & validation

export interface CastState {
  alive: boolean;
  /** Phase allows fighting (the room's `canFight`: not in countdown or results, taking part in the match). */
  canFight: boolean;
  mana: number;
  loadout: readonly string[];
  /** Server time when each slot's cooldown ends (0 or past = ready). */
  cooldownEnds: readonly number[];
  /** Server time when the current wind-up ends. */
  castUntil: number;
  silenced?: boolean;
  blocked?: boolean;
}

/**
 * The server's eligibility check, in a fixed order: alive → owns the ability in that slot → phase → not winding up
 * another cast → cooldown → Mana. Target checks (range, line of sight) come after, in `validateTargetPoint`.
 */
export function checkCast(c: CastState, slot: number, abilityId: string, now: number): AbilityReject {
  if (!c.alive) return AbilityReject.DEAD;
  if (slot < 0 || slot >= LOADOUT_SLOTS || c.loadout[slot] !== abilityId || !isAbilityId(abilityId)) return AbilityReject.NOT_OWNED;
  if (!c.canFight) return AbilityReject.PHASE;
  if (ABILITIES[abilityId].kind === 'passive') return AbilityReject.PASSIVE;
  const canCleanseSilence = ABILITIES[abilityId].effects.some((effect) => effect.kind === 'cleanse' && effect.statuses.includes('silence'));
  if (c.silenced && !canCleanseSilence) return AbilityReject.SILENCED;
  if (c.blocked) return AbilityReject.BLOCKED;
  if (now < c.castUntil) return AbilityReject.BUSY;
  if (now < (c.cooldownEnds[slot] ?? 0)) return AbilityReject.COOLDOWN;
  if (c.mana + 1e-6 < ABILITIES[abilityId].manaCost) return AbilityReject.NO_MANA;
  return AbilityReject.OK;
}

/** Commits an accepted cast: spends Mana, starts the cooldown and the wind-up. Returns when the wind-up ends. */
export function spendCast(c: { vitals: Vitals; cooldownEnds: number[]; castUntil: number }, slot: number, def: AbilityDefinition, now: number): number {
  c.vitals.mana = Math.max(0, c.vitals.mana - def.manaCost);
  c.cooldownEnds[slot] = now + def.cooldown * 1000;
  c.castUntil = now + def.castTime * 1000;
  return c.castUntil;
}

/** Fresh life or match: basics ready, the Ultimate charging for `ultimateChargeMs`. */
export function resetCooldowns(cooldownEnds: number[], now: number, ultimateChargeMs: number = ABILITY_RULES.ultimateInitialCharge * 1000): void {
  for (let i = 0; i < LOADOUT_SLOTS; i++) cooldownEnds[i] = i === ULTIMATE_SLOT ? now + ultimateChargeMs : 0;
}

/** Seconds of cooldown left for a slot (0 = ready). */
export const cooldownLeft = (cooldownEnds: readonly number[], slot: number, now: number): number => Math.max(0, ((cooldownEnds[slot] ?? 0) - now) / 1000);

// ------------------------------------------------------------------------------------------------ targets

/** Where projectiles leave the caster: chest height, a little forward along the aim. */
export function castOrigin(feet: Vec3, aimDir: Vec3, out: Vec3 = v3()): Vec3 {
  const up = v3normalize(feet);
  const flat = v3projectOnPlane(aimDir, up);
  const l = v3len(flat);
  const fx = l > 1e-4 ? flat.x / l : 0, fy = l > 1e-4 ? flat.y / l : 0, fz = l > 1e-4 ? flat.z / l : 0;
  return v3set(out, feet.x + up.x * 1.35 + fx * 0.45, feet.y + up.y * 1.35 + fy * 0.45, feet.z + up.z * 1.35 + fz * 0.45);
}

/** Head point used for line-of-sight checks. */
const headOf = (feet: Vec3): Vec3 => v3addScaled(feet, v3normalize(feet), 1.6);

/** Heights above a point target that count as "seeing" it: the space an area fills, not only the ground. */
const SIGHT_HEIGHTS = [0.4, 1.2, 2.0];

/**
 * Line of sight from the caster's head to the space above a point (any of `SIGHT_HEIGHTS` visible = clear), so a
 * knee-high fence or a bump in the ground does not hide a player's feet. Returns the lowest blocked line when all are
 * blocked, else null. Server validation and client targeting use exactly this test.
 */
function sightBlock(physics: RayCaster, feet: Vec3, point: Vec3): { d: Vec3; toi: number } | null {
  const head = headOf(feet);
  const up = v3normalize(point);
  let first: { d: Vec3; toi: number } | null = null;
  for (const h of SIGHT_HEIGHTS) {
    const aim = v3addScaled(point, up, h);
    const dx = aim.x - head.x, dy = aim.y - head.y, dz = aim.z - head.z;
    const len = Math.hypot(dx, dy, dz);
    if (len <= 0.3) return null;
    const d = { x: dx / len, y: dy / len, z: dz / len };
    const hit = physics.castRay(head, d, len - 0.3, GROUPS_WORLD_QUERY);
    if (!hit) return null;
    first ??= { d, toi: hit.toi };
  }
  return first;
}

/** Straight-line range from the caster's feet; this slack absorbs prediction differences between client and server. */
const RANGE_SLACK = 1.0;

/**
 * Server check of a point target: within range, on (or very near) a surface, and visible from the caster's head.
 */
export function validateTargetPoint(physics: RayCaster, feet: Vec3, point: Vec3, range: number): AbilityReject {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) return AbilityReject.BAD_TARGET;
  const d = Math.hypot(point.x - feet.x, point.y - feet.y, point.z - feet.z);
  if (d > range + RANGE_SLACK) return AbilityReject.OUT_OF_RANGE;
  // On a surface: a short ray down along local up must find ground or a prop just below the point.
  const up = v3normalize(point);
  const above = v3addScaled(point, up, 1.0);
  // Visibility volumes can stop castRay without being a physical surface (chalk clouds, for example).
  const down = physics.castRayNormal
    ? physics.castRayNormal(above, { x: -up.x, y: -up.y, z: -up.z }, 2.6, GROUPS_WORLD_QUERY)
    : physics.castRay(above, { x: -up.x, y: -up.y, z: -up.z }, 2.6, GROUPS_WORLD_QUERY);
  if (!down) return AbilityReject.BAD_TARGET;
  if (sightBlock(physics, feet, point)) return AbilityReject.BLOCKED;
  return AbilityReject.OK;
}

/**
 * Client: turns the camera ray into a point that `validateTargetPoint` accepts. Aims where the camera looks; too far
 * → the same heading clamped to range; behind a wall → the spot in front of the wall.
 */
export function resolveTargetPoint(physics: RayCaster, terrain: { surfaceAt(dir: Vec3, out?: Vec3): Vec3 }, feet: Vec3, camOrigin: Vec3, camDir: Vec3, range: number): Vec3 {
  const reach = range + 12;
  // From level with the caster's head on: the shoulder camera may sit inside or behind a wall.
  const hit = castAimRay(physics, camOrigin, camDir, reach, headOf(feet), GROUPS_WORLD_QUERY);
  const dist = (q: Vec3) => Math.hypot(q.x - feet.x, q.y - feet.y, q.z - feet.z);
  // Where the camera looks, backed off the surface a little and dropped onto whatever is below (walls → their foot).
  let p = hit ? groundBelow(physics, terrain, v3addScaled(camOrigin, camDir, Math.max(0, hit.toi - 0.4)), 0.4) : null;
  if (!p || dist(p) > range) {
    // Too far or the sky: the same heading on the ground plane, clamped to range.
    const up = v3normalize(feet);
    const aimAt = v3addScaled(camOrigin, camDir, hit ? hit.toi : reach);
    let to = v3projectOnPlane({ x: aimAt.x - feet.x, y: aimAt.y - feet.y, z: aimAt.z - feet.z }, up);
    if (v3len(to) < 1e-3) to = v3projectOnPlane(camDir, up);
    v3normalize(to, to);
    p = groundBelow(physics, terrain, v3addScaled(feet, to, Math.max(0.5, range - 0.75)), 2.0);
  }
  // Line of sight: stop in front of whatever blocks the view from the head (a few tries, then right in front).
  const head = headOf(feet);
  for (let i = 0; i < 4; i++) {
    const block = sightBlock(physics, feet, p);
    if (!block) return p;
    p = groundBelow(physics, terrain, v3addScaled(head, block.d, Math.max(0, block.toi - 0.6 - i * 0.8)), 0.3);
  }
  if (!sightBlock(physics, feet, p)) return p;
  const up = v3normalize(feet);
  let f = v3projectOnPlane(camDir, up);
  if (v3len(f) < 1e-3) f = { x: 1, y: 0, z: 0 };
  v3normalize(f, f);
  return groundBelow(physics, terrain, v3addScaled(feet, f, 1.0), 0.6);
}

/** The surface under `p` (props included, searching from `lift` m above it), else the terrain. */
function groundBelow(physics: RayCaster, terrain: { surfaceAt(dir: Vec3, out?: Vec3): Vec3 }, p: Vec3, lift: number): Vec3 {
  const up = v3normalize(p);
  const from = v3addScaled(p, up, lift);
  const down = { x: -up.x, y: -up.y, z: -up.z };
  const hit = physics.castRayNormal ? physics.castRayNormal(from, down, lift + 8, GROUPS_WORLD_QUERY) : physics.castRay(from, down, lift + 8, GROUPS_WORLD_QUERY);
  return hit ? v3addScaled(from, down, hit.toi) : terrain.surfaceAt(up);
}

// ------------------------------------------------------------------------------------------------ primitives

/** Damage primitive: Shield first, then Health (same rules as weapons), tagged ABILITY for the hit taxonomy. */
export function applyAbilityDamage(v: Vitals, amount: number): DamageResult {
  const r = applyDamage(v, amount, false);
  if (r.kinds.length) r.kinds.splice(r.kinds.includes(HitKind.ELIMINATION) ? r.kinds.length - 1 : r.kinds.length, 0, HitKind.ABILITY);
  return r;
}

/** Shield primitive: restores up to the maximum; returns how much was restored. Nothing on the eliminated. */
export function applyShield(v: Vitals, amount: number): number {
  if (!v.alive) return 0;
  const before = v.shield;
  v.shield = Math.min(ATTRIBUTES.maxShield, v.shield + Math.round(amount));
  return v.shield - before;
}

/** Heal primitive: restores Health up to the maximum; returns how much was restored. */
export function applyHeal(v: Vitals, amount: number): number {
  if (!v.alive) return 0;
  const before = v.health;
  v.health = Math.min(v.maxHealth ?? ATTRIBUTES.maxHealth, v.health + Math.round(amount));
  return v.health - before;
}

export interface SlowStatus {
  /** Server time when the slow ends. */
  slowUntil: number;
  /** Speed factor while slowed (0..1). */
  slowFactor: number;
}

/**
 * Slow primitive. A stronger slow replaces a weaker one; an equal or weaker one only extends the time when it would
 * last longer (and never weakens the current factor).
 */
export function applySlow(t: SlowStatus, factor: number, durationMs: number, now: number): void {
  const f = Math.max(0.1, Math.min(1, factor));
  const until = now + durationMs;
  const active = now < t.slowUntil;
  if (!active || f < t.slowFactor) {
    t.slowFactor = f;
    t.slowUntil = active ? Math.max(t.slowUntil, until) : until;
  } else t.slowUntil = Math.max(t.slowUntil, until);
}

/** The speed multiplier in effect at `now`. */
export const currentSlow = (t: SlowStatus, now: number): number => (now < t.slowUntil ? t.slowFactor : 1);

/**
 * Knockback primitive: pushes `s` away from `from` along its ground plane (or along `dir` when given) and lifts it.
 * Ungrounds the character so the controller lets it fly; the impulse replaces velocity along the push.
 */
export function applyKnockback(s: CharacterState, from: Vec3 | null, strength: number, lift: number, dir?: Vec3): void {
  const up = v3normalize(s.pos);
  let push = dir ? v3projectOnPlane(dir, up) : from ? v3projectOnPlane({ x: s.pos.x - from.x, y: s.pos.y - from.y, z: s.pos.z - from.z }, up) : v3();
  if (v3len(push) < 1e-3) push = { x: -s.facing.x, y: -s.facing.y, z: -s.facing.z };
  v3normalize(push, push);
  // Keep sideways motion, replace the component along the push, then add the lift.
  const along = v3dot(s.vel, push);
  const vUp = v3dot(s.vel, up);
  const keep = { x: s.vel.x - push.x * along - up.x * vUp, y: s.vel.y - push.y * along - up.y * vUp, z: s.vel.z - push.z * along - up.z * vUp };
  const newUp = Math.max(vUp, 0) + lift;
  v3set(s.vel, keep.x + push.x * strength + up.x * newUp, keep.y + push.y * strength + up.y * newUp, keep.z + push.z * strength + up.z * newUp);
  s.dashSteps = 0;
  // A push tears the character off a ledge or a wall and folds the glider (the regrab cooldown leaves a moment to react).
  releaseTraversal(s);
  if (lift > 0) {
    s.grounded = false;
    s.airTime = 1;
  }
}

/** Chest point of a character standing at `feet` (area checks). */
export const chestOf = (feet: Vec3, out: Vec3 = v3()): Vec3 => v3addScaled(feet, v3normalize(feet), 1.0, out);

export interface AreaVictim {
  index: number;
  /** Damage scale from the centre (1) to the rim (`edge`). */
  scale: number;
}

/**
 * Area primitive: everyone (but `ignore`) whose chest is within `radius` of `center` (plus body radius) and not
 * behind a wall seen from just above the centre. Damage scales linearly from 1 at the centre to `edge` at the rim.
 */
export function areaVictims(physics: RayCaster, center: Vec3, radius: number, edge: number, players: PlayerHitTarget[], ignore: number): AreaVictim[] {
  const out: AreaVictim[] = [];
  const up = v3normalize(center);
  const eye = v3addScaled(center, up, 0.6);
  for (const p of players) {
    if (p.index === ignore || !p.alive) continue;
    const chest = chestOf(p.feet);
    const d = Math.hypot(chest.x - center.x, chest.y - center.y, chest.z - center.z);
    // Chest-to-centre distance for a target standing on the centre is ~1 m: measure from the body axis instead.
    const feetD = Math.hypot(p.feet.x - center.x, p.feet.y - center.y, p.feet.z - center.z);
    const dist = Math.min(d, feetD);
    if (dist > radius + HITBOX.bodyRadius) continue;
    const dx = chest.x - eye.x, dy = chest.y - eye.y, dz = chest.z - eye.z;
    const len = Math.hypot(dx, dy, dz);
    if (len > 0.4) {
      const hit = physics.castRay(eye, { x: dx / len, y: dy / len, z: dz / len }, len - 0.35, GROUPS_WORLD_QUERY);
      if (hit) continue;
    }
    const t = Math.min(1, Math.max(0, dist / Math.max(radius, 1e-3)));
    out.push({ index: p.index, scale: 1 + (edge - 1) * t });
  }
  return out;
}

export interface ProjectileBody {
  pos: Vec3;
  vel: Vec3;
  /** Radial gravity (m/s² toward the planet centre). */
  gravity: number;
  radius: number;
  /** Seconds left before it fizzles. */
  life: number;
}

export type ProjectileStep =
  | { kind: 'flying' }
  | { kind: 'player'; point: Vec3; target: number }
  | { kind: 'world'; point: Vec3 }
  | { kind: 'expired'; point: Vec3 };

/** Max sub-step for projectile integration (s): a 70 m/s lance moves ≤ 1.2 m per sub-step. */
export const PROJECTILE_SUBSTEP = 1 / 60;

/** Kinematics only (shared with the client's visual replay): radial gravity, then move. */
export function integrateProjectile(p: ProjectileBody, dt: number): void {
  if (p.gravity) {
    const up = v3normalize(p.pos);
    v3addScaled(p.vel, up, -p.gravity * dt, p.vel);
  }
  v3addScaled(p.pos, p.vel, dt, p.pos);
}

/**
 * Projectile primitive: advances `p` by `dt` in sub-steps, sweeping its sphere against the world (Rapier ray) and
 * players (inflated hitboxes), never the owner. Stops at the first contact.
 */
export function stepProjectile(physics: RayCaster | null, p: ProjectileBody, dt: number, players: PlayerHitTarget[], owner: number): ProjectileStep {
  let left = dt;
  while (left > 1e-9) {
    const h = Math.min(PROJECTILE_SUBSTEP, left);
    left -= h;
    if (p.gravity) {
      const up = v3normalize(p.pos);
      v3addScaled(p.vel, up, -p.gravity * h, p.vel);
    }
    const sp = v3len(p.vel);
    const len = sp * h;
    if (len > 1e-6) {
      const d = { x: p.vel.x / sp, y: p.vel.y / sp, z: p.vel.z / sp };
      const world = physics ? physics.castRay(p.pos, d, len, GROUPS_WORLD_QUERY) : null;
      const tw = world ? world.toi : len;
      const hp = rayPlayers(p.pos, d, tw, players, owner, p.radius);
      if (hp) {
        v3addScaled(p.pos, d, hp.t, p.pos);
        return { kind: 'player', point: { ...p.pos }, target: hp.index };
      }
      if (world) {
        v3addScaled(p.pos, d, world.toi, p.pos);
        return { kind: 'world', point: { ...p.pos } };
      }
      v3addScaled(p.pos, d, len, p.pos);
    }
    p.life -= h;
    if (p.life <= 0) return { kind: 'expired', point: { ...p.pos } };
  }
  return { kind: 'flying' };
}

/** Reach (m) of a projectile ability on a flat line (speed × lifetime), for HUD and range text. */
export function projectileReach(def: AbilityDefinition): number {
  for (const e of def.effects) if (e.kind === 'projectile') return e.speed * e.lifetime;
  return def.range;
}

/**
 * Launch direction for an arcing projectile (speed `speed`, radial gravity `gravity`) from `from` to land on `aim`:
 * the low ballistic arc solved on the local ground plane, then corrected twice by simulating the real flight (the
 * planet curves ~3 m away over 24 m). Out of reach → 45°. Straight projectiles (gravity 0) point at the aim.
 */
export function lobDirection(from: Vec3, aim: Vec3, speed: number, gravity: number): Vec3 {
  if (gravity <= 0) return v3normalize({ x: aim.x - from.x, y: aim.y - from.y, z: aim.z - from.z });
  const landR = v3len(aim);
  let target = { ...aim };
  let dir = flatLob(from, target, speed, gravity);
  for (let i = 0; i < 2; i++) {
    // Where does this launch come down through the aim's height?
    const p: ProjectileBody = { pos: { ...from }, vel: v3scaleTo(dir, speed), gravity, radius: 0, life: 6 };
    let landed: Vec3 | null = null;
    for (let t = 0; t < 6; t += PROJECTILE_SUBSTEP) {
      integrateProjectile(p, PROJECTILE_SUBSTEP);
      if (v3len(p.pos) <= landR && v3dot(p.vel, v3normalize(p.pos)) < 0) {
        landed = p.pos;
        break;
      }
    }
    if (!landed) break;
    target = { x: target.x + (aim.x - landed.x), y: target.y + (aim.y - landed.y), z: target.z + (aim.z - landed.z) };
    dir = flatLob(from, target, speed, gravity);
  }
  return dir;
}

const v3scaleTo = (d: Vec3, s: number): Vec3 => ({ x: d.x * s, y: d.y * s, z: d.z * s });

function flatLob(from: Vec3, aim: Vec3, speed: number, gravity: number): Vec3 {
  const d = { x: aim.x - from.x, y: aim.y - from.y, z: aim.z - from.z };
  const up = v3normalize(from);
  const dy = v3dot(d, up);
  const flat = v3projectOnPlane(d, up);
  const dh = v3len(flat);
  if (dh < 1e-3) return v3normalize(d);
  v3set(flat, flat.x / dh, flat.y / dh, flat.z / dh);
  const v2 = speed * speed;
  const disc = v2 * v2 - gravity * (gravity * dh * dh + 2 * dy * v2);
  const theta = disc >= 0 ? Math.atan((v2 - Math.sqrt(disc)) / (gravity * dh)) : Math.PI / 4;
  const c = Math.cos(theta), s = Math.sin(theta);
  return v3normalize({ x: flat.x * c + up.x * s, y: flat.y * c + up.y * s, z: flat.z * c + up.z * s });
}
