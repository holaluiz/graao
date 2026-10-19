import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { cloneCharacterState, createGameWorld, latLonToDir, northTangent, type CharacterState } from '@graao/game-core';
import { SPAWNS } from '@graao/game-data';
import { SIM_DT } from '@graao/shared';
import type { CameraFrame } from './GraaoThirdPersonCamera';
import type { Input } from './Input';
import { LocalPlayer } from './LocalPlayer';

const world = await createGameWorld({ includeVisual: false });

describe('LocalPlayer reconciliation', () => {
  it('a snapshot that confirms the prediction moves nothing on screen (no jerk on every snapshot)', () => {
    const input = { isDown: (k: string) => k === 'forward' } as unknown as Input;
    // Runs north for 1.5 s from a spawn; frames that are not a whole number of steps leave an interpolation alpha
    // between 0 and 1, like a real display.
    const run = (spawn: (typeof SPAWNS)[number]) => {
      const dir = latLonToDir(spawn.lat, spawn.lon);
      const ground = world.terrain.surfaceAt(dir);
      const north = northTangent(dir);
      const lp = new LocalPlayer(world.physics, { x: ground.x + dir.x * 0.1, y: ground.y + dir.y * 0.1, z: ground.z + dir.z * 0.1 }, north);
      const up = new THREE.Vector3(dir.x, dir.y, dir.z);
      const forward = new THREE.Vector3(north.x, north.y, north.z);
      const cam: CameraFrame = { forward, right: forward.clone().cross(up).normalize(), up, view: forward.clone() };
      const confirmed = new Map<number, CharacterState>();
      let alpha = 0;
      for (let f = 0; f < 66; f++) {
        alpha = lp.update(SIM_DT * 1.37, input, cam, true);
        confirmed.set(lp.nextSeq - 1, cloneCharacterState(lp.state));
      }
      return { lp, alpha, confirmed };
    };
    // The first spawn with open ground to the north (the world's layout changes; a wall would stop the run).
    let r = run(SPAWNS[0]!);
    for (const spawn of SPAWNS.slice(1)) {
      if (r.lp.speed() > 3) break;
      r.lp.dispose();
      r = run(spawn);
    }
    const { lp, alpha, confirmed } = r;
    expect(alpha).toBeGreaterThan(0.05);
    expect(lp.speed()).toBeGreaterThan(3);
    // The server simulated exactly what the client predicted, up to a command a few frames back.
    const seqs = [...confirmed.keys()];
    const ack = seqs[seqs.length - 6]!;
    const before = lp.renderPosition(alpha, new THREE.Vector3());
    lp.reconcile(confirmed.get(ack)!, ack);
    const after = lp.renderPosition(alpha, new THREE.Vector3());
    expect(lp.stats.replayed).toBeGreaterThan(3);
    expect(after.distanceTo(before)).toBeLessThan(1e-4);
  });
});
