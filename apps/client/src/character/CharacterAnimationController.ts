/**
 * CharacterAnimationController: translates semantic state (movement state, speed, action state, aim pitch) into
 * weighted AnimationActions. Never streamed over the network — remote players derive it from replicated state.
 *
 * Layers (manual weights, smoothed every frame):
 *   - Locomotion LOWER (hips + legs): idle / walk / run / sprint / air / fall — always full weight.
 *   - Locomotion UPPER (spine, arms, head): same clips × (1 − upper action weight).
 *   - Upper actions: aim (pitch blend up/neutral/down), fire, reload, cast, castEnter, castHold (channel), throw.
 *   - Full-body one-shots: jump start, land, hit, death, dash, victory (override both locomotion halves).
 */
import * as THREE from 'three';
import { ActionState, MovementState } from '@graao/shared';
import type { ClipName, GRAAnimationLibrary } from './animation/GRAAnimationLibrary';

const UPPER_BONES = /^(Spine1|Spine2|Neck|Head|HeadTop_End|Left(Shoulder|Arm|ForeArm|Hand.*)|Right(Shoulder|Arm|ForeArm|Hand.*))\./;

function split(clip: THREE.AnimationClip): { lower: THREE.AnimationClip; upper: THREE.AnimationClip } {
  const up = clip.tracks.filter((t) => UPPER_BONES.test(t.name));
  const low = clip.tracks.filter((t) => !UPPER_BONES.test(t.name));
  return {
    lower: new THREE.AnimationClip(`${clip.name}#lower`, clip.duration, low),
    upper: new THREE.AnimationClip(`${clip.name}#upper`, clip.duration, up),
  };
}

const LOCO: ClipName[] = ['idle', 'walk', 'run', 'sprint', 'air', 'fall', 'skydive', 'swim', 'swimIdle'];
/** Ground speed (m/s) at which each locomotion clip plays at timeScale 1 (tuned by eye). */
const NATIVE_SPEED: Partial<Record<ClipName, number>> = { walk: 1.5, run: 4.6, sprint: 7.2, swim: 3.1 };

interface Layer {
  action: THREE.AnimationAction;
  weight: number;
  target: number;
}

export interface AnimInput {
  moveState: MovementState;
  speed: number;
  grounded: boolean;
  aiming: boolean;
  /** Aim pitch relative to the local horizon, radians (+ up). */
  aimPitch: number;
  action: ActionState;
  /** Skydiving out of the UFO (box pose, no aiming). */
  diving?: boolean;
  /** The double jump of this flight is spent (its rising edge plays the flip, see GraaoCharacter). */
  airJumped?: boolean;
  /** Height above whatever is below (m), while diving: the body flares feet-first near the ground. */
  groundDist?: number;
  /** How deep the feet are under the sea surface (m, negative above it): wading, swimming, drying off afterwards. */
  waterDepth?: number;
}

export class CharacterAnimationController {
  readonly mixer: THREE.AnimationMixer;
  private readonly lower = new Map<ClipName, Layer>();
  private readonly upper = new Map<ClipName, Layer>();
  private readonly upperActions = new Map<ClipName, Layer>();
  private readonly full = new Map<ClipName, Layer>();
  private wasGrounded = true;
  private airTime = 0;
  private oneShot: { name: ClipName; until: number; hold?: boolean } | null = null;
  private upperShot: { name: ClipName; until: number } | null = null;
  private time = 0;
  private dead = false;

  constructor(root: THREE.Object3D, private readonly lib: GRAAnimationLibrary) {
    this.mixer = new THREE.AnimationMixer(root);
    for (const name of LOCO) {
      const clip = lib.get(name);
      if (!clip) continue;
      const { lower, upper } = split(clip);
      this.lower.set(name, this.layer(lower, THREE.LoopRepeat));
      this.upper.set(name, this.layer(upper, THREE.LoopRepeat));
    }
    for (const name of ['aim', 'aimUp', 'aimDown', 'fire', 'reload', 'cast', 'castEnter', 'castHold', 'throw'] as ClipName[]) {
      const clip = lib.get(name);
      if (!clip) continue;
      const loop = name === 'aim' || name === 'aimUp' || name === 'aimDown' || name === 'castHold' ? THREE.LoopRepeat : THREE.LoopOnce;
      this.upperActions.set(name, this.layer(split(clip).upper, loop));
    }
    for (const name of ['jumpStart', 'land', 'hit', 'hitHeavy', 'death', 'dash', 'victory', 'cheer', 'emote', 'throw'] as ClipName[]) {
      const clip = lib.get(name);
      if (!clip) continue;
      const loop = name === 'victory' || name === 'emote' ? THREE.LoopRepeat : THREE.LoopOnce;
      this.full.set(name, this.layer(clip, loop));
    }
    this.lower.get('idle')!.target = 1;
    this.lower.get('idle')!.weight = 1;
  }

  private layer(clip: THREE.AnimationClip, loop: THREE.AnimationActionLoopStyles): Layer {
    const action = this.mixer.clipAction(clip);
    action.setLoop(loop, Infinity);
    action.clampWhenFinished = loop === THREE.LoopOnce;
    action.enabled = true;
    action.setEffectiveWeight(0);
    action.play();
    return { action, weight: 0, target: 0 };
  }

