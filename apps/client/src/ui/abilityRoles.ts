/**
 * Tactical roles and synergy suggestions for the Draft. Roles are read from the effects in the canonical catalog;
 * synergies are only advice shown on screen — nothing here reaches the simulation, so no pairing changes a number.
 */
import { ABILITIES, type AbilityDefinition, type AbilityEffect, type AbilityId } from '@graao/game-data';

export type TacticalRole = 'push' | 'areaControl' | 'reveal' | 'precision' | 'mobility' | 'closeRange' | 'cover' | 'longRange';

export const ROLE_ORDER: readonly TacticalRole[] = ['push', 'areaControl', 'reveal', 'precision', 'mobility', 'closeRange', 'cover', 'longRange'];

export const ROLE_INFO: Record<TacticalRole, { label: string; hint: string }> = {
  push: { label: 'Empurrão', hint: 'desloca adversários' },
  areaControl: { label: 'Controle de área', hint: 'prende, atrasa ou cega quem entra numa região' },
  reveal: { label: 'Revelação', hint: 'mostra onde estão os adversários' },
  precision: { label: 'Precisão', hint: 'recompensa a mira' },
  mobility: { label: 'Mobilidade', hint: 'muda sua posição rápido' },
  closeRange: { label: 'Curta distância', hint: 'age até 8 m de você' },
  cover: { label: 'Cobertura', hint: 'bloqueia disparos ou a visão' },
  longRange: { label: 'Longa distância', hint: 'age a 20 m ou mais' },
};

export interface Synergy { a: TacticalRole; b: TacticalRole; text: string }

export const SYNERGIES: readonly Synergy[] = [
  { a: 'push', b: 'areaControl', text: 'Empurre adversários para dentro da área controlada ou impeça a fuga dela.' },
  { a: 'reveal', b: 'precision', text: 'Saiba onde o adversário está antes de mirar.' },
  { a: 'mobility', b: 'closeRange', text: 'Chegue perto rápido para usar o efeito de curta distância.' },
  { a: 'cover', b: 'longRange', text: 'Proteja-se atrás da cobertura e aja de longe.' },
];

const CLOSE_RANGE_M = 8;
const LONG_RANGE_M = 20;
const LONG_REVEAL_M = 30;

/** Effects that act on someone other than the caster. */
const hitsOthers = (effects: readonly AbilityEffect[]): boolean => effects.some((e) => {
  switch (e.kind) {
    case 'damage': case 'slow': case 'knockback': case 'trap': case 'wave': return true;
    case 'status': return e.status !== 'speed';
    case 'projectile': return hitsOthers(e.onHit);
    case 'area': return e.target !== 'self' && hitsOthers(e.effects);
    default: return false;
  }
});

const flat = (effects: readonly AbilityEffect[]): AbilityEffect[] => effects.flatMap((e) => [
  e, ...flat(e.kind === 'projectile' ? e.onHit : e.kind === 'area' || e.kind === 'trap' ? e.effects : []),
]);

/** The roles an ability really plays, derived from its effects (passives from their modifier type). */
export function abilityRoles(def: AbilityDefinition): TacticalRole[] {
  const roles = new Set<TacticalRole>();
  const all = flat(def.effects);
  if (all.some((e) => e.kind === 'knockback' || e.kind === 'wave')) roles.add('push');
  const controlling = def.effects.some((e) => e.kind === 'cloud' || e.kind === 'trap'
    || (e.kind === 'area' && e.target !== 'self' && e.effects.some((n) => n.kind === 'slow' || (n.kind === 'status' && n.status !== 'speed'))));
  if (controlling) roles.add('areaControl');
  if (all.some((e) => e.kind === 'reveal' && e.mode !== 'resources')) roles.add('reveal');
  if (all.some((e) => e.kind === 'projectile') || def.passive?.type === 'weaponHandling') roles.add('precision');
  if (all.some((e) => e.kind === 'dash' || e.kind === 'mobility' || e.kind === 'portal' || (e.kind === 'status' && e.status === 'speed'))
    || def.passive?.type === 'outOfCombatSpeed' || def.passive?.type === 'airControl') roles.add('mobility');
  const aroundMe = def.effects.some((e) => e.kind === 'area' && (e.follow || def.targetType === 'self') && e.target !== 'self' && e.radius <= CLOSE_RANGE_M && hitsOthers(e.effects));
  const shortReach = (def.targetType === 'point' || def.targetType === 'direction') && def.range <= CLOSE_RANGE_M && hitsOthers(def.effects);
  if (aroundMe || shortReach) roles.add('closeRange');
  if (all.some((e) => e.kind === 'barrier' || e.kind === 'frontShield' || e.kind === 'cloud')) roles.add('cover');
  if (def.range >= LONG_RANGE_M || all.some((e) => e.kind === 'reveal' && e.radius >= LONG_REVEAL_M)) roles.add('longRange');
  return ROLE_ORDER.filter((r) => roles.has(r));
}

/** Pairs this ability can take part in, with the role it brings and the role it asks for. */
export function synergyHints(id: AbilityId): { synergy: Synergy; has: TacticalRole; wants: TacticalRole }[] {
  const roles = abilityRoles(ABILITIES[id]);
  return SYNERGIES.flatMap((synergy) => [
    ...(roles.includes(synergy.a) ? [{ synergy, has: synergy.a, wants: synergy.b }] : []),
    ...(roles.includes(synergy.b) ? [{ synergy, has: synergy.b, wants: synergy.a }] : []),
  ]);
}

export interface SynergyMatch { synergy: Synergy; partner: AbilityId; partnerRole: TacticalRole; candidateRole: TacticalRole }

/** Which abilities already in a build would pair with `candidate`. Never the candidate with itself. */
export function synergyMatches(candidate: AbilityId, build: readonly AbilityId[]): SynergyMatch[] {
  const out: SynergyMatch[] = [];
  for (const { synergy, has, wants } of synergyHints(candidate)) {
    for (const partner of build) {
      if (partner === candidate || !abilityRoles(ABILITIES[partner]).includes(wants)) continue;
      if (!out.some((m) => m.synergy === synergy && m.partner === partner)) out.push({ synergy, partner, partnerRole: wants, candidateRole: has });
    }
  }
  return out;
}
