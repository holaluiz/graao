import { describe, expect, it } from 'vitest';
import { MatchLedger } from '@graao/game-core';
import { parseHistory, recordMatchPayload } from './index';

describe('database shapes', () => {
  it('maps a match summary to the record_match payload with the server-validated identities', () => {
    const l = new MatchLedger(
      [
        { index: 0, name: 'Ana', loadout: ['sun_orb'] },
        { index: 1, name: 'Beto com um nome comprido demais', loadout: [] },
      ],
      Date.UTC(2026, 9, 17, 20, 0, 0),
    );
    l.damage(0, 1, 33.3);
    l.elimination(0, 1, Date.UTC(2026, 9, 17, 20, 2, 0));
    const s = l.finish('GR-7K2M', 0, Date.UTC(2026, 9, 17, 20, 2, 0));
    const who = new Map([[0, { profileId: '6f1c1a8e-0000-4000-8000-000000000000', appearance: { bodyId: 'body.a' } }]]);
    const p = recordMatchPayload(s, who, { protocol: 6, serverVersion: '0.6.0' });
    expect(p).toMatchObject({ room_code: 'GR-7K2M', started_at: '2026-10-17T20:00:00.000Z', ended_at: '2026-10-17T20:02:00.000Z', duration_ms: 120000, winner_index: 0, protocol: 6 });
    expect(p.players[0]).toMatchObject({ player_index: 0, profile_id: '6f1c1a8e-0000-4000-8000-000000000000', won: true, kills: 1, damage_dealt: 33, loadout: ['sun_orb'], appearance: { bodyId: 'body.a' } });
    // A guest has no identity; names fit the column.
    expect(p.players[1]).toMatchObject({ profile_id: null, appearance: null, placement: 2, deaths: 1 });
    expect(p.players[1]!.display_name.length).toBeLessThanOrEqual(20);
  });

  it('parses my_matches defensively', () => {
    const h = parseHistory([
      {
        id: 'a',
        room_code: 'GR-AAAA',
        ended_at: '2026-10-17T20:02:00+00:00',
        duration_ms: 120000,
        winner_index: 1,
        my_index: 0,
        players: [{ player_index: 1, display_name: 'Beto', placement: 1, won: true, kills: 1, loadout: ['x', 3] }, null],
      },
      { id: 'b', ended_at: 'not a date' },
      'junk',
    ]);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ id: 'a', code: 'GR-AAAA', winner: 1, myIndex: 0, durationMs: 120000 });
    expect(h[0]!.players).toEqual([{ index: 1, name: 'Beto', placement: 1, won: true, kills: 1, deaths: 0, damageDealt: 0, damageTaken: 0, shots: 0, hits: 0, abilitiesCast: 0, loadout: ['x'] }]);
    expect(parseHistory(null)).toEqual([]);
  });
});
