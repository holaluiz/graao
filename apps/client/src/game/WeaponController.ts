/**
 * Local weapon state: fire timing, predicted ammo, reload and slot switching for the local player.
 *
 * Everything here is a PREDICTION so firing feels instant; the server owns the truth (fire rate, ammo, reload,
 * damage) and corrects us through SELF status messages. Fire timing mirrors the server's rules (same WeaponDefinition)
 * so honest clients are never rejected.
 */
import { WEAPONS, WEAPON_SLOTS, type WeaponDefinition } from '@graao/game-data';
import type { SelfStatusMsg } from '@graao/shared';

export interface FireIntent {
  seq: number;
  slot: number;
  weapon: WeaponDefinition;
}

export interface WeaponInput {
  fireHeld: boolean;
  firePressed: boolean;
  reloadPressed: boolean;
  /** Slot requested this frame (E = 0, Q = 1), or -1. */
  switchTo: number;
}

/** Same equip delay as the server (ms). */
const SWITCH_DELAY_MS = 220;
/** A click this early before the weapon is ready still fires (semi-automatic buffer, ms). */
const CLICK_BUFFER_MS = 160;

export class WeaponController {
  slot = 0;
  readonly ammo: number[] = WEAPON_SLOTS.map((id) => WEAPONS[id].magazine);
  /** Local clock (performance.now) when the reload completes, 0 when not reloading. */
  reloadEndsAt = 0;
  private reloadStartedAt = 0;
  private reloadDoneAt = -1e9;
  private readonly lastShotAt: number[] = WEAPON_SLOTS.map(() => -1e9);
  private equipReadyAt = 0;
  private seq = 0;
  private clickAt = -1e9;
  /** Local shots the server has not handled yet (by FIRE sequence), with their local time. */
  private readonly inFlight: { seq: number; t: number }[] = [];
  /** Reticle bloom 0..1 (decays). */
  bloom = 0;

  get weapon(): WeaponDefinition {
    return WEAPONS[WEAPON_SLOTS[this.slot]!];
  }

  get reloading(): boolean {
    return this.reloadEndsAt > 0;
  }

  /** 0..1 reload progress, or -1 when not reloading. */
  reloadProgress(now: number): number {
    if (!this.reloading) return -1;
    const total = this.reloadEndsAt - this.reloadStartedAt;
    return total > 0 ? Math.min(1, (now - this.reloadStartedAt) / total) : 1;
  }

  /** Back to a fresh loadout (spawn, match start). */
  reset(): void {
    WEAPON_SLOTS.forEach((id, i) => (this.ammo[i] = WEAPONS[id].magazine));
    this.reloadEndsAt = 0;
    this.inFlight.length = 0;
    this.bloom = 0;
  }

  /**
   * Advances timers and turns input into at most one fire intent per frame, plus side effects reported through the
   * returned flags (switch / reload / empty) for presentation and networking.
   */
  update(dt: number, now: number, input: WeaponInput, canFire: boolean): { fire: FireIntent | null; switched: boolean; reloadStarted: boolean; empty: boolean } {
    const out = { fire: null as FireIntent | null, switched: false, reloadStarted: false, empty: false };
    this.bloom = Math.max(0, this.bloom - dt * (this.weapon.automatic ? 2.6 : 1.8));
    if (this.reloading && now >= this.reloadEndsAt) {
      this.ammo[this.slot] = this.weapon.magazine;
      this.reloadEndsAt = 0;
      this.reloadDoneAt = now;
    }
    if (input.switchTo >= 0 && input.switchTo !== this.slot) {
      this.slot = input.switchTo;
      this.reloadEndsAt = 0;
      this.equipReadyAt = now + SWITCH_DELAY_MS;
      out.switched = true;
    }
    if (input.reloadPressed && this.startReload(now)) out.reloadStarted = true;
    if (input.firePressed) this.clickAt = now;

    const w = this.weapon;
    const wants = w.automatic ? input.fireHeld || now - this.clickAt < CLICK_BUFFER_MS : now - this.clickAt < CLICK_BUFFER_MS;
    const ready = now - this.lastShotAt[this.slot]! >= 1000 / w.fireRate && now >= this.equipReadyAt;
    if (canFire && wants && ready && !this.reloading) {
      if (this.ammo[this.slot]! <= 0) {
        if (input.firePressed) out.empty = true;
        if (this.startReload(now)) out.reloadStarted = true;
      } else {
        this.clickAt = -1e9;
        this.lastShotAt[this.slot] = now;
        this.ammo[this.slot]! -= 1;
        this.seq = (this.seq + 1) & 0x7fffffff;
        this.inFlight.push({ seq: this.seq, t: now });
        this.bloom = Math.min(1, this.bloom + (w.automatic ? 0.22 : 0.8));
        out.fire = { seq: this.seq, slot: this.slot, weapon: w };
        // The server auto-reloads an emptied magazine; predict it.
        if (this.ammo[this.slot] === 0 && this.startReload(now)) out.reloadStarted = true;
      }
    }
    return out;
  }

  startReload(now: number): boolean {
    if (this.reloading || this.ammo[this.slot]! >= this.weapon.magazine) return false;
    this.reloadStartedAt = now;
    this.reloadEndsAt = now + this.weapon.reloadTime * 1000;
    return true;
  }

  /**
   * Server correction. Shots newer than the status' `shotSeq` are still in flight and stay subtracted; `rttMs` sizes the
   * grace windows for reload agreement; `serverToLocal` maps a server timestamp to the local performance.now clock.
   */
  applyServer(s: SelfStatusMsg, now: number, rttMs: number, serverToLocal: (t: number) => number): void {
    const window = rttMs * 1.25 + 40;
    // Handled by the server (accepted or refused), or lost: no longer in flight.
    for (let i = this.inFlight.length - 1; i >= 0; i--) {
      const f = this.inFlight[i]!;
      if ((s.shotSeq >= 0 && !seqGreater(f.seq, s.shotSeq)) || now - f.t > 2000) this.inFlight.splice(i, 1);
    }
    if (s.weapon !== this.slot && now >= this.equipReadyAt + window) this.slot = s.weapon;
    // A reload we finished locally a moment ago: the server's own copy lags by about the RTT.
    const justReloaded = now - this.reloadDoneAt < window;
    for (let i = 0; i < this.ammo.length; i++) {
      if (i !== this.slot) {
        this.ammo[i] = s.ammo[i] ?? this.ammo[i]!;
        continue;
      }
      if (s.reloading && (this.reloading || justReloaded)) continue; // both agree on a reload: trust the local timer
      this.ammo[i] = Math.max(0, (s.ammo[i] ?? this.ammo[i]!) - this.inFlight.length);
    }
    if (s.reloading && !this.reloading && !justReloaded) {
      this.reloadStartedAt = now;
      this.reloadEndsAt = serverToLocal(s.reloadEndsAt);
    } else if (!s.reloading && this.reloading && now - this.reloadStartedAt > window) {
      // The server refused (full magazine) or never started it.
      this.reloadEndsAt = 0;
    }
  }
}

/** a > b with 31-bit wraparound (same rule as the server). */
const seqGreater = (a: number, b: number) => a !== b && ((a - b) & 0x7fffffff) < 0x40000000;
