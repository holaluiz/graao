# Deployment

Two pieces, two hosts:

| Piece | Host | Why |
|---|---|---|
| Client (static: HTML, JS, GLB) | **Vercel** (already live at `graao.vercel.app`) | Static files only |
| Match server (Colyseus + Rapier, WebSockets, in-memory rooms) | **Fly.io**, region `gru` (São Paulo) — or any Docker host with WebSockets | Vercel cannot run a long-lived WebSocket server |

Before 2026-10-17 only the client was deployed: the production build had no `VITE_SERVER_URL`, so it looked for
`wss://graao.vercel.app:2567`, where nothing listens ("Não foi possível falar com o servidor"). See
`docs/audits/GRAAO_MVP_AUDIT.md`.

## 1. Match server on Fly.io (once)

Needs a Fly.io account (the user's) and `flyctl` installed.

```bash
fly auth login
fly launch --copy-config --no-deploy --name <unique-app-name>   # keeps fly.toml (region gru, port 2567, /health)
fly secrets set SUPABASE_URL=https://roxnhqzeznsdnsqjcmmn.supabase.co SUPABASE_PUBLISHABLE_KEY=<publishable key> GRAAO_SERVER_SECRET=<fresh secret>
fly deploy
fly scale count 1          # rooms live in memory: exactly one machine
curl https://<unique-app-name>.fly.dev/health
```

- `GRAAO_SERVER_SECRET`: generate a new one for this server (`node -e "console.log(crypto.randomBytes(32).toString('hex'))"`)
  and register its SHA-256 in `private.server_keys` (see `docs/infrastructure/SUPABASE.md`). Without it the server
  still runs; match results are just not saved.
- `GRAAO_REQUIRE_AUTH=1` refuses guests; leave it off until the client build has the Supabase variables.
- The image: `apps/server/Dockerfile` (build context = repository root). Runtime = `dist/server.mjs` + the three
  external packages in `apps/server/runtime-package.json`. Checked locally: the bundle starts in ≈ 0.5 s, `/health`
  answers and CORS allows `https://graao.vercel.app`.

Any other Docker host works the same way (one instance, WebSockets, health check on `/health`, `PORT` from the
environment).

## 2. Client on Vercel

Environment variables (Project → Settings → Environment Variables), then redeploy:

| Variable | Value |
|---|---|
| `VITE_SERVER_URL` | `wss://<unique-app-name>.fly.dev` |
| `VITE_SUPABASE_URL` | `https://roxnhqzeznsdnsqjcmmn.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | the publishable key (browser-safe) |

Build: `pnpm --filter @graao/client build` → `apps/client/dist`. Preview first: a pushed branch gets a Vercel preview
URL; promote to production only after the two-player test below passes on the preview.

The menu checks the server's `/health` before anyone clicks: "Servidor online", "outra versão" or "fora do ar".

## 3. Quick test without a hosted server (tunnel)

To play across networks before the Fly.io account exists, expose a local server through a tunnel:

```bash
pnpm dev:server                                   # ws://localhost:2567
cloudflared tunnel --url http://localhost:2567    # prints https://<random>.trycloudflare.com
```

Then both players open the (new) client with `?server=wss://<random>.trycloudflare.com`. In production builds
`?server=` accepts only `wss://` URLs and that tab plays as a **guest**: the player's Supabase token is never sent to a
server other than the build's own.

## 4. Two-player test script (devices / networks)

Run it in this order; do not mark a step done from the step before it.

1. **Same PC, two browsers** (e.g. Chrome + Edge): A → *Criar partida* → code `GR-XXXX`; B → code → *Entrar*.
2. **Two devices, same Wi-Fi:** on the PC run `pnpm dev` (Vite listens on the LAN); the other device opens
   `http://<PC LAN IP>:5173`. Windows may ask to allow Node through the firewall (private networks).
3. **Two networks:** one player on another connection (phone hotspot works), both on the deployed client (or the
   tunnel URL above).

At each step, check and write down:

- [ ] both names in the lobby, "N de 2 prontos" updates on both sides
- [ ] each sees the other move smoothly and with the right clothes
- [ ] both press *Estou pronto* → draft → each HUD shows the abilities they got
- [ ] UFO: one jumps early, the other waits for the automatic drop; both land
- [ ] A shoots B: B's Shield drops first, then Health; B sees damage direction
- [ ] B is eliminated: A sees **VITÓRIA!**, B sees **DERROTA**
- [ ] *Voltar ao lobby* on both → back in the lobby with the score 1 × 0
- [ ] ping in F3 (write it down) and anything that felt wrong
- [ ] (optional) turn Wi-Fi off for 5 s on one device mid-match: "reconectando…" then back in the same match
