/**
 * Rendering-independent character appearance. Used by the local creator, remote players, the Colyseus room, Supabase
 * persistence and (later) replays. Only ids live here; geometry and colors are resolved by the client from the catalog.
 * Geometry ids and color ids are separate: one top shape supports many colors without duplicated geometry.
 */
export interface CharacterAppearance {
  bodyId: string;
  faceId: string;
  /** Facial hair; takes the hair color. */
  beardId: string;
  skinId: string;
  hairId: string;
  hairColorId: string;
  topId: string;
  topColorId: string;
  bottomId: string;
  bottomColorId: string;
  shoesId: string;
  shoesColorId: string;
  hatId: string;
  hatColorId: string;
  /** Face/head accessory (glasses, earrings…). */
  accessoryId: string;
  /** Body accessory (bags, chains, flag cape…). */
  extraId: string;
}

export const APPEARANCE_KEYS: readonly (keyof CharacterAppearance)[] = [
  'bodyId',
  'faceId',
  'beardId',
  'skinId',
  'hairId',
  'hairColorId',
  'topId',
  'topColorId',
  'bottomId',
  'bottomColorId',
  'shoesId',
  'shoesColorId',
  'hatId',
  'hatColorId',
  'accessoryId',
  'extraId',
];

/** Validates the *shape* of an appearance (all keys present, short safe strings). Catalog membership is checked by
 * `@graao/game-data`'s `validateAppearance`. */
export function isAppearanceShape(v: unknown): v is CharacterAppearance {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  for (const k of APPEARANCE_KEYS) {
    const s = o[k];
    if (typeof s !== 'string' || s.length === 0 || s.length > 40 || !/^[a-z0-9._-]+$/.test(s)) return false;
  }
  return true;
}
