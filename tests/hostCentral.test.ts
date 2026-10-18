/**
 * Graao Host central service: the real migration (0003_graao_host.sql) on an embedded Postgres, called over HTTP with
 * the same client the site and the app use. Covers tickets (single use, expiry, version), pairing (link, conflict,
 * secret), publishing (endpoint validation, counts validated), the public list (only fresh, public rooms), endpoint
 * resolution, revocation and three independent hosts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, createHostCentral, randomSecret, sha256Hex, type HostCentral, type HostRoomReport, type HostRoomSettings, type TicketClaim } from '@graao/shared';
import { startCentralDev, type CentralDevServer } from '../tools/hosting/central-dev';

let dev: CentralDevServer;
const anon = () => createHostCentral({ url: dev.url, key: 'publishable' });
const as = (uid: string) => createHostCentral({ url: dev.url, key: 'publishable', accessToken: async () => `dev.${uid}` });

const LUIZ = '11111111-1111-4111-8111-111111111111';
const PEDRO = '22222222-2222-4222-8222-222222222222';
const ANA = '33333333-3333-4333-8333-333333333333';

const settings = (name: string, visibility: 'PUBLIC' | 'PRIVATE' = 'PUBLIC', bots = 7): HostRoomSettings => ({ roomName: name, visibility, bots, hostName: name.replace('Sala de ', '') });
const report = (code: string, humans: number, bots: number, extra: Partial<HostRoomReport> = {}): HostRoomReport => ({
  code, name: 'x', visibility: 'PUBLIC', status: 'LOBBY', humanCount: humans, desiredBotCount: bots, effectiveBotCount: bots, maxParticipants: 10, available: true, hostPresent: true, players: [], ...extra,
});

async function ticket(site: HostCentral, s: HostRoomSettings, protocol = PROTOCOL_VERSION) {
  const secret = randomSecret();
  const t = await site.ticketCreate(await sha256Hex(secret), s, protocol);
  return { id: t.ticketId, secret };
}

/** The whole app side for one ticket: peek, claim (new or known installation), publish on a loopback endpoint. */
async function host(app: HostCentral, t: { id: string; secret: string }, inst: { id: string | null; secret: string }, port: number) {
  const claim = await app.ticketClaim({ ticketId: t.id, secret: t.secret, installationId: inst.id, installSecret: inst.secret, appVersion: '0.1.0', protocol: PROTOCOL_VERSION });
  await app.roomPublish(claim.sessionToken, t.id, `local-${port}`, `ws://127.0.0.1:${port}`, report(claim.roomCode, 0, claim.settings.bots));
  return claim;
}

beforeAll(async () => {
  dev = await startCentralDev();
}, 60000);

afterAll(async () => {
  await dev?.close();
});

