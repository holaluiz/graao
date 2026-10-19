/**
 * GraaoSphericalCharacterController: fixed-step character movement on the spherical planet, shared by client
 * prediction and the authoritative server. WASD intent arrives as a world-space wish direction which is projected onto
 * the tangent plane of the character's own localUp; gravity is radial; Rapier's kinematic character controller resolves
 * collisions with its "up" set to localUp every step. Animation never moves the capsule (no root motion).
 */
import { ABILITY_RULES, MOVEMENT, PLANET, SurfaceFlag, TRAVERSAL, TraversalMode } from '@graao/game-data';
import {
  InputButton,
  MovementState,
  v3,
  v3addScaled,
  v3assign,
  v3cross,
  v3dot,
  v3len,
  v3normalize,
  v3projectOnPlane,
  v3rotateAxis,
  v3set,
  AIM_SCALE,
  WISH_SCALE,
  type InputCmd,
  type Vec3,
} from '@graao/shared';
import { Group, groups, quatFromUp, type GamePhysics } from './physics';
import { transportTangent } from './sphere';
import { GLIDE_STEPS, MANTLE_STEPS, TraversalCap, TraversalProbe, releaseTraversal, steps, traversalMoveState, wallInput, type Grab, type WallHit } from './traversal';
import { newWindSample, sampleWind } from './wind';

const v3scaleLocal = (v: Vec3, factor: number): Vec3 => ({ x: v.x * factor, y: v.y * factor, z: v.z * factor });

export interface CharacterState {
  /** Feet position (capsule bottom), world space. */
  pos: Vec3;
  vel: Vec3;
  /** Unit tangent the character faces. */
  facing: Vec3;
  /** Unit world-space aim direction (camera). */
  aim: Vec3;
  grounded: boolean;
  /** Seconds since last grounded (coyote time). */
  airTime: number;
  /** Seconds left in which a buffered jump fires on landing. */
  jumpBuffer: number;
  jumpHeld: boolean;
  /** The double jump was used in this flight (recharged on the ground or in the water). Replicated as SnapFlag.AIR_JUMPED. */
  airJumped: boolean;
  aiming: boolean;
  moveState: MovementState;
  /** Dash (ability primitive): fixed steps left, world direction (re-projected every step) and speed (m/s). */
  dashSteps: number;
  dashDir: Vec3;
  dashSpeed: number;
  /** Movement speed multiplier (1 = normal; < 1 while slowed by an ability). */
  slow: number;
  /** Skydiving out of the UFO: capped fall, wide steering, no jumps; cleared on the first ground or water contact. */
  diving: boolean;
  /** Floating in deep water (see MOVEMENT.swim*). Replicated as MovementState.SWIM. */
  swimming: boolean;
  /** Authoritative ability movement, also replayed by the owning client's fixed-step motor. */
  abilityMovement?: CharacterAbilityMovement;
  rooted?: boolean;
  noSprint?: boolean;
  /** Passive air steering multiplier (1 = normal). */
  airControl?: number;
  /** Applies only to sprinting (out-of-combat passive), never to ordinary running or aiming. */
  sprintSpeed?: number;
  /** One magical extra jump per flight, distinct from the normal double jump. */
  abilityJumpUsed?: boolean;
  /**
   * Vertical traversal mode (TraversalMode: ledge hang, mantle, climb, glide; docs/gameplay/TRAVERSAL_STATES.md).
   * Replicated as MovementState; the wall, the ledge top and the mantle path are re-derived from the geometry each step.
   */
  traversal: TraversalMode;
  /** Stamina (0..TRAVERSAL.stamina.max): hanging, climbing, mantling and gliding spend it, the ground refills it. */
  stamina: number;
  /** Whole fixed steps spent in the current traversal mode (mantle timeout, minimum hang). */
  travSteps: number;
  /** Whole fixed steps of glide used in this flight (refilled on the ground and in the water). */
  glideSteps: number;
  /** Whole fixed steps before another ledge or wall may be grabbed (no regrab spam, no height farming). */
  grabCooldown: number;
  /**
   * Radial distance (m from the planet centre) of the ledge top being hung from or pulled up over (0: none). The
   * edge's height decides every step of a hang and a mantle; replicated in mm so a client rebuilds the same ledge.
   */
  ledgeR: number;
  /** Sprint was held in the previous command: its rising edge lets go of a ledge or a wall. */
  sprintHeld: boolean;
  /** Traversal this character may start (TraversalCap bits; absent = all). The server gives bots none for now. */
  traversalCaps?: number;
}

export interface CharacterAbilityMovement {
  mode: 'grapple' | 'glide' | 'flight';
  remaining: number;
  speed: number;
  gravityFactor: number;
  airControl: number;
  lift: number;
  anchor?: Vec3;
  originHeight?: number;
}

export interface CharacterInput {
  wish: Vec3;
  aim: Vec3;
  buttons: number;
}

export function createCharacterState(pos: Vec3, facing: Vec3): CharacterState {
  return {
    pos: { ...pos },
    vel: v3(),
    facing: { ...facing },
    aim: { ...facing },
    grounded: false,
    airTime: 0,
    jumpBuffer: 0,
    jumpHeld: false,
    airJumped: false,
    aiming: false,
    moveState: MovementState.FALL,
    dashSteps: 0,
    dashDir: v3(),
    dashSpeed: 0,
    slow: 1,
    diving: false,
    swimming: false,
    traversal: TraversalMode.NONE,
    stamina: TRAVERSAL.stamina.max,
    travSteps: 0,
    glideSteps: 0,
    grabCooldown: 0,
    ledgeR: 0,
    sprintHeld: false,
  };
}

const SEA_RADIUS = PLANET.radius + PLANET.seaLevel;

/**
 * How deep (m) a point lies under the sea surface (negative above it). The water is one sphere, so wherever the
 * terrain dips below it (lakes, the sea, the fissure floor) a character's feet at depth > 0 stand in water.
 */
export function waterDepth(p: Vec3): number {
  return SEA_RADIUS - v3len(p);
}

/** Speed fraction while wading with the feet `depth` m under the surface (knee deep → chest deep). */
export function wadeFactor(depth: number): number {
  const t = Math.min(1, Math.max(0, (depth - 0.15) / (MOVEMENT.swimEnterDepth - 0.15)));
  return 1 - (1 - MOVEMENT.wadeSlow) * t * t * (3 - 2 * t);
}

/** The head is under the water: only diving or plunging gets the feet that deep (wading turns into swimming first). */
export function headUnderWater(feet: Vec3): boolean {
  return waterDepth(feet) > MOVEMENT.breathDepth;
}

