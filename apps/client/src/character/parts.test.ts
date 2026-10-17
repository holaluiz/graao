/** Builds every catalog piece on both bodies and checks the merged geometry is sane (no NaN, nothing flying off). */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { APPEARANCE_OPTIONS, BODIES, DEFAULT_APPEARANCE, HAIRS, HATS, TOPS, randomAppearance } from '@graao/game-data';
import type { CharacterAppearance } from '@graao/shared';
import { CharacterPartLibrary, buildPalette } from './CharacterAppearanceController';
import { PALETTE_SIZE } from './build/PartBuilder';
import { createOutlineMaterial, createStylizedMaterial } from '../render/materials/GRAStylizedMaterial';

const PIECES: (keyof CharacterAppearance)[] = ['faceId', 'beardId', 'hairId', 'topId', 'bottomId', 'shoesId', 'hatId', 'accessoryId', 'extraId'];

function check(lib: CharacterPartLibrary, a: CharacterAppearance): void {
  const { geometry } = lib.build(a);
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const slot = geometry.getAttribute('aSlot') as THREE.BufferAttribute;
  const idx = geometry.getIndex()!;
  const label = JSON.stringify(a);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (!Number.isFinite(x + y + z)) throw new Error(`NaN vertex in ${label}`);
    // Arms reach ~0.8 m to the side in the T-pose; the afro with a hat on top stays under 2.2 m.
    if (Math.abs(x) > 0.9 || y < -0.03 || y > 2.2 || Math.abs(z) > 0.45) throw new Error(`vertex out of bounds (${x}, ${y}, ${z}) in ${label}`);
    const sl = slot.getX(i);
    if (sl < 0 || sl >= PALETTE_SIZE) throw new Error(`slot ${sl} in ${label}`);
  }
  for (let t = 0; t < idx.count; t++) if (idx.getX(t) >= pos.count) throw new Error(`index out of range in ${label}`);
  const pal = buildPalette(a);
  expect(pal.length).toBe(PALETTE_SIZE);
  const magenta = new THREE.Color('#ff00ff');
  const used = new Set<number>();
  for (let i = 0; i < slot.count; i++) used.add(slot.getX(i));
  for (const s of used) expect(pal[s]!.equals(magenta), `palette slot ${s} unresolved in ${label}`).toBe(false);
}

describe('character parts', () => {
  const lib = new CharacterPartLibrary();

  it('builds every piece on both bodies', () => {
    for (const body of BODIES) {
      for (const key of PIECES) {
        for (const o of APPEARANCE_OPTIONS[key]) check(lib, { ...DEFAULT_APPEARANCE, bodyId: body.id, [key]: o.id });
      }
    }
  });

  it('fits every hat over every hairstyle and every body extra over every top', () => {
    for (const hair of HAIRS) for (const hat of HATS) check(lib, { ...DEFAULT_APPEARANCE, hairId: hair.id, hatId: hat.id, accessoryId: 'acc.flor' });
    for (const top of TOPS) for (const extra of APPEARANCE_OPTIONS.extraId) check(lib, { ...DEFAULT_APPEARANCE, topId: top.id, extraId: extra.id });
  });

  it('declares as many palette colors in both shaders as the palette fills', () => {
    const m = createStylizedMaterial({ variant: 'character' });
    const outline = createOutlineMaterial(m.uniforms.uPalette!.value as THREE.Color[]);
    expect((m.uniforms.uPalette!.value as THREE.Color[]).length).toBe(PALETTE_SIZE);
    for (const src of [m.vertexShader, outline.vertexShader]) expect(src).toContain(`uniform vec3 uPalette[${PALETTE_SIZE}];`);
    expect(buildPalette(DEFAULT_APPEARANCE).length).toBe(PALETTE_SIZE);
  });

  it('handles random combinations', () => {
    let seed = 3;
    const rand = () => ((seed = (seed * 48271) % 2147483647) - 1) / 2147483646;
    for (let i = 0; i < 60; i++) check(lib, randomAppearance(rand));
  });
});
