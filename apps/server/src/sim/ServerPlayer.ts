/** Authoritative per-player state on the server (movement, vitals, weapons). */
import type { Client } from '@colyseus/core';
import { newInput, newVitals, type CharacterBody, type CharacterInput, type CharacterState, type Vitals } from '@graao/game-core';
import { WEAPONS, WEAPON_SLOTS } from '@graao/game-data';
import type { CharacterAppearance, InputCmd, SelfStatusMsg } from '@graao/shared';

export class ServerPlayer {
  readonly queue: InputCmd[] = [];
  lastSeq = -1;
  budget = 2;
  starvedFor = 0;
  /** Server-clock time (ms) at which this player's simulated state is valid; advances 1/60 s per command. */
  simTime = 0;
  ready = false;
  connected = true;
  /** Takes part in the running match (set at match start; late joiners watch). */
  inMatch = false;
  vitals: Vitals = newVitals();
  readonly input: CharacterInput = newInput();

  /** Equipped weapon slot (0 = E, 1 = Q). */
  weapon = 0;
  readonly ammo: number[] = WEAPON_SLOTS.map((id) => WEAPONS[id].magazine);
  /** Slot being reloaded, or -1. */
  reloading = -1;
  reloadEndsAt = 0;
  readonly lastShotAt: number[] = WEAPON_SLOTS.map(() => 0);
  lastShotSeq = -1;
  /** Last FIRE sequence received (accepted or refused), echoed in the status so clients can reconcile ammo. */
  lastFireSeen = -1;
  /** Show the FIRE action state until this time (ms). */
  fireUntil = 0;
  respawnAt = 0;
  kills = 0;
  deaths = 0;
  private lastStatusKey = '';

  constructor(
    readonly client: Client,
    readonly index: number,
    public name: string,
    public appearance: CharacterAppearance,
    public state: CharacterState,
    public body: CharacterBody,
  ) {}

  status(): SelfStatusMsg {
    return {
      weapon: this.weapon,
      ammo: [...this.ammo],
      reloading: this.reloading >= 0,
      reloadEndsAt: this.reloading >= 0 ? this.reloadEndsAt : 0,
      alive: this.vitals.alive,
      respawnAt: this.vitals.alive ? 0 : this.respawnAt,
      shotSeq: this.lastFireSeen,
    };
  }

  /** Returns the status when it changed since the last call (so it is sent only on change). */
  statusIfChanged(): SelfStatusMsg | null {
    const s = this.status();
    const key = JSON.stringify(s);
    if (key === this.lastStatusKey) return null;
    this.lastStatusKey = key;
    return s;
  }
}
