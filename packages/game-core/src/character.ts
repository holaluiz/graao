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
  aiming: boolean;
  moveState: MovementState;
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
    aiming: false,
    moveState: MovementState.FALL,
  };
}

export function cloneCharacterState(s: CharacterState): CharacterState {
  return { ...s, pos: { ...s.pos }, vel: { ...s.vel }, facing: { ...s.facing }, aim: { ...s.aim } };
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
const PLAYER_GROUPS = groups(Group.PLAYER, Group.TERRAIN | Group.PROP);

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
      groups(Group.PLAYER, Group.TERRAIN | Group.PROP),
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
    const jumpDown = (inp.buttons & InputButton.JUMP) !== 0;
    const sprint = (inp.buttons & InputButton.SPRINT) !== 0;
    s.aiming = (inp.buttons & InputButton.AIM) !== 0;
    const firing = (inp.buttons & InputButton.FIRE) !== 0;
    if (v3len(inp.aim) > 0.5) v3normalize(inp.aim, s.aim);

    // Wish direction on the tangent plane, length ≤ 1.
    const wish = v3projectOnPlane(inp.wish, up, this.tmpWish);
    const wl = v3len(wish);
    if (wl > 1) v3set(wish, wish.x / wl, wish.y / wl, wish.z / wl);
    const wishLen = Math.min(1, wl);

    // Split velocity into vertical (along up) and horizontal (tangent).
    let vs = v3dot(s.vel, up);
    const h = v3projectOnPlane(s.vel, up, this.tmpH);

    const forwardish = wishLen > 0.1 ? v3dot(wish, s.facing) / Math.max(wishLen, 1e-6) : 0;
    const canSprint = sprint && !s.aiming && !firing && forwardish > 0.3;
    const maxSpeed = s.aiming || firing ? MOVEMENT.aimSpeed : canSprint ? MOVEMENT.sprintSpeed : MOVEMENT.runSpeed;
    const target = v3set(this.tmpTarget, wish.x * maxSpeed, wish.y * maxSpeed, wish.z * maxSpeed);

    // Accelerate horizontal velocity toward the target.
    const accel = s.grounded ? (wishLen > 0.05 ? MOVEMENT.groundAccel : MOVEMENT.groundDecel) : MOVEMENT.airAccel;
    const dx = target.x - h.x, dy = target.y - h.y, dz = target.z - h.z;
    const dl = Math.hypot(dx, dy, dz);
    const maxDv = accel * dt;
    if (dl <= maxDv) v3assign(h, target);
    else v3addScaled(h, { x: dx, y: dy, z: dz }, maxDv / dl, h);

    // Jump: rising edge buffered, coyote time after leaving ground.
    if (jumpDown && !s.jumpHeld) s.jumpBuffer = MOVEMENT.jumpBuffer;
    s.jumpHeld = jumpDown;
    let jumped = false;
    if (s.jumpBuffer > 0 && (s.grounded || s.airTime < MOVEMENT.coyoteTime) && vs <= 0.5) {
      vs = MOVEMENT.jumpSpeed;
      s.jumpBuffer = 0;
      s.grounded = false;
      s.airTime = MOVEMENT.coyoteTime;
      jumped = true;
    }
    s.jumpBuffer = Math.max(0, s.jumpBuffer - dt);

    // Radial gravity.
    if (!s.grounded || jumped) vs -= PLANET.gravity * dt;
    else vs = -0.5; // keep contact; snap-to-ground does the rest
    vs = Math.max(vs, -MOVEMENT.terminalSpeed);

    const desired = v3set(this.tmpDesired, (h.x + up.x * vs) * dt, (h.y + up.y * vs) * dt, (h.z + up.z * vs) * dt);

    this.controller.setUp(up);
    this.placeCollider(body.collider, s.pos);
    this.controller.computeColliderMovement(body.collider, desired, undefined, PLAYER_GROUPS);
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
    const intended = v3len(h);
    if (hl > intended && hl > 1e-6) v3set(actualH, (actualH.x / hl) * intended, (actualH.y / hl) * intended, (actualH.z / hl) * intended);
    const movedUp = v3dot({ x: mv.x, y: mv.y, z: mv.z }, up) / dt;
    if (groundedNow && !jumped) {
      vs = 0;
      s.grounded = true;
      s.airTime = 0;
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
    if (s.aiming || firing) {
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
    if (!s.grounded) s.moveState = vs > 0.5 ? MovementState.JUMP : MovementState.FALL;
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
