/**
 * GraaoMatchRoom: one authoritative graao match. Clients send intent only (input commands, fire/reload/switch
 * requests); the room owns movement, timing, ammo, damage, death and every other gameplay consequence.
 * Room ids are short human codes (GR-7K2M).
 *
 * Movement: each client command is one fixed SIM step of the shared GraaoSphericalCharacterController. A per-player
 * budget refills at SIM_HZ in real time, so a client can never move faster than real time (speed-hack guard), and
 * a bounded backlog absorbs jitter.
 *
 * Combat: hitscan resolved on the server from the shooter's camera ray (origin clamped near the shooter), with a
 * muzzle line-of-sight check and deterministic spread. Fire rate, ammo, reload and weapon switching are validated here.
 *
 * Abilities: ABILITY_REQUEST is validated and executed by the GRAAbilitySystem (game-core) with this room as its
 * host: Mana, cooldowns, wind-ups, server projectiles, areas, and dashes started on the movement stream.
 *
 * Loot: the GRALootSystem (game-core) with this room as its host owns the chests, the items on the ground and every
 * transfer into an inventory (INTERACT, USE_ITEM). A new loot generation (chests rolled from a fresh seed) starts with
 * the room, with every match (boarding, or the start without the UFO) and back in the lobby. Weapons live in each
 * player's inventory slots (E, Q) with their magazines; a reload takes from the reserve of the weapon's ammunition.
 *
 * Match flow: LOBBY (planned bots, human readiness) → host START_MATCH → ABILITY_DRAFT (4 simultaneous rounds) →
 * PREPARATION (every human acknowledges loaded assets/world) → UFO (the ship flies a route over the arena; each participant jumps when they
 * like inside the window, or is dropped when it closes, and skydives down under their own control) → everyone
 * landed → MATCH (countdown, then weapons unlock, no respawns) → last participant standing wins → RESULTS (the
 * MatchLedger's summary goes to everyone and, once, to Supabase) → back to LOBBY when everyone asks
 * (RETURN_LOBBY) or the results time runs out. Rules live in `@graao/game-core` (match.ts, draft.ts, deploy.ts).
 *
 * Identity: `onAuth` verifies the Supabase access token (JWKS); a player without a valid one is a guest (or is
 * refused when GRAAO_REQUIRE_AUTH=1). Names and appearance are display data; only the verified id is identity.
 *
 * UFO: riders are not simulated (their position follows the ship; inputs are acknowledged and dropped). A jump
 * starts a dive from the exact state sent in the `jump` event, and from then on the rider's commands drive the
 * shared controller like on the ground. Nobody can deal or take damage until the fight starts.
 */
import { Room, ServerError, type AuthContext, type Client } from '@colyseus/core';
import { recordMatchPayload, type ParticipantInfo } from '@graao/database';
import {
  AbilityDraft,
  CharacterMotor,
  packTraversal,
  traversalAllowsCast,
  GRAAbilitySystem,
  GRATormentaSystem,
  applyTormentaDamage,
  MATCH_RULES,
  MatchLedger,
  applyAbilityDamage,
  applyDamage,
  applyDrowning,
  headUnderWater,
  stepBreath,
  createAbilityBarrier,
  passiveModifiers,
  recordPassiveCombat,
  resetAbilityRuntime,
  statusModifiers,
  updatePassives,
  updateStatusEffects,
  expireTemporaryShield,
  resolveTargetPoint,
  defaultLoadout,
  manaShown,
  regenMana,
  resetCooldowns,
  startDash,
  validateLoadout,
  createCharacterState,
  decideMatch,
  decodeInput,
  diveStart,
  everyoneLanded,
  everyoneReady,
  jumpOpen,
  landedInWater,
  makeUfoRoute,
  ufoHeading,
  ufoPosition,
  ufoSpeed,
  falloff,
  finishReload,
  reloadAmount,
  GRALootSystem,
  GRACreepSystem,
  InteractiveSystem,
  GROUPS_WORLD_QUERY,
  PLAYER_MELEE_BODY,
  addXp,
  allocateStat,
  botStatChoice,
  defendedDamage,
  roundWithCarry,
  rescaleVitals,
  weaponShotInterval,
  angularDistance,
  creepIdOf,
  maxHealthOf,
  maxManaOf,
  meleeReady,
  newProgression,
  progressionTuple,
  resolveMelee,
  statModifiers,
  type CreepHost,
  type CreepRuntime,
  type MeleeBody,
  type LootHost,
  latLonToDir,
  muzzlePoint,
  newVitals,
  northTangent,
  resolvePellet,
  shotSeed,
  spreadDirections,
  tormentaEdgeMeters,
  type AbilityActor,
  type AbilityHost,
  type GameWorld,
  type GamePhysics,
  type PlayerHitTarget,
  type TormentaConfig,
} from '@graao/game-core';
import { ABILITY_RULES, ARENA_CENTER, ATTRIBUTES, BOT_STAT_PROFILE_IDS, CREEP_RULES, CREEP_TYPE_IDS, ITEMS, LOOT_RULES, MAP_HASH, MATCH_SPAWNS, MELEE, MOVEMENT, SPAWNS, TORMENTA, TRAVERSAL_ACTIONS, UFO, ULTIMATE_SLOT, WEAPONS, randomAppearance, validateAppearance, type AbilityId, type BotStatProfile, type ItemId, type TormentaPhaseDef } from '@graao/game-data';
import {
  AbilityReject,
  AIM_SCALE,
  ActionState,
  C2S,
  CREEP_TARGET_BASE,
  ChestState,
  CLIENT_VERSION,
  CreepStateCode,
  FISTS_SLOT,
  DIR_SCALE,
  DeployState,
  DraftReject,
  FACING_SCALE,
  INPUT_JITTER_BUFFER,
  JoinError,
  LootAction,
  LootReject,
  MAX_INPUT_BACKLOG,
  MAX_MESSAGES_PER_SECOND,
  MAX_PLAYERS,
  MAX_SOLO_BOTS,
  MatchPhase,
  NoticeCode,
  PITCH_SCALE,
  POS_SCALE,
  STAMINA_SCALE,
  PROTOCOL_VERSION,
  RECONNECT_SECONDS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  ROOM_CODE_PREFIX,
  S2C,
  isRoomCode,
  roomStatusOf,
  type HostRoomReport,
  SERVER_TICK_HZ,
  SERVER_TICK_MS,
  SIM_DT,
  SIM_HZ,
  SNAPSHOT_HZ,
  SnapFlag,
  VEL_SCALE,
  WISH_SCALE,
  sanitizeName,
  v3normalize,
  v3projectOnPlane,
  validateAbilityRequest,
  validateAllocateStat,
  validateAppearanceUpdate,
  validateMelee,
  validateDevLoot,
  validateDraftPick,
  validateFire,
  validateInteract,
  validateInputMsg,
  validatePing,
  validateReady,
  validateRoomSettings,
  validatePrepared,
  validateReturnLobby,
  validateSwitch,
  validateUfoJump,
  validateUseItem,
  validateWorldUse,
  type AbilityResultMsg,
  type DamageCause,
  type EventsMsg,
  type GameEvent,
  type JoinOptions,
  type LootResultMsg,
  type MatchSummaryMsg,
  type NoticeMsg,
  type PlayerPublic,
  type PlayerSnap,
  type RoomStateMsg,
  type RoomMetadata,
  type PreparationState,
  type ProgressMsg,
  type SnapshotMsg,
  type UfoRouteMsg,
  type Vec3,
  type WelcomeMsg,
} from '@graao/shared';
import { authVerifier } from '../auth/SupabaseAuth';
import { hostPolicy } from '../hostPolicy';
import { serverConfig } from '../config';
import { matchStore } from '../persistence/MatchStore';
import { ServerPlayer, type PlayerConnection } from '../sim/ServerPlayer';
import { botIntent } from '../sim/BotBrain';
import { chooseBotAbility } from '../sim/BotAbilityController';
import { getChestSpots, getCreepAreas, getNav, getWorld } from '../world';
import { BotNavigator } from '../sim/BotNav';
import { log } from '../log';

/** What `onAuth` hands to `onJoin` (as `client.auth`). */
interface PlayerAuth {
  profileId: string | null;
  /** Graao Host: the joiner proved the room's owner key (null: this process has no owner keys). */
  owner: boolean | null;
}

const activeCodes = new Set<string>();

function newCode(): string {
  for (let tries = 0; tries < 1000; tries++) {
    let s = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) s += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
    const code = ROOM_CODE_PREFIX + s;
    if (!activeCodes.has(code)) return code;
  }
  throw new Error('no free room codes');
}

export interface RoomCreateOptions {
  roomName?: string;
  visibility?: 'public' | 'private';
  /** Explicit development/test warmup. Competitive rooms always start in LOBBY. */
  legacyWarmup?: boolean;
  /** Bounded, real client loading acknowledgement window. */
  preparationTimeoutMs?: number;
  maxPlayers?: number;
  /** Private practice room: one human and this many server-controlled opponents. Zero keeps ordinary multiplayer. */
  soloBots?: number;
  /** Room joinable by code with this many bots in the free seats (in the warmup a bot gives its seat to a person). */
  bots?: number;
  /** Overrides for tests and dev (clamped to sane ranges). */
  countdownMs?: number;
  resultsMs?: number;
  /** Dev/tests: start matches on the close free-roam spawns instead of the spread match spawns. */
  closeSpawns?: boolean;
  /** Tests: how long the Ultimate charges after a spawn or match start (ms). */
  ultimateChargeMs?: number;
  /** Dev/tests: READY goes straight to the match with the current loadouts (no Ability Draft). */
  skipDraft?: boolean;
  /** Tests: Ability Draft window lengths (ms). */
  draftPickMs?: number;
  draftRepickMs?: number;
  draftRevealMs?: number;
  /** Dev/tests: no UFO deployment; the match starts on the spawns right after the draft (or READY). */
  skipUfo?: boolean;
  /** Tests: UFO reveal and jump window lengths, and how long a diver may stay airborne after the window (ms). */
  ufoRevealMs?: number;
  ufoWindowMs?: number;
  ufoLandTimeoutMs?: number;
  /** Tests: how long a dropped connection keeps its seat (s). */
  reconnectSeconds?: number;
  /**
   * Dev/tests only (ignored in production): the Tormenta's phases, pulse and final damage, a fixed final centre, or
   * no Tormenta at all; and fixed fight spawns (lat/lon per seat) for matches that skip the UFO.
   */
  tormentaPhases?: TormentaPhaseDef[];
  tormentaPulseMs?: number;
  tormentaFinalDamage?: number;
  tormentaFinal?: { lat: number; lon: number };
  tormentaOff?: boolean;
  matchSpawns?: { lat: number; lon: number }[];
  /** Dev/tests only: free-roam (legacy warmup) spawn points by player index instead of `SPAWNS`. */
  freeRoamSpawns?: { lat: number; lon: number }[];
  /** Dev/tests only: a fixed loot seed (every generation uses it), spot ids that must hold a chest, and the chest count. */
  lootSeed?: number;
  lootSpots?: string[];
  chestCount?: number;
  /**
   * Creeps on the planet at once (0 turns them off), so a host can trade them for performance; clamped to 0..32.
   * Dev/tests only: a fixed creep seed, and Battle Royale empty hands in the development warmup too.
   */
  creepCount?: number;
  creepSeed?: number;
  unarmedStart?: boolean;
  /**
   * Graao Host only (honoured only in a process whose host policy admitted the create, i.e. the app's own command):
   * the code the central service allocated, the owner's display name, and the SHA-256 of the owner key that makes a
   * joiner the room's host.
   */
  presetCode?: string;
  hostName?: string;
  ownerKeyHash?: string;
}

/** Dev/tests may pick a loadout on join (JoinOptions.loadout); production always uses the server's (draft) loadout. */
const DEV = process.env.NODE_ENV !== 'production';
/** A dash may be scheduled at most this many movement commands ahead of the last one simulated. */
const MAX_DASH_LEAD = 240;

const clampMs = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(15000, Math.round(v))) : fallback);

/** Max distance (m) between the claimed camera origin and the shooter's head (camera boom + slack). */
const MAX_CAMERA_OFFSET = 7.5;
/** Accept shots slightly faster than the nominal rate (network jitter), never more. */
const FIRE_RATE_TOLERANCE = 0.85;
/** No firing right after a weapon switch (ms). */
const SWITCH_DELAY_MS = 220;
const mm = (v: Vec3): [number, number, number] => [Math.round(v.x * POS_SCALE), Math.round(v.y * POS_SCALE), Math.round(v.z * POS_SCALE)];

interface BotRuntime {
  seq: number;
  fireSeq: number;
  abilitySeq: number;
  nextAbilityAt: number;
  acc: number;
  target: number;
  acquiredAt: number;
  nextShotAt: number;
  /** Its way through the map (navigation graph paths). */
  nav: BotNavigator;
  /** The chest it is heading for while exploring (-1: none), since when, and its loot request sequence. */
  chest: number;
  chestSince: number;
  lootSeq: number;
  /** Chests given up (unreachable, emptied or taken by someone else) until this time. */
  skipChests: Map<number, number>;
  /** How it spends attribute points (by seat: agressivo, defensivo, mágico, equilibrado). */
  profile: BotStatProfile;
  /** The creep it is hunting for XP (-1: none), since when, and creeps given up until a time. */
  creep: number;
  creepSince: number;
  skipCreeps: Map<number, number>;
}

/** Bots fight directly within this range when they see their target; farther, they walk the navigation graph. */
const BOT_FIGHT_RANGE = 28;
/** With no opponent this close, a bot explores: the nearest closed chest within BOT_CHEST_RANGE. */
const BOT_CALM_RANGE = 38;
const BOT_CHEST_RANGE = 75;
/**
 * Farming: with a weapon and nobody to fight close by, a bot hunts the nearest creep it can take within
 * BOT_CREEP_RANGE; with empty hands only a basic creep this close (else it keeps looking for a chest). Below
 * BOT_HURT_FRACTION of its Health with no Shield it farms nothing and backs away from tough creeps.
 */
const BOT_CREEP_RANGE = 40;
const BOT_PUNCH_CREEP_RANGE = 9;
const BOT_HURT_FRACTION = 0.4;
/** A hunt that takes longer than this (ms) is given up for a while. */
const BOT_HUNT_MS = 25000;
/**
 * Empty hands: loot comes first. A bot punches an opponent only when that opponent hurt it this recently (ms), or when
 * no chest is left for it to head for — so a crowded landing does not turn into a fist brawl that ends the match.
 */
const BOT_RETALIATE_MS = 5000;

/** A point `distance` metres from `from` on its ground plane, straight away from `threat`. */
function awayFrom(from: Vec3, threat: Vec3, distance: number): Vec3 {
  const up = v3normalize(from);
  const d = v3projectOnPlane({ x: from.x - threat.x, y: from.y - threat.y, z: from.z - threat.z }, up);
  const l = Math.hypot(d.x, d.y, d.z);
  const t = l > 1e-4 ? { x: d.x / l, y: d.y / l, z: d.z / l } : v3normalize(v3projectOnPlane({ x: 0, y: 1, z: 0 }, up));
  return { x: from.x + t.x * distance, y: from.y + t.y * distance, z: from.z + t.z * distance };
}

export class GraaoMatchRoom extends Room {
  override maxClients = MAX_PLAYERS;
  override maxMessagesPerSecond = MAX_MESSAGES_PER_SECOND;
  override patchRate = null;

  private world!: GameWorld;
  private motor!: CharacterMotor;
  private readonly abilityColliders = new Set<number>();
  /** All room-owned geometry must be filtered: the underlying Rapier world serves multiple rooms. */
  private readonly roomCollider = (c: { handle: number }): boolean =>
    (!this.world.physics.barrierHandles.has(c.handle) || this.abilityColliders.has(c.handle))
    && (!this.interactives || this.interactives.predicate(c));

