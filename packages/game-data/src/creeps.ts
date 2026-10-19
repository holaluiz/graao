/**
 * Creeps: original creatures that live on the planet (Minas Gerais clay, crystal, stone and soapstone) and give
 * experience when defeated. They are not participants: a room has up to 10 players (people and bots) plus its
 * creeps, under their own population cap. Common creeps never drop weapons (chests stay the way to arm yourself);
 * in this first version they give XP only.
 *
 * Everything here is data (test values); `@graao/game-core` (creeps.ts) runs the state machine and the spawn director
 * on the server, and the client draws them. Ids stay in English; `name` is what players read (pt-BR).
 */

export type CreepTypeId = 'barrolinho' | 'besouro' | 'pedreiro' | 'guardiao';
/** Wire order (creeps travel as an index into this list). Append only. */
export const CREEP_TYPE_IDS: CreepTypeId[] = ['barrolinho', 'besouro', 'pedreiro', 'guardiao'];

export type CreepTier = 'basic' | 'agile' | 'tough' | 'elite';

export interface CreepAttackDef {
  /** Reach (m) from the creep's centre to the target's body, and the arc in front of it that the blow covers. */
  range: number;
  arcDeg: number;
  /** Telegraph (the wind-up players can read), the blow itself, then the opening after it (ms). */
  windupMs: number;
  recoverMs: number;
  /** Minimum time from one blow to the next (ms, counted from the blow). */
  cooldownMs: number;
  /** Damage of this attack (Shield first, then Health). */
  damage: number;
  /** Ground slam: hits every player within `range` around the creep (no arc), after the same wind-up. */
  area?: boolean;
}

export interface CreepTypeDef {
  id: CreepTypeId;
  name: string;
  tier: CreepTier;
  /** One-line description (dev overlay, docs). */
  hint: string;
  health: number;
  /** XP the kill is worth (split between the players who hurt it, see PROGRESSION.creepShare). */
  xp: number;
  /** Ground speeds (m/s): wandering and chasing. Players run at 5.6 m/s, so every creep can be outrun. */
  walkSpeed: number;
  runSpeed: number;
  /** Turn rate (rad/s). */
  turnRate: number;
  /** Walking radius (m): obstacle probes and the spacing between creeps. */
  radius: number;
  /** Hit capsule above the feet (m): weapons, punches and abilities test it. No head: creeps take no critical hits. */
  hitbox: { bottom: number; top: number; radius: number };
  /**
   * Neutral creeps wander until someone hurts them (or a creep of their group); aggressive ones also charge whoever
   * comes within `detectRange` (m).
   */
  aggressive: boolean;
  detectRange: number;
  /** Gives up and walks home when the chase drags it this far (m) from where it lives, or loses the target this far. */
  leashRange: number;
  loseRange: number;
  /** Attacks in order, looping (the elite alternates a swing and a slam). */
  attacks: CreepAttackDef[];
  /** Agile creeps back off after a blow (m, ms), then come in again. */
  retreat?: { distance: number; ms: number };
  /** Delay (ms) between the creep noticing a player and moving on them (the "!" moment). */
  alertMs: number;
  /** Respawn delay range (ms) after the body is gone. */
  respawnMs: [number, number];
  /** How long the body stays after death (ms): the defeat effect plays, then it is removed. */
  corpseMs: number;
  /** Look (client): overall scale and colours. The elite also glows. */
  look: { scale: number; body: string; accent: string; glow?: string };
}

