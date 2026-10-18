import { describe, expect, it } from 'vitest';
import { buildHostLink, compareVersions, isEndpointUrl, parseHostLink, parsePublicRoom, publicRoomToListing, sanitizeHostSettings } from './hosting';
import { MatchPhase } from './protocol';
import { PROTOCOL_VERSION } from './version';

const T = '3a44719c-d4a8-4fb6-b1cd-4a78d889fce7';
const S = 'M6gvY4rATVNFKFJmkRoAJO8l1sYCxabqknUs0qFDTB0';

describe('graao-host:// links', () => {
  it('round-trips a hosting request and accepts only well-formed ones', () => {
    expect(parseHostLink(buildHostLink({ action: 'host', ticket: T, secret: S }))).toEqual({ action: 'host', ticket: T, secret: S });
    expect(parseHostLink('graao-host://open')).toEqual({ action: 'open' });
    expect(parseHostLink('graao-host://host/?t=' + T + '&s=' + S)).toMatchObject({ action: 'host' });
    for (const bad of [
      `https://host?t=${T}&s=${S}`,
      `graao-host://host?t=nope&s=${S}`,
      `graao-host://host?t=${T}&s=short`,
      `graao-host://host?t=${T}&s=${S}&server=wss://evil.example`.replace(S, 'a b'),
      `graao-host://admin?t=${T}&s=${S}`,
      'x'.repeat(600),
      42,
    ]) {
      expect(parseHostLink(bad)).toBeNull();
    }
  });
});

describe('public Graao Host rooms', () => {
  const row = { room_id: 'r', room_code: 'GR-AB23', name: 'Sala do Luiz', host_id: 'h', host_player_id: 'p', host_display_name: 'Luiz', human_count: 3, desired_bot_count: 7, effective_bot_count: 7, visibility: 'PUBLIC', status: 'LOBBY', available: true, endpoint_id: 'e', protocol: PROTOCOL_VERSION, created_at: '2026-10-18T16:00:00Z', last_heartbeat_at: '2026-10-18T16:00:05Z' };

  it('parses central rows and refuses impossible counts', () => {
    expect(parsePublicRoom(row)).toMatchObject({ roomCode: 'GR-AB23', humanCount: 3, effectiveBotCount: 7, maxParticipants: 10, available: true });
    expect(parsePublicRoom({ ...row, human_count: 4 })).toBeNull();
    expect(parsePublicRoom({ ...row, status: 'CLOSED' })).toBeNull();
    expect(parsePublicRoom({ ...row, room_code: 'XX-1234' })).toBeNull();
    expect(parsePublicRoom({ ...row, protocol: PROTOCOL_VERSION + 1 })?.available).toBe(false);
    expect(parsePublicRoom({ ...row, status: 'MATCH' })?.available).toBe(false);
  });

  it('becomes an ordinary room browser line', () => {
    expect(publicRoomToListing(parsePublicRoom(row)!)).toMatchObject({ code: 'GR-AB23', humans: 3, botsPlanned: 7, capacity: 10, phase: MatchPhase.LOBBY, via: 'graao-host' });
  });
});

describe('helpers', () => {
  it('sanitizes room settings', () => {
    expect(sanitizeHostSettings({ roomName: '  Sala\u0000 ', visibility: 'private', bots: 42, hostName: 'Ana' })).toEqual({ roomName: 'Sala', visibility: 'PRIVATE', bots: 9, hostName: 'Ana' });
    expect(sanitizeHostSettings({}).roomName).toBe('Sala de Host');
  });

  it('accepts only secure public endpoints (loopback ws only when allowed)', () => {
    expect(isEndpointUrl('wss://h-abc.play.graao.com')).toBe(true);
    expect(isEndpointUrl('ws://127.0.0.1:4000')).toBe(false);
    expect(isEndpointUrl('ws://127.0.0.1:4000', true)).toBe(true);
    expect(isEndpointUrl('wss://evil.example/path')).toBe(false);
  });

  it('compares versions', () => {
    expect(compareVersions('0.1.10', '0.1.9')).toBe(1);
    expect(compareVersions('0.1.0', '0.1')).toBe(0);
    expect(compareVersions('0.0.9', '0.1.0')).toBe(-1);
  });
});
