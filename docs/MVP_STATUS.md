# graao MVP status

## 2026-10-19 — Ability v2: regressão e validação integrada

As 40 magias (30 básicas + 10 Supremos) estão implementadas. Esta rodada corrigiu dano duplicado do Meteoro
durante eliminações, alinhou o volume visível/autoritativo da Nuvem de Giz e impediu rastros de jogadores parados
no Eco dos Passos. O Draft agora usa duas cartas por página em telas com até 450 px de altura; a confirmação e os
dez participantes foram conferidos em 844×390, além de desktop e celular em retrato.

**Validação final desta rodada:** 158/158 testes focados em 16 arquivos, typecheck completo, build e ESLint passaram.
Os testes reais de Colyseus cobrem 1 cliente + 9 bots e 2 clientes + 8 bots. Há coleta reproduzível de servidor/rede
e stress separado dos dez Supremos no engine. A qualificação manual de todas as apresentações/áudio e confrontos
entre máquinas permanece TESTING. Evidências e limites no [relatório de validação](qa/ABILITY_V2_VALIDATION_2026-10-19.md).

## 2026-10-19 — Master Plan 2.0: M0 (auditoria) e M1 (estabilidade)

O [Master Game Design 2.0](product/MASTER_GAME_DESIGN_2.md) passa a ser o contrato do produto; o
[backlog](product/BACKLOG.md) ordena as frentes por marco e os [gates de release](qa/RELEASE_GATES.md) definem os
estados e os critérios de teste. A [auditoria M0](qa/AUDIT_M0_2026-10-19.md) confrontou o relatório de engenharia
com o código:

- **Baseline real em `cc7962a`:** typecheck e build passam; suíte **541/542** (o relatório dizia 537/542). Das cinco
  falhas citadas só uma existia; as de `paper_wall`, passiva/`clothesline` e `fx: slow` passam isoladas e na suíte.
- **Falha classificada como teste incorreto:** os testes de suavidade multiplayer corriam o jogador na direção de uma
  parede colonial que a edição do mapa pôs no caminho do spawn (o servidor estava certo em pará-lo). Agora o bloco
  nasce num ponto aberto achado no mundo estático (`openSpot`/`clearWish`, opção dev `freeRoamSpawns`, sem creeps);
  nenhum limite foi afrouxado.
- **Bug latente corrigido:** o `MAP_HASH` era documentado como conferido no join, mas não era. Agora cliente e
  servidor recusam mapas diferentes (`MAP_MISMATCH`, mensagem em português) — um Graao Host instalado antes de uma
  edição do mapa não joga mais com colisões diferentes das do site. A verificação no navegador mostrou que o digest
  precisava ser estável entre motores JS (Node × Chromium diferem no último bit de prefabs calculados): números
  passam por uma grade binária antes do hash.
- **Bug latente corrigido:** recusas em `onCreate`/`onAuth` (criar sala pela rede num Graao Host, bots inválidos,
  login exigido) chegavam ao cliente como HTTP 500 sem motivo, porque usavam códigos de WebSocket numa resposta HTTP.
- **Teste instável classificado:** o e2e do Graao Host exigia tiro dos bots em 12 s fixos; com o início desarmado o
  primeiro tiro leva 5,9–13,1 s (5 medições). A fumaça agora espera o primeiro tiro com dano (com teto).
- **F3:** além do que já tinha, creeps, colisores, bots, quedas de conexão e heap JS.
- **Regressão final (Gate A):** typecheck e build passam; suíte completa **543/543** em 57 arquivos (259 s), sem o
  ruído de `RangeError`; ESLint limpo nos arquivos alterados.

Ainda **não** feito: nenhum teste entre redes (Gate B bloqueado por máquinas — roteiro em
[HOST_VALIDATION.md](networking/HOST_VALIDATION.md)); as frentes M3–M11 seguem `NOT_STARTED`/`PARTIAL` conforme a
matriz da auditoria.

## 2026-10-18 (noite) — Graao Host: hospedagem comunitária no PC do jogador

Quem hospeda instala o **Graao Host** uma vez; o PC dessa pessoa roda o **mesmo** servidor Colyseus/`GraaoMatchRoom`
(bots, armas, magias, baús, OVNI, Tormenta) e os amigos entram pelo navegador por HTTPS/WSS (Cloudflare Tunnel). O
Supabase só autoriza, lista e resolve salas.

**Funciona e foi testado (um PC, uma rede):**