  /** Plays a full-body one-shot (jumpStart, land, hit, death, dash, victory…). */
  playOneShot(name: ClipName, opts: { hold?: boolean; speed?: number } = {}): void {
    const l = this.full.get(name);
    if (!l) return;
    l.action.reset();
    l.action.timeScale = opts.speed ?? 1;
    l.action.play();
    const dur = l.action.getClip().duration / (opts.speed ?? 1);
    this.oneShot = { name, until: this.time + (opts.hold ? Infinity : dur), hold: opts.hold };
  }

  /**
   * Plays an upper-body action (fire, reload, cast, throw) over locomotion. `hold` keeps it for that many seconds
   * instead of the clip length (looping channels such as castHold during an ability wind-up).
   */
  playUpper(name: ClipName, speed = 1, hold?: number): void {
    const l = this.upperActions.get(name);
    if (!l) return;
    l.action.reset();
    l.action.timeScale = speed;
    l.action.play();
    this.upperShot = { name, until: this.time + (hold ?? l.action.getClip().duration / speed) };
  }

  /** Duration (s) of a clip at timeScale 1, or 0 when missing. */
  clipDuration(name: ClipName): number {
    const l = this.upperActions.get(name) ?? this.full.get(name);
    return l ? l.action.getClip().duration : 0;
  }

  update(dt: number, s: AnimInput): void {
    this.time += dt;
    // Death holds the pose until revived.
    if (s.action === ActionState.DEAD) {
      if (!this.dead) {
        this.dead = true;
        this.playOneShot('death', { hold: true });
      }
    } else if (this.dead) {
      this.dead = false;
      this.oneShot = null;
    }

    // Jump / land transitions (the water carries a swimmer: wading out of it is not a landing).
    const swimming = s.moveState === MovementState.SWIM;
    if (!s.grounded) this.airTime += dt;
    if (this.wasGrounded && !s.grounded && s.moveState === MovementState.JUMP && !s.diving) this.playOneShot('jumpStart', { speed: 1.6 });
    if (!this.wasGrounded && s.grounded && this.airTime > 0.35) this.playOneShot('land', { speed: 2.2 });
    if (s.grounded || swimming) this.airTime = 0;
    this.wasGrounded = s.grounded;

    // Locomotion targets.
    let loco: ClipName = 'idle';
    switch (s.moveState) {
      case MovementState.WALK:
        loco = 'walk';
        break;
      case MovementState.RUN:
        loco = 'run';
        break;
      case MovementState.SPRINT:
        loco = 'sprint';
        break;
      case MovementState.JUMP:
        loco = 'air';
        break;
      case MovementState.FALL:
        loco = this.airTime > 0.9 ? 'fall' : 'air';
        break;
      case MovementState.SWIM:
        loco = s.speed > 0.7 ? 'swim' : 'swimIdle';
        break;
    }
    if (s.diving) loco = 'skydive';
    for (const [name, l] of this.lower) l.target = name === loco ? 1 : 0;
    const native = NATIVE_SPEED[loco];
    const scale = native ? THREE.MathUtils.clamp(s.speed / native, 0.65, 1.45) : 1;
    for (const map of [this.lower, this.upper]) {
      const l = map.get(loco);
      if (l) l.action.timeScale = scale;
    }

    // Upper body actions.
    let upperW = 0;
    for (const l of this.upperActions.values()) l.target = 0;
    if (this.upperShot && this.time < this.upperShot.until) {
      this.upperActions.get(this.upperShot.name)!.target = 1;
      upperW = 1;
    } else if (s.aiming && !s.diving) {
      const p = THREE.MathUtils.clamp(s.aimPitch / 0.9, -1, 1);
      this.upperActions.get('aim')!.target = 1 - Math.abs(p);
      if (p > 0) this.upperActions.get('aimUp')!.target = p;
      else this.upperActions.get('aimDown')!.target = -p;
      upperW = 1;
    }
    for (const [name, l] of this.upper) l.target = (name === loco ? 1 : 0) * (1 - upperW);

    // Full-body one-shot overrides.
    let fullW = 0;
    for (const l of this.full.values()) l.target = 0;
    if (this.oneShot) {
      const remaining = this.oneShot.until - this.time;
      if (remaining > 0) {
        this.full.get(this.oneShot.name)!.target = 1;
        // Land, jump-start and hit reactions blend partially so locomotion (and aiming) keeps reading.
        const n = this.oneShot.name;
        fullW = n === 'land' ? 0.55 : n === 'jumpStart' ? 0.7 : n === 'hit' ? 0.45 : 1;
        this.full.get(this.oneShot.name)!.target = fullW;
      } else this.oneShot = null;
    }
    if (fullW > 0) {
      for (const l of this.lower.values()) l.target *= 1 - fullW;
      for (const l of this.upper.values()) l.target *= 1 - fullW;
      for (const l of this.upperActions.values()) l.target *= 1 - fullW;
    }

    const k = 1 - Math.exp(-dt * 14);
    const kFast = 1 - Math.exp(-dt * 28);
    for (const map of [this.lower, this.upper]) for (const l of map.values()) this.blend(l, k);
    for (const l of this.upperActions.values()) this.blend(l, kFast);
    for (const l of this.full.values()) this.blend(l, kFast);
    this.mixer.update(dt);
  }

  private blend(l: Layer, k: number): void {
    l.weight += (l.target - l.weight) * k;
    if (l.weight < 1e-3 && l.target === 0) l.weight = 0;
    l.action.setEffectiveWeight(l.weight);
  }

  dispose(): void {
    this.mixer.stopAllAction();
  }
}
