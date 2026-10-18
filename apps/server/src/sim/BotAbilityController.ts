/** Tactical intentions only. The room sends these through the same onAbility admission as a human. */
import { ABILITIES, type AbilityDefinition } from '@graao/game-data';
import { checkCast, type AbilityActor } from '@graao/game-core';
import { AbilityReject } from '@graao/shared';

export interface BotAbilitySituation {
  now: number;
  distance: number;
  hasEnemy: boolean;
  enemyVisible: boolean;
  seekingZone: boolean;
  hasResources: boolean;
  nearWall: boolean;
  recentlyHurt: boolean;
  canFight: boolean;
}

export interface BotAbilityChoice { slot: number; def: AbilityDefinition }

export function chooseBotAbility(actor: AbilityActor, situation: BotAbilitySituation, offset = 0): BotAbilityChoice | null {
  const s = situation;
  for (let i = 0; i < actor.loadout.length; i++) {
    const slot = (i + offset) % actor.loadout.length;
    const def = ABILITIES[actor.loadout[slot]!];
    if (def.kind === 'passive' || checkCast({ alive: actor.vitals.alive, canFight: s.canFight, mana: actor.vitals.mana, loadout: actor.loadout, cooldownEnds: actor.cooldownEnds, castUntil: actor.castUntil }, slot, def.id, s.now) !== AbilityReject.OK) continue;
    const profile = def.bot;
    const mobility = def.effects.find((effect) => effect.kind === 'mobility');
    if (profile.needsAir && actor.state.grounded) continue;
    if (profile.needsSurface && !s.nearWall) continue;
    if (mobility?.kind === 'mobility' && (mobility.mode === 'ricochet' || mobility.mode === 'grapple') && !s.nearWall) continue;
    let useful = false;
    switch (profile.role) {
      case 'passive': break;
      case 'mobility': useful = s.seekingZone || s.recentlyHurt || (s.hasEnemy && s.distance > 8); break;
      case 'control': useful = s.hasEnemy && s.enemyVisible; break;
      case 'defense': {
        const healing = def.effects.some((effect) => effect.kind === 'heal' || (effect.kind === 'area' && effect.target === 'self'));
        const cleansing = def.effects.some((effect) => effect.kind === 'cleanse');
        useful = healing ? actor.vitals.health < (profile.healthBelow ?? 80)
          : cleansing ? !!actor.runtime?.effects.some((effect) => effect.kind !== 'speed' && effect.endsAt > s.now)
            : s.hasEnemy && (s.recentlyHurt || actor.vitals.shield < 50);
        break;
      }
      case 'exploration': useful = def.effects.some((effect) => effect.kind === 'reveal' && effect.mode === 'resources') ? s.hasResources : s.hasEnemy; break;
      case 'ultimate': {
        const defensive = def.effects.some((effect) => effect.kind === 'cleanse' || effect.kind === 'mobility' || effect.kind === 'portal' || (effect.kind === 'area' && effect.target === 'self'));
        useful = defensive ? s.recentlyHurt || s.seekingZone || actor.vitals.health < 65 : s.hasEnemy && s.enemyVisible;
        break;
      }
    }
    if (!useful) continue;
    if (profile.role === 'control' || (profile.role === 'ultimate' && !s.seekingZone && !s.recentlyHurt)) {
      if (s.distance < profile.minRange || s.distance > profile.maxRange) continue;
    }
    return { slot, def };
  }
  return null;
}
