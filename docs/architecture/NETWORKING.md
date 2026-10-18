# Networking

Who runs the room: by default the player who creates it, in their browser (`BROWSER_HOSTED_ROOMS.md`: same room code,
WebRTC data channels instead of WebSockets, same messages); with `?server=` or `VITE_SERVER_URL`, a dedicated server.

Colyseus 0.18 room `graao_match` per match; room ids are human codes `GR-XXXX` (no 0/O/1/I/L). Browser clients are
untrusted: they send **intent** only. Typed protocol in `packages/shared/src/protocol.ts` (numeric message ids).

## Flow

```
client                                  server (GraaoMatchRoom, 20 Hz)
create / joinById(code, JoinOptions) ─► onAuth: Supabase token (optional) → verified user id or guest
                                        onJoin: protocol check, appearance validation, spawn
                       ◄─ WELCOME {you, index, code, serverTime, tickHz, spawn}
                       ◄─ ROOM_STATE {phase, startsAt, phaseEndsAt, winner, players[name, appearance, ready,
                                       inMatch, kills, deaths]}   (reliable, on change)
PLAYER_INPUT {i: [seq, wish×127 ×3, aim×1000 ×3, buttons]…} every ~33 ms
                                        queue → steady consumption → CharacterMotor.step per command
                       ◄─ SNAPSHOT {t, k, p: PlayerSnap[]}  20 Hz broadcast (~46 B / player)
PING {c} 1 Hz          ◄─ PONG {c, t, tick}  (RTT, clock offset, server tick cost)
APPEARANCE_UPDATE      ─► validated against the catalog, rebroadcast in ROOM_STATE
READY {r}              ─► warmup only; everyone ready (≥ 2) starts the match
FIRE {s, w, o, d, a}   ─► validated (phase, slot, seq, fire rate, ammo, origin near head) → hitscan → damage
RELOAD / SWITCH_WEAPON ─► validated
UFO_JUMP {}            ─► UFO phase, aboard, inside the jump window → the dive starts on the server
                       ◄─ MATCH_SUMMARY {code, winner, startedAt, endedAt, durationMs, players[placement, kills,
                                         damage dealt/taken, shots, hits, spells, loadout, left]}   (once, at the end)
RETURN_LOBBY {}        ─► RESULTS only; everyone asked (or the timer) → back to the warmup lobby
                       ◄─ NOTICE {kind, code: MATCH_SAVED, text}  (private: the match reached your history)
                       ◄─ EVENTS {t, ev: shot | dmg | elim | respawn | reload | cast | proj | projEnd | area | fx
                                  | jump | land}   (broadcast per tick when any)
                       ◄─ SELF {weapon, ammo[], reloading, reloadEndsAt, alive, respawnAt, shotSeq}  (private, on change)
```

Protocol version 2 (0.2.0): adds READY, match fields in ROOM_STATE and `shotSeq` in SELF. Clients on version 1 are
refused with `VERSION_MISMATCH`.

Protocol version 5 (0.5.0): the UFO deployment. ROOM_STATE gains `ufo` (the ship's route, integers only, null outside
the UFO phase) and a per-player `deploy` state (NONE / SHIP / DIVING / LANDED); snapshot flags gain ON_SHIP and DIVING;
`UFO_JUMP` (no payload: the server decides when and from where); events `jump {target, at mm, v cm/s, auto}` — the
exact start of the dive the server simulates, which the jumper's client predicts from — and
`land {target, at, water}`. Riders are not simulated: their commands are acknowledged and dropped (see
`docs/gameplay/UFO_DEPLOYMENT.md`).

Protocol version 6 (0.6.0): the complete match loop. `MATCH_SUMMARY` (the server's MatchLedger: every number is its
own count, never a client's claim), `RETURN_LOBBY` (a vote during RESULTS), ROOM_STATE players gain `wins` (the
room's running score) and `back` (asked to return), `NOTICE` `MATCH_SAVED`. `JoinOptions.token` carries the
Supabase access token; the server verifies it (JWKS, ES256) and keeps only the user id — identity never comes from
what a client says about itself.

## Authority and anti-abuse

- Movement: one command = one fixed 1/60 s step of the shared controller. A per-player **budget** refills at 60/s of
  real time (cap 12), so a client cannot move faster than real time; out-of-order/duplicate sequence numbers are
  dropped; the wish vector is re-projected and clamped by the server.
- Colyseus `maxMessagesPerSecond = 90`; every payload goes through a validator (`validate.ts`).
- Appearance ids must exist in the catalog; names are sanitized (NFKC, letters/digits/space/`_.-`, ≤ 16).
- Protocol mismatch → `VERSION_MISMATCH` join error.

## Local prediction and reconciliation (`game/LocalPlayer.ts`)

The local player simulates every command immediately and keeps it until acknowledged. Each snapshot carries the
player's last processed `seq`; the client resets to the authoritative state, rebuilds input edge state from the last
acknowledged command, replays pending commands, and decays any visual error (snaps only above 4 m).

## Remote interpolation (`net/SnapshotInterpolator.ts`)

Each player is simulated in whole 1/60 s commands, so a snapshot's wall time does not match how far that player has
been simulated. Snapshots therefore carry `simDt`: the offset of the player's own simulation clock. Remotes interpolate
on that clock, `70 ms` (`INTERPOLATION_DELAY_MS`) behind the **measured** arrival lag of that player's samples
(adapts quickly upward, slowly downward). The server keeps a 2-command jitter buffer per player for steady
consumption. Measured: 0.5 % extrapolated frames in a 60 Hz replay of real arrivals.

## Snapshot tuple

`[index, px, py, pz (mm), vx, vy, vz (cm/s), fx, fy, fz (×127), aimPitch (×100 rad), moveState, actionState, flags,
ackSeq, health, shield, mana, weapon, simDt]` — flags: grounded, alive, aiming, aboard the UFO, diving.

## Testing

`tests/multiplayer.test.ts` runs the real server in-process with two SDK clients: create/join by code, replication,
real-time speed bound, protocol rejection, full room, velocity consistency, 60 Hz interpolation replay, leave, combat
(shield-first damage, fire-rate and origin validation, elimination and respawn) and a complete 1v1 match.
`pnpm bot -- --code GR-XXXX --pattern circle` drives a remote player for manual checks.
Latency simulation: `SIMULATE_LATENCY_MS=80 pnpm dev:server`. LAN / two-machine / two-network tests: TODO.