/** Air left (s) after `dt`: drains with the head under water, refills `breathRefill`× faster above it. */
export function stepBreath(breath: number, feet: Vec3, dt: number): number {
  return headUnderWater(feet) ? Math.max(0, breath - dt) : Math.min(MOVEMENT.breathTime, breath + dt * MOVEMENT.breathRefill);
}

export function cloneCharacterState(s: CharacterState): CharacterState {
  return { ...s, pos: { ...s.pos }, vel: { ...s.vel }, facing: { ...s.facing }, aim: { ...s.aim }, dashDir: { ...s.dashDir },
    ...(s.abilityMovement ? { abilityMovement: { ...s.abilityMovement, ...(s.abilityMovement.anchor ? { anchor: { ...s.abilityMovement.anchor } } : {}) } } : {}),
  };
}

/**
 * Dash primitive: from the next step on, the character moves `distance` m along `dir` (projected on its ground plane)
 * in whole fixed steps (integer count, so client prediction and server agree exactly). Steering, gravity and jumps
 * pause meanwhile. Returns false when the direction is unusable.
 */
export function startDash(s: CharacterState, dir: Vec3, distance: number, duration: number, dt: number): boolean {
  const up = v3normalize(s.pos);
  const flat = v3projectOnPlane(dir, up);
  if (v3len(flat) < 1e-3) return false;
  const steps = Math.max(1, Math.round(duration / dt));
  s.dashSteps = steps;
  // The raw (network-quantized) direction is kept and re-projected every step, so a client that rebuilds a dash in
  // the middle (reconciliation) gets exactly the server's motion without knowing where it started.
  v3normalize(dir, s.dashDir);
  s.dashSpeed = distance / (steps * dt);
  return true;
}

/** Decodes a compact input command into a reusable CharacterInput. */
export function decodeInput(cmd: InputCmd, out: CharacterInput): CharacterInput {
  v3set(out.wish, cmd[1] / WISH_SCALE, cmd[2] / WISH_SCALE, cmd[3] / WISH_SCALE);
  v3set(out.aim, cmd[4] / AIM_SCALE, cmd[5] / AIM_SCALE, cmd[6] / AIM_SCALE);
  out.buttons = cmd[7];
  return out;
}

export const newInput = (): CharacterInput => ({ wish: v3(), aim: { x: 0, y: 0, z: 1 }, buttons: 0 });

const CAPSULE_CENTER = MOVEMENT.capsuleHalfHeight + MOVEMENT.capsuleRadius;
/** Ground tilts the slope step applies to: from 4° (flatter is just ground) to the climb limit. */
const SLOPE_MIN_COS = Math.cos((4 * Math.PI) / 180);
const SLOPE_MAX_COS = Math.cos((MOVEMENT.maxSlopeClimbDeg * Math.PI) / 180);
const PLAYER_GROUPS = groups(Group.PLAYER, Group.TERRAIN | Group.PROP | Group.CHEST | Group.BARRIER | Group.RAIL);
/** Wall probe heights over the feet while climbing (knees to head). */
const CLIMB_PROBES = [0.35, 0.9, 1.45] as const;
/** Face probes from the knees to just under a ledge `edge` m over the feet, 0.15 m apart (a thin eave board or a slab's lip between two probes would let the capsule drift in under it). */
const FACE_PROBES = Array.from({ length: 16 }, (_, i) => 0.05 + i * 0.15);
const faceProbes = (edge: number): number[] => FACE_PROBES.filter((h) => h < edge - 0.02);
/** Probes just under a ledge `edge` m over the feet: the face the hands hang over. */
const ledgeProbes = (edge: number): number[] => [edge - 0.05, edge - 0.15, edge - 0.3, edge - 0.5];
const HANG_MIN_STEPS = steps(0.12);
const REGRAB = steps(TRAVERSAL.cooldown.regrab);
const EXHAUST = steps(TRAVERSAL.cooldown.afterExhaust);
const AFTER_MANTLE = steps(TRAVERSAL.cooldown.afterMantle);
const UP_TRAVERSAL_SPEED = Math.max(TRAVERSAL.mantle.riseSpeed, TRAVERSAL.hang.snapSpeed);

/** One character's Rapier objects: a parentless capsule collider moved by the shared kinematic controller. */
export interface CharacterBody {
  collider: ReturnType<GamePhysics['world']['createCollider']>;
  dispose(): void;
}

export class CharacterMotor {
  private readonly controller;
  private readonly tmpUp = v3();
  private readonly tmpWish = v3();
  private readonly tmpH = v3();
  private readonly tmpTarget = v3();
  private readonly tmpAxis = v3();
  private readonly tmpDesired = v3();
  private readonly tmpCenter = v3();
  private readonly tmpNewUp = v3();
  private snapping = true;
  /**
   * The chest colliders this motor's characters collide with. The server's world is shared by every room, so a room
   * passes its own chests; null (the client: one room per world) collides with every chest.
   */
  chestFilter: ReadonlySet<number> | null = null;
  barrierFilter: ReadonlySet<number> | null = null;
  /** Like `chestFilter`, for the doors and crates of the room (interactiveSystem.ts). */
  interactiveFilter: ReadonlySet<number> | null = null;
  private readonly predicate = (c: { handle: number }): boolean =>
    (this.chestFilter === null || !this.physics.chestHandles.has(c.handle) || this.chestFilter.has(c.handle))
    && (this.barrierFilter === null || !this.physics.barrierHandles.has(c.handle) || this.barrierFilter.has(c.handle))
    && (this.interactiveFilter === null || !this.physics.interactiveHandles.has(c.handle) || this.interactiveFilter.has(c.handle));

  /** Traversal geometry queries (ledges, walls, room on top), through this motor's collider filter. */
  readonly probe: TraversalProbe;
  private readonly tmpDrop = v3();
  /**
   * Event winds blowing now (indices into physics.winds whose bell rings: interactives.ts); null = none. The room's
   * InteractiveSystem owns the set (server), its mirror the client's.
   */
  windActive: ReadonlySet<number> | null = null;
  private readonly windOn = (i: number): boolean => this.windActive?.has(i) ?? false;
  private readonly wind = newWindSample();

  constructor(private readonly physics: GamePhysics) {
    this.probe = new TraversalProbe(physics, () => (this.foreign() ? this.predicate : undefined));
    const c = physics.world.createCharacterController(MOVEMENT.skin);
    c.setMaxSlopeClimbAngle((MOVEMENT.maxSlopeClimbDeg * Math.PI) / 180);
    c.setMinSlopeSlideAngle((MOVEMENT.minSlopeSlideDeg * Math.PI) / 180);
    c.enableAutostep(MOVEMENT.autostepHeight, MOVEMENT.autostepMinWidth, false);
    c.enableSnapToGround(MOVEMENT.snapToGround);
    c.setApplyImpulsesToDynamicBodies(false);
    c.setSlideEnabled(true);
    this.controller = c;
  }

