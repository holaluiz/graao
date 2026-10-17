# graao

A stylized 3D multiplayer game that runs in the browser: third-person movement, guns and magic, customizable
characters, on a small planet that is actually a sphere.

```bash
pnpm install
pnpm dev          # client http://localhost:5173 + match server ws://localhost:2567
```

The game is in Portuguese. Open the client, press **ENTRAR NO GRAAO**. **Explorar sozinho** to run around and practice
shooting; **Criar partida** gives a room code (`GR-XXXX`) that a second browser window can join with **Entrar**. In the
warmup both players press **ENTER** when ready: 3-2-1, the last one standing wins. F3 shows the performance overlay.

Controls: WASD move · mouse camera · Space jump · Shift sprint · left click fire · right click aim · E / Q weapons ·
R reload · Enter ready · Esc release the mouse (twice: menu).

Running a second local copy (ports in use): `pnpm --filter @graao/server exec tsx watch src/index.ts --port 2568` and
`pnpm --filter @graao/client exec vite --port 5174`, then open `http://localhost:5174/?server=ws://localhost:2568`
(the `server` query parameter only works in development builds).

| | |
|---|---|
| Stack | TypeScript, pnpm, Vite, Three.js (WebGL2), Rapier, Colyseus, DOM/CSS/SVG UI |
| Tests | `pnpm test` (game-core, retargeter, two-client integration) |
| Docs | [docs/README.md](docs/README.md) · status in [docs/MVP_STATUS.md](docs/MVP_STATUS.md) |

Third-party content: Quaternius Universal Animation Library (CC0 1.0), retargeted to graao's rig. Everything else
(characters, clothes, props, planet, materials, UI) is authored in this repository.