- Servidor em `HOST_MODE=DESKTOP` (política única em `apps/server/src/hostPolicy.ts`; o modo dedicado e as salas no
  navegador continuam iguais), empacotado num `.mjs` autocontido que roda sem `node_modules`.
- App Electron 43 (`apps/host`): janela com a identidade do graao, bandeja, protocolo `graao-host://`, vínculo com
  confirmação, ciclo de vida com erros explicados, métricas (CPU, memória, tick, bytes), painel técnico opcional.
- Instalador NSIS por usuário (`GraaoHost-Setup-0.1.0.exe`, ≈ 122 MB): instalar, protocolo, reinstalar, atualizar,
  desinstalar limpo.
- Central: migration `0003_graao_host.sql` (tickets de uso único, instalações, sessões, salas, grants/RLS) validada
  num Postgres embutido e **aplicada na Supabase de produção** (2026-10-18; um host headless publicou e removeu uma
  sala real — `docs/hosting/GRAAO_HOST_TEST_REPORT.md`); Edge Function de túneis gerenciados escrita.
- Site: **Criar e hospedar**, painel "instale o Graao Host", lista com selo GRAAO HOST, entrar pelo endpoint sem
  token Supabase, `?sala=` do app, aviso **O HOST ENCERROU A PARTIDA**.
- Três hosts simultâneos por túneis reais da Cloudflare (Quick Tunnel), partidas completas 1+9, 2+8, 3+7, 5+5, 10+0,
  ping 23–31 ms; queda do host detectada e sala removida da lista em 30 s.
- **App empacotado + central de produção + site** (cliente local apontando para a Supabase real): vincular com clique
  real, sala na lista pública, convidada entrando pelo `wss://`, segunda sala sem novo vínculo, Draft → OVNI → partida
  com as fases vindas do PC do host, e encerrar no meio da partida com aviso e lista limpa. Achados e corrigidos nessa
  rodada: sala fechada que ficava na lista até Atualizar, "Pedido já usado" no lugar de "Pedido expirado" (migration
  `0004`, aplicada e conferida em produção) e encerrar a partida de todos sem confirmação.

**Falta:** deploy do site (graao.vercel.app ainda é um build sem Supabase nem
hospedagem); e os bloqueios do dono do projeto — conta/zona Cloudflare para túneis gerenciados (hoje só túnel de
teste), local para publicar o instalador, assinatura de código, e o teste com **outro computador em outra rede** e
três PCs reais.

Detalhes: [arquitetura](hosting/GRAAO_HOST_ARCHITECTURE.md), [instalador](hosting/GRAAO_HOST_INSTALLER.md),
[vínculo](hosting/GRAAO_HOST_PAIRING.md), [ciclo de vida](hosting/GRAAO_HOST_LIFECYCLE.md),
[segurança](hosting/GRAAO_HOST_SECURITY.md), [túneis](hosting/GRAAO_HOST_TUNNELS.md),
[release](hosting/GRAAO_HOST_RELEASE.md), [relatório de testes](hosting/GRAAO_HOST_TEST_REPORT.md),
[descoberta de salas](networking/ROOM_DISCOVERY.md), [auditoria](networking/GRAAO_HOST_AUDIT.md).

## 2026-10-18 (afternoon) — Public rooms in the published build, and a background-tab fix

The published build has no dedicated server: whoever creates a room hosts it in their browser. Until now its room
browser could only say "Servidor indisponível", and creating a room needed a fallback button hidden in the form. Now:

- **Live room list for browser-hosted rooms.** Each public room's host announces the listing that its own
  authoritative `GraaoMatchRoom` publishes (Supabase Realtime Presence, channel `graao-rooms`); every viewer sees it
  update by itself. Supabase only relays the host's announcement. Seats, phase and admission stay with the host's room,
  which refuses full or started rooms. With `VITE_SERVER_URL` or `?server=`, the dedicated `/rooms` registry is used as
  before. Both sources go through the same `parseRoomListing` validator (humans + planned bots ≤ capacity ≤ 10).
  See [room browser](UX/ROOM_BROWSER.md).
- **Room browser:** columns (Sala · Participantes · Status · Ping), ten seat pips per row, ping shown as "—" (never
  estimated), unavailable rows that say why, empty state with "Criar a primeira sala", retry on failure.
- **Lobby:** each human slot draws a small bust from that player's real appearance, so a look saved in the lobby is
  visible to everyone. The sidebar lists Mapa, Modo, Capacidade, Bots desejados (host only) and Visibilidade.
