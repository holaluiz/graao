/**
 * Vertical traversal tuning (docs/gameplay/TRAVERSAL_STATES.md): ledge hang, mantle, climbing and the universal glide,
 * shared by client prediction and the authoritative server. Distances are metres along the character's local up
 * (radial) from the feet, speeds m/s, stamina points; timers are counted by the motor in whole 1/60 s steps.
 */

/**
 * Persistent traversal mode of a character (game-core CharacterState.traversal). NONE is ordinary locomotion
 * (grounded, jumping, falling, swimming); the others own the step. On the wire they are MovementState values.
 */
export const TraversalMode = {
  NONE: 0,
  /** Hanging from a ledge by the hands. */
  HANG: 1,
  /** Pulling up over a ledge (a physical path: up along the wall, then forward onto the top). */
  MANTLE: 2,
  /** On a climbable surface. */
  CLIMB: 3,
  /** Universal glide (held jump while falling). */
  GLIDE: 4,
} as const;
export type TraversalMode = (typeof TraversalMode)[keyof typeof TraversalMode];

/**
 * How a surface plays for traversal (a kit part's or prefab's `traversal`, a structure's colliders):
 * - `ledge`: its top edges can be grabbed and mantled (walls, slabs, parapets, crates, roof eaves). The default for
 *   solid kit parts; the geometry still decides (a top deep enough, a face tall enough, room for the body).
 * - `climb`: climbable faces (rock walls, cliffs, trellises) and grabbable edges.
 * - `none`: neither (railings, trees, lamps, round boulders, decoration).
 */
export type TraversalSurface = 'ledge' | 'climb' | 'none';

/** Bit flags per collider (game-core physics.traversalByCollider). */
export const SurfaceFlag = {
  LEDGE: 1 << 0,
  CLIMB: 1 << 1,
} as const;

export const surfaceFlags = (t: TraversalSurface | undefined): number =>
  t === 'climb' ? SurfaceFlag.LEDGE | SurfaceFlag.CLIMB : t === 'none' ? 0 : SurfaceFlag.LEDGE;

const DEG = Math.PI / 180;

