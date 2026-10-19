import { describe, expect, it } from 'vitest';
import { ATTRIBUTES, BOT_STAT_PROFILE_IDS, MELEE, PROGRESSION, STAT_IDS, STAT_RULES, WEAPONS, xpRequiredForNextLevel } from '@graao/game-data';
import { addXp, allocateStat, botStatChoice, defendedDamage, newProgression, progressionTuple, rescaleVitals, splitCreepXp, statModifiers, weaponShotInterval } from './progression';

describe('in-match progression', () => {
  it('starts at level 1 with nothing, and the curve grows level by level', () => {
    const p = newProgression();
    expect(p).toMatchObject({ level: 1, xp: 0, points: 0 });
    expect(p.stats).toEqual(STAT_IDS.map(() => 0));
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map(xpRequiredForNextLevel)).toEqual([80, 104, 135, 176, 228, 297, 386, 502, 653]);
    expect(xpRequiredForNextLevel(PROGRESSION.maxLevel)).toBe(0);
    expect(progressionTuple(p)).toEqual([1, 0, 80, 0]);
  });

  it('processes every level one big gain reaches and gives a point for each', () => {
    const p = newProgression();
    expect(addXp(p, 35)).toBe(0);
    expect(p).toMatchObject({ level: 1, xp: 35, points: 0 });
    // 45 more: 80 → level 2 with nothing left over.
    expect(addXp(p, 45)).toBe(1);
    expect(p).toMatchObject({ level: 2, xp: 0, points: 1 });
    // 104 + 135 + 10 at once: two levels, 10 into level 4.
    expect(addXp(p, 249)).toBe(2);
    expect(p).toMatchObject({ level: 4, xp: 10, points: 3 });
  });

  it('stops at the cap: nine points at most, no XP kept beyond it', () => {
    const p = newProgression();
    expect(addXp(p, 1e6)).toBe(9);
    expect(p).toMatchObject({ level: 10, xp: 0, points: 9 });
    expect(addXp(p, 500)).toBe(0);
    expect(p).toMatchObject({ level: 10, xp: 0, points: 9 });
    expect(progressionTuple(p)).toEqual([10, 0, 0, 9]);
    expect(addXp(newProgression(), -5)).toBe(0);
    expect(addXp(newProgression(), Number.NaN)).toBe(0);
  });

  it('spends points one at a time, only on real attributes, never above the cap', () => {
    const p = newProgression();
    expect(STAT_IDS).toEqual(['ataque', 'defesa', 'velAtaque', 'vitalidade', 'energia']);
    expect(allocateStat(p, 0)).toBe(false);
    addXp(p, 80 + 104);
    expect(p.points).toBe(2);
    expect(allocateStat(p, 9)).toBe(false);
    expect(allocateStat(p, -1)).toBe(false);
    expect(allocateStat(p, 0.5)).toBe(false);
    expect(allocateStat(p, 0)).toBe(true);
    expect(allocateStat(p, 1)).toBe(true);
    expect(allocateStat(p, 1)).toBe(false);
    expect(p.stats).toEqual([1, 1, 0, 0, 0]);
    expect(p.points).toBe(0);
    // Nine points at the level cap: five is the most one attribute takes.
    const q = newProgression();
    addXp(q, 1e6);
    for (let i = 0; i < STAT_RULES.maxPerStat; i++) expect(allocateStat(q, 2)).toBe(true);
    expect(allocateStat(q, 2)).toBe(false);
    expect(q.stats[2]).toBe(STAT_RULES.maxPerStat);
    expect(q.points).toBe(9 - STAT_RULES.maxPerStat);
  });

  it('turns points into the documented effects', () => {
    const base = statModifiers(newProgression());
    expect(base).toEqual({ maxHealth: ATTRIBUTES.maxHealth, maxMana: ATTRIBUTES.maxMana, manaRegen: 1, damage: 1, defense: 1, attackSpeed: 1, meleeIntervalMs: MELEE.intervalMs });
    const atk = statModifiers({ stats: [5, 0, 0, 0, 0] });
    expect(atk.damage).toBeCloseTo(1.1);
    const def = statModifiers({ stats: [0, 3, 0, 0, 0] });
    expect(def.defense).toBeCloseTo(0.94);
    expect(defendedDamage(50, def)).toBeCloseTo(47);
    const spd = statModifiers({ stats: [0, 0, 5, 0, 0] });
    expect(spd.attackSpeed).toBeCloseTo(1.15);
    expect(spd.meleeIntervalMs).toBe(Math.round(MELEE.intervalMs / 1.15));
    const vit = statModifiers({ stats: [0, 0, 0, 4, 0] });
    expect(vit.maxHealth).toBe(ATTRIBUTES.maxHealth + 28);
    const ene = statModifiers({ stats: [0, 0, 0, 0, 5] });
    expect(ene.maxMana).toBe(ATTRIBUTES.maxMana + 30);
    expect(ene.manaRegen).toBeCloseTo(1.1);
    // A forged stat array above the cap counts as the cap.
    expect(statModifiers({ stats: [50, 50, 50, 50, 50] })).toEqual(statModifiers({ stats: [5, 5, 5, 5, 5] }));
  });

  it('speeds weapons up only as far as each weapon allows', () => {
    const fast = statModifiers({ stats: [0, 0, 5, 0, 0] }).attackSpeed;
    expect(weaponShotInterval(WEAPONS.smg, 1)).toBeCloseTo(1000 / WEAPONS.smg.fireRate);
    expect(weaponShotInterval(WEAPONS.smg, fast)).toBeCloseTo(1000 / (WEAPONS.smg.fireRate * 1.15));
    expect(weaponShotInterval(WEAPONS.sniper, fast)).toBeCloseTo(1000 / WEAPONS.sniper.fireRate);
    expect(weaponShotInterval(WEAPONS.petal, fast)).toBeCloseTo(1000 / (WEAPONS.petal.fireRate * (WEAPONS.petal.attackSpeedCap ?? 1)));
  });

  it('keeps the same fraction of Health and Mana when the maxima grow (never a refill)', () => {
    const v = { health: 50, mana: 20, alive: true };
    rescaleVitals(v, { maxHealth: 100, maxMana: 100 }, { maxHealth: 107, maxMana: 106 });
    expect(v.health).toBe(54);
    expect(v.mana).toBeCloseTo(21.2);
    const full = { health: 100, mana: 100, alive: true };
    rescaleVitals(full, { maxHealth: 100, maxMana: 100 }, { maxHealth: 107, maxMana: 100 });
    expect(full).toMatchObject({ health: 107, mana: 100 });
  });

  it('gives every bot profile a full nine-point plan that respects the cap', () => {
    for (const profile of BOT_STAT_PROFILE_IDS) {
      const p = newProgression();
      addXp(p, 1e6);
      while (p.points > 0) expect(allocateStat(p, botStatChoice(p, profile))).toBe(true);
      expect(p.stats.reduce((a, b) => a + b, 0)).toBe(9);
      expect(Math.max(...p.stats)).toBeLessThanOrEqual(STAT_RULES.maxPerStat);
    }
    const agg = newProgression();
    addXp(agg, 80 + 104);
    allocateStat(agg, botStatChoice(agg, 'agressivo'));
    allocateStat(agg, botStatChoice(agg, 'agressivo'));
    expect(agg.stats).toEqual([1, 0, 1, 0, 0]);
  });
});

