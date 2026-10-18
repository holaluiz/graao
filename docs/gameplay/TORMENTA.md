# Tormenta

Status: TESTING. The integration suite and the browser (against the network bot, with the server's dev options) run the
whole loop: two players on opposite sides of the planet, the reduction, damage to the one outside only, death by the
Tormenta and the win for the other. Not yet played person vs person on two machines.

The Tormenta is the match's shrinking safe region. It takes the pigment out of the world: inside, the painting is
intact; across the boundary the colour drains in torn patches; outside, the world is its own pencil sketch. It turns the
1v1 into pressure, movement and a final meeting. Lessons kept from Fortnite's Storm (announce, count down, close,
damage over time, a readable boundary) and from the legacy "O Branco" (plan the final region first, render the wall
from both sides), with nothing of either's look.

## Rules and numbers (`@graao/game-data` `TORMENTA`)

| Phase | Hold (next region shown, countdown) | Closes in | Onto (angular radius / arc) | Damage outside |
|---|---|---|---|---|
| Start | whole planet safe | | 180° | none until the first reduction moves |
| 1 | 40 s | 30 s | 100° / 174.5 m | 2 Vida/s |
| 2 | 30 s | 25 s | 45° / 78.5 m | 4 Vida/s |
| 3 | 20 s | 25 s | 10° / 17.5 m | 7 Vida/s |
| Final | held until someone falls | | 10° | 10 Vida/s |

- The final region opens 2:50 after the fight starts.
- Damage is Health only (the shield does not keep the colour in), one pulse per second on a clock aligned to the
  Tormenta's start. A pulse hits everyone outside at that moment, in the same tick: two players falling together is a
  draw.
- Reachability (unit-tested): from the worst point of the previous circle, a runner (5.6 m/s, 1.3 detour factor for
  houses and lakes) gets inside every new region before its reduction ends: 32 s needed of 70 s, 41 of 55, 26 of 45.
- The final centre is on walkable land: above the sea by 0.35 m, slopes under 30°, and at least 75 % of the final disc
  walkable (no final in a lake, the sea or on a cliff). Falls back to the village plaza.
- Every circle nests inside the previous one (the boundary only ever moves inward): a centre never sits farther from
  the previous one than 85 % of the radius it loses.

## How it works

- **Shared math** (`game-core/tormenta.ts`): the region is a spherical cap, a centre direction from the planet centre
  plus an angular radius. Inside = geodesic angle between `normalize(position)` and the centre below the radius, never
  a flat X/Z circle; height does not matter (a roof or a jump is still inside). During a reduction the centre slides
  along the great circle (slerp) and the radius shrinks linearly. `planTormenta` builds the schedule backwards (final
  centre first, then each earlier circle around the next one).
- **Message** (`TormentaMsg` in `ROOM_STATE.tormenta`): only the current phase (k of n, the circle it holds, the circle
  it closes onto, `t0` / `a` / `b` server times, damage, pulse). Integers only (unit vectors × 1e6, µrad, ms), so the
  server's test and every client's boundary are the same numbers. Nothing streams per tick: the client evaluates
  `tormentaCircleAt(msg, serverNow)`. The final centre is never sent before its phase.
- **Server** (`GRATormentaSystem`, owned by `GraaoMatchRoom`): starts with the fight (`startsAt`, after the UFO
  landing), stops at the results or when the room empties. Each tick it advances the phase (a new phase marks the room
  state dirty) and reports at most one damage pulse per interval, never two for the same interval and no catch-up
  burst after a stall. The pulse goes through the normal `dealDamage` path (`hazard = 'tormenta'`), so the `dmg` and
  `elim` events carry `c: 'tormenta'`, the elimination counts like any other and `checkMatchEnd` hands the win. The
  snapshot flag `IN_TORMENTA` publishes the server's own verdict per player. Server bots head for the closing region
  (and stop shooting while they run) unless their opponent is within 20 m.
- **Client** (`TormentaDirector`): mirrors the published phase and the server clock; it decides nothing. The local
  player is tested at its predicted position with the same function the server uses; remote players use the server's
  flag.

## Presentation

