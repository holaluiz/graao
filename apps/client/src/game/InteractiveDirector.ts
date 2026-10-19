/**
 * InteractiveDirector (client): the doors and breakable crates of the room (game-core interactives.ts).
 *
 * - Mirrors the server: WORLD_STATE on join and every new match, then the door and crate events. Its own
 *   InteractiveSystem keeps the colliders of the client's world in step, so the predicted character stops at a closed
 *   door exactly where the server's does. Offline (no room) it decides alone.
 * - F with no chest or item in reach uses the door ahead (LootDirector hands it over); the prompt says what F does.
 * - Draws the leaves swinging and the crates (world/InteractiveView.ts), plays the doors and the crates
 *   (audio/WorldAudio.ts) and throws splinters when a crate breaks.
 */
import * as THREE from 'three';
import { INTERACTIVES, KIT_PALETTE } from '@graao/game-data';
import { InteractiveSystem, crateCenter, doorCenter } from '@graao/game-core';
import type { GameEvent, Vec3, WorldStateMsg } from '@graao/shared';
import type { GraaoApp } from '../app/GraaoApp';
import { WorldAudio } from '../audio/WorldAudio';
import { Shape } from '../render/vfx/GRAVFXSystem';
import { InteractiveView } from '../world/InteractiveView';

export class InteractiveDirector {
  readonly system: InteractiveSystem;
  readonly view: InteractiveView;
  readonly sound: WorldAudio;
  /** The door F would use right now (−1: none). */
  target = -1;
  private readonly swing: number[];
  private seq = 0;
  private sentAt = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly right = new THREE.Vector3();

  constructor(private readonly app: GraaoApp) {
    const { world } = app;
    this.system = new InteractiveSystem({
      physics: world.physics,
      layout: world.layout,
      actors: () => [{ index: -1, state: app.local.state }],
      // Offline the client decides: its own events play like the server's.
      emit: (e) => this.present(e),
    });
    this.view = new InteractiveView(world.layout.doors, world.layout.crates, app.planet.kitMaterial);
    app.r.scene.add(this.view.group);
    this.sound = new WorldAudio(app.audio, world.layout.placements);
    this.swing = this.system.doorOpen.map((o) => (o ? 1 : 0));
    this.snap();
  }

  /** Offline play or a fresh room: doors as built, every crate whole. */
  reset(): void {
    this.system.reset();
    this.snap();
  }

  /** WORLD_STATE from the room. */
  onState(m: WorldStateMsg): void {
    this.system.apply(m);
    this.snap();
  }

  /** The room's events: doors and crates are ours. */
  onEvents(events: GameEvent[]): void {
    for (const e of events) if (this.system.onEvent(e)) this.present(e);
  }

  /** F with nothing to loot: open or close the door ahead. Returns true when there was one. */
  use(): boolean {
    const id = this.target;
    if (id < 0) return false;
    const net = this.app.net;
    if (!net) {
      if (!this.system.toggle(id, -1)) this.app.hud.notice('TEM ALGUÉM NA PORTA', 1.0);
      return true;
    }
    const now = performance.now();
    if (now - this.sentAt < INTERACTIVES.door.intervalMs + 20) return true;
    this.sentAt = now;
    this.seq = (this.seq + 1) & 0x7fffffff;
    net.sendWorldUse({ s: this.seq, id });
    return true;
  }

  /** What F does here, for the loot prompt (null: no door in reach). */
  prompt(): { action: string } | null {
    if (this.target < 0) return null;
    return { action: this.system.doorOpen[this.target] ? 'Fechar porta' : 'Abrir porta' };
  }

  update(dt: number, _time: number): void {
    const app = this.app;
    // The door ahead, while playing and on foot.
    const playing = app.phase === 'MATCH' && app.combat.alive && !app.deploy.riding && !app.deploy.diving && !app.local.state.swimming;
    this.target = playing ? this.system.doorNear(app.local.state.pos, app.camera.frame.view) : -1;
    // Leaves swing toward their state (the colliders already changed).
    const step = dt / (INTERACTIVES.door.swingMs / 1000);
    for (let i = 0; i < this.swing.length; i++) {
      const goal = this.system.doorOpen[i] ? 1 : 0;
      const s = this.swing[i]!;
      if (s === goal) continue;
      const n = goal > s ? Math.min(goal, s + step) : Math.max(goal, s - step);
      this.swing[i] = n;
      // Ease out both ways: fast at first, settling against the wall or the frame.
      this.view.setDoor(i, goal ? 1 - (1 - n) * (1 - n) : n * n);
    }
    // The region beds follow the camera (the ear), muted from orbit and in the Tormenta like the wind.
    const cam = app.r.camera;
    this.right.set(1, 0, 0).applyQuaternion(cam.quaternion);
    const orbit = Math.min(1, Math.max(0, (cam.position.length() - 130) / 60));
    this.sound.update(dt, cam.position, this.right, (1 - orbit) * app.tormenta.ambience * (app.phase === 'MATCH' || app.phase === 'MENU' ? 1 : 0.6));
  }

  // ------------------------------------------------------------------------------------------------ presentation

  /** Leaves at their state at once (join, reset). */
  private snap(): void {
    for (let i = 0; i < this.swing.length; i++) {
      this.swing[i] = this.system.doorOpen[i] ? 1 : 0;
      this.view.setDoor(i, this.swing[i]!);
    }
    for (let i = 0; i < this.system.crateHp.length; i++) this.view.setCrate(i, this.system.crateHp[i]! > 0);
  }

  /** Sound and splinters of a door or crate event. */
  private present(e: GameEvent): void {
    const cam = this.app.r.camera.position;
    if (e.e === 'door') {
      const d = this.system.doors[e.id];
      if (d) this.sound.door(doorCenter(d), e.open === 1, cam, this.right);
      return;
    }
    if (e.e !== 'crate') return;
    const p = this.system.crates[e.id];
    if (!p) return;
    const c = crateCenter(p);
    this.sound.crate(c, e.hp <= 0, cam, this.right);
    const at = this.tmp.set(c.x, c.y, c.z);
    const up = this.tmp2.copy(at).normalize();
    if (e.hp <= 0) {
      this.view.setCrate(e.id, false);
      this.app.vfx.burst(at, up, { color: KIT_PALETTE.madeiraClara, count: 26, speed: 4.5, speedJitter: 0.6, size: 0.16, sizeJitter: 0.5, life: 0.9, gravity: 14, drag: 1.2, shape: Shape.SHARD, spread: 1.4, category: 'CombatBurst' });
      this.app.vfx.burst(at, up, { color: KIT_PALETTE.madeira, count: 12, speed: 2.5, size: 0.22, life: 0.7, gravity: 12, shape: Shape.SHARD, spread: 2.2, category: 'CombatBurst' });
    } else {
      this.app.vfx.burst(at, up, { color: KIT_PALETTE.madeiraClara, count: 6, speed: 2.4, size: 0.08, life: 0.4, gravity: 10, shape: Shape.SHARD, spread: 1.8, category: 'CombatBurst' });
    }
  }

  /** Positions for tests and the dev console. */
  doorPoint(id: number): Vec3 | null {
    const d = this.system.doors[id];
    return d ? doorCenter(d) : null;
  }
}
