/**
 * In-match progression (server-authoritative, mirrored by the client for the HUD): XP, levels, attribute points and
 * what the points do. Pure functions over plain data; the room owns one Progression per participant and resets it
 * at every match start.
 */
import { ATTRIBUTES, BOT_STAT_PROFILES, MELEE, PROGRESSION, STAT_IDS, STAT_RULES, xpRequiredForNextLevel, type BotStatProfile, type StatId } from '@graao/game-data';

export interface Progression {
  level: number;
  /** XP into the current level (not the running total). */
  xp: number;
  /** Attribute points not spent yet. */
  points: number;
  /** Points spent per attribute, STAT_IDS order. */
  stats: number[];
}

export const newProgression = (): Progression => ({ level: PROGRESSION.startLevel, xp: 0, points: 0, stats: STAT_IDS.map(() => 0) });

/**
 * Adds XP and processes every level it reaches (one kill can give several): each level gained gives one point. At the
 * cap no more XP is kept and no more points are given. Returns how many levels were gained.
 */
export function addXp(p: Progression, amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0 || p.level >= PROGRESSION.maxLevel) return 0;
  p.xp += Math.floor(amount);
  let gained = 0;
  for (let need = xpRequiredForNextLevel(p.level); need > 0 && p.xp >= need; need = xpRequiredForNextLevel(p.level)) {
    p.xp -= need;
    p.level++;
    p.points++;
    gained++;
  }
  if (p.level >= PROGRESSION.maxLevel) p.xp = 0;
  return gained;
}

/**
 * Spends one point on attribute `k` (STAT_IDS index). False when there is no point, no such attribute, or the
 * attribute is already at its cap (STAT_RULES.maxPerStat): nothing changes then.
 */
export function allocateStat(p: Progression, k: number): boolean {
  if (p.points <= 0 || !Number.isInteger(k) || k < 0 || k >= STAT_IDS.length) return false;
  if ((p.stats[k] ?? 0) >= STAT_RULES.maxPerStat) return false;
  p.points--;
  p.stats[k] = (p.stats[k] ?? 0) + 1;
  return true;
}

/** The attribute a bot of `profile` spends its next point on (STAT_IDS index), or -1 when every one is capped. */
export function botStatChoice(p: Pick<Progression, 'stats'>, profile: BotStatProfile): number {
  const order = BOT_STAT_PROFILES[profile].order;
  const spent = p.stats.reduce((a, b) => a + b, 0);
  for (let i = 0; i < order.length * 2; i++) {
    const k = STAT_IDS.indexOf(order[(spent + i) % order.length]!);
    if ((p.stats[k] ?? 0) < STAT_RULES.maxPerStat) return k;
  }
  return p.stats.findIndex((n) => n < STAT_RULES.maxPerStat);
}

/** `[level, xp into the level, xp the next level needs (0 at the cap), unspent points]` (SELF `prog`). */
export const progressionTuple = (p: Progression): [number, number, number, number] => [p.level, p.xp, xpRequiredForNextLevel(p.level), p.points];

export const statPoints = (p: Pick<Progression, 'stats'>, id: StatId): number => p.stats[STAT_IDS.indexOf(id)] ?? 0;

export interface StatModifiers {
  maxHealth: number;
  maxMana: number;
  /** Mana regeneration multiplier. */
  manaRegen: number;
  /** Damage multiplier of weapons and punches (Ataque). */
  damage: number;
  /** Multiplier on combat damage taken (Defesa): 1 = all of it. */
  defense: number;
  /** Attack speed multiplier (Velocidade de Ataque): punches and compatible weapons. */
  attackSpeed: number;
  /** Time between punches (ms). */
  meleeIntervalMs: number;
}

/** What the spent points add up to — the one formula the server, the bots and the HUD all use. */
export function statModifiers(p: Pick<Progression, 'stats'>): StatModifiers {
  const r = STAT_RULES;
  const pts = (id: StatId) => Math.max(0, Math.min(r.maxPerStat, statPoints(p, id)));
  const attackSpeed = 1 + pts('velAtaque') * r.attackSpeedPerPoint;
  return {
    maxHealth: ATTRIBUTES.maxHealth + pts('vitalidade') * r.healthPerPoint,
    maxMana: ATTRIBUTES.maxMana + pts('energia') * r.manaPerPoint,
    manaRegen: 1 + pts('energia') * r.manaRegenPerPoint,
    damage: 1 + pts('ataque') * r.attackPerPoint,
    defense: 1 - Math.min(r.defenseCap, pts('defesa') * r.defensePerPoint),
    attackSpeed,
    meleeIntervalMs: Math.round(MELEE.intervalMs / attackSpeed),
  };
}

