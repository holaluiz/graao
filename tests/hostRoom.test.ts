/**
 * The match room running in a host's browser: the server's `GraaoMatchRoom` on the Colyseus stand-in, driven the way
 * the host worker drives it. Checks the seat lifecycle the room relies on (join, refusal, drop, reconnection, expiry,
 * consented leave), that the simulation ticks into a match, and disposal.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APPEARANCE, randomAppearance } from '@graao/game-data';
import { C2S, CLIENT_VERSION, MatchPhase, PROTOCOL_VERSION, S2C, parseRoomListing, type RoomStateMsg, type WelcomeMsg } from '@graao/shared';
import type { FromRoom } from '../apps/client/src/net/host/hostProtocol';

vi.mock('@colyseus/core', async () => await import('../apps/client/src/net/host/colyseusShim'));

const { HostRoomDriver } = await import('../apps/client/src/net/host/HostRoomDriver');

const opts = (name: string, protocol = PROTOCOL_VERSION) => ({ legacyWarmup: true, protocol, client: CLIENT_VERSION, name, appearance: name === 'A' ? DEFAULT_APPEARANCE : randomAppearance(() => 0.42) });

function host() {
  const out: FromRoom[] = [];
  const driver = new HostRoomDriver((m) => out.push(m));
  const sent = (sid: string, type: number) => out.filter((m): m is Extract<FromRoom, { t: 'send' }> => m.t === 'send' && m.to.includes(sid) && m.type === type).map((m) => m.m);
  const until = async <T>(pred: () => T | undefined | false, ms = 4000): Promise<T> => {
    const t0 = Date.now();
    for (;;) {
      const v = pred();
      if (v) return v;
      if (Date.now() - t0 > ms) throw new Error('timeout');
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  const latestState = (sid: string) => sent(sid, S2C.ROOM_STATE).at(-1) as RoomStateMsg | undefined;
  return { out, driver, sent, until, latestState };
}

let open: ReturnType<typeof host>[] = [];
afterEach(async () => {
  for (const h of open) await h.driver.handle({ t: 'close' });
  open = [];
});

describe('match room hosted in a browser worker', () => {
  it('uses the same strict lobby and host-start rules in private browser rooms', async () => {
    const h = host();
    open.push(h);
    await h.driver.handle({ t: 'create', options: { ...opts('A'), legacyWarmup: false, visibility: 'private', bots: 9 } });
    await h.driver.handle({ t: 'join', sid: 'host', options: opts('A') });
    expect(h.latestState('host')).toMatchObject({ phase: MatchPhase.LOBBY, room: { hostSessionId: 'host', botsPlanned: 9, visibility: 'private' } });
    expect(h.latestState('host')!.players).toHaveLength(1);
    await h.driver.handle({ t: 'join', sid: 'guest', options: opts('B') });
    expect(h.latestState('host')!.room!.botsPlanned).toBe(8);
    await h.driver.handle({ t: 'msg', sid: 'host', type: C2S.READY, m: { r: 1 } });
    await h.driver.handle({ t: 'msg', sid: 'guest', type: C2S.READY, m: { r: 1 } });
    expect(h.latestState('host')!.phase).toBe(MatchPhase.LOBBY);
    await h.driver.handle({ t: 'msg', sid: 'guest', type: C2S.START_MATCH, m: {} });
    expect(h.latestState('host')!.phase).toBe(MatchPhase.LOBBY);
    await h.driver.handle({ t: 'msg', sid: 'host', type: C2S.START_MATCH, m: {} });
    expect(h.latestState('host')!.phase).toBe(MatchPhase.ABILITY_DRAFT);
    expect(h.latestState('host')!.players).toHaveLength(10);
    expect(h.sent('host', S2C.SNAPSHOT)).toHaveLength(0);
    await h.driver.handle({ t: 'leave', sid: 'host', consented: true });
    expect(h.out.at(-1)).toEqual({ t: 'disposed' });
    expect(h.latestState('guest')!.phase).toBe(MatchPhase.CLOSED);
  });

  it('publishes the room’s own listing to the host page, which announces public rooms', async () => {
    const h = host();
    open.push(h);
    const listing = () => {
      const created = h.out.find((m) => m.t === 'created');
      const meta = h.out.filter((m): m is Extract<FromRoom, { t: 'metadata' }> => m.t === 'metadata').at(-1);
      return created?.t === 'created' && meta ? parseRoomListing({ ...meta.metadata, code: created.code }) : null;
    };
    await h.driver.handle({ t: 'create', options: { ...opts('A'), legacyWarmup: false, visibility: 'public', roomName: 'Sala de Sábado', bots: 9 } });
    expect(listing()).toBeNull();
    await h.driver.handle({ t: 'join', sid: 'host', options: opts('A') });
    expect(listing()).toMatchObject({ name: 'Sala de Sábado', hostName: 'A', humans: 1, botsPlanned: 9, capacity: 10, phase: MatchPhase.LOBBY, available: true });
    await h.driver.handle({ t: 'join', sid: 'guest', options: opts('B') });
    expect(listing()).toMatchObject({ humans: 2, botsPlanned: 8, available: true });
    await h.driver.handle({ t: 'msg', sid: 'host', type: C2S.READY, m: { r: 1 } });
    await h.driver.handle({ t: 'msg', sid: 'guest', type: C2S.READY, m: { r: 1 } });
    await h.driver.handle({ t: 'msg', sid: 'host', type: C2S.START_MATCH, m: {} });
    expect(listing()).toMatchObject({ phase: MatchPhase.ABILITY_DRAFT, available: false });
    await h.driver.handle({ t: 'leave', sid: 'host', consented: true });
    expect(listing()).toBeNull();
  });

  it('creates the room, seats the host and a guest, refuses a wrong version and closes', async () => {
    const h = host();
    open.push(h);
    await h.driver.handle({ t: 'create', options: { ...opts('A'), bots: 3 } });
    const created = h.out.find((m) => m.t === 'created');
    expect(created && created.t === 'created' && created.code).toMatch(/^GR-[A-Z0-9]{4}$/);

    await h.driver.handle({ t: 'join', sid: 'host', options: opts('A') });
    expect(h.out.some((m) => m.t === 'joined' && m.sid === 'host')).toBe(true);
    expect((h.sent('host', S2C.WELCOME)[0] as WelcomeMsg).index).toBe(0);
    expect(h.latestState('host')!.players.map((p) => p.bot ?? false)).toEqual([false, true, true, true]);

    await h.driver.handle({ t: 'join', sid: 'guest', options: opts('B') });
    expect((h.sent('guest', S2C.WELCOME)[0] as WelcomeMsg).index).toBe(4);
    const guest = h.latestState('host')!.players.find((p) => p.name === 'B')!;
    expect(guest.connected && !guest.bot).toBe(true);

    await h.driver.handle({ t: 'join', sid: 'old', options: opts('C', PROTOCOL_VERSION - 1) });
    const refused = h.out.find((m) => m.t === 'join-error' && m.sid === 'old');
    expect(refused && refused.t === 'join-error' && refused.error).toMatch(/VERSION_MISMATCH/);

    await h.driver.handle({ t: 'close' });
    expect(h.out.at(-1)).toEqual({ t: 'disposed' });
  });

  it('holds a dropped guest’s seat, takes them back, and lets them go when the window ends', async () => {
    const h = host();
    open.push(h);
    await h.driver.handle({ t: 'create', options: { ...opts('A'), reconnectSeconds: 0.3 } });
    await h.driver.handle({ t: 'join', sid: 'host', options: opts('A') });
    await h.driver.handle({ t: 'join', sid: 'guest', options: opts('B') });

    await h.driver.handle({ t: 'leave', sid: 'guest', consented: false });
    expect(h.latestState('host')!.players.find((p) => p.name === 'B')).toMatchObject({ dropped: true });
    const selfBefore = h.sent('guest', S2C.SELF).length;
    await h.driver.handle({ t: 'reconnect', sid: 'guest' });
    expect(h.out.some((m) => m.t === 'reconnected' && m.sid === 'guest')).toBe(true);
    expect(h.sent('guest', S2C.SELF).length).toBeGreaterThan(selfBefore);
    expect(h.latestState('host')!.players.find((p) => p.name === 'B')!.dropped).toBeUndefined();

    await h.driver.handle({ t: 'leave', sid: 'guest', consented: false });
    await h.until(() => h.out.some((m) => m.t === 'released' && m.sid === 'guest'));
    expect(h.latestState('host')!.players.map((p) => p.name)).toEqual(['A']);
    await h.driver.handle({ t: 'reconnect', sid: 'guest' });
    expect(h.out.some((m) => m.t === 'reconnect-error' && m.sid === 'guest')).toBe(true);
  });

  it('ticks into a match once everyone is ready, then disposes when the last person leaves', async () => {
    const h = host();
    open.push(h);
    await h.driver.handle({ t: 'create', options: { ...opts('A'), skipDraft: true, skipUfo: true, countdownMs: 50 } });
    await h.driver.handle({ t: 'join', sid: 'host', options: opts('A') });
    await h.driver.handle({ t: 'join', sid: 'guest', options: opts('B') });
    await h.driver.handle({ t: 'msg', sid: 'host', type: C2S.READY, m: { r: 1 } });
    await h.driver.handle({ t: 'msg', sid: 'guest', type: C2S.READY, m: { r: 1 } });
    expect(h.latestState('guest')!.phase).toBe(MatchPhase.MATCH);
    // The simulation interval runs: snapshots flow to both.
    await h.until(() => h.sent('guest', S2C.SNAPSHOT).length > 3 && h.sent('host', S2C.SNAPSHOT).length > 3);

    await h.driver.handle({ t: 'leave', sid: 'guest', consented: true });
    expect(h.latestState('host')!.phase).toBe(MatchPhase.RESULTS);
    await h.driver.handle({ t: 'leave', sid: 'host', consented: true });
    expect(h.out.at(-1)).toEqual({ t: 'disposed' });
  });
});
