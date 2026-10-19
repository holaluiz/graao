/** Build-derived passive modifiers; the room calls these from its tick and existing combat/pickup events. */
import { ABILITIES, ATTRIBUTES, type Loadout, type PassiveDefinition } from '@graao/game-data';
import type { Vitals } from './combat';

export interface PassiveRuntime {
  lastDamageAt: number;
  lastFireAt: number;
  shieldCarry: number;
  active: boolean;
}

export interface PassiveModifiers {
  speed: number;
  weaponRecoil: number;
  weaponSpread: number;
  weaponSwap: number;
  pickupRange: number;
  ammoBonus: number;
  footstepVolume: number;
  airControl: number;
  fallDamage: number;
  statusResistance: number;
}

const neutral = (): PassiveModifiers => ({ speed: 1, weaponRecoil: 1, weaponSpread: 1, weaponSwap: 1, pickupRange: 1, ammoBonus: 0, footstepVolume: 1, airControl: 1, fallDamage: 1, statusResistance: 0 });

export function newPassiveRuntime(now = 0): PassiveRuntime {
  return { lastDamageAt: now, lastFireAt: now, shieldCarry: 0, active: false };
}

export function resetPassives(runtime: PassiveRuntime, now: number): void {
  runtime.lastDamageAt = now;
  runtime.lastFireAt = now;
  runtime.shieldCarry = 0;
  runtime.active = false;
}

export function recordPassiveCombat(runtime: PassiveRuntime, now: number, event: 'fire' | 'damage'): void {
  if (event === 'fire') runtime.lastFireAt = now;
  else runtime.lastDamageAt = now;
  runtime.shieldCarry = 0;
  runtime.active = false;
}

export function equippedPassive(loadout: readonly string[]): PassiveDefinition | null {
  for (const id of loadout) {
    const definition = ABILITIES[id as keyof typeof ABILITIES];
    if (definition?.kind === 'passive' && definition.passive) return definition.passive;
  }
  return null;
}

export function passiveModifiers(loadout: readonly string[], runtime: PassiveRuntime, now: number, alive = true): PassiveModifiers {
  const modifiers = neutral();
  runtime.active = false;
  if (!alive) return modifiers;
  const passive = equippedPassive(loadout);
  if (!passive) return modifiers;
  const outOfCombat = now - Math.max(runtime.lastDamageAt, runtime.lastFireAt) >= (passive.delay ?? 0) * 1000;
  runtime.active = true;
  switch (passive.type) {
    case 'outOfCombatSpeed': modifiers.speed = outOfCombat ? passive.factor : 1; runtime.active = outOfCombat; break;
    case 'weaponHandling': modifiers.weaponRecoil = passive.factor; modifiers.weaponSpread = passive.factor; break;
    case 'weaponSwap': modifiers.weaponSwap = passive.factor; break;
    case 'scavenger': modifiers.pickupRange = passive.factor; modifiers.ammoBonus = passive.bonus ?? 0; break;
    case 'quietSteps': modifiers.footstepVolume = passive.factor; break;
    case 'shieldRegen': runtime.active = outOfCombat; break;
    case 'airControl': modifiers.airControl = passive.factor; modifiers.fallDamage = passive.bonus ?? 1; break;
    case 'debuffResistance': modifiers.statusResistance = passive.factor; break;
  }
  return modifiers;
}

/** No per-passive timers. Fractional shield regeneration is accumulated before awarding whole shield points. */
export function updatePassives(loadout: Loadout | readonly string[], runtime: PassiveRuntime, vitals: Vitals, dt: number, now: number): PassiveModifiers {
  const modifiers = passiveModifiers(loadout, runtime, now, vitals.alive);
  if (!vitals.alive) { resetPassives(runtime, now); return modifiers; }
  const passive = equippedPassive(loadout);
  if (passive?.type !== 'shieldRegen' || !runtime.active || !Number.isFinite(dt) || dt <= 0) { runtime.shieldCarry = 0; return modifiers; }
  const cap = ATTRIBUTES.maxShield * (passive.ceiling ?? 0.5);
  if (vitals.shield >= cap) { runtime.active = false; runtime.shieldCarry = 0; return modifiers; }
  runtime.shieldCarry += dt * passive.factor;
  const points = Math.floor(runtime.shieldCarry + 1e-8);
  runtime.shieldCarry -= points;
  vitals.shield = Math.min(cap, vitals.shield + points);
  return modifiers;
}

export function pickupAmmoWithPassive(quantity: number, modifiers: PassiveModifiers): number {
  return Math.max(0, Math.floor(quantity * (1 + modifiers.ammoBonus) + 1e-8));
}
