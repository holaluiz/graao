/** Authoritative per-player state on the server (movement, vitals, weapons, abilities). */
import type { Client } from '@colyseus/core';
import { manaShown, newInput, newVitals, type AbilityActor, type CharacterBody, type CharacterInput, type CharacterState, type Vitals } from '@graao/game-core';
import { LOADOUT_SLOTS, MOVEMENT, WEAPONS, WEAPON_SLOTS, type Loadout } from '@graao/game-data';
import { DeployState, type CharacterAppearance, type InputCmd, type SelfStatusMsg, type Vec3 } from '@graao/shared';

/** A dash accepted by the ability system, started when movement command `seq` is simulated. */
export interface PendingDash {
  seq: number;
  dir: Vec3;
  distance: number;
  duration: number;
}

/** Server-controlled players only need an identity and a sink for private messages. */
export type PlayerConnection = Pick<Client, 'sessionId' | 'send'>;

export class ServerPlayer implements AbilityActor {
  readonly queue: InputCmd[] = [];
  lastSeq = -1;
  budget = 2;
  starvedFor = 0;
  /** Server-clock time (ms) at which this player's simulated state is valid; advances 1/60 s per command. */
  simTime = 0;
  ready = false;
  connected = true;
  /** Connection lost, seat kept while the client reconnects (still counts as present for the match rules). */
  dropped = false;
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
  /** Shield + Health removed from opponents in the current round. */
  damageDealt = 0;
  /** Matches won in this room (the room's running score). */
  wins = 0;
  /** RESULTS: asked to go back to the lobby. */
  back = false;
  /** Supabase user id verified from the join token; null for a guest. */
  profileId: string | null = null;
  /** UFO deployment progress (aboard → diving → landed); NONE outside a deployment. */
  deploy: DeployState = DeployState.NONE;
  /** Air left (s) under water, advanced with every simulated command; `drownT` counts toward the next drowning tick. */
  breath: number = MOVEMENT.breathTime;
  drownT = 0;

  // Abilities (owned by the server; the draft will replace the loadout in Phase 6).
  readonly cooldownEnds: number[] = new Array<number>(LOADOUT_SLOTS).fill(0);
  castUntil = 0;
  /** Ultimate or basic being wound up (for the replicated action state). */
  castUltimate = false;
  slowUntil = 0;
  slowFactor = 1;
  lastAbilitySeq = -1;
  pendingDash: PendingDash | null = null;
  private lastStatusKey = '';

  constructor(
    public client: PlayerConnection,
    readonly index: number,
    public name: string,
    public appearance: CharacterAppearance,
    public state: CharacterState,
    public body: CharacterBody,
    public loadout: Loadout,
    readonly bot = false,
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
      mana: manaShown(this.vitals),
      cd: [...this.cooldownEnds],
      castUntil: this.castUntil,
      abilitySeq: this.lastAbilitySeq,
      slowUntil: this.slowUntil,
      slow: Math.round(this.slowFactor * 100),
    };
  }

  /**
   * Returns the status when it changed since the last call (so it is sent only on change). Mana regenerates every
   * tick and already rides in each snapshot, so it does not count as a change; `force` sends it anyway (after a cast).
   */
  statusIfChanged(force = false): SelfStatusMsg | null {
    const s = this.status();
    const key = JSON.stringify({ ...s, mana: 0 });
    if (key === this.lastStatusKey && !force) return null;
    this.lastStatusKey = key;
    return s;
  }
}
