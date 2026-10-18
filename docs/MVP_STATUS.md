# graao MVP status

Status values: TODO · IN_PROGRESS · TESTING · BLOCKED · DONE (DONE only after a test or a measured check).
Last update: 2026-10-17. Language: the game (UI, HUD, catalog, regions, weapons) is Portuguese (pt-BR); code and these
docs stay in English.

## Gates

| Gate | What it proves | Status | Evidence |
|---|---|---|---|
| 1 · First visual | A customized graao character runs around a beautiful spherical world with Mixamo-compatible animation | TESTING | Built and seen in the browser (village, grass, houses, curved horizon, run/idle). Animation runs on `GRA_Rig_MixamoCompatible` via the retargeter (CC0 UAL clips). A real **Mixamo FBX** clip has not been loaded yet: no Mixamo animation files exist on this machine (see Blockers). |
| 2 · Two players | Two customized characters run smoothly around the same world in two windows | TESTING | Two browser tabs in one room saw each other with nameplates and their own outfits; integration tests (two SDK clients) pass: join by code, replication, uniform motion, 60 Hz interpolation replay. Not yet tested on LAN / two machines. |
| 3 · Shooting | A shoots B, server confirms, Shield/Health change, B dies, A wins | TESTING | Integration test "a complete 1v1 match (gate 3: A wins)" passes: ready → countdown (shots refused) → A's hitscan confirmed by the server → shield then health → elimination, no respawn in the match → RESULTS with winner A → warmup. In the browser (two tabs, own server on 2568): 17 predicted shots, 10 server-confirmed hits, 200 damage, elimination logged by the server, match end with winner; HUD, shield-break VFX, countdown and aim pose seen. Not yet played on two machines. |
| 4 · Abilities | Guns and magic | TESTING | 8 basics + 3 Ultimates from 8 primitives, executed by the server's GRAAbilitySystem. Integration test "abilities through the authoritative server" passes (ownership, phase, cooldown, Mana, server projectile hit, areas with warning → damage, slow, knockback, elimination by abilities only → A wins). In the browser against a bot: Orbe Solar hit confirmed (hitmarker with ability diamonds), Mana/cooldown sweep, Explosão de Pólen and Meteoro Solar ground warnings, Ultimate Marks on both players. Not yet played person vs person on two machines. |
| 5 · Creator | Two visibly different avatars seen correctly by each other | TESTING | Creator UI works (tabs, instant parts/colors, drag/zoom); appearance replicates on join and on change. Cloud persistence written (`ProfileService`: anonymous sign-in, `profiles` row with name, look and settings, RLS own-row) but not exercised live yet: anonymous sign-ins are still off in the Supabase project (see Blockers); localStorage meanwhile. |
| 6 · Draft | Players enter with drafted abilities | TESTING | `AbilityDraft` rules unit-tested (7 tests); integration test "ability draft through the authoritative server" passes (hidden picks, a disputed ability kept by priority and the loser repicking, a timeout pick, the match starting with the drafted loadouts, ownership enforced). In the browser against the bot: READY → draft screen → picks by click, server picks on timeout, reveal → match with the drafted loadout in the HUD and the drafted Ultimate's mark. Not yet drafted person vs person. |
| 7 · UFO | Creator → draft → UFO → drop → combat as one flow | TESTING | Integration test "UFO deployment through the authoritative server (gate 7)" passes: READY boards both onto the UFO (route over the arena, riders not simulated, no fighting), a jump before the hatch opens is refused, A's jump starts exactly at the shared `diveStart(route, t)`, A dives under its own control and lands, B is dropped at the close and lands, the match starts where they landed, an opponent leaving mid-deployment hands the win. In the browser against the network bot (own server on 2569): READY → draft → world reveal → ride → jump → skydive (reconciliation error 0.1 cm) → landing → bot dropped and landed → countdown → fight, all seen; solo starts with the same ritual. Not yet played person vs person on two machines. See `docs/gameplay/UFO_DEPLOYMENT.md`. |
| 8 · Complete match | Victory/Defeat/Lobby/summary | TESTING | Integration test "a complete match loop (gate 8)" passes: elimination → the same server-counted `MATCH_SUMMARY` for both (shots, hits and damage equal to the server's own events, placements, room score) → persisted once with the verified identity only (a forged token plays as a guest; only the signed-in player gets MATCH_SAVED) → RETURN_LOBBY waits for everyone, then returns at once with the room score kept. In the browser against the network bot (own server on 2570 with Supabase): lobby panel → ready → draft → UFO → landing → elimination → results card after 1.4 s (VITÓRIA!, 1:25, per-player table with loadout icons, "Placar da sala Luiz 1 × Beto 0") → VOLTAR AO LOBBY ("Esperando Beto (1/2)") → back in the lobby the moment the bot asked, ♛ 1 kept; both matches stored in Supabase (`matches` + `match_players`). Signed-in history not exercised live (anonymous sign-ins off). Not yet played person vs person on two machines. |
| 9 · Public deploy | Public URL works | TODO | |
| 10 · External test | Two PCs, two networks | TODO | |

## Systems

| System | Status | Notes |
|---|---|---|
| Monorepo (pnpm, TS strict, Vite, Vitest, ESLint) | DONE | `pnpm dev / build / test / lint / typecheck` pass; 132 tests (the 60 Hz interpolation smoothness test is timing-sensitive and can fail under heavy machine load; it passes when rerun). Test files run sequentially (`fileParallelism: false`) so the real-time integration suite is not starved by world generation in parallel workers |
| Spherical world (terrain, features, layout, colliders) | DONE | Deterministic; identical on client/server (tested). Spawn points are kept free of props (tested with a capsule overlap query) |
| GraaoSphericalCharacterController | DONE | Radial gravity, Rapier KCC with per-step up; full-lap test passes |
| Third-person camera on the sphere | DONE | Transported heading, terrain pull-in, aim FOV/shoulder, recoil kick and shake (always full for every player) |
| Camera obstruction dissolve | TESTING | Implemented (Rapier ray queries → per-instance dither fade); needs a visual pass behind houses |
| GRA_Rig_MixamoCompatible + MixamoBoneMap | DONE | 55 bones; normalizer handles `mixamorig:` variants and UE/UAL names |
| Retargeter | DONE | Bone directions preserved within 4° (test) |
| Mixamo FBX loader | TESTING | Code path exists (manifest + FBXLoader + same retargeter); needs a real Mixamo clip |
| Modular character (body, 3 faces, 4 hair, 4 tops, 4 bottoms, 3 shoes, 3 accessories, palettes) | DONE | One merged skinned mesh per character, ≈ 10 k triangles |
| Character creator UI | DONE | Instant switches; Supabase persistence TODO |
| GRAStylizedMaterial family | DONE | world / terrain / foliage / character + outline |
| Sky, sun rig, water, grass | DONE | Local golden-hour sun; grass bends around the local player |
| F3 dev overlay | DONE | FPS, frame ms, draw calls, triangles, character and weapon cost, active VFX, ping, KB/s, snapshot size, server tick |
| Colyseus room, codes, prediction, reconciliation, interpolation | DONE | Tested (integration) |
| Weapons (Raio de Sol, Rajada de Pétalas), server hitscan, ammo, reload, switch | TESTING | Server rules tested; client prediction reconciles ammo by FIRE sequence (`shotSeq`); code-authored models on the hand bone |
| Match flow (warmup → ready → countdown → match → results → warmup) | TESTING | `match.ts` rules unit-tested; full flow integration-tested |
| Combat HUD (vitals, weapons, reticles, hitmarkers by kind, damage numbers and direction, kill feed, banners, death, results) | TESTING | DOM/CSS/SVG; seen in the browser |
| GRAVFXSystem (beams + particles, 2 draw calls) | TESTING | Tracers, flashes, impacts, shield shards/ring, elimination burst |
| GRAAudioManager (synthesized cues, buses, voice limits, LOW_HEALTH / POST_MATCH states) | TESTING | Audible check by a person still pending |
| GRAAbilitySystem + Ultimate Marks | TESTING | See `docs/architecture/ABILITY_SYSTEM.md` |
| Ability Draft (rules, server, screen) | TESTING | See `docs/gameplay/ABILITY_DRAFT.md`; the network bot drafts too (`--ready`, `--pick`) |
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
- Docs are English; only the game is Portuguese.

## Blockers / needs from the user

1. **Mixamo clips** — to prove a real Mixamo animation on the graao skeleton, download a few clips from mixamo.com
   (FBX, *Without Skin*, *In Place* ticked): Idle, Running, Jumping, Rifle Aiming Idle, Firing Rifle, Reloading, Hit
   Reaction, Dying. Put them in `apps/client/public/assets/v1/animations/mixamo/` with a `manifest.json` such as
   `{ "idle": "Idle.fbx", "run": "Running.fbx" }`. They override the CC0 clips automatically.
2. **Supabase anonymous sign-ins** — in the Supabase dashboard, project *graao* → *Authentication* → *Sign In /
   Providers* → turn on **Allow anonymous sign-ins**. Until then every player is a guest (matches are still recorded).
3. **Cloudflare R2 bucket + Pages** and a Node host for the public deploy (credentials).
