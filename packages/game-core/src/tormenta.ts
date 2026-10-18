/**
 * Tormenta: the shrinking safe region of a match, as pure spherical math shared by the authoritative server and the
 * clients (which only draw it), plus GRATormentaSystem, the server's phase clock and damage pulses.
 *
 * The region is a spherical cap: a centre direction from the planet centre and an angular radius. Inside means the
 * geodesic angle between normalize(position) and the centre is below the radius, never a flat X/Z circle. A phase
 * holds a circle while the next one is announced, then closes onto it: the centre slides along the great circle and
 * the radius shrinks linearly. Because a centre never sits farther from the previous one than the radius shrinks
 * (d(c_k, c_k+1) ≤ r_k − r_k+1), every intermediate circle lies inside the earlier ones: the boundary only ever
 * moves inward.
 *
 * The plan is built backwards (the legacy "O Branco" lesson): the final centre first, on walkable land, then each
 * earlier circle around the next. Only the current phase is ever published (TormentaMsg), so the final spot is not
 * known early. Every published number is an integer, and the server evaluates the same message the clients get.
 */
import { PLANET, TORMENTA, type TormentaPhaseDef } from '@graao/game-data';
import { v3, v3angle, v3cross, v3normalize, v3set, type TormentaMsg, type Vec3 } from '@graao/shared';
import { latLonToDir } from './sphere';
import type { Terrain } from './terrain';

const DEG = Math.PI / 180;
const U = 1e6;

export interface TormentaConfig {
  startRadiusDeg: number;
  phases: readonly TormentaPhaseDef[];
  finalDamage: number;
  pulseMs: number;
  nestMargin: number;
  finalWalkable: number;
  walkMinHeight: number;
  walkMaxSlopeDeg: number;
}

export interface TormentaCircle {
  center: Vec3;
  /** Angular radius (rad). */
  radius: number;
}

export interface TormentaPlan {
  /** Circle 0 is the whole planet at the start; circle k (1..n) is the region phase k closes onto. */
  circles: TormentaCircle[];
  /** Server ms when phase 1 begins (the fight starts); damage pulses tick from here. */
  start: number;
  /** Phase k (index k − 1): holds from t0, closes between a and b, `damage` per pulse outside. */
  phases: { t0: number; a: number; b: number; damage: number }[];
  finalDamage: number;
  pulseMs: number;
}

export type TormentaStage = 'hold' | 'shrink' | 'final';

// ------------------------------------------------------------------------------------------------ geometry

const int3 = (v: Vec3): [number, number, number] => [Math.round(v.x * U), Math.round(v.y * U), Math.round(v.z * U)];
const decode = (c: readonly [number, number, number], out: Vec3 = v3()): Vec3 => v3normalize(v3set(out, c[0], c[1], c[2]), out);

/** The direction `angle` rad away from unit `c`, toward bearing `bearing` (rad) in c's tangent plane. */
export function offsetDirection(c: Vec3, bearing: number, angle: number, out: Vec3 = v3()): Vec3 {
  const t1 = v3normalize(v3cross(c, Math.abs(c.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 }));
  const t2 = v3cross(c, t1);
  const bx = t1.x * Math.cos(bearing) + t2.x * Math.sin(bearing);
  const by = t1.y * Math.cos(bearing) + t2.y * Math.sin(bearing);
  const bz = t1.z * Math.cos(bearing) + t2.z * Math.sin(bearing);
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  return v3normalize(v3set(out, c.x * ca + bx * sa, c.y * ca + by * sa, c.z * ca + bz * sa), out);
}

/** Spherical interpolation between unit vectors (constant speed along the great circle). */
function slerp(a: Vec3, b: Vec3, f: number, out: Vec3): Vec3 {
  const th = v3angle(a, b);
  if (th < 1e-9 || f <= 0) return v3set(out, a.x, a.y, a.z);
  if (f >= 1) return v3set(out, b.x, b.y, b.z);
  const s = Math.sin(th);
  const wa = Math.sin((1 - f) * th) / s;
  const wb = Math.sin(f * th) / s;
  return v3normalize(v3set(out, a.x * wa + b.x * wb, a.y * wa + b.y * wb, a.z * wa + b.z * wb), out);
}

