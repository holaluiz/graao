import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ABILITIES, ABILITY_IDS, type AbilityDefinition, type AbilityEffect, type AbilityId } from '@graao/game-data';
import { SYNERGIES, abilityRoles, synergyHints, synergyMatches, type TacticalRole } from './abilityRoles';

const flat = (effects: readonly AbilityEffect[]): AbilityEffect[] => effects.flatMap((e) => [
  e, ...flat(e.kind === 'projectile' ? e.onHit : e.kind === 'area' || e.kind === 'trap' ? e.effects : []),
]);
const has = (def: AbilityDefinition, test: (e: AbilityEffect) => boolean) => flat(def.effects).some(test);

/** Independent reading of each role: what effect in the catalog makes the claim true. */
const BACKED: Record<TacticalRole, (def: AbilityDefinition) => boolean> = {
  push: (d) => has(d, (e) => e.kind === 'knockback' || e.kind === 'wave'),
  areaControl: (d) => has(d, (e) => e.kind === 'cloud' || e.kind === 'trap' || (e.kind === 'area' && e.effects.some((n) => n.kind === 'slow' || (n.kind === 'status' && n.status !== 'speed')))),
  reveal: (d) => has(d, (e) => e.kind === 'reveal' && e.mode !== 'resources'),
  precision: (d) => has(d, (e) => e.kind === 'projectile') || d.passive?.type === 'weaponHandling',
  mobility: (d) => has(d, (e) => e.kind === 'dash' || e.kind === 'mobility' || e.kind === 'portal' || (e.kind === 'status' && e.status === 'speed'))
    || d.passive?.type === 'outOfCombatSpeed' || d.passive?.type === 'airControl',
  closeRange: (d) => d.range <= 8 || has(d, (e) => e.kind === 'area' && e.radius <= 8),
  cover: (d) => has(d, (e) => e.kind === 'barrier' || e.kind === 'frontShield' || e.kind === 'cloud'),
  longRange: (d) => d.range >= 20 || has(d, (e) => e.kind === 'reveal' && e.radius >= 30),
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' || name === 'dist' ? [] : sources(path);
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

describe('tactical roles and synergy suggestions', () => {
  it('gives an ability a role only when one of its effects plays it', () => {
    for (const id of ABILITY_IDS) for (const role of abilityRoles(ABILITIES[id])) expect(BACKED[role](ABILITIES[id]), `${id}: ${role}`).toBe(true);
  });

  it('offers the four pairings of the plan, each with abilities on both sides', () => {
    const pairs = SYNERGIES.map((s) => `${s.a}+${s.b}`);
    expect(pairs).toEqual(['push+areaControl', 'reveal+precision', 'mobility+closeRange', 'cover+longRange']);
    for (const { a, b } of SYNERGIES) {
      const left = ABILITY_IDS.filter((id) => abilityRoles(ABILITIES[id]).includes(a));
      const right = ABILITY_IDS.filter((id) => abilityRoles(ABILITIES[id]).includes(b));
      expect(left.length, a).toBeGreaterThan(0);
      expect(right.length, b).toBeGreaterThan(0);
      expect(left.some((x) => right.some((y) => x !== y)), `${a}+${b}`).toBe(true);
    }
  });

  it('matches a candidate only with other abilities that bring the missing half', () => {
    const builds: AbilityId[][] = [['sun_orb'], ['gust_ring', 'wind_step'], ['paper_wall', 'steady_hand', 'slide'], ABILITY_IDS.slice(0, 4)];
    for (const build of builds) {
      for (const candidate of ABILITY_IDS) {
        for (const m of synergyMatches(candidate, build)) {
          expect(m.partner).not.toBe(candidate);
          expect(build).toContain(m.partner);
          expect(abilityRoles(ABILITIES[m.partner])).toContain(m.partnerRole);
          expect(abilityRoles(ABILITIES[candidate])).toContain(m.candidateRole);
          expect([[m.synergy.a, m.synergy.b], [m.synergy.b, m.synergy.a]]).toContainEqual([m.candidateRole, m.partnerRole]);
        }
      }
    }
    expect(synergyMatches('vine_lasso', ['sun_orb']).map((m) => m.partner)).toEqual(['sun_orb']);
    expect(synergyMatches('sun_orb', ['sun_orb'])).toEqual([]);
    expect(synergyHints('leaf_shell')).toEqual([]);
  });

  it('is advice only: reading suggestions changes no definition and no simulation code knows about them', () => {
    const before = JSON.stringify(ABILITIES);
    for (const id of ABILITY_IDS) { synergyHints(id); synergyMatches(id, ABILITY_IDS); }
    expect(JSON.stringify(ABILITIES)).toBe(before);
    const root = fileURLToPath(new URL('../../../../', import.meta.url));
    const simulation = ['packages/game-core/src', 'packages/game-data/src', 'packages/shared/src', 'apps/server/src'].flatMap((dir) => sources(join(root, dir)));
    expect(simulation.length).toBeGreaterThan(20);
    for (const file of simulation) expect(readFileSync(file, 'utf8'), file).not.toMatch(/abilityRoles|synerg|sinergia/i);
  });
});