describe('Graao Host central service', () => {
  it('serves its config and needs a signed-in player to create tickets', async () => {
    expect(await anon().config()).toMatchObject({ tunnelMode: 'direct-dev', apiVersion: 1 });
    await expect(anon().ticketCreate(await sha256Hex('x'), settings('Sala de Luiz'), PROTOCOL_VERSION)).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('pairs a new installation once, lists the room only after publishing, resolves its endpoint', async () => {
    const site = as(LUIZ);
    const app = anon();
    const t = await ticket(site, settings('Sala de Luiz'));
    expect((await site.ticketStatus(t.id, t.secret)).status).toBe('PENDING');
    await expect(app.ticketPeek(t.id, 'x'.repeat(43), null)).rejects.toMatchObject({ code: 'ticket_not_found' });
    expect(await app.ticketPeek(t.id, t.secret, null)).toMatchObject({ roomName: 'Sala de Luiz', desiredBots: 7, linked: false, conflict: false });

    const inst = { id: null as string | null, secret: randomSecret() };
    const claim = await app.ticketClaim({ ticketId: t.id, secret: t.secret, installationId: null, installSecret: inst.secret, appVersion: '0.1.0', protocol: PROTOCOL_VERSION });
    expect(claim.roomCode).toMatch(/^GR-[23456789A-HJ-NP-Z]{4}$/);
    expect(claim.sessionToken).toMatch(/^[0-9a-f]{64}$/);
    await expect(app.ticketClaim({ ticketId: t.id, secret: t.secret, installationId: null, installSecret: inst.secret, appVersion: '0.1.0', protocol: PROTOCOL_VERSION })).rejects.toMatchObject({ code: 'ticket_used' });

    // Claimed is not listed: the room appears only once its endpoint is published.
    expect((await app.publicRooms()).find((r) => r.roomCode === claim.roomCode)).toBeUndefined();
    await expect(app.roomPublish(claim.sessionToken, t.id, 'x', 'http://example.com', report(claim.roomCode, 0, 7))).rejects.toMatchObject({ code: 'endpoint_invalid' });
    await expect(app.roomPublish('f'.repeat(64), t.id, 'x', 'wss://a.example.com', report(claim.roomCode, 0, 7))).rejects.toMatchObject({ code: 'session_invalid' });
    await app.roomPublish(claim.sessionToken, t.id, 'local-1', 'ws://127.0.0.1:4001', report(claim.roomCode, 0, 7));

    const status = await site.ticketStatus(t.id, t.secret);
    expect(status).toMatchObject({ status: 'READY', roomCode: claim.roomCode, endpointUrl: 'ws://127.0.0.1:4001' });
    const listed = (await app.publicRooms()).find((r) => r.roomCode === claim.roomCode)!;
    expect(listed).toMatchObject({ name: 'Sala de Luiz', hostDisplayName: 'Luiz', humanCount: 0, effectiveBotCount: 7, maxParticipants: 10, available: true, status: 'LOBBY' });
    expect(listed.hostPlayerId).not.toContain(LUIZ.slice(0, 8));
    expect(await app.roomEndpoint(claim.roomCode.toLowerCase())).toMatchObject({ endpointUrl: 'ws://127.0.0.1:4001', protocol: PROTOCOL_VERSION });

    // Heartbeats carry the room's own counts, validated: never more than ten participants.
    await app.heartbeat(claim.sessionToken, 'HOSTING', report(claim.roomCode, 3, 7));
    expect((await app.publicRooms()).find((r) => r.roomCode === claim.roomCode)).toMatchObject({ humanCount: 3, effectiveBotCount: 7 });
    await expect(app.heartbeat(claim.sessionToken, 'HOSTING', report(claim.roomCode, 8, 5))).rejects.toMatchObject({ code: 'invalid' });
    await app.heartbeat(claim.sessionToken, 'HOSTING', report(claim.roomCode, 10, 0, { status: 'MATCH', available: true }));
    expect((await app.publicRooms()).find((r) => r.roomCode === claim.roomCode)).toMatchObject({ status: 'MATCH', available: false });

    // The same PC hosts again later: already linked, same installation, the new room replaces the old one.
    inst.id = claim.hostId;
    const t2 = await ticket(site, settings('Sala de Luiz 2'));
    expect(await app.ticketPeek(t2.id, t2.secret, inst.id)).toMatchObject({ linked: true, conflict: false });
    const claim2 = await host(app, t2, inst, 4002);
    expect(claim2.hostId).toBe(claim.hostId);
    const mine = (await app.publicRooms()).filter((r) => r.hostId === claim.hostId);
    expect(mine.map((r) => r.roomCode)).toEqual([claim2.roomCode]);
    expect(await app.roomEndpoint(claim.roomCode)).toBeNull();

    // Closing removes it from the list and from endpoint resolution.
    await app.roomClose(claim2.sessionToken, 'O HOST ENCERROU A PARTIDA');
    expect((await app.publicRooms()).some((r) => r.hostId === claim.hostId)).toBe(false);
    expect(await app.roomEndpoint(claim2.roomCode)).toBeNull();
    await app.sessionEnd(claim2.sessionToken);
    await expect(app.heartbeat(claim2.sessionToken, 'ONLINE', null)).rejects.toMatchObject({ code: 'session_invalid' });
  });

  it('never lets another account take an installation over, nor a wrong secret use it', async () => {
    const app = anon();
    const inst = { id: null as string | null, secret: randomSecret() };
    const claim = await host(app, await ticket(as(LUIZ), settings('Sala de Luiz')), inst, 4003);
    inst.id = claim.hostId;
    const tp = await ticket(as(PEDRO), settings('Sala de Pedro'));
    expect(await app.ticketPeek(tp.id, tp.secret, inst.id)).toMatchObject({ linked: false, conflict: true });
    await expect(host(app, tp, inst, 4004)).rejects.toMatchObject({ code: 'installation_conflict' });
    const tl = await ticket(as(LUIZ), settings('Sala de Luiz'));
    await expect(host(app, tl, { id: inst.id, secret: randomSecret() }, 4005)).rejects.toMatchObject({ code: 'installation_secret' });
    // Pedro cannot revoke Luiz's PC; Luiz can, and the room leaves the list at once.
    await expect(as(PEDRO).revoke(inst.id!)).rejects.toMatchObject({ code: 'invalid' });
    expect((await as(LUIZ).myInstallations()).find((i) => i.hostId === inst.id)).toMatchObject({ revoked: false });
    await as(LUIZ).revoke(inst.id!);
    expect((await app.publicRooms()).some((r) => r.hostId === inst.id)).toBe(false);
    expect(await app.heartbeat(claim.sessionToken, 'HOSTING', null)).toMatchObject({ revoked: true });
  });

  it('refuses expired tickets and a different game version (the site learns why)', async () => {
    const app = anon();
    const old = await ticket(as(ANA), settings('Sala de Ana'), PROTOCOL_VERSION - 1);
    await expect(host(app, old, { id: null, secret: randomSecret() }, 4006)).rejects.toMatchObject({ code: 'version_mismatch' });
    expect(await as(ANA).ticketStatus(old.id, old.secret)).toMatchObject({ status: 'FAILED', error: 'version_mismatch' });

    const late = await ticket(as(ANA), settings('Sala de Ana'));
    await dev.central.db.query(`update public.host_tickets set expires_at = now() - interval '1 minute' where id = $1`, [late.id]);
    await expect(app.ticketPeek(late.id, late.secret, null)).rejects.toMatchObject({ code: 'ticket_expired' });
    expect((await as(ANA).ticketStatus(late.id, late.secret)).status).toBe('EXPIRED');
    // The site's poll marked it EXPIRED: an app opening it late still says "expirado", never "já usado".
    await expect(app.ticketPeek(late.id, late.secret, null)).rejects.toMatchObject({ code: 'ticket_expired' });
    await expect(app.ticketClaim({ ticketId: late.id, secret: late.secret, installationId: null, installSecret: randomSecret(), appVersion: '0.1.0', protocol: PROTOCOL_VERSION })).rejects.toMatchObject({ code: 'ticket_expired' });
  });

  it('hides quiet hosts and private rooms from the list; private rooms still resolve by code', async () => {
    const app = anon();
    const priv = await host(app, await ticket(as(ANA), settings('Sala secreta', 'PRIVATE')), { id: null, secret: randomSecret() }, 4007);
    expect((await app.publicRooms()).some((r) => r.roomCode === priv.roomCode)).toBe(false);
    expect(await app.roomEndpoint(priv.roomCode)).toMatchObject({ endpointUrl: 'ws://127.0.0.1:4007' });
    await dev.central.db.query(`update public.host_rooms set last_heartbeat_at = now() - interval '31 seconds' where room_code = $1 and closed_at is null`, [priv.roomCode]);
    expect(await app.roomEndpoint(priv.roomCode)).toBeNull();
    await app.roomClose(priv.sessionToken, 'fim');
  });

  it('keeps three hosts apart: three installations, three codes, three endpoints', async () => {
    const app = anon();
    const people = [LUIZ, PEDRO, ANA];
    const claims: TicketClaim[] = [];
    for (const [i, uid] of people.entries()) claims.push(await host(app, await ticket(as(uid), settings(`Sala ${i}`, 'PUBLIC', 9 - i * 4)), { id: null, secret: randomSecret() }, 4100 + i));
    expect(new Set(claims.map((c) => c.roomCode)).size).toBe(3);
    expect(new Set(claims.map((c) => c.hostId)).size).toBe(3);
    const rooms = (await app.publicRooms()).filter((r) => claims.some((c) => c.roomCode === r.roomCode));
    expect(rooms).toHaveLength(3);
    for (const [i, c] of claims.entries()) expect(await app.roomEndpoint(c.roomCode)).toMatchObject({ endpointUrl: `ws://127.0.0.1:${4100 + i}` });
    // A session updates only its own room.
    await app.heartbeat(claims[0]!.sessionToken, 'HOSTING', report(claims[0]!.roomCode, 2, 8));
    const after = await app.publicRooms();
    expect(after.find((r) => r.roomCode === claims[0]!.roomCode)).toMatchObject({ humanCount: 2, effectiveBotCount: 8 });
    expect(after.find((r) => r.roomCode === claims[1]!.roomCode)).toMatchObject({ humanCount: 0, effectiveBotCount: 5 });
    await app.roomClose(claims[1]!.sessionToken, 'fim');
    const left = (await app.publicRooms()).filter((r) => claims.some((c) => c.roomCode === r.roomCode));
    expect(left.map((r) => r.roomCode).sort()).toEqual([claims[0]!.roomCode, claims[2]!.roomCode].sort());
  });

  it('keeps tables closed and service-only functions away from browsers and apps', async () => {
    const as = async (role: string, sql: string) =>
      dev.central.db.transaction(async (tx) => {
        await tx.exec(`set local role ${role}`);
        return tx.query(sql);
      });
    for (const role of ['anon', 'authenticated']) {
      await expect(as(role, "select public.host_session_validate(repeat('a', 64))")).rejects.toThrow(/permission denied/);
      await expect(as(role, 'select public.host_tunnels_stale(30)')).rejects.toThrow(/permission denied/);
      await expect(as(role, 'select * from public.host_rooms')).rejects.toThrow(/permission denied|row-level security/);
      await expect(as(role, 'select * from private.host_sessions')).rejects.toThrow(/permission denied/);
    }
    await expect(as('anon', "select public.host_ticket_create(repeat('a', 64), 'x', 'PUBLIC', 0, 9, 'x')")).rejects.toThrow(/permission denied/);
    expect((await as('service_role', 'select public.host_tunnels_stale(30) as r')).rows[0]).toEqual({ r: [] });
  });

  it('limits how many tickets one account can create in a burst', async () => {
    const uid = '44444444-4444-4444-8444-444444444444';
    for (let i = 0; i < 20; i++) await ticket(as(uid), settings('Sala'));
    await expect(ticket(as(uid), settings('Sala'))).rejects.toMatchObject({ code: 'rate_limited' });
  });
});