/** Geodesic angle (rad) from a world position to the region's centre. */
export const tormentaAngle = (c: TormentaCircle, pos: Vec3): number => v3angle(v3normalize(pos), c.center);

/** Inside the safe region (geodesic). A radius of π or more covers the whole planet. */
export const tormentaInside = (c: TormentaCircle, pos: Vec3): boolean => tormentaAngle(c, pos) <= c.radius;

/** Metres along the surface from the boundary: positive outside (into the Tormenta), negative inside. */
export const tormentaEdgeMeters = (c: TormentaCircle, pos: Vec3, radius: number = PLANET.radius): number => (tormentaAngle(c, pos) - c.radius) * radius;

// ------------------------------------------------------------------------------------------------ messages

/** The phase's stage at server time `t`. */
export function tormentaStage(m: TormentaMsg, t: number): TormentaStage {
  if (m.k > m.n) return 'final';
  return t < m.a ? 'hold' : 'shrink';
}

/** 0..1 of the current reduction done at server time `t` (0 while holding, 1 in the final phase). */
export function tormentaProgress(m: TormentaMsg, t: number): number {
  if (m.k > m.n) return 1;
  if (t <= m.a || m.b <= m.a) return 0;
  return Math.min(1, (t - m.a) / (m.b - m.a));
}

/** The safe region at server time `t`, from the published phase (what the server tests and the clients draw). */
export function tormentaCircleAt(m: TormentaMsg, t: number, out: TormentaCircle = { center: v3(), radius: 0 }): TormentaCircle {
  const f = tormentaProgress(m, t);
  const from = decode(m.c);
  const to = decode(m.tc);
  slerp(from, to, f, out.center);
  out.radius = (m.r + (m.tr - m.r) * f) / U;
  return out;
}

/** The region this phase closes onto (the "next" circle while holding). */
export function tormentaTarget(m: TormentaMsg, out: TormentaCircle = { center: v3(), radius: 0 }): TormentaCircle {
  decode(m.tc, out.center);
  out.radius = m.tr / U;
  return out;
}

/** Phase k (1..n + 1) of a plan as the message the room publishes. */
export function tormentaPhaseMsg(plan: TormentaPlan, k: number): TormentaMsg {
  const n = plan.phases.length;
  const q = (c: TormentaCircle) => ({ c: int3(c.center), r: Math.round(c.radius * U) });
  if (k > n) {
    const f = q(plan.circles[n]!);
    return { k: n + 1, n, c: f.c, r: f.r, tc: f.c, tr: f.r, t0: plan.phases[n - 1]?.b ?? plan.start, a: 0, b: 0, dmg: plan.finalDamage, every: plan.pulseMs };
  }
  const p = plan.phases[k - 1]!;
  const from = q(plan.circles[k - 1]!);
  const to = q(plan.circles[k]!);
  return { k, n, c: from.c, r: from.r, tc: to.c, tr: to.r, t0: p.t0, a: p.a, b: p.b, dmg: p.damage, every: plan.pulseMs };
}

// ------------------------------------------------------------------------------------------------ plan

/** Normal movement works here: land above the sea and a slope a runner climbs. */
export function walkableAt(terrain: Terrain, dir: Vec3, config: Pick<TormentaConfig, 'walkMinHeight' | 'walkMaxSlopeDeg'> = TORMENTA): boolean {
  return terrain.heightAt(dir) > PLANET.seaLevel + config.walkMinHeight && terrain.slopeAt(dir) < config.walkMaxSlopeDeg * DEG;
}