export const CREEPS: Record<CreepTypeId, CreepTypeDef> = {
  barrolinho: {
    id: 'barrolinho',
    name: 'Barrolinho',
    tier: 'basic',
    hint: 'Bolinha de barro com pedrinhas: anda devagar, patrulha e só revida quando apanha.',
    health: 28,
    xp: 35,
    walkSpeed: 1.0,
    runSpeed: 3.0,
    turnRate: 5,
    radius: 0.42,
    hitbox: { bottom: 0.0, top: 0.78, radius: 0.4 },
    aggressive: false,
    detectRange: 0,
    leashRange: 16,
    loseRange: 14,
    attacks: [{ range: 1.15, arcDeg: 70, windupMs: 450, recoverMs: 500, cooldownMs: 1250, damage: 5 }],
    alertMs: 250,
    respawnMs: [20000, 30000],
    corpseMs: 1400,
    look: { scale: 1, body: '#b9774a', accent: '#8a8174' },
  },
  besouro: {
    id: 'besouro',
    name: 'Besouro de Cristal',
    tier: 'agile',
    hint: 'Pequeno e rápido, cristais nas costas: chega, belisca e recua, com pausas claras entre os ataques.',
    health: 40,
    xp: 45,
    walkSpeed: 2.0,
    runSpeed: 5.0,
    turnRate: 9,
    radius: 0.45,
    hitbox: { bottom: 0.0, top: 0.62, radius: 0.44 },
    aggressive: true,
    detectRange: 7,
    leashRange: 18,
    loseRange: 13,
    attacks: [{ range: 1.25, arcDeg: 60, windupMs: 320, recoverMs: 380, cooldownMs: 1500, damage: 7 }],
    retreat: { distance: 3.2, ms: 750 },
    alertMs: 350,
    respawnMs: [22000, 34000],
    corpseMs: 1300,
    look: { scale: 1, body: '#3d3a5c', accent: '#8fe3ff' },
  },
  pedreiro: {
    id: 'pedreiro',
    name: 'Pedreiro Encantado',
    tier: 'tough',
    hint: 'Pedras empilhadas com braços enormes: lento, aguenta muito, golpe fácil de ler e uma boa janela depois.',
    health: 75,
    xp: 75,
    walkSpeed: 0.8,
    runSpeed: 2.4,
    turnRate: 3,
    radius: 0.62,
    hitbox: { bottom: 0.0, top: 1.5, radius: 0.58 },
    aggressive: false,
    detectRange: 0,
    leashRange: 14,
    loseRange: 12,
    attacks: [{ range: 1.75, arcDeg: 80, windupMs: 850, recoverMs: 1100, cooldownMs: 1900, damage: 12 }],
    alertMs: 500,
    respawnMs: [28000, 38000],
    corpseMs: 1800,
    look: { scale: 1, body: '#8f8a7c', accent: '#5f7f4e' },
  },
  guardiao: {
    id: 'guardiao',
    name: 'Guardião da Pedra-Sabão',
    tier: 'elite',
    hint: 'Elite de pedra-sabão com runas acesas: guarda uma área especial, avisa antes de bater e alterna golpe e pisão.',
    health: 150,
    xp: 140,
    walkSpeed: 1.1,
    runSpeed: 3.5,
    turnRate: 4,
    radius: 0.7,
    hitbox: { bottom: 0.0, top: 1.8, radius: 0.62 },
    aggressive: true,
    detectRange: 9,
    leashRange: 16,
    loseRange: 14,
    attacks: [
      { range: 2.0, arcDeg: 75, windupMs: 900, recoverMs: 1000, cooldownMs: 2100, damage: 15 },
      { range: 2.7, arcDeg: 360, windupMs: 1150, recoverMs: 1300, cooldownMs: 2600, damage: 12, area: true },
    ],
    alertMs: 600,
    respawnMs: [36000, 46000],
    corpseMs: 2200,
    look: { scale: 1, body: '#6f8f86', accent: '#3d4f4a', glow: '#7dffd8' },
  },
};

/**
 * Where creeps live: areas inside the named regions. Each area is a cap (lat/lon centre, radius in degrees of arc;
 * 1° ≈ 1.75 m) whose candidate points are validated on the real collision world at match start (ground under them,
 * no water, gentle slope, open sky — never inside a house — and clear of props). `types` are weighted; `max` is the
 * area's own population cap and `maxOf` caps a type in it (one elite per special area).
 */
export interface CreepAreaDef {
  id: string;
  /** REGIONS name (HUD and docs). */
  region: string;
  lat: number;
  lon: number;
  radiusDeg: number;
  types: { v: CreepTypeId; w: number }[];
  max: number;
  maxOf?: Partial<Record<CreepTypeId, number>>;
  /** Why here (docs, dev overlay). */
  hint: string;
}

