/**
 * Abilities (MVP: 8 basics + 3 ultimates). Original graao designs built from a handful of reusable primitives
 * (Damage, Projectile, Area, Dash, Shield, Heal, Slow, Knockback) that the server executes (GRAAbilitySystem in
 * `@graao/game-core`). Ids stay in English; `name` and `blurb` are what players read (pt-BR).
 *
 * Numbers are test values for Health 100 + Shield 100 + Mana 100 (regen `ABILITY_RULES.manaRegen` per second).
 * Counterplay rule: every big hit has a visible projectile or a ground warning; Ultimates warn for 0.5–1 s.
 */
export type AbilityId =
  | 'sun_orb'
  | 'wind_step'
  | 'pollen_burst'
  | 'leaf_shell'
  | 'thorn_seed'
  | 'gust_ring'
  | 'sap_snare'
  | 'bloom'
  | 'sun_meteor'
  | 'petal_cyclone'
  | 'dawn_lance'
  | 'steady_hand'
  | 'firefly_scout';

export type AbilityKind = 'active' | 'passive' | 'ultimate';
export type AbilityCategory = 'mobility' | 'control' | 'defense' | 'exploration' | 'passive' | 'ultimate';
export type DebuffKind = 'slow' | 'root' | 'silence' | 'noSprint';
export type StatusKind = DebuffKind | 'speed';

export interface BotAbilityProfile {
  role: 'mobility' | 'control' | 'defense' | 'exploration' | 'passive' | 'ultimate';
  minRange: number;
  maxRange: number;
  healthBelow?: number;
  needsAir?: boolean;
  needsSurface?: boolean;
}

export interface PassiveDefinition {
  type: 'outOfCombatSpeed' | 'weaponHandling' | 'weaponSwap' | 'scavenger' | 'quietSteps' | 'shieldRegen' | 'airControl' | 'debuffResistance';
  /** Primary multiplier or amount; interpretation is named by `type`. */
  factor: number;
  delay?: number;
  ceiling?: number;
  bonus?: number;
}

/** Reusable effect primitives. Nested effects (projectile `onHit`, area `effects`) apply to each victim. */
export type AbilityEffect =
  | { kind: 'damage'; amount: number }
  /** Server-simulated projectile: radial gravity (m/s² toward the planet centre, 0 = straight), radius inflates hitboxes. */
  | { kind: 'projectile'; speed: number; radius: number; gravity: number; lifetime: number; onHit: AbilityEffect[] }
  /**
   * Area around a centre (the target point, the caster, or a projectile's impact). Resolves after `delay` s, `pulses`
   * times every `interval` s; `follow` re-centres each pulse on the caster. `edge` = damage fraction at the rim.
   * Walls between the centre and a victim protect it.
   */
  | { kind: 'area'; radius: number; delay: number; pulses: number; interval: number; follow: boolean; edge: number; effects: AbilityEffect[]; target?: 'enemies' | 'self' | 'all' }
  /** Caster moves `distance` m along the requested direction in `duration` s (shared character controller). */
  | { kind: 'dash'; distance: number; duration: number }
  /** Restores Shield up to the maximum. */
  | { kind: 'shield'; amount: number }
  /** Restores Health up to the maximum. */
  | { kind: 'heal'; amount: number }
  /** Movement speed × factor for duration s (the stronger slow wins). */
  | { kind: 'slow'; factor: number; duration: number }
  /** Velocity impulse away from the source along the ground (m/s) plus `lift` along local up; ungrounds the target. */
  | { kind: 'knockback'; strength: number; lift: number }
  | { kind: 'temporaryShield'; amount: number; duration: number }
  | { kind: 'status'; status: StatusKind; factor?: number; duration: number }
  | { kind: 'cleanse'; statuses: DebuffKind[]; resistance: number; duration: number }
  | { kind: 'mobility'; mode: 'jump' | 'grapple' | 'slide' | 'glide' | 'ricochet' | 'flight'; distance?: number; duration?: number; speed?: number; lift?: number; gravityFactor?: number; airControl?: number; surfaceRange?: number }
  | { kind: 'barrier'; count: number; health: number; duration: number; width: number; height: number; depth: number }
  | { kind: 'reveal'; mode: 'target' | 'resources' | 'trails' | 'activity' | 'beacon'; radius: number; duration: number; history?: number; interval?: number; health?: number }
  | { kind: 'trap'; duration: number; radius: number; effects: AbilityEffect[] }
  | { kind: 'cloud'; radius: number; duration: number }
  | { kind: 'wave'; distance: number; width: number; strength: number; lift: number; duration: number }
  | { kind: 'portal'; duration: number; range: number; reentry: number }
  | { kind: 'frontShield'; duration: number; arc: number };

