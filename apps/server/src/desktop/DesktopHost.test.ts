/**
 * The server as the Graao Host runs it (HOST_MODE=DESKTOP), in-process with real Colyseus SDK clients: only the app
 * opens the room, the owner key makes the host, the room outlives the host's tab, seats never exceed ten under
 * concurrent joins, planned bots give way to people, and closing tells everyone why.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import { DEFAULT_APPEARANCE } from '@graao/game-data';
import { CLIENT_VERSION, NoticeCode, PROTOCOL_VERSION, ROOM_NAME, S2C, randomSecret, sha256Hex, type NoticeMsg, type RoomStateMsg, type ServerToApp } from '@graao/shared';
import { setAuthVerifier } from '../auth/SupabaseAuth';
import { setMatchStore } from '../persistence/MatchStore';
import { DesktopHost, HOST_CLOSED_TEXT } from './DesktopHost';

const events: ServerToApp[] = [];
const host = new DesktopHost((m) => events.push(m), { statusMs: 200 });
let url = '';

const join = (name: string, extra: Record<string, unknown> = {}) => ({ protocol: PROTOCOL_VERSION, client: CLIENT_VERSION, name, appearance: DEFAULT_APPEARANCE, ...extra });

function next<T extends ServerToApp['t']>(t: T, ms = 5000): Promise<Extract<ServerToApp, { t: T }>> {
  const start = events.length;
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      const hit = events.slice(start).find((e) => e.t === t);
      if (hit) {
        clearInterval(timer);
        clearTimeout(fail);
        resolve(hit as Extract<ServerToApp, { t: T }>);
      }
    }, 10);
    const fail = setTimeout(() => {
      clearInterval(timer);
      reject(new Error(`no ${t}`));
    }, ms);
  });
}

/** Resolves with the first ROOM_STATE from now on that satisfies `pred` (the one sent with the seat may be missed). */
function stateWhere(room: Room, pred: (m: RoomStateMsg) => boolean, ms = 5000): Promise<RoomStateMsg> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('no matching ROOM_STATE')), ms);
    const off = room.onMessage(S2C.ROOM_STATE, (m: RoomStateMsg) => {
      if (!pred(m)) return;
      clearTimeout(t);
      off();
      resolve(m);
    });
  });
}

