# Browser-hosted rooms (the player who creates the match is the server)

Default online mode: no match server to deploy. Whoever presses **Criar sala** runs the match room in their own
browser; friends join from the room list or with the room code and connect straight to that browser (WebRTC).
**Jogar solo** with bots runs the same way, offline. A dedicated Colyseus server is still supported (`?server=ws://…`,
or a build with `VITE_SERVER_URL`): tests, the network bot (`pnpm bot`) and measurements use it.

Since 2026-10-19 this is the only hosting the published site offers (ADR-006 in
[MASTER_GAME_DESIGN_2.md](../product/MASTER_GAME_DESIGN_2.md#decisões-adrs-curtos)). Graao Host (a desktop app that runs
the room on the host's PC, [docs/hosting](../hosting/GRAAO_HOST_ARCHITECTURE.md)) stays in the code, off unless the
build sets `VITE_GRAAO_HOST=on` (`hostApiConfigured()` in `apps/client/src/net/graaoHost/hostSite.ts`).

## Pieces

| Piece | Where | What it does |
|---|---|---|
| `GraaoMatchRoom` | `apps/server/src/rooms` | The room, **unchanged**: the same rules, bots, draft, UFO, Tormenta and loot as on a server |
| `colyseusShim.ts` | `apps/client/src/net/host` | Stand-in for `@colyseus/core` (auth → join, seat limit, leave vs drop → reconnection, simulation interval, broadcast). Swapped in by `vite.config.ts` only for imports made from `apps/server` |
| `HostRoomDriver.ts` + `host.worker.ts` | same | Run one room in a **Web Worker**, driven by `ToRoom` / `FromRoom` messages (`hostProtocol.ts`) |
| `RoomHost.ts` | same | Host page: starts the worker, claims the code, seats the host's own player in-page (`LocalLink`), answers guests (`HostPeer`, one data channel each), fans room messages out (encoded once per broadcast) |
| `PeerLink.ts` | same | Guest: finds the host by code, opens the data channel, asks for a seat, reconnects with its session token |
| `signaling.ts` | same | Supabase Realtime broadcast channel `graao-room:<code>`: only the offer/answer exchange |
| `roomDirectory.ts` | same | Public room list: each public room's host announces the metadata its own room publishes (Presence on `graao-rooms`); the room browser shows the live set. A notice board, not an authority: the host's room still accepts or refuses every join |
| `wire.ts` | same | ICE servers, waiting for candidates (no trickle), JSON framing, splitting frames over 60 KB, snapshot backpressure |
| `RoomLink.ts` | `apps/client/src/net` | What `NetSession` needs from a connection; a Colyseus `Room` fits it as is |

## Flow

```
host page                     worker (room)              signaling (Supabase)          guest page
Criar partida ──create──────► onCreate → code
              ◄─created(code)
subscribe graao-room:CODE ───────────────────────────►  probe → nobody answers "taken"
LocalLink ────join(host)────► onAuth/onJoin → WELCOME…
                                                      ◄── knock ─────────────────────── Entrar (code)
                              ─────────────────────────── here ──────────────────────►
                                                      ◄── offer (SDP, all candidates) ─
answer ────────────────────────────────────────────────── answer ────────────────────►
data channel open ◄═══════════════════════════════════════════════════════════════════► ["join", JoinOptions]
HostPeer ───join(sid)───────► onJoin → WELCOME, SELF, ROOM_STATE ═══════════════════► (kept until handlers exist)
         ═══ ["ok", {sid, token}] ═══════════════════════════════════════════════════►
inputs, fire, ready… ◄═══ [type, payload] ════════════════════════════════════════════ NetSession as usual
```

- The worker keeps ticking when the host's tab is in the background (pages throttle their own timers there, workers
  do not); the host's own character just stands still meanwhile. Measured: the room tick kept its pace with the host
  tab hidden while a guest played.
- A guest's connection that dies (or stays "disconnected" for 4 s) is a **drop**: the room holds the seat for
  `RECONNECT_SECONDS` while `PeerLink` signals again and sends `["rejoin", {sid, token}]`; only the right token takes
  the seat back. Measured: back in 0.9 s, same seat (0.3 s on 2026-10-20). Every attempt is cut at the end of the
  window (one second early), so a negotiation that never answers ends in `FAILED` at ≈ 19 s instead of keeping
  "reconectando…" up; a room that says the seat is gone ends it as `REFUSED`. The link's state
  (`SIGNALING → CONNECTING → CONNECTED ⇄ RECONNECTING → FAILED/CLOSED`, table in `RoomLink.ts`) and the ICE route of
  the selected candidate pair (`direta`, `STUN`, `relay`) show in F3 and in the console.
- The **host leaving** (SAIR DA SALA, closing or reloading the tab) closes the room: guests get `["bye", 4100]` →
  "Quem criou a sala saiu: a sala fechou." There is no host migration.
- A code another host already answers for (very rare) makes the host rebuild the room with a new code.
- Version: guests send `protocol`; a different build is refused (VERSION_MISMATCH) with "recarreguem a página".

## Trade-offs (accepted)

- **Trust:** the host runs the authoritative room, so the host could cheat; fine among friends. Everyone joins as a
  guest (no identity tokens leave a browser) and **nothing is saved to the history**: results can only be written by
  a server that holds the secret.
- **Connectivity:** STUN only by default (Google, Cloudflare); the published build has no TURN yet (a paid or
  quota-limited outside service: needs the owner's approval). Some networks (mobile carriers, corporate) cannot
  connect directly; a TURN relay fixes that: set `VITE_ICE_SERVERS` to a JSON array of `RTCIceServer`
  (e.g. `[{"urls":"turn:turn.example.com:3478","username":"u","credential":"p"}]`). The guest sees "a rede de um de
  vocês bloqueia conexões diretas" when it fails.
- **Privacy:** a direct connection shows each side the other's network address; the signaling channel is readable by
  anyone with the code (the same people who can join).
- **Host upload:** one data channel per guest; JSON snapshots ≈ 55 B per player in warmup, a few KB/s per guest.
- **Download:** the worker bundle (≈ 4.5 MB, mostly the Rapier physics engine) is fetched only by players who create a
  room or play solo.
- **Rate limit:** the per-client message limit of Colyseus is not mirrored.

## Build needs

`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (publishable values) in the client build: without them the
menu says "Online indisponível neste build" (solo still works). Realtime broadcast with the publishable key was
checked on the graao project (two clients, message in ≈ 30 ms).

## Testing

- `tests/hostRoom.test.ts`: the server room on the shim, driven like the worker (seats, refusal, drop → reconnection
  → expiry, ticking into a match, disposal).
- In the browser (two tabs on the dev client, no server running): host creates with bots → guest joins by code in
  ≈ 3 s → lobby with everyone → draft → UFO → match → results → lobby; guest drop and reconnection; host leaving;
  unknown code; solo with bots offline; the production build hosting a room.
