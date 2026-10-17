/**
 * UFO deployment tuning (Phase 7). Test values: measured in play, adjusted here.
 *
 * The ship flies a great circle 100 m above the sea, passing over the arena (Lantern Village) with a random heading
 * and a small random offset, so every match starts from a different line over the same landmarks. The jump window is
 * a full lap: the hatch opens just before the village and closes when the ship is back there, so a player can drop
 * anywhere under the route, while jumping at once (or being dropped at the close) still lands near the village.
 */
export const UFO = {
  /** Orbit radius (m from the planet centre). Planet radius 100 → 100 m above the sea. */
  orbitRadius: 200,
  /** World reveal before the hatch opens (ms): the planet from afar, then the camera joins the ship. */
  revealMs: 4500,
  /** Jump window (ms). Whoever is still aboard when it closes is dropped. */
  windowMs: 30000,
  /** Arc of the route flown during the jump window (degrees). 360 = one full lap around the planet. */
  windowArcDeg: 360,
  /** Where the hatch opens, along the route from the closest approach (degrees; negative = before the arena). */
  windowStartDeg: -10,
  /** Random offset of the closest approach from the arena centre (degrees of arc). */
  approachJitterDeg: 10,
  /** Jumping out: start this far below the ship's centre (m), moving along its course at `exitSpeed` (m/s). */
  exitDrop: 3,
  exitSpeed: 6,
  /** A diver still airborne this long after the window closed is set down on the ground (ms). */
  landTimeoutMs: 20000,
} as const;
