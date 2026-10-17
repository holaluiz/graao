# Architecture overview

graao is a browser-native third-person multiplayer game on a small, truly spherical planet.

```
apps/client  (Vite, Three.js WebGL2, DOM/CSS/SVG UI)        apps/server (Node, Colyseus)
  ├─ app/GraaoApp          phases, loop, HUD director         ├─ app.ts            defineServer + /health
  ├─ render/               renderer, sky, sun, materials      ├─ rooms/GraaoMatchRoom  authoritative match
  ├─ world/                planet view, props, grass, water   └─ world.ts          shared static world
  ├─ character/            rig, retargeter, parts, creator
  ├─ game/                 input, camera, local prediction
  ├─ net/                  session, interpolation, remotes
  └─ ui/                   menu, creator, F3 overlay
                 \                                 /
                  packages/game-core  (deterministic rules, both sides)
                    terrain · layout · Rapier physics · GraaoSphericalCharacterController · sphere math
                  packages/game-data  (typed content: planet, appearance catalog, movement tuning)
                  packages/shared     (protocol, versions, constants, validation, vec3)
                  packages/database   (Supabase schema + access — TODO)
```

## Responsibility boundaries

| Concern | Owner |
|---|---|
| Rendering | Three.js (client only) |
| Gameplay physics | Rapier (same world on client and server; zero global gravity, radial gravity per system) |
| Authoritative match | Colyseus room (server) |
| Persistent player data | Supabase (TODO) |
| Large/versioned assets | Cloudflare R2 (`/assets/v1/...`; dev serves the same paths from Vite `public/`) |
| UI | DOM/CSS/SVG |
| Animation content | Mixamo-compatible rig + retargeted clips (CC0 UAL now, Mixamo FBX when supplied) |

## Determinism contract

`createGameWorld()` builds the terrain mesh, layout and Rapier world from `@graao/game-data` with seeded noise and a
seeded PRNG. Client prediction and the server run the same `CharacterMotor.step()` on the same world, so replaying
inputs from an authoritative state reproduces it (tested: < 1 µm drift over 90 steps).

## Versions

`CLIENT_VERSION`, `PROTOCOL_VERSION`, `ASSET_VERSION` in `@graao/shared`. The server rejects joins with another
protocol version; the F3 overlay shows all three.

## Commands

| Command | Does |
|---|---|
| `pnpm dev` | client (Vite, :5173) + server (tsx watch, :2567) |
| `pnpm test` | Vitest: game-core, retargeter, multiplayer integration |
| `pnpm lint` / `pnpm typecheck` | ESLint / tsc for packages, server and client |
| `pnpm build` | client bundle (`apps/client/dist`) + server bundle (`apps/server/dist/server.mjs`) |
| `pnpm assets:inspect <path>` | GLB report: size, tris, verts, materials, textures (+dims), bones, clips |
| `pnpm assets:anims` | rebuild the animation packs from the CC0 sources |
| `pnpm bot -- --code GR-XXXX` | network test bot (patterns: circle, zigzag, jumpy, idle) |
| `npx tsx tools/profiling/world-stats.ts` | world build cost and content counts |