- **Draft:** Portuguese title "Escolha suas habilidades", "Progresso: n de 4 selecionadas", "Supremo" wording, a
  "Trocar" button on the confirmed slot, avatars in the participant strip.
- **ESC:** "Opções" names what keeps running; in a match the exit reads "Sair da partida".
- **Fixed:** a player whose tab was in the background during the draft never acknowledged the match preparation
  (it waited for animation frames), holding everyone until the 45 s timeout. Also fixed: a lobby notice reappearing on
  the HUD over the next UFO ride.
- **Performance:** the decorative world is redrawn at most 4×/s behind the draft and loading card (GPU 259 → 25 ms
  per second measured on an RX 570) and 30×/s behind the room list and lobby. See [performance](UX/PERFORMANCE.md).

**Validation:** three browser tabs on the no-HMR client without a dedicated server covered create → list → join →
live row update → Ready → appearance change from the lobby → draft → preparation (with the guest in the background) →
UFO → landing → match → results → lobby → host leaves → row removed. Details in [verification](UX/VERIFICATION.md).
Customization was being changed by parallel work at the same time and was only exercised, not re-reviewed, here.
Automated: `tests/multiplayer.test.ts` had 36 failures at `916a753` (the warmup suites lacked `legacyWarmup: true`);
fixed, 49/49 alone. Full suite 264/277: the 13 failures are the in-progress spectator tests of parallel work (12) and
the real-time 60 Hz interpolation test under full-suite load (passes with its file alone). Typecheck, ESLint of the
changed files and build passed.

## 2026-10-18 — Pre-match redesign verified locally

The current competitive journey is **Menu → Rooms → Lobby → Ability Draft → Preparation → UFO → Drop → Combat →
Results → Lobby**. The menu, real room browser, host lobby, customization, settings and ability draft have been
reworked around that journey while preserving the spherical world, characters, animation rig, weapons, abilities,
UFO, loot, Tormenta, networking and existing Supabase persistence.

- Rooms hold **10 participants** in total, including up to **9 bots**. The lobby shows bots as planned seats;
  humans can replace those seats before the host explicitly starts the Draft. Ready alone does not start a match.
- `LOBBY`, `ABILITY_DRAFT` and `PREPARATION` avoid world/combat simulation and periodic snapshots. Preparation waits
  for the real human clients' loading acknowledgements before deployment. The host leaving closes the room.
- Public discovery uses the real Colyseus registry through `GET /rooms`. The existing private browser-hosted
  fallback is offered explicitly when signaling is configured; those rooms are not presented as public registry
  entries. Supabase signaling continues to negotiate those private connections, rather than inventing occupancy.
- The draft keeps all four personal slots visible, separates local preview from confirmation, and shows persistent
  ability details and participant status. The v2 catalog contains **30 basics + 10 ultimates**; each player selects
  three basics (at most one passive) and one ultimate. Exclusivity is always individual, with shared choices across
  players. Categories and viewport-aware pagination keep the catalogue on screen without scrolling.
- Customization returns to the menu or lobby it came from. Existing `ProfileService` cloud persistence and
  localStorage fallback are preserved. Changing appearance in the lobby clears that participant's Ready state.

**Validation:** build and typecheck passed. The complete suite passed with **219 tests across 24 files** using
`pnpm exec vitest run --configLoader native --pool threads --silent` (145.50 s). Two browser clients completed the
new flow locally; host departure and the hold-Tab match scoreboard were also checked. Main screens were checked at
1366×768, 1440×900 and 1920×1080; recorded layout measurements are in
[responsive-checks.json](UX/responsive-checks.json).

**Measured preparation cost:** in sequential local windows of approximately **8 seconds**, the preserved legacy
warmup with one human and nine instantiated bots produced **127 snapshots** (100,577 bytes of decoded JSON snapshot
payload); the new lobby with one human and nine planned bots produced **0 snapshots**. This measures server/network
preparation behavior, not browser FPS. Reproduction, samples and measurement limits are in
[PERFORMANCE.md](UX/PERFORMANCE.md) and [prematch-benchmark.json](UX/prematch-benchmark.json).

Implementation references: [pre-match flow](UX/PRE_MATCH_FLOW.md), [room discovery and private fallback](UX/ROOM_BROWSER.md),
[screen specifications](UX/SCREEN_SPECIFICATIONS.md) and [Ability Draft UX](UX/ABILITY_DRAFT.md).

