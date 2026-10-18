import { afterEach, describe, expect, it, vi } from 'vitest';
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

describe('camera shake comfort setting', () => {
  afterEach(() => vi.restoreAllMocks());

  const feet = new THREE.Vector3(0, 90, 0);
  const facing = new THREE.Vector3(0, 0, 1);

  function makeCamera(intensity: number): GraaoThirdPersonCamera {
    const camera = new GraaoThirdPersonCamera(new THREE.PerspectiveCamera());
    camera.reset(feet, facing, true);
    camera.setShakeIntensity(intensity);
    return camera;
  }

  it('scales displacement while retaining heading, aiming and weapon recoil', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const off = makeCamera(0);
    const half = makeCamera(0.5);
    const full = makeCamera(1);
    for (const camera of [off, half, full]) {
      camera.look(0.22, 0.12);
      camera.aim = true;
      camera.kick(0.1, 0.03);
      camera.addShake(1, 0.5);
      camera.update(1 / 60, feet, null);
    }

    const fullOffset = full.camera.position.clone().sub(off.camera.position);
    const halfOffset = half.camera.position.clone().sub(off.camera.position);
    expect(fullOffset.length()).toBeGreaterThan(0.1);
    expect(halfOffset.distanceTo(fullOffset.clone().multiplyScalar(0.5))).toBeLessThan(1e-10);
    for (const camera of [half, full]) {
      expect(camera.heading.distanceTo(off.heading)).toBeLessThan(1e-10);
      expect(camera.frame.forward.distanceTo(off.frame.forward)).toBeLessThan(1e-10);
      expect(camera.frame.view.distanceTo(off.frame.view)).toBeLessThan(1e-10);
      expect(camera.camera.fov).toBe(off.camera.fov);
    }
    const noRecoil = makeCamera(0);
    noRecoil.look(0.22, 0.12);
    noRecoil.aim = true;
    noRecoil.update(1 / 60, feet, null);
    expect(off.frame.view.distanceTo(noRecoil.frame.view)).toBeGreaterThan(0.05);
  });

  it('turning shake off clears an existing impulse and ignores new impulses until reenabled', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const camera = makeCamera(1);
    const clean = makeCamera(0);
    camera.addShake(2, 5);
    camera.update(1 / 60, feet, null);
    camera.setShakeIntensity(0);
    camera.addShake(3, 10);
    camera.update(1 / 60, feet, null);
    clean.update(1 / 60, feet, null);
    expect(camera.camera.position.distanceTo(clean.camera.position)).toBeLessThan(1e-10);
    camera.setShakeIntensity(1);
    camera.update(1 / 60, feet, null);
    expect(camera.camera.position.distanceTo(clean.camera.position)).toBeLessThan(1e-10);
    camera.addShake(1, 0.5);
    camera.update(1 / 60, feet, null);
    expect(camera.camera.position.distanceTo(clean.camera.position)).toBeGreaterThan(0.1);
  });

  it('clamps valid strengths and ignores nonfinite input without changing the selected strength', () => {
    const camera = makeCamera(1);
    camera.setShakeIntensity(-2);
    expect(camera.shakeIntensity).toBe(0);
    camera.setShakeIntensity(2);
    expect(camera.shakeIntensity).toBe(1);
    camera.setShakeIntensity(0.35);
    for (const value of [NaN, Infinity, -Infinity]) camera.setShakeIntensity(value);
    expect(camera.shakeIntensity).toBe(0.35);
  });
});
