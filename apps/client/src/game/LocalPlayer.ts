/**
 * Local player: fixed-step prediction with the SAME GraaoSphericalCharacterController the server runs.
 * Every SIM step builds an input command (seq, world wish direction, aim, buttons), simulates it immediately (no round
 * trip before moving) and keeps it until the server acknowledges it. On each authoritative snapshot the state is reset
 * to the server's and unacknowledged commands are replayed; the visual error is decayed smoothly.
 *
 * Abilities that move the player are predicted the same way: a dash starts at an announced command sequence on both
 * sides (`scheduleDash`), and the server's slow factor is mirrored (`slow`).
 */
import * as THREE from 'three';
import {
  CharacterMotor,
  cloneCharacterState,
  createCharacterState,
  decodeInput,
  newInput,
  startDash,
  type CharacterBody,
  type CharacterState,
  type GamePhysics,
} from '@graao/game-core';
import { AIM_SCALE, InputButton, SIM_DT, WISH_SCALE, type InputCmd, type Vec3 } from '@graao/shared';
import type { Input } from './Input';
import type { CameraFrame } from './GraaoThirdPersonCamera';

export class LocalPlayer {
  readonly motor: CharacterMotor;
  readonly body: CharacterBody;
  state: CharacterState;
  private prev: CharacterState;
  private acc = 0;
  private seq = 0;
  private readonly pending: InputCmd[] = [];
  /** Commands not yet sent to the server. */
  readonly outbox: InputCmd[] = [];
  /** Visual-only correction offset (decays to zero). */
  private readonly correction = new THREE.Vector3();
  private readonly scratchInput = newInput();
  /** The latest dash: starts before simulating command `seq` (same rule as the server). */
  private dash: { seq: number; dir: Vec3; distance: number; duration: number } | null = null;
  /** Mirrored speed multiplier while slowed by an ability (set every frame by the ability director). */
  slow = 1;
  stats = { replayed: 0, lastCorrection: 0, pending: 0 };

  constructor(private readonly physics: GamePhysics, spawn: Vec3, facing: Vec3) {
    this.motor = new CharacterMotor(physics);
    this.state = createCharacterState(spawn, facing);
    this.prev = cloneCharacterState(this.state);
    this.body = this.motor.createBody(this.state);
  }

  teleport(pos: Vec3, facing: Vec3): void {
    this.state = createCharacterState(pos, facing);
    this.prev = cloneCharacterState(this.state);
    this.pending.length = 0;
    this.correction.set(0, 0, 0);
    this.dash = null;
  }

  /** Sequence number of the next movement command this player will simulate. */
  get nextSeq(): number {
    return (this.seq + 1) & 0x7fffffff;
  }

  /**
   * Dash prediction: starts at the next command (whose sequence goes to the server in the ABILITY_REQUEST), with the
   * network-quantized direction so both sides compute the same motion. Returns that command sequence.
   */
  scheduleDash(dir: Vec3, distance: number, duration: number): number {
    const seq = this.nextSeq;
    this.dash = { seq, dir: { ...dir }, distance, duration };
    return seq;
  }

  /** The server refused the dash: stop predicting it (the next snapshot corrects any motion already shown). */
  cancelDash(seq: number): void {
    if (this.dash?.seq === seq) this.dash = null;
  }

  private stepCmd(s: CharacterState, cmd: InputCmd): void {
    s.slow = this.slow;
    if (this.dash && cmd[0] === this.dash.seq) startDash(s, this.dash.dir, this.dash.distance, this.dash.duration, SIM_DT);
    this.motor.step(this.body, s, decodeInput(cmd, this.scratchInput), SIM_DT);
  }

  /** Builds the command for this step from input and the camera frame. */
  private buildCmd(input: Input, cam: CameraFrame, frozen: boolean): InputCmd {
    let mx = 0;
    let my = 0;
    if (!frozen) {
      if (input.isDown('forward')) my += 1;
      if (input.isDown('back')) my -= 1;
      if (input.isDown('right')) mx += 1;
      if (input.isDown('left')) mx -= 1;
    }
    const wish = cam.forward.clone().multiplyScalar(my).addScaledVector(cam.right, mx);
    if (wish.lengthSq() > 1) wish.normalize();
    let b = 0;
    if (!frozen) {
      if (input.isDown('jump')) b |= InputButton.JUMP;
      if (input.isDown('sprint')) b |= InputButton.SPRINT;
      if (input.isDown('aim')) b |= InputButton.AIM;
      if (input.isDown('fire')) b |= InputButton.FIRE;
    }
    this.seq = (this.seq + 1) & 0x7fffffff;
    return [
      this.seq,
      Math.round(wish.x * WISH_SCALE),
      Math.round(wish.y * WISH_SCALE),
      Math.round(wish.z * WISH_SCALE),
      Math.round(cam.view.x * AIM_SCALE),
      Math.round(cam.view.y * AIM_SCALE),
      Math.round(cam.view.z * AIM_SCALE),
      b,
    ];
  }