  /** Does this world hold chests, barriers or crates of other rooms (then queries must filter them out)? */
  private foreign(): boolean {
    return (this.chestFilter !== null && this.physics.chestHandles.size > this.chestFilter.size)
      || (this.barrierFilter !== null && this.physics.barrierHandles.size > this.barrierFilter.size)
      || (this.interactiveFilter !== null && this.physics.interactiveHandles.size > this.interactiveFilter.size);
  }

  private setSnap(snap: boolean): void {
    if (snap === this.snapping) return;
    if (snap) this.controller.enableSnapToGround(MOVEMENT.snapToGround);
    else this.controller.disableSnapToGround();
    this.snapping = snap;
  }

  /**
   * Moves the capsule by `desired` through the controller (no snapping), applies it; returns the motion done. The
   * controller's own grounded flag is not used here: pressed against a wall it can report ground (traversal asks the
   * ground explicitly, `probe.groundBelow`).
   */
  private traverseBy(body: CharacterBody, s: CharacterState, up: Vec3, desired: Vec3): Vec3 {
    this.setSnap(false);
    this.controller.setUp(up);
    this.placeCollider(body.collider, s.pos);
    this.controller.computeColliderMovement(body.collider, desired, undefined, PLAYER_GROUPS, this.foreign() ? this.predicate : undefined);
    const m = this.controller.computedMovement();
    const mv = { x: m.x, y: m.y, z: m.z };
    s.pos.x += mv.x;
    s.pos.y += mv.y;
    s.pos.z += mv.z;
    this.placeCollider(body.collider, s.pos);
    return mv;
  }

  /**
   * When the ground under `feet` is a climbable slope (4° to the climb limit), rewrites `desired` as the horizontal
   * velocity `h` turned onto the ground plane at the same speed (plus the grounded downward bias `vs`); returns
   * whether it did. Deterministic: one ray against the same world.
   */
  private slopeAlong(feet: Vec3, up: Vec3, h: Vec3, dt: number, vs: number, desired: Vec3): boolean {
    const speed = v3len(h);
    if (speed < 0.1) return false;
    const origin = v3addScaled(feet, up, 0.3, this.tmpCenter);
    const hit = this.physics.castRayNormal(origin, { x: -up.x, y: -up.y, z: -up.z }, 0.75, PLAYER_GROUPS, this.predicate);
    if (!hit || hit.toi < 0.05) return false;
    const n = hit.normal;
    const cos = v3dot(n, up);
    if (cos > SLOPE_MIN_COS || cos < SLOPE_MAX_COS) return false;
    const k = v3dot(h, n);
    const ax = h.x - n.x * k, ay = h.y - n.y * k, az = h.z - n.z * k;
    const al = Math.hypot(ax, ay, az);
    if (al < 1e-6) return false;
    const f = speed / al;
    v3set(desired, (ax * f + up.x * vs) * dt, (ay * f + up.y * vs) * dt, (az * f + up.z * vs) * dt);
    return true;
  }

  // ---------------------------------------------------------------------------------------------- traversal

  /** Enters the mode a grab found: the body stops, faces the wall, and the step loop takes it from there. */
  private beginGrab(s: CharacterState, grab: Grab): void {
    if (s.abilityMovement?.mode === 'glide') delete s.abilityMovement;
    s.traversal = grab.kind === 'mantle' ? TraversalMode.MANTLE : grab.kind === 'hang' ? TraversalMode.HANG : TraversalMode.CLIMB;
    s.travSteps = 0;
    s.grounded = false;
    s.jumpBuffer = 0;
    v3set(s.vel, 0, 0, 0);
    v3set(s.facing, -grab.wall.flat.x, -grab.wall.flat.y, -grab.wall.flat.z);
    s.ledgeR = grab.kind === 'climb' ? 0 : v3len(s.pos) + grab.top.height;
    if (grab.kind === 'mantle') s.stamina = Math.max(0, s.stamina - TRAVERSAL.stamina.mantle);
  }

  /** Lets go: falls from where it is, no grab for `cooldown` steps. */
  private drop(s: CharacterState, cooldown = REGRAB): void {
    releaseTraversal(s, cooldown);
    s.airTime = MOVEMENT.coyoteTime;
  }

  /** Jumps off a ledge or a wall: away from it and up. */
  private jumpOff(s: CharacterState, wall: WallHit, up: Vec3): void {
    const c = TRAVERSAL.climb;
    v3set(s.vel, wall.flat.x * c.jumpOffSpeed + up.x * c.jumpOffLift, wall.flat.y * c.jumpOffSpeed + up.y * c.jumpOffLift, wall.flat.z * c.jumpOffSpeed + up.z * c.jumpOffLift);
    v3assign(s.facing, wall.flat);
    s.stamina = Math.max(0, s.stamina - TRAVERSAL.stamina.wallJump);
    this.drop(s);
  }

  /** Starts pulling up over the ledge whose top is `top` m over the feet (the path is the controller's, step by step). */
  private beginMantle(s: CharacterState, wall: WallHit, top: number): void {
    s.traversal = TraversalMode.MANTLE;
    s.travSteps = 0;
    s.ledgeR = v3len(s.pos) + top;
    v3set(s.facing, -wall.flat.x, -wall.flat.y, -wall.flat.z);
    s.stamina = Math.max(0, s.stamina - TRAVERSAL.stamina.mantle);
  }

  /** Reaches the top of a mantle or the foot of a wall: ordinary locomotion again, standing. */
  private stand(s: CharacterState, exitSpeed: number, cooldown: number): void {
    s.traversal = TraversalMode.NONE;
    s.travSteps = 0;
    s.ledgeR = 0;
    s.grounded = true;
    s.airTime = 0;
    s.airJumped = false;
    s.abilityJumpUsed = false;
    s.grabCooldown = Math.max(s.grabCooldown, cooldown);
    v3set(s.vel, s.facing.x * exitSpeed, s.facing.y * exitSpeed, s.facing.z * exitSpeed);
  }

