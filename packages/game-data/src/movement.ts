/** Character movement tuning shared by client prediction and server simulation (test values, measured in play). */
export const MOVEMENT = {
  /** Capsule: radius and half-height of the cylindrical part. Total height = 2·(halfHeight + radius). */
  capsuleRadius: 0.3,
  capsuleHalfHeight: 0.5,
  /** Collider offset kept between the capsule and the world by the character controller. */
  skin: 0.02,
  runSpeed: 5.6,
  sprintSpeed: 7.8,
  aimSpeed: 3.4,
  walkThreshold: 2.2,
  groundAccel: 46,
  groundDecel: 38,
  airAccel: 9,
  jumpSpeed: 7.2,
  /** Jumps pressed this long before landing still fire (s). */
  jumpBuffer: 0.12,
  /** Jumps pressed this long after leaving ground still fire (s). */
  coyoteTime: 0.1,
  /**
   * Double jump: one more jump in the air (rising edge, past the coyote time), recharged on touching the ground or the
   * water. It sets the vertical speed (a falling character gets the whole hop back) and swings the horizontal velocity
   * `airJumpSteer` of the way toward the WASD direction, so it also corrects a jump mid-air.
   */
  airJumpSpeed: 6.6,
  airJumpSteer: 0.6,
  maxSlopeClimbDeg: 52,
  minSlopeSlideDeg: 48,
  autostepHeight: 0.38,
  autostepMinWidth: 0.12,
  snapToGround: 0.32,
  /** Facing turn rate toward movement (rad/s). */
  turnRate: 13,
  /** Max fall speed (m/s). */
  terminalSpeed: 42,
  /**
   * Skydive after leaving the UFO (no glider): steer on the tangent plane while falling at a capped speed. Holding
   * sprint dives head-first: faster down, less steering. Leaving a faster fall brakes smoothly (`diveBrake`, m/s²).
   */
  diveTerminalSpeed: 22,
  diveFastTerminalSpeed: 38,
  diveSpeed: 13,
  diveFastSpeed: 6,
  diveAccel: 16,
  diveBrake: 30,
  /**
   * Water (lakes, the sea): wading gets slower as the water rises (`wadeSlow` = speed fraction at chest depth). Once the
   * feet are `swimEnterDepth` under the surface the character swims, floating with the feet `swimFloatDepth` under it
   * (head and shoulders out), and walks again when the bottom lifts the feet above `swimExitDepth`. While swimming:
   * slow strokes, no weapons or abilities, and a hop (`swimJumpSpeed`) from the surface. Sprint held dives: the
   * swimmer sinks at `swimDiveSpeed` and swims under water; jump held under water rises at `swimMaxRise`; letting go
   * floats back up.
   */
  wadeSlow: 0.6,
  swimEnterDepth: 1.2,
  swimExitDepth: 0.8,
  swimFloatDepth: 1.05,
  swimSpeed: 3.1,
  swimDiveSpeed: 2.6,
  swimAccel: 9,
  /**
   * Buoyancy: vertical speed toward the float depth per metre of error (m/s per m); floating up from the deep is
   * capped at `swimFloatRise`, swimming up (jump held) and sinking back at `swimMaxRise`.
   */
  swimBuoyancy: 2.6,
  swimFloatRise: 1.5,
  swimMaxRise: 3,
  /** How fast water brakes vertical speed toward the buoyancy target (1/s): a plunge stops in ≈ v/swimDrag metres. */
  swimDrag: 8,
  swimJumpSpeed: 6.4,
  /**
   * Breath: `breathTime` s of air while the head is under water (feet deeper than `breathDepth`: the swim pose rides
   * ≈ 1.3 m above the feet), refilled `breathRefill`× faster above it. Out of air, drowning takes `drownDamage` Health
   * (a shield does not keep water out) every `drownInterval` s until the head is out.
   */
  breathDepth: 1.45,
  breathTime: 12,
  breathRefill: 4,
  drownDamage: 10,
  drownInterval: 1,
} as const;