/** Fraction of a disc (centre + two rings of samples) that is walkable. */
export function walkableFraction(terrain: Terrain, center: Vec3, radius: number, config: Pick<TormentaConfig, 'walkMinHeight' | 'walkMaxSlopeDeg'> = TORMENTA): number {
  let ok = walkableAt(terrain, center, config) ? 1 : 0;
  let n = 1;
  const tmp = v3();
  for (const [ring, count] of [[0.5, 8], [0.95, 12]] as const) {
    for (let i = 0; i < count; i++) {
      offsetDirection(center, (i / count) * Math.PI * 2 + ring, radius * ring, tmp);
      if (walkableAt(terrain, tmp, config)) ok++;
      n++;
    }
  }
  return ok / n;
}

/**
 * Picks the final region's centre: a uniformly random direction whose centre is walkable and whose disc is mostly
 * walkable (no final in a lake, the sea or on a cliff). Falls back to the village plaza.
 */
export function pickFinalCenter(rng: () => number, terrain: Terrain, radius: number, config: TormentaConfig = TORMENTA): Vec3 {
  for (let tries = 0; tries < 600; tries++) {
    const z = rng() * 2 - 1;
    const phi = rng() * Math.PI * 2;
    const s = Math.sqrt(Math.max(0, 1 - z * z));
    const d = { x: s * Math.cos(phi), y: z, z: s * Math.sin(phi) };
    if (!walkableAt(terrain, d, config)) continue;
    if (walkableFraction(terrain, d, radius, config) >= config.finalWalkable) return d;
  }
  return latLonToDir(8, 0);
}

/**
 * The whole schedule of one match's Tormenta, from the fight start `start`: the final centre first (or `finalDir`),
 * then each earlier circle offset from the next inside the nesting margin. Circles are quantized exactly like the
 * messages, so the plan and what the clients receive are the same numbers.
 */
export function planTormenta(rng: () => number, terrain: Terrain, start: number, config: TormentaConfig = TORMENTA, finalDir?: Vec3): TormentaPlan {
  const n = config.phases.length;
  const radii = [Math.min(Math.PI, config.startRadiusDeg * DEG), ...config.phases.map((p) => Math.min(Math.PI, p.radiusDeg * DEG))];
  const centers: Vec3[] = new Array<Vec3>(n + 1);
  centers[n] = finalDir ? v3normalize(finalDir) : pickFinalCenter(rng, terrain, radii[n]!, config);
  for (let k = n - 1; k >= 1; k--) {
    const room = Math.max(0, radii[k]! - radii[k + 1]!) * config.nestMargin;
    centers[k] = offsetDirection(centers[k + 1]!, rng() * Math.PI * 2, Math.sqrt(rng()) * room);
  }
  // The whole planet shrinks around the first region (any centre covers everything at radius π).
  centers[0] = centers[Math.min(1, n)]!;
  const circles = centers.map((c, k) => ({ center: decode(int3(c)), radius: Math.round(radii[k]! * U) / U }));
  const phases: TormentaPlan['phases'] = [];
  let t = Math.round(start);
  for (const p of config.phases) {
    const t0 = t;
    const a = t0 + Math.max(0, Math.round(p.waitMs));
    const b = a + Math.max(1, Math.round(p.shrinkMs));
    phases.push({ t0, a, b, damage: Math.max(0, Math.round(p.damage)) });
    t = b;
  }
  return { circles, start: Math.round(start), phases, finalDamage: Math.max(0, Math.round(config.finalDamage)), pulseMs: Math.max(50, Math.round(config.pulseMs)) };
}

/**
 * Worst-case run per reduction: from the farthest point of the previous circle to inside the new one, against the
 * time the phase gives (hold + shrink). `needS` already includes the detour factor.
 */
