# GRAAbilitySystem (design for Phase 4 — TODO)

Not a GAS port: typed `AbilityDefinition` data in `@graao/game-data`, executed on the server with reusable primitives.

```ts
interface AbilityDefinition {
  id: string;
  name: string;
  slotType: 'basic' | 'ultimate';
  manaCost: number;
  cooldown: number;
  castTime: number;
  range: number;
  targetType: 'self' | 'direction' | 'point' | 'none';
  tags: string[];
  effects: EffectPrimitive[]; // Damage | Projectile | Area | Dash | Shield | Heal | Slow | Knockback
  presentation: { cue: string; telegraph?: string; mark?: string };
}
```

- Client sends `ABILITY_REQUEST { abilityId, seq, target }`; the server validates alive, ownership, Mana, cooldown,
  state, range and target, then accepts or rejects. Consequences are authoritative; presentation events go to everyone.
- The server owns Mana spend and cooldown start/end; the HUD only displays them.
- MVP set: one server projectile, one dash, one AoE, one defensive ability, one large Ultimate with an **Ultimate Mark**
  on the body (visible to opponents, shape-readable, persistent, never color-only, kept on LOW).
