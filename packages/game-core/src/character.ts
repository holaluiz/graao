/**
 * GraaoSphericalCharacterController: fixed-step character movement on the spherical planet, shared by client
 * prediction and the authoritative server. WASD intent arrives as a world-space wish direction which is projected onto
 * the tangent plane of the character's own localUp; gravity is radial; Rapier's kinematic character controller resolves
 * collisions with its "up" set to localUp every step. Animation never moves the capsule (no root motion).
 */
import { MOVEMENT, PLANET } from '@graao/game-data';
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
const PLAYER_GROUPS = groups(Group.PLAYER, Group.TERRAIN | Group.PROP | Group.CHEST | Group.BARRIER | Group.RAIL);

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
  private readonly predicate = (c: { handle: number }): boolean =>
    (this.chestFilter === null || !this.physics.chestHandles.has(c.handle) || this.chestFilter.has(c.handle))
    && (this.barrierFilter === null || !this.physics.barrierHandles.has(c.handle) || this.barrierFilter.has(c.handle));

  constructor(private readonly physics: GamePhysics) {
    const c = physics.world.createCharacterController(MOVEMENT.skin);
    c.setMaxSlopeClimbAngle((MOVEMENT.maxSlopeClimbDeg * Math.PI) / 180);
    c.setMinSlopeSlideAngle((MOVEMENT.minSlopeSlideDeg * Math.PI) / 180);
    c.enableAutostep(MOVEMENT.autostepHeight, MOVEMENT.autostepMinWidth, false);
    c.enableSnapToGround(MOVEMENT.snapToGround);
    c.setApplyImpulsesToDynamicBodies(false);
    c.setSlideEnabled(true);
    this.controller = c;
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
    // Water: touching the surface ends a dive; deep enough the character swims until the bottom lifts the feet near
    // the surface again (hysteresis, so wading at chest depth does not flicker in and out of swimming).
    const depth = waterDepth(s.pos);
    if (s.diving && depth > 0) s.diving = false;
    if (!s.swimming && depth > MOVEMENT.swimEnterDepth) s.swimming = true;
    else if (s.swimming && depth < MOVEMENT.swimExitDepth) s.swimming = false;
    const diving = s.diving;
    const swimming = s.swimming;
    if (swimming) s.airJumped = false;
    const jumpDown = !diving && !s.rooted && (inp.buttons & InputButton.JUMP) !== 0;
    const sprint = !s.noSprint && (inp.buttons & InputButton.SPRINT) !== 0;
    // Hands are spread while skydiving and stroking while swimming: no aiming, no firing pose.
    const handsFree = !diving && !swimming && abilityMove?.mode !== 'flight';
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
    const maxSpeed = abilityMove?.mode === 'flight' || abilityMove?.mode === 'glide' ? abilityMove.speed * s.slow : diving
      ? sprint
        ? MOVEMENT.diveFastSpeed
        : MOVEMENT.diveSpeed
      : swimming
        ? MOVEMENT.swimSpeed * s.slow
        : (s.aiming || firing ? MOVEMENT.aimSpeed : canSprint ? MOVEMENT.sprintSpeed : MOVEMENT.runSpeed) * s.slow * (depth > 0 ? wadeFactor(depth) : 1);
    const dashing = s.dashSteps > 0;
    if (dashing) {
      // Dash: a fixed ground-plane velocity along the dash direction; no steering.
      const dd = v3normalize(v3projectOnPlane(s.dashDir, up, this.tmpTarget), this.tmpTarget);
      v3set(h, dd.x * s.dashSpeed, dd.y * s.dashSpeed, dd.z * s.dashSpeed);
    } else {
      const target = v3set(this.tmpTarget, wish.x * maxSpeed, wish.y * maxSpeed, wish.z * maxSpeed);
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
            : MOVEMENT.airAccel * (s.airControl ?? 1) * (abilityMove?.airControl ?? 1);
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
    } else if (!s.grounded || jumped) vs -= PLANET.gravity * (abilityMove?.gravityFactor ?? 1) * dt;
    else vs = -0.5; // keep contact; snap-to-ground does the rest
    if (diving) {
      // Skydive: the fall is capped (head-first with sprint is faster); slowing down from a faster fall brakes smoothly.
      const terminal = sprint ? MOVEMENT.diveFastTerminalSpeed : MOVEMENT.diveTerminalSpeed;
      if (vs < -terminal) vs = Math.min(-terminal, vs + MOVEMENT.diveBrake * dt);
    } else vs = Math.max(vs, -MOVEMENT.terminalSpeed);

    if (abilityMove?.mode === 'glide') vs = Math.max(vs, -Math.max(1, abilityMove.lift));
    else if (abilityMove?.mode === 'flight') {
      const ceiling = (abilityMove.originHeight ?? v3len(s.pos)) + 18;
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
    if (s.rooted) v3set(h, 0, 0, 0);

    const desired = v3set(this.tmpDesired, (h.x + up.x * vs) * dt, (h.y + up.y * vs) * dt, (h.z + up.z * vs) * dt);

    // A floating body must not be pulled down onto the lake bed (the controller is shared: set it every step).
    const snap = !s.swimming;
    if (snap !== this.snapping) {
      if (snap) this.controller.enableSnapToGround(MOVEMENT.snapToGround);
      else this.controller.disableSnapToGround();
      this.snapping = snap;
    }
    this.controller.setUp(up);
    this.placeCollider(body.collider, s.pos);
    // Another room's chests are invisible here (only checked when this world holds chests this motor does not own).
    const foreign = (this.chestFilter !== null && this.physics.chestHandles.size > this.chestFilter.size)
      || (this.barrierFilter !== null && this.physics.barrierHandles.size > this.barrierFilter.size);
    this.controller.computeColliderMovement(body.collider, desired, undefined, PLAYER_GROUPS, foreign ? this.predicate : undefined);
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
    const hl = v3len(actualH);
    let intended = v3len(h);
    if (dashing && --s.dashSteps === 0) intended = Math.min(intended, MOVEMENT.runSpeed); // leave the dash at run speed
    if (hl > intended && hl > 1e-6) v3set(actualH, (actualH.x / hl) * intended, (actualH.y / hl) * intended, (actualH.z / hl) * intended);
    const movedUp = v3dot({ x: mv.x, y: mv.y, z: mv.z }, up) / dt;
    if (groundedNow && !jumped) {
      vs = 0;
      s.grounded = true;
      s.airTime = 0;
      s.airJumped = false;
      // First ground contact ends the dive (landing).
      s.diving = false;
    } else {
      // Hit a ceiling: kill upward speed.
      if (vs > 0 && movedUp < vs * 0.5) vs = Math.min(vs, movedUp);
      s.grounded = false;
      s.airTime += dt;
    }
    v3set(s.vel, actualH.x + newUp.x * vs, actualH.y + newUp.y * vs, actualH.z + newUp.z * vs);

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
    if (s.swimming) s.moveState = MovementState.SWIM;
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
