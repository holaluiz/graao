import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { abilityBeaconVolume, type GamePhysics } from '@graao/game-core';
import type { AbilityEntityView } from '@graao/shared';
import { ABILITIES } from '@graao/game-data';
import { AbilityWorldPresentation, abilityEntityFrame } from './AbilityWorldPresentation';

class ElementStub {
  className = ''; hidden = false; title = ''; textContent = '';
  style: Record<string, string> = {};
  readonly children: ElementStub[] = [];
  append(...children: ElementStub[]): void { this.children.push(...children); }
  prepend(...children: ElementStub[]): void { this.children.unshift(...children); }
  remove(): void {}
}

const wall = (overrides: Partial<AbilityEntityView> = {}): AbilityEntityView => ({ id: 1, by: 0, a: 'paper_wall', kind: 'barrier', at: [0, 100000, 0], dir: [0, 0, 10000], size: [300, 220, 35], endsAt: 10000, health: 90, ...overrides });

describe('authoritative world ability presentation', () => {
  let presentation: AbilityWorldPresentation;
  let ui: ElementStub;
  let camera: THREE.PerspectiveCamera;
  let created: number;
  let removed: number;

  beforeEach(() => {
    vi.stubGlobal('document', { createElement: () => new ElementStub() });
    const collider = { setTranslation() { return this; }, setRotation() { return this; }, setCollisionGroups() { return this; } };
    created = removed = 0;
    const physics = {
      R: { ColliderDesc: { cuboid: () => collider } }, barrierHandles: new Set<number>(),
      world: { createCollider: () => ({ handle: ++created }), getCollider: (handle: number) => ({ handle }), removeCollider: () => { removed++; }, step() {} },
    } as unknown as GamePhysics;
    ui = new ElementStub(); camera = new THREE.PerspectiveCamera();
    presentation = new AbilityWorldPresentation(new THREE.Scene(), physics, camera, ui as unknown as HTMLElement);
  });
  afterEach(() => { presentation.dispose(); vi.unstubAllGlobals(); });

  it('keeps a finite orthonormal radial frame at different hemispheres and poles', () => {
    for (const at of [[0, 100000, 0], [100000, 0, 0], [0, -100000, 0], [0, 0, 100000]] as [number, number, number][]) {
      const { up, forward, side } = abilityEntityFrame(wall({ at, dir: [0, 10000, 0] }));
      expect(up.dot(forward)).toBeCloseTo(0, 6);
      expect(up.dot(side)).toBeCloseTo(0, 6);
      expect(forward.dot(side)).toBeCloseTo(0, 6);
      expect([up.length(), forward.length(), side.length()]).toEqual([1, 1, 1]);
    }
  });

  it('mirrors a barrier exactly once, updating health without allocating another collider', () => {
    presentation.onEntity(wall());
    expect(created).toBe(1);
    const root = presentation.root.children[0]!;
    expect(root.position.y).toBe(100);
    expect(root.children[0]!.scale.toArray()).toEqual([3, 2.2, .35]);
    presentation.onEntity(wall({ health: 40 }));
    expect(created).toBe(1);
    presentation.setState({ entities: [] });
    expect(removed).toBe(1);
    expect(presentation.root.children).toHaveLength(0);
  });

  it('does not duplicate the physics collider when the offline authoritative engine shares this world', () => {
    presentation.mirrorCollisions = false;
    presentation.onEntity(wall());
    expect(created).toBe(0);
    expect(presentation.root.children.length).toBe(1);
  });

  it('uses an opaque cloud in every quality and covers the view only while the camera is inside', () => {
    presentation.onEntity(wall({ a: 'chalk_cloud', kind: 'cloud', radius: 500 }));
    const mesh = presentation.root.children[0]!.children[0] as THREE.Mesh;
    const material = mesh.material as THREE.MeshBasicMaterial;
    expect(material.transparent).toBe(false);
    expect(material.side).toBe(THREE.DoubleSide);
    expect(mesh.scale.toArray()).toEqual([5, 5, 5]);
    expect(mesh.getWorldPosition(new THREE.Vector3()).toArray()).toEqual([0, 102.5, 0]);
    camera.position.set(0, 100, 0); presentation.update(1000);
    expect(ui.children[0]!.hidden).toBe(false);
    camera.position.set(0, 110, 0); presentation.update(1100);
    expect(ui.children[0]!.hidden).toBe(true);
  });

  it('keeps the interior veil aligned with the same raised sphere above and beside the cloud', () => {
    presentation.onEntity(wall({ a: 'chalk_cloud', kind: 'cloud', radius: 500 }));
    for (const position of [[0, 104, 0], [0, 107.49, 0], [4.99, 102.5, 0]]) {
      camera.position.set(position[0]!, position[1]!, position[2]!); presentation.update(1000);
      expect(ui.children[0]!.hidden).toBe(false);
    }
    for (const position of [[0, 107.51, 0], [5.01, 102.5, 0]]) {
      camera.position.set(position[0]!, position[1]!, position[2]!); presentation.update(1100);
      expect(ui.children[0]!.hidden).toBe(true);
    }
  });

  it('keeps sticky and pollen areas on the ground without turning them into vision blockers', () => {
    presentation.onEntity(wall({ a: 'sap_snare', kind: 'cloud', radius: 400 }));
    camera.position.set(0, 100, 0); presentation.update(1000);
    expect(ui.children[0]!.hidden).toBe(true);
    const ground = presentation.root.children[0]!.children[1]!;
    expect(ground.scale.y).toBeLessThan(.1);
  });

  it('expires accepted movement attachments and removes defensive attachments on elimination', () => {
    const actor = new THREE.Group();
    new THREE.Scene().add(actor);
    presentation.onCast(1, ABILITIES.paper_wings, actor, 1000);
    expect(actor.children[0]!.children).toHaveLength(2);
    presentation.update(5000);
    expect(actor.children).toHaveLength(0);
    presentation.onCast(1, ABILITIES.magic_umbrella, actor, 6000);
    expect(actor.children).toHaveLength(1);
    presentation.removeAttachment(1);
    expect(actor.children).toHaveLength(0);
    presentation.onCast(1, ABILITIES.steady_hand, actor, 7000);
    expect(actor.children).toHaveLength(0);
  });

  it('creates no hidden markers until a private server reveal arrives, then expires its bounded points', () => {
    presentation.update(1000);
    expect(presentation.root.children).toHaveLength(0);
    presentation.onReveal({ kind: 'loot', a: 'firefly_scout', by: 0, endsAt: 2000, targets: [{ id: 7, at: [0, 100000, 2000], kind: 'chest' }] });
    expect(presentation.root.children).toHaveLength(1);
    expect(presentation.root.children[0]!.position.toArray()).toEqual([0, 100, 2]);
    presentation.update(2000);
    expect(presentation.root.children).toHaveLength(0);
    presentation.onReveal({ kind: 'trail', a: 'footstep_echo', by: 0, endsAt: 3000, points: Array.from({ length: 400 }, (_, i) => [i * 10, 100000, 0] as [number, number, number]) });
    expect(presentation.root.children).toHaveLength(96);
    presentation.clearReveals();
    expect(presentation.root.children).toHaveLength(0);
  });

  it('draws the beacon lamp at the exact authoritative hit volume in every radial orientation', () => {
    for (const at of [[0, 100000, 0], [100000, 0, 0], [0, -100000, 0], [0, 0, -100000]] as [number, number, number][]) {
      presentation.setState({ entities: [wall({ a: 'firefly_beacon', kind: 'beacon', at })] });
      const lamp = presentation.root.children[0]!.children[1] as THREE.Mesh;
      const volume = abilityBeaconVolume({ x: at[0] / 1000, y: at[1] / 1000, z: at[2] / 1000 });
      const center = lamp.getWorldPosition(new THREE.Vector3());
      expect(center.distanceTo(new THREE.Vector3(volume.center.x, volume.center.y, volume.center.z))).toBeLessThan(1e-10);
      expect(lamp.scale.toArray()).toEqual([volume.radius, volume.radius, volume.radius]);
    }
  });

  it('preserves wings when a shield opens, and replaces only the same attachment channel', () => {
    const actor = new THREE.Group();
    new THREE.Scene().add(actor);
    presentation.onCast(1, ABILITIES.paper_wings, actor, 1000);
    presentation.onCast(1, ABILITIES.magic_umbrella, actor, 1500);
    expect(actor.children.map((child) => child.name)).toEqual(['ability-attachment:paper_wings', 'ability-attachment:magic_umbrella']);
    presentation.onCast(1, ABILITIES.kite_flight, actor, 2000);
    expect(actor.children.map((child) => child.name)).toEqual(['ability-attachment:magic_umbrella', 'ability-attachment:kite_flight']);
    presentation.update(4500);
    expect(actor.children.map((child) => child.name)).toEqual(['ability-attachment:kite_flight']);
    presentation.removeAttachment(1);
    expect(actor.children).toHaveLength(0);
  });

  it('shows the accepted confetti buff for its six seconds and clears every channel on reset', () => {
    const actor = new THREE.Group();
    new THREE.Scene().add(actor);
    presentation.onCast(1, ABILITIES.confetti_wheel, actor, 1000);
    const buff = actor.children[0]!;
    const wheel = buff.children[0]!;
    expect(wheel.children).toHaveLength(9);
    presentation.update(4000);
    const rotation = wheel.rotation.y;
    presentation.update(6999);
    expect(actor.children).toHaveLength(1);
    expect(wheel.rotation.y).not.toBe(rotation);
    presentation.update(7000);
    expect(actor.children).toHaveLength(0);
    presentation.onCast(1, ABILITIES.paper_wings, actor, 8000);
    presentation.onCast(1, ABILITIES.confetti_wheel, actor, 8000);
    presentation.onCast(1, ABILITIES.magic_umbrella, actor, 8000);
    expect(actor.children).toHaveLength(3);
    presentation.clear();
    expect(actor.children).toHaveLength(0);
  });
});
