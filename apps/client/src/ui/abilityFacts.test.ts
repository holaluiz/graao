/**
 * The Draft may only say what the catalog's effects really do: every displayed fact points at an effect the
 * authoritative system runs, every number on screen comes from that effect, and every effect is shown.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ABILITIES, ABILITY_IDS, type AbilityDefinition, type AbilityEffect } from '@graao/game-data';
import { TAG_LABELS, abilityFacts, abilityHeadline, abilityStats, abilityTagLabels } from './abilityFacts';
import { abilityDiagram } from './abilityDiagram';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const ABILITY_SYSTEM = source('../../../../packages/game-core/src/abilitySystem.ts');
const PASSIVES = source('../../../../packages/game-core/src/passives.ts');
const CHARACTER = source('../../../../packages/game-core/src/character.ts');
const ROOM = source('../../../server/src/rooms/GraaoMatchRoom.ts');
/** The authoritative effect runner: `AbilitySystem.run` and the persistent-entity update. */
const RUN = ABILITY_SYSTEM.slice(ABILITY_SYSTEM.indexOf('private run('));

type Node = { effect: AbilityEffect; path: string; area?: Extract<AbilityEffect, { kind: 'area' }> };

/** Every effect in a definition with its path, as the fact generator names them. */
function nodes(effects: readonly AbilityEffect[], base = 'effects', area?: Node['area']): Node[] {
  return effects.flatMap((effect, i) => {
    const path = `${base}[${i}]`;
    const nested = effect.kind === 'projectile' ? nodes(effect.onHit, `${path}.onHit`)
      : effect.kind === 'area' ? nodes(effect.effects, `${path}.effects`, effect)
        : effect.kind === 'trap' ? nodes(effect.effects, `${path}.effects`) : [];
    return [{ effect, path, area }, ...nested];
  });
}

const FRACTIONS = new Set(['factor', 'gravityFactor', 'airControl', 'resistance', 'edge', 'ceiling', 'bonus']);

/** Numbers a sentence about this effect may contain: its fields, their percentages, and the products shown. */
function allowedNumbers(fields: object, area?: Node['area']): number[] {
  const out: number[] = [];
  const entries = Object.entries(fields).filter((e): e is [string, number] => typeof e[1] === 'number');
  for (const [key, v] of entries) {
    out.push(v);
    if (FRACTIONS.has(key)) out.push(v * 100, (1 - v) * 100, (v - 1) * 100);
  }
  const f = fields as Partial<Record<string, number>> & { kind?: string };
  if (f.kind === 'projectile') out.push(f.speed! * f.lifetime!);
  if (f.kind === 'area') out.push((f.pulses! - 1) * f.interval!, f.pulses! * f.interval!);
  if (f.kind === 'portal') out.push(2); // a portal is always a pair of ends
  if (area) for (const [, v] of entries) out.push(v * area.pulses, v * area.edge);
  return out;
}

const numbersIn = (text: string) => [...text.matchAll(/\d+(?:,\d+)?/g)].map((m) => Number(m[0].replace(',', '.')));
const WORDS: Record<string, number> = { dois: 2, duas: 2, três: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10 };
const wordsIn = (text: string) => text.toLowerCase().split(/[^a-zà-ú]+/).flatMap((w) => (w in WORDS ? [WORDS[w]!] : []));
const known = (n: number, allowed: number[]) => allowed.some((a) => Math.abs(Math.round(a * 100) / 100 - n) < 0.006);

function wholeAbility(def: AbilityDefinition): number[] {
  return [
    def.manaCost, def.cooldown, def.range, def.castTime,
    ...nodes(def.effects).flatMap((n) => allowedNumbers(n.effect, n.area)),
    ...(def.passive ? allowedNumbers(def.passive) : []),
  ];
}

/** Where each effect kind / mode is carried out by the authoritative simulation. */
function implemented(e: AbilityEffect): boolean {
  if (!RUN.includes(`case '${e.kind}'`)) return false;
  if (e.kind === 'reveal') return RUN.includes(`e.mode === '${e.mode}'`);
  if (e.kind === 'mobility') return RUN.includes(`e.mode === '${e.mode}'`) || CHARACTER.includes(`mode === '${e.mode}'`);
  return true;
}

