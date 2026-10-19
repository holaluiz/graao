/** Authoritative timed effects. Durations enter in seconds; clocks and expiry are server milliseconds. */
import { ABILITY_RULES, type DebuffKind, type StatusKind } from '@graao/game-data';
import { newPassiveRuntime, resetPassives, type PassiveRuntime } from './passives';

export interface TimedStatus {
  id: number;
  kind: StatusKind;
  source: number;
  startedAt: number;
  endsAt: number;
  factor: number;
}

export interface StatusRuntime {
  effects: TimedStatus[];
  resistances: { kinds: DebuffKind[]; factor: number; endsAt: number }[];
  recovery: Partial<Record<'root' | 'silence', number>>;
  nextId: number;
}

export interface StatusModifiers {
  speedFactor: number;
  rooted: boolean;
  silenced: boolean;
  noSprint: boolean;
}

export interface AbilityRuntime extends StatusRuntime {
  passive: PassiveRuntime;
}

export function newAbilityRuntime(now = 0): AbilityRuntime {
  return { ...newStatusRuntime(), passive: newPassiveRuntime(now) };
}

export function resetAbilityRuntime(runtime: AbilityRuntime, now: number): void {
  clearStatusEffects(runtime);
  resetPassives(runtime.passive, now);
}

export function newStatusRuntime(): StatusRuntime {
  return { effects: [], resistances: [], recovery: {}, nextId: 1 };
}

export function clearStatusEffects(runtime: StatusRuntime): void {
  runtime.effects.length = 0;
  runtime.resistances.length = 0;
  runtime.recovery = {};
}

export function updateStatusEffects(runtime: StatusRuntime, now: number, alive = true): void {
  if (!alive) return clearStatusEffects(runtime);
  runtime.effects = runtime.effects.filter((effect) => effect.endsAt > now);
  runtime.resistances = runtime.resistances.filter((effect) => effect.endsAt > now);
}

export function applyStatus(
  runtime: StatusRuntime,
  kind: StatusKind,
  factor: number,
  durationSeconds: number,
  now: number,
  source = -1,
  passiveResistance = 0,
): boolean {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || !Number.isFinite(factor) || !Number.isFinite(now)) return false;
  updateStatusEffects(runtime, now);
  let duration = Math.min(ABILITY_RULES.maxStatusSeconds, durationSeconds) * 1000;
  if (kind !== 'speed') {
    let resistance = (kind === 'slow' || kind === 'silence') && Number.isFinite(passiveResistance) ? Math.max(0, Math.min(0.8, passiveResistance)) : 0;
    for (const entry of runtime.resistances) if (entry.kinds.includes(kind)) resistance = Math.max(resistance, entry.factor);
    if (resistance >= 1) return false;
    duration = Math.max(ABILITY_RULES.minDebuffMs, duration * (1 - resistance));
  }
  const hardControl = kind === 'root' || kind === 'silence';
  if (hardControl) {
    if (now < (runtime.recovery[kind] ?? 0)) return false;
    duration = Math.min(duration, ABILITY_RULES.maxHardControlMs);
    runtime.recovery[kind] = now + duration + ABILITY_RULES.hardControlRecoveryMs;
  }
  const magnitude = kind === 'slow' ? Math.max(ABILITY_RULES.minSlowFactor, Math.min(1, factor))
    : kind === 'speed' ? Math.max(1, Math.min(ABILITY_RULES.maxSpeedFactor, factor)) : 1;
  const previous = runtime.effects.find((effect) => effect.kind === kind && effect.source === source && effect.factor === magnitude);
  if (previous) {
    // Each source refreshes its own effect only; a stronger short slow cannot inherit another source's duration.
    previous.endsAt = Math.max(previous.endsAt, now + duration);
    return true;
  }
  runtime.effects.push({ id: runtime.nextId++, kind, source, factor: magnitude, startedAt: now, endsAt: now + duration });
  return true;
}

/** Removes only permitted negative tags and adds bounded, temporary resistance to those same tags. */
export function cleanseStatusEffects(runtime: StatusRuntime, kinds: readonly DebuffKind[], now: number, resistance = 0, durationSeconds = 0): number {
  updateStatusEffects(runtime, now);
  const before = runtime.effects.length;
  runtime.effects = runtime.effects.filter((effect) => !kinds.includes(effect.kind as DebuffKind));
  if (Number.isFinite(resistance) && resistance > 0 && Number.isFinite(durationSeconds) && durationSeconds > 0) {
    runtime.resistances.push({ kinds: [...kinds], factor: Math.max(0, Math.min(1, resistance)), endsAt: now + Math.min(ABILITY_RULES.maxStatusSeconds, durationSeconds) * 1000 });
  }
  return before - runtime.effects.length;
}

/** Strongest active slow/speed win independently. Slow stacks never multiply each other. */
export function statusModifiers(runtime: StatusRuntime | undefined, now: number): StatusModifiers {
  const modifiers: StatusModifiers = { speedFactor: 1, rooted: false, silenced: false, noSprint: false };
  if (!runtime) return modifiers;
  let slow = 1;
  let speed = 1;
  for (const effect of runtime.effects) {
    if (effect.endsAt <= now) continue;
    switch (effect.kind) {
      case 'slow': slow = Math.min(slow, effect.factor); break;
      case 'speed': speed = Math.max(speed, effect.factor); break;
      case 'root': modifiers.rooted = true; break;
      case 'silence': modifiers.silenced = true; break;
      case 'noSprint': modifiers.noSprint = true; break;
    }
  }
  modifiers.speedFactor = modifiers.rooted ? 0 : Math.min(ABILITY_RULES.maxSpeedFactor, Math.max(ABILITY_RULES.minSlowFactor, slow * speed));
  return modifiers;
}