  /**
   * One step of a ledge hang, a mantle or a climb (docs/gameplay/TRAVERSAL_STATES.md). Input edges (jump, sprint) come
   * from the previous command's held state, like the ground jump. No aiming, no buffered jump out of a wall.
   */
  private stepTraversal(body: CharacterBody, s: CharacterState, inp: CharacterInput, dt: number, up: Vec3): void {
    const jumpDown = (inp.buttons & InputButton.JUMP) !== 0;
    const sprintDown = (inp.buttons & InputButton.SPRINT) !== 0;
    const jumpEdge = jumpDown && !s.jumpHeld;
    const sprintEdge = sprintDown && !s.sprintHeld;
    s.jumpHeld = jumpDown;
    s.sprintHeld = sprintDown;
    s.jumpBuffer = 0;
    s.aiming = false;
    if (v3len(inp.aim) > 0.5) v3normalize(inp.aim, s.aim);
    s.travSteps++;
    const wish = v3projectOnPlane(inp.wish, up, this.tmpWish);
    const wl = v3len(wish);
    if (wl > 1) v3set(wish, wish.x / wl, wish.y / wl, wish.z / wl);
    if (s.traversal === TraversalMode.MANTLE) this.stepMantle(body, s, dt, up);
    else if (s.traversal === TraversalMode.HANG) this.stepHang(body, s, wish, jumpEdge, sprintEdge, dt, up);
    else this.stepClimb(body, s, wish, jumpEdge, sprintEdge, dt, up);
    if (s.traversal !== TraversalMode.NONE) s.moveState = traversalMoveState(s.traversal)!;
    else s.moveState = s.grounded ? MovementState.IDLE : MovementState.FALL;
  }

  private stepHang(body: CharacterBody, s: CharacterState, wish: Vec3, jumpEdge: boolean, sprintEdge: boolean, dt: number, up: Vec3): void {
    const r = TRAVERSAL.reach;
    const h = TRAVERSAL.hang;
    // The ledge is where it was grabbed: probe the face just under its top, then the top itself (it may slope along a
    // shimmy: follow it).
    const edge = s.ledgeR - v3len(s.pos);
    const wall = this.probe.wall(s.pos, up, s.facing, ledgeProbes(edge), r.wallReach, r.wallMaxUp, r.reachBack);
    const top = wall && wall.flags ? this.probe.ledgeTop(s.pos, up, wall, edge - 0.3, edge + 0.3) : null;
    if (!wall || !top) return this.drop(s);
    s.ledgeR = v3len(s.pos) + top.height;
    s.stamina = Math.max(0, s.stamina - TRAVERSAL.stamina.hang * dt);
    if (s.stamina <= 0) return this.drop(s, EXHAUST);
    const input = wallInput(wish, wall.flat, up);
    const caps = s.traversalCaps ?? TraversalCap.ALL;
    if (jumpEdge) {
      if (input.toward < -0.5) return this.jumpOff(s, wall, up);
      if (this.probe.canMantle(s.pos, up, wall, top)) return this.beginMantle(s, wall, top.height);
    }
    if (sprintEdge) return this.drop(s);
    if (input.toward > 0.5 && s.travSteps >= HANG_MIN_STEPS && this.probe.canMantle(s.pos, up, wall, top)) return this.beginMantle(s, wall, top.height);
    if (input.toward < -0.5) {
      if (wall.flags & SurfaceFlag.CLIMB && caps & TraversalCap.CLIMB) {
        s.traversal = TraversalMode.CLIMB;
        s.travSteps = 0;
        s.ledgeR = 0;
      } else return this.drop(s);
    }
    // Shimmy only where the ledge goes on (probed one step ahead along the wall).
    let side = Math.abs(input.side) > 0.3 ? input.side : 0;
    if (side !== 0) {
      const ahead = v3addScaled(s.pos, input.right, Math.sign(side) * (MOVEMENT.capsuleRadius + 0.1), this.tmpTarget);
      const e2 = s.ledgeR - v3len(ahead);
      const w2 = this.probe.wall(ahead, up, s.facing, ledgeProbes(e2), r.wallReach, r.wallMaxUp, r.reachBack);
      if (!w2 || !w2.flags || !this.probe.ledgeTop(ahead, up, w2, e2 - 0.3, e2 + 0.3)) side = 0;
    }
    // Slide into the hang place: the wall gap, the hands on the edge, plus the shimmy (all through the controller).
    const k = UP_TRAVERSAL_SPEED * dt;
    const into = Math.max(-k, Math.min(k, wall.dist - (MOVEMENT.capsuleRadius + h.gap)));
    const lift = Math.max(-k, Math.min(k, top.height - h.depth));
    const sideMove = side * h.shimmySpeed * dt;
    const desired = v3set(this.tmpDesired,
      -wall.flat.x * into + up.x * lift + input.right.x * sideMove,
      -wall.flat.y * into + up.y * lift + input.right.y * sideMove,
      -wall.flat.z * into + up.z * lift + input.right.z * sideMove);
    const mv = this.traverseBy(body, s, up, desired);
    v3set(s.vel, mv.x / dt, mv.y / dt, mv.z / dt);
    v3set(s.facing, -wall.flat.x, -wall.flat.y, -wall.flat.z);
    s.grounded = false;
    // Hanging so low the feet touch the ground: just standing.
    if (lift <= 0.01 && this.probe.groundBelow(s.pos, up, 0.06)) this.stand(s, 0, REGRAB);
  }

  private stepMantle(body: CharacterBody, s: CharacterState, dt: number, up: Vec3): void {
    const m = TRAVERSAL.mantle;
    const f = s.facing;
    // Rise along the wall until the feet clear the top just past the face, then move forward onto it (once moving
    // forward it keeps going: a pitched roof rising ahead is walked up, not risen to).
    // Moving forward (and not rising: closing in on the wall while rising is not the forward phase).
    const forward = v3dot(s.vel, f) > 0.5 * m.forwardSpeed && v3dot(s.vel, up) < 0.8 * m.riseSpeed;
    // Rise until the feet clear the ledge that was grabbed, keeping the hang gap to the most prominent face under it (a
    // slab's lip, an eave board, a cornice: closer would catch it on the way up).
    const edge = s.ledgeR - v3len(s.pos);
    const rising = !forward && edge > -m.clearance;
    let into = 0;
    if (rising) {
      const r = TRAVERSAL.reach;
      const face = this.probe.wall(s.pos, up, f, faceProbes(edge), r.wallReach, r.wallMaxUp, r.reachBack);
      const dist = face ? face.dist : MOVEMENT.capsuleRadius + TRAVERSAL.hang.gap;
      into = Math.max(-m.forwardSpeed * dt, Math.min(m.forwardSpeed * dt, dist - (MOVEMENT.capsuleRadius + TRAVERSAL.hang.gap)));
    }
    const desired = rising
      ? v3set(this.tmpDesired, up.x * m.riseSpeed * dt + f.x * into, up.y * m.riseSpeed * dt + f.y * into, up.z * m.riseSpeed * dt + f.z * into)
      // Forward with a little settling down onto the top (a pitched roof going up is climbed by the controller).
      : v3set(this.tmpDesired, (f.x * m.forwardSpeed - up.x) * dt, (f.y * m.forwardSpeed - up.y) * dt, (f.z * m.forwardSpeed - up.z) * dt);
    const mv = this.traverseBy(body, s, up, desired);
    v3set(s.vel, mv.x / dt, mv.y / dt, mv.z / dt);
    s.grounded = false;
    // Blocked on the way up (a ceiling the start check could not see coming) or too long: let go.
    if ((rising && v3dot(mv, up) < 0.3 * m.riseSpeed * dt) || s.travSteps > MANTLE_STEPS) return this.drop(s);
    // Done when the back of the capsule stands over the top.
    if (!rising) {
      const back = v3addScaled(s.pos, f, -(MOVEMENT.capsuleRadius - 0.05), this.tmpTarget);
      if (this.probe.groundBelow(back, up, 0.35)) this.stand(s, m.exitSpeed, AFTER_MANTLE);
    }
  }