  /** Advances fixed steps for `dt` of real time. Returns the interpolation alpha for rendering. `frozen` (eliminated)
   * still simulates gravity but ignores movement and buttons. */
  update(dt: number, input: Input, cam: CameraFrame, networked: boolean, frozen = false): number {
    this.acc += Math.min(dt, 0.25);
    while (this.acc >= SIM_DT) {
      this.acc -= SIM_DT;
      const cmd = this.buildCmd(input, cam, frozen);
      this.prev = cloneCharacterState(this.state);
      this.stepCmd(this.state, cmd);
      if (networked) {
        this.pending.push(cmd);
        this.outbox.push(cmd);
        if (this.pending.length > 240) this.pending.shift();
      }
    }
    this.correction.multiplyScalar(Math.exp(-dt * 10));
    this.stats.pending = this.pending.length;
    return this.acc / SIM_DT;
  }

  /** Authoritative correction from a snapshot. */
  reconcile(server: CharacterState, ackSeq: number): void {
    let acked: InputCmd | undefined;
    while (this.pending.length && seqLE(this.pending[0]![0], ackSeq)) acked = this.pending.shift();
    const before = this.state.pos;
    const bx = before.x, by = before.y, bz = before.z;
    // The snapshot does not carry input edge state: rebuild it from the last acknowledged command.
    const s = cloneCharacterState(server);
    s.jumpHeld = acked ? (acked[7] & InputButton.JUMP) !== 0 : this.state.jumpHeld;
    // Snapshots do not carry dash state: rebuild it from the dash's start command (whole steps, exact).
    const d = this.dash;
    if (d && seqLE(d.seq, ackSeq)) {
      const total = Math.max(1, Math.round(d.duration / SIM_DT));
      const done = ((ackSeq - d.seq) & 0x7fffffff) + 1;
      if (done < total) {
        startDash(s, d.dir, d.distance, d.duration, SIM_DT);
        s.dashSteps = total - done;
      } else if (done > total + 240) this.dash = null;
    }
    for (const cmd of this.pending) this.stepCmd(s, cmd);
    const err = Math.hypot(s.pos.x - bx, s.pos.y - by, s.pos.z - bz);
    this.stats.replayed = this.pending.length;
    this.stats.lastCorrection = err;
    if (err > 4) {
      // Teleport-sized: snap.
      this.correction.set(0, 0, 0);
    } else if (err > 0.002) {
      this.correction.x += bx - s.pos.x;
      this.correction.y += by - s.pos.y;
      this.correction.z += bz - s.pos.z;
    }
    this.state = s;
    this.prev = cloneCharacterState(s);
  }

  /** Interpolated, corrected render position. */
  renderPosition(alpha: number, out: THREE.Vector3): THREE.Vector3 {
    out.set(
      this.prev.pos.x + (this.state.pos.x - this.prev.pos.x) * alpha,
      this.prev.pos.y + (this.state.pos.y - this.prev.pos.y) * alpha,
      this.prev.pos.z + (this.state.pos.z - this.prev.pos.z) * alpha,
    );
    return out.add(this.correction);
  }

  renderFacing(alpha: number, out: THREE.Vector3): THREE.Vector3 {
    out.set(
      this.prev.facing.x + (this.state.facing.x - this.prev.facing.x) * alpha,
      this.prev.facing.y + (this.state.facing.y - this.prev.facing.y) * alpha,
      this.prev.facing.z + (this.state.facing.z - this.prev.facing.z) * alpha,
    );
    return out.normalize();
  }

  speed(): number {
    const up = new THREE.Vector3(this.state.pos.x, this.state.pos.y, this.state.pos.z).normalize();
    const v = new THREE.Vector3(this.state.vel.x, this.state.vel.y, this.state.vel.z);
    return v.addScaledVector(up, -v.dot(up)).length();
  }

  dispose(): void {
    this.body.dispose();
  }
}

/** seq a ≤ b with 31-bit wraparound. */
const seqLE = (a: number, b: number) => ((b - a) & 0x7fffffff) < 0x40000000;