| Layer | What it does |
|---|---|
| World | Shared uniforms (`TORMENTA_UNIFORMS`: region, next region, on/time/radius) read by every world material (terrain, props, foliage, grass, water). Inside: untouched (one `acos` per fragment). Across a ~7 m band: the colour drains, blobs of bare paper letting go ahead of the rest, a ragged graphite tear on the line and a paper lip outside it, crawling slowly. Outside: luminance kept, chroma gone, values lifted toward paper, contrast lowered, faint pencil hatching where it was dark. Characters, held weapons and the UFO opt out; VFX and ability telegraphs have their own shaders: all stay crisp. |
| Next region | Chalk dashes on the ground where the region being closed onto ends (terrain shader). |
| Curtain | `TormentaCurtain`: one ring strip (1 draw call, 384 triangles) placed in the vertex shader on the boundary, from 6 m under the mean ground to 14 m above it, torn top, draining streaks, both faces rendered (legacy K-41), fades near the camera; hidden while the whole planet is safe. |
| Atmosphere | With the camera outside: paler, closer fog and a washed sky (`GRARenderer.tormenta`). |
| FX | Light paper flakes lifting off the boundary near the player (only when it is within 38 m), pigment peeling off whoever is outside (local by prediction, remotes by the server flag). |
| Audio | State `INSIDE_TORMENTA`: only the ambience buses (environment, music) are ducked to 30 % and low-passed to 750 Hz; threats, weapons, abilities and match cues stay clear. A low paper drone rises with depth. Discreet cues: warning 10 s before a reduction, a rising tick in the last 5 s, the reduction starting, the final region, stepping out and back in, a damage scratch. `LOW_HEALTH` keeps priority. |
| HUD | Card (top left): torn-ring glyph, phase pips (done filled, current outlined and pulsing while it closes), state in words ("FASE 2 DE 3 · avança em", "AVANÇANDO", "ÁREA FINAL"), the clock, a progress bar striped while it closes, the damage outside. Planet map under it (`TormentaMap`): the whole planet on a disc centred on the player, heading up, logarithmic radius (the antipode on the rim): safe region plain, Tormenta hatched, next region dashed. Way back (under the status chip): arrow + "FORA DA ÁREA SEGURA · N m até a área · −N Vida/s", or "FORA DA PRÓXIMA ÁREA" before it closes. Screen edges turn to bare paper with depth; damage flinches the strip, floats "−N" and shakes the camera lightly. Banners on each phase; the feed and the death screen say "Tormenta" / "pela Tormenta". No state relies on colour alone (words, pips, stripes, hatching, dashes). |

Narrow screens (≤ 640 px) move the column under the status chip; up to 860 px the map steps aside while the way-back
strip shows.

## Measured (2026-10-18, Radeon RX 570, Chromium/ANGLE D3D11)

GPU time per frame with `EXT_disjoint_timer_query_webgl2`, 1394 × 1456 (≈ 2 MPx, the pixel count of 1080p),
alternating the Tormenta on/off every second at the same view, medians:

| View | Off | On | Cost |
|---|---|---|---|
| Inside, boundary out of view | 3.44 ms | 3.46 ms | +0.02 ms |
| On the boundary, looking out (curtain, band, flakes) | 3.35 ms | 3.68 ms | +0.33 ms |
| Outside, whole view bleached (before skipping the edge noise far from the band) | 3.52 ms | 4.01 ms | +0.49 ms |
| Outside, whole view bleached (current shader, three runs) | 3.77 – 3.80 ms | 3.78 – 4.04 ms | +0.01 – 0.23 ms |

CPU frame time: no measurable difference (within ±0.3 ms run to run). The map redraws a 116 px canvas ~10 times a
second; heading only rotates it through CSS.

Network (2 players, 191 s match, client side): 1.56 KB/s in total. The Tormenta's share: one `ROOM_STATE` per phase
change (n + 1 per match, ≈ 1.2 KB each, the field itself ≈ 110 B), one `dmg` event (≈ 84 B with its envelope) per
second per player outside, and one bit in the existing snapshot flags. Client and server agree on inside/outside:
crossing the boundary, the client's prediction flips first and the server's flag follows one snapshot later (50 ms at
20 Hz with an 11 ms RTT).

## Tests

- `packages/game-core/src/tormenta.test.ts` (9): nesting through every phase, finals on walkable land and spread over
  the planet, reachability, geodesic inside/outside at opposite sides of the planet (a flat X/Z test would fail it),
  one pulse per interval with a doubled tick and after a stall, phases published once, integers only.
- `tests/multiplayer.test.ts` "the Tormenta through the authoritative server": A near the final centre, B ≈ 178° away;
  the first phase arrives with the match, the final region is published when the reduction ends, only B is ever
  flagged and hurt (Health only, one pulse at a time, at each phase's rate), the client-side boundary agrees with the
  server's flag, B falls to the Tormenta, A wins with no kill, the summary counts it.

## Dev tools

- Room options on a dev server (ignored in production): `tormentaPhases`, `tormentaPulseMs`, `tormentaFinalDamage`,
  `tormentaFinal: {lat, lon}`, `tormentaOff`, and `matchSpawns: [{lat, lon}, ...]` for fixed fight spawns.
- `pnpm bot -- --create --opts '{"skipUfo":true,"skipDraft":true,"tormentaPhases":[...]}'` creates such a room;
  `--pattern tormenta` makes the bot walk into the closing region.
- F3 overlay: `tormenta` line (phase, stage, radius, metres to the boundary, FORA).

## Not done yet

- Played person vs person on two machines.
- Tuning by play: timings, damage, radii (the table above is a first pass).
- The map does not mark the final region before its phase (by design) and never shows opponents.
