/**
 * Ability System v2: 30 basics (including 8 automatic passives) and 10 tactical Ultimates.
 * The authoritative system composes reusable effect primitives; weapons remain the main source of damage.
 * Existing ids remain stable, including petal_cyclone (Festa de Pólen) and dawn_lance (Arrastão de Vento).
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
  | 'firefly_scout'
  | 'kite_jump' | 'clothesline' | 'slide' | 'paper_wings' | 'ricochet'
  | 'chalk_cloud' | 'vine_lasso' | 'hollow_bell'
  | 'paper_wall' | 'magic_umbrella' | 'rain_bath'
  | 'footstep_echo' | 'backyard_eye'
  | 'wind_foot' | 'quick_swap' | 'backyard_scavenger' | 'soft_step' | 'new_bark' | 'kite_breath' | 'anti_glue'
  | 'winter_garden' | 'kite_flight' | 'paper_city' | 'firefly_beacon' | 'ink_tide' | 'confetti_wheel' | 'chalk_shortcut';

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
export type AbilityIcon = 'orb' | 'wind' | 'pollen' | 'leaf' | 'seed' | 'ring' | 'drop' | 'flower' | 'sun' | 'spiral' | 'lance'
  | Exclude<AbilityId, 'sun_orb' | 'wind_step' | 'pollen_burst' | 'leaf_shell' | 'thorn_seed' | 'gust_ring' | 'sap_snare' | 'bloom' | 'sun_meteor' | 'petal_cyclone' | 'dawn_lance'>;
export type UltimateMarkId = 'sun_crown' | 'petal_orbit' | 'dawn_lance' | 'winter_branch' | 'paper_kite' | 'paper_city' | 'firefly_lantern' | 'ink_wave' | 'confetti_ring' | 'chalk_gate';

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
    cooldown: 12,
    castTime: 0.25,
    range: 22,
    targetType: 'point',
    tags: ['area', 'slow'],
    effects: [
      {
        kind: 'area',
        radius: 5,
        delay: 0.65,
        pulses: 1,
        interval: 0,
        follow: false,
        edge: 1,
        effects: [
          { kind: 'status', status: 'slow', factor: 0.7, duration: 3 },
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
    blurb: 'Plante uma armadilha visível que prende brevemente quem passar.',
    slotType: 'basic',
    manaCost: 25,
    cooldown: 16,
    castTime: 0,
    range: 8,
    targetType: 'point',
    tags: ['trap', 'root'],
    bot: { role: 'control', minRange: 0, maxRange: 10 },
    effects: [{ kind: 'trap', duration: 20, radius: 1.8, effects: [{ kind: 'status', status: 'root', duration: 0.8 }] }],
    presentation: { color: '#8fc45a', color2: '#e3f5b0', icon: 'seed', anim: 'throw', cue: 'seed' },
  }),
  gust_ring: def({
    id: 'gust_ring',
    name: 'Anel de Vento',
    blurb: 'Empurra para longe quem estiver perto de você.',
    slotType: 'basic',
    manaCost: 25,
    cooldown: 14,
    castTime: 0,
    range: 0,
    targetType: 'self',
    tags: ['area', 'knockback', 'defensive'],
    bot: { role: 'control', minRange: 0, maxRange: 5 },
    effects: [
      {
        kind: 'area',
        radius: 5,
        delay: 0.12,
        pulses: 1,
        interval: 0,
        follow: true,
        edge: 1,
        effects: [
          { kind: 'knockback', strength: 10, lift: 1.5 },
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
    blurb: 'Crie uma flor que recupera até 35 de Vida ao longo de dois segundos.',
    slotType: 'basic',
    manaCost: 35,
    cooldown: 20,
    castTime: 0.2,
    range: 0,
    targetType: 'self',
    tags: ['defensive', 'heal'],
    bot: { role: 'defense', minRange: 0, maxRange: 30, healthBelow: 75 },
    effects: [{ kind: 'area', radius: 2.5, delay: 0, pulses: 5, interval: 0.5, follow: false, edge: 1, target: 'self', effects: [{ kind: 'heal', amount: 7 }] }],
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
    name: 'Festa de Pólen',
    blurb: 'Crie uma grande tempestade de pólen que dificulta a passagem.',
    slotType: 'ultimate',
    manaCost: 50,
    cooldown: 95,
    castTime: 0.3,
    range: 22,
    targetType: 'point',
    tags: ['ultimate', 'area', 'slow'],
    effects: [
      {
        kind: 'area',
        radius: 7,
        delay: 0.5,
        pulses: 32,
        interval: 0.25,
        follow: false,
        edge: 1,
        effects: [
          { kind: 'status', status: 'slow', factor: 0.65, duration: 0.4 },
        ],
      },
    ],
    presentation: { color: '#f29bb5', color2: '#ffe3ea', icon: 'spiral', anim: 'channel', cue: 'cyclone', telegraph: 'ring', mark: 'petal_orbit' },
  }),
  dawn_lance: def({
    id: 'dawn_lance',
    name: 'Arrastão de Vento',
    blurb: 'Uma rajada percorre o terreno e afasta adversários do caminho.',
    slotType: 'ultimate',
    manaCost: 50,
    cooldown: 85,
    castTime: 0.5,
    range: 20,
    targetType: 'direction',
    tags: ['ultimate', 'wave', 'knockback'],
    effects: [{ kind: 'wave', distance: 20, width: 5, strength: 15, lift: 1.5, duration: 1.5 }],
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
  kite_jump: def({
    id: 'kite_jump', name: 'Pulo de Pipa', blurb: 'Ganhe um salto mágico adicional enquanto estiver no ar.',
    slotType: 'basic', category: 'mobility', manaCost: 15, cooldown: 10, castTime: 0, range: 0,
    targetType: 'self', tags: ['mobility', 'air'], bot: { role: 'mobility', minRange: 0, maxRange: 30, needsAir: true },
    effects: [{ kind: 'mobility', mode: 'jump', lift: 9.5, duration: 0.2 }],
    presentation: { color: '#6bc8e5', color2: '#f9f3c6', icon: 'kite_jump', anim: 'buff', cue: 'dash' },
  }),
  clothesline: def({
    id: 'clothesline', name: 'Linha de Varal', blurb: 'Prenda uma corda em uma superfície e puxe-se até ela.',
    slotType: 'basic', category: 'mobility', manaCost: 25, cooldown: 14, castTime: 0, range: 14,
    targetType: 'direction', tags: ['mobility', 'grapple'], bot: { role: 'mobility', minRange: 2, maxRange: 14, needsSurface: true },
    effects: [{ kind: 'mobility', mode: 'grapple', distance: 14, duration: 1.2, speed: 16, surfaceRange: 14 }],
    presentation: { color: '#d9aa73', color2: '#fff1d7', icon: 'clothesline', anim: 'throw', cue: 'sap' },
  }),
  slide: def({
    id: 'slide', name: 'Escorrega', blurb: 'Deslize rente ao chão para se reposicionar rapidamente.',
    slotType: 'basic', category: 'mobility', manaCost: 15, cooldown: 9, castTime: 0, range: 5,
    targetType: 'direction', tags: ['mobility', 'slide'],
    effects: [{ kind: 'mobility', mode: 'slide', distance: 5, duration: 0.35, speed: 14.3 }],
    presentation: { color: '#74d9c1', color2: '#dcfff2', icon: 'slide', anim: 'dash', cue: 'dash' },
  }),
  paper_wings: def({
    id: 'paper_wings', name: 'Asa de Papel', blurb: 'Plane por até quatro segundos e controle melhor sua queda.',
    slotType: 'basic', category: 'mobility', manaCost: 20, cooldown: 15, castTime: 0, range: 0,
    targetType: 'self', tags: ['mobility', 'glide'], bot: { role: 'mobility', minRange: 0, maxRange: 30, needsAir: true },
    effects: [{ kind: 'mobility', mode: 'glide', duration: 4, gravityFactor: 0.2, airControl: 1.4, speed: 9 }],
    presentation: { color: '#ece4cf', color2: '#ffffff', icon: 'paper_wings', anim: 'buff', cue: 'gust' },
  }),
  ricochet: def({
    id: 'ricochet', name: 'Ricochete', blurb: 'Use uma parede próxima para impulsionar-se na direção oposta.',
    slotType: 'basic', category: 'mobility', manaCost: 15, cooldown: 12, castTime: 0, range: 2,
    targetType: 'direction', tags: ['mobility', 'wall'], bot: { role: 'mobility', minRange: 0, maxRange: 20, needsSurface: true },
    effects: [{ kind: 'mobility', mode: 'ricochet', surfaceRange: 2, distance: 5, duration: 0.3, speed: 14, lift: 6 }],
    presentation: { color: '#ffad65', color2: '#fff0b7', icon: 'ricochet', anim: 'dash', cue: 'gust' },
  }),
  chalk_cloud: def({
    id: 'chalk_cloud', name: 'Nuvem de Giz', blurb: 'Crie uma cortina opaca que esconde a visão através da área.',
    slotType: 'basic', category: 'control', manaCost: 30, cooldown: 18, castTime: 0.2, range: 18,
    targetType: 'point', tags: ['cloud', 'vision'], effects: [{ kind: 'cloud', radius: 5, duration: 5 }],
    presentation: { color: '#e3dfe9', color2: '#ffffff', icon: 'chalk_cloud', anim: 'throw', cue: 'pollen' },
  }),
  vine_lasso: def({
    id: 'vine_lasso', name: 'Laço de Cipó', blurb: 'Acerte um cipó que impede o alvo de correr por um instante.',
    slotType: 'basic', category: 'control', manaCost: 25, cooldown: 14, castTime: 0, range: 18,
    targetType: 'direction', tags: ['projectile', 'noSprint'],
    effects: [{ kind: 'projectile', speed: 30, radius: 0.35, gravity: 0, lifetime: 0.6, onHit: [{ kind: 'status', status: 'noSprint', duration: 2.5 }] }],
    presentation: { color: '#72b466', color2: '#dcf7a8', icon: 'vine_lasso', anim: 'throw', cue: 'seed' },
  }),
  hollow_bell: def({
    id: 'hollow_bell', name: 'Sino Oco', blurb: 'Interrompa conjurações próximas e silencie magias brevemente.',
    slotType: 'basic', category: 'control', manaCost: 30, cooldown: 20, castTime: 0.1, range: 0,
    targetType: 'self', tags: ['area', 'silence'], bot: { role: 'control', minRange: 0, maxRange: 5 },
    effects: [{ kind: 'area', radius: 5, delay: 0, pulses: 1, interval: 0, follow: true, edge: 1, effects: [{ kind: 'status', status: 'silence', duration: 0.8 }] }],
    presentation: { color: '#c6a869', color2: '#fff0b7', icon: 'hollow_bell', anim: 'buff', cue: 'gust' },
  }),
  paper_wall: def({
    id: 'paper_wall', name: 'Muro de Papel', blurb: 'Erga uma cobertura destrutível para bloquear disparos.',
    slotType: 'basic', category: 'defense', manaCost: 30, cooldown: 20, castTime: 0.25, range: 6,
    targetType: 'point', tags: ['barrier', 'defense'], effects: [{ kind: 'barrier', count: 1, health: 90, duration: 9, width: 3.2, height: 2.2, depth: 0.2 }],
    presentation: { color: '#e3c99a', color2: '#fff5dc', icon: 'paper_wall', anim: 'cast', cue: 'shield' },
  }),
  magic_umbrella: def({
    id: 'magic_umbrella', name: 'Guarda-Chuva Mágico', blurb: 'Bloqueie disparos frontais por até três segundos, sem poder atirar.',
    slotType: 'basic', category: 'defense', manaCost: 20, cooldown: 18, castTime: 0, range: 0,
    targetType: 'self', tags: ['defense', 'frontShield', 'noFire'], effects: [{ kind: 'frontShield', duration: 3, arc: 120 }],
    presentation: { color: '#79b9ed', color2: '#d6f5ff', icon: 'magic_umbrella', anim: 'buff', cue: 'shield' },
  }),
  rain_bath: def({
    id: 'rain_bath', name: 'Banho de Chuva', blurb: 'Remova lentidão, silêncio e impedimento de corrida e resista à reaplicação.',
    slotType: 'basic', category: 'defense', manaCost: 25, cooldown: 18, castTime: 0, range: 0,
    targetType: 'self', tags: ['cleanse', 'resistance'], effects: [{ kind: 'cleanse', statuses: ['slow', 'silence', 'noSprint'], resistance: 0.65, duration: 2 }],
    presentation: { color: '#70cbd6', color2: '#e3ffff', icon: 'rain_bath', anim: 'buff', cue: 'heal' },
  }),
  footstep_echo: def({
    id: 'footstep_echo', name: 'Eco dos Passos', blurb: 'Enxergue rastros reais dos últimos oito segundos ao redor.',
    slotType: 'basic', category: 'exploration', manaCost: 20, cooldown: 15, castTime: 0.15, range: 18,
    targetType: 'self', tags: ['reveal', 'trails'], effects: [{ kind: 'reveal', mode: 'trails', radius: 18, duration: 5, history: 8 }],
    presentation: { color: '#ba96d7', color2: '#f2dfff', icon: 'footstep_echo', anim: 'cast', cue: 'orb' },
  }),
  backyard_eye: def({
    id: 'backyard_eye', name: 'Olho de Quintal', blurb: 'Descubra a direção aproximada de quem atirou ou usou magia recentemente.',
    slotType: 'basic', category: 'exploration', manaCost: 30, cooldown: 24, castTime: 0.2, range: 30,
    targetType: 'self', tags: ['reveal', 'activity'], effects: [{ kind: 'reveal', mode: 'activity', radius: 30, duration: 5, history: 8 }],
    presentation: { color: '#efc575', color2: '#fff5cd', icon: 'backyard_eye', anim: 'cast', cue: 'orb' },
  }),
  wind_foot: def({
    id: 'wind_foot', name: 'Pé de Vento', blurb: 'Corra 7% mais rápido após quatro segundos sem atirar ou sofrer dano.',
    slotType: 'basic', kind: 'passive', category: 'passive', manaCost: 0, cooldown: 0, castTime: 0, range: 0,
    targetType: 'none', tags: ['passive', 'mobility'], effects: [], passive: { type: 'outOfCombatSpeed', factor: 1.07, delay: 4 },
    presentation: { color: '#a7dfbd', color2: '#edfff3', icon: 'wind_foot', anim: 'buff', cue: 'dash' },
  }),
  quick_swap: def({
    id: 'quick_swap', name: 'Troca-Troca', blurb: 'Troque suas armas 25% mais rápido, mantendo o tempo mínimo de equipar.',
    slotType: 'basic', kind: 'passive', category: 'passive', manaCost: 0, cooldown: 0, castTime: 0, range: 0,
    targetType: 'none', tags: ['passive', 'weapon'], effects: [], passive: { type: 'weaponSwap', factor: 0.75 },
    presentation: { color: '#edb485', color2: '#fff0dd', icon: 'quick_swap', anim: 'buff', cue: 'gust' },
  }),
  backyard_scavenger: def({
    id: 'backyard_scavenger', name: 'Catador de Quinta', blurb: 'Colete itens de mais longe e aproveite 10% mais munição.',
    slotType: 'basic', kind: 'passive', category: 'passive', manaCost: 0, cooldown: 0, castTime: 0, range: 0,
    targetType: 'none', tags: ['passive', 'loot'], effects: [], passive: { type: 'scavenger', factor: 1.35, bonus: 0.1 },
    presentation: { color: '#c7b17d', color2: '#fff1c8', icon: 'backyard_scavenger', anim: 'buff', cue: 'heal' },
  }),
  soft_step: def({
    id: 'soft_step', name: 'Pé de Algodão', blurb: 'Seus passos ficam 40% mais discretos para os adversários.',
    slotType: 'basic', kind: 'passive', category: 'passive', manaCost: 0, cooldown: 0, castTime: 0, range: 0,
    targetType: 'none', tags: ['passive', 'stealth'], effects: [], passive: { type: 'quietSteps', factor: 0.6 },
    presentation: { color: '#c5c8df', color2: '#ffffff', icon: 'soft_step', anim: 'buff', cue: 'dash' },
  }),
  new_bark: def({
    id: 'new_bark', name: 'Casca Nova', blurb: 'Após oito segundos fora de combate, regenere até metade do escudo.',
    slotType: 'basic', kind: 'passive', category: 'passive', manaCost: 0, cooldown: 0, castTime: 0, range: 0,
    targetType: 'none', tags: ['passive', 'defense'], effects: [], passive: { type: 'shieldRegen', factor: 3, delay: 8, ceiling: 0.5 },
    presentation: { color: '#8cbc81', color2: '#e4f6bd', icon: 'new_bark', anim: 'buff', cue: 'shield' },
  }),
  kite_breath: def({
    id: 'kite_breath', name: 'Fôlego de Pipa', blurb: 'Ganhe 20% de controle no ar e reduza consequências de quedas compatíveis.',
    slotType: 'basic', kind: 'passive', category: 'passive', manaCost: 0, cooldown: 0, castTime: 0, range: 0,
    targetType: 'none', tags: ['passive', 'air'], effects: [], passive: { type: 'airControl', factor: 1.2, bonus: 0.8 },
    presentation: { color: '#9ac9e8', color2: '#e8f6ff', icon: 'kite_breath', anim: 'buff', cue: 'gust' },
  }),
  anti_glue: def({
    id: 'anti_glue', name: 'Anti-Cola', blurb: 'Lentidões e silenciamentos duram 25% menos em você.',
    slotType: 'basic', kind: 'passive', category: 'passive', manaCost: 0, cooldown: 0, castTime: 0, range: 0,
    targetType: 'none', tags: ['passive', 'resistance'], effects: [], passive: { type: 'debuffResistance', factor: 0.25 },
    presentation: { color: '#dbbf67', color2: '#fff6bc', icon: 'anti_glue', anim: 'buff', cue: 'heal' },
  }),
  winter_garden: def({
    id: 'winter_garden', name: 'Jardim de Inverno', blurb: 'Crie um jardim que cura você e oferece coberturas temporárias.',
    slotType: 'ultimate', manaCost: 55, cooldown: 100, castTime: 0.45, range: 12,
    targetType: 'point', tags: ['ultimate', 'area', 'heal', 'barrier'],
    effects: [
      { kind: 'area', radius: 6, delay: 0, pulses: 12, interval: 1, follow: false, edge: 1, target: 'self', effects: [{ kind: 'heal', amount: 4 }] },
      { kind: 'barrier', count: 2, health: 60, duration: 12, width: 1.5, height: 1.5, depth: 0.6 },
    ],
    presentation: { color: '#a3d0b3', color2: '#eef7e5', icon: 'winter_garden', anim: 'channel', cue: 'heal', telegraph: 'ring', mark: 'winter_branch' },
  }),
  kite_flight: def({
    id: 'kite_flight', name: 'Voo de Papagaio', blurb: 'Suba com uma pipa e plane por até sete segundos, sem atacar.',
    slotType: 'ultimate', manaCost: 45, cooldown: 90, castTime: 0.2, range: 0,
    targetType: 'self', tags: ['ultimate', 'mobility', 'flight', 'noFire'],
    effects: [{ kind: 'mobility', mode: 'flight', duration: 7, speed: 11, lift: 7, gravityFactor: 0.15, airControl: 1.5 }],
    presentation: { color: '#ef9c85', color2: '#ffe59a', icon: 'kite_flight', anim: 'channel', cue: 'gust', mark: 'paper_kite' },
  }),
  paper_city: def({
    id: 'paper_city', name: 'Cidade de Papel', blurb: 'Erga três coberturas destrutíveis para mudar o confronto.',
    slotType: 'ultimate', manaCost: 55, cooldown: 100, castTime: 0.45, range: 8,
    targetType: 'point', tags: ['ultimate', 'barrier'], effects: [{ kind: 'barrier', count: 3, health: 80, duration: 10, width: 2.5, height: 2, depth: 0.25 }],
    presentation: { color: '#e4caa1', color2: '#fff3de', icon: 'paper_city', anim: 'channel', cue: 'shield', telegraph: 'ring', mark: 'paper_city' },
  }),
  firefly_beacon: def({
    id: 'firefly_beacon', name: 'Farol dos Vaga-Lumes', blurb: 'Crie um farol destrutível que indica adversários próximos.',
    slotType: 'ultimate', manaCost: 50, cooldown: 95, castTime: 0.35, range: 8,
    targetType: 'point', tags: ['ultimate', 'reveal', 'beacon'], effects: [{ kind: 'reveal', mode: 'beacon', radius: 35, duration: 10, interval: 2, history: 0, health: 60 }],
    presentation: { color: '#d3ed6d', color2: '#fff8bb', icon: 'firefly_beacon', anim: 'channel', cue: 'orb', mark: 'firefly_lantern' },
  }),
  ink_tide: def({
    id: 'ink_tide', name: 'Maré de Tinta', blurb: 'Uma onda de tinta percorre a superfície e empurra oponentes.',
    slotType: 'ultimate', manaCost: 55, cooldown: 100, castTime: 0.45, range: 25,
    targetType: 'direction', tags: ['ultimate', 'wave', 'knockback'], effects: [{ kind: 'wave', distance: 25, width: 4, strength: 12, lift: 1, duration: 2 }],
    presentation: { color: '#9c83d1', color2: '#e8b5ee', icon: 'ink_tide', anim: 'channel', cue: 'lance', telegraph: 'lane', mark: 'ink_wave' },
  }),
  confetti_wheel: def({
    id: 'confetti_wheel', name: 'Roda de Confetes', blurb: 'Limpe efeitos negativos e ganhe velocidade e resistência por seis segundos.',
    slotType: 'ultimate', manaCost: 45, cooldown: 85, castTime: 0, range: 0,
    targetType: 'self', tags: ['ultimate', 'cleanse', 'speed'],
    effects: [{ kind: 'cleanse', statuses: ['slow', 'root', 'silence', 'noSprint'], resistance: 0.65, duration: 6 }, { kind: 'status', status: 'speed', factor: 1.15, duration: 6 }],
    presentation: { color: '#ee9fc0', color2: '#f7df7a', icon: 'confetti_wheel', anim: 'buff', cue: 'cyclone', mark: 'confetti_ring' },
  }),
  chalk_shortcut: def({
    id: 'chalk_shortcut', name: 'Atalho de Giz', blurb: 'Ligue dois pontos seguros com portais que só você pode usar.',
    slotType: 'ultimate', manaCost: 60, cooldown: 110, castTime: 0.4, range: 25,
    targetType: 'point', tags: ['ultimate', 'portal', 'mobility'], effects: [{ kind: 'portal', duration: 10, range: 25, reentry: 1.5 }],
    presentation: { color: '#9bc7d8', color2: '#ffffff', icon: 'chalk_shortcut', anim: 'channel', cue: 'orb', mark: 'chalk_gate' },
  }),
};

export const ABILITY_IDS = Object.keys(ABILITIES) as AbilityId[];
export const BASIC_ABILITIES = ABILITY_IDS.filter((id) => ABILITIES[id].slotType === 'basic');
export const ULTIMATE_ABILITIES = ABILITY_IDS.filter((id) => ABILITIES[id].slotType === 'ultimate');
export const PASSIVE_ABILITIES = BASIC_ABILITIES.filter((id) => ABILITIES[id].kind === 'passive');
export const ABILITY_CATEGORIES: readonly AbilityCategory[] = ['mobility', 'control', 'defense', 'exploration', 'passive', 'ultimate'];
export const ABILITY_CATEGORY_NAMES: Record<AbilityCategory, string> = { mobility: 'Mobilidade', control: 'Controle', defense: 'Defesa', exploration: 'Exploração', passive: 'Passivas', ultimate: 'Supremos' };

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
  maxEntities: 128,
  maxEntitiesPerCaster: 24,
  trailSampleMs: 500,
  trailHistoryMs: 8000,
  maxTrailPoints: 160,
  maxFlightHeight: 18,
  portalRadius: 1.15,
  maxKnockbackSpeed: 18,
} as const;
