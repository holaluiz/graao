/**
 * WaterDirector: how the lakes and the sea read around characters. Pure presentation, never networked: everything is
 * derived from each character's drawn position and its replicated movement state (MovementState.SWIM).
 *
 *   - hitting the water: a splash sized by the fall speed (dive landings come from the DeployDirector instead)
 *   - swimming: arm strokes with spray, a ripple wake behind, slow rings while treading water
 *   - wading: little splashes at each step, rings around the legs
 *   - out of the water: drips falling from the soaked part of the body while it dries (GraaoCharacter.wetness)
 *   - head under (a dive or a plunge): bubbles; the surface effects stay at the surface
 *   - a camera under the surface: teal fog, a tinted overlay and muffled sound
 *   - the local player's breath on the HUD, a gasp when surfacing from a long dive, the controls hint, and in solo
 *     (no server) the drowning itself
 */
import * as THREE from 'three';
import { headUnderWater, latLonToDir, northTangent, waterDepth } from '@graao/game-core';
import { ATTRIBUTES, MOVEMENT, SPAWNS } from '@graao/game-data';
import { MovementState } from '@graao/shared';
import type { GraaoApp } from '../app/GraaoApp';
import type { GraaoCharacter } from '../character/GraaoCharacter';
import { Shape } from '../render/vfx/GRAVFXSystem';
import { WaterRipples } from '../render/vfx/WaterRipples';

interface Track {
  prev: THREE.Vector3;
  has: boolean;
  depth: number;
  /** Seconds left in which a water entry belongs to a dive landing (presented by the DeployDirector). */
  diveGrace: number;
  stroke: number;
  wake: number;
  wade: number;
  drip: number;
  bubble: number;
  seen: number;
}

export class WaterDirector {
  readonly ripples: WaterRipples;
  private readonly tracks = new Map<GraaoCharacter, Track>();
  private readonly shoreCoords: Float32Array;
  /** 0 far inland … 1 right on the beach or in water. */
  beachProximity = 0;
  private frameId = 0;
  private under = 0;
  private overlay: HTMLElement | null = null;
  private readonly tmpUp = new THREE.Vector3();
  private readonly tmpVel = new THREE.Vector3();
  private readonly tmpDir = new THREE.Vector3();
  private readonly tmpAt = new THREE.Vector3();
  private readonly tmpSide = new THREE.Vector3();
  private readonly tmpFwd = new THREE.Vector3();
  /** Times the "Shift dives" hint was shown (twice per session is enough). */
  private hinted = 0;
  private wasSwimming = false;
  /** Least air left during the current time under water (s): a long dive ends with a gasp. */
  private lowestBreath: number = MOVEMENT.breathTime;
  private soloDrownT = 0;

  constructor(private readonly app: GraaoApp) {
    this.ripples = new WaterRipples(app.world.terrain.seaRadius);
    app.r.scene.add(this.ripples.mesh);
    this.shoreCoords = this.extractShoreline();
  }

  private extractShoreline(): Float32Array {
    const mesh = this.app.world.mesh;
    if (!mesh) return new Float32Array(0);
    const { positions: pos, heights: hgt, indices: idx } = mesh;
    const sea = this.app.world.terrain.seaRadius - this.app.world.terrain.radius;
    const pts: number[] = [];
    const visited = new Set<number>();
    for (let i = 0; i < idx.length; i += 3) {
      const i0 = idx[i]!, i1 = idx[i + 1]!, i2 = idx[i + 2]!;
      const h0 = hgt[i0]!, h1 = hgt[i1]!, h2 = hgt[i2]!;
      const hasWater = h0 < sea || h1 < sea || h2 < sea;
      const hasLand = h0 >= sea || h1 >= sea || h2 >= sea;
      if (hasWater && hasLand) {
        for (const v of [i0, i1, i2]) {
          if (!visited.has(v) && Math.abs(hgt[v]! - sea) < 1.6) {
            visited.add(v);
            pts.push(pos[v * 3]!, pos[v * 3 + 1]!, pos[v * 3 + 2]!);
          }
        }
      }
    }
    return new Float32Array(pts);
  }

