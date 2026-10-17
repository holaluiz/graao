/**
 * Local ability state: the client's MIRROR of the server's Mana, cooldowns and wind-up for the local player, used to
 * predict presentation (cast animation, telegraph, projectile, cooldown sweep) so a cast feels instant.
 *
 * It never decides eligibility. Every key press becomes an ABILITY_REQUEST; the server answers with ABILITY_RESULT
 * (accepted, or refused with a reason) and SELF (cooldown end times, wind-up, Mana). A press is only *predicted* when
 * the mirror expects acceptance; refused predictions are rolled back, unpredicted acceptances are presented late.
 */
import { checkCast } from '@graao/game-core';
import { ABILITIES, ATTRIBUTES, DEFAULT_LOADOUTS, LOADOUT_SLOTS, ULTIMATE_SLOT, type AbilityDefinition, type AbilityId } from '@graao/game-data';
import { AbilityReject, type AbilityResultMsg, type SelfStatusMsg } from '@graao/shared';

export interface AbilityPress {
  seq: number;
  slot: number;
  id: AbilityId;
  def: AbilityDefinition;
  /** The mirror expects the server to accept: present it now. */
  predicted: boolean;
}

interface InFlight {
  seq: number;
  slot: number;
  cost: number;
  t: number;
  predicted: boolean;
  /** Mirror values before the prediction (restored on refusal). */
  prevCd: number;
}

export class AbilityController {
  loadout: AbilityId[] = [...DEFAULT_LOADOUTS[0]!];
  /** Local clock (performance.now) when each slot's cooldown ends; 0 = ready. */
  readonly cdEnd: number[] = new Array<number>(LOADOUT_SLOTS).fill(0);
  /** Cooldown length (ms) the sweep is drawn against. */
  readonly cdTotal: number[] = this.loadout.map((id) => ABILITIES[id].cooldown * 1000);
  /** Local clock when the current wind-up ends, and the slot winding up (presentation). */
  castEnd = 0;
  castSlot = -1;
  /** Authoritative Mana (snapshots / SELF). */
  mana: number = ATTRIBUTES.maxMana;
  /** Local clock when the current slow ends, and its factor. */
  slowEnd = 0;
  slowFactor = 1;
  private seq = 0;
  private readonly inFlight: InFlight[] = [];

  setLoadout(ids: readonly string[]): void {
    if (ids.length !== LOADOUT_SLOTS || !ids.every((id) => id in ABILITIES)) return;
    for (let i = 0; i < LOADOUT_SLOTS; i++) {
      if (this.loadout[i] !== ids[i]) this.cdTotal[i] = ABILITIES[ids[i] as AbilityId].cooldown * 1000;
      this.loadout[i] = ids[i] as AbilityId;
    }
  }

  def(slot: number): AbilityDefinition {
    return ABILITIES[this.loadout[slot]!];
  }

  /** Mana the HUD shows: the server's value minus predicted costs the server has not answered yet. */
  get manaShown(): number {
    let m = this.mana;
    for (const f of this.inFlight) if (f.predicted) m -= f.cost;
    return Math.max(0, Math.floor(m + 1e-6));
  }

  casting(now: number): boolean {
    return now < this.castEnd;
  }

  /** Seconds left on a slot's cooldown (mirror). */
  cooldownLeft(slot: number, now: number): number {
    return Math.max(0, (this.cdEnd[slot]! - now) / 1000);
  }

  /** 0..1 of the cooldown still to run (sweep). */
  cooldownFrac(slot: number, now: number): number {
    const left = this.cdEnd[slot]! - now;
    return left > 0 ? Math.min(1, left / Math.max(1, this.cdTotal[slot]!)) : 0;
  }

  /** What the mirror expects the server to answer for this slot now (presentation only). */
  expect(slot: number, now: number, alive: boolean, canFight: boolean): AbilityReject {
    return checkCast(
      { alive, canFight, mana: this.manaShown, loadout: this.loadout, cooldownEnds: this.cdEnd, castUntil: this.castEnd },
      slot,
      this.loadout[slot]!,
      now,
    );
  }

  /** A key press: always a request; predicted (cooldown, wind-up and Mana mirrored at once) when expected to pass. */
  press(slot: number, now: number, alive: boolean, canFight: boolean): AbilityPress {
    const def = this.def(slot);
    const predicted = this.expect(slot, now, alive, canFight) === AbilityReject.OK;
    this.seq = (this.seq + 1) & 0x7fffffff;
    const f: InFlight = { seq: this.seq, slot, cost: def.manaCost, t: now, predicted, prevCd: this.cdEnd[slot]! };
    this.inFlight.push(f);
    if (predicted) {
      this.cdEnd[slot] = now + def.cooldown * 1000;
      this.cdTotal[slot] = def.cooldown * 1000;
      this.castEnd = now + def.castTime * 1000;
      this.castSlot = slot;
    }
    return { seq: this.seq, slot, id: def.id, def, predicted };
  }

  /**
   * Server answer. Returns what presentation must do: `rollback` (predicted but refused), `late` (accepted without
   * prediction: present it now), or nothing.
   */
  onResult(r: AbilityResultMsg): { rollback: boolean; late: boolean; reason: AbilityReject } {
    const i = this.inFlight.findIndex((f) => f.seq === r.s);
    if (i < 0) return { rollback: false, late: false, reason: r.r };
    const f = this.inFlight[i]!;
    this.inFlight.splice(i, 1);
    if (!r.ok && f.predicted) {
      this.cdEnd[f.slot] = f.prevCd;
      this.castEnd = 0;
      return { rollback: true, late: false, reason: r.r };
    }
    return { rollback: false, late: r.ok && !f.predicted, reason: r.r };
  }

  /** Authoritative status. Slots with a request still in flight keep their prediction until the answer arrives. */
  applyServer(s: SelfStatusMsg, now: number, serverNow: number, serverToLocal: (t: number) => number): void {
    for (let i = this.inFlight.length - 1; i >= 0; i--) if (now - this.inFlight[i]!.t > 2000) this.inFlight.splice(i, 1);
    const busy = new Set(this.inFlight.map((f) => f.slot));
    for (let k = 0; k < LOADOUT_SLOTS; k++) {
      if (busy.has(k)) continue;
      const end = s.cd[k] ?? 0;
      const local = end > serverNow ? serverToLocal(end) : 0;
      // A cooldown the mirror did not have (first Ultimate charge, an unpredicted cast) sweeps from full.
      if (local > 0 && this.cdEnd[k]! <= now) this.cdTotal[k] = Math.max(1, local - now);
      this.cdEnd[k] = local;
    }
    if (!this.inFlight.some((f) => f.predicted)) this.castEnd = s.castUntil > serverNow ? serverToLocal(s.castUntil) : 0;
    this.mana = s.mana;
    this.slowEnd = s.slowUntil > serverNow ? serverToLocal(s.slowUntil) : 0;
    this.slowFactor = s.slow / 100;
  }

  /** The speed multiplier the local prediction applies now (mirrors the server's slow). */
  slowNow(now: number): number {
    return now < this.slowEnd ? this.slowFactor : 1;
  }

  /** Fresh life (respawn, match start): the server's next SELF brings the exact cooldowns. */
  reset(): void {
    this.inFlight.length = 0;
    this.castEnd = 0;
    this.slowEnd = 0;
    this.slowFactor = 1;
  }

  get ultimateSlot(): number {
    return ULTIMATE_SLOT;
  }
}
