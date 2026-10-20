# Chests, loot, weapons and items

Player-facing text is Portuguese (pt-BR); ids and code stay in English.

## 0 · State found before this work (audit, 2026-10-18)

| Area | Found | Reused / changed |
|---|---|---|
| Weapons | `WEAPONS` (game-data) has 7 complete definitions (Raio de Sol, Rajada de Pétalas, Pistola Tática, Fuzil Kalash, Fuzil de Precisão, Submetralhadora, Lança-Foguetes) and baked models for all 7 (`WeaponData.ts`), but only two were playable: `WEAPON_SLOTS = ['sunbeam', 'petal']` was hard-wired in the server player, the room, the client prediction, the HUD and the weapon holder. | Slots now hold any weapon id (inventory). The definitions, hitscan, spread, falloff, prediction and models are unchanged. |
| Ammo | Magazine only, per fixed slot; reload refilled from nothing (infinite). | Same magazine/reload code; a reload now takes from a per-type reserve. |
| Equip / switch | E = slot 0, Q = slot 1 (`SWITCH_WEAPON`), 220 ms equip delay. | Unchanged; empty slots refuse the switch. |
| Attributes | Health 100, Shield 100, Mana 100 (`ATTRIBUTES`), `Vitals` in game-core. | Consumables restore them, clamped to the max. |
| Abilities | `GRAAbilitySystem` (game-core) with the room as host; keys 1–4. | Pattern copied: `GRALootSystem` lives in game-core with the room as its host. |
| Input | `Input.ts` action map; F, G, Z, X, C were free. | F = interact, Z/X/C = consumables. |
| Interaction | None (no prompt, no use key, no interactable objects). | New. |
| Networking | Colyseus, numeric message ids, compact arrays for high-rate traffic, `EVENTS` per tick, private `SELF`. | Loot state is a reliable `LOOT_STATE` message plus `EVENTS`; inventory rides in `SELF`. |
| Physics | One static Rapier world per process on the server, shared by every room (terrain trimesh + props); one per page on the client. Player capsules live in it with their own group. | Chest colliders get their own group; a room's character motor only collides with that room's chests (Rapier filter predicate). |
| Planet | Sphere R = 100 m, analytic height + trimesh, authored structures + seeded scatter, named `REGIONS`. | Chest spots are authored per region and validated against the real trimesh and props. |
| Rendering | GRAStylized material family, ink outline as a post pass for every stylized mesh, instanced props. | Chests use the same world material (ink and Tormenta bleach for free); pickups use clean unpigmented materials so rewards stay legible in the Tormenta. |
| VFX / audio | `GRAVFXSystem` (2 draw calls, bursts, rings, flashes), `GRAAudioManager` (sound bank with synthesized fallback, buses, voice limits). | New cues and bursts only. |
| HUD | DOM/CSS/SVG; vitals, weapon cards, notices, banners. | Prompt, pickup feed, consumable bar, weapon replacement card. |
| Inventory | None. | `GRAInventory` (game-core): 2 weapon slots, reserves, consumable stacks. |
| Death | Elimination, respawn in warmup, no respawn in a match; nothing dropped. | Death drops through the same pickup system. |
| Tormenta | Server safe region (geodesic cap) + global material uniforms. | Untouched; chests read the same uniforms. |
| Assets / R2 | Weapons are baked into the bundle; everything else code-built. | Chests and consumables are code-built (no new asset, no R2 or Supabase needed). |

## Baús nas alturas (2026-10-20)

Região de baús **Alturas** (`CHEST_REGIONS`, a última da lista: o índice vai na rede) com os pontos do cume da Serra do
Mirante, da capelinha da Ilha do Sino e da Ilha da Torre. `min: 1`: toda partida tem um baú lá em cima, que é o
inicial da região (sempre com arma). `vantage: true`: o baú é sorteado duas vezes (`rollMatchLoot`, `advantage`) e fica
a rolagem cujo melhor item é mais raro; as regras da partida (armas suficientes, no máximo 2 épicos) valem depois.
Bots pesam esses baús como 20 m mais perto. Testes: `loot.test.ts` (vantagem em 600 partidas simuladas, determinismo,
teto de épicos) e `tests/vertical.bots.multiplayer.test.ts` (bot sobe ao cume e abre o baú). Ver
[ilhas](../world/FLOATING_ISLANDS.md#loot).
