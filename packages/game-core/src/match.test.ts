import { describe, expect, it } from 'vitest';
import { decideMatch, everyoneReady } from './match';

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