export function tormentaReachability(config: TormentaConfig = TORMENTA, speed = 5.6, pathFactor = 1.3, radius: number = PLANET.radius): { phase: number; needS: number; haveS: number }[] {
  const radii = [Math.min(Math.PI, config.startRadiusDeg * DEG), ...config.phases.map((p) => Math.min(Math.PI, p.radiusDeg * DEG))];
  return config.phases.map((p, i) => {
    const prev = radii[i]!;
    const next = radii[i + 1]!;
    // The previous circle's far edge seen from the new centre: its own radius plus how far the centre moved.
    const offset = i === 0 ? 0 : (prev - next) * config.nestMargin;
    const worst = Math.min(Math.PI, prev + offset) - next;
    return { phase: i + 1, needS: (Math.max(0, worst) * radius * pathFactor) / speed, haveS: (p.waitMs + p.shrinkMs) / 1000 };
  });
}

// ------------------------------------------------------------------------------------------------ server system

export interface TormentaTick {
  /** The published phase changed: send it. */
  changed: boolean;
  /** A damage pulse fell on this update: Health to take from everyone outside (0 = none). */
  damage: number;
}

/**
 * GRATormentaSystem: the authoritative Tormenta of one match (server). `start` plans it from the fight start;
 * `update(now)` advances the phases and reports the damage pulses: pulse i falls at start + i·pulseMs (i ≥ 1) and is
 * reported once, however often `update` runs and even when the server stalled over several intervals (no double
 * damage for one interval, no catch-up burst). Everyone is tested against the same circle, the one at the last
 * update, from the published (quantized) phase.
 */
export class GRATormentaSystem {
  private plan: TormentaPlan | null = null;
  private k = 0;
  private msg: TormentaMsg | null = null;
  private lastPulse = 0;
  private readonly circle: TormentaCircle = { center: v3(), radius: Math.PI };
  private readonly next: TormentaCircle = { center: v3(), radius: Math.PI };

  constructor(public config: TormentaConfig = TORMENTA) {}

  get active(): boolean {
    return !!this.msg;
  }

  /** The phase to publish (null outside a match). */
  get view(): TormentaMsg | null {
    return this.msg;
  }

  /** The safe region at the last update. */
  get current(): TormentaCircle | null {
    return this.msg ? this.circle : null;
  }

  /** Where the current phase is closing to. */
  get target(): TormentaCircle | null {
    return this.msg ? this.next : null;
  }

  /** The schedule (tests and dev tools; the final centre must not reach clients early). */
  get schedule(): TormentaPlan | null {
    return this.plan;
  }

  start(startAt: number, rng: () => number, terrain: Terrain, finalDir?: Vec3): TormentaMsg {
    this.plan = planTormenta(rng, terrain, startAt, this.config, finalDir);
    this.k = 1;
    this.lastPulse = 0;
    this.msg = tormentaPhaseMsg(this.plan, this.k);
    tormentaCircleAt(this.msg, startAt, this.circle);
    tormentaTarget(this.msg, this.next);
    return this.msg;
  }

  stop(): void {
    this.plan = null;
    this.msg = null;
    this.k = 0;
  }

  update(now: number): TormentaTick {
    const plan = this.plan;
    if (!plan || !this.msg) return { changed: false, damage: 0 };
    let changed = false;
    const n = plan.phases.length;
    while (this.k <= n && now >= plan.phases[this.k - 1]!.b) {
      this.k++;
      this.msg = tormentaPhaseMsg(plan, this.k);
      changed = true;
    }
    tormentaCircleAt(this.msg, now, this.circle);
    if (changed) tormentaTarget(this.msg, this.next);
    let damage = 0;
    if (now >= plan.start) {
      const i = Math.floor((now - plan.start) / plan.pulseMs);
      if (i > this.lastPulse) {
        this.lastPulse = i;
        damage = this.msg.dmg;
      }
    }
    return { changed, damage };
  }

  /** Outside the safe region at the last update. */
  outside(pos: Vec3): boolean {
    return !!this.msg && !tormentaInside(this.circle, pos);
  }
}