export type AbilityTargetType = 'self' | 'direction' | 'point' | 'none';
export type AbilityAnim = 'cast' | 'throw' | 'dash' | 'buff' | 'channel';
export type AbilityIcon = 'orb' | 'wind' | 'pollen' | 'leaf' | 'seed' | 'ring' | 'drop' | 'flower' | 'sun' | 'spiral' | 'lance' | 'steady_hand' | 'firefly_scout';
export type UltimateMarkId = 'sun_crown' | 'petal_orbit' | 'dawn_lance';

export interface AbilityPresentation {
  /** Main and secondary colors (VFX, HUD icon). Never the only cue: every ability also has its own shape. */
  color: string;
  color2: string;
  icon: AbilityIcon;
  anim: AbilityAnim;
  /** Synthesized audio cue family (GRAAudioManager). */
  cue: 'orb' | 'dash' | 'pollen' | 'shield' | 'seed' | 'gust' | 'sap' | 'heal' | 'meteor' | 'cyclone' | 'lance';
  /** Ground warning drawn for every player while an area is pending (ring) or a line along a charged shot (lane). */
  telegraph?: 'ring' | 'lane';
  /** Ultimates only: the persistent mark opponents see on this player (which Ultimate, never whether it is ready). */
  mark?: UltimateMarkId;
}

export interface AbilityDefinition {
  id: AbilityId;
  /** pt-BR display name. */
  name: string;
  /** pt-BR one-line description (HUD tooltip, draft). */
  blurb: string;
  slotType: 'basic' | 'ultimate';
  kind: AbilityKind;
  category: AbilityCategory;
  bot: BotAbilityProfile;
  passive?: PassiveDefinition;
  manaCost: number;
  /** Seconds, started when the server accepts the cast. */
  cooldown: number;
  /** Wind-up (s) between acceptance and the effects; the caster cannot fire or cast meanwhile. */
  castTime: number;
  /** Max distance (m) to a point target; projectile reach for direction abilities (speed × lifetime). */
  range: number;
  targetType: AbilityTargetType;
  tags: string[];
  effects: AbilityEffect[];
  presentation: AbilityPresentation;
}

type AbilitySeed = Omit<AbilityDefinition, 'kind' | 'category' | 'bot'> & Partial<Pick<AbilityDefinition, 'kind' | 'category' | 'bot'>>;
const def = (d: AbilitySeed): AbilityDefinition => {
  const kind = d.kind ?? (d.slotType === 'ultimate' ? 'ultimate' : 'active');
  const category = d.category ?? (d.slotType === 'ultimate' ? 'ultimate' : d.id === 'wind_step' ? 'mobility' : d.id === 'leaf_shell' || d.id === 'bloom' ? 'defense' : d.id === 'sun_orb' ? 'exploration' : 'control');
  return { ...d, kind, category, bot: d.bot ?? { role: category, minRange: 0, maxRange: d.range || 12 } };
};

