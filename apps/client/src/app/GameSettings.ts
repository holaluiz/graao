import { FPS_CAPS, type FpsCap } from './FrameLimiter';
import type { Quality } from '../render/GRARenderer';
import { normalizeBindings, type KeyBindings } from '../game/KeyBindings';

export interface GameSettings {
  quality: Quality;
  fpsCap: FpsCap;
  volume: number;
  effectsVolume: number;
  ambienceVolume: number;
  sensitivity: number;
  invertY: boolean;
  shakeIntensity: number;
  /** Comfort: no field-of-view changes (dive, glide) and no camera pull-back on ledges and walls. */
  reducedCameraMotion: boolean;
  keyBindings: KeyBindings;
}

/** Old local saves and partial cloud profiles gain defaults; invalid values never reach runtime controls. */
export function normalizeGameSettings(value: unknown, mobile = false): GameSettings {
  const v = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const number = (key: string, fallback: number, min: number, max: number): number => typeof v[key] === 'number' && Number.isFinite(v[key])
    ? Math.max(min, Math.min(max, v[key] as number)) : fallback;
  return {
    quality: ['LOW', 'MEDIUM', 'HIGH'].includes(String(v.quality)) ? v.quality as Quality : mobile ? 'LOW' : 'HIGH',
    fpsCap: (FPS_CAPS as readonly unknown[]).includes(v.fpsCap) ? v.fpsCap as FpsCap : mobile ? 30 : 0,
    volume: number('volume', .8, 0, 1),
    effectsVolume: number('effectsVolume', 1, 0, 1),
    ambienceVolume: number('ambienceVolume', 1, 0, 1),
    sensitivity: number('sensitivity', .0022, .0005, .005),
    invertY: v.invertY === true,
    shakeIntensity: number('shakeIntensity', 1, 0, 1),
    reducedCameraMotion: v.reducedCameraMotion === true,
    keyBindings: normalizeBindings(v.keyBindings),
  };
}
