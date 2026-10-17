# Match flow

Target journey: menu → create/join by code → character creator → ability draft → UFO → drop → match → results → lobby.

| Phase | Server `MatchPhase` | Status |
|---|---|---|
| Warmup in the world (free roam, practice damage, respawn after 4 s) | `FREE_ROAM` | TESTING |
| Ready check: every connected player presses ENTER (≥ 2 players) | `FREE_ROAM` + `ready` | TESTING |
| Ability draft: 4 simultaneous rounds (3 basics + 1 Ultimate), the drafted loadouts replace the warmup ones | `ABILITY_DRAFT` | TESTING |
| Match: spread spawns facing the arena, 3 s countdown with weapons locked, no respawns | `MATCH` | TESTING |
| Results: winner (last standing), 9 s, then back to warmup | `RESULTS` | TESTING |
| UFO deployment | `UFO` | TODO |
| Return to lobby / match summary persisted (Supabase) | — | TODO |

Rules live in `@graao/game-core/match.ts` (`everyoneReady`, `decideMatch`, `MATCH_RULES`) and `draft.ts` (`AbilityDraft`,
see `ABILITY_DRAFT.md`) and are unit-tested; the
room (`GraaoMatchRoom`) applies them. `ROOM_STATE` carries `phase`, `startsAt` (weapons unlock), `phaseEndsAt`
(results end), `winner` and per-player `ready`, `inMatch`, `kills`, `deaths`.

- Rooms created with `skipDraft` (dev/tests) go from READY straight to the match with the warmup loadouts.
- Match spawns (`MATCH_SPAWNS`) sit ≈ 50 m apart around Lantern Village, below each other's horizon, so the first
  seconds are about finding the opponent. Rooms created with `closeSpawns` (tests) use the free-roam spawns instead.
- An opponent leaving during a match hands the win to whoever is still standing; nobody standing is a draw.
- The client (`CombatDirector`) maps phases to presentation: status chip ("AQUECIMENTO · ENTER quando estiver
  pronto (1/2)"), countdown banner ("3 · Prepare-se" → "LUTEM!"), elimination screen, results panel ("VITÓRIA!" /
  "DERROTA" / "EMPATE" with eliminations, damage and accuracy), audio state POST_MATCH.

The server owns phases and timers; the client HUD director maps them to presentation (visible UI, audio state, camera
context, attention priorities, music). Transitions use paper/pigment reveals, never a black fade.
