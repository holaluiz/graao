# GRAAbilitySystem

Status: TESTING (unit + integration tests; seen in the browser against a network bot).

Not a GAS port. An `AbilityDefinition` is plain typed data in `@graao/game-data/abilities.ts` whose `effects` are
composed from eight reusable primitives; `GRAAbilitySystem` (`@graao/game-core/abilitySystem.ts`) executes them on
the authoritative server. Ids stay English; `name`/`blurb` are what players read (pt-BR).

```ts
interface AbilityDefinition {
  id: AbilityId; name: string; blurb: string;
  slotType: 'basic' | 'ultimate';
  manaCost: number; cooldown: number; castTime: number; range: number;
  targetType: 'self' | 'direction' | 'point' | 'none';
  tags: string[];
  effects: AbilityEffect[]; // damage | projectile | area | dash | shield | heal | slow | knockback (nested: onHit, area.effects)
  presentation: { color; color2; icon; anim; cue; telegraph?: 'ring' | 'lane'; mark?: UltimateMarkId };
}
```

## Pool (MVP)

| Basic | Primitives | | Ultimate | Primitives | Mark |
|---|---|---|---|---|---|
| Orbe Solar | projectile → damage | | Meteoro Solar | area at point (1 s warning) → damage + knockback | sun crown |
| Passo de Vento | dash | | Ciclone de Pétalas | area following the caster, 4 pulses → damage + slow | petal orbit |
| Explosão de Pólen | area at point (0.65 s) → damage + slow | | Lança da Aurora | charged projectile (lane telegraph) → damage + knockback | dawn lance |
| Casulo de Folhas | shield | | | | |
| Semente de Espinhos | lobbed projectile → area | | | | |
| Anel de Vento | area on self → damage + knockback | | | | |
| Seiva Pegajosa | projectile → damage + slow | | | | |
| Florescer | heal | | | | |

Counterplay rule: every big hit has a visible projectile or a ground warning; Ultimates warn for 0.5–1 s.

## Flow

1. Client (`AbilityDirector`, keys 1–4) sends `ABILITY_REQUEST { s, k, a, c, d?, p? }`: slot, the id it believes is
   there, its next movement command (dashes start exactly there on both sides), a quantized direction or point.
2. Server checks, in order (`checkCast`): alive → owns the id in that slot → phase (`canFight`: no countdown, results
   or draft) → not winding up → cooldown → Mana; then the target (`validateTargetPoint`: range, surface, line of sight).
3. Accepted: Mana spent, cooldown and wind-up started (server clock), `cast` event to everyone; after the wind-up the
   effects run: server-simulated projectiles (radial gravity, swept hit tests), areas over time (walls protect),
   dashes on the movement stream, statuses. Every consequence is an event (`proj`, `projEnd`, `area`, `fx`, `dmg`).
4. Private `ABILITY_RESULT` (ok / reason) and `SELF` (Mana, cooldown end times, wind-up, slow) to the caster. The
   client `AbilityController` mirrors them only to decide what to *predict*; refused predictions roll back.

Solo practice runs the same `GRAAbilitySystem` locally with the local player as the only actor.

## Ultimate Mark

`render/vfx/UltimateMarks.ts`: a small floating sign over the head of every player carrying an Ultimate — which one,
never whether it is ready (constant motion, independent of the cooldown). Shape and motion read without color, it is
mounted on the character root (clothing and hair cannot hide it) and kept on LOW.

## Loadouts

Warmup uses `DEFAULT_LOADOUTS` by player index. The Ability Draft (see `docs/gameplay/ABILITY_DRAFT.md`) replaces
them for the match; the loadout is public in `ROOM_STATE` (the Ultimate drives the mark).