Browser captures: [public room browser](UX/screenshots/room-browser-public.png),
[one human + nine bots lobby](UX/screenshots/lobby-1-human-9-bots-1366.png),
[customization](UX/screenshots/customization-1366.png), [draft round 1](UX/screenshots/draft-round1-1366.png),
[draft round 4](UX/screenshots/draft-round4-1366.png), [UFO after draft](UX/screenshots/ufo-after-draft.png) and
[Tab scoreboard](UX/screenshots/scoreboard-tab.png).

Public production deployment, testing on two external machines/networks and a real external Mixamo FBX clip remain
separate release checks; this update does not mark them complete.

Status values: TODO · IN_PROGRESS · TESTING · BLOCKED · DONE (DONE only after a test or a measured check).
Last update: 2026-10-18. Language: the game (UI, HUD, catalog, regions, weapons) is Portuguese (pt-BR); code and most
technical docs are English, while the redesign specifications in `docs/UX` are Portuguese.

## Gates

| Gate | What it proves | Status | Evidence |
|---|---|---|---|
| 1 · First visual | A customized graao character runs around a beautiful spherical world with Mixamo-compatible animation | TESTING | Built and seen in the browser (village, grass, houses, curved horizon, run/idle). Animation runs on `GRA_Rig_MixamoCompatible` via the retargeter (CC0 UAL clips). A real **Mixamo FBX** clip has not been loaded yet: no Mixamo animation files exist on this machine (see Blockers). |
| 2 · Two players | Two customized characters run smoothly around the same world in two windows | TESTING | Two browser tabs in one room saw each other with nameplates and their own outfits; integration tests (two SDK clients) pass: join by code, replication, uniform motion, 60 Hz interpolation replay. Not yet tested on LAN / two machines. |
| 3 · Shooting | A shoots B, server confirms, Shield/Health change, B dies, A wins | TESTING | Integration test "a complete 1v1 match (gate 3: A wins)" preserves the legacy development flow: ready → countdown (shots refused) → A's hitscan confirmed by the server → shield then health → elimination, no respawn in the match → RESULTS with winner A → warmup. Current competitive matches return to LOBBY, as covered by the pre-match flow tests. Earlier browser evidence (two tabs, own server on 2568): 17 predicted shots, 10 server-confirmed hits, 200 damage, elimination logged by the server, match end with winner; HUD, shield-break VFX, countdown and aim pose seen. Not yet played on two external machines. |
| 4 · Abilities | Guns and magic | TESTING | 30 basics + 10 Supremos, with server-authoritative movement, control, defense, information and automatic passives. Final focused regression: 158/158 tests, two independent SDK clients, legal ten-seat builds and bot casts. Browser Draft/OVNI/MATCH and responsive captures verified. Per-spell manual presentation/audio and play across machines remain pending; see the [v2 validation](qa/ABILITY_V2_VALIDATION_2026-10-19.md). |
| 5 · Creator | Two visibly different avatars seen correctly by each other | TESTING | Full customization screen with category options, instant parts/colors, drag/zoom, explicit save and return to the menu or lobby origin. Appearance replicates on join and change; changing it in the lobby clears Ready. Existing `ProfileService` implements anonymous sign-in, `profiles` name/look/settings and own-row RLS, with localStorage fallback. The redesign preserves that implementation; live authenticated cloud-profile validation remains a separate check. See [screen specifications](UX/SCREEN_SPECIFICATIONS.md). |
| 6 · Draft | Players enter with drafted abilities | TESTING | 30+10 catalogue, individual exclusivity, max one passive, hidden picks, timeout and valid ownership tested. Preview → confirmation, persistent 3+1 slots, categories, paginated details and ten participants verified at 1366×768, 390×844 and 844×390. SDK integration completes 1+9 and 2+8 compositions. See [v2 validation](qa/ABILITY_V2_VALIDATION_2026-10-19.md). |
| 7 · UFO | Lobby → draft → preparation → UFO → drop → combat as one flow | TESTING | Existing UFO integration covers route, jump window, shared dive timing, landing, combat gating and departure. New pre-match integration covers the host's explicit start and every human's preparation ACK before UFO. Two browser clients exercised the complete local flow; [UFO after draft](UX/screenshots/ufo-after-draft.png). Earlier deployment measurements and detailed mechanics remain in `docs/gameplay/UFO_DEPLOYMENT.md`. External two-machine testing remains pending. |
| 8 · Complete match | Victory/Defeat/Lobby/summary | TESTING | Integration test "a complete match loop (gate 8)" passes: elimination → the same server-counted `MATCH_SUMMARY` for both (shots, hits and damage equal to the server's own events, placements, room score) → persisted once with the verified identity only (a forged token plays as a guest; only the signed-in player gets MATCH_SAVED) → RETURN_LOBBY waits for everyone, then returns at once with the room score kept. In the browser against the network bot (own server on 2570 with Supabase): lobby panel → ready → draft → UFO → landing → elimination → results card after 1.4 s (VITÓRIA!, 1:25, per-player table with loadout icons, "Placar da sala Luiz 1 × Beto 0") → VOLTAR AO LOBBY ("Esperando Beto (1/2)") → back in the lobby the moment the bot asked, ♛ 1 kept; both matches stored in Supabase (`matches` + `match_players`). Signed-in history not exercised live (anonymous sign-ins off). Not yet played person vs person on two machines. |
| 9 · Public deploy | Public URL works | TODO | |
| 10 · External test | Two PCs, two networks | TODO | |

## Systems

| System | Status | Notes |
|---|---|---|
| Monorepo (pnpm, TS strict, Vite, Vitest, ESLint) | DONE | Build and typecheck passed; complete suite: 219 tests in 24 files via `pnpm exec vitest run --configLoader native --pool threads --silent`. Test files run sequentially (`fileParallelism: false`) to avoid starving real-time integration with world-generation work. Timing-sensitive interpolation assertions were preserved. |
| Spherical world (terrain, features, layout, colliders) | DONE | Deterministic; identical on client/server (tested). Spawn points are kept free of props (tested with a capsule overlap query) |
| GraaoSphericalCharacterController | DONE | Radial gravity, Rapier KCC with per-step up; full-lap test passes |
| Third-person camera on the sphere | DONE | Transported heading, terrain pull-in, aim FOV/shoulder, recoil kick and shake (always full for every player) |
| Camera obstruction dissolve | TESTING | Implemented (Rapier ray queries → per-instance dither fade); needs a visual pass behind houses |
| GRA_Rig_MixamoCompatible + MixamoBoneMap | DONE | 55 bones; normalizer handles `mixamorig:` variants and UE/UAL names |
| Retargeter | DONE | Bone directions preserved within 4° (test) |
| Mixamo FBX loader | TESTING | Code path exists (manifest + FBXLoader + same retargeter); needs a real Mixamo clip |
| Modular character (body, 3 faces, 4 hair, 4 tops, 4 bottoms, 3 shoes, 3 accessories, palettes) | DONE | One merged skinned mesh per character, ≈ 10 k triangles |
| Character creator UI | DONE | Full customization screen, instant switches, save/discard and return to menu/lobby. Existing Supabase `ProfileService` persistence and localStorage fallback preserved; live authenticated cloud-profile check remains separate. |
| GRAStylizedMaterial family | DONE | world / terrain / foliage / character + outline |
| Sky, sun rig, water, grass | DONE | Local golden-hour sun; grass bends around the local player |
| F3 dev overlay | DONE | FPS, frame ms, draw calls, triangles, character and weapon cost, active VFX, ping, KB/s, snapshot size, server tick; since 2026-10-19 also creeps, world colliders, bots, connection drops and JS heap |
| Colyseus room, codes, prediction, reconciliation, interpolation | DONE | Tested (integration) |
| Weapons (Raio de Sol, Rajada de Pétalas), server hitscan, ammo, reload, switch | TESTING | Server rules tested; client prediction reconciles ammo by FIRE sequence (`shotSeq`); code-authored models on the hand bone |
| Match flow (lobby → host start → draft → preparation → UFO → drop → combat → results → lobby) | TESTING | New competitive flow and legacy development path are integration-tested. Current flow waits for all human loading ACKs, freezes the roster on host start and closes on host departure. Two browser clients completed the local flow. See [pre-match flow](UX/PRE_MATCH_FLOW.md). |
| Public room browser (dedicated `/rooms` and live list of browser-hosted rooms) | TESTING | Dedicated: real Colyseus `/rooms` registry. Published build: each public hosted room announces its own room's listing (Presence); the host's room still admits or refuses. One validator for both (10 total seats). Three browser tabs verified create/see/join/update/remove locally; two real machines and networks not yet. See [room browser](UX/ROOM_BROWSER.md). |
| Lobby, planned bots and loading preparation | DONE | Host controls 0–9 bots and explicit start; all humans Ready; no combat bots or periodic snapshots in the lobby. Two-client browser validation plus occupancy, concurrent joins, preparation ACK/failure/timeout and host-exit integration tests. |
| Combat HUD (vitals, weapons, reticles, hitmarkers by kind, damage numbers and direction, kill feed, banners, death, results) | TESTING | DOM/CSS/SVG; seen in the browser |
| GRAVFXSystem (beams + particles, 2 draw calls) | TESTING | Tracers, flashes, impacts, shield shards/ring, elimination burst |
| GRAAudioManager (synthesized cues, buses, voice limits, LOW_HEALTH / POST_MATCH states) | TESTING | Audible check by a person still pending |
| GRAAbilitySystem + Ultimate Marks | TESTING | See `docs/architecture/ABILITY_SYSTEM.md` |
| Ability Draft (rules, server, screen) | TESTING | [UX](UX/ABILITY_DRAFT.md), [server rules/protocol](gameplay/ABILITY_DRAFT.md); preview/confirmation, 3+1 build from 30+10, max one passive and individual exclusivity. Categories/pagination adapt to short screens. Server bots draft and cast their own builds. [Validation](qa/ABILITY_V2_VALIDATION_2026-10-19.md). |
| Camera obstruction near the camera | DONE | Props within 1.1 m of the camera fade (Rapier ball query), measured: 0.9 m → fades, 3 m → not |
| UFO deployment (route, ride, jump, skydive, landing, reveal) | TESTING | Shared `deploy.ts` (9 unit tests) + room UFO phase (5 integration tests); client `DeployDirector`, code-authored `UfoModel`, dotted route, landmark labels, speed lines, orbit sky by altitude. Measured: reveal 79 draw calls / 313 k tris |
| Tormenta (shrinking safe region: server phases and damage, world pigment, curtain, audio, HUD card, planet map) | TESTING | Shared `tormenta.ts` (9 unit tests: geodesic inside/outside, nesting, walkable final, reachability, one pulse per interval) + integration test with two players on opposite sides of the planet (only the one outside is hurt, Health only; death by the Tormenta hands the win). In the browser against the network bot: card, map, way back, bleached world, `INSIDE_TORMENTA`, "ELIMINADO · pela Tormenta", DERROTA for the one outside; client and server flip inside/outside 50 ms apart. Measured: +0.02 ms GPU inside, +0.33 ms on the boundary, ≤ +0.25 ms fully outside at ≈ 2 MPx (RX 570). See `docs/gameplay/TORMENTA.md` |
| Supabase (project `graao`, schema + RLS, server verification of tokens, `record_match`, `my_matches`) | TESTING | Migrations in `packages/database/migrations`; `record_match` checked live (wrong secret → 401, right secret → stored); token verifier unit-tested with ES256 keys (tampered, foreign, expired, wrong issuer/audience refused; JWKS cached). See `docs/infrastructure/SUPABASE.md` |
| MatchLedger + results screen + lobby panel + menu history | TESTING | `match.test.ts` (placements, ties, leavers, server counts); `ResultsScreen`, `LobbyPanel`, `HistoryPanel` seen in the browser (history needs a cloud profile) |
| R2, deploy | TODO | Credentials needed (see Blockers) |

## Known gaps

- Hit registration has no lag compensation (rewind): at high ping, shots at fast-moving targets may miss on the server
  although the client predicted a hit (the hitmarker only appears on confirmation, so feedback stays honest).
- Nameplates hide behind walls and the planet's curve (line-of-sight ray per remote per frame).
- Technical docs are mostly English; the game and the new UX specifications are Portuguese.

## Blockers / needs from the user

1. **Mixamo clips** — to prove a real Mixamo animation on the graao skeleton, download a few clips from mixamo.com
   (FBX, *Without Skin*, *In Place* ticked): Idle, Running, Jumping, Rifle Aiming Idle, Firing Rifle, Reloading, Hit
   Reaction, Dying. Put them in `apps/client/public/assets/v1/animations/mixamo/` with a `manifest.json` such as
   `{ "idle": "Idle.fbx", "run": "Running.fbx" }`. They override the CC0 clips automatically.
2. **Live Supabase profile check** — cloud profile persistence already exists. The last recorded environment check
   had anonymous sign-ins disabled; this redesign did not change that project setting or repeat live authenticated
   persistence validation. Confirm **Allow anonymous sign-ins** in the project's authentication settings for that
   check. Without a cloud session, appearance/settings keep using localStorage and players join as guests.
3. **Cloudflare R2 bucket + Pages** and a Node host for the public deploy (credentials).