  /** Splash visuals where something hit the water (`strength` 0..1: a step … a dive). Sound is the caller's. */
  splash(at: THREE.Vector3, strength: number): void {
    const vfx = this.app.vfx;
    const up = this.tmpDir.copy(at).normalize();
    const surface = this.tmpAt.copy(up).multiplyScalar(this.app.world.terrain.seaRadius);
    const s = THREE.MathUtils.clamp(strength, 0, 1);
    vfx.burst(surface, up, { color: '#e3f5ff', count: 6 + Math.round(22 * s), speed: 2 + 4.5 * s, size: 0.12 + 0.12 * s, life: 0.75, gravity: 12, drag: 1.2, spread: 0.55, shape: Shape.DOT, category: 'Environment' });
    vfx.burst(surface, up, { color: '#f4fbff', count: 2 + Math.round(8 * s), speed: 3 + 3 * s, size: 0.16, life: 0.5, gravity: 14, drag: 1, spread: 1.05, shape: Shape.SPARK, category: 'Environment' });
    vfx.burst(surface, up, { color: '#ffffff', count: 1, speed: 0, speedJitter: 0, size: 0.8 + 1.4 * s, life: 0.28, shape: Shape.DOT, category: 'Environment' });
    this.ripples.spawn(surface, 1.1 + 2.4 * s, 1.1 + 0.7 * s, 1);
    this.ripples.spawn(surface, 0.7 + 1.2 * s, 0.8 + 0.4 * s, 0.7);
  }

  /** Per frame, after every character has been posed and the camera placed. */
  update(dt: number): void {
    const app = this.app;
    this.frameId++;
    this.ripples.update(dt);
    // Swimmers' hands are stroking: the weapon is stowed in the water; on a ledge, a wall or the glider the hands hold
    // on (docs/gameplay/TRAVERSAL_STATES.md): stowed too.
    app.combat.holder.setVisible(app.phase === 'MATCH' && !app.local.state.swimming && app.local.state.traversal === 0);
    if (app.phase === 'MATCH' && !app.deploy.riding && app.character.root.visible) {
      const s = app.local.state;
      this.track(app.character, app.character.root.position, s.swimming, s.diving, true, dt);
      this.local(dt);
    } else app.hud.setBreath(null);
    if (app.net) {
      for (const r of app.net.remotePlayers) {
        r.holder.setVisible(app.phase === 'MATCH' && !r.swimming && r.moveState < MovementState.LEDGE_HANG);
        if (r.character.root.visible) this.track(r.character, r.pos, r.swimming, r.diving, false, dt);
      }
    }
    for (const [c, t] of this.tracks) if (t.seen !== this.frameId) this.tracks.delete(c);
    this.updateUnderwater(dt);
    this.updateBeachProximity();
  }

