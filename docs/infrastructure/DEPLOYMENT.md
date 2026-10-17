# Deployment (TODO)

- Client: `pnpm --filter @graao/client build` → `apps/client/dist` → Cloudflare Pages (`play.graao.com`) with
  `VITE_SERVER_URL=wss://…`, `VITE_ASSET_BASE=https://assets.graao.com`, `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_PUBLISHABLE_KEY` (browser-safe; see `apps/client/.env.example`). supabase-js is its own lazy chunk.
- Server: `pnpm --filter @graao/server build` → Docker image on Node 22 hosting with WebSockets (one region close to
  the players for the MVP); `/health` for checks. Environment: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
  `GRAAO_SERVER_SECRET` (a fresh secret per deployment, its SHA-256 inserted into `private.server_keys`) and
  `GRAAO_REQUIRE_AUTH=1` once anonymous sign-in is on.
- The version triple (client, protocol, assets) must match between client and server.
