/**
 * Unarmed combat (fists): what a player fights with before finding a weapon in a chest, and whenever they put their
 * weapons away. Test values for Health 100 + Shield 100: a punch is honest but a weapon is clearly better, so looking
 * for chests stays worth it (a Sunbeam empties a shield in under a second; fists need eleven punches, seven seconds).
 *
 * The server resolves every punch (range, direction, walls, interval); the client only plays it.
 */
export const MELEE = {
  /** Damage per punch (Shield first, then Health, like any hit). */
  damage: 9,
  /** Reach (m) from the attacker's chest to the target's hitbox surface. */
  range: 1.8,
  /** Half-angle (degrees) of the cone in front of the attacker, around the camera aim projected onto the ground. */
  coneDeg: 50,
  /** Minimum time between two punches (ms). */
  intervalMs: 650,
  /** The server accepts a punch slightly early (network jitter), never more than this fraction of the interval. */
  intervalTolerance: 0.85,
  /** Mana and ammunition a punch costs: none. */
  manaCost: 0,
  /** Height (m) above the feet the punch comes from and the line of sight is checked from. */
  chestHeight: 1.2,
  /** How far (m) the claimed camera origin may be from the attacker's head (third-person boom + slack). */
  maxCameraOffset: 7.5,
} as const;

/** The two punches alternate; each has its own animation and a slightly different hit point. */
export const PUNCH_HANDS = ['left', 'right'] as const;
export type PunchHand = (typeof PUNCH_HANDS)[number];
