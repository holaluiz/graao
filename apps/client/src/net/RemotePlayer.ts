/**
 * Remote player presentation: authoritative snapshots interpolated on the player's own simulation clock
 * (see SnapshotInterpolator). Only semantic state arrives (position, facing, movement/action state); animation is
 * derived locally.
 */
import * as THREE from 'three';
import { GROUPS_WORLD_QUERY, type GamePhysics } from '@graao/game-core';
import { PLANET } from '@graao/game-data';
import { ActionState, MovementState, SnapFlag, type CharacterAppearance } from '@graao/shared';
import type { GRAAnimationLibrary } from '../character/animation/GRAAnimationLibrary';
import type { CharacterPartLibrary } from '../character/CharacterAppearanceController';
import { GraaoCharacter } from '../character/GraaoCharacter';
import { WeaponHolder } from '../character/WeaponModels';
import { SnapshotInterpolator } from './SnapshotInterpolator';

export interface RemoteSample {
  t: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  facing: THREE.Vector3;
  aimPitch: number;
  moveState: MovementState;
  action: ActionState;
  flags: number;
}

export class RemotePlayer {
  readonly character: GraaoCharacter;
  readonly interp = new SnapshotInterpolator<RemoteSample>();
  readonly pos = new THREE.Vector3();
  private readonly facing = new THREE.Vector3(0, 0, 1);
  name: string;
  private readonly label = document.createElement('div');
  extrapolatedMs = 0;
  readonly holder = new WeaponHolder();
  /** performance.now() of this player's last shot (holds the aim pose). */
  firedAt = -1e9;
  alive = true;

  constructor(
    readonly index: number,
    name: string,
    appearance: CharacterAppearance,
    parts: CharacterPartLibrary,
    anims: GRAAnimationLibrary,
    labels: HTMLElement,
  ) {
    this.name = name;
    this.character = new GraaoCharacter(parts, anims, appearance);
    this.holder.attachTo(this.character);
    this.label.className = 'nameplate';
    this.label.textContent = name;
    labels.appendChild(this.label);
  }

  get lag(): number {
    return this.interp.lag;
  }

  setName(n: string): void {
    this.name = n;
    this.label.textContent = n;
  }

  push(s: RemoteSample, arrivalNow: number): void {
    this.interp.push(s, arrivalNow);
  }

  setWeapon(slot: number): void {
    if (slot !== this.holder.slot) this.holder.setSlot(slot);
  }

  /** The server moved this player to a spawn: drop old samples so it does not slide across the planet. */
  onRespawn(): void {
    this.interp.samples.length = 0;
  }

  update(dt: number, serverNow: number, margin: number, camera: THREE.Camera, viewport: { w: number; h: number }, physics: GamePhysics): void {
    const r = this.interp.sample(serverNow, margin);
    if (!r) return;
    const { a, b, alpha, extrapolateMs } = r;
    this.extrapolatedMs = extrapolateMs;
    if (extrapolateMs > 0) this.pos.copy(b.pos).addScaledVector(b.vel, Math.min(extrapolateMs, 100) / 1000);
    else this.pos.lerpVectors(a.pos, b.pos, alpha);
    this.facing.lerpVectors(a.facing, b.facing, alpha).normalize();
    const up = this.pos.clone().normalize();
    this.facing.addScaledVector(up, -this.facing.dot(up)).normalize();
    this.character.setPose(this.pos, up, this.facing);
    const v = b.vel.clone();
    const speed = v.addScaledVector(up, -v.dot(up)).length();
    this.alive = (b.flags & SnapFlag.ALIVE) !== 0;
    this.label.classList.toggle('down', !this.alive);
    this.character.update(dt, {
      moveState: b.moveState,
      speed,
      grounded: (b.flags & SnapFlag.GROUNDED) !== 0,
      aiming: this.alive && ((b.flags & SnapFlag.AIMING) !== 0 || performance.now() - this.firedAt < 650),
      aimPitch: a.aimPitch + (b.aimPitch - a.aimPitch) * alpha,
      action: (b.flags & SnapFlag.ALIVE) === 0 ? ActionState.DEAD : b.action,
    });
    this.placeLabel(up, camera, viewport, physics);
  }

  /**
   * Nameplate above the head (DOM). Hidden behind the planet's curve, beyond 60 m and behind walls: a name floating
   * over a house would give away where an opponent hides.
   */
  private placeLabel(up: THREE.Vector3, camera: THREE.Camera, viewport: { w: number; h: number }, physics: GamePhysics): void {
    const headW = this.pos.clone().addScaledVector(up, 1.75);
    const cam = camera.position;
    const dist = cam.distanceTo(headW);
    let visible = dist < 60 && !behindPlanet(cam, headW, PLANET.radius - 0.5);
    if (visible && dist > 1) {
      const dir = headW.clone().sub(cam).divideScalar(dist);
      const hit = physics.castRay(cam, dir, dist - 0.3, GROUPS_WORLD_QUERY);
      if (hit) visible = false;
    }
    headW.addScaledVector(up, 0.3);
    let x = 0;
    let y = 0;
    if (visible) {
      const p = headW.project(camera);
      visible = p.z < 1 && p.z > -1 && Math.abs(p.x) < 1.2 && Math.abs(p.y) < 1.2;
      x = ((p.x + 1) / 2) * viewport.w;
      y = ((1 - p.y) / 2) * viewport.h;
    }
    this.label.style.display = visible ? 'block' : 'none';
    if (visible) this.label.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
  }

  dispose(): void {
    this.character.dispose();
    this.label.remove();
  }
}

/** True when the segment camera→target passes through the sphere of radius r at the origin. */
function behindPlanet(c: THREE.Vector3, t: THREE.Vector3, r: number): boolean {
  const d = t.clone().sub(c);
  const len = d.length();
  d.divideScalar(len);
  const s = -c.dot(d);
  if (s <= 0 || s >= len) return false;
  return c.lengthSq() - s * s < r * r;
}
