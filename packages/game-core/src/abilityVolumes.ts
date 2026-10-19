/** Shared opaque spell volume. The replicated position is its ground anchor, not its centre. */
import { v3addScaled, v3normalize, type Vec3 } from '@graao/shared';

export interface AbilityCloudVolume {
  center: Vec3;
  radius: number;
}

/** Shots, the visible mesh and the interior camera veil must agree on this same radial sphere. */
export function abilityCloudVolume(ground: Vec3, radius: number): AbilityCloudVolume {
  return { center: v3addScaled(ground, v3normalize(ground), radius * 0.5), radius };
}

/** The visible lantern is the beacon's destructible body; its thin support is decorative. */
export function abilityBeaconVolume(ground: Vec3): AbilityCloudVolume {
  return { center: v3addScaled(ground, v3normalize(ground), 2.6), radius: 0.5 };
}
