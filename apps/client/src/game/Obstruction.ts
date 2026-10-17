/**
 * Camera obstruction: props between the camera and the local character dissolve with a paper-like dither instead of
 * snapping the camera forward. Rays from the camera to the character's head, chest and feet query the Rapier prop
 * colliders; hit placements fade out quickly and fade back in gently. Props very close to the camera also fade.
 */
import * as THREE from 'three';
import { GROUPS_PROP_QUERY, type GamePhysics } from '@graao/game-core';
import type { PlanetView, PropInstanceRef } from '../world/PlanetView';

export class Obstruction {
  private readonly active = new Map<number, { ref: PropInstanceRef; target: number }>();
  private readonly ray;
  /** Props whose collider is within this distance of the camera fade even off the sight lines (posts, trunks). */
  private readonly nearBall;
  private static readonly IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
  stats = { fading: 0, rays: 0 };

  constructor(private readonly physics: GamePhysics, private readonly view: PlanetView) {
    this.ray = new physics.R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    this.nearBall = new physics.R.Ball(1.1);
  }

  update(dt: number, camera: THREE.Vector3, feet: THREE.Vector3, up: THREE.Vector3): void {
    for (const a of this.active.values()) a.target = 0;
    const targets = [1.55, 1.0, 0.35].map((h) => feet.clone().addScaledVector(up, h));
    this.stats.rays = 0;
    for (const t of targets) {
      const dir = t.clone().sub(camera);
      const len = dir.length();
      if (len < 0.01) continue;
      dir.divideScalar(len);
      this.ray.origin = camera;
      this.ray.dir = dir;
      this.stats.rays++;
      this.physics.world.intersectionsWithRay(
        this.ray,
        Math.max(0, len - 0.35),
        true,
        (hit) => {
          const p = this.physics.propByCollider.get(hit.collider.handle);
          if (p) this.mark(p.id, 0.82);
          return true;
        },
        undefined,
        GROUPS_PROP_QUERY,
      );
    }
    this.physics.world.intersectionsWithShape(
      camera,
      Obstruction.IDENTITY,
      this.nearBall,
      (c) => {
        const p = this.physics.propByCollider.get(c.handle);
        if (p) this.mark(p.id, 0.7);
        return true;
      },
      undefined,
      GROUPS_PROP_QUERY,
    );
    // Animate fades.
    for (const [id, a] of this.active) {
      const cur = this.view.getInstanceFade(a.ref);
      const rate = a.target > cur ? 10 : 3.5;
      const next = cur + (a.target - cur) * (1 - Math.exp(-dt * rate));
      if (a.target === 0 && next < 0.01) {
        this.view.setInstanceFade(a.ref, 0);
        this.active.delete(id);
      } else this.view.setInstanceFade(a.ref, next);
    }
    this.stats.fading = this.active.size;
  }

  private mark(id: number, target: number): void {
    const existing = this.active.get(id);
    if (existing) {
      existing.target = Math.max(existing.target, target);
      return;
    }
    const ref = this.view.instances.get(id);
    if (ref) this.active.set(id, { ref, target });
  }
}
