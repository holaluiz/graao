/**
 * Graao Host end to end on one machine, without a window: the real HostController (pairing, server process, endpoint,
 * publishing, heartbeat, stop), the bundled match server in its own process, the development central service (the
 * real hosting SQL on an embedded Postgres) and real Colyseus clients. Endpoints are loopback (`direct-dev`): the
 * public tunnel is exercised separately (tools/hosting/three-hosts.ts --tunnel quick).
 *
 * Three installations host three rooms at once; each keeps its own players; stopping one or crashing another never
 * touches the rest; a linked PC hosts again without a new confirmation; a full match with bots runs on a host.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import { DEFAULT_APPEARANCE } from '@graao/game-data';
import { CLIENT_VERSION, NoticeCode, PROTOCOL_VERSION, S2C, createHostCentral, parseHostLink, buildHostLink, randomSecret, sha256Hex, type NoticeMsg, type RoomStateMsg } from '@graao/shared';
import { createHeadlessHost, waitPhase } from '../apps/host/src/main/headless';
import type { HostController } from '../apps/host/src/main/HostController';
import { startCentralDev, type CentralDevServer } from '../tools/hosting/central-dev';
import { runGameplaySmoke } from '../tools/hosting/gameplay-smoke';

const tmp = mkdtempSync(join(tmpdir(), 'graao-host-e2e-'));
const bundle = join(tmp, 'graao-server.mjs');
let dev: CentralDevServer;
const hosts: HostController[] = [];
const users = ['aaaaaaaa-0000-4000-8000-00000000000a', 'bbbbbbbb-0000-4000-8000-00000000000b', 'cccccccc-0000-4000-8000-00000000000c'];

const site = (uid: string) => createHostCentral({ url: dev.url, key: 'dev', accessToken: async () => `dev.${uid}` });

/** What the site does on "Criar e hospedar": a ticket, then the deep link the browser opens. */
async function ask(uid: string, roomName: string, bots: number, visibility: 'PUBLIC' | 'PRIVATE' = 'PUBLIC') {
  const secret = randomSecret();
  const { ticketId } = await site(uid).ticketCreate(await sha256Hex(secret), { roomName, visibility, bots, hostName: roomName.split(' ').at(-1)! }, PROTOCOL_VERSION);
  return { link: parseHostLink(buildHostLink({ action: 'host', ticket: ticketId, secret }))!, ticketId, secret };
}

async function hostRoom(h: HostController, uid: string, name: string, bots: number, confirm: boolean) {
  const req = await ask(uid, name, bots);
  h.handleLink(req.link);
  if (confirm) {
    await waitPhase(h, ['PAIRING'], 10000);
    await new Promise<void>((r) => {
      const t = setInterval(() => h.state.pairing && (clearInterval(t), r()), 20);
    });
    expect(h.state.pairing).toMatchObject({ roomName: name, bots });
    h.confirmPairing(true);
  }
  await waitPhase(h, ['READY', 'HOSTING'], 60000);
  const status = await site(uid).ticketStatus(req.ticketId, req.secret);
  expect(status.status).toBe('READY');
  return { code: status.roomCode, url: status.endpointUrl, ownerKey: req.secret };
}

const opts = (name: string, extra: Record<string, unknown> = {}) => ({ protocol: PROTOCOL_VERSION, client: CLIENT_VERSION, name, appearance: DEFAULT_APPEARANCE, ...extra });

