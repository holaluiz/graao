import { describe, expect, it } from 'vitest';
import { abilityCloudVolume } from './abilityVolumes';

describe('shared opaque cloud volume', () => {
  it.each([
    [{ x: 0, y: 100, z: 0 }, { x: 0, y: 102.5, z: 0 }],
    [{ x: 100, y: 0, z: 0 }, { x: 102.5, y: 0, z: 0 }],
    [{ x: 0, y: -100, z: 0 }, { x: 0, y: -102.5, z: 0 }],
    [{ x: 0, y: 0, z: -100 }, { x: 0, y: 0, z: -102.5 }],
  ])('uses the radial ground anchor %j for both visibility and authority', (ground, center) => {
    expect(abilityCloudVolume(ground, 5)).toEqual({ center, radius: 5 });
  });
});
