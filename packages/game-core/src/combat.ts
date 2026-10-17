/**
 * Combat rules shared by server (authoritative) and client (cosmetic prediction only):
 * vitals, Shield-then-Health damage with the hit taxonomy, analytic player hitboxes (body capsule + head sphere),
 * deterministic spread per shot, distance falloff and hitscan resolution against the world and players.
 */
import { ATTRIBUTES, type WeaponDefinition } from '@graao/game-data';
import { HitKind, v3, v3addScaled, v3cross, v3dot, v3normalize, v3rotateAxis, type Vec3 } from '@graao/shared';
import { GROUPS_WORLD_QUERY, type GamePhysics } from './physics';
import { mulberry32 } from './rng';

export interface Vitals {
  health: number;
  shield: number;
  mana: number;
  alive: boolean;
}

export const newVitals = (): Vitals => ({ health: ATTRIBUTES.maxHealth, shield: ATTRIBUTES.maxShield, mana: ATTRIBUTES.maxMana, alive: true });

export interface DamageResult {
  kinds: HitKind[];
  shieldDamage: number;
  healthDamage: number;
  eliminated: boolean;
}

/** Applies damage: Shield absorbs first, the rest goes to Health. Integers only (no fractional HP on the wire). */
export function applyDamage(v: Vitals, amount: number, critical: boolean): DamageResult {
  const kinds: HitKind[] = [];
  if (!v.alive || amount <= 0) return { kinds, shieldDamage: 0, healthDamage: 0, eliminated: false };
  let dmg = Math.max(1, Math.round(amount));
  const shieldDamage = Math.min(v.shield, dmg);
  if (shieldDamage > 0) {
    v.shield -= shieldDamage;
    dmg -= shieldDamage;
    kinds.push(v.shield === 0 ? HitKind.SHIELD_BREAK : HitKind.SHIELD);
  }
  const healthDamage = Math.min(v.health, dmg);
  if (healthDamage > 0) {
    v.health -= healthDamage;
    kinds.push(critical ? HitKind.CRITICAL : HitKind.BODY);
  } else if (critical && shieldDamage > 0) kinds.push(HitKind.CRITICAL);
  let eliminated = false;
  if (v.health <= 0) {
    v.alive = false;
    eliminated = true;
    kinds.push(HitKind.ELIMINATION);
  }
  return { kinds, shieldDamage, healthDamage, eliminated };
}

/** Drowning (out of breath under water): Health only, a shield does not keep water out. */
export function applyDrowning(v: Vitals, amount: number): DamageResult {
  const kinds: HitKind[] = [];
  if (!v.alive || amount <= 0) return { kinds, shieldDamage: 0, healthDamage: 0, eliminated: false };
  const healthDamage = Math.min(v.health, Math.max(1, Math.round(amount)));
  v.health -= healthDamage;
  kinds.push(HitKind.BODY);
  const eliminated = v.health <= 0;
  if (eliminated) {
    v.alive = false;
    kinds.push(HitKind.ELIMINATION);
  }
  return { kinds, shieldDamage: 0, healthDamage, eliminated };
}

/** Hitbox dimensions relative to the feet (m). The head is a separate sphere for CRITICAL hits. */
export const HITBOX = {
  bodyBottom: 0.25,
  bodyTop: 1.22,
  bodyRadius: 0.32,
  headHeight: 1.48,
  headRadius: 0.19,
} as const;

/** Ray (unit dir) vs sphere: distance or -1. */
export function raySphere(o: Vec3, d: Vec3, c: Vec3, r: number): number {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  const t0 = -b - s;
  if (t0 >= 0) return t0;
  const t1 = -b + s;
  return t1 >= 0 ? 0 : -1;
}

/** Ray (unit dir) vs capsule (segment a–b, radius r): distance or -1. */
export function rayCapsule(o: Vec3, d: Vec3, a: Vec3, b: Vec3, r: number): number {
  const ba = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const oa = { x: o.x - a.x, y: o.y - a.y, z: o.z - a.z };
  const baba = v3dot(ba, ba);
  const bard = v3dot(ba, d);
  const baoa = v3dot(ba, oa);
  const rdoa = v3dot(d, oa);
  const oaoa = v3dot(oa, oa);
  const A = baba - bard * bard;
  const B = baba * rdoa - baoa * bard;
  const C = baba * oaoa - baoa * baoa - r * r * baba;
  const h = B * B - A * C;
  if (h >= 0 && A > 1e-12) {
    const t = (-B - Math.sqrt(h)) / A;
    const y = baoa + t * bard;
    if (y > 0 && y < baba && t >= 0) return t;
  }
  // Caps.
  const ta = raySphere(o, d, a, r);
  const tb = raySphere(o, d, b, r);
  if (ta < 0) return tb;
  if (tb < 0) return ta;
  return Math.min(ta, tb);
}

export interface PlayerHitTarget {
  index: number;
  feet: Vec3;
  alive: boolean;
}

/**
 * Nearest player hit along a ray: distance, index and whether it was the head. `inflate` grows every hitbox (a
 * projectile's radius: a sphere swept along the ray).
 */
