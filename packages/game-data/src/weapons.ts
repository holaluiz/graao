/**
 * Weapons (MVP: 2). Original graao designs: hand-held "blasters" that read well with one- and two-handed pistol poses.
 * Numbers are test values for Health 100 + Shield 100. Ids stay in English; `name` is what players read (pt-BR).
 */
export type WeaponId = 'sunbeam' | 'petal';

export interface WeaponDefinition {
  id: WeaponId;
  name: string;
  /** Input slot: E = 0, Q = 1. */
  slot: 0 | 1;
  /** Damage per bullet/pellet on the body. */
  damage: number;
  /** Multiplier on head hits (CRITICAL). */
  critMultiplier: number;
  /** Shots per second. */
  fireRate: number;
  automatic: boolean;
  magazine: number;
  reloadTime: number;
  /** Max hit distance (m) and damage falloff start/end. */
  range: number;
  falloffStart: number;
  falloffEnd: number;
  /** Minimum damage fraction at falloffEnd. */
  falloffMin: number;
  /** Cone half-angle (degrees) from the hip and while aiming. */
  spreadHip: number;
  spreadAim: number;
  pellets: number;
  kind: 'hitscan' | 'projectile';
  model: WeaponId;
  animationProfile: 'pistol';
  cameraProfile: { kick: number; aimFov: number };
  reticleProfile: 'dot-cross' | 'circle';
  presentationProfile: { tracer: string; flash: string; impact: string };
}

export const WEAPONS: Record<WeaponId, WeaponDefinition> = {
  sunbeam: {
    id: 'sunbeam',
    name: 'Raio de Sol',
    slot: 0,
    damage: 16,
    critMultiplier: 1.6,
    fireRate: 7,
    automatic: true,
    magazine: 24,
    reloadTime: 1.7,
    range: 80,
    falloffStart: 30,
    falloffEnd: 70,
    falloffMin: 0.6,
    spreadHip: 1.4,
    spreadAim: 0.35,
    pellets: 1,
    kind: 'hitscan',
    model: 'sunbeam',
    animationProfile: 'pistol',
    cameraProfile: { kick: 0.006, aimFov: 52 },
    reticleProfile: 'dot-cross',
    presentationProfile: { tracer: '#ffd36e', flash: '#fff1b8', impact: '#ffe2a0' },
  },
  petal: {
    id: 'petal',
    name: 'Rajada de Pétalas',
    slot: 1,
    damage: 11,
    critMultiplier: 1.3,
    fireRate: 1.25,
    automatic: false,
    magazine: 4,
    reloadTime: 2.1,
    range: 22,
    falloffStart: 6,
    falloffEnd: 18,
    falloffMin: 0.35,
    spreadHip: 5.5,
    spreadAim: 4.2,
    pellets: 8,
    kind: 'hitscan',
    model: 'petal',
    animationProfile: 'pistol',
    cameraProfile: { kick: 0.02, aimFov: 58 },
    reticleProfile: 'circle',
    presentationProfile: { tracer: '#f29bb5', flash: '#ffd1de', impact: '#f7b2c6' },
  },
};

export const WEAPON_SLOTS: WeaponId[] = ['sunbeam', 'petal'];

export const ATTRIBUTES = {
  maxHealth: 100,
  maxShield: 100,
  maxMana: 100,
  /** Seconds before an eliminated player respawns in free roam. */
  respawnDelay: 4,
} as const;
