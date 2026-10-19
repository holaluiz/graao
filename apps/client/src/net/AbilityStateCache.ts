/** Reliable ability state survives asset loading and reconnect without replaying old cast/impact effects. */
import { ABILITY_RULES } from '@graao/game-data';
import type { AbilityEntityView, AbilityRevealMsg, AbilityStateMsg, GameEvent } from '@graao/shared';

export class AbilityStateCache {
  private entities = new Map<number, AbilityEntityView>();
  private reveals = new Map<string, AbilityRevealMsg>();

  setState(state: AbilityStateMsg): void {
    this.entities.clear();
    for (const entity of state.entities.slice(-ABILITY_RULES.maxEntities)) this.entities.set(entity.id, entity);
  }

  onEvents(events: readonly GameEvent[]): void {
    for (const event of events) {
      if (event.e === 'abilityEntity') {
        this.entities.set(event.entity.id, event.entity);
        while (this.entities.size > ABILITY_RULES.maxEntities) this.entities.delete(this.entities.keys().next().value!);
      } else if (event.e === 'abilityEntityEnd') this.entities.delete(event.id);
    }
  }

  onReveal(message: AbilityRevealMsg): void {
    this.reveals.set(`${message.a}:${message.kind}`, message);
    while (this.reveals.size > 8) this.reveals.delete(this.reveals.keys().next().value!);
  }

  state(now: number): AbilityStateMsg {
    for (const [id, entity] of this.entities) if (entity.endsAt <= now) this.entities.delete(id);
    return { entities: [...this.entities.values()] };
  }

  privateReveals(now: number): AbilityRevealMsg[] {
    for (const [id, reveal] of this.reveals) if (reveal.endsAt <= now) this.reveals.delete(id);
    return [...this.reveals.values()];
  }
}