/** Minimum time between two shots (ms) of a weapon firing `fireRate` per second, sped up by Velocidade de Ataque up to the weapon's own cap. */
export function weaponShotInterval(w: { fireRate: number; attackSpeedCap?: number }, attackSpeed = 1): number {
  return 1000 / (w.fireRate * Math.max(1, Math.min(attackSpeed, w.attackSpeedCap ?? Infinity)));
}

/** Combat damage after the target's Defesa (the Tormenta and drowning never go through this). */
export const defendedDamage = (amount: number, mods: Pick<StatModifiers, 'defense'>): number => amount * mods.defense;

/**
 * Hits are whole numbers, and +2 % of a 9-damage punch would vanish in the rounding: damage changed by attributes is
 * rounded with the remainder carried to the next hit (`holder.damageCarry`), so on average every point gives exactly
 * what the panel says.
 */
export function roundWithCarry(amount: number, holder: { damageCarry: number }): number {
  const total = amount + holder.damageCarry;
  const whole = Math.max(0, Math.round(total));
  holder.damageCarry = Math.max(-0.5, Math.min(0.5, total - whole));
  return whole;
}

/**
 * New Health and Mana after the maxima change (a point of Vitalidade or Energia): the same fraction of the new
 * maximum, never a refill. Health stays a whole number; Mana is fractional on the server.
 */
export function rescaleVitals(v: { health: number; mana: number; alive: boolean }, prev: { maxHealth: number; maxMana: number }, next: { maxHealth: number; maxMana: number }): void {
  if (!v.alive) return;
  if (next.maxHealth !== prev.maxHealth && prev.maxHealth > 0) v.health = Math.min(next.maxHealth, Math.max(1, Math.round((v.health * next.maxHealth) / prev.maxHealth)));
  if (next.maxMana !== prev.maxMana && prev.maxMana > 0) v.mana = Math.min(next.maxMana, (v.mana * next.maxMana) / prev.maxMana);
  v.health = Math.min(v.health, next.maxHealth);
  v.mana = Math.min(v.mana, next.maxMana);
}

/**
 * Who gets a defeated creep's XP (`base`), from the valid damage each player dealt it and who landed the final blow.
 *
 * - One contributor: all of it.
 * - Several: the final blow takes PROGRESSION.creepShare.finalBlow (70 %) and the others share the rest in
 *   proportion to their damage. The final blow's own damage is already paid by its 70 %: it never takes part in the
 *   30 % too. Rounding leftovers go to the final blow, so the total given is exactly `base`.
 * - The final blow not eligible (it fell in the same instant, left): the whole XP is shared by damage among the
 *   eligible contributors. Nobody eligible: nobody gets anything.
 */
export function splitCreepXp(base: number, damage: ReadonlyMap<number, number>, finalBlow: number, eligible: (index: number) => boolean = () => true): Map<number, number> {
  const out = new Map<number, number>();
  const total = Math.max(0, Math.floor(base));
  if (total <= 0) return out;
  const valid = [...damage].filter(([i, d]) => d > 0 && eligible(i));
  const killerOk = finalBlow >= 0 && eligible(finalBlow);
  const others = valid.filter(([i]) => i !== finalBlow);
  if (killerOk && !others.length) {
    out.set(finalBlow, total);
    return out;
  }
  const pool = killerOk ? total - Math.round(total * PROGRESSION.creepShare.finalBlow) : total;
  const sum = others.reduce((s, [, d]) => s + d, 0);
  if (!others.length || sum <= 0) return out;
  let given = 0;
  for (const [i, d] of others) {
    const share = Math.floor((pool * d) / sum);
    if (share > 0) out.set(i, share);
    given += share;
  }
  const rest = total - given;
  if (killerOk) out.set(finalBlow, (out.get(finalBlow) ?? 0) + (total - pool) + (pool - given));
  else if (rest > 0) {
    // Leftover from rounding: the biggest contributor.
    const top = others.reduce((a, b) => (b[1] > a[1] ? b : a));
    out.set(top[0], (out.get(top[0]) ?? 0) + (pool - given));
  }
  return out;
}
