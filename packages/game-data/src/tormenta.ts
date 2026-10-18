/**
 * Tormenta tuning (test values, measured in play): the safe region of a match on the spherical planet.
 *
 * The Tormenta takes the pigment out of the world. It starts with the whole planet safe and closes in three
 * reductions; each phase first holds (the next safe region is announced with a countdown), then shrinks toward it,
 * and the last circle holds until the match ends. Being outside costs Health only (a shield does not keep the
 * colour in), once per pulse. Radii are angles of arc around the planet centre (100 m planet: 1° ≈ 1.75 m).
 *
 * Reachability (unit-tested): from the worst point of the previous circle, a runner (5.6 m/s, path factor 1.3 for
 * houses and lakes) gets inside every new circle before its shrink ends.
 */
export interface TormentaPhaseDef {
  /** Hold before this reduction (ms): the next region is shown and the countdown runs. */
  waitMs: number;
  /** How long the boundary takes to close onto the next region (ms). */
  shrinkMs: number;
  /** Angular radius of the region this phase closes onto (degrees of arc). */
  radiusDeg: number;
  /** Health taken per pulse outside the safe region during this phase. */
  damage: number;
}

export const TORMENTA = {
  /** Before the first reduction the whole planet is safe. */
  startRadiusDeg: 180,
  phases: [
    { waitMs: 40000, shrinkMs: 30000, radiusDeg: 100, damage: 2 },
    { waitMs: 30000, shrinkMs: 25000, radiusDeg: 45, damage: 4 },
    { waitMs: 20000, shrinkMs: 25000, radiusDeg: 10, damage: 7 },
  ] as readonly TormentaPhaseDef[],
  /** Health per pulse outside the final region (it holds until someone falls). */
  finalDamage: 10,
  /** One damage pulse per interval (ms), on a clock aligned to the Tormenta's start. */
  pulseMs: 1000,
  /** A circle's centre may sit at most this fraction of (previous radius − its radius) from the previous centre. */
  nestMargin: 0.85,
  /** The final region must be at least this walkable (land above the sea, gentle slopes). */
  finalWalkable: 0.75,
  /** A walkable sample: terrain this far above the sea (m) and no steeper than this (degrees). */
  walkMinHeight: 0.35,
  walkMaxSlopeDeg: 30,
  /** Reachability check: run speed (m/s) and detour factor. */
  checkSpeed: 5.6,
  pathFactor: 1.3,
  /** HUD and audio: the warning before a reduction starts (ms). */
  warnMs: 10000,
} as const;