async function until(pred: () => boolean, ms = 8000, what = 'condition'): Promise<void> {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error(`timeout: ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

function stateWhere(room: Room, pred: (m: RoomStateMsg) => boolean, ms = 8000): Promise<RoomStateMsg> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('no matching ROOM_STATE')), ms);
    room.onMessage(S2C.ROOM_STATE, (m: RoomStateMsg) => {
      if (!pred(m)) return;
      clearTimeout(t);
      resolve(m);
    });
  });
}

beforeAll(async () => {
  execFileSync(process.execPath, ['build-desktop.mjs', bundle], { cwd: join(__dirname, '../apps/server'), stdio: 'ignore' });
  dev = await startCentralDev();
  for (let i = 0; i < 3; i++) hosts.push(createHeadlessHost({ centralUrl: dev.url, dataDir: join(tmp, `host-${i}`), serverBundle: bundle, tunnel: 'direct-dev' }));
}, 90000);

afterAll(async () => {
  await Promise.all(hosts.map((h) => h.stop().catch(() => {})));
  await dev?.close();
  rmSync(tmp, { recursive: true, force: true });
}, 30000);

describe('Graao Host end to end', () => {
  it('three installations host three independent rooms; stopping or crashing one leaves the others', async () => {
    const rooms = await Promise.all(hosts.map((h, i) => hostRoom(h, users[i]!, ['Sala do Luiz', 'Sala do Pedro', 'Sala da Ana'][i]!, [7, 5, 0][i]!, true)));
    expect(new Set(rooms.map((r) => r.code)).size).toBe(3);
    expect(new Set(rooms.map((r) => r.url)).size).toBe(3);

    const anon = createHostCentral({ url: dev.url, key: 'dev' });
    const listed = (await anon.publicRooms()).filter((r) => rooms.some((x) => x.code === r.roomCode));
    expect(listed.map((r) => r.name).sort()).toEqual(['Sala da Ana', 'Sala do Luiz', 'Sala do Pedro']);
    expect(listed.find((r) => r.name === 'Sala do Luiz')).toMatchObject({ humanCount: 0, effectiveBotCount: 7, available: true });

    // Each host joins its own room with its key; a friend resolves the code to the endpoint and joins.
    const owners = await Promise.all(rooms.map((r, i) => new Client(r.url).joinById(r.code, opts(['Luiz', 'Pedro', 'Ana'][i]!, { hostKey: r.ownerKey }))));
    const endpoint = await anon.roomEndpoint(rooms[0]!.code);
    expect(endpoint?.endpointUrl).toBe(rooms[0]!.url);
    const seen = stateWhere(owners[0]!, (m) => m.players.length === 2);
    const friend = await new Client(endpoint!.endpointUrl).joinById(rooms[0]!.code, opts('Amigo'));
    const state = await seen;
    expect(state.players.map((p) => p.name).sort()).toEqual(['Amigo', 'Luiz']);
    expect(state.room?.hostSessionId).toBe(owners[0]!.sessionId);
    expect(state.room?.botsPlanned).toBe(7);
    // Each app sees its own room's people: the friend is only in Luiz's room.
    await until(() => hosts[0]!.state.room?.humanCount === 2 && hosts[1]!.state.room?.humanCount === 1 && hosts[2]!.state.room?.humanCount === 1, 5000, 'room reports');
    expect(hosts[0]!.state.room?.players.map((p) => p.name).sort()).toEqual(['Amigo', 'Luiz']);
    expect(hosts[1]!.state.room?.players.map((p) => p.name)).toEqual(['Pedro']);

    // The heartbeat carries the real counts to the list.
    await new Promise((r) => setTimeout(r, 6500));
    expect((await anon.publicRooms()).find((r) => r.roomCode === rooms[0]!.code)).toMatchObject({ humanCount: 2, effectiveBotCount: 7 });
    expect(hosts[0]!.state.phase).toBe('HOSTING');

    // Pedro stops hosting: his guest is told why; the room leaves the list; the others are untouched.
    const notice = new Promise<NoticeMsg>((r) => owners[1]!.onMessage(S2C.NOTICE, (m: NoticeMsg) => r(m)));
    await hosts[1]!.stop();
    expect(await notice).toMatchObject({ code: NoticeCode.ROOM_CLOSED, text: 'O HOST ENCERROU A PARTIDA' });
    expect(hosts[1]!.state.phase).toBe('OFFLINE');
    expect((await anon.publicRooms()).some((r) => r.roomCode === rooms[1]!.code)).toBe(false);
    expect(await anon.roomEndpoint(rooms[1]!.code)).toBeNull();

    // Ana's server process dies: her app explains it, the room is delisted, Luiz still plays.
    const left = new Promise<number>((r) => owners[2]!.onLeave((c) => r(c)));
    const server = (hosts[2] as unknown as { server: { kill(): void } }).server;
    server.kill();
    await waitPhase(hosts[2]!, ['ERROR'], 10000).catch(() => {});
    expect(hosts[2]!.state.error?.code).toBe('server_crashed');
    await left;
    expect((await anon.publicRooms()).some((r) => r.roomCode === rooms[2]!.code)).toBe(false);
    expect(hosts[0]!.state.phase).toBe('HOSTING');
    // Only the host may change the bots.
    friend.send(16, { bots: 6 });
    await new Promise((r) => setTimeout(r, 1500));
    expect(hosts[0]!.state.room?.desiredBotCount).toBe(7);
    await Promise.all([owners[0]!.leave(), friend.leave()]);
    await hosts[2]!.dismiss();

    // Pedro hosts again later: already linked, no confirmation, no reinstall.
    const again = await hostRoom(hosts[1]!, users[1]!, 'Sala do Pedro 2', 2, false);
    expect(again.code).not.toBe(rooms[1]!.code);
    await hosts[1]!.stop();
    await hosts[0]!.stop();
  }, 120000);

  it('another account cannot use a linked PC', async () => {
    const req = await ask(users[0]!, 'Sala intrusa', 0);
    hosts[1]!.handleLink(req.link); // linked to users[1]
    await waitPhase(hosts[1]!, ['ERROR'], 10000).catch(() => {});
    expect(hosts[1]!.state.error?.code).toBe('conflict');
    await hosts[1]!.dismiss();
  }, 30000);

  it('runs a real match on the hosted server: draft, UFO, landing, bots shooting, chests, Tormenta', async () => {
    const r = await hostRoom(hosts[0]!, users[0]!, 'Sala de teste', 8, !hosts[0]!.state.linked);
    const report = await runGameplaySmoke({ url: r.url, code: r.code, ownerKey: r.ownerKey, guests: 1, bots: 8, fightMs: 12000 });
    expect(report.phases.slice(0, 5)).toEqual(['LOBBY', 'ABILITY_DRAFT', 'PREPARATION', 'UFO', 'MATCH']);
    expect(report).toMatchObject({ ok: true, participants: 10, bots: 8 });
    expect(report.loadout).toHaveLength(4);
    await hosts[0]!.stop();
  }, 180000);
});