  private stepClimb(body: CharacterBody, s: CharacterState, wish: Vec3, jumpEdge: boolean, sprintEdge: boolean, dt: number, up: Vec3): void {
    const c = TRAVERSAL.climb;
    const st = TRAVERSAL.stamina;
    const wall = this.probe.wall(s.pos, up, s.facing, CLIMB_PROBES, MOVEMENT.capsuleRadius + 0.6, c.wallMaxUp);
    if (!wall || !(wall.flags & SurfaceFlag.CLIMB)) return this.drop(s);
    const input = wallInput(wish, wall.flat, up);
    const toward = Math.abs(input.toward) > 0.15 ? input.toward : 0;
    const side = Math.abs(input.side) > 0.15 ? input.side : 0;
    const drain = Math.max(st.climbIdle, (toward > 0 ? st.climbUp * toward : -st.climbDown * toward) + st.climbSide * Math.abs(side));
    s.stamina = Math.max(0, s.stamina - drain * dt);
    if (s.stamina <= 0) return this.drop(s, EXHAUST);
    if (jumpEdge) return this.jumpOff(s, wall, up);
    if (sprintEdge) return this.drop(s);
    // Climbing up to where the wall ends near the hands: pull up over the top.
    if (toward > 0.3) {
      const top = this.probe.ledgeTop(s.pos, up, wall, 1.0, TRAVERSAL.reach.ledgeMax);
      if (top && this.probe.canMantle(s.pos, up, wall, top)) return this.beginMantle(s, wall, top.height);
    }
    // Along the wall: its own up (a leaning slab is climbed along its slope) and right.
    const n = wall.normal;
    const nu = v3dot(n, up);
    const wallUp = v3normalize({ x: up.x - n.x * nu, y: up.y - n.y * nu, z: up.z - n.z * nu });
    const wallRight = v3normalize(v3cross(wallUp, n));
    const vUp = toward >= 0 ? c.upSpeed * toward : c.downSpeed * toward;
    const vSide = c.sideSpeed * side;
    // Keep the capsule `gap` off the face (the gap measured across the face, not along the probe).
    const gap = wall.dist * v3dot(wall.flat, n) - (MOVEMENT.capsuleRadius + c.gap);
    const stick = Math.max(-c.stick * dt * 3, Math.min(c.stick * dt * 3, gap));
    const desired = v3set(this.tmpDesired,
      (wallUp.x * vUp + wallRight.x * vSide) * dt - n.x * stick,
      (wallUp.y * vUp + wallRight.y * vSide) * dt - n.y * stick,
      (wallUp.z * vUp + wallRight.z * vSide) * dt - n.z * stick);
    const mv = this.traverseBy(body, s, up, desired);
    v3set(s.vel, mv.x / dt, mv.y / dt, mv.z / dt);
    v3set(s.facing, -wall.flat.x, -wall.flat.y, -wall.flat.z);
    s.grounded = false;
    // Climbing down onto the ground (or standing at the foot of the wall without pushing up): walk away.
    if (toward <= 0.1 && this.probe.groundBelow(s.pos, up, 0.08)) this.stand(s, 0, REGRAB);
  }

  createBody(state: CharacterState): CharacterBody {
    const { R, world } = this.physics;
    const desc = R.ColliderDesc.capsule(MOVEMENT.capsuleHalfHeight, MOVEMENT.capsuleRadius).setCollisionGroups(
      groups(Group.PLAYER, Group.TERRAIN | Group.PROP | Group.BARRIER | Group.RAIL),
    );
    const collider = world.createCollider(desc);
    this.placeCollider(collider, state.pos);
    return {
      collider,
      dispose: () => world.removeCollider(collider, false),
    };
  }

  /** Moves the capsule so its bottom sits at `feet`, aligned with localUp. */
  placeCollider(collider: CharacterBody['collider'], feet: Vec3): void {
    const up = v3normalize(feet, this.tmpUp);
    collider.setTranslation(v3addScaled(feet, up, CAPSULE_CENTER, this.tmpCenter));
    collider.setRotation(quatFromUp(up));
  }

