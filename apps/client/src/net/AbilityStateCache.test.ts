import { describe, expect, it } from 'vitest';
import type { AbilityEntityView } from '@graao/shared';
import { AbilityStateCache } from './AbilityStateCache';

const entity = (id: number): AbilityEntityView => ({ id, a: 'paper_wall', by: 0, kind: 'barrier', at: [0, 0, 101000], size: [300, 220, 20], endsAt: 10000 });
describe('ability state while the client is loading', () => {
  it('applies reliable creation/removal deltas after the initial snapshot before activation', () => {
    const cache = new AbilityStateCache();
    cache.setState({ entities: [entity(1)] });
    cache.onEvents([{ e: 'abilityEntity', entity: entity(2) }, { e: 'abilityEntityEnd', id: 1 }]);
    expect(cache.state(5000).entities.map((e) => e.id)).toEqual([2]);
    cache.onEvents([{ e: 'abilityEntity', entity: { ...entity(2), health: 40 } }]);
    expect(cache.state(5000).entities[0]!.health).toBe(40);
    expect(cache.state(10001).entities).toEqual([]);
  });
  it('retains authorized one-shot reconnaissance only until its expiry and replaces reconnect snapshots', () => {
    const cache = new AbilityStateCache();
    cache.onReveal({ kind: 'loot', a: 'firefly_scout', by: 0, endsAt: 7000, targets: [{ id: 8, at: [1, 2, 3] }] });
    expect(cache.privateReveals(5000)).toHaveLength(1);
    expect(cache.privateReveals(7000)).toHaveLength(0);
    cache.setState({ entities: [entity(1)] });
    cache.setState({ entities: [entity(3)] });
    expect(cache.state(5000).entities.map((e) => e.id)).toEqual([3]);
  });
});