async function lastStatus(pred: (m: Extract<ServerToApp, { t: 'status' }>) => boolean, ms = 3000) {
  const end = Date.now() + ms;
  for (;;) {
    const s = events.filter((e): e is Extract<ServerToApp, { t: 'status' }> => e.t === 'status').at(-1);
    if (s && pred(s)) return s;
    if (Date.now() > end) throw new Error(`status never matched; last: ${JSON.stringify(s?.room)}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function openRoom(code: string, ownerKey: string, bots = 0) {
  const opened = next('opened');
  await host.handle({ t: 'open', code, ownerKeyHash: await sha256Hex(ownerKey), settings: { roomName: 'Sala do Luiz', visibility: 'PUBLIC', bots, hostName: 'Luiz' } });
  return (await opened).code;
}

beforeAll(async () => {
  setAuthVerifier(null);
  setMatchStore({ name: 'none', record: async () => null });
  const port = await host.start();
  url = `ws://127.0.0.1:${port}`;
}, 30000);

afterAll(async () => {
  await host.shutdown();
});

describe('Graao Host server (HOST_MODE=DESKTOP)', () => {
  it('listens on loopback and says so in /health', async () => {
    expect(events.find((e) => e.t === 'listening')).toMatchObject({ protocol: PROTOCOL_VERSION });
    const h = (await (await fetch(`${url.replace('ws', 'http')}/health`)).json()) as { mode: string; ok: boolean };
    expect(h).toMatchObject({ ok: true, mode: 'DESKTOP' });
  });

  it('refuses rooms created from the network', async () => {
    await expect(new Client(url).create(ROOM_NAME, join('Intruso'))).rejects.toThrow(/abertas pelo aplicativo Graao Host/);
  });

  it('opens the one room with the allocated code; the owner key makes the host, even after a reload', async () => {
    const ownerKey = randomSecret();
    const code = await openRoom('GR-AB23', ownerKey, 2);
    expect(code).toBe('GR-AB23');
    // A second room is refused while one is open.
    const failed = next('open-failed');
    await host.handle({ t: 'open', code: 'GR-CD45', ownerKeyHash: await sha256Hex('x'), settings: { roomName: 'Outra', visibility: 'PUBLIC', bots: 0, hostName: 'X' } });
    expect((await failed).error).toBe('room_already_open');

    const guest = await new Client(url).joinById(code, join('Pedro', { hostKey: 'chute' }));
    // A wrong key is just a guest: no host yet, the room still shows its owner's name.
    await lastStatus((s) => s.room?.humanCount === 1);
    expect((await lastStatus((s) => s.room?.humanCount === 1)).room).toMatchObject({ hostPresent: false });

    const ownerSeen = stateWhere(guest, (m) => m.players.length === 2);
    const owner = await new Client(url).joinById(code, join('Luiz', { hostKey: ownerKey }));
    const withOwner = await ownerSeen;
    expect(withOwner.room?.hostSessionId).toBe(owner.sessionId);
    expect(withOwner.room?.hostName).toBe('Luiz');
    expect(withOwner.room?.botsPlanned).toBe(2);

    // The host's tab closes: the room stays (the app hosts it), the guest is still there.
    const afterLeave = stateWhere(guest, (m) => m.players.length === 1);
    await owner.leave();
    expect((await afterLeave).room?.hostSessionId).toBe('');
    const backSeen = stateWhere(guest, (m) => m.players.length === 2);
    const back = await new Client(url).joinById(code, join('Luiz', { hostKey: ownerKey }));
    expect((await backSeen).room?.hostSessionId).toBe(back.sessionId);

    const report = await lastStatus((s) => s.room?.humanCount === 2 && s.room.hostPresent);
    expect(report.room).toMatchObject({ code, humanCount: 2, desiredBotCount: 2, effectiveBotCount: 2, hostPresent: true, status: 'LOBBY' });
    expect(report.metrics.bytesIn).toBeGreaterThan(0);
    expect(report.metrics.bytesOut).toBeGreaterThan(0);

    // Closing tells everyone why, then the room is gone; the process can open the next one.
    const notice = new Promise<NoticeMsg>((resolve) => guest.onMessage(S2C.NOTICE, (m: NoticeMsg) => resolve(m)));
    const left = new Promise<number>((resolve) => guest.onLeave((c) => resolve(c)));
    const closed = next('closed');
    await host.handle({ t: 'close', reason: HOST_CLOSED_TEXT });
    expect(await notice).toMatchObject({ code: NoticeCode.ROOM_CLOSED, text: HOST_CLOSED_TEXT });
    await left;
    expect((await closed).code).toBe(code);
    await expect(new Client(url).joinById(code, join('Atrasado'))).rejects.toThrow();
    expect(back.connection.isOpen).toBe(false);
  });

  it('never seats more than ten under concurrent joins; planned bots give way to people', async () => {
    const code = await openRoom('GR-EF67', randomSecret(), 9);
    const attempts = await Promise.allSettled(Array.from({ length: 13 }, (_, i) => new Client(url).joinById(code, join(`P${i}`))));
    const seated = attempts.filter((a): a is PromiseFulfilledResult<Room> => a.status === 'fulfilled').map((a) => a.value);
    expect(seated.length).toBe(10);
    const full = await lastStatus((s) => s.room?.humanCount === 10);
    expect(full.room).toMatchObject({ humanCount: 10, desiredBotCount: 9, effectiveBotCount: 0, available: false });
    // Seven leave: three people, seven planned bots.
    await Promise.all(seated.slice(3).map((r) => r.leave()));
    const after = await lastStatus((s) => s.room?.humanCount === 3);
    expect(after.room).toMatchObject({ humanCount: 3, effectiveBotCount: 7, available: true });
    await host.handle({ t: 'close', reason: HOST_CLOSED_TEXT });
  });
});
