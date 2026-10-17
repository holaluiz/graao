# Deployment (TODO)

- Client: `pnpm --filter @graao/client build` → `apps/client/dist` → Cloudflare Pages (`play.graao.com`) with
  `VITE_SERVER_URL=wss://…` and `VITE_ASSET_BASE=https://assets.graao.com`.
- Server: `pnpm --filter @graao/server build` → Docker image on Node 22 hosting with WebSockets (one region close to
  the players for the MVP); `/health` for checks.
- The version triple (client, protocol, assets) must match between client and server.
