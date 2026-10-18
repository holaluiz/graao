import { describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS } from '../game/KeyBindings';
import { normalizeGameSettings } from './GameSettings';

describe('settings migration and profile values', () => {
  it('keeps old saved controls and adds the new independent controls at their original strength', () => {
    const settings = normalizeGameSettings({ quality: 'LOW', fpsCap: 60, volume: .35, sensitivity: .003, invertY: true });
    expect(settings).toMatchObject({ quality: 'LOW', fpsCap: 60, volume: .35, sensitivity: .003, invertY: true, effectsVolume: 1, ambienceVolume: 1, shakeIntensity: 1 });
    expect(settings.keyBindings).toEqual(DEFAULT_BINDINGS);
  });

  it('rejects invalid profile data and clamps supported numeric ranges', () => {
    expect(normalizeGameSettings({ volume: NaN, ambienceVolume: Infinity, effectsVolume: -4, shakeIntensity: 7, sensitivity: 100, fpsCap: 99999, quality: 'ULTRA', invertY: 'true' }))
      .toMatchObject({ volume: .8, ambienceVolume: 1, effectsVolume: 0, shakeIntensity: 1, sensitivity: .005, fpsCap: 0, quality: 'HIGH', invertY: false });
    expect(normalizeGameSettings(null)).toEqual(normalizeGameSettings([]));
  });

  it('round trips all preferences through the JSON used by local storage and the profile', () => {
    const settings = normalizeGameSettings({ effectsVolume: .45, ambienceVolume: .25, shakeIntensity: 0, keyBindings: { ...DEFAULT_BINDINGS, jump: 'KeyJ', weapon1: 'KeyT' } });
    expect(normalizeGameSettings(JSON.parse(JSON.stringify(settings)))).toEqual(settings);
    expect(settings.keyBindings.jump).toBe('KeyJ');
    expect(settings.keyBindings.weapon1).toBe('KeyT');
  });

  it('merges an older partial cloud profile without erasing newer browser preferences', () => {
    const local = normalizeGameSettings({ volume: .6, effectsVolume: .2, ambienceVolume: 0, shakeIntensity: .4, keyBindings: { ...DEFAULT_BINDINGS, jump: 'KeyJ' } });
    const restored = normalizeGameSettings({ ...local, ...{ fpsCap: 60, quality: 'MEDIUM' } });
    expect(restored).toEqual({ ...local, fpsCap: 60, quality: 'MEDIUM' });
  });
});
