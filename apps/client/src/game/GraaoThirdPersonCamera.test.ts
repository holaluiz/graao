import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { GamePhysics } from '@graao/game-core';
import { GraaoThirdPersonCamera } from './GraaoThirdPersonCamera';

describe('camera target reset', () => {
  it.each([
    [new THREE.Vector3(150, 0, 0), new THREE.Vector3(0, 0, 1)],
    [new THREE.Vector3(0, -55, 0), new THREE.Vector3(1, 0, 0)],
    [new THREE.Vector3(30, 40, 120), new THREE.Vector3(0, 1, 0)],
  ])('snaps to a distant target without inheriting height, aim, collision distance or effects', (feet, facing) => {
    const camera = new GraaoThirdPersonCamera(new THREE.PerspectiveCamera());
    camera.reset(new THREE.Vector3(0, 90, 0), new THREE.Vector3(0, 0, 1));
    camera.aim = true;
    camera.pitch = 0.85;
    camera.fovBoost = 22;
    camera.kick(0.12, 0.2);
    camera.addShake(2, 10);
    const nearWall = { castRay: () => ({ toi: 1 }) } as unknown as GamePhysics;
    camera.update(0.25, new THREE.Vector3(0, 90, 0), nearWall);

    camera.reset(feet, facing, true);
    const frame = camera.update(1 / 60, feet, null);
    const fresh = new GraaoThirdPersonCamera(new THREE.PerspectiveCamera());
    fresh.reset(feet, facing);
    fresh.update(1 / 60, feet, null);

    expect(camera.aim).toBe(false);
    expect(camera.pitch).toBe(-0.18);
    expect(camera.fovBoost).toBe(0);
    expect(camera.camera.fov).toBe(70);
    expect(camera.pivotPoint.distanceTo(fresh.pivotPoint)).toBeLessThan(1e-10);
    expect(camera.camera.position.distanceTo(fresh.camera.position)).toBeLessThan(1e-10);
    expect(camera.camera.quaternion.angleTo(fresh.camera.quaternion)).toBeLessThan(1e-7);
    expect([...camera.camera.position.toArray(), ...frame.forward.toArray(), ...frame.view.toArray()].every(Number.isFinite)).toBe(true);
  });

  it('preserves existing view settings and smooth vertical following when snap is omitted', () => {
    const camera = new GraaoThirdPersonCamera(new THREE.PerspectiveCamera());
    const facing = new THREE.Vector3(0, 0, 1);
    camera.reset(new THREE.Vector3(0, 90, 0), facing);
    camera.update(1 / 60, new THREE.Vector3(0, 90, 0), null);
    camera.pitch = 0.4;
    camera.aim = true;
    camera.fovBoost = 7;
    camera.reset(new THREE.Vector3(0, 150, 0), facing);
    camera.update(1 / 60, new THREE.Vector3(0, 150, 0), null);
    expect(camera.pitch).toBe(0.4);
    expect(camera.aim).toBe(true);
    expect(camera.fovBoost).toBe(7);
    expect(camera.pivotPoint.y).toBeGreaterThan(90);
    expect(camera.pivotPoint.y).toBeLessThan(140);
  });
});