export const TRAVERSAL = {
  stamina: {
    max: 100,
    /** Regeneration on the ground (per second), faster when standing still (resting on a safe footing). */
    regenGround: 24,
    regenRest: 34,
    /** Ground speed under which the character counts as resting (m/s). */
    restSpeed: 0.4,
    /** Drain while climbing, per second at full input: up, sideways, down; idle on the wall. */
    climbUp: 18,
    climbSide: 10,
    climbDown: 6,
    climbIdle: 3,
    /** Drain while hanging from a ledge (per second). */
    hang: 4,
    /** Drain while gliding (per second). */
    glide: 8,
    /** A mantle costs this once (a pull-up is effort, never free). */
    mantle: 4,
    /** Jumping off a wall or a ledge. */
    wallJump: 10,
    /** Least stamina to grab a ledge or a wall, or to open the glider. */
    minGrab: 5,
    minGlide: 10,
  },
  reach: {
    /** Probe heights over the feet for a wall in front (knee, chest, hands). */
    probeHeights: [0.6, 1.15, 1.7, 2.05] as readonly number[],
    /** How far in front of the capsule's axis a wall may be (capsule radius + reach). */
    wallReach: 0.78,
    /**
     * How far behind the axis an edge may already be: jumping at a house from close, the body passes under the eave
     * before the hands get to its height; the hands still catch the edge and the body swings out under it.
     */
    reachBack: 0.4,
    /** Walls: |normal · up| below this (≈ 70° to 110° from horizontal). */
    wallMaxUp: 0.34,
    /** The wish direction must point this much into the wall to grab it (cos ≈ 57°). */
    intoWall: 0.55,
    /** Ledge top window over the feet: below `mantleMin` the autostep or a jump handles it. */
    mantleMin: 0.45,
    /** Up to this a ledge is mantled at once (vault onto a crate, a low wall). */
    mantleDirectMax: 1.45,
    /** Up to this the hands reach a ledge in the air (hang). */
    ledgeMax: 2.25,
    /** The top probe starts this high over the feet and this far past the wall face. */
    topProbeHeight: 2.75,
    topInset: 0.2,
    /** A ledge top must be walkable: normal within this of local up. */
    topMaxSlope: 38 * DEG,
    /** A ledge face must be at least this tall under the top (no grabbing a 5 cm trim). */
    minFace: 0.35,
    /** A hang that would leave the feet less than this over the ground is a vault instead. */
    minHangClearance: 0.35,
  },
  hang: {
    /** Feet this far under the ledge top while hanging (hands over the head on the edge). */
    depth: 1.75,
    /** Gap between the capsule and the wall. */
    gap: 0.05,
    /** Speed toward the hang position (m/s): a short slide into place, never a teleport. */
    snapSpeed: 4.5,
    /** Sideways along the ledge (shimmy). */
    shimmySpeed: 1.5,
  },
  mantle: {
    /** Rise along the wall, then forward onto the top. */
    riseSpeed: 4.2,
    forwardSpeed: 3.0,
    /** Feet end this far past the edge (the whole capsule on the top). */
    forwardDistance: 0.55,
    /** Extra height over the top while moving forward. */
    clearance: 0.06,
    /** A mantle that has not finished after this long is abandoned (falls). */
    maxTime: 1.1,
    /** Leaves the top at this speed along the facing. */
    exitSpeed: 1.5,
  },
  climb: {
    /** Climbable faces: |normal · up| below this (rock slabs lean up to ≈ 50°) — a walkable slope is walked. */
    wallMaxUp: 0.65,
    upSpeed: 1.7,
    sideSpeed: 2.0,
    downSpeed: 2.3,
    /** Push into the wall (m/s) that keeps the capsule on it. */
    stick: 1.2,
    /** Gap kept between the capsule and the wall. */
    gap: 0.04,
    /** Jumping off: away from the wall and up (m/s). */
    jumpOffSpeed: 4.5,
    jumpOffLift: 5.6,
    /** Steps without finding the wall before letting go (a corner, the end of the rock). */
    loseSteps: 6,
  },
  glide: {
    /** Seconds in the air before the glider may open, and the least fall speed (it opens on the way down). */
    minAirTime: 0.3,
    minFallSpeed: 1.0,
    /** No glider within this of whatever is below (it would just flick open on landing). */
    minClearance: 2.0,
    /** Glide time per flight (refilled on the ground and on walls). */
    maxTime: 2.6,
    /** Fall speed under the glider, horizontal speed and acceleration (Asa de Papel: 3.5 and 9). */
    fallSpeed: 4.8,
    speed: 6.6,
    accel: 9,
    /** Gravity factor while slower than `fallSpeed`, and how fast a faster fall is braked (1/s). */
    gravityFactor: 0.45,
    brake: 3.5,
  },
  cooldown: {
    /** After letting go, jumping off or being pushed: no grab before this (s) — no regrab spam, no height farming. */
    regrab: 0.35,
    /** After a finished mantle. */
    afterMantle: 0.2,
    /** After exhaustion (stamina 0). */
    afterExhaust: 0.8,
  },
  /**
   * Wind volumes (docs/gameplay/WIND_VOLUMES.md, the map's `winds`): updrafts lift a glider, directional winds carry
   * anyone in the air along. The speeds themselves are each volume's `strength`; these say how they act.
   */
  wind: {
    /** Upward acceleration of an updraft on a glider (m/s²), on top of the glide's own slow fall. */
    liftAccel: 26,
    /** Without the glider an updraft only slows a fall to this (m/s): no free rise without the kite. */
    fallCapNoGlide: 3.2,
    /** How fast it brakes a faster fall without the glider (m/s²). */
    fallBrakeNoGlide: 22,
    /** A directional wind's acceleration toward its speed along its direction (m/s²). */
    pushAccel: 9,
    /** Share of a directional wind's speed and acceleration felt without the glider (a body catches less wind). */
    noGlideShare: 0.45,
    /** The outer share of a volume's radius and of its height where its force fades out (no hard edge). */
    edgeFade: 0.25,
    topFade: 0.22,
    /** In an updraft the glider opens after this much air time with jump held, whatever the fall or the ground. */
    openAirTime: 0.12,
  },
  /**
   * Radial ceiling of the play zone (m over the planet's nominal radius, docs/gameplay/TORMENTA.md "Altitude"): nothing
   * rises above it (winds, flight, jumps), so no height escapes the simulation or the Tormenta.
   */
  ceiling: 42,
} as const;

/** What a character may do in each traversal mode (enforced by the server, mirrored by the client UI). */
export interface TraversalActions {
  /** Shoot and aim weapons, punch. */
  fire: boolean;
  /** Cast abilities: all, only mobility ones, or none. */
  cast: 'all' | 'mobility' | 'none';
  reload: boolean;
  /** Open chests, doors, pick up items, use consumables. */
  interact: boolean;
  /** Switch or put away weapons. */
  switchWeapon: boolean;
}

export const TRAVERSAL_ACTIONS: Record<TraversalMode, TraversalActions> = {
  [TraversalMode.NONE]: { fire: true, cast: 'all', reload: true, interact: true, switchWeapon: true },
  // Both hands on the edge or the wall: nothing but changing what is slung on the back.
  [TraversalMode.HANG]: { fire: false, cast: 'none', reload: false, interact: false, switchWeapon: true },
  [TraversalMode.MANTLE]: { fire: false, cast: 'none', reload: false, interact: false, switchWeapon: false },
  [TraversalMode.CLIMB]: { fire: false, cast: 'none', reload: false, interact: false, switchWeapon: true },
  // Hands on the glider: no weapons, only mobility magic (which takes over the glide).
  [TraversalMode.GLIDE]: { fire: false, cast: 'mobility', reload: true, interact: false, switchWeapon: true },
};

/** HUD names of the traversal modes (pt-BR). */
export const TRAVERSAL_LABEL: Record<TraversalMode, string> = {
  [TraversalMode.NONE]: '',
  [TraversalMode.HANG]: 'PENDURADO',
  [TraversalMode.MANTLE]: 'SUBINDO',
  [TraversalMode.CLIMB]: 'ESCALANDO',
  [TraversalMode.GLIDE]: 'PLANANDO',
};
