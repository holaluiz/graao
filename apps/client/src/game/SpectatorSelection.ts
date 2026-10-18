import type { PlayerPublic } from '@graao/shared';

export interface SpectatorRemoteState {
  index: number;
  hasSnapshot: boolean;
  alive: boolean;
}

export interface SpectatorSelectionState {
  players: readonly PlayerPublic[];
  me: number;
  eliminated: ReadonlySet<number>;
  remotes: readonly SpectatorRemoteState[];
}

/** The room owns participation; snapshots and elimination events can reject a stale room entry sooner. */
export function getSpectatorCandidates(state: SpectatorSelectionState): PlayerPublic[] {
  const remotes = new Map(state.remotes.map((remote) => [remote.index, remote]));
  return state.players.filter((player) => {
    const remote = remotes.get(player.index);
    return player.index !== state.me && player.connected && !player.dropped && player.inMatch
      && player.alive !== false && !state.eliminated.has(player.index)
      && !!remote?.hasSnapshot && remote.alive;
  }).sort((a, b) => a.index - b.index);
}

/** Stable seat order: changing kills or room-array order never switches the player being watched. */
export function selectSpectatorTarget(indices: readonly number[], current: number | null, direction: -1 | 0 | 1 = 0): number | null {
  const ordered = [...new Set(indices)].sort((a, b) => a - b);
  if (!ordered.length) return null;
  if (current === null) return direction < 0 ? ordered[ordered.length - 1]! : ordered[0]!;
  const at = ordered.indexOf(current);
  if (at >= 0) return ordered[(at + direction + ordered.length) % ordered.length]!;
  // If a target dies or leaves, keep moving through the same seat order instead of starting over.
  if (direction < 0) return ordered.findLast((index) => index < current) ?? ordered[ordered.length - 1]!;
  return ordered.find((index) => index > current) ?? ordered[0]!;
}