  private updateBeachProximity(): void {
    const app = this.app;
    const feet = app.phase === 'MATCH' ? app.character.root.position : app.spawn;
    const depth = waterDepth(feet);
    if (depth >= -0.2) {
      this.beachProximity = 1;
      return;
    }
    const coords = this.shoreCoords;
    if (coords.length === 0) {
      this.beachProximity = 0;
      return;
    }
    let minD2 = Infinity;
    const px = feet.x, py = feet.y, pz = feet.z;
    for (let i = 0; i < coords.length; i += 3) {
      const dx = px - coords[i]!;
      const dy = py - coords[i + 1]!;
      const dz = pz - coords[i + 2]!;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < minD2) minD2 = d2;
    }
    const dist = Math.sqrt(minD2);
    // Smooth attenuation: 1 at 0m (shoreline) to 0 at 38m inland
    const maxDist = 38;
    const t = THREE.MathUtils.clamp(1 - dist / maxDist, 0, 1);
    this.beachProximity = t * t * (3 - 2 * t);
  }

  private track(c: GraaoCharacter, feet: THREE.Vector3, swimming: boolean, diving: boolean, mine: boolean, dt: number): void {
    let t = this.tracks.get(c);
    if (!t) {
      t = { prev: feet.clone(), has: false, depth: waterDepth(feet), diveGrace: 0, stroke: 0, wake: 0, wade: 0, drip: 0, bubble: 0, seen: 0 };
      this.tracks.set(c, t);
    }
    t.seen = this.frameId;
    const depth = waterDepth(feet);
    const up = this.tmpUp.copy(feet).normalize();
    const vel = this.tmpVel.set(0, 0, 0);
    if (t.has && dt > 0) vel.copy(feet).sub(t.prev).divideScalar(dt);
    // Teleports (respawns, snaps) are not motion.
    if (vel.lengthSq() > 40 * 40) vel.set(0, 0, 0);
    t.prev.copy(feet);
    const vUp = vel.dot(up);
    const flatVel = vel.addScaledVector(up, -vUp);
    const flat = flatVel.length();
    t.diveGrace = diving ? 0.6 : Math.max(0, t.diveGrace - dt);

    // Hitting the water (walking in only ripples; a fall splashes).
    if (t.has && t.depth <= 0.05 && depth > 0.05 && t.diveGrace <= 0) {
      const fall = Math.max(0, -vUp);
      const strength = THREE.MathUtils.clamp(fall / 12, 0, 1);
      if (fall > 3) {
        this.splash(feet, strength);
        this.sound(fall > 10 ? 'land.water' : 'splash', feet, mine, 0.5 + 0.5 * strength);
      } else this.ripples.spawn(feet, 1.2, 1.2, 0.8);
    }
    t.has = true;
    t.depth = depth;

    // Head under (a dive or a plunge): bubbles rise from the mouth.
    if (headUnderWater(feet)) {
      t.bubble += dt;
      if (t.bubble > 0.05) {
        t.bubble = 0;
        // The body rides ≈ 1.4 m above the capsule's feet while swimming (GraaoCharacter's swim lift).
        const head = this.tmpAt.copy(feet).addScaledVector(up, Math.min(depth - 0.15, 1.4));
        this.app.vfx.burst(head, up, { color: '#e2f7ff', count: 1, speed: 0.4, size: 0.08, sizeJitter: 0.5, life: 0.7, gravity: -5, drag: 2, spread: 0.9, shape: Shape.RING, category: 'Environment' });
      }
    }

    // Strokes, wakes and rings belong to the surface: a diver under it only leaves bubbles.
    if (swimming) {
      if (depth < MOVEMENT.swimFloatDepth + 0.3) this.swim(t, feet, up, flatVel, flat, mine, dt);
    } else if (depth > 0.05) this.wadeStep(t, feet, up, flat, depth, mine, dt);
    else if (c.wetness > 0.12) this.drips(t, c, feet, up, dt);
  }

  /** The local player's breath on the HUD, the gasp after a long dive, the controls hint and (solo) drowning. */
  private local(dt: number): void {
    const app = this.app;
    const s = app.local.state;
    const under = headUnderWater(s.pos);
    const air = app.local.breath;
    app.hud.setBreath(app.combat.alive && (under || air < MOVEMENT.breathTime) ? air / MOVEMENT.breathTime : null);
    if (under) this.lowestBreath = Math.min(this.lowestBreath, air);
    else if (this.lowestBreath < MOVEMENT.breathTime) {
      if (this.lowestBreath < MOVEMENT.breathTime * 0.5) app.audio.play('gasp', { volume: 0.8 });
      this.lowestBreath = MOVEMENT.breathTime;
    }
    if (s.swimming && !this.wasSwimming && this.hinted < 2) {
      this.hinted++;
      app.hud.notice('NADANDO · SHIFT MERGULHA · ESPAÇO SOBE', 2.6);
    }
    this.wasSwimming = s.swimming;
    if (!app.net) this.soloDrown(dt, under);
  }

  /** Solo has no server: drowning is played out here (Health only; at zero, back to the village spawn). */
  private soloDrown(dt: number, under: boolean): void {
    const app = this.app;
    if (!under || app.local.breath > 0 || !app.combat.alive) {
      this.soloDrownT = 0;
      return;
    }
    this.soloDrownT += dt;
    if (this.soloDrownT < MOVEMENT.drownInterval) return;
    this.soloDrownT -= MOVEMENT.drownInterval;
    app.combat.health = Math.max(0, app.combat.health - MOVEMENT.drownDamage);
    app.audio.play('hurt.health');
    app.camera.addShake(0.35, 0.22);
    app.character.anim.playOneShot('hit', { speed: 1.5 });
    if (app.combat.health > 0) return;
    app.hud.notice('VOCÊ SE AFOGOU', 2.4);
    app.audio.play('death');
    const sp = SPAWNS[0]!;
    const dir = latLonToDir(sp.lat, sp.lon);
    const g = app.world.terrain.surfaceAt(dir);
    const pos = { x: g.x + dir.x * 0.05, y: g.y + dir.y * 0.05, z: g.z + dir.z * 0.05 };
    const facing = northTangent(dir);
    app.local.teleport(pos, facing);
    app.camera.reset(new THREE.Vector3(pos.x, pos.y, pos.z), new THREE.Vector3(facing.x, facing.y, facing.z));
    app.combat.health = ATTRIBUTES.maxHealth;
  }

  private swim(t: Track, feet: THREE.Vector3, up: THREE.Vector3, flatVel: THREE.Vector3, flat: number, mine: boolean, dt: number): void {
    const vfx = this.app.vfx;
    const surface = this.tmpAt.copy(up).multiplyScalar(this.app.world.terrain.seaRadius);
    if (flat > 0.7) {
      const dir = this.tmpDir.copy(flatVel).divideScalar(flat);
      // A stroke every ~0.6 s at swim speed: spray off the leading arm and a ring around the head.
      t.stroke += dt * (flat / MOVEMENT.swimSpeed);
      if (t.stroke > 0.6) {
        t.stroke = 0;
        const arm = surface.clone().addScaledVector(dir, 0.55);
        vfx.burst(arm, dir.clone().multiplyScalar(0.6).add(up).normalize(), { color: '#e6f6ff', count: 5, speed: 2.2, size: 0.1, life: 0.5, gravity: 11, drag: 1.2, spread: 0.7, shape: Shape.DOT, category: 'Environment' });
        this.ripples.spawn(arm, 0.9, 0.9, 0.7);
        this.sound('swim.stroke', feet, mine, 0.6);
      }
      // The wake: rings dropped behind the body.
      t.wake += dt;
      if (t.wake > 0.2) {
        t.wake = 0;
        this.ripples.spawn(surface.clone().addScaledVector(dir, -0.35), 0.8 + flat * 0.18, 1.4, 0.45);
      }
    } else {
      // Treading water: slow rings around the shoulders.
      t.wake += dt;
      if (t.wake > 1.1) {
        t.wake = 0;
        this.ripples.spawn(surface, 1.3, 1.7, 0.45);
      }
    }
  }

  private wadeStep(t: Track, feet: THREE.Vector3, up: THREE.Vector3, flat: number, depth: number, mine: boolean, dt: number): void {
    const surface = this.tmpAt.copy(up).multiplyScalar(this.app.world.terrain.seaRadius);
    if (flat > 0.8) {
      // About one splash per stride.
      t.wade += dt * flat;
      if (t.wade > 1.1) {
        t.wade = 0;
        const d = Math.min(depth, MOVEMENT.swimEnterDepth);
        this.app.vfx.burst(surface, up, { color: '#e3f5ff', count: 3 + Math.round(d * 4), speed: 1.4 + flat * 0.18, size: 0.09, life: 0.45, gravity: 11, drag: 1.2, spread: 0.8, shape: Shape.DOT, category: 'Environment' });
        this.ripples.spawn(surface, 0.7 + d * 0.6, 0.9, 0.55);
        this.sound('wade', feet, mine, 0.55);
      }
    } else {
      t.wake += dt;
      if (t.wake > 1.6) {
        t.wake = 0;
        this.ripples.spawn(surface, 0.9, 1.6, 0.35);
      }
    }
  }

  /** Drops falling from the soaked part of the body, fewer as it dries. */
  private drips(t: Track, c: GraaoCharacter, feet: THREE.Vector3, up: THREE.Vector3, dt: number): void {
    t.drip += dt * c.wetness;
    const every = 0.14;
    if (t.drip < every) return;
    t.drip -= every;
    const top = Math.min(c.wetLine, 1.5);
    if (top < 0.2) return;
    const side = this.tmpSide.set(Math.abs(up.y) < 0.9 ? 0 : 1, Math.abs(up.y) < 0.9 ? 1 : 0, 0).cross(up).normalize();
    const fwd = this.tmpFwd.crossVectors(up, side);
    const a = Math.random() * Math.PI * 2;
    const h = 0.2 + Math.random() * (top - 0.2);
    // Arms and the hem stick out a little farther than the waist.
    const rad = 0.13 + Math.random() * 0.12;
    const p = this.tmpAt.copy(feet).addScaledVector(up, h).addScaledVector(side, Math.cos(a) * rad).addScaledVector(fwd, Math.sin(a) * rad);
    this.app.vfx.burst(p, this.tmpDir.copy(up).negate(), { color: '#bfe4ff', count: 1, speed: 0.25, size: 0.055, sizeJitter: 0.3, life: 0.55, gravity: 10, drag: 0.4, spread: 0.5, shape: Shape.DOT, category: 'Environment' });
  }

  private sound(cue: 'splash' | 'land.water' | 'swim.stroke' | 'wade', at: THREE.Vector3, mine: boolean, volume: number): void {
    const audio = this.app.audio;
    if (mine) {
      audio.play(cue, { volume });
      return;
    }
    const cam = this.app.r.camera;
    const d = this.tmpSide.copy(at).sub(cam.position);
    const dist = d.length();
    if (dist > 45) return;
    const right = this.tmpFwd.set(1, 0, 0).applyQuaternion(cam.quaternion);
    audio.play(cue, { volume: volume / (1 + dist / 12), pan: dist > 0.01 ? d.dot(right) / dist : 0, muffle: Math.min(0.8, dist / 60) });
  }

  /** Camera under the surface: fog, sky, overlay and sound all turn to water. */
  private updateUnderwater(dt: number): void {
    const app = this.app;
    const depth = app.phase === 'MATCH' ? waterDepth(app.r.camera.position) : -1;
    const target = depth > 0 ? 1 : 0;
    this.under = target > this.under ? Math.min(1, this.under + dt * 14) : Math.max(0, this.under - dt * 6);
    app.r.underwater = this.under;
    this.overlay ??= document.getElementById('underwater');
    if (this.overlay) this.overlay.style.opacity = this.under.toFixed(3);
    app.audio.setUnderwater(this.under > 0.5);
  }
}
