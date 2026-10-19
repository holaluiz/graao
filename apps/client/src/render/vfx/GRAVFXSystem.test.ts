import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DecalMode, GRAVFXSystem } from './GRAVFXSystem';

/** Inspect the submitted ground geometry, without a renderer, private fields or a GPU. */
function decalBuffer(vfx: GRAVFXSystem): { position: THREE.BufferAttribute; params: THREE.BufferAttribute } {
  const mesh = vfx.group.children.find((child) => child instanceof THREE.Mesh && (child.material as THREE.Material).name === 'GRAVFX/GroundDecal') as THREE.Mesh;
  return { position: mesh.geometry.getAttribute('position') as THREE.BufferAttribute, params: mesh.geometry.getAttribute('aDecal') as THREE.BufferAttribute };
}

function submittedSlots(vfx: GRAVFXSystem): { mode: number; birth: number; life: number; vertices: number[] }[] {
  const { position, params } = decalBuffer(vfx);
  const verticesPerSlot = params.count / 20;
  return Array.from({ length: 20 }, (_, slot) => {
    const first = slot * verticesPerSlot;
    return { mode: params.getZ(first), birth: params.getX(first), life: params.getY(first), vertices: Array.from(position.array.slice(first * 3, (first + verticesPerSlot) * 3)) };
  });
}

const ground = { x: 0, y: 100, z: 0 };

describe('ground warning capacity', () => {
  it.each(['LOW', 'HIGH'] as const)('keeps both warning styles through repeated pollen pulses in %s', (quality) => {
    const vfx = new GRAVFXSystem(quality);
    vfx.decal(ground, 6, '#ff9a3c', 1.45, DecalMode.TELEGRAPH_ENEMY);
    vfx.decal({ x: 12, y: 100, z: 0 }, 6, '#79b9ed', 1.45, DecalMode.TELEGRAPH_OWN);
    const warnings = submittedSlots(vfx).slice(0, 2);

    // Nine other casters can emit new shockwaves and pigment every quarter second.
    for (let pulse = 0; pulse < 5; pulse++) {
      vfx.update(.25);
      for (let actor = 0; actor < 9; actor++) {
        vfx.decal(ground, 7, '#f29bb5', .5, DecalMode.SHOCKWAVE);
        vfx.decal(ground, 7, '#f29bb5', 2.5, DecalMode.SPLASH);
      }
      expect(submittedSlots(vfx).slice(0, 2)).toEqual(warnings);
    }
    expect(vfx.group.children).toHaveLength(3);
    expect(submittedSlots(vfx)).toHaveLength(20);
  });

  it('admits a warning over a cosmetic decal when the fixed pool is full', () => {
    const vfx = new GRAVFXSystem('HIGH');
    for (let slot = 0; slot < 19; slot++) vfx.decal(ground, 6, '#ff9a3c', 2, DecalMode.TELEGRAPH_ENEMY);
    vfx.decal(ground, 2, '#f29bb5', 2, DecalMode.SPLASH);
    const warnings = submittedSlots(vfx).slice(0, 19);
    vfx.decal({ x: 12, y: 100, z: 0 }, 8, '#79b9ed', 3, DecalMode.TELEGRAPH_OWN);
    const slots = submittedSlots(vfx);
    expect(slots.slice(0, 19)).toEqual(warnings);
    expect(slots[19]).toMatchObject({ mode: DecalMode.TELEGRAPH_OWN, life: 3 });
    expect(vfx.active).toBe(20);
  });

  it('preserves twenty active warnings under saturation and admits another after expiry', () => {
    const vfx = new GRAVFXSystem('HIGH');
    for (let slot = 0; slot < 20; slot++) vfx.decal(ground, 6, '#ff9a3c', 2, slot % 2 ? DecalMode.TELEGRAPH_ENEMY : DecalMode.TELEGRAPH_OWN);
    const before = submittedSlots(vfx);
    const vertexCount = decalBuffer(vfx).params.count;
    for (const mode of [DecalMode.SPLASH, DecalMode.SHOCKWAVE, DecalMode.TELEGRAPH_ENEMY, DecalMode.TELEGRAPH_OWN]) {
      vfx.decal({ x: 12, y: 100, z: 0 }, 8, '#79b9ed', 3, mode);
    }
    expect(submittedSlots(vfx)).toEqual(before);
    expect(vfx.active).toBe(20);
    expect(decalBuffer(vfx).params.count).toBe(vertexCount);

    vfx.update(2.01);
    vfx.decal({ x: 12, y: 100, z: 0 }, 8, '#79b9ed', 3, DecalMode.TELEGRAPH_OWN);
    expect(vfx.active).toBe(1);
    expect(submittedSlots(vfx)[0]).toMatchObject({ mode: DecalMode.TELEGRAPH_OWN, life: 3 });
  });

  it('reuses an expired warning before replacing a live shockwave', () => {
    const vfx = new GRAVFXSystem('HIGH');
    vfx.decal(ground, 6, '#ff9a3c', .1, DecalMode.TELEGRAPH_ENEMY);
    for (let slot = 1; slot < 20; slot++) vfx.decal(ground, 4, '#f29bb5', 5, DecalMode.SHOCKWAVE);
    const shockwaves = submittedSlots(vfx).slice(1);
    vfx.update(.2);
    vfx.decal({ x: 12, y: 100, z: 0 }, 8, '#79b9ed', 3, DecalMode.TELEGRAPH_OWN);
    expect(submittedSlots(vfx).slice(1)).toEqual(shockwaves);
    expect(submittedSlots(vfx)[0]).toMatchObject({ mode: DecalMode.TELEGRAPH_OWN, life: 3 });
  });
});
