/**
 * Local weapon state: fire timing, predicted ammo, reload and slot switching for the local player.
 *
 * Everything here is a PREDICTION so firing feels instant; the server owns the truth (which weapon is in each slot,
 * fire rate, magazines, the reserve, reload, damage) and corrects us through SELF status messages. Fire timing
 * mirrors the server's rules (same WeaponDefinition) so honest clients are never rejected. A reload moves rounds from
 * the reserve of the weapon's ammunition type into the magazine, like the server's GRAInventory.
 */
import { AMMO_TYPES, STARTING_KIT, WEAPONS, WEAPON_SLOT_COUNT, type AmmoType, type WeaponDefinition, type WeaponId } from '@graao/game-data';
import { weaponShotInterval } from '@graao/game-core';
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

export interface WeaponKit {
  weapons: (WeaponId | null)[];
  reserve: Record<AmmoType, number>;
}

/** Same equip delay as the server (ms). */
const SWITCH_DELAY_MS = 220;
/** A click this early before the weapon is ready still fires (semi-automatic buffer, ms). */
const CLICK_BUFFER_MS = 160;

export class WeaponController {
  switchDelayFactor = 1;
  slot = 0;
  /** Weapon in each slot (null = empty), as the server last said (or the kit until it does). */
  readonly ids: (WeaponId | null)[] = new Array<WeaponId | null>(WEAPON_SLOT_COUNT).fill(null);
  readonly ammo: number[] = new Array<number>(WEAPON_SLOT_COUNT).fill(0);
  readonly reserve: Record<AmmoType, number> = { solar: 0, petal: 0, heavy: 0 };
  /** Offline exploring: reloads never spend the reserve (there is no loot without a server). */
  infinite = false;
  /** Velocidade de Ataque (from SELF): compatible weapons fire faster, each up to its own cap (weaponShotInterval). */
  attackSpeed = 1;
  /** Local clock (performance.now) when the reload completes, 0 when not reloading. */
  reloadEndsAt = 0;
  private reloadStartedAt = 0;
  private reloadDoneAt = -1e9;
  private readonly lastShotAt: number[] = new Array<number>(WEAPON_SLOT_COUNT).fill(-1e9);
  private equipReadyAt = 0;
  private seq = 0;
  private clickAt = -1e9;
  /** Local shots the server has not handled yet (by FIRE sequence), with their local time. */
  private readonly inFlight: { seq: number; t: number }[] = [];
  /** Reticle bloom 0..1 (decays). */
  bloom = 0;

  constructor(kit: WeaponKit = STARTING_KIT) {
    this.reset(kit);
  }

  /** The weapon in hand (the Raio de Sol's numbers stand in for an empty hand, which cannot fire). */
  get weapon(): WeaponDefinition {
    return WEAPONS[this.ids[this.slot] ?? 'sunbeam'];
  }

  /** There is a weapon in the selected slot: the attack shoots. Without one (no weapon at all) it punches. */
  get armed(): boolean {
    return !!this.ids[this.slot];
  }

  get reloading(): boolean {
    return this.reloadEndsAt > 0;
  }

  /** Reserve rounds for the weapon in `slot` (0 for an empty slot). */
  reserveFor(slot: number): number {
    const id = this.ids[slot];
    return id ? this.reserve[WEAPONS[id].ammo] : 0;
  }

  /** 0..1 reload progress, or -1 when not reloading. */
  reloadProgress(now: number): number {
    if (!this.reloading) return -1;
    const total = this.reloadEndsAt - this.reloadStartedAt;
    return total > 0 ? Math.min(1, (now - this.reloadStartedAt) / total) : 1;
  }

  /** Back to a fresh kit (spawn, boarding, match start); the server's SELF follows with the truth. */
  reset(kit: WeaponKit = STARTING_KIT, infinite = this.infinite): void {
    this.infinite = infinite;
    for (let i = 0; i < WEAPON_SLOT_COUNT; i++) {
      const id = kit.weapons[i] ?? null;
      this.ids[i] = id;
      this.ammo[i] = id ? WEAPONS[id].magazine : 0;
    }
    for (const t of AMMO_TYPES) this.reserve[t] = kit.reserve[t];
    this.slot = Math.max(0, this.ids.findIndex((x) => x));
    this.reloadEndsAt = 0;
    this.inFlight.length = 0;
    this.bloom = 0;
  }

