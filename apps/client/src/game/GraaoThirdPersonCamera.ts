/**
 * GraaoThirdPersonCamera: shoulder camera on a spherical world.
 *
 * The camera keeps its own heading as a TANGENT vector that is parallel-transported with the target's local up every
 * frame (no global yaw angle, no pole singularity), so it stays comfortable after any number of laps. Mouse X rotates
 * the heading around local up; mouse Y changes a clamped pitch. Terrain pulls the camera in (spring out slowly);
 * props never snap it — they dissolve instead (see Obstruction).
 */
import * as THREE from 'three';
import { GROUPS_TERRAIN_QUERY, transportTangent, type GamePhysics } from '@graao/game-core';

export interface CameraFrame {
  /** Tangent forward of the view (for WASD). */
  forward: THREE.Vector3;
  /** Tangent right of the view. */
  right: THREE.Vector3;
  up: THREE.Vector3;
  /** Full view direction (camera look). */
  view: THREE.Vector3;
}

export class GraaoThirdPersonCamera {
  readonly heading = new THREE.Vector3(0, 0, 1);
  readonly up = new THREE.Vector3(0, 1, 0);
  pitch = -0.18;
  aim = false;
  /** Extra field of view (degrees), e.g. the speed of a dive. */
  fovBoost = 0;
  private aimBlend = 0;
  private distance = 4.4;
  private readonly baseDistance = 4.4;
  private readonly aimDistance = 2.3;
  private readonly pivot = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private shake = 0;
  private shakeT = 0;
  /** Recoil offsets (rad) added to the view; they recover on their own. */
  private recoilPitch = 0;
  private recoilYaw = 0;
  readonly frame: CameraFrame = { forward: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3(), view: new THREE.Vector3() };
  /** Smoothed vertical follow to hide capsule steps. */
  private followUp = 0;
  private hasTarget = false;

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  /** Initializes the heading behind a target facing `facing`. */
  reset(feet: THREE.Vector3, facing: THREE.Vector3): void {
    this.up.copy(feet).normalize();
    this.heading.copy(facing).addScaledVector(this.up, -facing.dot(this.up)).normalize();
    this.hasTarget = true;
  }

  look(yaw: number, pitch: number): void {
    this.heading.applyAxisAngle(this.up, yaw);
    this.pitch = THREE.MathUtils.clamp(this.pitch + pitch, -1.25, 1.05);
  }

  /** Weapon recoil: the view climbs by `pitch` (and drifts by `yaw`) and settles back over ~0.2 s. */
  kick(pitch: number, yaw = 0): void {
    this.recoilPitch = Math.min(0.12, this.recoilPitch + pitch);
    this.recoilYaw += yaw;
  }

  addShake(amount: number, duration = 0.18): void {
    this.shake = Math.max(this.shake, amount);
    this.shakeT = Math.max(this.shakeT, duration);
  }

  update(dt: number, feet: THREE.Vector3, physics: GamePhysics | null): CameraFrame {
    const newUp = this.tmp.copy(feet).normalize();
    if (!this.hasTarget) this.reset(feet, new THREE.Vector3(0, 0, 1).addScaledVector(newUp, -newUp.z).normalize());
    const t = transportTangent(this.heading, this.up, newUp);
    this.heading.set(t.x, t.y, t.z);
    this.up.copy(newUp);

    this.aimBlend += ((this.aim ? 1 : 0) - this.aimBlend) * (1 - Math.exp(-dt * 14));
    this.recoilPitch *= Math.exp(-dt * 11);
    this.recoilYaw *= Math.exp(-dt * 11);
    const right = new THREE.Vector3().crossVectors(this.heading, this.up).normalize();
    const pitch = THREE.MathUtils.clamp(this.pitch + this.recoilPitch, -1.25, 1.1);
    const view = this.heading.clone().applyAxisAngle(this.up, this.recoilYaw).multiplyScalar(Math.cos(pitch)).addScaledVector(this.up, Math.sin(pitch)).normalize();

    // Pivot: above the shoulder, slightly to the right.
    const shoulder = THREE.MathUtils.lerp(0.42, 0.62, this.aimBlend);
    const height = THREE.MathUtils.lerp(1.62, 1.52, this.aimBlend);
    const feetH = feet.length();
    this.followUp = this.followUp === 0 ? feetH : THREE.MathUtils.damp(this.followUp, feetH, 18, dt);
    const smoothedFeet = feet.clone().multiplyScalar(this.followUp / feetH);
    this.pivot.copy(smoothedFeet).addScaledVector(this.up, height).addScaledVector(right, shoulder);

    let want = THREE.MathUtils.lerp(this.baseDistance, this.aimDistance, this.aimBlend);
    // Looking up from below pulls the camera closer so it does not dig into the ground.
    if (this.pitch > 0.35) want *= THREE.MathUtils.lerp(1, 0.65, (this.pitch - 0.35) / 0.7);
    if (physics) {
      const back = view.clone().negate();
      const hit = physics.castRay(this.pivot, back, want + 0.4, GROUPS_TERRAIN_QUERY);
      if (hit) want = Math.max(0.6, Math.min(want, hit.toi - 0.35));
    }
    // Snap in, ease out.
    this.distance = want < this.distance ? want : THREE.MathUtils.damp(this.distance, want, 3.5, dt);

    const pos = this.pivot.clone().addScaledVector(view, -this.distance);
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const s = this.shake * Math.max(0, this.shakeT) * 6;
      pos.addScaledVector(right, (Math.random() - 0.5) * s * 0.12).addScaledVector(this.up, (Math.random() - 0.5) * s * 0.12);
    }
    this.camera.position.copy(pos);
    this.camera.up.copy(this.up);
    this.camera.lookAt(this.pivot.clone().addScaledVector(view, 8));
    const fov = THREE.MathUtils.lerp(70, 52, this.aimBlend) + this.fovBoost;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.frame.forward.copy(this.heading);
    this.frame.right.copy(right);
    this.frame.up.copy(this.up);
    this.frame.view.copy(view);
    return this.frame;
  }

  get pivotPoint(): THREE.Vector3 {
    return this.pivot;
  }
}