export const ABILITIES: Record<AbilityId, AbilityDefinition> = {
  // ------------------------------------------------------------------------------------------------ basics
  sun_orb: def({
    id: 'sun_orb',
    name: 'Orbe Solar',
    blurb: 'Revele o primeiro adversário atingido por uma esfera de luz.',
    slotType: 'basic',
    manaCost: 20,
    cooldown: 10,
    castTime: 0,
    range: 20,
    targetType: 'direction',
    tags: ['projectile', 'reveal'],
    effects: [{ kind: 'projectile', speed: 40, radius: 0.35, gravity: 0, lifetime: 0.5, onHit: [{ kind: 'reveal', mode: 'target', radius: 20, duration: 4 }] }],
    presentation: { color: '#ffc94a', color2: '#fff1b8', icon: 'orb', anim: 'cast', cue: 'orb' },
  }),
  wind_step: def({
    id: 'wind_step',
    name: 'Passo de Vento',
    blurb: 'Um impulso de vento na direção em que você anda.',
    slotType: 'basic',
    manaCost: 15,
    cooldown: 7,
    castTime: 0,
    range: 6,
    targetType: 'direction',
    tags: ['dash', 'mobility'],
    effects: [{ kind: 'dash', distance: 6, duration: 0.2 }],
    presentation: { color: '#bfeee0', color2: '#ffffff', icon: 'wind', anim: 'dash', cue: 'dash' },
  }),
  pollen_burst: def({
    id: 'pollen_burst',
    name: 'Explosão de Pólen',
    blurb: 'Marca o chão; depois de um instante o pólen explode e deixa todos lentos.',
    slotType: 'basic',
    manaCost: 30,
    cooldown: 7,
    castTime: 0.25,
    range: 22,
    targetType: 'point',
    tags: ['area', 'damage', 'slow'],
    effects: [
      {
        kind: 'area',
        radius: 3.8,
        delay: 0.65,
        pulses: 1,
        interval: 0,
        follow: false,
        edge: 1,
        effects: [
          { kind: 'damage', amount: 34 },
          { kind: 'slow', factor: 0.55, duration: 1.6 },
        ],
      },
    ],
    presentation: { color: '#f2c84b', color2: '#fff3a6', icon: 'pollen', anim: 'cast', cue: 'pollen', telegraph: 'ring' },
  }),
  leaf_shell: def({
    id: 'leaf_shell',
    name: 'Casulo de Folhas',
    blurb: 'Receba 40 de escudo temporário por até sete segundos.',
    slotType: 'basic',
    manaCost: 30,
    cooldown: 18,
    castTime: 0,
    range: 0,
    targetType: 'self',
    tags: ['defensive', 'shield'],
    effects: [{ kind: 'temporaryShield', amount: 40, duration: 7 }],
    presentation: { color: '#7fc4ff', color2: '#cfe9ff', icon: 'leaf', anim: 'buff', cue: 'shield' },
  }),
  thorn_seed: def({
    id: 'thorn_seed',
    name: 'Semente de Espinhos',
    blurb: 'Uma semente em arco que estoura em espinhos onde cair.',
    slotType: 'basic',
    manaCost: 25,
    cooldown: 6,
    castTime: 0,
    range: 40,
    targetType: 'direction',
    tags: ['projectile', 'area', 'damage'],
    effects: [
      {
        kind: 'projectile',
        speed: 24,
        radius: 0.3,
        gravity: 14,
        lifetime: 2.5,
        onHit: [{ kind: 'area', radius: 3.2, delay: 0, pulses: 1, interval: 0, follow: false, edge: 0.6, effects: [{ kind: 'damage', amount: 32 }] }],
      },
    ],
    presentation: { color: '#8fc45a', color2: '#e3f5b0', icon: 'seed', anim: 'throw', cue: 'seed' },
  }),
  gust_ring: def({
    id: 'gust_ring',
    name: 'Anel de Vento',
    blurb: 'Empurra para longe quem estiver perto de você.',
    slotType: 'basic',
    manaCost: 25,
    cooldown: 8,
    castTime: 0,
    range: 0,
    targetType: 'self',
    tags: ['area', 'knockback', 'defensive'],
    effects: [
      {
        kind: 'area',
        radius: 4.5,
        delay: 0.12,
        pulses: 1,
        interval: 0,
        follow: true,
        edge: 1,
        effects: [
          { kind: 'damage', amount: 14 },
          { kind: 'knockback', strength: 11, lift: 5 },
        ],
      },
    ],
    presentation: { color: '#d6f4ff', color2: '#ffffff', icon: 'ring', anim: 'buff', cue: 'gust', telegraph: 'ring' },
  }),
  sap_snare: def({
    id: 'sap_snare',
    name: 'Seiva Pegajosa',
    blurb: 'Crie uma poça que dificulta a passagem por cinco segundos.',
    slotType: 'basic',
    manaCost: 20,
    cooldown: 12,
    castTime: 0,
    range: 18,
    targetType: 'point',
    tags: ['area', 'slow'],
    effects: [
      {
        kind: 'area', radius: 4, delay: 0, pulses: 20, interval: 0.25, follow: false, edge: 1,
        effects: [{ kind: 'status', status: 'slow', factor: 0.65, duration: 0.4 }],
      },
    ],
    presentation: { color: '#e09a3c', color2: '#ffd39a', icon: 'drop', anim: 'throw', cue: 'sap' },
  }),
  bloom: def({
    id: 'bloom',
    name: 'Florescer',
    blurb: 'Uma flor se abre sob seus pés e cura 35 de vida.',
    slotType: 'basic',
    manaCost: 35,
    cooldown: 14,
    castTime: 0,
    range: 0,
    targetType: 'self',
    tags: ['defensive', 'heal'],
    effects: [{ kind: 'heal', amount: 35 }],
    presentation: { color: '#8fd46e', color2: '#f7c6d8', icon: 'flower', anim: 'buff', cue: 'heal' },
  }),

  // ------------------------------------------------------------------------------------------------ ultimates
  sun_meteor: def({
    id: 'sun_meteor',
    name: 'Meteoro Solar',
    blurb: 'Chama um pedaço do sol: um aviso no chão e, um segundo depois, a queda.',
    slotType: 'ultimate',
    manaCost: 50,
    cooldown: 90,
    castTime: 0.45,
    range: 30,
    targetType: 'point',
    tags: ['ultimate', 'area', 'damage', 'knockback'],
    effects: [
      {
        kind: 'area',
        radius: 6,
        delay: 1.0,
        pulses: 1,
        interval: 0,
        follow: false,
        edge: 1,
        effects: [
          { kind: 'damage', amount: 35 },
          { kind: 'knockback', strength: 7, lift: 3 },
        ],
      },
    ],
    presentation: { color: '#ff9a3c', color2: '#ffe08a', icon: 'sun', anim: 'channel', cue: 'meteor', telegraph: 'ring', mark: 'sun_crown' },
  }),
  petal_cyclone: def({
    id: 'petal_cyclone',
    name: 'Ciclone de Pétalas',
    blurb: 'Pétalas giram ao seu redor e cortam quem chegar perto, várias vezes.',
    slotType: 'ultimate',
    manaCost: 50,
    cooldown: 40,
    castTime: 0.3,
    range: 0,
    targetType: 'self',
    tags: ['ultimate', 'area', 'damage', 'slow'],
    effects: [
      {
        kind: 'area',
        radius: 5.5,
        delay: 0.5,
        pulses: 4,
        interval: 0.45,
        follow: true,
        edge: 1,
        effects: [
          { kind: 'damage', amount: 24 },
          { kind: 'slow', factor: 0.6, duration: 0.8 },
        ],
      },
    ],
    presentation: { color: '#f29bb5', color2: '#ffe3ea', icon: 'spiral', anim: 'channel', cue: 'cyclone', telegraph: 'ring', mark: 'petal_orbit' },
  }),
  dawn_lance: def({
    id: 'dawn_lance',
    name: 'Lança da Aurora',
    blurb: 'Carrega uma lança de luz (todos veem a linha) e a dispara em linha reta.',
    slotType: 'ultimate',
    manaCost: 50,
    cooldown: 40,
    castTime: 0.7,
    range: 70,
    targetType: 'direction',
    tags: ['ultimate', 'projectile', 'damage', 'knockback'],
    effects: [
      {
        kind: 'projectile',
        speed: 70,
        radius: 0.55,
        gravity: 0,
        lifetime: 1,
        onHit: [
          { kind: 'damage', amount: 80 },
          { kind: 'knockback', strength: 12, lift: 4 },
        ],
      },
    ],
    presentation: { color: '#ff8fb0', color2: '#fff0c8', icon: 'lance', anim: 'channel', cue: 'lance', telegraph: 'lane', mark: 'dawn_lance' },
  }),
  steady_hand: def({
    id: 'steady_hand', name: 'Mão Firme', blurb: 'Reduza em 12% o recuo e a dispersão das armas.',
    slotType: 'basic', kind: 'passive', category: 'passive', manaCost: 0, cooldown: 0, castTime: 0, range: 0,
    targetType: 'none', tags: ['passive', 'weapon'], effects: [], passive: { type: 'weaponHandling', factor: 0.88 },
    presentation: { color: '#f4cc73', color2: '#fff1cb', icon: 'steady_hand', anim: 'buff', cue: 'shield' },
  }),
  firefly_scout: def({
    id: 'firefly_scout', name: 'Vaga-Lume Explorador', blurb: 'Encontre baús fechados e itens próximos, sem revelar inimigos.',
    slotType: 'basic', category: 'exploration', manaCost: 15, cooldown: 15, castTime: 0.15, range: 12,
    targetType: 'self', tags: ['reveal', 'resources'], effects: [{ kind: 'reveal', mode: 'resources', radius: 12, duration: 5 }],
    presentation: { color: '#ddf87a', color2: '#fff9c9', icon: 'firefly_scout', anim: 'cast', cue: 'heal' },
  }),
};

