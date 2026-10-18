/**
 * Weapons (MVP: 2). Original graao designs: hand-held "blasters" that read well with one- and two-handed pistol poses.
 * Numbers are test values for Health 100 + Shield 100. Ids stay in English; `name` is what players read (pt-BR).
 */
export type WeaponId = 'sunbeam' | 'petal' | 'pistol' | 'ak47' | 'sniper' | 'smg' | 'launcher';

/** Reserve ammunition families (see `AMMO` in loot.ts): a reload takes from the reserve of the weapon's type. */
export type AmmoType = 'solar' | 'petal' | 'heavy';

export interface WeaponDefinition {
  id: WeaponId;
  name: string;
  /** Slot it occupies in the classic two-weapon loadout (E = 0, Q = 1); looted weapons go in any free slot. */
  slot: 0 | 1;
  /** Reserve this weapon reloads from. */
  ammo: AmmoType;
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
    ammo: 'solar',
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
    ammo: 'petal',
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
  pistol: {
    id: 'pistol',
    ammo: 'solar',
    name: 'Pistola Tática',
    slot: 1,
    damage: 24,
    critMultiplier: 1.8,
    fireRate: 4,
    automatic: false,
    magazine: 12,
    reloadTime: 1.4,
    range: 50,
    falloffStart: 18,
    falloffEnd: 45,
    falloffMin: 0.5,
    spreadHip: 1.8,
    spreadAim: 0.25,
    pellets: 1,
    kind: 'hitscan',
    model: 'pistol',
    animationProfile: 'pistol',
    cameraProfile: { kick: 0.012, aimFov: 50 },
    reticleProfile: 'dot-cross',
    presentationProfile: { tracer: '#8ae2ff', flash: '#d1f4ff', impact: '#9deaff' },
  },
  ak47: {
    id: 'ak47',
    ammo: 'heavy',
    name: 'Fuzil Kalash',
    slot: 0,
    damage: 22,
    critMultiplier: 1.65,
    fireRate: 5.8,
    automatic: true,
    magazine: 30,
    reloadTime: 2.1,
    range: 85,
    falloffStart: 32,
    falloffEnd: 75,
    falloffMin: 0.55,
    spreadHip: 2.0,
    spreadAim: 0.45,
    pellets: 1,
    kind: 'hitscan',
    model: 'ak47',
    animationProfile: 'pistol',
    cameraProfile: { kick: 0.01, aimFov: 50 },
    reticleProfile: 'dot-cross',
    presentationProfile: { tracer: '#ff9d42', flash: '#ffe1b3', impact: '#ffb56b' },
  },
  sniper: {
    id: 'sniper',
    ammo: 'heavy',
    name: 'Fuzil de Precisão',
    slot: 0,
    damage: 75,
    critMultiplier: 2.4,
    fireRate: 0.9,
    automatic: false,
    magazine: 5,
    reloadTime: 2.5,
    range: 160,
    falloffStart: 60,
    falloffEnd: 150,
    falloffMin: 0.8,
    spreadHip: 4.5,
    spreadAim: 0.05,
    pellets: 1,
    kind: 'hitscan',
    model: 'sniper',
    animationProfile: 'pistol',
    cameraProfile: { kick: 0.035, aimFov: 38 },
    reticleProfile: 'dot-cross',
    presentationProfile: { tracer: '#c4a1ff', flash: '#ebd9ff', impact: '#d5baff' },
  },
  smg: {
    id: 'smg',
    ammo: 'solar',
    name: 'Submetralhadora',
    slot: 1,
    damage: 13,
    critMultiplier: 1.45,
    fireRate: 11,
    automatic: true,
    magazine: 32,
    reloadTime: 1.5,
    range: 45,
    falloffStart: 14,
    falloffEnd: 38,
    falloffMin: 0.4,
    spreadHip: 2.8,
    spreadAim: 0.7,
    pellets: 1,
    kind: 'hitscan',
    model: 'smg',
    animationProfile: 'pistol',
    cameraProfile: { kick: 0.007, aimFov: 54 },
    reticleProfile: 'dot-cross',
    presentationProfile: { tracer: '#7affc0', flash: '#d4ffe9', impact: '#9effd0' },
  },
  launcher: {
    id: 'launcher',
    ammo: 'heavy',
    name: 'Lança-Foguetes',
    slot: 1,
    damage: 85,
    critMultiplier: 1.2,
    fireRate: 0.75,
    automatic: false,
    magazine: 2,
    reloadTime: 2.8,
    range: 90,
    falloffStart: 40,
    falloffEnd: 90,
    falloffMin: 0.7,
    spreadHip: 3.0,
    spreadAim: 0.5,
    pellets: 1,
    kind: 'hitscan',
    model: 'launcher',
    animationProfile: 'pistol',
    cameraProfile: { kick: 0.04, aimFov: 50 },
    reticleProfile: 'circle',
    presentationProfile: { tracer: '#ff5454', flash: '#ffbaba', impact: '#ff7a7a' },
  },
};

/** The classic two-weapon loadout (bots, and the reference for HUD/key order). Players start from `STARTING_KIT`. */
export const WEAPON_SLOTS: WeaponId[] = ['sunbeam', 'petal'];
/** Weapon slots per player: E and Q. */
export const WEAPON_SLOT_COUNT = 2;

export const ATTRIBUTES = {
  maxHealth: 100,
  maxShield: 100,
  maxMana: 100,
  /** Seconds before an eliminated player respawns in free roam. */
  respawnDelay: 4,
} as const;
