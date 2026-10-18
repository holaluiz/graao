import { describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE } from '@graao/game-data';
import { DeployState, type PlayerPublic } from '@graao/shared';
import { getSpectatorCandidates, selectSpectatorTarget, type SpectatorSelectionState } from './SpectatorSelection';

function player(index: number, patch: Partial<PlayerPublic> = {}): PlayerPublic {
  return {
    index, sessionId: `p${index}`, name: `Jogador ${index}`, appearance: DEFAULT_APPEARANCE,
    ready: true, connected: true, inMatch: true, alive: true, kills: 0, deaths: 0,
    loadout: [], weapons: ['sunbeam', ''], deploy: DeployState.LANDED, wins: 0, back: false, ...patch,
  };
}

function state(players: PlayerPublic[], patch: Partial<SpectatorSelectionState> = {}): SpectatorSelectionState {
  return { players, me: 0, eliminated: new Set(), remotes: players.map((p) => ({ index: p.index, alive: true, hasSnapshot: true })), ...patch };
}

describe('spectator survivors', () => {
  it('includes humans and bots in seat order without changing the room roster', () => {
    const players = [player(8, { bot: true }), player(0), player(2)];
    expect(getSpectatorCandidates(state(players)).map((p) => p.index)).toEqual([2, 8]);
    expect(players.map((p) => p.index)).toEqual([8, 0, 2]);
  });

  it('rejects departures, reconnecting players and players outside the frozen match roster', () => {
    const players = [player(1, { connected: false }), player(2, { dropped: true }), player(3, { inMatch: false }), player(4)];
    expect(getSpectatorCandidates(state(players)).map((p) => p.index)).toEqual([4]);
  });

  it('rejects any authoritative death source, including an event before the roster updates', () => {
    const players = [player(1, { alive: false }), player(2), player(3), player(4)];
    const model = state(players, {
      eliminated: new Set([2]),
      remotes: [1, 2, 3, 4].map((index) => ({ index, hasSnapshot: true, alive: index !== 3 })),
    });
    expect(getSpectatorCandidates(model).map((p) => p.index)).toEqual([4]);
  });

  it('waits for a placed remote snapshot, including after respawn clears its interpolation buffer', () => {
    const model = state([player(1), player(2), player(3)], {
      remotes: [{ index: 1, hasSnapshot: false, alive: true }, { index: 3, hasSnapshot: true, alive: true }],
    });
    expect(getSpectatorCandidates(model).map((p) => p.index)).toEqual([3]);
  });

  it('accepts older room states without the optional alive field when a live snapshot is available', () => {
    expect(getSpectatorCandidates(state([player(1, { alive: undefined })])).map((p) => p.index)).toEqual([1]);
  });
});

describe('spectator target selection', () => {
  it('chooses the first seat and preserves the target through reordered or duplicated candidates', () => {
    expect(selectSpectatorTarget([8, 2, 4], null)).toBe(2);
    expect(selectSpectatorTarget([8, 4, 2, 4], 4)).toBe(4);
  });

  it('cycles both ways and wraps at either end', () => {
    expect(selectSpectatorTarget([8, 2, 4], 4, 1)).toBe(8);
    expect(selectSpectatorTarget([8, 2, 4], 8, 1)).toBe(2);
    expect(selectSpectatorTarget([8, 2, 4], 2, -1)).toBe(8);
    expect(selectSpectatorTarget([8, 2, 4], 8, -1)).toBe(4);
  });

  it('continues in seat order when the watched player dies or leaves', () => {
    expect(selectSpectatorTarget([2, 8], 4)).toBe(8);
    expect(selectSpectatorTarget([2, 8], 4, 1)).toBe(8);
    expect(selectSpectatorTarget([2, 8], 4, -1)).toBe(2);
    expect(selectSpectatorTarget([2, 4], 8)).toBe(2);
  });

  it('handles no survivors and a single survivor without inventing a target', () => {
    expect(selectSpectatorTarget([], 4)).toBeNull();
    expect(selectSpectatorTarget([], null, -1)).toBeNull();
    expect(selectSpectatorTarget([8], 8, 1)).toBe(8);
    expect(selectSpectatorTarget([8], null, -1)).toBe(8);
  });
});
