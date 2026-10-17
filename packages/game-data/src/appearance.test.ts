import { describe, expect, it } from 'vitest';
import { APPEARANCE_KEYS } from '@graao/shared';
import { APPEARANCE_OPTIONS, DEFAULT_APPEARANCE, migrateAppearance, randomAppearance, validateAppearance } from './appearance';

describe('appearance catalog', () => {
  it('has unique ids per option list and a valid default', () => {
    for (const k of APPEARANCE_KEYS) {
      const ids = APPEARANCE_OPTIONS[k].map((o) => o.id);
      expect(new Set(ids).size, k).toBe(ids.length);
    }
    expect(validateAppearance(DEFAULT_APPEARANCE)).toBe(true);
  });

  it('random looks are always valid and leave optional slots empty about half the time', () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    let hats = 0;
    for (let i = 0; i < 400; i++) {
      const a = randomAppearance(rand);
      expect(validateAppearance(a)).toBe(true);
      if (a.hatId !== 'hat.none') hats++;
    }
    expect(hats).toBeGreaterThan(120);
    expect(hats).toBeLessThan(280);
  });

  it('migrates a save from the previous catalog without losing pieces', () => {
    const old = {
      bodyId: 'body.sturdy',
      faceId: 'face.bright',
      skinId: 'skin.caramel',
      hairId: 'hair.ponytail',
      hairColorId: 'hair.teal',
      topId: 'top.hoodie',
      topColorId: 'fabric.orange',
      bottomId: 'bottom.culottes',
      bottomColorId: 'fabric.moss',
      shoesId: 'shoes.boots',
      shoesColorId: 'fabric.plum',
      accessoryId: 'acc.bag',
    };
    expect(validateAppearance(old)).toBe(false);
    const a = migrateAppearance(old)!;
    expect(validateAppearance(a)).toBe(true);
    expect(a).toMatchObject({ ...old, accessoryId: 'acc.none', extraId: 'extra.bag', hatId: 'hat.none', beardId: 'beard.none' });
  });

  it('replaces unknown ids with defaults and rejects non-objects', () => {
    const a = migrateAppearance({ ...DEFAULT_APPEARANCE, hairId: 'hair.gone', topColorId: 42 })!;
    expect(a.hairId).toBe(DEFAULT_APPEARANCE.hairId);
    expect(a.topColorId).toBe(DEFAULT_APPEARANCE.topColorId);
    expect(migrateAppearance(null)).toBeNull();
    expect(migrateAppearance('x')).toBeNull();
  });
});
