# Legacy Fractalia learnings

> Read-only audit (2026-10-17) of `D:\meus documentos\Fortnite` (Unreal 5.8 project "Fractalia", formerly Nexus Royale /
> Fragma) and of the abandoned web attempt `D:\meus documentos\Fractalia-Web`. Nothing in either folder was modified and
> graao imports nothing from them. Files read: legacy `README.md`, `Docs/GameFeel/FRACTALIA_RESPONSE_STACK.md`,
> `FRACTALIA_HUD_ATTENTION.md`, `Docs/AssetIntegration/THIRD_PARTY_LICENSES.md`, the Fortnite study, and Fractalia-Web's
> `docs/migration/UNREAL_LEARNINGS.md`, `ASSET_REUSE_MATRIX.md`, `SUMMER_AFTERNOON_STUDY.md`, server room code
> (Colyseus 0.18 API usage only).

## Principles kept (translated, not ported)

| Legacy concept | Purpose | graao translation |
|---|---|---|
| Unreal GAS (`AS_Hero`, Gameplay Effects) | Data-driven abilities with server authority | `GRAAbilitySystem`: typed `AbilityDefinition` + reusable primitives (Damage, Projectile, Area, Dash, Shield, Heal, Slow, Knockback) executed on the server |
| Gameplay Cues / `UNRRespostaSubsystem` | Presentation separated from rules | Presentation Events dispatched by a client-side Response Stack |
| Response Stack (BODY, WORLD, FX, CAMERA, AUDIO, UI; levels) | Every event answers in chosen channels at a chosen intensity | Same six channels; intensity AMBIENT/MICRO/COMBAT/MAJOR/ULTIMATE; the server sends only the *event*; the owner predicts its own input feedback and confirmation never repeats it |
| HUD attention (QUIET/RELEVANT/URGENT/CRITICAL, max 2 urgent) | Avoid a noisy HUD; never color-only | Same four levels in `GRAHudDirector`; only state changes animate; 100–250 ms accents |
| Ultimate Mark (persistent, visible to enemies, shape not color, says *which* Ultimate not *if ready*) | Combat information on the body | Kept as **Ultimate Mark**, rendered on LOW, never hidden by clothing |
| Ability Draft (3 basics + 1 ultimate, unique in match) | Combinations, not single abilities | 4 simultaneous rounds; conflicts resolved by alternating round priority |
| Counterplay rule (big damage has a visible projectile or ground warning; Ultimate 0.5–1 s) | Every death is readable | Ability telegraphs are GameplayCritical VFX (kept on LOW) |
| Health 150 + Shield 100 scale (legacy weapons tuned for ≈150 HP) | Time-to-kill calibration | graao MVP: Health 100 / Shield 100 / Mana 100 as test values (no legacy numbers imported) |
| Camera catalog (MICRO, HIT, HEAVY, ULTIMATE, AMBIENT, ANTICIPATION, LANDING; 40–350 ms; FULL/REDUCED/OFF) | Centralized camera feel | Data-driven camera responses in the client |
| Audio priority and mix states with one owner | Threat is always heard | `GRAAudioManager` states NORMAL, LOW_HEALTH, UFO, POST_MATCH |
| Match flow with a visual/sound/UI state per transition; draft → deployment by color fragmentation, not black fade | Transitions are part of the game | graao uses a paper/pigment transition |
| Version triple (client, protocol, assets) | Reject incompatible clients | `CLIENT_VERSION`, `PROTOCOL_VERSION`, `ASSET_VERSION` in `@graao/shared` |
| Watercolor "per material, not a screen filter" (D-019) | Characters and warnings stay crisp | `GRAStylizedMaterial` world variant carries pigment/paper; characters and telegraphs stay clean |

## Lessons from mistakes

- **K-46 (retargeting per mesh):** retargeted animation only worked for one mesh → graao has **one canonical rig** and
  every deforming piece is skinned to it.
- **Raw Mixamo FBX files were pushed to a public repo** (legacy ASSET_REUSE_MATRIX §3) → graao gitignores
  `assets/animations/mixamo/raw/`; Mixamo clips are used inside the game, never redistributed as loose files.
- **One actor per tracer/flash** in the Unreal weapons (≈ 36 actors/s on automatics) → `GRAVFXSystem` pools everything.
- **Invisible zone wall from inside (K-41)** → future zone renders both faces.
- **Fractalia-Web stalled before a playable client existed** (server, data and docs, but no `apps/client/src`) → graao
  builds vertical slices: a running visual scene first, then multiplayer, then combat.

## Not carried over

Names, lore (Fragma, Peregrino, the Branco), ability names, heroes, icons, art assets, the Unreal architecture
(UObject/AActor/Blueprints/Niagara/UMG/World Partition), loot, creeps, levels, the 1.33 km map, the launcher/installer.

## Assets on disk and their status for graao

| Asset | License (as read) | graao use |
|---|---|---|
| Quaternius Universal Animation Library 1 & 2 (`Quaternius/UniversalAnimationLibrary*`) | **CC0 1.0** (`License.txt`) | **Used** as the MVP animation source, retargeted to `GRA_Rig_MixamoCompatible` (in-place variant) |
| Quaternius nature/village/city kits | CC0 1.0 | Available for later environment passes |
| Mixamo characters (`Personagens/Ch*_nonPBR.fbx`, Remy, Heraklios) | Adobe Mixamo terms (use in projects allowed; no redistribution as loose files) | Not used as meshes. The Mixamo *pipeline* is supported for user-downloaded clips |
| Low-poly firearms (`armas/`) | "free to use" per the user (16/10/2026), license text not recorded | Not used; graao builds original weapons |
| UFO model (Sketchfab) | not recorded | Not used; graao builds an original UFO |
