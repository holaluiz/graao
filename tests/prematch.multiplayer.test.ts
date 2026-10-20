/** Competitive prematch journey through real HTTP discovery and Colyseus clients. */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import { DEFAULT_APPEARANCE } from '@graao/game-data';
import { C2S, CLIENT_VERSION, MatchPhase, NoticeCode, PROTOCOL_VERSION, ROOM_NAME, S2C, type DraftStateMsg, type EventsMsg, type NoticeMsg, type RoomListing, type RoomStateMsg, type SnapshotMsg } from '@graao/shared';
import { createGraaoServer } from '../apps/server/src/app';
import { getNav, getWorld } from '../apps/server/src/world';
import { setAuthVerifier } from '../apps/server/src/auth/SupabaseAuth';
import { setMatchStore } from '../apps/server/src/persistence/MatchStore';

const port = 3050 + Math.floor(Math.random() * 150);
const url = `ws://127.0.0.1:${port}`;
const server = createGraaoServer();
const open: Room[] = [];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const opts = (name: string) => ({ protocol: PROTOCOL_VERSION, client: CLIENT_VERSION, name, appearance: { ...DEFAULT_APPEARANCE } });
const until = async <T>(read: () => T | false | undefined, timeout = 5000): Promise<T> => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = read();
    if (value) return value;
    await sleep(10);
  }
  throw new Error('prematch condition timed out');
};

function watch(room: Room) {
  let state: RoomStateMsg | undefined;
  let draft: DraftStateMsg | undefined;
  const snapshots: SnapshotMsg[] = [];
  const events: EventsMsg[] = [];
  const notices: NoticeMsg[] = [];
  room.onMessage(S2C.ROOM_STATE, (m: RoomStateMsg) => { state = m; });
  room.onMessage(S2C.DRAFT_STATE, (m: DraftStateMsg) => { draft = m; });
  room.onMessage(S2C.SNAPSHOT, (m: SnapshotMsg) => snapshots.push(m));
  room.onMessage(S2C.EVENTS, (m: EventsMsg) => events.push(m));
  room.onMessage(S2C.NOTICE, (m: NoticeMsg) => notices.push(m));
  for (const type of [S2C.WELCOME, S2C.SELF, S2C.LOOT_STATE, S2C.ABILITY_RESULT, S2C.LOOT_RESULT, S2C.MATCH_SUMMARY]) room.onMessage(type, () => {});
  return { get state() { return state; }, get draft() { return draft; }, snapshots, events, notices, phase: (p: number) => until(() => state?.phase === p && state) };
}

async function create(name = 'Host', extra: Record<string, unknown> = {}) {
  const room = await new Client(url).create(ROOM_NAME, { ...opts(name), ...extra });
  open.push(room);
  const messages = watch(room);
  await messages.phase(MatchPhase.LOBBY);
  return { room, messages };
}
async function join(code: string, name = 'Guest') {
  const room = await new Client(url).joinById(code, opts(name));
  open.push(room);
  const messages = watch(room);
  await messages.phase(MatchPhase.LOBBY);
  return { room, messages };
}
async function listing(): Promise<RoomListing[]> {
  const response = await fetch(`http://127.0.0.1:${port}/rooms`);
  expect(response.ok).toBe(true);
  const data = await response.json() as { protocol: number; rooms: RoomListing[] };
  expect(data.protocol).toBe(PROTOCOL_VERSION);
  return data.rooms;
}
async function listed(code: string, predicate: (r: RoomListing) => boolean = () => true) {
  for (let i = 0; i < 100; i++) {
    const r = (await listing()).find((entry) => entry.code === code);
    if (r && predicate(r)) return r;
    await sleep(10);
  }
  throw new Error('room listing not updated');
}
async function ready(room: Room, messages: ReturnType<typeof watch>) {
  room.send(C2S.READY, { r: 1 });
  await until(() => messages.state?.players.find((p) => p.sessionId === room.sessionId)?.ready);
}

beforeAll(async () => {
  setAuthVerifier(null);
  setMatchStore({ name: 'none', record: async () => null });
  // The bots' navigation graph is built once per server, at the first match with bots (seconds on a busy machine):
  // build it here, not inside a test's few-second wait.
  getNav(await getWorld());
  await server.listen(port);
}, 60000);
afterEach(async () => {
  await Promise.all(open.splice(0).filter((room) => room.connection.isOpen).map((room) => room.leave().catch(() => {})));
});
afterAll(async () => { await server.gracefullyShutdown(false).catch(() => {}); });

