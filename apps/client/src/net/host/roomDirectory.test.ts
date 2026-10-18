/** Room browser lines from untrusted announcements: only plausible, public, open-or-running rooms are shown. */
import { describe, expect, it } from 'vitest';
import { MatchPhase, PROTOCOL_VERSION, parseRoomListing } from '@graao/shared';
import { roomsFromPresence } from './roomDirectory';

const room = (over: Record<string, unknown> = {}) => ({
  code: 'GR-7K2M', name: 'Sala do Luiz', visibility: 'public', hostSessionId: 'host', hostName: 'Luiz',
  humans: 1, botsDesired: 9, botsPlanned: 9, capacity: 10, protocol: PROTOCOL_VERSION, phase: MatchPhase.LOBBY,
  available: true, canStart: false, startReason: 'Aguardando Luiz confirmar.', ...over,
});

describe('room listings', () => {
  it('keeps a real lobby and its seat counts', () => {
    expect(parseRoomListing(room())).toMatchObject({ code: 'GR-7K2M', humans: 1, botsPlanned: 9, capacity: 10, available: true });
    expect(parseRoomListing(room({ humans: 2, botsPlanned: 8 }))).toMatchObject({ humans: 2, botsPlanned: 8, available: true });
    expect(parseRoomListing(room({ humans: 10, botsPlanned: 0, botsDesired: 0 }))).toMatchObject({ available: false });
  });

  it('never accepts more participants than seats, private or closed rooms, or malformed codes', () => {
    expect(parseRoomListing(room({ humans: 2, botsPlanned: 9 }))).toBeNull();
    expect(parseRoomListing(room({ capacity: 12 }))).toBeNull();
    expect(parseRoomListing(room({ visibility: 'private' }))).toBeNull();
    expect(parseRoomListing(room({ phase: MatchPhase.CLOSED }))).toBeNull();
    expect(parseRoomListing(room({ code: 'GR-0000' }))).toBeNull();
    expect(parseRoomListing(room({ humans: 0 }))).toBeNull();
    expect(parseRoomListing(room({ humans: 1.5 }))).toBeNull();
    expect(parseRoomListing('GR-7K2M')).toBeNull();
  });

  it('shows started rooms and other versions, but never offers them', () => {
    expect(parseRoomListing(room({ phase: MatchPhase.MATCH }))).toMatchObject({ phase: MatchPhase.MATCH, available: false });
    expect(parseRoomListing(room({ protocol: PROTOCOL_VERSION + 1 }))).toMatchObject({ available: false });
  });

  it('cleans display text', () => {
    const parsed = parseRoomListing(room({ name: `  Sala\u0007   ${'x'.repeat(80)}`, hostName: '<b>Luiz</b>', startReason: 7 }))!;
    expect(parsed.name.startsWith('Sala x')).toBe(true);
    expect(parsed.name.length).toBeLessThanOrEqual(56);
    expect(parsed.hostName).toBe('bLuizb');
    expect(parsed.startReason).toBe('');
  });

  it('turns presence into one line per room, newest announcement first, open rooms on top', () => {
    const rooms = roomsFromPresence({
      a: [{ ...room({ humans: 1, botsPlanned: 9 }), at: 1 }, { ...room({ humans: 2, botsPlanned: 8 }), at: 5 }],
      b: [{ ...room({ code: 'GR-ABCD', phase: MatchPhase.MATCH }), at: 9 }],
      c: [{ ...room({ code: 'GR-WXYZ' }), at: 3 }],
      d: [{ nonsense: true }],
    });
    expect(rooms.map((r) => r.code)).toEqual(['GR-7K2M', 'GR-WXYZ', 'GR-ABCD']);
    expect(rooms[0]).toMatchObject({ humans: 2, botsPlanned: 8 });
  });
});
