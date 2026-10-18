import { describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE } from '@graao/game-data';
import { DeployState, MatchPhase, type MatchSummaryMsg, type PlayerPublic } from '@graao/shared';
import { buildScoreboard, type ScoreboardState } from './Scoreboard';

function player(index: number, patch: Partial<PlayerPublic> = {}): PlayerPublic {
  return {
    index, sessionId: `p${index}`, name: `Jogador ${index}`, appearance: DEFAULT_APPEARANCE,
    ready: true, connected: true, inMatch: true, kills: 0, deaths: 0,
    loadout: [], deploy: DeployState.LANDED, wins: 0, back: false, ...patch,
  };
}

function state(players: PlayerPublic[], patch: Partial<ScoreboardState> = {}): ScoreboardState {
  return { players, phase: MatchPhase.MATCH, me: 0, eliminated: new Set(), ...patch };
}

describe('live scoreboard', () => {
  it('keeps all ten seats and counts alive participants, excluding spectators and departures', () => {
    const players = Array.from({ length: 10 }, (_, i) => player(i, { bot: i > 0 }));
    players[2]!.alive = false;
    players[3]!.inMatch = false;
    players[4]!.connected = false;
    const m = buildScoreboard(state(players, { eliminated: new Set([1]) }));
    expect(m.players).toHaveLength(10);
    expect(m.total).toBe(9);
    expect(m.alive).toBe(6);
    expect(m.eliminated).toBe(3);
    expect(m.players.find((p) => p.index === 0)?.mine).toBe(true);
    expect(m.players.find((p) => p.index === 3)?.status).toBe('Espectador');
    expect(m.players.find((p) => p.index === 4)?.status).toBe('Saiu');
  });

  it('ranks by eliminations, then damage, then deaths, and marks every tied kill leader', () => {
    const m = buildScoreboard(state([
      player(0, { kills: 2, damageDealt: 350, deaths: 1 }),
      player(1, { kills: 2, damageDealt: 500, deaths: 1 }),
      player(2, { kills: 2, damageDealt: 500, deaths: 0 }),
      player(3, { inMatch: false, kills: 99 }),
    ]));
    expect(m.players.map((p) => p.index)).toEqual([2, 1, 0, 3]);
    expect(m.leaders).toEqual(['Jogador 2', 'Jogador 1', 'Jogador 0']);
    expect(m.mostKills).toBe(2);
    expect(m.players[3]!.leader).toBe(false);
  });

  it('does not invent a kill leader before the first elimination', () => {
    expect(buildScoreboard(state([player(0), player(1)]))).toMatchObject({ mostKills: 0, leaders: [] });
  });

  it('uses the final authoritative summary and includes a participant who already left the room', () => {
    const summary: MatchSummaryMsg = {
      code: 'GR-TEST', winner: 0, startedAt: 1, endedAt: 2, durationMs: 1,
      players: [
        { index: 0, name: 'Vencedor', placement: 1, won: true, kills: 1, deaths: 0, damageDealt: 200, damageTaken: 0, shots: 2, hits: 2, abilitiesCast: 0, loadout: [], left: false },
        { index: 1, name: 'Quem saiu', placement: 2, won: false, kills: 3, deaths: 1, damageDealt: 800, damageTaken: 200, shots: 8, hits: 6, abilitiesCast: 1, loadout: [], left: true },
      ],
    };
    const m = buildScoreboard(state([player(0, { kills: 99 })], { phase: MatchPhase.RESULTS, summary }));
    expect(m.players.map((p) => [p.index, p.kills, p.damage, p.status])).toEqual([[1, 3, 800, 'Saiu'], [0, 1, 200, 'Vivo']]);
    expect(m).toMatchObject({ total: 2, alive: 1, eliminated: 1, leaders: ['Quem saiu'] });
  });
});