export function rayPlayers(o: Vec3, d: Vec3, maxDist: number, players: PlayerHitTarget[], ignore: number, inflate = 0): { t: number; index: number; head: boolean } | null {
  let best: { t: number; index: number; head: boolean } | null = null;
  for (const p of players) {
    if (p.index === ignore || !p.alive) continue;
    const up = v3normalize(p.feet);
    const head = v3addScaled(p.feet, up, HITBOX.headHeight);
    const th = raySphere(o, d, head, HITBOX.headRadius + inflate);
    const a = v3addScaled(p.feet, up, HITBOX.bodyBottom);
    const b = v3addScaled(p.feet, up, HITBOX.bodyTop);
    const tb = rayCapsule(o, d, a, b, HITBOX.bodyRadius + inflate);
    let t = -1;
    let isHead = false;
    if (th >= 0 && (tb < 0 || th <= tb)) {
      t = th;
      isHead = true;
    } else if (tb >= 0) t = tb;
    if (t >= 0 && t <= maxDist && (!best || t < best.t)) best = { t, index: p.index, head: isHead };
  }
  return best;
}

/** Deterministic pellet directions for shot `seed` (same on client and server). */
export function spreadDirections(dir: Vec3, coneDeg: number, pellets: number, seed: number): Vec3[] {
  const rand = mulberry32(seed);
  const d = v3normalize(dir);
  const ref = Math.abs(d.y) < 0.95 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const side = v3normalize(v3cross(d, ref));
  const out: Vec3[] = [];
  const cone = (coneDeg * Math.PI) / 180;
  for (let i = 0; i < pellets; i++) {
    // Uniform over the cone's disc (sqrt for area), first pellet of a multi-pellet shot goes to the center.
    const r = pellets > 1 && i === 0 ? 0 : cone * Math.sqrt(rand());
    const phi = rand() * Math.PI * 2;
    const tilted = v3rotateAxis(d, side, r);
    out.push(v3normalize(v3rotateAxis(tilted, d, phi)));
  }
  return out;
}

export function falloff(w: WeaponDefinition, dist: number): number {
  if (dist <= w.falloffStart) return 1;
  if (dist >= w.falloffEnd) return w.falloffMin;
  const t = (dist - w.falloffStart) / (w.falloffEnd - w.falloffStart);
  return 1 + (w.falloffMin - 1) * t;
}

export interface PelletResult {
  point: Vec3;
  target: number;
  head: boolean;
  distance: number;
}

/**
 * Resolves one hitscan pellet: the camera ray finds the aimed point (world or player), then the muzzle must see that
 * point — a wall between the shooter's body and the aim point blocks the shot there (no shooting around corners).
 */
export function resolvePellet(
  physics: GamePhysics,
  cameraOrigin: Vec3,
  dir: Vec3,
  muzzle: Vec3,
  range: number,
  players: PlayerHitTarget[],
  shooter: number,
): PelletResult {
  const world = physics.castRay(cameraOrigin, dir, range, GROUPS_WORLD_QUERY);
  const tw = world ? world.toi : range;
  const hp = rayPlayers(cameraOrigin, dir, tw, players, shooter);
  const aimT = hp ? hp.t : tw;
  const aimPoint = v3addScaled(cameraOrigin, dir, aimT);
  // Muzzle line of sight.
  const toAim = { x: aimPoint.x - muzzle.x, y: aimPoint.y - muzzle.y, z: aimPoint.z - muzzle.z };
  const len = Math.hypot(toAim.x, toAim.y, toAim.z);
  if (len > 0.05) {
    const md = { x: toAim.x / len, y: toAim.y / len, z: toAim.z / len };
    const block = physics.castRay(muzzle, md, len - 0.15, GROUPS_WORLD_QUERY);
    if (block) {
      const p = v3addScaled(muzzle, md, block.toi);
      return { point: p, target: -1, head: false, distance: block.toi };
    }
  }
  const dist = Math.hypot(aimPoint.x - muzzle.x, aimPoint.y - muzzle.y, aimPoint.z - muzzle.z);
  return { point: aimPoint, target: hp ? hp.index : -1, head: hp ? hp.head : false, distance: dist };
}

/** Muzzle position for a character at `feet` facing `facing` (approximate right-hand blaster). */
export function muzzlePoint(feet: Vec3, facing: Vec3, out: Vec3 = v3()): Vec3 {
  const up = v3normalize(feet);
  const side = v3normalize(v3cross(facing, up)); // character's right
  out.x = feet.x + up.x * 1.32 + facing.x * 0.42 + side.x * 0.18;
  out.y = feet.y + up.y * 1.32 + facing.y * 0.42 + side.y * 0.18;
  out.z = feet.z + up.z * 1.32 + facing.z * 0.42 + side.z * 0.18;
  return out;
}

/** Stable seed for a shot from (player index, shot sequence). */
export const shotSeed = (playerIndex: number, shotSeq: number): number => (Math.imul(playerIndex + 1, 0x9e3779b1) ^ Math.imul(shotSeq + 7, 0x85ebca6b)) >>> 0;