  /** Advances `s` by one fixed step `dt` with input `inp`. Deterministic for the same state, input and world. */
  step(body: CharacterBody, s: CharacterState, inp: CharacterInput, dt: number): void {
    const up = v3normalize(s.pos, this.tmpUp);
    if (s.abilityMovement) {
      s.abilityMovement.remaining = Math.max(0, s.abilityMovement.remaining - dt);
      if (s.abilityMovement.remaining <= 0 || s.swimming || s.rooted || (s.grounded && s.abilityMovement.mode === 'glide')) delete s.abilityMovement;
    }
    const abilityMove = s.abilityMovement;
    if (s.rooted) s.dashSteps = 0;
    if (s.grabCooldown > 0) s.grabCooldown--;
    // Water: touching the surface ends a dive; deep enough the character swims until the bottom lifts the feet near
    // the surface again (hysteresis, so wading at chest depth does not flicker in and out of swimming).
    const depth = waterDepth(s.pos);
    if (s.diving && depth > 0) s.diving = false;
    if (!s.swimming && depth > MOVEMENT.swimEnterDepth) s.swimming = true;
    else if (s.swimming && depth < MOVEMENT.swimExitDepth) s.swimming = false;
    const diving = s.diving;
    const swimming = s.swimming;
    if (swimming) { s.airJumped = false; s.abilityJumpUsed = false; s.glideSteps = 0; }
    // Hanging, mantling and climbing own the step; water, a dive, a snare, a dash or an ability's movement end them.
    if (s.traversal === TraversalMode.HANG || s.traversal === TraversalMode.MANTLE || s.traversal === TraversalMode.CLIMB) {
      if (swimming || diving || s.rooted || abilityMove || s.dashSteps > 0) releaseTraversal(s);
      else {
        this.stepTraversal(body, s, inp, dt, up);
        return;
      }
    }
    const jumpDown = !diving && !s.rooted && (inp.buttons & InputButton.JUMP) !== 0;
    const sprint = !s.noSprint && (inp.buttons & InputButton.SPRINT) !== 0;
    s.sprintHeld = (inp.buttons & InputButton.SPRINT) !== 0;
    // Universal glide: held jump while falling, closed by letting go, landing, water, any ability movement, a dash,
    // a snare, or running out of glide time or stamina.
    if (s.traversal === TraversalMode.GLIDE && (!jumpDown || s.grounded || swimming || diving || abilityMove || s.dashSteps > 0 || s.glideSteps >= GLIDE_STEPS || s.stamina <= 0)) {
      s.traversal = TraversalMode.NONE;
      s.travSteps = 0;
    }
    const gliding = s.traversal === TraversalMode.GLIDE;
    // Hands are spread while skydiving, stroking while swimming and on the glider: no aiming, no firing pose.
    const handsFree = !diving && !swimming && abilityMove?.mode !== 'flight' && !gliding;
    s.aiming = handsFree && (inp.buttons & InputButton.AIM) !== 0;
    const firing = handsFree && (inp.buttons & InputButton.FIRE) !== 0;
    if (v3len(inp.aim) > 0.5) v3normalize(inp.aim, s.aim);

    // Wish direction on the tangent plane, length ≤ 1.
    const wish = v3projectOnPlane(inp.wish, up, this.tmpWish);
    if (s.rooted) v3set(wish, 0, 0, 0);
    const wl = v3len(wish);
    if (wl > 1) v3set(wish, wish.x / wl, wish.y / wl, wish.z / wl);
    const wishLen = Math.min(1, wl);

    // Split velocity into vertical (along up) and horizontal (tangent).
    let vs = v3dot(s.vel, up);
    const h = v3projectOnPlane(s.vel, up, this.tmpH);

    const forwardish = wishLen > 0.1 ? v3dot(wish, s.facing) / Math.max(wishLen, 1e-6) : 0;
    const canSprint = handsFree && sprint && !s.aiming && !firing && forwardish > 0.3;
    const maxSpeed = abilityMove?.mode === 'flight' || abilityMove?.mode === 'glide' ? abilityMove.speed * s.slow : gliding ? TRAVERSAL.glide.speed * s.slow : diving
      ? sprint
        ? MOVEMENT.diveFastSpeed
        : MOVEMENT.diveSpeed
      : swimming
        ? MOVEMENT.swimSpeed * s.slow
        : (s.aiming || firing ? MOVEMENT.aimSpeed : canSprint ? MOVEMENT.sprintSpeed : MOVEMENT.runSpeed)
          * (canSprint ? Math.min(ABILITY_RULES.maxSpeedFactor, s.slow * (s.sprintSpeed ?? 1)) : s.slow) * (depth > 0 ? wadeFactor(depth) : 1);
    const dashing = s.dashSteps > 0;
    // Wind volumes (wind.ts), in the air only. A directional wind moves the air itself: steering aims at the wish plus
    // the wind's velocity, so a body with no input is carried along at its speed (a share of it without the glider);
    // an updraft is applied to the vertical speed below. Each acts toward a target speed, so nothing piles up.
    const kite = gliding || abilityMove?.mode === 'glide';
    const windy = !s.grounded && !swimming && !diving && !dashing && !s.rooted && abilityMove?.mode !== 'flight' && abilityMove?.mode !== 'grapple' && this.physics.winds.length > 0;
    const w = windy ? sampleWind(this.physics.winds, this.windOn, s.pos, up, this.wind) : null;
    const push = w ? w.push * (kite ? 1 : TRAVERSAL.wind.noGlideShare) : 0;
    if (dashing) {
      // Dash: a fixed ground-plane velocity along the dash direction; no steering.
      const dd = v3normalize(v3projectOnPlane(s.dashDir, up, this.tmpTarget), this.tmpTarget);
      v3set(h, dd.x * s.dashSpeed, dd.y * s.dashSpeed, dd.z * s.dashSpeed);
    } else {
      const target = v3set(this.tmpTarget, wish.x * maxSpeed, wish.y * maxSpeed, wish.z * maxSpeed);
      if (push > 0) v3addScaled(target, w!.dir, push, target);
      // Accelerate horizontal velocity toward the target.
      // A swimmer whose feet touch the bottom pushes off it like on land (climbing the shore slope out of a lake
      // would otherwise bleed the weak swim acceleration away).
      const accel = diving
        ? MOVEMENT.diveAccel
        : swimming && !s.grounded
          ? MOVEMENT.swimAccel
          : s.grounded
            ? wishLen > 0.05
              ? MOVEMENT.groundAccel
              : MOVEMENT.groundDecel
            : Math.max(gliding ? TRAVERSAL.glide.accel : MOVEMENT.airAccel, push > 0 ? TRAVERSAL.wind.pushAccel : 0) * (s.airControl ?? 1) * (abilityMove?.airControl ?? 1);
      const dx = target.x - h.x, dy = target.y - h.y, dz = target.z - h.z;
      const dl = Math.hypot(dx, dy, dz);
      const maxDv = accel * dt;
      if (dl <= maxDv) v3assign(h, target);
      else v3addScaled(h, { x: dx, y: dy, z: dz }, maxDv / dl, h);
    }

    // Jump: rising edge buffered, coyote time after leaving ground (not while dashing); then one double jump in the air.
    if (jumpDown && !s.jumpHeld) s.jumpBuffer = MOVEMENT.jumpBuffer;
    s.jumpHeld = jumpDown;
    let jumped = false;
    if (!dashing && s.jumpBuffer > 0) {
      if (swimming) {
        // A hop out of the water, only from the surface (not while still sinking from a plunge).
        if (depth < MOVEMENT.swimFloatDepth + 0.25 && vs > -1) {
          vs = MOVEMENT.swimJumpSpeed;
          s.swimming = false;
          jumped = true;
        }
      } else if ((s.grounded || s.airTime < MOVEMENT.coyoteTime) && vs <= 0.5) {
        vs = MOVEMENT.jumpSpeed;
        jumped = true;
      } else if (!s.grounded && !s.airJumped) {
        // Double jump: a fresh hop whatever the fall, and WASD swings the momentum toward where the player steers.
        vs = MOVEMENT.airJumpSpeed;
        if (wishLen > 0.1) {
          const k = MOVEMENT.airJumpSteer;
          v3set(h, h.x + (wish.x * maxSpeed - h.x) * k, h.y + (wish.y * maxSpeed - h.y) * k, h.z + (wish.z * maxSpeed - h.z) * k);
        }
        s.airJumped = true;
        jumped = true;
      }
      if (jumped) {
        s.jumpBuffer = 0;
        s.grounded = false;
        s.airTime = MOVEMENT.coyoteTime;
      }
    }
    s.jumpBuffer = Math.max(0, s.jumpBuffer - dt);

    // Radial gravity (an air dash glides flat); buoyancy in deep water.
    if (dashing) vs = s.grounded ? -0.5 : 0;
    else if (s.swimming) {
      // Float with the feet swimFloatDepth under the surface; the water brakes any vertical speed (a plunge). Sprint
      // held dives; jump held under water climbs back up fast.
      const target = sprint
        ? -MOVEMENT.swimDiveSpeed
        : jumpDown && depth > MOVEMENT.swimFloatDepth + 0.25
          ? MOVEMENT.swimMaxRise
          : Math.max(-MOVEMENT.swimMaxRise, Math.min(MOVEMENT.swimFloatRise, (depth - MOVEMENT.swimFloatDepth) * MOVEMENT.swimBuoyancy));
      vs += (target - vs) * Math.min(1, MOVEMENT.swimDrag * dt);
    } else if (gliding) {
      // Under the glider: gravity eases toward the glide's fall speed, a faster fall is braked to it. Never upward.
      const g = TRAVERSAL.glide;
      if (vs > -g.fallSpeed) vs = Math.max(-g.fallSpeed, vs - PLANET.gravity * g.gravityFactor * dt);
      else vs = Math.min(-g.fallSpeed, vs + (-g.fallSpeed - vs) * Math.min(1, g.brake * dt));
    } else if (!s.grounded || jumped) vs -= PLANET.gravity * (abilityMove?.gravityFactor ?? 1) * dt;
    else vs = -0.5; // keep contact; snap-to-ground does the rest
    if (diving) {
      // Skydive: the fall is capped (head-first with sprint is faster); slowing down from a faster fall brakes smoothly.
      const terminal = sprint ? MOVEMENT.diveFastTerminalSpeed : MOVEMENT.diveTerminalSpeed;
      if (vs < -terminal) vs = Math.min(-terminal, vs + MOVEMENT.diveBrake * dt);
    } else vs = Math.max(vs, -MOVEMENT.terminalSpeed);

    if (abilityMove?.mode === 'glide') vs = Math.max(vs, -Math.max(1, abilityMove.lift));
    else if (abilityMove?.mode === 'flight') {
      const ceiling = (abilityMove.originHeight ?? v3len(s.pos)) + ABILITY_RULES.maxFlightHeight;
      vs = v3len(s.pos) < ceiling ? Math.max(vs, abilityMove.lift) : Math.min(vs, 0);
      s.grounded = false;
    } else if (abilityMove?.mode === 'grapple' && abilityMove.anchor) {
      const to = { x: abilityMove.anchor.x - s.pos.x, y: abilityMove.anchor.y - s.pos.y, z: abilityMove.anchor.z - s.pos.z };
      const distance = v3len(to);
      if (distance < 0.8) delete s.abilityMovement;
      else {
        const velocity = v3scaleLocal(to, Math.min(abilityMove.speed, distance / Math.max(dt, 1e-4)) / distance);
        v3projectOnPlane(velocity, up, h);
        vs = v3dot(velocity, up);
      }
    }
    // An updraft lifts a glider toward its rise speed, and only slows anyone else's fall (no rise without the kite).
    const inUpdraft = !!w && w.lift > 0 && !jumped;
    if (inUpdraft) {
      const W = TRAVERSAL.wind;
      if (kite) {
        if (vs < w!.lift) vs = Math.min(w!.lift, vs + W.liftAccel * dt);
      } else if (vs < -W.fallCapNoGlide) vs = Math.min(-W.fallCapNoGlide, vs + W.fallBrakeNoGlide * dt);
    }
    // The play zone's radial ceiling: no wind, flight or jump rises past it.
    const altitude = v3len(s.pos) - PLANET.radius;
    if (altitude > TRAVERSAL.ceiling) vs = Math.min(vs, altitude > TRAVERSAL.ceiling + 2 ? -2 : 0);
    if (s.rooted) v3set(h, 0, 0, 0);

    const desired = v3set(this.tmpDesired, (h.x + up.x * vs) * dt, (h.y + up.y * vs) * dt, (h.z + up.z * vs) * dt);
    // On a walkable slope (a stair's ramp, a ladeira, a hillside) the step runs along the ground at the full speed:
    // moving horizontally into it would let the controller slide the speed away (a 31° stair climbed at 1.2 m/s).
    const onSlope = s.grounded && !jumped && !swimming && !diving && !abilityMove && !s.rooted && this.slopeAlong(s.pos, up, h, dt, vs, desired);

    // A floating body must not be pulled down onto the lake bed (the controller is shared: set it every step).
    this.setSnap(!s.swimming);
    this.controller.setUp(up);
    this.placeCollider(body.collider, s.pos);
    // Another room's chests are invisible here (only checked when this world holds chests this motor does not own).
    this.controller.computeColliderMovement(body.collider, desired, undefined, PLAYER_GROUPS, this.foreign() ? this.predicate : undefined);
    const mv = this.controller.computedMovement();
    const groundedNow = this.controller.computedGrounded();

    s.pos.x += mv.x;
    s.pos.y += mv.y;
    s.pos.z += mv.z;
    // Never let the character fall inside the planet (safety net for tunneling).
    const r = v3len(s.pos);
    if (r < PLANET.radius - 30) v3set(s.pos, (s.pos.x / r) * (PLANET.radius + 20), (s.pos.y / r) * (PLANET.radius + 20), (s.pos.z / r) * (PLANET.radius + 20));
    this.placeCollider(body.collider, s.pos);

    const newUp = v3normalize(s.pos, this.tmpNewUp);
    // Horizontal velocity follows what actually happened (walls absorb it), transported to the new tangent plane.
    const actualH = v3projectOnPlane({ x: mv.x / dt, y: mv.y / dt, z: mv.z / dt }, newUp);
    let hl = v3len(actualH);
    let intended = v3len(h);
    // Along a slope the horizontal part of the motion is shorter by design: keep the intended speed unless something
    // (a wall, a railing) actually took most of the step.
    if (onSlope && groundedNow && v3len(mv) >= 0.85 * v3len(desired) && hl > 1e-6) {
      v3set(actualH, (actualH.x / hl) * intended, (actualH.y / hl) * intended, (actualH.z / hl) * intended);
      hl = intended;
    }
    if (dashing && --s.dashSteps === 0) intended = Math.min(intended, MOVEMENT.runSpeed); // leave the dash at run speed
    if (hl > intended && hl > 1e-6) v3set(actualH, (actualH.x / hl) * intended, (actualH.y / hl) * intended, (actualH.z / hl) * intended);
    const movedUp = v3dot({ x: mv.x, y: mv.y, z: mv.z }, up) / dt;
    // Still rising freely (a jump against a wall or a crate): the controller may report contact, but nothing is under
    // the feet yet, so the jump goes on.
    const rising = !swimming && vs > 0.5 && movedUp > vs * 0.5;
    if (groundedNow && !jumped && !rising) {
      vs = 0;
      s.grounded = true;
      s.airTime = 0;
      s.airJumped = false;
      s.abilityJumpUsed = false;
      // First ground contact ends the dive (landing).
      s.diving = false;
    } else {
      // Hit a ceiling: kill upward speed.
      if (vs > 0 && movedUp < vs * 0.5) vs = Math.min(vs, movedUp);
      s.grounded = false;
      s.airTime += dt;
    }
    v3set(s.vel, actualH.x + newUp.x * vs, actualH.y + newUp.y * vs, actualH.z + newUp.z * vs);

    // Traversal bookkeeping: the ground refills stamina and the glide; the glider spends both.
    const st = TRAVERSAL.stamina;
    if (s.grounded) {
      // Landing folds the glider at once (the landing step already reads as on the ground).
      if (s.traversal === TraversalMode.GLIDE) {
        s.traversal = TraversalMode.NONE;
        s.travSteps = 0;
      }
      s.glideSteps = 0;
      if (!swimming) s.stamina = Math.min(st.max, s.stamina + (v3len(actualH) < st.restSpeed ? st.regenRest : st.regenGround) * dt);
    }
    if (s.traversal === TraversalMode.GLIDE) {
      // Riding an updraft does not use up the glide (stamina still drains: no endless hover).
      if (!inUpdraft) s.glideSteps++;
      s.travSteps++;
      s.stamina = Math.max(0, s.stamina - st.glide * dt);
    }
    const caps = s.traversalCaps ?? TraversalCap.ALL;
    const airborne = !s.grounded && !swimming && !s.diving && !dashing && !s.rooted;
    // Grabs: moving into a tagged wall in the air (a ledge to vault or hang from, a climbable face).
    if (airborne && caps & (TraversalCap.LEDGE | TraversalCap.CLIMB) && s.grabCooldown === 0 && wishLen > 0.3
      && (!s.abilityMovement || s.abilityMovement.mode === 'glide')) {
      const dir = v3projectOnPlane(wish, newUp, this.tmpDrop);
      if (v3len(dir) > 1e-3) {
        const grab = this.probe.detect(s, newUp, v3normalize(dir, dir));
        if (grab) {
          this.beginGrab(s, grab);
          s.moveState = traversalMoveState(s.traversal)!;
          return;
        }
      }
    }
    // The glider opens on the way down with jump held, high enough over whatever is below; in an updraft the wind
    // catches it at once (jump held a moment after leaving the ground), rising or not.
    if (airborne && s.traversal === TraversalMode.NONE && caps & TraversalCap.GLIDE && jumpDown && !jumped && !s.abilityMovement
      && s.glideSteps < GLIDE_STEPS && s.stamina >= st.minGlide
      && (inUpdraft
        ? s.airTime >= TRAVERSAL.wind.openAirTime
        : s.airTime >= TRAVERSAL.glide.minAirTime && vs < -TRAVERSAL.glide.minFallSpeed && this.probe.clearBelow(s.pos, newUp, TRAVERSAL.glide.minClearance))) {
      s.traversal = TraversalMode.GLIDE;
      s.travSteps = 0;
    }

    // Facing: transported, then turned toward aim (when aiming/firing) or toward movement.
    transportTangent(s.facing, up, newUp, s.facing);
    let turnTarget: Vec3 | null = null;
    if (dashing) {
      const a = v3projectOnPlane(s.dashDir, newUp);
      if (v3len(a) > 1e-3) turnTarget = v3normalize(a, a);
    } else if (s.aiming || firing) {
      const a = v3projectOnPlane(s.aim, newUp);
      if (v3len(a) > 1e-3) turnTarget = v3normalize(a, a);
    } else if (wishLen > 0.1) {
      turnTarget = v3normalize(v3projectOnPlane(wish, newUp));
    }
    if (turnTarget) {
      const rate = s.aiming || firing ? MOVEMENT.turnRate * 2.2 : MOVEMENT.turnRate;
      const cross = v3cross(s.facing, turnTarget, this.tmpAxis);
      const sin = v3dot(cross, newUp);
      const cos = v3dot(s.facing, turnTarget);
      const ang = Math.atan2(sin, cos);
      const stepAng = Math.max(-rate * dt, Math.min(rate * dt, ang));
      v3rotateAxis(s.facing, newUp, stepAng, s.facing);
      v3normalize(v3projectOnPlane(s.facing, newUp, s.facing), s.facing);
    }

    // Semantic movement state for animation and replication.
    const speed = v3len(actualH);
    if (s.traversal !== TraversalMode.NONE) s.moveState = traversalMoveState(s.traversal)!;
    else if (s.swimming) s.moveState = MovementState.SWIM;
    else if (!s.grounded) s.moveState = vs > 0.5 ? MovementState.JUMP : MovementState.FALL;
    else if (speed < 0.35) s.moveState = MovementState.IDLE;
    else if (speed < MOVEMENT.walkThreshold) s.moveState = MovementState.WALK;
    else if (canSprint && speed > MOVEMENT.runSpeed * 1.05) s.moveState = MovementState.SPRINT;
    else s.moveState = MovementState.RUN;

  }
}

/** Distance (m) from the capsule axis segment of a character at `feet` to point `p` (for hit tests). */
export function capsuleAxis(feet: Vec3): { a: Vec3; b: Vec3; radius: number } {
  const up = v3normalize(feet);
  const r = MOVEMENT.capsuleRadius;
  return {
    a: v3addScaled(feet, up, r),
    b: v3addScaled(feet, up, r + MOVEMENT.capsuleHalfHeight * 2),
    radius: r,
  };
}
