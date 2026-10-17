# Fortnite learnings

> Source: the legacy Fractalia research, read-only (`D:\meus documentos\Fortnite\Docs\Game\ESTUDO_FORTNITE_APRESENTACAO.md`,
> `ESTUDO_FORTNITE_DOTA2.md`, `Docs\GameFeel\*`). That study read only package indexes, file headers and loose text files
> of a local Fortnite install (no decryption, no decompilation, no game process). Asset purposes there are *inferred from
> names*. graao takes **techniques and principles only**: no Epic character, map, UI art, weapon, sound, animation, Battle
> Bus or Storm design.

## Lessons graao applies

| # | Lesson (from the legacy study) | graao application | Phase |
|---|---|---|---|
| F1 | The HUD is composed per match phase by a director (`DynamicAthenaHUD`, `*UIDirector*`) | `GRAHudDirector` with phases BOOT → MENU → ROOM → CHARACTER_CREATOR → ABILITY_DRAFT → UFO → DROP → MATCH → RESULTS; each phase owns visible UI, audio state, camera context | 1–8 |
| F2 | Hit feedback has a fixed taxonomy: body, critical, shield, shield break, elimination; shooter vs receiver | `HitKind` enum in the shared protocol: BODY, CRITICAL, SHIELD, SHIELD_BREAK, ABILITY, ELIMINATION; each has a shape *and* a color | 3 |
| F3 | Reticles per weapon family plus a "blocked shot" warning | `reticleProfile` in `WeaponDefinition`; blocked-shot hint when the muzzle ray hits world before the aim point | 3 |
| F4 | Low health changes the mix (`LowHealth_MixMod`) and shows damage direction | Audio state LOW_HEALTH (low-pass + heartbeat duck); directional damage arcs in the HUD | 3–5 |
| F5 | The zone is a **world state** read by materials (MPC + material function on terrain/grass) | Future spherical zone (`centerDirection`, `angularRadius`) as a global shader uniform read by every graao material | later |
| F6 | Being outside the zone has stages; the zone ducks ambience; the clock tick pitch follows a curve | Zone audio/HUD stages when the zone exists | later |
| F7 | Speed lines are camera-attached particles, not post-processing | Drop speed lines as a camera-local instanced mesh | 7 |
| F8 | Layered animation (locomotion, in-air, land, tactical, death, procedural adjustments) and per-weapon-family layers | `CharacterAnimationController`: base locomotion + upper-body action layer (aim/fire/reload/cast) + one-shots (hit, land, death) | 1–4 |
| F9 | Camera modes per weapon type; camera shake with a REDUCED option; separate anticipation shake | Data-driven camera responses (MICRO, HIT, HEAVY, ULTIMATE, ANTICIPATION, LANDING, ENVIRONMENT) with FULL/REDUCED/OFF | 3–4 |
| F10 | Four-level sound priority with concurrency limits | `GRAAudioManager` categories with priority Threat > Weapons > Abilities > Match > UI > Environment and per-category voice limits | 3 |
| F11 | The match is a sequence of states with visuals as data; post-match is a set of panels | Server-owned `MatchPhase` + client HUD director; RESULTS screen with recap and return to lobby | 8 |
| F12 | Effect budgets (effect types, baselines, scalability) | `GRAVFXSystem` categories (GameplayCritical … CinematicOnly) with quality culling that never removes gameplay-critical effects | 3–7 |
| F13 | Deployment is a short ritual: bus route visible, jump, dive, land; landing has a water variant | UFO on a deterministic orbit, readable route, JUMP, radial fall with wind/speed lines, ground vs water landing | 7 |

## What graao does not adopt

Motion matching, ML deformers, facial speech SDKs, building, loot rarity colors, the Storm's look, any Epic content.
