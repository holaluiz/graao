/**
 * In-match RPG progression: every participant starts the match at level 1 with 0 XP, earns XP by defeating creeps,
 * and each level gained gives one attribute point to spend. Nothing carries over between matches. Test values: the
 * curve is meant to give decisions during a match, not to make everyone reach the cap, and nine points make a
 * farmer stronger without making them untouchable (see `STATS`).
 */

export const PROGRESSION = {
  startLevel: 1,
  maxLevel: 10,
  /** XP to go from `level` to `level + 1` (not the running total): 80, 104, 135, 176, 228, 297, 386, 502, 653. */
  xpBase: 80,
  xpGrowth: 1.3,
  /**
   * Creep kill credit. One player who hurt it: all of its XP. Several: the final blow takes `finalBlow` of it and the
   * rest is shared by the others in proportion to the valid damage they dealt (see game-core progression.ts).
   */
  creepShare: { finalBlow: 0.7 },
} as const;

/** XP needed to go from `level` to the next one (0 at the cap). */
export function xpRequiredForNextLevel(level: number): number {
  if (level >= PROGRESSION.maxLevel) return 0;
  return Math.round(PROGRESSION.xpBase * Math.pow(PROGRESSION.xpGrowth, Math.max(1, level) - 1));
}

export type StatId = 'ataque' | 'defesa' | 'velAtaque' | 'vitalidade' | 'energia';
/** Wire order (SELF `stats`, ALLOCATE_STAT `k`) and the order of the attribute panel (keys 1–5). Append only. */
export const STAT_IDS: StatId[] = ['ataque', 'defesa', 'velAtaque', 'vitalidade', 'energia'];

export interface StatDefinition {
  id: StatId;
  /** Panel name (pt-BR, upper case like the rest of the HUD labels). */
  name: string;
  /** What one point does (attribute panel). */
  line: string;
  /** Short tag and colour on the HUD. */
  tag: string;
  color: string;
}

/**
 * The five attributes (test values; every point is small but noticeable, and nine points is the most a match gives).
 * One table, used by the server (authority), the bots and the HUD — never duplicated:
 *
 * - Ataque: +2 % damage of weapons and punches per point (abilities keep their own numbers).
 * - Defesa: 2 % less combat damage taken per point (weapons, punches, abilities, creeps), never more than
 *   `defenseCap`. The Tormenta and drowning ignore it.
 * - Velocidade de Ataque: +3 % attack speed per point — punches come sooner and compatible weapons fire faster, each
 *   weapon up to its own limit (`WeaponDefinition.attackSpeedCap`). Ability cooldowns are untouched.
 * - Vitalidade: +7 maximum Health per point.
 * - Energia: +6 maximum Mana per point and +2 % Mana regeneration.
 *
 * A point never refills: Health and Mana keep the same fraction of the new maximum (50/100 becomes 54/107).
 */
export const STAT_RULES = {
  /** Points one attribute can take (configurable): nine points means choosing between spreading and specialising. */
  maxPerStat: 5,
  attackPerPoint: 0.02,
  defensePerPoint: 0.02,
  /** Most combat damage Defesa can take away (fraction). */
  defenseCap: 0.25,
  attackSpeedPerPoint: 0.03,
  healthPerPoint: 7,
  manaPerPoint: 6,
  manaRegenPerPoint: 0.02,
} as const;

export const STATS: Record<StatId, StatDefinition> = {
  ataque: { id: 'ataque', name: 'ATAQUE', line: '+2% de dano de armas e socos', tag: 'ATQ', color: '#ff8a5c' },
  defesa: { id: 'defesa', name: 'DEFESA', line: '-2% de dano recebido (não da Tormenta)', tag: 'DEF', color: '#8fa8c8' },
  velAtaque: { id: 'velAtaque', name: 'VEL. ATAQUE', line: '+3% de cadência de socos e armas', tag: 'VEL', color: '#ffc94a' },
  vitalidade: { id: 'vitalidade', name: 'VITALIDADE', line: '+7 de Vida máxima', tag: 'VIT', color: '#ff6b6b' },
  energia: { id: 'energia', name: 'ENERGIA', line: '+6 de Mana máxima, +2% de regeneração', tag: 'ENE', color: '#7f9cff' },
};

/**
 * How bots spend their points (they open no panel: the server spends for them, under the same rules). Each profile is
 * a priority order, repeated; an attribute at its cap is skipped. A bot keeps its profile for the whole match.
 */
export type BotStatProfile = 'agressivo' | 'defensivo' | 'magico' | 'equilibrado';
export const BOT_STAT_PROFILES: Record<BotStatProfile, { name: string; order: StatId[] }> = {
  agressivo: { name: 'Agressivo', order: ['ataque', 'velAtaque', 'ataque', 'velAtaque', 'vitalidade'] },
  defensivo: { name: 'Defensivo', order: ['defesa', 'vitalidade', 'defesa', 'vitalidade', 'ataque'] },
  magico: { name: 'Mágico/Utilitário', order: ['energia', 'vitalidade', 'energia', 'defesa', 'vitalidade'] },
  equilibrado: { name: 'Equilibrado', order: ['ataque', 'vitalidade', 'defesa', 'velAtaque', 'energia'] },
};
export const BOT_STAT_PROFILE_IDS: BotStatProfile[] = ['agressivo', 'defensivo', 'magico', 'equilibrado'];
