# Ability Draft

The current client experience is documented in [Ability Draft UX](../UX/ABILITY_DRAFT.md). This document covers the
server rules, protocol and implementation checks.

The host starts a ready lobby, freezing its participant roster and materializing the planned bot seats. The draft
runs four **simultaneous** rounds: Basic (key 1), Basic (key 2), Basic (key 3), Ultimate (key 4). The drafted loadout
replaces the previous one, then the room enters preparation before deployment. The legacy warmup path remains
available for existing development and integration flows.

## Rules (`@graao/game-core/draft.ts`, server-run)

- Each round everyone chooses in secret. Opponents see only *that* you chose (a check mark), never what.
- The round resolves the moment everyone has confirmed, or when the window ends (45 s): missing choices are made at
  random from what is still free.
- **No duplicate ownership** when the pool covers every seat (1v1: 8 basics ≥ 2 × 3, 3 ultimates ≥ 2 × 1). The check
  is per type: basics are exclusive for up to 2 participants, ultimates for up to 3. In a 10-participant room both
  types may repeat across players, but never twice in the same loadout.
- Two players wanting the same ability: the one with **priority this round** keeps it; the other gets a short repick
  window (20 s) at once, from what is left. Priority rotates every round, starting from a random seat.
- After each round the result is revealed for 1.6 s, then the next round opens. With no conflicts, four full timeout
  windows plus reveals take 4 × (45 + 1.6) s = 186.4 s; confirming early shortens the draft.
- A player leaving mid-draft frees their seat; with fewer than two seats left the draft is called off and the room
  returns to its lobby, or warmup in the legacy path.
- The current lobby flow refuses new joins after a match has started. The UI can still display server draft states
  for a non-participating spectator in flows where such a state is provided.

## Protocol

- `C2S.DRAFT_PICK { r, a }` — round the client is looking at and the ability id. The server validates round, pool,
  slot type, ownership and uniqueness (`DraftReject`).
- `S2C.DRAFT_STATE` (per player) — round, kind, stage (`pick` / `reveal` / `done`), `endsAt` (server clock),
  priority order, pool, owners of every ability already won, every seat's public picks and lock flag, and only this
  player's hidden choice, repick flag and who kept the ability they lost.
- The final loadouts ride in `ROOM_STATE.players[].loadout` when the match starts.

## Client (`ui/DraftScreen.ts`)

DOM/CSS/SVG over the live world (pointer released, gameplay input off). The personal build keeps all four slots
visible. Cards show shape icon, name, category, short description, mana and cooldown; a persistent panel shows
effects and range on hover, focus or selection. Clicks and numeric shortcuts select a local preview. The explicit
Confirm action sends it; Change Selection permits a new preview while the server still allows this seat to pick.
Ten participant statuses fit in a compact strip, with pending opponent abilities kept secret. Audio cues preserve
lock, conflict lost, reveal and last-seconds tick.

At up to 200 ms before the server deadline the client attempts to confirm a valid unsent local preview once. With
no valid choice received, the server retains its random fallback. Both cases are explained in the UI. Server state
remains authoritative for all final loadouts. See the UX document for status text, layout and timeout details.

## Testing

- `packages/game-core/src/draft.test.ts`: priority rotation, four rounds into valid disjoint loadouts, conflict →
  priority keeps, loser repicks, refusals, random picks on timeout, a seat leaving, default 45/20/1.6 timings.
- `apps/client/src/ui/DraftScreen.test.ts`: preview availability, shared ownership in 10-player rooms, duplicate
  prevention within one build, deadline confirmation and duplicate-send guards.
- `tests/multiplayer.test.ts` (gate 6): two real clients; hidden choices, a disputed ability, a timeout pick, the match
  starting with the drafted loadouts in `ROOM_STATE`, ownership enforced by `ABILITY_REQUEST`.
- `pnpm bot -- --code GR-XXXX --ready [--pick sun_orb,...] [--idle-draft]` drafts against a person in the browser.