describe('ability text generated from the canonical catalog', () => {
  it('only shows facts about effects the authoritative system runs', () => {
    for (const id of ABILITY_IDS) {
      const def = ABILITIES[id];
      const all = nodes(def.effects);
      for (const fact of abilityFacts(def)) {
        if (fact.kind === 'passive') {
          expect(def.kind, `${id}: passive fact on an active ability`).toBe('passive');
          expect(PASSIVES.includes(`case '${def.passive!.type}'`), `${id}: passive ${def.passive!.type} not implemented`).toBe(true);
          continue;
        }
        const node = all.find((n) => n.path === fact.path);
        expect(node, `${id}: "${fact.text}" points at ${fact.path}, which is not an effect`).toBeDefined();
        expect(node!.effect.kind, `${id}: "${fact.text}"`).toBe(fact.kind);
        expect(implemented(node!.effect), `${id}: "${fact.text}" describes ${fact.kind} that the simulation does not run`).toBe(true);
      }
    }
  });

  it('shows every effect of every ability (nothing the simulation does is left out)', () => {
    for (const id of ABILITY_IDS) {
      const def = ABILITIES[id];
      const facts = abilityFacts(def);
      expect(facts.length, id).toBeGreaterThan(0);
      for (const node of nodes(def.effects)) expect(facts.some((f) => f.path === node.path), `${id}: ${node.path} (${node.effect.kind}) has no text`).toBe(true);
      if (def.kind === 'passive') expect(facts.every((f) => f.kind === 'passive'), id).toBe(true);
    }
  });

  it('takes every number in a fact from the effect it describes', () => {
    for (const id of ABILITY_IDS) {
      const def = ABILITIES[id];
      const all = nodes(def.effects);
      for (const fact of abilityFacts(def)) {
        const node = all.find((n) => n.path === fact.path);
        const allowed = fact.kind === 'passive' ? allowedNumbers(def.passive!) : allowedNumbers(node!.effect, node!.area);
        for (const text of [fact.text, fact.short]) for (const n of numbersIn(text)) expect(known(n, allowed), `${id}: ${n} in "${text}"`).toBe(true);
      }
    }
  });

  it('builds the stat block, the card line and the diagram labels from the definition', () => {
    for (const id of ABILITY_IDS) {
      const def = ABILITIES[id];
      const allowed = wholeAbility(def);
      const stats = Object.fromEntries(abilityStats(def).map((s) => [s.key, s.value]));
      if (def.kind === 'passive') expect(stats.mana).toBe('Sem custo');
      else {
        expect(stats.mana).toBe(String(def.manaCost));
        expect(numbersIn(stats.cooldown!)).toEqual([def.cooldown]);
        expect(numbersIn(stats.cast!)).toEqual(def.castTime > 0 ? [def.castTime] : []);
      }
      if (def.targetType === 'point' || def.targetType === 'direction') expect(numbersIn(stats.range!)).toEqual([def.range]);
      const labels = [...abilityDiagram(def).svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]!);
      for (const text of [...Object.values(stats), abilityHeadline(def), ...labels]) {
        for (const n of numbersIn(text)) expect(known(n, allowed), `${id}: ${n} in "${text}"`).toBe(true);
      }
    }
  });

  it('keeps the hand-written descriptions in step with the numbers of the effects', () => {
    for (const id of ABILITY_IDS) {
      const def = ABILITIES[id];
      const allowed = wholeAbility(def);
      for (const n of [...numbersIn(def.blurb), ...wordsIn(def.blurb)]) expect(known(n, allowed), `${id}: ${n} in "${def.blurb}"`).toBe(true);
    }
  });

  it('does not promise fields the simulation ignores', () => {
    // A target reveal tracks the first hit wherever it goes: its radius bounds nothing.
    expect(abilityFacts(ABILITIES.sun_orb).map((f) => f.text).join(' ')).not.toMatch(/raio/i);
    // Fôlego de Pipa's fall modifier has no consumer (there is no fall damage to reduce).
    expect([ABILITY_SYSTEM, CHARACTER, ROOM].some((code) => code.includes('fallDamage'))).toBe(false);
    expect([...abilityFacts(ABILITIES.kite_breath).map((f) => f.text), ABILITIES.kite_breath.blurb].join(' ')).not.toMatch(/queda/i);
  });

  it('labels every catalog tag and shows a tag only when an effect backs it', () => {
    const has = (def: AbilityDefinition, test: (e: AbilityEffect) => boolean) => nodes(def.effects).some((n) => test(n.effect));
    const status = (s: string) => (e: AbilityEffect) => (e.kind === 'status' && e.status === s) || (s === 'slow' && e.kind === 'slow');
    const backed: Record<string, (def: AbilityDefinition) => boolean> = {
      projectile: (d) => has(d, (e) => e.kind === 'projectile'),
      reveal: (d) => has(d, (e) => e.kind === 'reveal'),
      dash: (d) => has(d, (e) => e.kind === 'dash'),
      mobility: (d) => has(d, (e) => e.kind === 'dash' || e.kind === 'mobility' || e.kind === 'portal') || d.passive?.type === 'outOfCombatSpeed',
      area: (d) => has(d, (e) => e.kind === 'area'),
      slow: (d) => has(d, status('slow')),
      defensive: (d) => has(d, (e) => ['temporaryShield', 'shield', 'heal', 'barrier', 'frontShield', 'knockback', 'cleanse'].includes(e.kind)),
      defense: (d) => has(d, (e) => ['temporaryShield', 'shield', 'heal', 'barrier', 'frontShield', 'cleanse'].includes(e.kind)) || d.passive?.type === 'shieldRegen',
      shield: (d) => has(d, (e) => e.kind === 'temporaryShield' || e.kind === 'shield'),
      trap: (d) => has(d, (e) => e.kind === 'trap'),
      root: (d) => has(d, status('root')),
      knockback: (d) => has(d, (e) => e.kind === 'knockback' || e.kind === 'wave'),
      heal: (d) => has(d, (e) => e.kind === 'heal'),
      damage: (d) => has(d, (e) => e.kind === 'damage'),
      wave: (d) => has(d, (e) => e.kind === 'wave'),
      weapon: (d) => d.passive?.type === 'weaponHandling' || d.passive?.type === 'weaponSwap',
      resources: (d) => has(d, (e) => e.kind === 'reveal' && e.mode === 'resources'),
      air: (d) => has(d, (e) => e.kind === 'mobility' && e.mode === 'jump') || d.passive?.type === 'airControl',
      grapple: (d) => has(d, (e) => e.kind === 'mobility' && e.mode === 'grapple'),
      slide: (d) => has(d, (e) => e.kind === 'mobility' && e.mode === 'slide'),
      glide: (d) => has(d, (e) => e.kind === 'mobility' && e.mode === 'glide'),
      wall: (d) => has(d, (e) => e.kind === 'mobility' && e.mode === 'ricochet'),
      cloud: (d) => has(d, (e) => e.kind === 'cloud'),
      vision: (d) => has(d, (e) => e.kind === 'cloud'),
      noSprint: (d) => has(d, status('noSprint')),
      silence: (d) => has(d, status('silence')),
      barrier: (d) => has(d, (e) => e.kind === 'barrier'),
      frontShield: (d) => has(d, (e) => e.kind === 'frontShield'),
      // Firing is refused during flight and behind a front shield (AbilitySystem.attackLocked).
      noFire: (d) => has(d, (e) => e.kind === 'frontShield' || (e.kind === 'mobility' && e.mode === 'flight')) && ABILITY_SYSTEM.includes("abilityMovement?.mode === 'flight' || now < (actor.frontShieldUntil"),
      cleanse: (d) => has(d, (e) => e.kind === 'cleanse'),
      resistance: (d) => has(d, (e) => e.kind === 'cleanse') || d.passive?.type === 'debuffResistance',
      trails: (d) => has(d, (e) => e.kind === 'reveal' && e.mode === 'trails'),
      activity: (d) => has(d, (e) => e.kind === 'reveal' && e.mode === 'activity'),
      loot: (d) => d.passive?.type === 'scavenger',
      stealth: (d) => d.passive?.type === 'quietSteps',
      flight: (d) => has(d, (e) => e.kind === 'mobility' && e.mode === 'flight'),
      beacon: (d) => has(d, (e) => e.kind === 'reveal' && e.mode === 'beacon'),
      speed: (d) => has(d, status('speed')),
      portal: (d) => has(d, (e) => e.kind === 'portal'),
      ultimate: (d) => d.slotType === 'ultimate',
      passive: (d) => d.kind === 'passive',
    };
    for (const id of ABILITY_IDS) {
      const def = ABILITIES[id];
      for (const tag of def.tags) {
        expect(TAG_LABELS[tag], `${id}: tag ${tag} has no label`).toBeDefined();
        expect(backed[tag], `${id}: tag ${tag} has no backing rule`).toBeDefined();
        expect(backed[tag]!(def), `${id}: tag ${tag} is shown without an effect behind it`).toBe(true);
      }
      expect(abilityTagLabels(def).length).toBeGreaterThan(0);
    }
  });
});
