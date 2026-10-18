/** Server definition (rooms + HTTP routes), shared by the entry point and the integration tests. */
import { createEndpoint, createRouter, defineRoom, defineServer, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ASSET_VERSION, CLIENT_VERSION, MatchPhase, PROTOCOL_VERSION, ROOM_NAME, type RoomListing } from '@graao/shared';
import { GraaoMatchRoom } from './rooms/GraaoMatchRoom';

const startedAt = Date.now();

export function createGraaoServer() {
  return defineServer({
    greet: false,
    transport: new WebSocketTransport({ pingInterval: 4000, pingMaxRetries: 3 }),
    rooms: {
      [ROOM_NAME]: defineRoom(GraaoMatchRoom),
    },
    routes: createRouter({
      rooms: createEndpoint('/rooms', { method: 'GET' }, async () => {
        const listings = await matchMaker.query({ name: ROOM_NAME, private: false });
        const rooms: RoomListing[] = listings.flatMap((listing) => {
          const metadata = listing.metadata as Omit<RoomListing, 'code'> | undefined;
          if (!metadata || metadata.visibility !== 'public' || metadata.phase === MatchPhase.CLOSED || !metadata.hostSessionId) return [];
          return [{ ...metadata, code: listing.roomId, ...(process.env.GRAAO_REGION ? { region: process.env.GRAAO_REGION } : {}) }];
        });
        return Response.json({ protocol: PROTOCOL_VERSION, rooms }, { headers: { 'Cache-Control': 'no-store' } });
      }),
      health: createEndpoint('/health', { method: 'GET' }, async () => {
        const rooms = await matchMaker.query({ name: ROOM_NAME });
        return Response.json({
          ok: true,
          version: CLIENT_VERSION,
          protocol: PROTOCOL_VERSION,
          assets: ASSET_VERSION,
          uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
          rooms: rooms.length,
          players: rooms.reduce((n, r) => n + r.clients, 0),
        });
      }),
    }),
  });
}
