import { describe, expect, it } from 'vitest';
import { LINK_TRANSITIONS, LinkClose, LinkStatus, canTransition, closedState, type LinkState } from './RoomLink';

const ALL = Object.keys(LINK_TRANSITIONS) as LinkState[];

describe('room link status', () => {
  it('walks a guest through signaling, ICE, a drop and the way back', () => {
    const seen: string[] = [];
    const s = new LinkStatus('', 0);
    s.on((to, from) => seen.push(`${from}→${to}`));
    expect(s.state).toBe('DISCONNECTED');
    for (const step of ['SIGNALING', 'CONNECTING', 'CONNECTED', 'RECONNECTING', 'CONNECTED', 'CLOSED'] as const) expect(s.set(step)).toBe(true);
    expect(seen).toEqual(['DISCONNECTED→SIGNALING', 'SIGNALING→CONNECTING', 'CONNECTING→CONNECTED', 'CONNECTED→RECONNECTING', 'RECONNECTING→CONNECTED', 'CONNECTED→CLOSED']);
  });

  it('ignores repeats and moves the table does not allow, so two drivers (link and session) can report the same event', () => {
    const s = new LinkStatus('', 0);
    let calls = 0;
    s.on(() => calls++);
    s.set('CONNECTED');
    expect(s.set('CONNECTED')).toBe(false);
    expect(s.set('SIGNALING')).toBe(false);
    expect(s.set('RECONNECTING', 'tentativa 1')).toBe(true);
    // A new detail in the same state is kept without a transition (the next attempt).
    expect(s.set('RECONNECTING', 'tentativa 2 · ICE')).toBe(false);
    expect(s.detail).toBe('tentativa 2 · ICE');
    expect(calls).toBe(2);
  });

  it('never leaves FAILED or CLOSED: a late reconnect cannot revive a link the room already let go', () => {
    for (const end of ['FAILED', 'CLOSED'] as const) {
      expect(LINK_TRANSITIONS[end]).toEqual([]);
      const s = new LinkStatus('', 0);
      s.set('CONNECTED');
      s.set(end, 'janela de reconexão esgotada');
      for (const to of ALL) expect(s.set(to, 'código 4001')).toBe(false);
      expect(s.state).toBe(end);
      // The session reporting the same end later does not overwrite the link's own reason.
      expect(s.detail).toBe('janela de reconexão esgotada');
    }
  });

  it('can end from every live state, and only CONNECTED and RECONNECTING turn into each other', () => {
    for (const from of ALL.filter((x) => x !== 'FAILED' && x !== 'CLOSED')) {
      expect(canTransition(from, 'FAILED')).toBe(true);
      expect(canTransition(from, 'CLOSED')).toBe(true);
    }
    const into = (to: LinkState) => ALL.filter((from) => canTransition(from, to));
    expect(into('RECONNECTING')).toEqual(['CONNECTED']);
    expect(into('CONNECTED')).toEqual(['DISCONNECTED', 'CONNECTING', 'RECONNECTING']);
  });

  it('tells a purposeful end from a failure', () => {
    expect(closedState(LinkClose.CONSENTED)).toBe('CLOSED');
    expect(closedState(LinkClose.HOST_CLOSED)).toBe('CLOSED');
    expect(closedState(1000)).toBe('CLOSED');
    expect(closedState(LinkClose.LOST)).toBe('FAILED');
    expect(closedState(LinkClose.REFUSED)).toBe('FAILED');
    expect(closedState(4003)).toBe('FAILED'); // Colyseus FAILED_TO_RECONNECT
    expect(closedState(1006, true)).toBe('CLOSED'); // a room notice said why (the host left)
  });

  it('describes itself for F3 with the time spent in the state', () => {
    const s = new LinkStatus('', 1000);
    s.set('RECONNECTING', '', 1000); // not allowed from DISCONNECTED: stays
    s.set('CONNECTED', '', 2000);
    s.set('RECONNECTING', 'tentativa 2', 5000);
    expect(s.describe(8400)).toBe('RECONNECTING · tentativa 2 · 3 s');
  });
});
