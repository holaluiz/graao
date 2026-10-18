/** Authoritative per-player state on the server (movement, vitals, weapons, abilities). */
import type { Client } from '@colyseus/core';
import { manaShown, newAbilityRuntime, passiveModifiers, statusModifiers, newInput, newInventory, newVitals, type AbilityActor, type CharacterBody, type CharacterInput, type CharacterState, type Inventory, type LootActor, type Vitals } from '@graao/game-core';
import { ABILITIES, AMMO_TYPES, BOT_KIT, CONSUMABLE_ORDER, LOADOUT_SLOTS, MOVEMENT, STARTING_KIT, WEAPON_SLOT_COUNT, type Loadout } from '@graao/game-data';
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

export class ServerPlayer implements AbilityActor, LootActor {
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
  /** Weapons (with their magazines), reserve ammunition and consumables (GRAInventory). */
  inv: Inventory;
  /** Slot being reloaded, or -1. */
  reloading = -1;
  reloadEndsAt = 0;
  readonly lastShotAt: number[] = new Array<number>(WEAPON_SLOT_COUNT).fill(0);
  /** Consumable in use (see LootActor). */
  useUntil = 0;
  useItem = -1;
  readonly useReadyAt: number[] = CONSUMABLE_ORDER.map(() => 0);
  lootSeq = -1;
  lootAt = 0;
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
  runtime = newAbilityRuntime(Date.now());
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
  ) {
    this.inv = this.freshInventory();
  }

  /** A fresh life's inventory: the starting kit (bots: the classic two weapons, reserve never runs out). */
  freshInventory(): Inventory {
    return this.bot ? newInventory(BOT_KIT, true) : newInventory(STARTING_KIT);
  }

  status(): SelfStatusMsg {
    const now = Date.now();
    const passive = passiveModifiers(this.loadout, this.runtime.passive, now, this.vitals.alive);
    const status = statusModifiers(this.runtime, now);
    const until = (kind: string) => Math.max(0, ...this.runtime.effects.filter((e) => e.kind === kind && e.endsAt > now).map((e) => e.endsAt));
    return {
      weapon: this.weapon,
      ammo: this.inv.slots.map((s) => s?.ammo ?? 0),
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
      wpn: this.inv.slots.map((s) => s?.id ?? ''),
      res: AMMO_TYPES.map((t) => this.inv.reserve[t]),
      inv: CONSUMABLE_ORDER.map((c) => this.inv.consumables[c]),
      useUntil: this.useUntil,
      useItem: this.useItem,
      tempShield: this.vitals.temporaryShield ?? 0,
      tempShieldUntil: this.vitals.temporaryShieldUntil ?? 0,
      silencedUntil: until('silence'),
      rootedUntil: until('root'),
      noSprintUntil: until('noSprint'),
      blockedUntil: this.state.abilityMovement?.mode === 'flight' ? now + this.state.abilityMovement.remaining * 1000 : 0,
      passiveActive: this.loadout.map((id) => ABILITIES[id].kind === 'passive' && this.runtime.passive.active),
      speed: Math.round(passive.speed * status.speedFactor * 100),
      airControl: Math.round(passive.airControl * 100),
      abilityMovement: this.state.abilityMovement ? { ...this.state.abilityMovement } : null,
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
