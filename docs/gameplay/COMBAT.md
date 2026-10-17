# Combat (Phase 3: guns — TESTING; Phase 4: abilities — TODO)

Player-facing text is Portuguese (pt-BR); ids and code stay in English.

## Rules (server-owned)

- Attributes: Health 100, Shield 100, Mana 100 (test values, `ATTRIBUTES` in `@graao/game-data`). Damage hits Shield
  first, then Health (`applyDamage` in `@graao/game-core/combat.ts`, unit-tested). Integers only.
- Hit taxonomy (`HitKind`): BODY, CRITICAL (head sphere), SHIELD, SHIELD_BREAK, ABILITY, ELIMINATION.
- Hitboxes are analytic: body capsule + head sphere from the feet along local up (`HITBOX`).
- Hitscan: the client sends `FIRE {s, w, o, d, a}` (shot seq, slot, camera origin, aim direction, aiming). The server
  checks alive, equipped slot, not reloading, match phase (`canFight`), increasing seq, fire rate (× 0.85 tolerance),
  ammo, camera origin within 7.5 m of the shooter's head; then for each pellet (deterministic spread from
  `shotSeed(player, seq)`) casts the camera ray against the world (Rapier) and players, and requires muzzle line of
  sight to the aimed point (no shooting around corners). Distance falloff per weapon. Rewind / lag compensation is
  deferred.
- Reload: R, or automatically when the magazine empties. Switch: E / Q with a 220 ms equip delay.
- `SELF` status (private): weapon, ammo, reload, alive, respawn time and `shotSeq` (last FIRE handled, accepted or
  refused) so the client knows which predicted shots are still in flight.

## Weapons (MVP)

| id | Name (pt-BR) | Slot | Damage | Rate | Mag | Reload | Spread hip/aim | Pellets | Reticle |
|---|---|---|---|---|---|---|---|---|---|
| `sunbeam` | Raio de Sol | E | 16 (×1.6 head) | 7/s auto | 24 | 1.7 s | 1.4° / 0.35° | 1 | dot-cross |
| `petal` | Rajada de Pétalas | Q | 11 ×8 (×1.3 head) | 1.25/s | 4 | 2.1 s | 5.5° / 4.2° | 8 | circle |

Models are code-authored (`apps/client/src/character/WeaponModels.ts`): chunky toy-like blasters, ink shell outline,
mounted on the canonical `RightHand` bone, `muzzle` socket for tracers. Measured: 4 064 triangles for both models
including the ink shells (≈ 2 k each; only the equipped one is visible).

## Client (prediction and presentation)

`CombatDirector` (apps/client/src/game) + `WeaponController` (timing/ammo prediction, unit-tested):

- On fire, immediately: tracer from the real muzzle to the predicted impact (same spread seed and hitscan as the
  server), muzzle flash, impact puff, upper-body `fire` clip, recoil kick on the camera, weapon sound. The shooter's
  own `shot` event is never re-drawn.
- On confirmation (`dmg` event from the server): hitmarker shape by kind (X, gold X + diamond for critical, blue hex
  for shield, broken hex for shield break, red X + ring for elimination), damage number over the target, hit sound,
  hit VFX on the target (shards for shield, ring for shield break).
- Taking damage: directional arc around the reticle (dashed blue for shield, red for health), camera shake (HIT /
  HEAVY), hurt sound, partial hit-reaction animation, low-health vignette + LOW_HEALTH audio state (world muffled,
  threats stay clear).
- Remote shots: tracer from the remote's rendered muzzle to the server's impact points, `fire` clip, panned and
  distance-attenuated sound on the Threat bus.
- Blocked-shot marker (red ×) when the muzzle cannot see the aimed point.
- Camera shake/recoil is always at full strength for every player (no menu option).

Response stack: BODY, WORLD, FX, CAMERA, AUDIO, UI at MICRO / COMBAT / MAJOR intensity. Hit kinds always differ by
shape, not only color.

## Tests

- Unit: damage, hitboxes, spread, falloff (`combat.test.ts`); match rules (`match.test.ts`); weapon prediction
  (`WeaponController.test.ts`).
- Integration (`tests/multiplayer.test.ts`): shield-first damage confirmed to everyone, fire-rate spam and teleported
  origins refused, elimination + respawn in warmup, and a complete 1v1 match (gate 3).