describe('authoritative competitive room preparation', () => {
  it('discovers actual public rooms, excludes private rooms, and humans replace planned bots without combat', async () => {
    const a = await create('Luiz', { roomName: 'Sala pública', bots: 9 });
    const privateRoom = await create('Private', { visibility: 'private', bots: 3 });
    expect(await listed(a.room.roomId)).toMatchObject({ name: 'Sala pública', hostName: 'Luiz', humans: 1, botsDesired: 9, botsPlanned: 9, capacity: 10, available: true, phase: MatchPhase.LOBBY });
    expect((await listing()).some((r) => r.code === privateRoom.room.roomId)).toBe(false);
    expect(a.messages.state!.players).toHaveLength(1);
    const b = await join(a.room.roomId);
    expect(await listed(a.room.roomId, (r) => r.humans === 2)).toMatchObject({ humans: 2, botsDesired: 9, botsPlanned: 8 });
    a.room.send(C2S.PLAYER_INPUT, { i: [[1, 127, 0, 0, 1000, 0, 0, 0]] });
    a.room.send(C2S.FIRE, { s: 1, w: 0, o: [0, 0, 0], d: [10000, 0, 0], a: 1 });
    await sleep(150);
    expect(a.messages.state!.players).toHaveLength(2);
    expect(a.messages.state!.players.every((p) => !p.bot && !p.inMatch && p.kills === 0)).toBe(true);
    expect(a.messages.snapshots).toHaveLength(0);
    expect(a.messages.events).toHaveLength(0);
    expect(b.messages.snapshots).toHaveLength(0);
  });

  it.each([1, 2, 5, 10])('caps %i human seats at 10 total and permits humans to replace every planned bot', async (count) => {
    const a = await create('Host', { bots: 9 });
    const humans = [a];
    for (let i = 1; i < count; i++) humans.push(await join(a.room.roomId, `Human ${i}`));
    await until(() => a.messages.state?.room?.humans === count);
    expect(a.messages.state!.room).toMatchObject({ humans: count, botsPlanned: 10 - count });
    expect(a.messages.state!.players).toHaveLength(count);
    if (count === 10) {
      expect(await listed(a.room.roomId, (r) => r.humans === 10)).toMatchObject({ available: false, botsPlanned: 0 });
      await expect(new Client(url).joinById(a.room.roomId, opts('Eleventh'))).rejects.toThrow(/full|locked/i);
    }
    await Promise.all(humans.map(({ room, messages }) => ready(room, messages)));
    a.room.send(C2S.START_MATCH, {});
    const frozen = await a.messages.phase(MatchPhase.ABILITY_DRAFT);
    expect(frozen.players).toHaveLength(10);
    expect(frozen.players.filter((p) => !p.bot)).toHaveLength(count);
    expect(frozen.players.filter((p) => p.bot)).toHaveLength(10 - count);
  });

  it('requires an explicit host start, all humans ready, legal host settings, and two participants', async () => {
    const a = await create();
    await ready(a.room, a.messages);
    a.room.send(C2S.START_MATCH, {});
    await until(() => a.messages.notices.some((n) => n.code === NoticeCode.START_REJECTED));
    expect(a.messages.state!.phase).toBe(MatchPhase.LOBBY);
    const b = await join(a.room.roomId);
    b.room.send(C2S.ROOM_SETTINGS, { bots: 9 });
    b.room.send(C2S.START_MATCH, {});
    await sleep(60);
    expect(a.messages.state!.room!.botsDesired).toBe(0);
    a.room.send(C2S.ROOM_SETTINGS, { bots: 3 });
    await until(() => a.messages.state?.room?.botsDesired === 3);
    a.room.send(C2S.ROOM_SETTINGS, { bots: 20 });
    await ready(b.room, b.messages);
    await sleep(80);
    expect(a.messages.state!.phase).toBe(MatchPhase.LOBBY);
    expect(a.messages.state!.room!.canStart).toBe(true);
    b.room.send(C2S.READY, { r: 0 });
    await until(() => a.messages.state?.room?.canStart === false);
    a.room.send(C2S.START_MATCH, {});
    await sleep(50);
    expect(a.messages.state!.phase).toBe(MatchPhase.LOBBY);
    await ready(b.room, b.messages);
    a.room.send(C2S.START_MATCH, {});
    const draft = await a.messages.phase(MatchPhase.ABILITY_DRAFT);
    expect(draft.players.filter((p) => p.bot)).toHaveLength(3);
    expect(draft.players).toHaveLength(5);
    await expect(new Client(url).joinById(a.room.roomId, opts('Late'))).rejects.toThrow(/IN_PROGRESS/);
    a.room.send(C2S.ROOM_SETTINGS, { bots: 0 });
    a.room.send(C2S.READY, { r: 1 });
    await sleep(60);
    expect(a.messages.state!.room!.botsDesired).toBe(3);
    expect(a.messages.snapshots).toHaveLength(0);
    expect(await listed(a.room.roomId, (r) => r.phase === MatchPhase.ABILITY_DRAFT)).toMatchObject({ available: false });
  });

  it('never admits an eleventh human when several clients race for planned bot seats', async () => {
    const a = await create('Host', { bots: 9 });
    const attempts = await Promise.allSettled(Array.from({ length: 12 }, async (_, index) => {
      const room = await new Client(url).joinById(a.room.roomId, opts(`Race ${index}`));
      open.push(room);
      watch(room);
      return room;
    }));
    expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(9);
    expect(attempts.filter((r) => r.status === 'rejected')).toHaveLength(3);
    await until(() => a.messages.state?.room?.humans === 10);
    expect(a.messages.state!.players).toHaveLength(10);
    expect(a.messages.state!.room!.botsPlanned).toBe(0);
  });

  it('finishes bot and timed-out human draft picks, then waits for genuine loading ACK before the UFO and match', async () => {
    const a = await create('Host', { bots: 9, draftPickMs: 50, draftRepickMs: 50, draftRevealMs: 15, ufoRevealMs: 0, ufoWindowMs: 80, ufoLandTimeoutMs: 80, countdownMs: 0 });
    await ready(a.room, a.messages);
    a.room.send(C2S.START_MATCH, {});
    const prep = await a.messages.phase(MatchPhase.PREPARATION);
    expect(prep.players).toHaveLength(10);
    expect(prep.preparation).toMatchObject({ ready: [], waiting: [0] });
    expect(prep.players.every((p) => p.loadout.length === 4 && new Set(p.loadout).size === 4)).toBe(true);
    expect(a.messages.snapshots).toHaveLength(0);
    expect(a.messages.events).toHaveLength(0);
    a.room.send(C2S.PREPARED, { id: prep.preparation!.id - 1, ok: true });
    a.room.send(C2S.DRAFT_PICK, { r: 0, a: 'fireball' });
    await sleep(80);
    expect(a.messages.state!.phase).toBe(MatchPhase.PREPARATION);
    a.room.send(C2S.PREPARED, { id: prep.preparation!.id, ok: true });
    const ufo = await a.messages.phase(MatchPhase.UFO);
    expect(ufo.ufo).not.toBeNull();
    expect(ufo.players.every((p) => p.kills === 0 && p.deaths === 0)).toBe(true);
    await a.messages.phase(MatchPhase.MATCH);
    await until(() => a.messages.snapshots.length > 0);
  });

  it('acknowledges every human, returns results to the lobby, and recreates planned seats only at the next start', async () => {
    const a = await create('Host', { skipDraft: true, skipUfo: true, countdownMs: 0 });
    const b = await join(a.room.roomId);
    await ready(a.room, a.messages);
    await ready(b.room, b.messages);
    a.room.send(C2S.START_MATCH, {});
    const prep = await a.messages.phase(MatchPhase.PREPARATION);
    a.room.send(C2S.PREPARED, { id: prep.preparation!.id, ok: true });
    await until(() => a.messages.state?.preparation?.ready.length === 1);
    expect(a.messages.state!.phase).toBe(MatchPhase.PREPARATION);
    b.room.send(C2S.PREPARED, { id: prep.preparation!.id, ok: true });
    await a.messages.phase(MatchPhase.MATCH);
    await b.room.leave();
    await a.messages.phase(MatchPhase.RESULTS);
    a.room.send(C2S.RETURN_LOBBY, {});
    const lobby = await a.messages.phase(MatchPhase.LOBBY);
    expect(lobby.players).toHaveLength(1);
    expect(lobby.players[0]!.ready).toBe(false);
    expect(lobby.preparation).toBeNull();
  });

  it.each([false, true])('unwinds a loading %s failure or timeout with an actionable server notice', async (timeout) => {
    const a = await create('Host', { bots: 1, skipDraft: true, preparationTimeoutMs: timeout ? 110 : 5000 });
    await ready(a.room, a.messages);
    a.room.send(C2S.START_MATCH, {});
    const prep = await a.messages.phase(MatchPhase.PREPARATION);
    if (!timeout) a.room.send(C2S.PREPARED, { id: prep.preparation!.id, ok: false, error: 'asset unavailable' });
    await a.messages.phase(MatchPhase.LOBBY);
    expect(a.messages.notices.some((n) => n.code === (timeout ? NoticeCode.LOAD_TIMEOUT : NoticeCode.LOAD_FAILED))).toBe(true);
    expect(a.messages.state!.players).toHaveLength(1);
    expect(a.messages.state!.room!.botsPlanned).toBe(1);
  });

  it('notifies guests and closes the authoritative room when its host leaves', async () => {
    const a = await create();
    const b = await join(a.room.roomId);
    let left = false;
    b.room.onLeave(() => { left = true; });
    await a.room.leave();
    await until(() => left);
    expect(b.messages.notices.some((n) => n.code === NoticeCode.HOST_LEFT)).toBe(true);
    expect(b.messages.state!.phase).toBe(MatchPhase.CLOSED);
    expect((await listing()).some((r) => r.code === a.room.roomId)).toBe(false);
  });
});
