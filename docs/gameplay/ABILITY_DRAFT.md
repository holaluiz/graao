# Ability Draft

Status: TESTING (rules unit-tested, two-client integration test, played in the browser against the network bot).

Every connected player pressing READY in warmup opens the draft. Four **simultaneous** rounds: Basic (key 1), Basic
(key 2), Basic (key 3), Ultimate (key 4). The drafted loadout replaces the warmup one and the match starts.

## Rules (`@graao/game-core/draft.ts`, server-run)

- Each round everyone chooses in secret. Opponents see only *that* you chose (a check mark), never what.
- The round resolves the moment everyone has chosen, or when the window ends (12 s): missing choices are made at
  random from what is still free.
- **No duplicate ownership** when the pool covers every seat (1v1: 8 basics ≥ 2 × 3, 3 ultimates ≥ 2 × 1). Larger rooms
  fall back to "never twice in the same loadout".
- Two players wanting the same ability: the one with **priority this round** keeps it; the other gets a short repick
  window (7 s) at once, from what is left. Priority rotates every round, starting from a random seat.
- After each round the result is revealed for 1.6 s (cards flip, disputed ones get a crossed marker), then the next
  round opens. Worst case without conflicts: 4 × (12 + 1.6) s ≈ 54 s; usual 1v1 drafts take 20–40 s.
- A player leaving mid-draft frees their seat; with fewer than two seats left the draft is called off (back to warmup).
- Someone joining during a draft watches it and plays from the next match.

## Protocol

- `C2S.DRAFT_PICK { r, a }` — round the client is looking at and the ability id. The server validates round, pool,
  slot type, ownership and uniqueness (`DraftReject`).
- `S2C.DRAFT_STATE` (per player) — round, kind, stage (`pick` / `reveal` / `done`), `endsAt` (server clock),
  priority order, pool, owners of every ability already won, every seat's public picks and lock flag, and only this
  player's hidden choice, repick flag and who kept the ability they lost.
- The final loadouts ride in `ROOM_STATE.players[].loadout` when the match starts.

## Client (`ui/DraftScreen.ts`)

DOM/CSS/SVG over the live world (pointer released, gameplay input off). Header: round, timer bar (urgent tick in the
last seconds), priority chip. Cards: shape icon, name, description, Mana, cooldown, tags; taken cards are hatched and
stamped with the owner's name; keys 1–8 or a click choose. Bottom: each player's four slots filling round by round.
Audio cues: lock, conflict lost, reveal, last-seconds tick.

## Testing

- `packages/game-core/src/draft.test.ts`: priority rotation, four rounds into valid disjoint loadouts, conflict →
  priority keeps, loser repicks, refusals, random picks on timeout, a seat leaving, timing budget.
- `tests/multiplayer.test.ts` (gate 6): two real clients; hidden choices, a disputed ability, a timeout pick, the match
  starting with the drafted loadouts in `ROOM_STATE`, ownership enforced by `ABILITY_REQUEST`.
- `pnpm bot -- --code GR-XXXX --ready [--pick sun_orb,...] [--idle-draft]` drafts against a person in the browser.
