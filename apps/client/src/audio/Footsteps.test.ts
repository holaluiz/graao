import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { MovementState } from '@graao/shared';
import type { GamePhysics, Terrain } from '@graao/game-core';
import type { GraaoCharacter } from '../character/GraaoCharacter';
import type { GRAAudioManager } from './GRAAudioManager';
import { Footsteps } from './Footsteps';

it('Pé de Algodão reduces actual remote spatial footfalls by 40% without changing own or weapon audio', () => {
  const play = vi.fn();
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 0, 100);
  const root = new THREE.Group();
  root.position.set(3, 0, 101);
  const character = { root, consumeSteps: () => 1, consumeJump: () => false, consumeLanding: () => 0 } as unknown as GraaoCharacter;
  const physics = { terrainHandle: 1, castRayNormal: () => ({ handle: 1, normal: { x: 0, y: 0, z: 1 } }), surfaceByCollider: new Map(), propByCollider: new Map() } as unknown as GamePhysics;
  const footsteps = new Footsteps({ play } as unknown as GRAAudioManager, physics, { seaRadius: 90 } as Terrain, camera);
  footsteps.update([{ character, moveState: MovementState.RUN, mine: false, gain: 1 }]);
  footsteps.update([{ character, moveState: MovementState.RUN, mine: false, gain: 0.6 }]);
  expect(play).toHaveBeenCalledTimes(2);
  expect(play.mock.calls[1]![1].volume / play.mock.calls[0]![1].volume).toBeCloseTo(0.6);
  expect(play.mock.calls[1]![1].threat).toBe(true);
  expect(play.mock.calls.every(([cue]) => String(cue).startsWith('step.'))).toBe(true);
  footsteps.update([{ character, moveState: MovementState.RUN, mine: true, gain: 0.6 }]);
  expect(play.mock.calls[2]![1].volume).toBe(0.8);
});