describe('creep XP credit', () => {
  const total = (m: Map<number, number>) => [...m.values()].reduce((a, b) => a + b, 0);

  it('gives everything to a lone contributor', () => {
    const m = splitCreepXp(35, new Map([[2, 28]]), 2);
    expect([...m]).toEqual([[2, 35]]);
  });

  it('gives the final blow 70 % and shares the rest by damage among the others', () => {
    const m = splitCreepXp(100, new Map([[0, 10], [1, 60], [2, 30]]), 0);
    // Player 0 landed the last punch: 70. The other 30 by damage 60:30 → 20 and 10.
    expect(m.get(0)).toBe(70);
    expect(m.get(1)).toBe(20);
    expect(m.get(2)).toBe(10);
    expect(total(m)).toBe(100);
  });

  it('never gives the final blow a slice of the 30 % too, and keeps the total exact with rounding', () => {
    const m = splitCreepXp(45, new Map([[3, 20], [4, 13], [5, 7]]), 3);
    expect(total(m)).toBe(45);
    // 45 × 0.7 → 31 for the final blow, 14 shared 13:7 → 9 and 4, the leftover 1 goes to the final blow.
    expect(m.get(4)).toBe(9);
    expect(m.get(5)).toBe(4);
    expect(m.get(3)).toBe(32);
  });

  it('shares everything by damage when the final blow cannot receive it, and ignores the ineligible', () => {
    const m = splitCreepXp(75, new Map([[0, 50], [1, 25], [2, 10]]), 0, (i) => i !== 0 && i !== 2);
    expect([...m]).toEqual([[1, 75]]);
    expect(splitCreepXp(75, new Map([[0, 50]]), 0, () => false).size).toBe(0);
    expect(splitCreepXp(0, new Map([[0, 50]]), 0).size).toBe(0);
  });
});
