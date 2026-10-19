/**
 * Footsteps: every character's footfalls (GraaoCharacter.consumeSteps), jump push-offs and landings, on what is under
 * their feet.
 *
 * The ground is read with a short ray down. The planet's own terrain is told apart the way its shader paints it
 * (GRAStylizedMaterial: sand by the sea, rock on steep slopes, the serra's red earth, grass elsewhere); a kit piece by
 * what its part is made of (the KitColor game-core keeps per collider: madeira knocks, ferro rings, calçamento clicks).
 *
 * Ours go on the movement path; everybody else's are threats, as in the reference study (enemy steps come first):
 * panned, gone by 35 m, darker when they come from a floor below and brighter from above.
 */
import * as THREE from 'three';
import { GROUPS_WORLD_QUERY, soilAt, waterDepth, type GamePhysics, type Placement, type Terrain } from '@graao/game-core';
import { MovementState } from '@graao/shared';
import type { GRAAudioManager, StepAction, StepSurface } from './GRAAudioManager';
import type { GraaoCharacter } from '../character/GraaoCharacter';

/** Kit parts by what they are made of (KitColor → surface); anything not listed is masonry: stone. */
const KIT_SURFACE: Partial<Record<string, StepSurface>> = {
  madeira: 'wood',
  madeiraClara: 'wood',
  madeiraEscura: 'wood',
  porta: 'wood',
  metal: 'metal',
  ferro: 'metal',
  aco: 'metal',
  caixaDagua: 'metal',
  terra: 'dirt',
  terraVermelha: 'dirt',
  folha: 'grass',
};
/** Scatter and structures without a part colour: trunks are wood, the rest stone. */
const WOODEN: ReadonlySet<string> = new Set(['tree', 'pine', 'cerrado', 'ipe', 'palm', 'canela']);

/** Beyond this (m) nobody's steps are heard. */
const HEARD = 35;
/** A landing after less time in the air (s) is a hop, heard as a step; after more than this it was the UFO's drop. */
const LAND_MIN = 0.2;
const LAND_DROP = 2.5;

export interface StepWalker {
  /** Authoritative loadout's quiet-step modifier; affects only other listeners. */
  gain?: number;
  character: GraaoCharacter;
  moveState: MovementState;
  /** Ours (movement path, never attenuated) or somebody else's (threat). */
  mine: boolean;
}

export class Footsteps {
  private readonly origin = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly down = new THREE.Vector3();
  private readonly d = new THREE.Vector3();
  private readonly right = new THREE.Vector3();

  constructor(
    private readonly audio: GRAAudioManager,
    private readonly physics: GamePhysics,
    private readonly terrain: Terrain,
    private readonly camera: THREE.Camera,
  ) {}

  /** Plays what each walker's feet did this frame (call after the characters have been updated). */
  update(walkers: Iterable<StepWalker>): void {
    for (const w of walkers) {
      const c = w.character;
      const steps = c.consumeSteps();
      const jumped = c.consumeJump();
      const landed = c.consumeLanding();
      if (!c.root.visible || (!steps && !jumped && !landed)) continue;
      // The UFO's drop has its own landing (DeployDirector); water has its own wading and swimming (WaterDirector).
      if (landed > LAND_DROP || waterDepth(c.root.position) > 0.05) continue;
      const surface = this.surfaceUnder(c.root.position);
      if (!surface) continue;
      const gait: StepAction = w.moveState === MovementState.WALK ? 'walk' : w.moveState === MovementState.SPRINT ? 'sprint' : 'run';
      if (landed >= LAND_MIN) this.play(surface, 'land', c, w.mine, w.gain);
      else if (jumped) this.play(surface, 'jump', c, w.mine, w.gain);
      for (let i = 0; i < steps; i++) this.play(surface, gait, c, w.mine, w.gain);
    }
  }

  /** What the feet at `feet` stand on, or null over nothing (mid-air, in the sea). */
  surfaceUnder(feet: THREE.Vector3): StepSurface | null {
    this.up.copy(feet).normalize();
    this.origin.copy(feet).addScaledVector(this.up, 0.5);
    this.down.copy(this.up).negate();
    const hit = this.physics.castRayNormal(this.origin, this.down, 1.1, GROUPS_WORLD_QUERY);
    if (!hit) return null;
    if (hit.handle !== this.physics.terrainHandle) {
      const made = this.physics.surfaceByCollider.get(hit.handle);
      if (made) return KIT_SURFACE[made] ?? 'stone';
      const p: Placement | undefined = this.physics.propByCollider.get(hit.handle);
      return p && WOODEN.has(p.kind) ? 'wood' : 'stone';
    }
    const dir = this.up;
    if (feet.length() - this.terrain.seaRadius < 0.4) return 'sand';
    const n = hit.normal;
    if (1 - (n.x * dir.x + n.y * dir.y + n.z * dir.z) > 0.41) return 'stone';
    return soilAt(dir)[0] > 0.6 ? 'dirt' : 'grass';
  }

  private play(surface: StepSurface, step: StepAction, c: GraaoCharacter, mine: boolean, gain = 1): void {
    // Left and right feet are never quite the same.
    const pitch = 0.94 + Math.random() * 0.12;
    if (mine) {
      this.audio.play(`step.${surface}`, { step, pitch, volume: 0.8 });
      return;
    }
    const feet = c.root.position;
    const d = this.d.copy(feet).sub(this.camera.position);
    const dist = d.length();
    if (dist > HEARD) return;
    this.right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    // A floor between us: from below the steps come through it dull, from above a little brighter (and quieter).
    const rise = d.dot(this.up.copy(this.camera.position).normalize());
    const below = rise < -2.2;
    const above = rise > 2.2;
    const fade = 1 - THREE.MathUtils.smoothstep(dist, HEARD * 0.6, HEARD);
    this.audio.play(`step.${surface}`, {
      step,
      threat: true,
      pitch: pitch * (above ? 1.06 : 1),
      pan: dist > 0.01 ? d.dot(this.right) / dist : 0,
      volume: (fade * (above ? 0.75 : 1) * gain) / (1 + dist / 9),
      muffle: Math.min(0.85, dist / 50 + (below ? 0.45 : 0)),
    });
  }
}
