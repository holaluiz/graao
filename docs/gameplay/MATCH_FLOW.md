# Match flow

Target journey: menu → create/join by code → character creator → ability draft → UFO → drop → match → results → lobby.

| Phase | Server `MatchPhase` | Status |
|---|---|---|
| Warmup in the world (free roam, practice damage, respawn after 4 s) | `FREE_ROAM` | TESTING |
| Ready check: every connected player presses ENTER (≥ 2 players) | `FREE_ROAM` + `ready` | TESTING |
| Ability draft: 4 simultaneous rounds (3 basics + 1 Ultimate), the drafted loadouts replace the warmup ones | `ABILITY_DRAFT` | TESTING |
| UFO deployment: reveal, ride, jump inside the window (or dropped at the close), skydive, landing; nobody can fight | `UFO` | TESTING |
| Match: everyone down → fight where they landed, 3 s countdown with weapons locked, no respawns | `MATCH` | TESTING |
| Results: winner (last standing), the server's summary for everyone, up to 20 s | `RESULTS` | TESTING |
| Return to lobby: everyone asks (VOLTAR AO LOBBY / ENTER) or the timer ends; the room's score (`wins`) carries on | `RESULTS` → `FREE_ROAM` | TESTING |
| Match summary persisted once (Supabase `record_match`), history in the menu | — | TESTING (guests; signed-in players need anonymous sign-in on) |

Rules live in `@graao/game-core/match.ts` (`everyoneReady`, `decideMatch`, `MATCH_RULES`) and `draft.ts` (`AbilityDraft`,
see `ABILITY_DRAFT.md`) and are unit-tested; the
room (`GraaoMatchRoom`) applies them. `ROOM_STATE` carries `phase`, `startsAt` (weapons unlock), `phaseEndsAt`
(results end), `winner` and per-player `ready`, `inMatch`, `kills`, `deaths`.

- Rooms created with `skipDraft` (dev/tests) go from READY straight to the UFO with the warmup loadouts; `skipUfo`
  skips the deployment (the match starts on the spread spawns below). The UFO itself: `UFO_DEPLOYMENT.md`.
- An opponent leaving during the deployment hands the win to whoever is still there, like during the match.
- Without the UFO (`skipUfo`), match spawns (`MATCH_SPAWNS`) sit ≈ 50 m apart around Lantern Village, below each
  other's horizon, so the first seconds are about finding the opponent. Rooms created with `closeSpawns` (tests) use the free-roam spawns instead.
- An opponent leaving during a match hands the win to whoever is still standing; nobody standing is a draw.
- The client (`CombatDirector`) maps phases to presentation: status chip ("AQUECIMENTO · ENTER quando estiver
  pronto (1/2)"), countdown banner ("3 · Prepare-se" → "LUTEM!"), elimination screen, audio state POST_MATCH.
- Between matches, with the pointer free, the **lobby panel** (`LobbyPanel`): the room code (copy), everyone with
  their ready state and room wins (♛), ESTOU PRONTO / CANCELAR, VOLTAR AO MUNDO, SAIR DA SALA.
- After a match the final blow plays for 1.4 s, then the **results screen** (`ResultsScreen`, from `MATCH_SUMMARY`):
  VITÓRIA! / DERROTA / EMPATE (words, crown and placement marks, not only color), duration, every participant's
  line (eliminations, damage dealt and taken, accuracy, spells, drafted loadout icons), the room score, whether the
  match reached the player's history, VOLTAR AO LOBBY ("Esperando Beto (1/2)") and SAIR DA SALA. The pointer is
  released for the buttons.
- Placement: the winner first, then by how long each lasted; players knocked out at the same moment (or a draw)
  share a placement; leavers count as out when they left (`MatchLedger` in `match.ts`).

The server owns phases and timers; the client HUD director maps them to presentation (visible UI, audio state, camera
context, attention priorities, music). Transitions use paper/pigment reveals, never a black fade.