  private roomPhysics(): GamePhysics {
    const physics = this.world.physics;
    return {
      ...physics,
      castRay: (o, d, length, groups, predicate) => {
        const solid = physics.castRay(o, d, length, groups, (c) => this.roomCollider(c) && (!predicate || predicate(c)));
        const ability = (groups === undefined || groups === GROUPS_WORLD_QUERY) ? this.abilities?.occludeRay(o, d, length) : null;
        return ability && (!solid || ability.toi < solid.toi) ? ability : solid;
      },
      castRayNormal: (o, d, length, groups, predicate) => physics.castRayNormal(o, d, length, groups, (c) => this.roomCollider(c) && (!predicate || predicate(c))),
      boxOverlaps: (center, half, side, up, forward, groups, predicate) => physics.boxOverlaps(center, half, side, up, forward, groups, (c) => this.roomCollider(c) && (!predicate || predicate(c))),
      ballOverlaps: (center, radius, groups, predicate) => physics.ballOverlaps(center, radius, groups, (c) => this.roomCollider(c) && (!predicate || predicate(c))),
    };
  }
  private readonly players = new Map<string, ServerPlayer>();
  /** Private practice: one human, no one else may join. */
  private solo = false;
  /** Bots this room keeps in its free seats (warmup only: they never arrive or leave mid-match). */
  private botTarget = 0;
  /** Seats for people and bots together. */
  private seats: number = MAX_PLAYERS;
  /** Whether the running match had bots in it (practice: not saved to anyone's history). */
  private botsInMatch = false;
  private readonly bots = new Map<number, BotRuntime>();
  private phase: MatchPhase = MatchPhase.LOBBY;
  private legacyWarmup = false;
  private hostSessionId = '';
  /** Graao Host: who the room belongs to (display name) and the SHA-256 of their owner key. */
  private ownerName = '';
  private ownerKeyHash = '';
  private lobbyName = '';
  private visibility: 'public' | 'private' = 'public';
  private lastMetadata = '';
  private preparation: PreparationState | null = null;
  private preparationId = 0;
  private preparationTimeoutMs = 45000;
  private preparationAfterDraft = true;
  private phaseEndsAt = 0;
  private startsAt = 0;
  private winner = -1;
  private countdownMs: number = MATCH_RULES.countdownMs;
  private resultsMs: number = MATCH_RULES.resultsMs;
  private closeSpawns = false;
  private ultimateChargeMs: number = ABILITY_RULES.ultimateInitialCharge * 1000;
  private abilities!: GRAAbilitySystem;
  private skipDraft = false;
  private draftTimings: Partial<{ pickMs: number; repickMs: number; revealMs: number }> = {};
  private draft: AbilityDraft | null = null;
  private skipUfo = false;
  private ufoTimings: Partial<{ revealMs: number; windowMs: number }> = {};
  private landTimeoutMs: number = UFO.landTimeoutMs;
  private reconnectSeconds: number = RECONNECT_SECONDS;
  /** The ship's route while the UFO phase runs. */
  private ufo: UfoRouteMsg | null = null;
  /** The match's shrinking safe region (active from the fight start until the results). */
  private readonly tormenta = new GRATormentaSystem();
  private tormentaOff = false;
  private tormentaFinal: Vec3 | undefined;
  private matchSpawns: { lat: number; lon: number }[] | null = null;
  private freeRoamSpawns: { lat: number; lon: number }[] | null = null;
  /** The running match's own record (boarding → end); null outside a match. */
  private ledger: MatchLedger | null = null;
  /** Who each participant of the running match is (identity and look at the start), for persistence. */
  private roster = new Map<number, ParticipantInfo>();
  private tick = 0;
  private lastTickAt = 0;
  private snapshotAcc = 0;
  /** Moving average of tick CPU cost (ms). */
  private tickCost = 0;
  private events: GameEvent[] = [];
  /** Damage updates share one public-state broadcast per simulation tick. */
  private roomStateDirty = false;
  /** Chests and items on the ground (authoritative). */
  private loot!: GRALootSystem;
  /** Doors and breakable crates (authoritative; reset with every loot generation). */
  private interactives!: InteractiveSystem;
  private lootSeed: number | null = null;
  private lootSpots: string[] = [];
  private chestCount: number = LOOT_RULES.chestsPerMatch;
  /** Creatures that give XP (authoritative), their cap, and whether the development warmup uses empty hands too. */
  private creeps!: GRACreepSystem;
  private creepCount: number = CREEP_RULES.maxActive;
  private creepSeed: number | null = null;
  private unarmedStart = false;
  private snapshotCount = 0;

  override async onCreate(options: RoomCreateOptions = {}): Promise<void> {
    await hostPolicy.admitCreate(options as Record<string, unknown>);
    const desktop = hostPolicy.mode === 'DESKTOP';
    const botCount = (v: unknown, what: string): number => {
      // onCreate and onAuth answer the HTTP matchmaking request: their codes are HTTP statuses (a 4xxx one makes the
      // router throw a RangeError and the client gets a bare 500 without this message). onJoin's are WebSocket codes.
      if (v !== undefined && (typeof v !== 'number' || !Number.isFinite(v) || v < 0)) throw new ServerError(400, `invalid ${what} count`);
      return v ? Math.max(1, Math.min(MAX_SOLO_BOTS, Math.floor(v))) : 0;
    };
    const soloBots = botCount(options.soloBots, 'solo bot');
    const bots = botCount(options.bots, 'bot');
    this.solo = soloBots > 0;
    this.roomId = desktop && isRoomCode(options.presetCode) && !activeCodes.has(options.presetCode) ? options.presetCode : newCode();
    activeCodes.add(this.roomId);
    this.autoDispose = hostPolicy.autoDispose;
    if (desktop) {
      this.ownerName = sanitizeName(options.hostName) ?? '';
      this.ownerKeyHash = typeof options.ownerKeyHash === 'string' ? options.ownerKeyHash : '';
    }
    const requestedPlayers = typeof options.maxPlayers === 'number' && Number.isFinite(options.maxPlayers) ? options.maxPlayers : MAX_PLAYERS;
    this.maxClients = this.solo ? 1 : Math.max(1, Math.min(MAX_PLAYERS, Math.floor(requestedPlayers)));
    this.seats = this.solo ? MAX_PLAYERS : this.maxClients;
    this.botTarget = Math.min(soloBots || bots, this.seats - 1);
    this.legacyWarmup = DEV && options.legacyWarmup === true;
    this.phase = this.legacyWarmup ? MatchPhase.FREE_ROAM : MatchPhase.LOBBY;
    this.lobbyName = typeof options.roomName === 'string' ? options.roomName.replace(/\p{Cc}/gu, '').trim().slice(0, 56) : '';
    if (!this.lobbyName && this.ownerName) this.lobbyName = `Sala de ${this.ownerName}`;
    this.visibility = this.solo || options.visibility === 'private' ? 'private' : 'public';
    await this.setPrivate(this.visibility === 'private');
    if (DEV && typeof options.preparationTimeoutMs === 'number' && Number.isFinite(options.preparationTimeoutMs)) this.preparationTimeoutMs = Math.max(100, Math.min(90000, options.preparationTimeoutMs));
    this.countdownMs = clampMs(options.countdownMs, MATCH_RULES.countdownMs);
    this.resultsMs = clampMs(options.resultsMs, MATCH_RULES.resultsMs);
    this.closeSpawns = options.closeSpawns === true;
    if (typeof options.ultimateChargeMs === 'number' && Number.isFinite(options.ultimateChargeMs)) this.ultimateChargeMs = Math.max(0, Math.min(60000, Math.round(options.ultimateChargeMs)));
    this.skipDraft = DEV && options.skipDraft === true;
    for (const [k, v] of [['pickMs', options.draftPickMs], ['repickMs', options.draftRepickMs], ['revealMs', options.draftRevealMs]] as const) {
      if (typeof v === 'number' && Number.isFinite(v)) this.draftTimings[k] = Math.max(0, Math.min(120000, Math.round(v)));
    }
    this.skipUfo = DEV && options.skipUfo === true;
    if (typeof options.ufoRevealMs === 'number') this.ufoTimings.revealMs = clampMs(options.ufoRevealMs, UFO.revealMs);
    if (typeof options.ufoWindowMs === 'number') this.ufoTimings.windowMs = Math.max(1, clampMs(options.ufoWindowMs, UFO.windowMs));
    this.landTimeoutMs = clampMs(options.ufoLandTimeoutMs, UFO.landTimeoutMs);
    if (typeof options.reconnectSeconds === 'number' && Number.isFinite(options.reconnectSeconds)) this.reconnectSeconds = Math.max(0, Math.min(120, options.reconnectSeconds));
    if (DEV) this.configureTormenta(options);
    if (DEV) this.configureLoot(options);
    this.configureCreeps(options);
    this.world = await getWorld();
    this.motor = new CharacterMotor(this.world.physics);
    this.motor.barrierFilter = this.abilityColliders;
    this.abilities = new GRAAbilitySystem(this.abilityHost());
    this.loot = new GRALootSystem(this.lootHost(), getChestSpots(this.world));
    // The server's world is shared by every room: this room's characters only bump into this room's chests.
    this.motor.chestFilter = this.loot.colliders;
    // Doors and breakable crates: per room in the shared world too.
    this.interactives = new InteractiveSystem({ physics: this.world.physics, layout: this.world.layout, actors: () => this.interactiveActors(), emit: (e) => this.events.push(e) });
    this.motor.interactiveFilter = this.interactives.colliders;
    // Event winds (a rung bell's updrafts) blow for this room's characters only.
    this.motor.windActive = this.interactives.windsOn;
    this.newLootGeneration();
    this.creeps = new GRACreepSystem(this.creepHost(), getCreepAreas(this.world));
    this.startCreeps();

    this.onMessage(C2S.PLAYER_INPUT, (c, m) => this.onInput(c, m));
    this.onMessage(C2S.APPEARANCE_UPDATE, (c, m) => this.onAppearance(c, m));
    this.onMessage(C2S.FIRE, (c, m) => this.onFire(c, m));
    this.onMessage(C2S.RELOAD, (c) => this.onReload(c));
    this.onMessage(C2S.SWITCH_WEAPON, (c, m) => this.onSwitch(c, m));
    this.onMessage(C2S.READY, (c, m) => this.onReady(c, m));
    this.onMessage(C2S.START_MATCH, (c, m) => this.onStartMatch(c, m));
    this.onMessage(C2S.ROOM_SETTINGS, (c, m) => this.onRoomSettings(c, m));
    this.onMessage(C2S.PREPARED, (c, m) => this.onPrepared(c, m));
    this.onMessage(C2S.ABILITY_REQUEST, (c, m) => this.onAbility(c, m));
    this.onMessage(C2S.DRAFT_PICK, (c, m) => this.onDraftPick(c, m));
    this.onMessage(C2S.UFO_JUMP, (c, m) => this.onUfoJump(c, m));
    this.onMessage(C2S.RETURN_LOBBY, (c, m) => this.onReturnLobby(c, m));
    this.onMessage(C2S.INTERACT, (c, m) => this.onInteract(c, m));
    this.onMessage(C2S.USE_ITEM, (c, m) => this.onUseItem(c, m));
    this.onMessage(C2S.DEV_LOOT, (c, m) => this.onDevLoot(c, m));
    this.onMessage(C2S.MELEE, (c, m) => this.onMelee(c, m));
    this.onMessage(C2S.ALLOCATE_STAT, (c, m) => this.onAllocate(c, m));
    this.onMessage(C2S.WORLD_USE, (c, m) => this.onWorldUse(c, m));
    this.onMessage(C2S.PING, (c, m) => {
      const v = validatePing(m);
      if (v) c.send(S2C.PONG, { c: v.c, t: Date.now(), tick: Math.round(this.tickCost * 100) / 100 });
    });
    this.onMessage('*', (c, type) => log('unknown message', { from: c.sessionId, type }));

    this.lastTickAt = performance.now();
    this.setSimulationInterval(() => this.update(), SERVER_TICK_MS);
    await this.setMetadata({ ...this.roomMetadata(), phase: this.phase });
    log('room created', { code: this.roomId, maxClients: this.maxClients });
  }

  /**
   * Identity comes only from a verified Supabase access token (Colyseus auth token, or `JoinOptions.token`). Without a
   * valid one the player is a guest, unless the server requires sign-in. Runs before `onJoin`; the result is
   * `client.auth`.
   */
  override async onAuth(_client: Client, options: Partial<JoinOptions> | undefined, context: AuthContext | undefined): Promise<PlayerAuth> {
    const token = context?.token || (typeof options?.token === 'string' ? options.token : '');
    const verifier = authVerifier();
    const user = token && verifier ? await verifier.verify(token) : null;
    if (!user && serverConfig().requireAuth) throw new ServerError(401, `${JoinError.AUTH_FAILED}: sign in to play on this server`);
    if (token && verifier && !user) log('auth: token refused, joining as guest', { code: this.roomId });
    return { profileId: user?.id ?? null, owner: await hostPolicy.ownerJoin(options, this.ownerKeyHash) };
  }

  override onJoin(client: Client, options?: JoinOptions): void {
    if (this.solo && this.players.size) throw new ServerError(4004, 'solo practice is private');
    if (!options || options.protocol !== PROTOCOL_VERSION) {
      throw new ServerError(4001, `${JoinError.VERSION_MISMATCH}: server speaks protocol ${PROTOCOL_VERSION}`);
    }
    // Same protocol is not enough: a Graao Host installed before a map edit simulates other colliders than the site.
    if (options.map !== undefined && options.map !== MAP_HASH) {
      throw new ServerError(4001, `${JoinError.MAP_MISMATCH}: server runs map ${MAP_HASH}`);
    }
    if (!validateAppearance(options.appearance)) throw new ServerError(4003, `${JoinError.BAD_APPEARANCE}: unknown appearance ids`);
    if (!this.legacyWarmup && this.phase !== MatchPhase.LOBBY) throw new ServerError(4004, `${JoinError.IN_PROGRESS}: a partida já começou`);
    // Every seat taken (bots fill them): in the warmup a bot gives its seat to the person; later it waits for the lobby.
    if (this.players.size >= this.seats && (this.phase !== MatchPhase.FREE_ROAM || !this.removeBot())) {
      throw new ServerError(4004, `${JoinError.ROOM_FULL}: room is full until the match ends`);
    }
    const used = new Set([...this.players.values()].map((p) => p.index));
    let index = 0;
    while (used.has(index)) index++;
    const name = sanitizeName(options.name) ?? `Jogador ${index + 1}`;
    const state = this.spawnState(index);
    const body = this.motor.createBody(state);
    const loadout = (DEV && validateLoadout(options.loadout)) || defaultLoadout(index);
    const p = new ServerPlayer(client, index, name, { ...options.appearance }, state, body, loadout);
    p.profileId = (client.auth as PlayerAuth | undefined)?.profileId ?? null;
    resetCooldowns(p.cooldownEnds, Date.now(), this.ultimateChargeMs);
    this.players.set(client.sessionId, p);
    // Dedicated: the first person in hosts. Graao Host: whoever proves the owner key (again after a reload).
    const owner = (client.auth as PlayerAuth | undefined)?.owner ?? null;
    if (owner === true || (owner === null && !this.hostSessionId)) {
      this.hostSessionId = client.sessionId;
      if (!this.lobbyName) this.lobbyName = `Sala de ${name}`;
    }
    this.syncBots();
    const welcome: WelcomeMsg & { spawn: [number, number, number] } = {
      you: client.sessionId,
      index,
      code: this.roomId,
      serverTime: Date.now(),
      protocol: PROTOCOL_VERSION,
      server: CLIENT_VERSION,
      tickHz: SERVER_TICK_HZ,
      snapshotHz: SNAPSHOT_HZ,
      map: MAP_HASH,
      spawn: [state.pos.x, state.pos.y, state.pos.z],
    };
    client.send(S2C.WELCOME, welcome);
    client.send(S2C.SELF, p.statusIfChanged());
    client.send(S2C.LOOT_STATE, this.loot.view());
    client.send(S2C.ABILITY_STATE, { entities: this.abilities.entities });
    client.send(S2C.WORLD_STATE, this.interactives.view(Date.now()));
    this.broadcastRoomState();
    // Joining mid-draft: watch it (not a seat; plays from the next match).
    if (this.draft) client.send(S2C.DRAFT_STATE, this.draft.view(index));
    log('join', { code: this.roomId, id: client.sessionId, index, name, client: options.client, signedIn: !!p.profileId });
  }

