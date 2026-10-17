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
  maxSlopeClimbDeg: 52,
  minSlopeSlideDeg: 48,
  autostepHeight: 0.38,
  autostepMinWidth: 0.12,
  snapToGround: 0.32,
  /** Facing turn rate toward movement (rad/s). */
  turnRate: 13,
  /** Max fall speed (m/s). */
  terminalSpeed: 42,
} as const;
