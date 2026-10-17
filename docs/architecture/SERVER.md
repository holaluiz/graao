# Server

Node 22+, Colyseus 0.18 (`@colyseus/core` + `@colyseus/ws-transport`). Entry `apps/server/src/index.ts`.

- `world.ts` builds the static world once per process (terrain trimesh + 323 prop colliders, ≈ 0.4–1 s), shared by all
  rooms. Player capsules from different rooms coexist in that Rapier world but never collide (collision groups).
- `rooms/GraaoMatchRoom.ts`: codes, join validation, input queue + budget + jitter buffer, fixed-step simulation,
  per-player simulation clock, 20 Hz snapshots, room state, ping/pong with tick cost. Room option `maxPlayers`
  (default 2, max 20).
- `GET /health` → version, protocol, assets, uptime, rooms, players.
- Logs: one line per event with JSON fields (`log.ts`).
- Env: `PORT` (2567), `SIMULATE_LATENCY_MS`, `CLIENT_ORIGIN`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server only).
- Build: `pnpm --filter @graao/server build` → `dist/server.mjs` (esbuild; Colyseus, ws and Rapier stay external).