  override onLeave(client: Client): void {
    const p = this.players.get(client.sessionId);
    if (!p) return;
    const wasHost = client.sessionId === this.hostSessionId;
    // Graao Host: the room belongs to the app, not to the host's browser tab; they may come back with their key.
    if (wasHost && !hostPolicy.closesWithHost) this.hostSessionId = '';
    if (!this.legacyWarmup && wasHost && hostPolicy.closesWithHost && this.phase !== MatchPhase.CLOSED) {
      this.phase = MatchPhase.CLOSED;
      this.abilities.clear();
      this.tormenta.stop();
      this.preparation = null;
      this.broadcast(S2C.NOTICE, { kind: 'error', code: NoticeCode.HOST_LEFT, text: 'O host saiu. A sala foi encerrada.' } satisfies NoticeMsg);
      this.broadcastRoomState();
      void this.disconnect();
      return;
    }
    // Leaving a match with things in the pockets: they stay in the world (same as a death drop).
    if (this.phase === MatchPhase.MATCH && p.inMatch && p.vitals.alive) this.loot.dropAll(p);
    p.body.dispose();
    this.players.delete(client.sessionId);
    this.abilities.cancelFor(p.index);
    if (this.bots.size && this.players.size === this.bots.size) {
      // Bots are not Colyseus clients, so they must never keep an abandoned room alive (or play on by themselves).
      for (const bot of this.players.values()) bot.body.dispose();
      this.players.clear();
      this.bots.clear();
      this.abilities.clear();
      this.ledger = null;
      this.tormenta.stop();
      // A room that outlives its players (Graao Host) waits in the lobby for the next ones.
      if (!this.autoDispose) this.returnToWarmup();
      return;
    }
    this.syncBots();
    this.broadcastRoomState();
    log('leave', { code: this.roomId, id: client.sessionId });
    // The opponent leaving can end a match (the one still standing wins); in warmup the rest may now all be ready;
    // a draft goes on without the seat, or is called off when too few players are left.
    if (this.phase === MatchPhase.MATCH || this.phase === MatchPhase.UFO) {
      this.ledger?.left(p.index, Date.now());
      this.checkMatchEnd();
      // The one who left may have been the last one still in the air.
      this.maybeBeginFight();
    } else if (this.phase === MatchPhase.ABILITY_DRAFT) this.onDraftLeave(p.index);
    else if (this.phase === MatchPhase.PREPARATION) this.updatePreparation();
    else if (this.phase === MatchPhase.RESULTS) this.maybeEndResults();
    else this.maybeStartMatch();
  }

  /**
   * The connection dropped without a goodbye (network blip, sleeping laptop): the seat and the character stay for
   * `reconnectSeconds` while the client's SDK reconnects. The player still counts as present (a 1v1 is not handed to
   * the opponent over a hiccup); their character just stops (or keeps falling). Timeout → the ordinary `onLeave`.
   */
  override onDrop(client: Client): void {
    const p = this.players.get(client.sessionId);
    if (!p || this.reconnectSeconds <= 0) return;
    p.dropped = true;
    p.queue.length = 0;
    p.ready = false;
    this.broadcastRoomState();
    log('drop', { code: this.roomId, id: client.sessionId, name: p.name, keepS: this.reconnectSeconds });
    this.allowReconnection(client, this.reconnectSeconds).catch(() => {});
  }

  /** Back within the grace period: same seat, same session; everything the client may have missed is sent again. */
  override onReconnect(client: Client): void {
    const p = this.players.get(client.sessionId);
    if (!p) return;
    // Private messages go to the new connection from now on.
    p.client = client;
    p.dropped = false;
    p.queue.length = 0;
    p.starvedFor = 0;
    p.simTime = Date.now() - 60;
    log('reconnect', { code: this.roomId, id: client.sessionId, name: p.name });
    this.broadcastRoomState();
    client.send(S2C.SELF, p.statusIfChanged(true));
    client.send(S2C.LOOT_STATE, this.loot.view());
    client.send(S2C.ABILITY_STATE, { entities: this.abilities.entities });
    client.send(S2C.WORLD_STATE, this.interactives.view(Date.now()));
    if (this.draft) client.send(S2C.DRAFT_STATE, this.draft.view(p.index));
  }

  override onDispose(): void {
    this.abilities?.clear();
    // Chest, door and crate colliders live in the process-wide world: they must leave with the room.
    this.loot?.clear();
    this.interactives?.dispose();
    for (const p of this.players.values()) p.body.dispose();
    this.bots.clear();
    activeCodes.delete(this.roomId);
    log('room disposed', { code: this.roomId });
  }

  /** Graao Host: what the app shows and forwards to the public list (the room's own counts, never a client's). */
  hostReport(): HostRoomReport {
    const meta = this.roomMetadata();
    const humans = [...this.players.values()].filter((p) => !p.bot);
    return {
      code: this.roomId,
      name: meta.name,
      visibility: meta.visibility === 'private' ? 'PRIVATE' : 'PUBLIC',
      status: roomStatusOf(this.phase),
      humanCount: humans.length,
      desiredBotCount: this.botTarget,
      effectiveBotCount: meta.botsPlanned,
      maxParticipants: this.seats,
      available: meta.available,
      hostPresent: !!this.hostSessionId && this.players.has(this.hostSessionId),
      players: [...this.players.values()].map((p) => ({ name: p.name, bot: p.bot, connected: p.connected, host: p.client.sessionId === this.hostSessionId })),
    };
  }

  /** Average simulation tick cost (ms). */
  /**
   * Server cost breakdown (ms, smoothed like `tickCost`): the creeps' AI and movement and the bots' brains have their
   * own budget, separate from the participants' simulation; `peakTickMs` is the worst tick since the last read.
   */
  readonly perf = { creepMs: 0, botMs: 0, peakTickMs: 0, ticks: 0 };

  get tickCostMs(): number {
    return this.tickCost;
  }

  /** The app stopped hosting: everyone is told why, then disconnected (the room disposes right after). */
  closeByHost(text: string): Promise<unknown> {
    if (this.phase !== MatchPhase.CLOSED) {
      this.phase = MatchPhase.CLOSED;
      this.abilities.clear();
      this.tormenta.stop();
      this.preparation = null;
      this.ledger = null;
      this.broadcast(S2C.NOTICE, { kind: 'error', code: NoticeCode.ROOM_CLOSED, text } satisfies NoticeMsg);
      this.broadcastRoomState();
    }
    log('room closed by host app', { code: this.roomId });
    return this.disconnect();
  }

  /** Warmup only: bots fill the seats people leave free, up to the room's bot count. */
  private syncBots(): void {
    if (!this.legacyWarmup || !this.botTarget || this.phase !== MatchPhase.FREE_ROAM) return;
    const people = this.players.size - this.bots.size;
    // The last person left: the room is about to be disposed.
    if (!people) return;
    const want = Math.max(0, Math.min(this.botTarget, this.seats - people));
    while (this.bots.size > want && this.removeBot());
    while (this.bots.size < want) this.addBot();
  }

  private addBot(): void {
    const used = new Set([...this.players.values()].map((p) => p.index));
    let index = 0;
    while (used.has(index)) index++;
    const names = new Set([...this.players.values()].filter((p) => p.bot).map((p) => p.name));
    let n = 1;
    while (names.has(`Bot ${n}`)) n++;
    const connection: PlayerConnection = { sessionId: `bot-${index}`, send: () => {} };
    const state = this.spawnState(index);
    const p = new ServerPlayer(connection, index, `Bot ${n}`, randomAppearance(), state, this.motor.createBody(state), defaultLoadout(index), true);
    p.ready = true;
    p.simTime = Date.now() - 60;
    resetCooldowns(p.cooldownEnds, Date.now(), this.ultimateChargeMs);
    this.players.set(connection.sessionId, p);
    this.bots.set(index, {
      seq: 0, fireSeq: 0, abilitySeq: 0, nextAbilityAt: 0, acc: 0, target: -1, acquiredAt: 0, nextShotAt: 0, nav: new BotNavigator(), chest: -1, chestSince: 0, lootSeq: 0, skipChests: new Map(),
      profile: BOT_STAT_PROFILE_IDS[index % BOT_STAT_PROFILE_IDS.length]!, creep: -1, creepSince: 0, skipCreeps: new Map(),
    });
    // The navigation graph is built once per process (about 2 s), when the first bot sits down: never mid-match.
    getNav(this.world);
  }

  /** Takes out the newest bot (highest seat). False when there is none. */
  private removeBot(): boolean {
    let last: ServerPlayer | undefined;
    for (const p of this.players.values()) if (p.bot && (!last || p.index > last.index)) last = p;
    if (!last) return false;
    last.body.dispose();
    this.players.delete(last.client.sessionId);
    this.bots.delete(last.index);
    this.abilities.cancelFor(last.index);
    return true;
  }

