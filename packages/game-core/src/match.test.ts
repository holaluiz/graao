import { describe, expect, it } from 'vitest';
import { MatchLedger, decideMatch, everyoneReady } from './match';

const p = (index: number, alive = true, connected = true, inMatch = true) => ({ index, alive, connected, inMatch });

describe('match rules', () => {
  it('starts only when enough connected players are all ready', () => {
    expect(everyoneReady([{ connected: true, ready: true }])).toBe(false);
    expect(everyoneReady([{ connected: true, ready: true }, { connected: true, ready: false }])).toBe(false);
    expect(everyoneReady([{ connected: true, ready: true }, { connected: true, ready: true }])).toBe(true);
    // A disconnected player does not block the others but does not count either.
    expect(everyoneReady([{ connected: true, ready: true }, { connected: true, ready: true }, { connected: false, ready: false }])).toBe(true);
  });

  it('keeps going while two participants stand', () => {
    expect(decideMatch([p(0), p(1)])).toEqual({ over: false, winner: -1 });
    expect(decideMatch([p(0), p(1), p(2, false)])).toEqual({ over: false, winner: -1 });
  });

  it('declares the last participant standing the winner', () => {
    expect(decideMatch([p(0), p(1, false)])).toEqual({ over: true, winner: 0 });
    expect(decideMatch([p(0, false), p(1), p(2, false)])).toEqual({ over: true, winner: 1 });
  });

  it('ignores spectators and disconnected players', () => {
    // A late joiner (not in the match) cannot keep a finished match alive.
    expect(decideMatch([p(0), p(1, false), p(2, true, true, false)])).toEqual({ over: true, winner: 0 });
    // The opponent leaving hands the win to whoever is still there.
    expect(decideMatch([p(0), p(1, true, false)])).toEqual({ over: true, winner: 0 });
  });

  it('is a draw when nobody is left standing', () => {
    expect(decideMatch([p(0, false), p(1, false)])).toEqual({ over: true, winner: -1 });
  });
});

describe('match ledger (server-authoritative summary)', () => {
  const entrants = [
    { index: 0, name: 'Ana', loadout: ['sun_orb', 'gust_dash', 'pollen_burst', 'solar_meteor'] },
    { index: 1, name: 'Beto', loadout: ['a', 'b', 'c', 'd'] },
  ];

  it('counts shots, hits, damage, casts and the elimination; the winner is placed first', () => {
    const l = new MatchLedger(entrants, 1000);
    l.shot(0, true);
    l.shot(0, false);
    l.shot(1, false);
    l.damage(0, 1, 40.4);
    l.damage(0, 1, 59.8);
    l.damage(1, 1, 5); // self-damage: taken, never dealt
    l.cast(1);
    l.cast(5); // not a participant: ignored
    l.elimination(0, 1, 61000);
    const s = l.finish('GR-TEST', 0, 62000);
    expect(s).toMatchObject({ code: 'GR-TEST', winner: 0, startedAt: 1000, endedAt: 62000, durationMs: 61000 });
    expect(s.players.map((p) => [p.index, p.placement, p.won])).toEqual([
      [0, 1, true],
      [1, 2, false],
    ]);
    expect(s.players[0]).toMatchObject({ name: 'Ana', kills: 1, deaths: 0, damageDealt: 100, damageTaken: 0, shots: 2, hits: 1, abilitiesCast: 0, left: false });
    expect(s.players[1]).toMatchObject({ name: 'Beto', kills: 0, deaths: 1, damageDealt: 0, damageTaken: 105, shots: 1, hits: 0, abilitiesCast: 1 });
    expect(s.players[0]!.loadout).toEqual(entrants[0]!.loadout);
  });

  it('ranks by how long players lasted, ties share a placement, leavers count as out when they left', () => {
    const l = new MatchLedger([...entrants, { index: 2, name: 'Caio', loadout: [] }, { index: 3, name: 'Duda', loadout: [] }], 0);
    l.left(3, 5000);
    l.elimination(0, 1, 9000);
    l.elimination(0, 2, 9000);
    const s = l.finish('GR-TEST', 0, 9000);
    expect(Object.fromEntries(s.players.map((p) => [p.name, p.placement]))).toEqual({ Ana: 1, Beto: 2, Caio: 2, Duda: 4 });
    expect(s.players.find((p) => p.name === 'Duda')!.left).toBe(true);
    // An elimination only counts once.
    l.elimination(0, 1, 9500);
    expect(l.finish('GR-TEST', 0, 9500).players.find((p) => p.name === 'Ana')!.kills).toBe(2);
  });

  it('a draw places nobody above someone who went down at the same time', () => {
    const l = new MatchLedger(entrants, 0);
    l.elimination(1, 0, 4000);
    l.elimination(0, 1, 4000);
    const s = l.finish('GR-TEST', -1, 4000);
    expect(s.players.map((p) => [p.placement, p.won])).toEqual([
      [1, false],
      [1, false],
    ]);
  });
});
