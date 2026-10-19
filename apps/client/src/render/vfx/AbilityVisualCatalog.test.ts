import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ABILITIES, ULTIMATE_ABILITIES } from '@graao/game-data';
import { ABILITY_ICONS } from '../../ui/abilityIcons';
import { UltimateMark } from './UltimateMarks';

describe('ability visual catalog coverage', () => {
  it('gives every one of the forty spells its own glyph', () => {
    const glyphs = Object.values(ABILITIES).map((ability) => ABILITY_ICONS[ability.presentation.icon]);
    expect(glyphs).toHaveLength(40);
    expect(glyphs.every((glyph) => typeof glyph === 'string' && glyph.includes('<'))).toBe(true);
    expect(new Set(glyphs).size).toBe(40);
  });

  it('builds ten distinct persistent marks with finite geometry and no renderer or cooldown dependency', () => {
    const shapes = new Set<string>();
    for (const id of ULTIMATE_ABILITIES) {
      const markId = ABILITIES[id].presentation.mark!;
      const mark = new UltimateMark(markId);
      expect(mark.group.position.y).toBeGreaterThan(2);
      expect(mark.triangles).toBeGreaterThan(10);
      const signatures: string[] = [];
      mark.group.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const position = object.geometry.getAttribute('position');
        expect(Array.from(position.array).every(Number.isFinite)).toBe(true);
        signatures.push(Array.from(position.array).join(','));
      });
      shapes.add(signatures.join('|'));
      mark.update(.25);
      expect(mark.group.children[0]!.rotation.toArray().slice(0, 3).every((value) => typeof value === 'number' && Number.isFinite(value))).toBe(true);
      mark.dispose();
    }
    expect(shapes.size).toBe(10);
  });
});