  /**
   * Advances timers and turns input into at most one fire intent per frame, plus side effects reported through the
   * returned flags (switch / reload / empty / no reserve) for presentation and networking.
   */
  update(dt: number, now: number, input: WeaponInput, canFire: boolean): { fire: FireIntent | null; switched: boolean; reloadStarted: boolean; empty: boolean; dry: boolean } {
    const out = { fire: null as FireIntent | null, switched: false, reloadStarted: false, empty: false, dry: false };
    this.bloom = Math.max(0, this.bloom - dt * (this.weapon.automatic ? 2.6 : 1.8));
    if (this.reloading && now >= this.reloadEndsAt) {
      this.completeReload();
      this.reloadEndsAt = 0;
      this.reloadDoneAt = now;
    }
    // E / Q take that weapon in hand.
    if (input.switchTo >= 0 && input.switchTo !== this.slot && this.ids[input.switchTo]) {
      this.slot = input.switchTo;
      this.reloadEndsAt = 0;
      this.equipReadyAt = now + Math.max(80, SWITCH_DELAY_MS * this.switchDelayFactor);
      out.switched = true;
    }
    if (input.reloadPressed) {
      if (this.startReload(now)) out.reloadStarted = true;
      else if (this.armed && this.ammo[this.slot]! < this.weapon.magazine && this.reserveFor(this.slot) <= 0 && !this.infinite) out.dry = true;
    }
    if (input.firePressed) this.clickAt = now;

    const w = this.weapon;
    const wants = w.automatic ? input.fireHeld || now - this.clickAt < CLICK_BUFFER_MS : now - this.clickAt < CLICK_BUFFER_MS;
    const ready = now - this.lastShotAt[this.slot]! >= weaponShotInterval(w, this.attackSpeed) && now >= this.equipReadyAt;
    if (canFire && this.armed && wants && ready && !this.reloading) {
      if (this.ammo[this.slot]! <= 0) {
        if (input.firePressed) out.empty = true;
        if (this.startReload(now)) out.reloadStarted = true;
        else if (input.firePressed) out.dry = true;
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

  /** Rounds a reload of the selected slot would move now (same rule as the server's `reloadAmount`). */
  private reloadAmount(): number {
    if (!this.armed) return 0;
    const room = this.weapon.magazine - this.ammo[this.slot]!;
    return this.infinite ? room : Math.max(0, Math.min(room, this.reserveFor(this.slot)));
  }

  private completeReload(): void {
    const n = this.reloadAmount();
    this.ammo[this.slot]! += n;
    if (!this.infinite) this.reserve[this.weapon.ammo] -= n;
  }

  startReload(now: number): boolean {
    if (this.reloading || this.reloadAmount() <= 0) return false;
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
    // What is in each slot is never predicted: a pickup, a swap or a death drop changes it on the server only.
    let changed = false;
    for (let i = 0; i < WEAPON_SLOT_COUNT; i++) {
      const id = (s.wpn?.[i] || null) as WeaponId | null;
      if (s.wpn && id !== this.ids[i]) {
        this.ids[i] = id;
        changed = true;
      }
    }
    if (changed && !this.ids[this.slot]) this.reloadEndsAt = 0;
    if (s.weapon !== this.slot && (now >= this.equipReadyAt + window || changed || !this.ids[this.slot])) {
      this.slot = s.weapon;
      this.reloadEndsAt = 0;
    }
    // A reload we finished locally a moment ago: the server's own copy lags by about the RTT.
    const justReloaded = now - this.reloadDoneAt < window;
    const agreeOnReload = s.reloading && (this.reloading || justReloaded);
    for (let i = 0; i < this.ammo.length; i++) {
      if (i !== this.slot || changed) {
        this.ammo[i] = s.ammo[i] ?? this.ammo[i]!;
        continue;
      }
      if (agreeOnReload) continue; // both agree on a reload: trust the local timer
      this.ammo[i] = Math.max(0, (s.ammo[i] ?? this.ammo[i]!) - this.inFlight.length);
    }
    if (s.res) {
      const busy = agreeOnReload && this.armed ? this.weapon.ammo : null;
      AMMO_TYPES.forEach((t, i) => {
        if (t !== busy) this.reserve[t] = s.res[i] ?? this.reserve[t];
      });
    }
    if (s.reloading && !this.reloading && !justReloaded) {
      this.reloadStartedAt = now;
      this.reloadEndsAt = serverToLocal(s.reloadEndsAt);
    } else if (!s.reloading && this.reloading && now - this.reloadStartedAt > window) {
      // The server refused (full magazine, no reserve) or never started it.
      this.reloadEndsAt = 0;
    }
  }
}

/** a > b with 31-bit wraparound (same rule as the server). */
const seqGreater = (a: number, b: number) => a !== b && ((a - b) & 0x7fffffff) < 0x40000000;