export const CREEP_AREAS: CreepAreaDef[] = [
  // Vila das Lanternas: a few common ones in the yards and the edges, never in the streets.
  { id: 'vila-quintais-norte', region: 'Vila das Lanternas', lat: 31, lon: 2, radiusDeg: 4, types: [{ v: 'barrolinho', w: 1 }], max: 1, hint: 'quintais no alto da vila' },
  { id: 'vila-borda-leste', region: 'Vila das Lanternas', lat: 11, lon: 18, radiusDeg: 3.5, types: [{ v: 'barrolinho', w: 1 }], max: 1, hint: 'borda leste, depois das últimas casas' },
  // Bairro do Horizonte: now and then, in the empty lots and open ground at its edge.
  { id: 'bairro-terrenos', region: 'Bairro do Horizonte', lat: -23, lon: -9, radiusDeg: 3.5, types: [{ v: 'barrolinho', w: 3 }, { v: 'besouro', w: 1 }], max: 1, hint: 'terrenos vazios ao sul do bairro' },
  // Lago Espelho: small groups on the shores and paths.
  { id: 'lago-margem-norte', region: 'Lago Espelho', lat: -19, lon: -40, radiusDeg: 5, types: [{ v: 'barrolinho', w: 2 }, { v: 'besouro', w: 1 }], max: 2, hint: 'margem norte e a trilha da orla' },
  { id: 'lago-margem-oeste', region: 'Lago Espelho', lat: -31, lon: -54, radiusDeg: 4.5, types: [{ v: 'barrolinho', w: 1 }, { v: 'besouro', w: 1 }], max: 2, hint: 'margem oeste' },
  // Bosque dos Varais: the densest place for basic creatures.
  { id: 'bosque-mata', region: 'Bosque dos Varais', lat: 37, lon: 56, radiusDeg: 9, types: [{ v: 'barrolinho', w: 3 }, { v: 'besouro', w: 1 }], max: 4, hint: 'mata em volta da árvore gigante' },
  { id: 'bosque-varais', region: 'Bosque dos Varais', lat: 25, lon: 72, radiusDeg: 5, types: [{ v: 'barrolinho', w: 2 }, { v: 'pedreiro', w: 1 }], max: 2, hint: 'terreiro do sítio e os varais' },
  // Fenda de Cristal: crystal beetles and a guardian.
  { id: 'fenda-cristais', region: 'Fenda de Cristal', lat: 40, lon: -103, radiusDeg: 9, types: [{ v: 'besouro', w: 3 }, { v: 'guardiao', w: 1 }], max: 3, maxOf: { guardiao: 1 }, hint: 'cristais da fenda' },
  // Planalto Norte: stone masons and an elite.
  { id: 'planalto-campos', region: 'Planalto Norte', lat: 70, lon: -22, radiusDeg: 10, types: [{ v: 'pedreiro', w: 3 }, { v: 'guardiao', w: 1 }], max: 3, maxOf: { guardiao: 1 }, hint: 'campos e mirantes do planalto' },
  { id: 'serra-passo', region: 'Serra do Mirante', lat: 58, lon: -86, radiusDeg: 4, types: [{ v: 'pedreiro', w: 1 }], max: 1, hint: 'passo entre as cristas' },
];

export const CREEP_RULES = {
  /** Active creeps on the whole planet (configurable per room; the host's performance decides). */
  maxActive: 16,
  /** Candidate points tried per area at validation, and how many valid ones each area keeps. */
  candidates: 40,
  pointsPerArea: 10,
  /** Validation: steepest ground (degrees), clear sky above (m), clearance from props (m) at mid-body height. */
  maxSlopeDeg: 32,
  skyClear: 6,
  propClear: 0.55,
  /** Spawn spacing: from other creeps and from living players (no creep appears in someone's face). */
  minCreepSpacing: 3,
  minPlayerDistance: 14,
  /** A respawn that finds no valid point tries again after this long, at most this many times. */
  retryMs: 5000,
  maxRetries: 6,
  /** Creeps think (perception, decisions) at this rate; they move every server tick. */
  thinkHz: 5,
  /** Only creeps within this distance (m) of a living player are simulated; the others stand still. */
  awakeRange: 70,
  /** Ground walking: step up (m), drop down (m), probe height (m above the feet). */
  maxStep: 0.5,
  maxDrop: 1.6,
  probeHeight: 0.45,
  /** Creeps keep out of water deeper than this (m below the sea surface). */
  maxWade: 0.15,
  /** Idle pause between patrol legs (ms) and how far a patrol leg goes (m). */
  idleMs: [1800, 4200] as [number, number],
  patrolLeg: [2.5, 7] as [number, number],
  /** When one creep is provoked, its neighbours of the same area within this distance (m) join in. */
  packRange: 7,
  /** Walking home after a chase: it heals this fraction of its health per second and ignores new provocations. */
  returnHealPerSecond: 0.35,
  /**
   * XP credit at the defeat: a helper's damage counts only if their last valid hit is this recent (ms) and they are
   * still this close (m) to the creep — no XP for a stray shot long ago or from across the planet (the range covers
   * every weapon but the Fuzil de Precisão's longest shots). The final blow always counts.
   */
  creditWindowMs: 20000,
  creditRange: 100,
  /** A chase stuck against walls this long (ms) gives up. */
  stuckMs: 2500,
  /** Tormenta: new creeps only this far (degrees) inside the region it is closing onto; outside it they dissolve. */
  tormentaMarginDeg: 2,
  tormentaGraceMs: 4000,
  /** Population cap follows the Tormenta: × (closing region radius / this many degrees), never below `minFactor`. */
  tormentaFullRadiusDeg: 90,
  minFactor: 0.25,
};