export const ABILITY_IDS = Object.keys(ABILITIES) as AbilityId[];
export const BASIC_ABILITIES = ABILITY_IDS.filter((id) => ABILITIES[id].slotType === 'basic');
export const ULTIMATE_ABILITIES = ABILITY_IDS.filter((id) => ABILITIES[id].slotType === 'ultimate');

export const isAbilityId = (v: unknown): v is AbilityId => typeof v === 'string' && Object.prototype.hasOwnProperty.call(ABILITIES, v);

/** Loadout slots: keys 1, 2, 3 (basics) and 4 (Ultimate). */
export const LOADOUT_SLOTS = 4;
export const ULTIMATE_SLOT = 3;
export type Loadout = [AbilityId, AbilityId, AbilityId, AbilityId];

/**
 * Default loadouts until the Ability Draft exists (Phase 6), handed out by player index. The first two together show
 * every primitive in a 1v1: projectile, dash, area, defensive, knockback, slow and two different Ultimates.
 */
export const DEFAULT_LOADOUTS: Loadout[] = [
  ['sun_orb', 'wind_step', 'pollen_burst', 'sun_meteor'],
  ['thorn_seed', 'leaf_shell', 'gust_ring', 'petal_cyclone'],
  ['sap_snare', 'wind_step', 'bloom', 'dawn_lance'],
];

export const ABILITY_RULES = {
  /** Mana regenerated per second while alive. */
  manaRegen: 8,
  /** The Ultimate charges this long after a match starts or a player spawns (s); it never starts a life ready. */
  ultimateInitialCharge: 15,
  maxPassives: 1,
  maxSpeedFactor: 1.3,
  minSlowFactor: 0.3,
  maxStatusSeconds: 20,
  minDebuffMs: 150,
  maxHardControlMs: 800,
  hardControlRecoveryMs: 1000,
} as const;