  /** Dev/tests: Tormenta and spawn overrides (validated and clamped; a bad value keeps the default). */
  private configureTormenta(o: RoomCreateOptions): void {
    const num = (v: unknown, lo: number, hi: number): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : undefined);
    const latLon = (v: unknown): { lat: number; lon: number } | null => {
      const p = v as { lat?: unknown; lon?: unknown } | null;
      const lat = num(p?.lat, -90, 90);
      const lon = num(p?.lon, -180, 180);
      return lat === undefined || lon === undefined ? null : { lat, lon };
    };
    this.tormentaOff = o.tormentaOff === true;
    const config: TormentaConfig = { ...TORMENTA };
    if (Array.isArray(o.tormentaPhases) && o.tormentaPhases.length >= 1 && o.tormentaPhases.length <= 6) {
      const phases = o.tormentaPhases.map((p) => ({
        waitMs: num(p?.waitMs, 0, 600000) ?? 0,
        shrinkMs: num(p?.shrinkMs, 1, 600000) ?? 1,
        radiusDeg: num(p?.radiusDeg, 0.5, 180) ?? 10,
        damage: num(p?.damage, 0, 100) ?? 0,
      }));
      config.phases = phases;
    }
    const pulse = num(o.tormentaPulseMs, 50, 10000);
    if (pulse !== undefined) config.pulseMs = pulse;
    const fin = num(o.tormentaFinalDamage, 0, 100);
    if (fin !== undefined) config.finalDamage = fin;
    this.tormenta.config = config;
    const f = latLon(o.tormentaFinal);
    if (f) this.tormentaFinal = latLonToDir(f.lat, f.lon);
    if (Array.isArray(o.matchSpawns) && o.matchSpawns.length <= MAX_PLAYERS) {
      const spawns = o.matchSpawns.map(latLon);
      if (spawns.length && spawns.every((s) => s)) this.matchSpawns = spawns as { lat: number; lon: number }[];
    }
    if (Array.isArray(o.freeRoamSpawns) && o.freeRoamSpawns.length <= MAX_PLAYERS) {
      const spawns = o.freeRoamSpawns.map(latLon);
      if (spawns.length && spawns.every((s) => s)) this.freeRoamSpawns = spawns as { lat: number; lon: number }[];
    }
  }

  /** Dev/tests: loot overrides (validated; a bad value keeps the default). */
  private configureLoot(o: RoomCreateOptions): void {
    if (typeof o.lootSeed === 'number' && Number.isFinite(o.lootSeed)) this.lootSeed = o.lootSeed >>> 0;
    if (Array.isArray(o.lootSpots)) this.lootSpots = o.lootSpots.filter((x): x is string => typeof x === 'string').slice(0, 32);
    if (typeof o.chestCount === 'number' && Number.isFinite(o.chestCount)) this.chestCount = Math.max(1, Math.min(32, Math.floor(o.chestCount)));
  }

  private spawnState(index: number, avoid?: Vec3, match = false) {
    if (match) {
      // Match start: spread around the arena, facing its centre.
      const sp = (this.matchSpawns ?? MATCH_SPAWNS)[index % (this.matchSpawns ?? MATCH_SPAWNS).length]!;
      const dir = latLonToDir(sp.lat, sp.lon);
      const ground = this.world.terrain.surfaceAt(dir);
      const c = latLonToDir(ARENA_CENTER.lat, ARENA_CENTER.lon);
      const flat = v3projectOnPlane({ x: c.x - dir.x, y: c.y - dir.y, z: c.z - dir.z }, dir);
      // On the arena centre itself (or its antipode) there is no direction toward it: face north.
      const toC = Math.hypot(flat.x, flat.y, flat.z) > 1e-4 ? v3normalize(flat) : northTangent(dir);
      return createCharacterState({ x: ground.x + dir.x * 0.1, y: ground.y + dir.y * 0.1, z: ground.z + dir.z * 0.1 }, toC);
    }
    const spawns = this.freeRoamSpawns ?? SPAWNS;
    let spawn = spawns[index % spawns.length]!;
    if (avoid) {
      // Respawn at the spawn point farthest from the eliminator.
      let best = -Infinity;
      for (const s of spawns) {
        const d = latLonToDir(s.lat, s.lon);
        const dist = -(d.x * avoid.x + d.y * avoid.y + d.z * avoid.z);
        if (dist > best) {
          best = dist;
          spawn = s;
        }
      }
    }
    const dir = latLonToDir(spawn.lat, spawn.lon);
    const ground = this.world.terrain.surfaceAt(dir);
    return createCharacterState({ x: ground.x + dir.x * 0.1, y: ground.y + dir.y * 0.1, z: ground.z + dir.z * 0.1 }, northTangent(dir));
  }

  // ------------------------------------------------------------------------------------------------ messages

  private onInput(c: Client, m: unknown): void {
    const p = this.players.get(c.sessionId);
    if (!p) return;
    if (!this.legacyWarmup && this.phase !== MatchPhase.MATCH && this.phase !== MatchPhase.UFO) return;
    const v = validateInputMsg(m);
    if (!v) return;
    for (const cmd of v.i) {
      const last = p.queue.length ? p.queue[p.queue.length - 1]![0] : p.lastSeq;
      if (last >= 0 && !seqGreater(cmd[0], last)) continue;
      if (p.queue.length >= MAX_INPUT_BACKLOG) break;
      p.queue.push(cmd);
    }
  }

  private onAppearance(c: Client, m: unknown): void {
    const p = this.players.get(c.sessionId);
    const v = validateAppearanceUpdate(m);
    if (!p || !v || !validateAppearance(v.appearance) || (!this.legacyWarmup && this.phase !== MatchPhase.LOBBY)) return;
    p.appearance = v.appearance;
    if (!this.legacyWarmup) p.ready = false;
    this.broadcastRoomState();
  }

  private onReady(c: Client, m: unknown): void {
    const p = this.players.get(c.sessionId);
    const v = validateReady(m);
    if (!p || !v || (this.phase !== MatchPhase.LOBBY && this.phase !== MatchPhase.FREE_ROAM)) return;
    const ready = v.r === 1;
    if (p.ready === ready) return;
    p.ready = ready;
    this.broadcastRoomState();
    this.maybeStartMatch();
  }

  // ------------------------------------------------------------------------------------------------ match flow

  private roomMetadata(): RoomMetadata {
    const humans = [...this.players.values()].filter((p) => !p.bot);
    const botsPlanned = this.phase === MatchPhase.LOBBY ? Math.min(this.botTarget, this.seats - humans.length) : this.bots.size;
    const unready = humans.filter((p) => !p.ready || p.dropped || !p.connected);
    const startReason = this.phase !== MatchPhase.LOBBY ? 'A partida já começou.' : humans.length + botsPlanned < MATCH_RULES.minPlayers ? 'São necessários pelo menos dois participantes.' : unready.length ? `Aguardando ${unready.map((p) => p.name).join(', ')} confirmar.` : '';
    return {
      name: this.lobbyName || 'Sala de graao', visibility: this.visibility,
      hostSessionId: this.hostSessionId, hostName: this.players.get(this.hostSessionId)?.name ?? this.ownerName,
      humans: humans.length, botsDesired: this.botTarget, botsPlanned, capacity: this.seats, protocol: PROTOCOL_VERSION,
      available: this.phase === MatchPhase.LOBBY && !this.solo && humans.length < this.maxClients,
      canStart: !startReason, startReason,
    };
  }

  private onRoomSettings(c: Client, m: unknown): void {
    const v = validateRoomSettings(m);
    if (!v || c.sessionId !== this.hostSessionId || this.phase !== MatchPhase.LOBBY) return;
    this.botTarget = Math.min(v.bots, this.seats - 1);
    this.broadcastRoomState();
  }

  private onStartMatch(c: Client, m: unknown): void {
    if (c.sessionId !== this.hostSessionId || this.phase !== MatchPhase.LOBBY || !validateReturnLobby(m)) return;
    const reason = this.roomMetadata().startReason;
    if (reason) {
      c.send(S2C.NOTICE, { kind: 'error', code: NoticeCode.START_REJECTED, text: reason } satisfies NoticeMsg);
      return;
    }
    // Planned bot seats become real participants only after the host freezes this roster.
    const want = Math.min(this.botTarget, this.seats - this.players.size);
    while (this.bots.size < want) this.addBot();
    if (!this.skipDraft) this.startDraft();
    else {
      for (const p of this.players.values()) p.inMatch = p.connected;
      this.startPreparation(false);
    }
  }

  private maybeStartMatch(): void {
    if (!this.legacyWarmup) return;
    if (this.phase !== MatchPhase.FREE_ROAM) return;
    if (!everyoneReady([...this.players.values()])) return;
    if (!this.skipDraft) this.startDraft();
    else if (this.skipUfo) this.startMatch(false);
    else this.startDeploy(false);
  }

  // ------------------------------------------------------------------------------------------------ ability draft

  /** Everyone ready: the connected players draft 3 basics + 1 Ultimate in simultaneous rounds. No fighting meanwhile. */
  private startDraft(): void {
    const now = Date.now();
    const seats = [...this.players.values()].filter((p) => p.connected);
    this.phase = MatchPhase.ABILITY_DRAFT;
    this.phaseEndsAt = 0;
    this.startsAt = 0;
    this.winner = -1;
    this.abilities.clear();
    for (const p of this.players.values()) {
      p.ready = false;
      p.inMatch = seats.includes(p);
      p.castUntil = 0;
      p.pendingDash = null;
    }
    this.draft = new AbilityDraft(
      seats.map((p) => p.index),
      now,
      { timings: this.draftTimings, firstPriority: Math.floor(Math.random() * seats.length) },
    );
    this.broadcastRoomState();
    this.sendDraftStates();
    log('draft start', { code: this.roomId, seats: seats.map((p) => p.name) });
  }

  private onDraftPick(c: Client, m: unknown): void {
    const p = this.players.get(c.sessionId);
    const v = validateDraftPick(m);
    if (!p || !v || !this.draft || this.phase !== MatchPhase.ABILITY_DRAFT) return;
    const now = Date.now();
    const r = this.draft.pick(p.index, v.r, v.a, now);
    // A lock is public (everyone sees who has chosen, never what); a refusal only concerns the picker.
    if (this.draft.update(now) || r === DraftReject.OK) this.sendDraftStates();
    else c.send(S2C.DRAFT_STATE, this.draft.view(p.index));
    this.checkDraftDone();
  }

  private onDraftLeave(index: number): void {
    const d = this.draft;
    if (!d) return;
    d.remove(index);
    if (d.seats.length < MATCH_RULES.minPlayers) {
      // Not enough players for a match: back to warmup, loadouts unchanged.
      this.draft = null;
      this.returnToWarmup();
      log('draft cancelled', { code: this.roomId });
      return;
    }
    d.update(Date.now());
    this.sendDraftStates();
    this.checkDraftDone();
  }

  /** Draft over: the drafted loadouts replace the warmup ones (public in ROOM_STATE), then the match starts. */
  private checkDraftDone(): void {
    const d = this.draft;
    if (!d?.done) return;
    for (const p of this.players.values()) {
      const l = d.loadout(p.index);
      if (l) p.loadout = l;
    }
    this.sendDraftStates();
    this.draft = null;
    log('draft done', { code: this.roomId, loadouts: [...this.players.values()].map((p) => `${p.name}: ${p.loadout.join(',')}`) });
    if (!this.legacyWarmup) this.startPreparation(true);
    else if (this.skipUfo) this.startMatch(true);
    else this.startDeploy(true);
  }

  private startPreparation(afterDraft: boolean): void {
    this.phase = MatchPhase.PREPARATION;
    this.preparationAfterDraft = afterDraft;
    this.phaseEndsAt = Date.now() + this.preparationTimeoutMs;
    this.preparation = { id: ++this.preparationId, deadline: this.phaseEndsAt, ready: [], waiting: [...this.players.values()].filter((p) => !p.bot && p.inMatch).map((p) => p.index) };
    this.broadcastRoomState();
  }

  private onPrepared(c: Client, m: unknown): void {
    const p = this.players.get(c.sessionId);
    const v = validatePrepared(m);
    const prep = this.preparation;
    if (!p || !v || !prep || this.phase !== MatchPhase.PREPARATION || v.id !== prep.id || !p.inMatch) return;
    if (!v.ok) {
      this.broadcast(S2C.NOTICE, { kind: 'error', code: NoticeCode.LOAD_FAILED, text: `${p.name} não conseguiu carregar a partida. Tente iniciar novamente.` } satisfies NoticeMsg);
      this.returnToWarmup();
      return;
    }
    if (!prep.ready.includes(p.index)) prep.ready.push(p.index);
    this.updatePreparation();
  }

  private updatePreparation(): void {
    const prep = this.preparation;
    if (!prep || this.phase !== MatchPhase.PREPARATION) return;
    const humans = [...this.players.values()].filter((p) => !p.bot && p.inMatch);
    prep.ready = prep.ready.filter((i) => humans.some((p) => p.index === i && !p.dropped));
    prep.waiting = humans.filter((p) => !prep.ready.includes(p.index)).map((p) => p.index);
    if (!humans.length || this.players.size < MATCH_RULES.minPlayers) return this.returnToWarmup();
    if (prep.waiting.length) return this.broadcastRoomState();
    this.preparation = null;
    if (this.skipUfo) this.startMatch(this.preparationAfterDraft);
    else this.startDeploy(this.preparationAfterDraft);
  }

  private sendDraftStates(): void {
    const d = this.draft;
    if (!d) return;
    for (const p of this.players.values()) p.client.send(S2C.DRAFT_STATE, d.view(p.index));
  }

  // ------------------------------------------------------------------------------------------------ UFO deployment

  /**
   * The participants board the UFO (fresh vitals, ammo and abilities). After a draft only its seats take part
   * (someone who joined meanwhile watches from the ground); without one every connected player does.
   */
  private startDeploy(afterDraft: boolean): void {
    const now = Date.now();
    this.phase = MatchPhase.UFO;
    this.startsAt = 0;
    this.phaseEndsAt = 0;
    this.winner = -1;
    this.abilities.clear();
    const route = makeUfoRoute(Math.random, now, this.ufoTimings);
    this.ufo = route;
    for (const p of this.players.values()) {
      p.ready = false;
      p.inMatch = p.connected && (!afterDraft || p.inMatch);
      p.kills = 0;
      p.deaths = 0;
      p.damageDealt = 0;
      p.deploy = p.inMatch ? DeployState.SHIP : DeployState.NONE;
      if (!p.inMatch) continue;
      p.state = createCharacterState(ufoPosition(route, now), ufoHeading(route, now));
      this.refresh(p, now);
    }
    this.beginLedger(now);
    this.newLootGeneration();
    this.startCreeps();
    this.broadcastRoomState();
    log('ufo deploy', { code: this.roomId, riders: [...this.players.values()].filter((p) => p.inMatch).map((p) => p.name), opensIn: route.open - now, closesIn: route.close - now });
  }

  /** Full vitals, ammo and abilities, nothing pending (boarding, fight start). */
  private refresh(p: ServerPlayer, now: number): void {
    p.vitals = newVitals();
    p.prog = newProgression();
    p.damageCarry = 0;
    p.lastHurtBy = -1;
    this.applyStats(p);
    this.freshKit(p);
    p.respawnAt = 0;
    p.queue.length = 0;
    this.resetAbilities(p, now);
  }

  /**
   * A fresh kit: Battle Royale (boarding, the fight start) means empty hands for everyone, bots included; the
   * development warmup keeps the training kit (E equipped). Nothing reloading, nothing being used.
   */
  private freshKit(p: ServerPlayer): void {
    p.inv = p.freshInventory(this.battleRoyaleKit());
    p.weapon = 0;
    p.fists = false;
    p.reloading = -1;
    p.useUntil = 0;
    p.useItem = -1;
    p.useReadyAt.fill(0);
  }

  private onUfoJump(c: Client, m: unknown): void {
    const p = this.players.get(c.sessionId);
    if (!p || !validateUfoJump(m) || this.phase !== MatchPhase.UFO || !this.ufo || p.deploy !== DeployState.SHIP) return;
    const now = Date.now();
    if (!jumpOpen(this.ufo, now)) return;
    this.jump(p, now, false);
  }

  /** Leaves the ship at server time `t`: the dive starts from exactly what the `jump` event carries. */
  private jump(p: ServerPlayer, t: number, auto: boolean): void {
    if (!this.ufo) return;
    const d = diveStart(this.ufo, t);
    p.state = createCharacterState(d.pos, d.facing);
    p.state.vel = { ...d.vel };
    p.state.diving = true;
    this.motor.placeCollider(p.body.collider, p.state.pos);
    p.queue.length = 0;
    p.starvedFor = 0;
    p.simTime = Date.now() - 60;
    p.deploy = DeployState.DIVING;
    const v: [number, number, number] = [Math.round(d.vel.x * 100), Math.round(d.vel.y * 100), Math.round(d.vel.z * 100)];
    this.events.push({ e: 'jump', target: p.index, at: mm(d.pos), v, auto });
    this.broadcastRoomState();
    log('ufo jump', { code: this.roomId, name: p.name, auto, msAfterOpen: Math.round(t - this.ufo.open) });
  }

  /** First ground or water contact after a dive (the controller cleared `diving`). */
  private land(p: ServerPlayer): void {
    p.deploy = DeployState.LANDED;
    this.events.push({ e: 'land', target: p.index, at: mm(p.state.pos), water: landedInWater(this.world.terrain, p.state.pos) });
    this.broadcastRoomState();
    log('ufo land', { code: this.roomId, name: p.name });
  }

  /** A diver still in the air long after the window closed (stuck, or a client that stopped sending) is set down. */
  private forceLand(p: ServerPlayer): void {
    const dir = v3normalize(p.state.pos);
    const g = this.world.terrain.surfaceAt(dir);
    p.state = createCharacterState({ x: g.x + dir.x * 0.1, y: g.y + dir.y * 0.1, z: g.z + dir.z * 0.1 }, p.state.facing);
    this.motor.placeCollider(p.body.collider, p.state.pos);
    p.queue.length = 0;
    p.simTime = Date.now() - 60;
    // Clients snap to the new position like after a respawn.
    this.events.push({ e: 'respawn', target: p.index });
    this.land(p);
  }

  /** Everyone down: the fight starts where they landed, after the countdown (weapons locked meanwhile). */
  private maybeBeginFight(): void {
    if (this.phase !== MatchPhase.UFO || !everyoneLanded([...this.players.values()])) return;
    const now = Date.now();
    this.phase = MatchPhase.MATCH;
    this.startsAt = now + this.countdownMs;
    this.ufo = null;
    this.abilities.clear();
    for (const p of this.players.values()) {
      p.deploy = DeployState.NONE;
      if (p.inMatch && p.connected) this.refresh(p, now);
    }
    this.startTormenta();
    this.broadcastRoomState();
    log('match start', { code: this.roomId, players: this.players.size, after: 'ufo' });
  }

  /** The fight starts: the Tormenta's clock starts with it (the first region is announced during the countdown). */
  private startTormenta(): void {
    if (this.tormentaOff) return;
    const m = this.tormenta.start(this.startsAt, Math.random, this.world.terrain, this.tormentaFinal);
    log('tormenta start', { code: this.roomId, phases: m.n, firstShrinkInS: Math.round((m.a - Date.now()) / 1000) });
  }

  /**
   * A damage pulse of the Tormenta: Health off everyone in the match who is outside the safe region now, all in the
   * same pulse (two falling together is a draw), then the usual elimination path decides the match.
   */
  private tormentaPulse(amount: number, now: number): void {
    let eliminated = false;
    for (const p of this.players.values()) {
      if (!p.inMatch || !p.vitals.alive || !this.tormenta.outside(p.state.pos)) continue;
      if (this.dealDamage(p, p, amount, false, now, undefined, 'tormenta')) eliminated = true;
    }
    if (eliminated) {
      this.broadcastRoomState();
      this.checkMatchEnd();
    }
  }

  /**
   * Fresh vitals and ammo, spread spawns, countdown before weapons unlock. After a draft only its seats take part
   * (someone who joined during the draft watches); without one every connected player does.
   */
  private startMatch(afterDraft: boolean): void {
    const now = Date.now();
    this.phase = MatchPhase.MATCH;
    this.startsAt = now + this.countdownMs;
    this.phaseEndsAt = 0;
    this.winner = -1;
    this.abilities.clear();
    let slot = 0;
    for (const p of [...this.players.values()].sort((a, b) => a.index - b.index)) {
      p.ready = false;
      p.inMatch = p.connected && (!afterDraft || p.inMatch);
      p.kills = 0;
      p.deaths = 0;
      p.damageDealt = 0;
      p.prog = newProgression();
      if (p.inMatch) this.resetForSpawn(p, this.spawnState(slot++, undefined, !this.closeSpawns));
    }
    this.beginLedger(now);
    this.newLootGeneration();
    this.startTormenta();
    this.startCreeps();
    this.broadcastRoomState();
    log('match start', { code: this.roomId, players: this.players.size });
  }

  /** A new match record for the participants (their loadouts are final: the draft is over). */
  private beginLedger(now: number): void {
    const entrants = [...this.players.values()].filter((p) => p.inMatch);
    this.ledger = new MatchLedger(
      entrants.map((p) => ({ index: p.index, name: p.name, loadout: p.loadout })),
      now,
    );
    this.roster = new Map(entrants.map((p) => [p.index, { profileId: p.profileId, appearance: { ...p.appearance } }]));
    this.botsInMatch = entrants.some((p) => p.bot);
  }

  private checkMatchEnd(): void {
    if (this.phase !== MatchPhase.MATCH && this.phase !== MatchPhase.UFO) return;
    const r = decideMatch([...this.players.values()].map((p) => ({ index: p.index, alive: p.vitals.alive, connected: p.connected, inMatch: p.inMatch })));
    if (!r.over) return;
    const now = Date.now();
    this.phase = MatchPhase.RESULTS;
    this.winner = r.winner;
    this.startsAt = 0;
    this.ufo = null;
    this.tormenta.stop();
    this.phaseEndsAt = now + this.resultsMs;
    const w = this.byIndex(r.winner);
    if (w) w.wins++;
    for (const p of this.players.values()) p.back = p.bot;
    // The summary first, so every client has it when the phase turns to RESULTS.
    const summary = this.ledger?.finish(this.roomId, r.winner, now) ?? null;
    this.ledger = null;
    if (summary) this.broadcast(S2C.MATCH_SUMMARY, summary);
    this.broadcastRoomState();
    log('match end', { code: this.roomId, winner: w?.name ?? '-', durationS: summary ? Math.round(summary.durationMs / 1000) : 0 });
    // Matches with bots are practice: they do not go to anyone's history.
    if (summary && !this.botsInMatch) void this.persist(summary, this.roster);
  }

  /**
   * Writes the summary once (Supabase `record_match`). Never blocks the room; a failure is only logged. Signed-in
   * participants who are still here learn that it reached their history.
   */
  private async persist(summary: MatchSummaryMsg, roster: ReadonlyMap<number, ParticipantInfo>): Promise<void> {
    const store = matchStore();
    try {
      const id = await store.record(recordMatchPayload(summary, roster, { protocol: PROTOCOL_VERSION, serverVersion: CLIENT_VERSION }));
      if (!id) return;
      log('match saved', { code: summary.code, id, store: store.name });
      const notice: NoticeMsg = { kind: 'info', code: NoticeCode.MATCH_SAVED, text: 'Partida salva no seu histórico' };
      for (const p of this.players.values()) {
        if (p.profileId && roster.get(p.index)?.profileId === p.profileId) p.client.send(S2C.NOTICE, notice);
      }
    } catch (e) {
      log('match save failed', { code: summary.code, store: store.name, error: (e as Error).message ?? String(e) });
    }
  }

  /** RESULTS: this player is done reading; the room returns to the lobby once every connected player is. */
  private onReturnLobby(c: Client, m: unknown): void {
    const p = this.players.get(c.sessionId);
    if (!p || !validateReturnLobby(m) || this.phase !== MatchPhase.RESULTS || p.back) return;
    p.back = true;
    this.broadcastRoomState();
    this.maybeEndResults();
  }

  private maybeEndResults(): void {
    if (this.phase !== MatchPhase.RESULTS) return;
    const here = [...this.players.values()].filter((p) => p.connected);
    if (here.length && here.every((p) => p.back)) this.returnToWarmup();
  }

  /** Results over: everyone back on their feet in the warmup lobby, ready flags cleared. */
  private returnToWarmup(): void {
    this.phase = this.legacyWarmup ? MatchPhase.FREE_ROAM : MatchPhase.LOBBY;
    this.preparation = null;
    if (!this.legacyWarmup) while (this.removeBot());
    this.phaseEndsAt = 0;
    this.startsAt = 0;
    this.winner = -1;
    this.ufo = null;
    this.ledger = null;
    this.tormenta.stop();
    for (const p of this.players.values()) {
      p.ready = p.bot;
      p.back = false;
      p.inMatch = false;
      p.kills = 0;
      p.deaths = 0;
      p.damageDealt = 0;
      // Still aboard or in the air (the match ended during the deployment): back on a spawn.
      const airborne = p.deploy === DeployState.SHIP || p.deploy === DeployState.DIVING;
      p.deploy = DeployState.NONE;
      p.prog = newProgression();
      if (!p.vitals.alive || airborne) this.respawn(p);
      else {
        p.vitals = newVitals();
        this.applyStats(p);
        this.freshKit(p);
        this.resetAbilities(p, Date.now());
      }
    }
    // Seats people left during the match go back to bots.
    this.syncBots();
    this.newLootGeneration();
    this.startCreeps();
    this.broadcastRoomState();
  }

  /** May this player deal or take damage right now? */
  private canFight(p: ServerPlayer, now: number): boolean {
    if (!this.legacyWarmup) return this.phase === MatchPhase.MATCH && p.inMatch && now >= this.startsAt;
    if (this.phase === MatchPhase.RESULTS || this.phase === MatchPhase.ABILITY_DRAFT || this.phase === MatchPhase.UFO) return false;
    if (this.phase === MatchPhase.MATCH) return p.inMatch && now >= this.startsAt;
    return true;
  }

  /** E / Q take that weapon in hand; FISTS_SLOT puts the weapons away (they stay in the inventory) to punch. */
  private onSwitch(c: Client, m: unknown): void {
    if (!this.legacyWarmup && this.phase !== MatchPhase.MATCH) return;
    const p = this.players.get(c.sessionId);
    const v = validateSwitch(m);
    if (!p || !v || !p.vitals.alive) return;
    if (!TRAVERSAL_ACTIONS[p.state.traversal].switchWeapon) return;
    if (v.w === FISTS_SLOT) {
      if (p.fists) return;
      p.fists = true;
      p.reloading = -1;
      return;
    }
    if (!p.inv.slots[v.w] || (v.w === p.weapon && !p.fists)) return;
    this.equip(p, v.w, Date.now());
  }

  /** `slot` becomes the weapon in hand, after the equip delay (switch, or a weapon just picked up). */
  private equip(p: ServerPlayer, slot: number, now: number): void {
    const s = p.inv.slots[slot];
    if (!s) return;
    p.weapon = slot;
    p.fists = false;
    p.reloading = -1;
    const w = WEAPONS[s.id];
    // Equip delay: treat the switch as a recent shot.
    const passive = passiveModifiers(p.loadout, p.runtime.passive, now, p.vitals.alive);
    p.lastShotAt[slot] = Math.max(p.lastShotAt[slot]!, now - weaponShotInterval(w, p.mods.attackSpeed) * FIRE_RATE_TOLERANCE + Math.max(80, SWITCH_DELAY_MS * passive.weaponSwap));
  }

  private onReload(c: Client): void {
    if (!this.legacyWarmup && this.phase !== MatchPhase.MATCH) return;
    const p = this.players.get(c.sessionId);
    if (p && p.vitals.alive && TRAVERSAL_ACTIONS[p.state.traversal].reload) this.startReload(p);
  }

  private startReload(p: ServerPlayer): void {
    const s = p.inv.slots[p.weapon];
    // Nothing to reload: a full magazine, an empty slot, or no reserve of this weapon's ammunition.
    if (!s || p.reloading >= 0 || reloadAmount(p.inv, p.weapon) <= 0) return;
    const w = WEAPONS[s.id];
    p.reloading = p.weapon;
    p.reloadEndsAt = Date.now() + w.reloadTime * 1000;
    this.events.push({ e: 'reload', by: p.index, w: p.weapon });
  }

  private onFire(c: PlayerConnection, m: unknown): void {
    const p = this.players.get(c.sessionId);
    const f = validateFire(m);
    if (!p || !f) return;
    if (p.lastFireSeen < 0 || seqGreater(f.s, p.lastFireSeen)) p.lastFireSeen = f.s;
    if (!p.vitals.alive) return;
    if (f.w !== p.weapon || p.reloading >= 0) return;
    // Weapons put away (or none at all): the attack is a punch (MELEE), never a shot.
    if (p.fists) return;
    if (!this.canFight(p, Date.now())) return;
    // Hands are busy while swimming, hanging, climbing, gliding, while an ability winds up and while a consumable is
    // being used (docs/gameplay/TRAVERSAL_STATES.md: what each traversal mode allows).
    if (p.state.swimming || !TRAVERSAL_ACTIONS[p.state.traversal].fire) return;
    if (this.abilities.attackLocked(p, Date.now())) return;
    if (Date.now() < p.castUntil || Date.now() < p.useUntil) return;
    if (p.lastShotSeq >= 0 && !seqGreater(f.s, p.lastShotSeq)) return;
    const slot = p.inv.slots[f.w];
    if (!slot) return;
    const w = WEAPONS[slot.id];
    const now = Date.now();
    // Velocidade de Ataque shortens the interval, up to the weapon's own limit (the client predicts the same number).
    if (now - p.lastShotAt[f.w]! < weaponShotInterval(w, p.mods.attackSpeed) * FIRE_RATE_TOLERANCE) return;
    if (slot.ammo <= 0) {
      this.startReload(p);
      return;
    }
    const s = p.state;
    const up = v3normalize(s.pos);
    const head = { x: s.pos.x + up.x * 1.6, y: s.pos.y + up.y * 1.6, z: s.pos.z + up.z * 1.6 };
    const origin = { x: f.o[0] / POS_SCALE, y: f.o[1] / POS_SCALE, z: f.o[2] / POS_SCALE };
    if (Math.hypot(origin.x - head.x, origin.y - head.y, origin.z - head.z) > MAX_CAMERA_OFFSET) return;
    const dir = v3normalize({ x: f.d[0] / DIR_SCALE, y: f.d[1] / DIR_SCALE, z: f.d[2] / DIR_SCALE });

    p.lastShotSeq = f.s;
    p.lastShotAt[f.w] = now;
    slot.ammo -= 1;
    p.fireUntil = now + 160;
    recordPassiveCombat(p.runtime.passive, now, 'fire');
    this.abilities.recordActivity(p.index, now);
    // The shooter faces the aim when firing (the controller turns toward it too).
    const flat = v3projectOnPlane(dir, up);
    const facing = Math.hypot(flat.x, flat.y, flat.z) > 1e-3 ? v3normalize(flat) : s.facing;
    const muzzle = muzzlePoint(s.pos, facing);

    const targets: PlayerHitTarget[] = [...this.players.values()].map((q) => ({ index: q.index, feet: q.state.pos, alive: q.vitals.alive }));
    // Creeps stop shots too (and take them).
    targets.push(...this.creeps.hitTargets());
    const passive = passiveModifiers(p.loadout, p.runtime.passive, now, p.vitals.alive);
    const dirs = spreadDirections(dir, (f.a ? w.spreadAim : w.spreadHip) * passive.weaponSpread, w.pellets, shotSeed(p.index, f.s));
    const perTarget = new Map<number, { amount: number; crit: boolean }>();
    let eliminated = false;
    const to: [number, number, number][] = [];
    const hitT: number[] = [];
    for (const d of dirs) {
      const r = resolvePellet(this.roomPhysics(), origin, d, muzzle, w.range, targets, p.index);
      to.push(mm(r.point));
      hitT.push(r.target);
      if (r.target >= 0) {
        const acc = perTarget.get(r.target) ?? { amount: 0, crit: false };
        acc.amount += w.damage * (r.head ? w.critMultiplier : 1) * falloff(w, r.distance) * p.mods.damage;
        acc.crit ||= r.head;
        perTarget.set(r.target, acc);
      } else {
        const damage = w.damage * falloff(w, r.distance) * p.mods.damage;
        if (!this.abilities.damageBarrier(r.handle, damage) && r.handle >= 0) this.interactives.damageHandle(r.handle, damage, p.index);
      }
    }
    this.events.push({ e: 'shot', by: p.index, w: f.w, id: slot.id, s: f.s, from: mm(muzzle), to, t: hitT });
    this.ledger?.shot(p.index, [...perTarget.keys()].some((k) => k < CREEP_TARGET_BASE));

    for (const [ti, dmg] of perTarget) {
      const cid = creepIdOf(ti);
      if (cid >= 0) {
        this.creeps.damage(cid, p.index, this.attributeDamage(p, dmg.amount), now);
        continue;
      }
      const q = this.byIndex(ti);
      if (q && this.dealDamage(p, q, dmg.amount, dmg.crit, now)) eliminated = true;
    }
    if (slot.ammo === 0) this.startReload(p);
    if (eliminated) {
      this.broadcastRoomState(); // kill counts
      this.checkMatchEnd();
    }
  }

  /**
   * Shield-then-Health damage from a weapon or an ability (tagged ABILITY), or a Health-only hazard (by = the hurt
   * player): drowning ('water') or the Tormenta (the dmg and elim events carry `c: 'tormenta'`). Emits the dmg event
   * and, on elimination, does the kill/death bookkeeping. Returns true when the target was eliminated (the caller
   * then checks the match end).
   */
  private dealDamage(by: ServerPlayer, q: ServerPlayer, amount: number, crit: boolean, now: number, ability?: AbilityId, hazard?: 'water' | DamageCause, extra: { cr?: number; m?: 1 } = {}): boolean {
    if (!q.vitals.alive || !this.canFight(q, now)) return false;
    expireTemporaryShield(q.vitals, now);
    if (!hazard && !ability && !extra.m && this.abilities.blocksAttack(q, by.state.pos, now)) return false;
    // Defesa takes its share off combat damage (weapons, punches, abilities, creeps), never off the Tormenta or water.
    // Damage the attributes changed is rounded with a carried remainder (the attacker's, or the victim's for a creep).
    if (!hazard || hazard === 'creep') {
      const scaled = q.mods.defense !== 1 || (!hazard && !ability && by !== q && by.mods.damage !== 1);
      if (scaled) amount = roundWithCarry(defendedDamage(amount, q.mods), hazard ? q : by);
    }
    // A creep's blow is an ordinary hit (Shield first); the Tormenta and the water take Health only.
    const res = hazard === 'tormenta' ? applyTormentaDamage(q.vitals, amount) : hazard === 'creep' ? applyDamage(q.vitals, amount, false) : hazard ? applyDrowning(q.vitals, amount) : ability ? applyAbilityDamage(q.vitals, amount) : applyDamage(q.vitals, amount, crit);
    if (!res.kinds.length) return false;
    recordPassiveCombat(q.runtime.passive, now, 'damage');
    const cause = hazard === 'tormenta' || hazard === 'creep' ? { c: hazard, ...extra } : extra;
    // Self harm changes nothing public (damage dealt, kills): no room-state broadcast for every hazard pulse.
    if (by !== q) {
      by.damageDealt += res.shieldDamage + res.healthDamage;
      q.lastHurtBy = by.index;
      q.lastHurtAt = now;
      this.roomStateDirty = true;
    }
    this.events.push({ e: 'dmg', by: by.index, target: q.index, amount: res.shieldDamage + res.healthDamage, kinds: res.kinds, health: q.vitals.health, shield: q.vitals.shield, ...(ability ? { a: ability } : {}), ...cause });
    this.ledger?.damage(by.index, q.index, res.shieldDamage + res.healthDamage);
    if (!res.eliminated) return false;
    q.deaths++;
    if (by !== q) by.kills++;
    this.ledger?.elimination(by.index, q.index, now);
    // No respawns inside a match: the eliminated player watches until the results.
    q.respawnAt = this.phase === MatchPhase.MATCH ? Infinity : now + ATTRIBUTES.respawnDelay * 1000;
    q.reloading = -1;
    q.queue.length = 0;
    q.castUntil = 0;
    q.pendingDash = null;
    q.state.dashSteps = 0;
    this.abilities.cancelFor(q.index);
    resetAbilityRuntime(q.runtime, now);
    q.vitals.temporaryShield = 0;
    q.vitals.temporaryShieldUntil = 0;
    delete q.state.abilityMovement;
    this.events.push({ e: 'elim', by: by.index, target: q.index, ...cause });
    // Everything the fallen player carried goes to the ground (the same pickups as a chest's).
    this.loot.dropAll(q);
    log('elimination', { code: this.roomId, by: by.name, target: q.name, ability: ability ?? hazard ?? '-' });
    return true;
  }

  // ------------------------------------------------------------------------------------------------ loot

  private lootHost(): LootHost {
    return {
      physics: this.roomPhysics(),
      actors: () => this.players.values(),
      gate: (a, now) => this.lootGate(a as ServerPlayer, now),
      emit: (e) => this.events.push(e),
      // SELF goes out with the reply (handlers) or at the end of the tick; the hand others see rides in ROOM_STATE.
      changed: (_a, weapons) => {
        if (weapons) this.roomStateDirty = true;
      },
      equip: (a, slot, now) => this.equip(a as ServerPlayer, slot, now),
    };
  }

  /** May this player open, take or use right now? */
  private lootGate(p: ServerPlayer, _now: number): LootReject {
    if (!this.legacyWarmup && this.phase !== MatchPhase.MATCH) return LootReject.PHASE;
    if (!p.vitals.alive) return LootReject.DEAD;
    if (this.phase === MatchPhase.ABILITY_DRAFT || this.phase === MatchPhase.RESULTS) return LootReject.PHASE;
    if (this.phase === MatchPhase.MATCH && !p.inMatch) return LootReject.PHASE;
    // Aboard the UFO or still in the air.
    if (p.deploy === DeployState.SHIP || p.deploy === DeployState.DIVING || p.state.diving) return LootReject.PHASE;
    // Hands on a ledge, a wall or the glider.
    if (!TRAVERSAL_ACTIONS[p.state.traversal].interact) return LootReject.BUSY;
    return LootReject.OK;
  }

  /**
   * A fresh loot generation (seeded; dev rooms may fix the seed): new chests, nothing on the ground. Loot events of
   * the old generation still waiting for this tick's flush are dropped, so nobody applies them to the new one.
   */
  private newLootGeneration(): void {
    this.events = this.events.filter((e) => e.e !== 'chest' && e.e !== 'items' && e.e !== 'take' && e.e !== 'door' && e.e !== 'crate');
    const seed = this.lootSeed ?? Math.floor(Math.random() * 0x100000000);
    this.loot.generate(seed, this.chestCount, this.lootSpots);
    this.broadcast(S2C.LOOT_STATE, this.loot.view());
    // Every match starts with its doors as built and every crate whole.
    this.interactives.reset();
    this.broadcast(S2C.WORLD_STATE, this.interactives.view(Date.now()));
    log('loot generation', { code: this.roomId, gen: this.loot.gen, seed: this.loot.seed, chests: this.loot.chests.length });
  }

  private onInteract(c: Client, m: unknown): void {
    const p = this.players.get(c.sessionId);
    const v = validateInteract(m);
    if (!p || !v) return;
    const r = this.loot.interact(p, v, Date.now());
    c.send(S2C.LOOT_RESULT, r);
    const st = p.statusIfChanged();
    if (st) c.send(S2C.SELF, st);
  }

  private onUseItem(c: Client, m: unknown): void {
    const p = this.players.get(c.sessionId);
    const v = validateUseItem(m);
    if (!p || !v) return;
    const now = Date.now();
    // Hands busy with a cast (the loot system checks everything else).
    const r: LootResultMsg = now < p.castUntil ? { s: v.s, a: LootAction.USE, ok: false, r: LootReject.BUSY, id: v.c } : this.loot.use(p, v, now);
    c.send(S2C.LOOT_RESULT, r);
    const st = p.statusIfChanged();
    if (st) c.send(S2C.SELF, st);
  }

  /** Dev builds only: regenerate, open everything, reveal contents, or drop an item at the requester's feet. */
  private onDevLoot(c: Client, m: unknown): void {
    if (!DEV) return;
    const p = this.players.get(c.sessionId);
    const v = validateDevLoot(m);
    if (!p || !v) return;
    if (v.op === 'regen') {
      if (v.seed !== undefined) this.lootSeed = v.seed;
      this.newLootGeneration();
    } else if (v.op === 'open_all') this.loot.devOpenAll(Date.now());
    else if (v.op === 'give' && v.item && v.item in ITEMS) this.loot.devGive(p, v.item as ItemId);
    c.send(S2C.LOOT_DEV, this.loot.devView());
  }

  // ------------------------------------------------------------------------------------------------ fists, creeps, progression

  /** Battle Royale rules for the kit: every competitive room, and the development warmup when asked (tests). */
  private battleRoyaleKit(): boolean {
    return (!this.legacyWarmup || this.unarmedStart) && (this.phase === MatchPhase.UFO || this.phase === MatchPhase.MATCH);
  }

  /** Creep options: the cap in any build (a host's performance), the seed and empty-hands warmup in dev only. */
  private configureCreeps(o: RoomCreateOptions): void {
    if (typeof o.creepCount === 'number' && Number.isFinite(o.creepCount)) this.creepCount = Math.max(0, Math.min(32, Math.floor(o.creepCount)));
    if (DEV && typeof o.creepSeed === 'number' && Number.isFinite(o.creepSeed)) this.creepSeed = o.creepSeed >>> 0;
    this.unarmedStart = DEV && o.unarmedStart === true;
  }

  /** A fresh creep population for the match (boarding, or the start without the UFO); the warmup gets one too. */
  private startCreeps(): void {
    if (!this.creeps) return;
    const live = this.phase === MatchPhase.UFO || this.phase === MatchPhase.MATCH || this.phase === MatchPhase.FREE_ROAM;
    if (!live) {
      this.creeps.clear();
      return;
    }
    this.creeps.start(this.creepSeed ?? Math.floor(Math.random() * 0x100000000), Date.now(), this.creepCount);
    log('creeps', { code: this.roomId, alive: this.creeps.alive, cap: this.creepCount });
  }

  private creepHost(): CreepHost {
    const targetable = (p: ServerPlayer) => p.vitals.alive && p.deploy !== DeployState.SHIP && p.deploy !== DeployState.DIVING && !p.state.diving && (this.phase !== MatchPhase.MATCH || p.inMatch);
    return {
      physics: this.roomPhysics(),
      players: () => [...this.players.values()].filter(targetable).map((p) => ({ index: p.index, pos: p.state.pos, alive: true })),
      hostile: (now) => (this.phase === MatchPhase.MATCH && now >= this.startsAt) || (this.legacyWarmup && this.phase === MatchPhase.FREE_ROAM),
      hurt: (c, target, amount, now) => {
        const q = this.byIndex(target);
        if (q && this.dealDamage(q, q, amount, false, now, undefined, 'creep', { cr: c.id })) {
          this.broadcastRoomState();
          this.checkMatchEnd();
        }
      },
      defeated: (c, _by, shares, now) => {
        for (const [index, xp] of shares) {
          const p = this.byIndex(index);
          if (p) this.awardXp(p, xp, c, index === _by, now);
        }
      },
      eligible: (index) => {
        const p = this.byIndex(index);
        return !!p && p.vitals.alive && (this.phase !== MatchPhase.MATCH || p.inMatch);
      },
      emit: (e) => this.events.push(e),
      // The Tormenta: new creeps only well inside the region it is closing onto; outside the safe region they dissolve.
      spawnable: (pos) => {
        const t = this.tormenta.target;
        return !t || angularDistance(t.center, pos) < t.radius - CREEP_RULES.tormentaMarginDeg * (Math.PI / 180);
      },
      inStorm: (pos) => this.phase === MatchPhase.MATCH && this.tormenta.outside(pos),
      capFactor: () => {
        const t = this.tormenta.target;
        return t ? (t.radius * 180) / Math.PI / CREEP_RULES.tormentaFullRadiusDeg : 1;
      },
    };
  }

  /**
   * MELEE: a punch with empty hands. Checks (in order): a newer sequence (no replays), alive, the fight is on, no
   * weapon in hand, hands free (not swimming, casting, using an item, in the air out of the UFO), the interval
   * (Velocidade de Ataque shortens it), and a camera origin near the attacker. One punch reaches at most one body.
   */
  private onMelee(c: PlayerConnection, m: unknown): void {
    const p = this.players.get(c.sessionId);
    const v = validateMelee(m);
    if (!p || !v) return;
    if (p.lastMeleeSeen >= 0 && !seqGreater(v.s, p.lastMeleeSeen)) return;
    p.lastMeleeSeen = v.s;
    const now = Date.now();
    if (!p.vitals.alive || !this.canFight(p, now) || !p.unarmed) return;
    if (p.state.swimming || now < p.castUntil || now < p.useUntil || p.state.diving || p.deploy === DeployState.SHIP || p.deploy === DeployState.DIVING) return;
    if (!TRAVERSAL_ACTIONS[p.state.traversal].fire) return;
    if (this.abilities.attackLocked(p, now)) return;
    if (!meleeReady(p.lastMeleeAt, now, p.mods.meleeIntervalMs)) return;
    const up = v3normalize(p.state.pos);
    const head = { x: p.state.pos.x + up.x * 1.6, y: p.state.pos.y + up.y * 1.6, z: p.state.pos.z + up.z * 1.6 };
    const origin = { x: v.o[0] / POS_SCALE, y: v.o[1] / POS_SCALE, z: v.o[2] / POS_SCALE };
    if (Math.hypot(origin.x - head.x, origin.y - head.y, origin.z - head.z) > MELEE.maxCameraOffset) return;
    const dir = v3normalize({ x: v.d[0] / DIR_SCALE, y: v.d[1] / DIR_SCALE, z: v.d[2] / DIR_SCALE });
    p.lastMeleeAt = now;
    recordPassiveCombat(p.runtime.passive, now, 'fire');
    p.meleeHand ^= 1;
    const bodies: MeleeBody[] = [];
    for (const q of this.players.values()) {
      if (q === p || !q.vitals.alive || (this.phase === MatchPhase.MATCH && !q.inMatch)) continue;
      bodies.push({ id: q.index, creep: false, feet: q.state.pos, alive: true, ...PLAYER_MELEE_BODY });
    }
    bodies.push(...this.creeps.meleeBodies());
    const out = resolveMelee(this.roomPhysics(), p.state.pos, dir, bodies, p.index, GROUPS_WORLD_QUERY, MELEE, p.state.facing);
    this.events.push({ e: 'melee', by: p.index, s: v.s, h: p.meleeHand, r: out.result, t: out.target, at: mm(out.point) });
    const amount = MELEE.damage * p.mods.damage;
    if (out.result === 1) {
      const q = this.byIndex(out.target);
      if (q && this.dealDamage(p, q, amount, false, now, undefined, undefined, { m: 1 })) {
        this.broadcastRoomState();
        this.checkMatchEnd();
      }
    } else if (out.result === 2) this.creeps.damage(out.target, p.index, this.attributeDamage(p, amount), now, { m: 1 });
    else {
      // A punch into a breakable crate (the same reach, from the chest).
      const chest = { x: p.state.pos.x + up.x * 1.1, y: p.state.pos.y + up.y * 1.1, z: p.state.pos.z + up.z * 1.1 };
      this.interactives.meleeHit(chest, v3normalize(v3projectOnPlane(dir, up)), MELEE.range + 0.3, amount, p.index);
    }
  }

  /** Damage to a creep scaled by the attacker's Ataque: rounded with the attacker's carried remainder. */
  private attributeDamage(p: ServerPlayer, amount: number): number {
    return p.mods.damage !== 1 ? roundWithCarry(amount, p) : amount;
  }

  /** WORLD_USE: open or close a door (a living player in the world; the room checks reach, rate and the doorway). */
  private onWorldUse(c: Client, m: unknown): void {
    const p = this.players.get(c.sessionId);
    const v = validateWorldUse(m);
    if (!p || !v || !p.vitals.alive) return;
    if (p.deploy === DeployState.SHIP || p.deploy === DeployState.DIVING || p.state.diving) return;
    if (!TRAVERSAL_ACTIONS[p.state.traversal].interact) return;
    if (this.phase === MatchPhase.MATCH && !p.inMatch) return;
    this.interactives.use(p, v, Date.now());
  }

  /** The characters standing in this room's world (doors do not close on them). */
  private *interactiveActors(): Iterable<{ index: number; state: { pos: Vec3 } }> {
    for (const p of this.players.values()) if (p.vitals.alive && p.deploy !== DeployState.SHIP) yield p;
  }

  /** ALLOCATE_STAT: one unspent point into an attribute (in the match, alive). */
  private onAllocate(c: Client, m: unknown): void {
    const p = this.players.get(c.sessionId);
    const v = validateAllocateStat(m);
    if (!p || !v) return;
    if (p.lastAllocSeq >= 0 && !seqGreater(v.s, p.lastAllocSeq)) return;
    p.lastAllocSeq = v.s;
    if (!this.allocate(p, v.k)) return;
    c.send(S2C.SELF, p.statusIfChanged(true));
  }

  /** Spends one point (in the match, alive; the attribute below its cap). Bots come through here too. */
  private allocate(p: ServerPlayer, k: number): boolean {
    if (!p.vitals.alive || (!this.legacyWarmup && this.phase !== MatchPhase.MATCH)) return false;
    if (!allocateStat(p.prog, k)) return false;
    this.applyStats(p);
    return true;
  }

  /**
   * The spent points' effects on this life (statModifiers): Health and Mana maxima, Mana regeneration, damage,
   * Defesa and attack speed. Growing maxima keep Health and Mana at the same fraction — a point never refills.
   */
  private applyStats(p: ServerPlayer): void {
    const mods = statModifiers(p.prog);
    p.mods = mods;
    const v = p.vitals;
    const prev = { maxHealth: maxHealthOf(v), maxMana: maxManaOf(v) };
    v.maxHealth = mods.maxHealth;
    v.maxMana = mods.maxMana;
    v.manaRegen = mods.manaRegen;
    rescaleVitals(v, prev, mods);
  }

  /** XP from a creep: levels (each one a point), the private PROGRESS note, and the public level-up. */
  private awardXp(p: ServerPlayer, xp: number, creep: CreepRuntime, last: boolean, _now: number): void {
    if (xp <= 0) return;
    const up = addXp(p.prog, xp);
    const [level, cur, next, points] = progressionTuple(p.prog);
    const msg: ProgressMsg = { xp, creep: CREEP_TYPE_IDS.indexOf(creep.type), last, up, level, cur, next, points };
    p.client.send(S2C.PROGRESS, msg);
    if (up > 0) {
      this.events.push({ e: 'lvl', target: p.index, level: p.prog.level });
      this.roomStateDirty = true;
      log('level up', { code: this.roomId, name: p.name, level: p.prog.level });
      // Bots spend their points at once, in their profile's order (the same rules and caps as a person's request).
      const brain = p.bot ? this.bots.get(p.index) : undefined;
      if (brain) while (p.prog.points > 0 && this.allocate(p, botStatChoice(p.prog, brain.profile)));
    }
  }

  /**
   * A bot's attack this tick, through the same handlers a person's messages go through. With empty hands it punches
   * its opponent, or a creep that is after it, when in reach; armed, it shoots its opponent as before, or a creep
   * biting it when no opponent is close.
   */
  private botAttack(p: ServerPlayer, brain: BotRuntime, target: ServerPlayer | undefined, intent: { origin: Vec3; distance: number; aim: Vec3 }, seekZone: boolean, now: number): void {
    if (this.phase !== MatchPhase.MATCH || !this.canFight(p, now) || now < brain.nextShotAt) return;
    const head = intent.origin;
    const aimAt = (feet: Vec3, h: number): [number, number, number] => {
      const u = v3normalize(feet);
      const d = v3normalize({ x: feet.x + u.x * h - head.x, y: feet.y + u.y * h - head.y, z: feet.z + u.z * h - head.z });
      return [Math.round(d.x * DIR_SCALE), Math.round(d.y * DIR_SCALE), Math.round(d.z * DIR_SCALE)];
    };
    const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    let creep: CreepRuntime | undefined;
    let creepD = Infinity;
    for (const c of this.creeps.creeps.values()) {
      if (c.state === CreepStateCode.DEAD || c.state === CreepStateCode.RETURN) continue;
      const d = dist(c.pos, p.state.pos);
      if ((c.target === p.index || d < MELEE.range + c.def.radius) && d < creepD) {
        creepD = d;
        creep = c;
      }
    }
    // The creep it is farming counts even when it is not after the bot (yet).
    const hunted = brain.creep >= 0 ? this.creeps.creeps.get(brain.creep) : undefined;
    const huntedD = hunted && hunted.state !== CreepStateCode.DEAD ? dist(hunted.pos, p.state.pos) : Infinity;
    if (!creep && hunted && huntedD < Infinity) {
      creep = hunted;
      creepD = huntedD;
    }
    if (p.unarmed) {
      // Loot first: an opponent gets punched when it provoked the bot, or when there is no chest left to go to.
      const brawl = !!target && (brain.chest < 0 || this.botProvoked(p, target, now));
      const reach = target && brawl ? dist(target.state.pos, p.state.pos) : Infinity;
      const at = target && reach < MELEE.range + 0.5 && reach <= creepD ? aimAt(target.state.pos, 1.0) : creep && creepD < MELEE.range + creep.def.radius + 0.2 ? aimAt(creep.pos, creep.def.hitbox.top * 0.5) : null;
      if (!at) return;
      brain.nextShotAt = now + p.mods.meleeIntervalMs + 40;
      brain.fireSeq = (brain.fireSeq + 1) & 0x7fffffff;
      this.onMelee(p.client, { s: brain.fireSeq, o: mm(head), d: at });
      return;
    }
    const farming = !!creep && creep === hunted && creepD < 24 && (!target || intent.distance > BOT_FIGHT_RANGE) && this.botSeesPoint(p, creep.pos, creep.def.hitbox.top * 0.5);
    if (creep && ((creepD < 5 && (!target || intent.distance > 10)) || farming)) {
      brain.nextShotAt = now + 340 + p.index * 20;
      brain.fireSeq = (brain.fireSeq + 1) & 0x7fffffff;
      this.onFire(p.client, { s: brain.fireSeq, w: p.weapon, o: mm(head), d: aimAt(creep.pos, creep.def.hitbox.top * 0.5), a: 1 });
      return;
    }
    if (seekZone || !target || intent.distance > 55 || now - brain.acquiredAt < 650) return;
    brain.nextShotAt = now + 340 + p.index * 20;
    brain.fireSeq = (brain.fireSeq + 1) & 0x7fffffff;
    this.onFire(p.client, { s: brain.fireSeq, w: p.weapon, o: mm(intent.origin), d: [Math.round(intent.aim.x * DIR_SCALE), Math.round(intent.aim.y * DIR_SCALE), Math.round(intent.aim.z * DIR_SCALE)], a: 1 });
  }

  // ------------------------------------------------------------------------------------------------ abilities

  private abilityHost(): AbilityHost {
    return {
      physics: this.roomPhysics(),
      actors: () => this.players.values(),
      sendPrivate: (a, message) => (a as ServerPlayer).client.send(S2C.ABILITY_REVEAL, message),
      teleport: (a, feet, facing) => {
        const p = a as ServerPlayer;
        p.state.pos = { ...feet };
        p.state.facing = { ...facing };
        p.state.vel = { x: 0, y: 0, z: 0 };
        this.motor.placeCollider(p.body.collider, feet);
        p.queue.length = 0;
        p.pendingDash = null;
      },
      resources: () => [
        ...this.loot.chests.filter((c) => c.state === 0).map((c) => ({ id: c.id, kind: 'chest' as const, at: c.spot.pos })),
        ...[...this.loot.items.values()].map((item) => ({ id: item.id, kind: 'pickup' as const, at: item.pos })),
      ],
      createBarrier: (_view, frame) => {
        const barrier = createAbilityBarrier(this.world.physics, frame);
        this.abilityColliders.add(barrier.handle);
        return { handle: barrier.handle, dispose: () => { this.abilityColliders.delete(barrier.handle); barrier.dispose(); } };
      },
      canFight: (a, now) => this.canFight(a as ServerPlayer, now),
      damage: (by, target, amount, ability, now) => {
        if (this.dealDamage(by as ServerPlayer, target as ServerPlayer, amount, false, now, ability)) {
          this.broadcastRoomState();
          this.checkMatchEnd();
        }
      },
      dash: (a: AbilityActor, dir, distance, duration, cmdSeq) => {
        const p = a as ServerPlayer;
        // The dash starts at the client's announced command when that is plausible, else at the next one simulated.
        const ahead = p.lastSeq < 0 ? 1 : (cmdSeq - p.lastSeq) & 0x7fffffff;
        p.pendingDash = { seq: ahead >= 1 && ahead <= MAX_DASH_LEAD ? cmdSeq : -1, dir: { ...dir }, distance, duration };
      },
      emit: (e) => this.events.push(e),
      others: () => this.creeps.hitTargets(),
      damageOther: (by, target, amount, ability, now) => {
        const id = creepIdOf(target);
        if (id >= 0) this.creeps.damage(id, by.index, amount, now, { a: ability });
      },
    };
  }

  private onAbility(c: PlayerConnection, m: unknown): void {
    const p = this.players.get(c.sessionId);
    const v = validateAbilityRequest(m);
    if (!p || !v) return;
    const reply = (r: AbilityReject) => {
      const msg: AbilityResultMsg = { s: v.s, k: v.k, ok: r === AbilityReject.OK, r };
      c.send(S2C.ABILITY_RESULT, msg);
      const st = p.statusIfChanged(true);
      if (st) c.send(S2C.SELF, st);
    };
    if (p.lastAbilitySeq >= 0 && !seqGreater(v.s, p.lastAbilitySeq)) return reply(AbilityReject.STALE);
    p.lastAbilitySeq = v.s;
    const now = Date.now();
    const dir = v.d ? v3normalize({ x: v.d[0] / DIR_SCALE, y: v.d[1] / DIR_SCALE, z: v.d[2] / DIR_SCALE }) : undefined;
    const point = v.p ? { x: v.p[0] / POS_SCALE, y: v.p[1] / POS_SCALE, z: v.p[2] / POS_SCALE } : undefined;
    // No casting while swimming (the hands are stroking); the client locks its slots in the water too. On a ledge or a
    // wall nothing is cast, on the glider only mobility (which takes the glide over).
    if (p.state.swimming || now < p.useUntil) return reply(AbilityReject.BUSY);
    if (!traversalAllowsCast(p.state.traversal, v.a)) return reply(AbilityReject.BUSY);
    const r = this.abilities.request(p,{ slot: v.k, id: v.a, seq: v.s, cmdSeq: v.c, dir, point }, now);
    if (r === AbilityReject.OK) {
      p.castUltimate = v.k === ULTIMATE_SLOT;
      this.abilities.recordActivity(p.index, now);
      this.ledger?.cast(p.index);
    }
    reply(r);
  }

  /** Fresh life: basics ready, Ultimate charging, no wind-up, slow or pending dash. */
  private resetAbilities(p: ServerPlayer, now: number): void {
    resetAbilityRuntime(p.runtime, now);
    p.vitals.temporaryShield = 0;
    p.vitals.temporaryShieldUntil = 0;
    delete p.state.abilityMovement;
    resetCooldowns(p.cooldownEnds, now, this.ultimateChargeMs);
    p.castUntil = 0;
    p.slowUntil = 0;
    p.slowFactor = 1;
    p.pendingDash = null;
    p.state.dashSteps = 0;
    p.state.slow = 1;
    this.abilities.cancelFor(p.index);
  }

  private byIndex(i: number): ServerPlayer | undefined {
    for (const p of this.players.values()) if (p.index === i) return p;
    return undefined;
  }

  // ------------------------------------------------------------------------------------------------ simulation

  /** Generate normal player intents; all gameplay consequences still run through the usual room paths. */
  private updateBots(now: number, dt: number): void {
    if (!this.bots.size) return;
    if (this.phase === MatchPhase.ABILITY_DRAFT && this.draft) {
      let picked = false;
      for (const [index] of this.bots) {
        const seat = this.draft.seat(index);
        if (!seat || seat.pending) continue;
        const free = this.draft.available(index);
        const id = free[(index + this.draft.round) % free.length];
        if (id) picked = this.draft.pick(index, this.draft.round, id, now) === DraftReject.OK || picked;
      }
      if (picked) this.sendDraftStates();
      return;
    }
    if (this.phase === MatchPhase.RESULTS || this.phase === MatchPhase.PREPARATION || this.phase === MatchPhase.LOBBY || this.phase === MatchPhase.CLOSED) return;
    // People who already left the UFO: bots follow them out of the hatch and steer toward their landing.
    const outOfShip = (q: ServerPlayer) => !q.bot && q.inMatch && q.deploy !== DeployState.SHIP;
    const anyoneOut = [...this.players.values()].some(outOfShip);
    for (const [index, brain] of this.bots) {
      const p = this.byIndex(index);
      if (!p?.vitals.alive) {
        brain.acc = 0;
        continue;
      }
      if (p.deploy === DeployState.SHIP) {
        brain.acc = 0;
        // Out of the hatch after the first person, with a short stagger.
        if (this.ufo && anyoneOut && jumpOpen(this.ufo, now) && now >= this.ufo.open + index * 160) this.jump(p, now, false);
        continue;
      }
      let target: ServerPlayer | undefined;
      let nearest = Infinity;
      for (const q of this.players.values()) {
        if (q === p || !q.connected || !q.vitals.alive || (this.phase === MatchPhase.MATCH && !q.inMatch)) continue;
        if (this.phase === MatchPhase.UFO && !outOfShip(q)) continue;
        const distance = Math.hypot(q.state.pos.x - p.state.pos.x, q.state.pos.y - p.state.pos.y, q.state.pos.z - p.state.pos.z);
        if (distance < nearest) {
          nearest = distance;
          target = q;
        }
      }
      if ((target?.index ?? -1) !== brain.target) {
        brain.target = target?.index ?? -1;
        brain.acquiredAt = now;
      }
      // The Tormenta closes in: outside (or at the edge of) the region it closes onto, a bot heads for its centre
      // unless its opponent is close; it does not shoot while it runs for it.
      const goal = this.phase === MatchPhase.MATCH ? this.tormenta.target : null;
      const near = target && Math.hypot(target.state.pos.x - p.state.pos.x, target.state.pos.y - p.state.pos.y, target.state.pos.z - p.state.pos.z) < 20;
      const seekZone = !!goal && !near && tormentaEdgeMeters(goal, p.state.pos) > -4;
      const zone = seekZone && goal ? this.world.terrain.surfaceAt(goal.center) : undefined;
      const targetDistance = target ? Math.hypot(target.state.pos.x - p.state.pos.x, target.state.pos.y - p.state.pos.y, target.state.pos.z - p.state.pos.z) : Infinity;
      const sees = !!target && targetDistance < BOT_FIGHT_RANGE + 20 && this.botSees(p, target);
      // What it walks toward, in order: the Tormenta's safe region; away from a tough creep it cannot face (empty
      // hands or badly hurt); a creep to farm while nobody is near (with empty hands only a basic one right there);
      // the nearest closed chest while nobody is near (always first without any weapon, unless an opponent is within
      // punching reach); an opponent in plain sight (straight at it, strafing); the nearest opponent out of sight.
      const weaponless = !p.inv.slots.some(Boolean);
      const provoked = this.botProvoked(p, target, now);
      const inMatch = this.phase === MatchPhase.MATCH;
      const hurt = p.vitals.health < maxHealthOf(p.vitals) * BOT_HURT_FRACTION && p.vitals.shield <= 0;
      const fighting = sees && targetDistance < BOT_FIGHT_RANGE + 6;
      const threat = !zone && inMatch && (weaponless || hurt) ? this.botCreepThreat(p) : null;
      const hunt = !zone && !threat && !hurt && inMatch && !fighting && targetDistance > BOT_CALM_RANGE * 0.6 ? this.botCreep(p, brain, weaponless, now) : null;
      if (!hunt) brain.creep = -1;
      const chest = !zone && !threat && !hunt && inMatch && (targetDistance > BOT_CALM_RANGE || (weaponless && !provoked)) ? this.botChest(p, brain, now) : null;
      const flee = threat ? awayFrom(p.state.pos, threat.pos, 8) : undefined;
      const huntClose = !!hunt && Math.hypot(hunt.pos.x - p.state.pos.x, hunt.pos.y - p.state.pos.y, hunt.pos.z - p.state.pos.z) < 18 && this.botSeesPoint(p, hunt.pos, hunt.def.hitbox.top * 0.5);
      const direct = !zone && !chest && (!!flee || huntClose || (!hunt && sees && targetDistance < BOT_FIGHT_RANGE));
      const seek = zone ?? flee ?? hunt?.pos ?? chest ?? target?.state.pos;
      let intent: ReturnType<typeof botIntent>;
      if (direct || !seek) {
        brain.nav.reset();
        // Unarmed, it closes in to punching distance; armed, it keeps a few metres of room (a little less from a creep).
        const keep = flee ? 0 : hunt ? (p.unarmed ? 0.7 : 5) : p.unarmed ? 0.9 : 6;
        intent = botIntent(p.state, seek, index, now, false, null, true, keep);
        if (p.state.grounded && seek) {
          const up = v3normalize(p.state.pos);
          const probe = { x: p.state.pos.x + up.x * 0.7, y: p.state.pos.y + up.y * 0.7, z: p.state.pos.z + up.z * 0.7 };
          if (this.roomPhysics().castRay(probe, intent.wish, 2)) intent = botIntent(p.state, seek, index, now, true, null, true, keep);
        }
      } else {
        const walking = p.state.grounded || p.state.swimming;
        const step = walking ? brain.nav.next(getNav(this.world), p.state.pos, seek, now) : { point: null, stuck: false, left: 0 };
        intent = botIntent(p.state, sees ? target!.state.pos : undefined, index, now, step.stuck, step.point ?? seek, sees);
      }
      if (chest) this.botLoot(p, brain, now);
      // A closed door in the way: the bot opens it.
      if (p.state.grounded) this.interactives.assist(p, intent.wish, now);
      brain.acc = Math.min(brain.acc + dt * SIM_HZ, MAX_INPUT_BACKLOG);
      while (brain.acc >= 1 && p.queue.length < MAX_INPUT_BACKLOG) {
        brain.seq = (brain.seq + 1) & 0x7fffffff;
        p.queue.push([brain.seq, Math.round(intent.wish.x * WISH_SCALE), Math.round(intent.wish.y * WISH_SCALE), Math.round(intent.wish.z * WISH_SCALE), Math.round(intent.aim.x * AIM_SCALE), Math.round(intent.aim.y * AIM_SCALE), Math.round(intent.aim.z * AIM_SCALE), intent.buttons]);
        brain.acc -= 1;
      }
      this.botAbility(p, brain, target, intent, seekZone, now);
      this.botAttack(p, brain, target, intent, seekZone, now);
    }
  }

  /** Line of sight from a bot's eyes to another player's chest (the same world query shots use). */
  private botAbility(p: ServerPlayer, brain: BotRuntime, target: ServerPlayer | undefined, intent: ReturnType<typeof botIntent>, seekZone: boolean, now: number): void {
    if (now < brain.nextAbilityAt || !this.canFight(p, now)) return;
    brain.nextAbilityAt = now + 600 + p.index * 17;
    const physics = this.roomPhysics();
    const up = v3normalize(p.state.pos);
    const from = { x: p.state.pos.x + up.x * 1.1, y: p.state.pos.y + up.y * 1.1, z: p.state.pos.z + up.z * 1.1 };
    const wall = physics.castRayNormal(from, intent.wish, 12);
    const choice = chooseBotAbility(p, {
      now, distance: intent.distance, hasEnemy: !!target, enemyVisible: !!target && this.botSees(p, target),
      seekingZone: seekZone, hasResources: this.loot.chests.some((c) => c.state === 0 && Math.hypot(c.spot.pos.x - p.state.pos.x, c.spot.pos.y - p.state.pos.y, c.spot.pos.z - p.state.pos.z) < 12),
      nearWall: !!wall, recentlyHurt: now - p.runtime.passive.lastDamageAt < 3500, canFight: true,
    }, Math.floor(now / 1000 + p.index) % 4);
    if (!choice) return;
    const { def, slot } = choice;
    const mobility = def.effects.find((e) => e.kind === 'mobility');
    const dir = mobility || def.effects.some((e) => e.kind === 'dash' || e.kind === 'portal') ? intent.wish : intent.aim;
    const point = def.targetType === 'point'
      ? resolveTargetPoint(physics, this.world.terrain, p.state.pos, from, dir, def.range) : undefined;
    brain.abilitySeq = (brain.abilitySeq + 1) & 0x7fffffff;
    this.onAbility(p.client, {
      s: brain.abilitySeq, k: slot, a: def.id, c: (p.lastSeq + 1) & 0x7fffffff,
      d: [Math.round(dir.x * DIR_SCALE), Math.round(dir.y * DIR_SCALE), Math.round(dir.z * DIR_SCALE)],
      ...(point ? { p: mm(point) } : {}),
    });
  }

  private botSees(p: ServerPlayer, q: ServerPlayer): boolean {
    const up = v3normalize(p.state.pos);
    const from = { x: p.state.pos.x + up.x * 1.5, y: p.state.pos.y + up.y * 1.5, z: p.state.pos.z + up.z * 1.5 };
    const qu = v3normalize(q.state.pos);
    const to = { x: q.state.pos.x + qu.x * 1.1, y: q.state.pos.y + qu.y * 1.1, z: q.state.pos.z + qu.z * 1.1 };
    const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
    const l = Math.hypot(d.x, d.y, d.z);
    return l < 0.5 || !this.roomPhysics().castRay(from, { x: d.x / l, y: d.y / l, z: d.z / l }, l);
  }

  /** Line of sight from a bot's eyes to a point `h` metres above some feet (creeps). */
  private botSeesPoint(p: ServerPlayer, feet: Vec3, h: number): boolean {
    const up = v3normalize(p.state.pos);
    const from = { x: p.state.pos.x + up.x * 1.5, y: p.state.pos.y + up.y * 1.5, z: p.state.pos.z + up.z * 1.5 };
    const fu = v3normalize(feet);
    const to = { x: feet.x + fu.x * h, y: feet.y + fu.y * h, z: feet.z + fu.z * h };
    const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
    const l = Math.hypot(d.x, d.y, d.z);
    return l < 0.5 || !this.roomPhysics().castRay(from, { x: d.x / l, y: d.y / l, z: d.z / l }, l, GROUPS_WORLD_QUERY);
  }

  /** Did this opponent hurt the bot within BOT_RETALIATE_MS (an unarmed bot then fights back instead of looting)? */
  private botProvoked(p: ServerPlayer, target: ServerPlayer | undefined, now: number): boolean {
    return !!target && p.lastHurtBy === target.index && now - p.lastHurtAt < BOT_RETALIATE_MS;
  }

  /** May this bot take this creep on? Empty hands: basic creeps only. Armed: all but the elite, which waits for level 4 and good health. */
  private botCanTake(p: ServerPlayer, c: CreepRuntime, weaponless: boolean): boolean {
    if (weaponless) return c.def.tier === 'basic';
    if (c.def.tier === 'elite') return p.prog.level >= 4 && p.vitals.health >= maxHealthOf(p.vitals) * 0.7;
    return true;
  }

  /** The creep a bot farms (kept while it lives and the hunt is not taking too long), or null. */
  private botCreep(p: ServerPlayer, brain: BotRuntime, weaponless: boolean, now: number): CreepRuntime | null {
    const usable = (c: CreepRuntime) => c.state !== CreepStateCode.DEAD && c.state !== CreepStateCode.RETURN && (brain.skipCreeps.get(c.id) ?? 0) <= now && this.botCanTake(p, c, weaponless);
    const range = weaponless ? BOT_PUNCH_CREEP_RANGE : BOT_CREEP_RANGE;
    const dist = (c: CreepRuntime) => Math.hypot(c.pos.x - p.state.pos.x, c.pos.y - p.state.pos.y, c.pos.z - p.state.pos.z);
    const current = brain.creep >= 0 ? this.creeps.creeps.get(brain.creep) : undefined;
    if (current && now - brain.creepSince > BOT_HUNT_MS) brain.skipCreeps.set(current.id, now + 60000);
    else if (current && usable(current) && dist(current) < range + 12) return current;
    brain.creep = -1;
    let best: CreepRuntime | undefined;
    let bestD: number = range;
    for (const c of this.creeps.creeps.values()) {
      if (!usable(c)) continue;
      const d = dist(c);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (!best) return null;
    brain.creep = best.id;
    brain.creepSince = now;
    brain.nav.reset();
    return best;
  }

  /** A tough or elite creep chasing this bot from close by (it backs away from it), or null. */
  private botCreepThreat(p: ServerPlayer): CreepRuntime | null {
    for (const c of this.creeps.creeps.values()) {
      if (c.target !== p.index || (c.def.tier !== 'tough' && c.def.tier !== 'elite')) continue;
      if (c.state !== CreepStateCode.ALERT && c.state !== CreepStateCode.CHASE && c.state !== CreepStateCode.ATTACK) continue;
      if (Math.hypot(c.pos.x - p.state.pos.x, c.pos.y - p.state.pos.y, c.pos.z - p.state.pos.z) < 12) return c;
    }
    return null;
  }

  /** The closed chest a bot explores toward (kept until opened and emptied, or given up), or null. */
  private botChest(p: ServerPlayer, brain: BotRuntime, now: number): Vec3 | null {
    const chests = this.loot.chests;
    const current = brain.chest >= 0 ? chests[brain.chest] : undefined;
    if (current && (brain.skipChests.get(current.id) ?? 0) <= now) {
      if (current.state === ChestState.CLOSED) return current.spot.pos;
      // Opened by this bot: it stays for the rewards.
      if (current.by === p.index && current.state !== ChestState.EMPTY) return current.spot.pos;
    }
    brain.chest = -1;
    const taken = new Set([...this.bots.values()].map((b) => b.chest));
    let best: (typeof chests)[number] | undefined;
    let bestD = BOT_CHEST_RANGE;
    for (const c of chests) {
      if (c.state !== ChestState.CLOSED || taken.has(c.id) || (brain.skipChests.get(c.id) ?? 0) > now) continue;
      const d = Math.hypot(c.spot.pos.x - p.state.pos.x, c.spot.pos.y - p.state.pos.y, c.spot.pos.z - p.state.pos.z);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (!best) return null;
    brain.chest = best.id;
    brain.chestSince = now;
    brain.nav.reset();
    return best.spot.pos;
  }

  /** Near its chest: open it, then take what came out of it (the same requests a person sends). */
  private botLoot(p: ServerPlayer, brain: BotRuntime, now: number): void {
    const c = brain.chest >= 0 ? this.loot.chests[brain.chest] : undefined;
    if (!c) return;
    // A chest it cannot get to in a minute is left for later.
    if (c.state === ChestState.CLOSED && now - brain.chestSince > 60000) {
      brain.skipChests.set(c.id, now + 120000);
      brain.chest = -1;
      return;
    }
    const d = Math.hypot(c.spot.pos.x - p.state.pos.x, c.spot.pos.y - p.state.pos.y, c.spot.pos.z - p.state.pos.z);
    if (d > LOOT_RULES.chestRange) return;
    if (c.state === ChestState.CLOSED) {
      brain.lootSeq = (brain.lootSeq + 1) & 0x7fffffff;
      const r = this.loot.interact(p, { s: brain.lootSeq, k: 0, id: c.id, g: this.loot.gen }, now);
      if (r.ok) brain.chestSince = now;
      return;
    }
    if (c.state === ChestState.OPENING) return;
    for (const id of c.items) {
      brain.lootSeq = (brain.lootSeq + 1) & 0x7fffffff;
      const r = this.loot.interact(p, { s: brain.lootSeq, k: 1, id, g: this.loot.gen }, now);
      if (r.ok || r.r === LootReject.RATE) break;
    }
    // Done once it is empty, or what is left is nothing it can carry (a weapon with both hands full).
    if (c.state === ChestState.EMPTY || now - brain.chestSince > 3500) {
      brain.skipChests.set(c.id, now + 600000);
      brain.chest = -1;
      brain.nav.reset();
    }
  }

  private update(): void {
    const t0 = performance.now();
    const dt = Math.min(0.25, (t0 - this.lastTickAt) / 1000);
    this.lastTickAt = t0;
    this.tick++;
    const wall = Date.now();
    if (this.phase === MatchPhase.CLOSED) return;
    if (this.phase === MatchPhase.RESULTS && wall >= this.phaseEndsAt) this.returnToWarmup();
    if (this.phase === MatchPhase.PREPARATION && this.preparation && wall >= this.preparation.deadline) {
      this.broadcast(S2C.NOTICE, { kind: 'error', code: NoticeCode.LOAD_TIMEOUT, text: 'O carregamento demorou demais. A sala voltou ao lobby; tente novamente.' } satisfies NoticeMsg);
      this.returnToWarmup();
    }
    const tb = performance.now();
    this.updateBots(wall, dt);
    this.perf.botMs = this.perf.botMs * 0.9 + (performance.now() - tb) * 0.1;
    if (this.phase === MatchPhase.ABILITY_DRAFT && this.draft?.update(wall)) {
      this.sendDraftStates();
      this.checkDraftDone();
    }
    // Lobbies, draft and loading are intent/metadata only. No movement, physics, combat, loot or snapshots.
    if (!this.legacyWarmup && (this.phase === MatchPhase.LOBBY || this.phase === MatchPhase.ABILITY_DRAFT || this.phase === MatchPhase.PREPARATION)) {
      this.tickCost = this.tickCost * 0.9 + (performance.now() - t0) * 0.1;
      return;
    }
    if (this.phase === MatchPhase.UFO && this.ufo) {
      // The window closed: whoever is still aboard is dropped; a diver still airborne long after is set down.
      const close = this.ufo.close;
      if (wall >= close) for (const p of this.players.values()) if (p.deploy === DeployState.SHIP) this.jump(p, close, true);
      if (wall >= close + this.landTimeoutMs) for (const p of this.players.values()) if (p.deploy === DeployState.DIVING) this.forceLand(p);
    }

    for (const p of this.players.values()) {
      p.budget = Math.min(p.budget + dt * SIM_HZ, MAX_INPUT_BACKLOG);
      // Reloads and respawns.
      if (p.reloading >= 0 && wall >= p.reloadEndsAt) {
        finishReload(p.inv, p.reloading);
        p.reloading = -1;
      }
      if (!p.vitals.alive) {
        p.queue.length = 0;
        if (wall >= p.respawnAt) this.respawn(p);
        continue;
      }
      if (p.deploy === DeployState.SHIP) {
        // Riding the UFO: commands are acknowledged and dropped; the position follows the ship.
        if (p.queue.length) p.lastSeq = p.queue[p.queue.length - 1]![0];
        p.queue.length = 0;
        if (this.ufo) {
          ufoPosition(this.ufo, wall, p.state.pos);
          const v = ufoHeading(this.ufo, wall);
          const speed = ufoSpeed(this.ufo);
          p.state.vel = { x: v.x * speed, y: v.y * speed, z: v.z * speed };
        }
        p.simTime = wall - 60;
        continue;
      }
      regenMana(p.vitals, dt);
      updateStatusEffects(p.runtime, wall, p.vitals.alive);
      const passive = updatePassives(p.loadout, p.runtime.passive, p.vitals, dt, wall);
      const statuses = statusModifiers(p.runtime, wall);
      p.state.slow = statuses.speedFactor;
      p.state.rooted = statuses.rooted;
      p.state.noSprint = statuses.noSprint;
      p.state.airControl = passive.airControl;
      p.state.sprintSpeed = passive.speed;
      // Bots start no traversal until their navigation plans ledges, walls and glides (docs/world/VERTICAL_BOT_NAVIGATION.md).
      if (p.bot) p.state.traversalCaps = 0;
      let stepped = 0;
      // Keep a small jitter buffer once the stream is flowing: steady consumption = smooth remote motion.
      const keep = p.queue.length > INPUT_JITTER_BUFFER + 6 ? 0 : INPUT_JITTER_BUFFER;
      while (p.queue.length > keep && p.budget >= 1) {
        const cmd = p.queue.shift()!;
        const dash = p.pendingDash;
        if (dash && (dash.seq < 0 || !seqGreater(dash.seq, cmd[0]))) {
          startDash(p.state, dash.dir, dash.distance, dash.duration, SIM_DT);
          p.pendingDash = null;
        }
        this.motor.step(p.body, p.state, decodeInput(cmd, p.input), SIM_DT);
        p.breath = stepBreath(p.breath, p.state.pos, SIM_DT);
        p.simTime += SIM_DT * 1000;
        p.lastSeq = cmd[0];
        p.budget -= 1;
        stepped++;
      }
      // The per-player clock only resyncs on gross drift (stalls); clients adapt to its steady offset.
      if (Math.abs(wall - p.simTime) > 1000) p.simTime = wall - 60;
      // A client that stops sending (tab hidden) still falls; it is corrected when it resumes.
      if (stepped === 0) {
        p.starvedFor += dt;
        if (p.starvedFor > 0.3 && !p.state.grounded) {
          p.input.wish.x = p.input.wish.y = p.input.wish.z = 0;
          p.input.buttons = 0;
          for (let i = 0; i < Math.round(dt * SIM_HZ); i++) this.motor.step(p.body, p.state, p.input, SIM_DT);
        }
      } else p.starvedFor = 0;
      this.drownTick(p, stepped * SIM_DT, wall);
      if (p.deploy === DeployState.DIVING && !p.state.diving) this.land(p);
    }
    this.maybeBeginFight();
    if (this.phase === MatchPhase.MATCH && this.tormenta.active) {
      // The phase clock (a new phase is published at once), then this tick's damage pulse, if one fell.
      const t = this.tormenta.update(wall);
      if (t.changed) this.roomStateDirty = true;
      if (t.damage > 0) this.tormentaPulse(t.damage, wall);
    }

    this.abilities.update(wall, dt);
    // Bells fall silent (and their winds stop) when their time is up.
    this.interactives.update(Date.now());
    const tc = performance.now();
    this.creeps.update(wall, dt);
    this.perf.creepMs = this.perf.creepMs * 0.9 + (performance.now() - tc) * 0.1;
    this.loot.update(wall);
    if (this.roomStateDirty) this.broadcastRoomState();

    for (const p of this.players.values()) {
      const st = p.statusIfChanged();
      if (st) p.client.send(S2C.SELF, st);
    }
    if (this.events.length) {
      const msg: EventsMsg = { t: wall, ev: this.events };
      this.broadcast(S2C.EVENTS, msg);
      this.events = [];
    }
    this.snapshotAcc += dt;
    if (this.snapshotAcc >= 1 / SNAPSHOT_HZ - 1e-4) {
      this.snapshotAcc = 0;
      this.broadcastSnapshot();
    }
    const cost = performance.now() - t0;
    this.tickCost = this.tickCost * 0.9 + cost * 0.1;
    this.perf.peakTickMs = Math.max(this.perf.peakTickMs, cost);
    this.perf.ticks++;
  }

  /** Out of breath with the head under water: drowning takes Health every MOVEMENT.drownInterval s of simulated time. */
  private drownTick(p: ServerPlayer, dt: number, now: number): void {
    if (p.breath > 0 || !p.vitals.alive || !headUnderWater(p.state.pos)) {
      p.drownT = 0;
      return;
    }
    p.drownT += dt;
    while (p.drownT >= MOVEMENT.drownInterval && p.vitals.alive) {
      p.drownT -= MOVEMENT.drownInterval;
      if (this.canFight(p, now) && this.dealDamage(p, p, MOVEMENT.drownDamage, false, now, undefined, 'water')) {
        this.broadcastRoomState();
        this.checkMatchEnd();
      }
    }
  }

  private respawn(p: ServerPlayer): void {
    let killerPos: Vec3 | undefined;
    for (const q of this.players.values()) if (q !== p && q.vitals.alive) killerPos = v3normalize(q.state.pos);
    this.resetForSpawn(p, this.spawnState(p.index, killerPos));
  }

  /** Puts a player on a new spawn with full vitals and ammo; clients snap to it on the `respawn` event. */
  private resetForSpawn(p: ServerPlayer, state: ServerPlayer['state']): void {
    p.state = state;
    this.motor.placeCollider(p.body.collider, p.state.pos);
    p.vitals = newVitals();
    this.applyStats(p);
    p.breath = MOVEMENT.breathTime;
    p.drownT = 0;
    this.freshKit(p);
    p.respawnAt = 0;
    p.queue.length = 0;
    p.simTime = Date.now() - 60;
    this.resetAbilities(p, Date.now());
    this.events.push({ e: 'respawn', target: p.index });
    this.roomStateDirty = true;
  }

  private broadcastSnapshot(): void {
    const snaps: PlayerSnap[] = [];
    const now = Date.now();
    for (const p of this.players.values()) {
      const s = p.state;
      const r = Math.hypot(s.pos.x, s.pos.y, s.pos.z) || 1;
      const sinPitch = (s.aim.x * s.pos.x + s.aim.y * s.pos.y + s.aim.z * s.pos.z) / r;
      const action = !p.vitals.alive
        ? ActionState.DEAD
        : now < p.castUntil
          ? p.castUltimate
            ? ActionState.ULTIMATE
            : ActionState.CAST
          : now < p.fireUntil
            ? ActionState.FIRE
            : p.reloading >= 0
              ? ActionState.RELOAD
              : ActionState.NONE;
      snaps.push([
        p.index,
        Math.round(s.pos.x * POS_SCALE),
        Math.round(s.pos.y * POS_SCALE),
        Math.round(s.pos.z * POS_SCALE),
        Math.round(s.vel.x * VEL_SCALE),
        Math.round(s.vel.y * VEL_SCALE),
        Math.round(s.vel.z * VEL_SCALE),
        Math.round(s.facing.x * FACING_SCALE),
        Math.round(s.facing.y * FACING_SCALE),
        Math.round(s.facing.z * FACING_SCALE),
        Math.round(Math.asin(Math.max(-1, Math.min(1, sinPitch))) * PITCH_SCALE),
        s.moveState,
        action,
        (s.grounded ? SnapFlag.GROUNDED : 0) |
          (p.vitals.alive ? SnapFlag.ALIVE : 0) |
          (s.aiming ? SnapFlag.AIMING : 0) |
          (p.deploy === DeployState.SHIP ? SnapFlag.ON_SHIP : 0) |
          (s.diving ? SnapFlag.DIVING : 0) |
          (s.airJumped ? SnapFlag.AIR_JUMPED : 0) |
          (p.inMatch && p.vitals.alive && this.tormenta.outside(s.pos) ? SnapFlag.IN_TORMENTA : 0),
        p.lastSeq < 0 ? 0 : p.lastSeq,
        p.vitals.health,
        p.vitals.shield,
        manaShown(p.vitals),
        p.unarmed ? FISTS_SLOT : p.weapon,
        Math.round(p.simTime - now),
        Math.round(s.stamina * STAMINA_SCALE),
        packTraversal(s),
        Math.round(s.ledgeR * POS_SCALE),
      ]);
    }
    const msg: SnapshotMsg = { t: now, k: this.tick, p: snaps };
    // Creeps at half the snapshot rate (they are slow and many).
    if (this.creeps.active && this.snapshotCount++ % 2 === 0) msg.c = this.creeps.snapshot();
    this.broadcast(S2C.SNAPSHOT, msg);
  }

  private broadcastRoomState(): void {
    this.roomStateDirty = false;
    const players: PlayerPublic[] = [...this.players.values()].map((p) => ({
      index: p.index,
      sessionId: p.client.sessionId,
      name: p.name,
      appearance: p.appearance,
      ready: p.ready,
      connected: p.connected,
      ...(p.dropped ? { dropped: true } : {}),
      inMatch: p.inMatch,
      kills: p.kills,
      deaths: p.deaths,
      alive: p.vitals.alive,
      damageDealt: Math.round(p.damageDealt),
      loadout: [...p.loadout],
      weapons: p.inv.slots.map((w) => w?.id ?? ''),
      deploy: p.deploy,
      wins: p.wins,
      back: p.back,
      level: p.prog.level,
      ...(p.bot ? { bot: true } : {}),
    }));
    const room = this.roomMetadata();
    const metadata = { ...room, phase: this.phase };
    const encoded = JSON.stringify(metadata);
    if (encoded !== this.lastMetadata) {
      this.lastMetadata = encoded;
      void this.setMetadata(metadata).catch((e: unknown) => log('room metadata failed', { code: this.roomId, error: String(e) }));
    }
    const msg: RoomStateMsg = { code: this.roomId, phase: this.phase, phaseEndsAt: this.phaseEndsAt, startsAt: this.startsAt, winner: this.winner, players, ufo: this.ufo, tormenta: this.tormenta.view, room, preparation: this.preparation };
    this.broadcast(S2C.ROOM_STATE, msg);
  }
}

/** a > b with 31-bit wraparound. */
const seqGreater = (a: number, b: number) => a !== b && ((a - b) & 0x7fffffff) < 0x40000000;
