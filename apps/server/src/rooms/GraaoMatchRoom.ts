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
 * Match flow: warmup (FREE_ROAM, respawns on) → everyone READY → ABILITY_DRAFT (4 simultaneous rounds, the drafted
 * loadouts replace the warmup ones) → UFO (the ship flies a route over the arena; each participant jumps when they
 * like inside the window, or is dropped when it closes, and skydives down under their own control) → everyone
 * landed → MATCH (countdown, then weapons unlock, no respawns) → last participant standing wins → RESULTS (the
 * MatchLedger's summary goes to everyone and, once, to Supabase) → back to the warmup lobby when everyone asks
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
  GRAAbilitySystem,
  MATCH_RULES,
  MatchLedger,
  applyAbilityDamage,
  applyDamage,
  applyDrowning,
  headUnderWater,
  stepBreath,
  currentSlow,
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
  latLonToDir,
  muzzlePoint,
  newVitals,
  northTangent,
  resolvePellet,
  shotSeed,
  spreadDirections,
  type AbilityActor,
  type AbilityHost,
  type GameWorld,
  type PlayerHitTarget,
} from '@graao/game-core';
import { ABILITY_RULES, ARENA_CENTER, ATTRIBUTES, MATCH_SPAWNS, MOVEMENT, PLANET, SPAWNS, UFO, ULTIMATE_SLOT, WEAPONS, WEAPON_SLOTS, validateAppearance, type AbilityId } from '@graao/game-data';
import {
  AbilityReject,
  ActionState,
  C2S,
  CLIENT_VERSION,
  DIR_SCALE,
  DeployState,
  DraftReject,
  FACING_SCALE,
  INPUT_JITTER_BUFFER,
  JoinError,
  MAX_INPUT_BACKLOG,
  MAX_MESSAGES_PER_SECOND,
  MAX_PLAYERS,
  MVP_PLAYERS,
  MatchPhase,
  NoticeCode,
  PITCH_SCALE,
  POS_SCALE,
  PROTOCOL_VERSION,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  ROOM_CODE_PREFIX,
  S2C,
  SERVER_TICK_HZ,
  SERVER_TICK_MS,
  SIM_DT,
  SIM_HZ,
  SNAPSHOT_HZ,
  SnapFlag,
  VEL_SCALE,
  sanitizeName,
  v3normalize,
  v3projectOnPlane,
  validateAbilityRequest,
  validateAppearanceUpdate,
  validateDraftPick,
  validateFire,
  validateInputMsg,
  validatePing,
  validateReady,
  validateReturnLobby,
  validateSwitch,
  validateUfoJump,
  type AbilityResultMsg,
  type EventsMsg,
  type GameEvent,
  type JoinOptions,
  type MatchSummaryMsg,
  type NoticeMsg,
  type PlayerPublic,
  type PlayerSnap,
  type RoomStateMsg,
  type SnapshotMsg,
  type UfoRouteMsg,
  type Vec3,
  type WelcomeMsg,
} from '@graao/shared';
import { authVerifier } from '../auth/SupabaseAuth';
import { serverConfig } from '../config';
import { matchStore } from '../persistence/MatchStore';
import { ServerPlayer } from '../sim/ServerPlayer';
import { getWorld } from '../world';
import { log } from '../log';

/** What `onAuth` hands to `onJoin` (as `client.auth`). */
interface PlayerAuth {
  profileId: string | null;
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
  maxPlayers?: number;
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

export class GraaoMatchRoom extends Room {
  override maxClients = MVP_PLAYERS;
  override maxMessagesPerSecond = MAX_MESSAGES_PER_SECOND;
  override patchRate = null;

  private world!: GameWorld;
  private motor!: CharacterMotor;
  private readonly players = new Map<string, ServerPlayer>();
  private phase: MatchPhase = MatchPhase.FREE_ROAM;
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
  /** The ship's route while the UFO phase runs. */
  private ufo: UfoRouteMsg | null = null;
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

  override async onCreate(options: RoomCreateOptions = {}): Promise<void> {
    this.roomId = newCode();
    activeCodes.add(this.roomId);
    this.maxClients = Math.max(1, Math.min(MAX_PLAYERS, Math.floor(options.maxPlayers ?? MVP_PLAYERS)));
    this.countdownMs = clampMs(options.countdownMs, MATCH_RULES.countdownMs);
    this.resultsMs = clampMs(options.resultsMs, MATCH_RULES.resultsMs);
    this.closeSpawns = options.closeSpawns === true;
    if (typeof options.ultimateChargeMs === 'number' && Number.isFinite(options.ultimateChargeMs)) this.ultimateChargeMs = Math.max(0, Math.min(60000, Math.round(options.ultimateChargeMs)));
    this.skipDraft = options.skipDraft === true;
    for (const [k, v] of [['pickMs', options.draftPickMs], ['repickMs', options.draftRepickMs], ['revealMs', options.draftRevealMs]] as const) {
      if (typeof v === 'number' && Number.isFinite(v)) this.draftTimings[k] = clampMs(v, 0);
    }
    this.skipUfo = options.skipUfo === true;
    if (typeof options.ufoRevealMs === 'number') this.ufoTimings.revealMs = clampMs(options.ufoRevealMs, UFO.revealMs);
    if (typeof options.ufoWindowMs === 'number') this.ufoTimings.windowMs = Math.max(1, clampMs(options.ufoWindowMs, UFO.windowMs));
    this.landTimeoutMs = clampMs(options.ufoLandTimeoutMs, UFO.landTimeoutMs);
    this.world = await getWorld();
    this.motor = new CharacterMotor(this.world.physics);
    this.abilities = new GRAAbilitySystem(this.abilityHost());

    this.onMessage(C2S.PLAYER_INPUT, (c, m) => this.onInput(c, m));
    this.onMessage(C2S.APPEARANCE_UPDATE, (c, m) => this.onAppearance(c, m));
    this.onMessage(C2S.FIRE, (c, m) => this.onFire(c, m));
    this.onMessage(C2S.RELOAD, (c) => this.onReload(c));
    this.onMessage(C2S.SWITCH_WEAPON, (c, m) => this.onSwitch(c, m));
    this.onMessage(C2S.READY, (c, m) => this.onReady(c, m));
    this.onMessage(C2S.ABILITY_REQUEST, (c, m) => this.onAbility(c, m));
    this.onMessage(C2S.DRAFT_PICK, (c, m) => this.onDraftPick(c, m));
    this.onMessage(C2S.UFO_JUMP, (c, m) => this.onUfoJump(c, m));
    this.onMessage(C2S.RETURN_LOBBY, (c, m) => this.onReturnLobby(c, m));
    this.onMessage(C2S.PING, (c, m) => {
      const v = validatePing(m);
      if (v) c.send(S2C.PONG, { c: v.c, t: Date.now(), tick: Math.round(this.tickCost * 100) / 100 });
    });
    this.onMessage('*', (c, type) => log('unknown message', { from: c.sessionId, type }));

    this.lastTickAt = performance.now();
    this.setSimulationInterval(() => this.update(), SERVER_TICK_MS);
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
    if (!user && serverConfig().requireAuth) throw new ServerError(4004, `${JoinError.AUTH_FAILED}: sign in to play on this server`);
    if (token && verifier && !user) log('auth: token refused, joining as guest', { code: this.roomId });
    return { profileId: user?.id ?? null };
  }

  override onJoin(client: Client, options?: JoinOptions): void {
    if (!options || options.protocol !== PROTOCOL_VERSION) {
      throw new ServerError(4001, `${JoinError.VERSION_MISMATCH}: server speaks protocol ${PROTOCOL_VERSION}`);
    }
    if (!validateAppearance(options.appearance)) throw new ServerError(4003, `${JoinError.BAD_APPEARANCE}: unknown appearance ids`);
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
    const welcome: WelcomeMsg & { spawn: [number, number, number] } = {
      you: client.sessionId,
      index,
      code: this.roomId,
      serverTime: Date.now(),
      protocol: PROTOCOL_VERSION,
      server: CLIENT_VERSION,
      tickHz: SERVER_TICK_HZ,
      snapshotHz: SNAPSHOT_HZ,
      spawn: [state.pos.x, state.pos.y, state.pos.z],
    };
    client.send(S2C.WELCOME, welcome);
    client.send(S2C.SELF, p.statusIfChanged());
    this.broadcastRoomState();
    // Joining mid-draft: watch it (not a seat; plays from the next match).
    if (this.draft) client.send(S2C.DRAFT_STATE, this.draft.view(index));
    log('join', { code: this.roomId, id: client.sessionId, index, name, client: options.client, signedIn: !!p.profileId });
  }

  override onLeave(client: Client): void {
    const p = this.players.get(client.sessionId);
    if (!p) return;
    p.body.dispose();
    this.players.delete(client.sessionId);
    this.abilities.cancelFor(p.index);
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
    else if (this.phase === MatchPhase.RESULTS) this.maybeEndResults();
    else this.maybeStartMatch();
  }

  override onDispose(): void {
    for (const p of this.players.values()) p.body.dispose();
    activeCodes.delete(this.roomId);
    log('room disposed', { code: this.roomId });
  }

  private spawnState(index: number, avoid?: Vec3, match = false) {
    if (match) {
      // Match start: spread around the arena, facing its centre.
      const sp = MATCH_SPAWNS[index % MATCH_SPAWNS.length]!;
      const dir = latLonToDir(sp.lat, sp.lon);
      const ground = this.world.terrain.surfaceAt(dir);
      const c = latLonToDir(ARENA_CENTER.lat, ARENA_CENTER.lon);
      const toC = v3normalize(v3projectOnPlane({ x: c.x - dir.x, y: c.y - dir.y, z: c.z - dir.z }, dir));
      return createCharacterState({ x: ground.x + dir.x * 0.1, y: ground.y + dir.y * 0.1, z: ground.z + dir.z * 0.1 }, toC);
    }
    let spawn = SPAWNS[index % SPAWNS.length]!;
    if (avoid) {
      // Respawn at the spawn point farthest from the eliminator.
      let best = -Infinity;
      for (const s of SPAWNS) {
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
    if (!p || !v || !validateAppearance(v.appearance)) return;
    p.appearance = v.appearance;
    this.broadcastRoomState();
  }

  private onReady(c: Client, m: unknown): void {
    const p = this.players.get(c.sessionId);
    const v = validateReady(m);
    if (!p || !v || this.phase !== MatchPhase.FREE_ROAM) return;
    const ready = v.r === 1;
    if (p.ready === ready) return;
    p.ready = ready;
    this.broadcastRoomState();
    this.maybeStartMatch();
  }

  // ------------------------------------------------------------------------------------------------ match flow

  private maybeStartMatch(): void {
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
    if (this.skipUfo) this.startMatch(true);
    else this.startDeploy(true);
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
      p.deploy = p.inMatch ? DeployState.SHIP : DeployState.NONE;
      if (!p.inMatch) continue;
      p.state = createCharacterState(ufoPosition(route, now), ufoHeading(route, now));
      this.refresh(p, now);
    }
    this.beginLedger(now);
    this.broadcastRoomState();
    log('ufo deploy', { code: this.roomId, riders: [...this.players.values()].filter((p) => p.inMatch).map((p) => p.name), opensIn: route.open - now, closesIn: route.close - now });
  }

  /** Full vitals, ammo and abilities, nothing pending (boarding, fight start). */
  private refresh(p: ServerPlayer, now: number): void {
    p.vitals = newVitals();
    p.ammo.forEach((_, i) => (p.ammo[i] = WEAPONS[WEAPON_SLOTS[i]!].magazine));
    p.reloading = -1;
    p.respawnAt = 0;
    p.queue.length = 0;
    this.resetAbilities(p, now);
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
    this.broadcastRoomState();
    log('match start', { code: this.roomId, players: this.players.size, after: 'ufo' });
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
      if (p.inMatch) this.resetForSpawn(p, this.spawnState(slot++, undefined, !this.closeSpawns));
    }
    this.beginLedger(now);
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
    this.phaseEndsAt = now + this.resultsMs;
    const w = this.byIndex(r.winner);
    if (w) w.wins++;
    for (const p of this.players.values()) p.back = false;
    // The summary first, so every client has it when the phase turns to RESULTS.
    const summary = this.ledger?.finish(this.roomId, r.winner, now) ?? null;
    this.ledger = null;
    if (summary) this.broadcast(S2C.MATCH_SUMMARY, summary);
    this.broadcastRoomState();
    log('match end', { code: this.roomId, winner: w?.name ?? '-', durationS: summary ? Math.round(summary.durationMs / 1000) : 0 });
    if (summary) void this.persist(summary, this.roster);
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
    this.phase = MatchPhase.FREE_ROAM;
    this.phaseEndsAt = 0;
    this.startsAt = 0;
    this.winner = -1;
    this.ufo = null;
    this.ledger = null;
    for (const p of this.players.values()) {
      p.ready = false;
      p.back = false;
      p.inMatch = false;
      // Still aboard or in the air (the match ended during the deployment): back on a spawn.
      const airborne = p.deploy === DeployState.SHIP || p.deploy === DeployState.DIVING;
      p.deploy = DeployState.NONE;
      if (!p.vitals.alive || airborne) this.respawn(p);
      else {
        p.vitals = newVitals();
        p.ammo.forEach((_, i) => (p.ammo[i] = WEAPONS[WEAPON_SLOTS[i]!].magazine));
        this.resetAbilities(p, Date.now());
      }
    }
    this.broadcastRoomState();
  }

  /** May this player deal or take damage right now? */
  private canFight(p: ServerPlayer, now: number): boolean {
    if (this.phase === MatchPhase.RESULTS || this.phase === MatchPhase.ABILITY_DRAFT || this.phase === MatchPhase.UFO) return false;
    if (this.phase === MatchPhase.MATCH) return p.inMatch && now >= this.startsAt;
    return true;
  }

  private onSwitch(c: Client, m: unknown): void {
    const p = this.players.get(c.sessionId);
    const v = validateSwitch(m);
    if (!p || !v || !p.vitals.alive || v.w === p.weapon) return;
    p.weapon = v.w;
    p.reloading = -1;
    const w = WEAPONS[WEAPON_SLOTS[v.w]!];
    const now = Date.now();
    // Equip delay: treat the switch as a recent shot.
    p.lastShotAt[v.w] = Math.max(p.lastShotAt[v.w]!, now - (1000 / w.fireRate) * FIRE_RATE_TOLERANCE + SWITCH_DELAY_MS);
  }

  private onReload(c: Client): void {
    const p = this.players.get(c.sessionId);
    if (p && p.vitals.alive) this.startReload(p);
  }

  private startReload(p: ServerPlayer): void {
    const w = WEAPONS[WEAPON_SLOTS[p.weapon]!];
    if (p.reloading >= 0 || p.ammo[p.weapon]! >= w.magazine) return;
    p.reloading = p.weapon;
    p.reloadEndsAt = Date.now() + w.reloadTime * 1000;
    this.events.push({ e: 'reload', by: p.index, w: p.weapon });
  }

  private onFire(c: Client, m: unknown): void {
    const p = this.players.get(c.sessionId);
    const f = validateFire(m);
    if (!p || !f) return;
    if (p.lastFireSeen < 0 || seqGreater(f.s, p.lastFireSeen)) p.lastFireSeen = f.s;
    if (!p.vitals.alive) return;
    if (f.w !== p.weapon || p.reloading >= 0) return;
    if (!this.canFight(p, Date.now())) return;
    // Hands are busy while swimming and while an ability winds up.
    if (p.state.swimming) return;
    if (Date.now() < p.castUntil) return;
    if (p.lastShotSeq >= 0 && !seqGreater(f.s, p.lastShotSeq)) return;
    const w = WEAPONS[WEAPON_SLOTS[f.w]!];
    const now = Date.now();
    if (now - p.lastShotAt[f.w]! < (1000 / w.fireRate) * FIRE_RATE_TOLERANCE) return;
    if (p.ammo[f.w]! <= 0) {
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
    p.ammo[f.w]! -= 1;
    p.fireUntil = now + 160;
    // The shooter faces the aim when firing (the controller turns toward it too).
    const flat = v3projectOnPlane(dir, up);
    const facing = Math.hypot(flat.x, flat.y, flat.z) > 1e-3 ? v3normalize(flat) : s.facing;
    const muzzle = muzzlePoint(s.pos, facing);

    const targets: PlayerHitTarget[] = [...this.players.values()].map((q) => ({ index: q.index, feet: q.state.pos, alive: q.vitals.alive }));
    const dirs = spreadDirections(dir, f.a ? w.spreadAim : w.spreadHip, w.pellets, shotSeed(p.index, f.s));
    const perTarget = new Map<number, { amount: number; crit: boolean }>();
    let eliminated = false;
    const to: [number, number, number][] = [];
    const hitT: number[] = [];
    for (const d of dirs) {
      const r = resolvePellet(this.world.physics, origin, d, muzzle, w.range, targets, p.index);
      to.push(mm(r.point));
      hitT.push(r.target);
      if (r.target >= 0) {
        const acc = perTarget.get(r.target) ?? { amount: 0, crit: false };
        acc.amount += w.damage * (r.head ? w.critMultiplier : 1) * falloff(w, r.distance);
        acc.crit ||= r.head;
        perTarget.set(r.target, acc);
      }
    }
    this.events.push({ e: 'shot', by: p.index, w: f.w, s: f.s, from: mm(muzzle), to, t: hitT });
    this.ledger?.shot(p.index, perTarget.size > 0);

    for (const [ti, dmg] of perTarget) {
      const q = this.byIndex(ti);
      if (q && this.dealDamage(p, q, dmg.amount, dmg.crit, now)) eliminated = true;
    }
    if (p.ammo[f.w] === 0) this.startReload(p);
    if (eliminated) {
      this.broadcastRoomState(); // kill counts
      this.checkMatchEnd();
    }
  }

  /**
   * Shield-then-Health damage from a weapon or an ability (tagged ABILITY), or Health-only drowning (by = the
   * drowning player), with the dmg event and, on elimination, kill/death bookkeeping. Returns true when the target was eliminated (the caller then checks the match end).
   */
  private dealDamage(by: ServerPlayer, q: ServerPlayer, amount: number, crit: boolean, now: number, ability?: AbilityId, drowning = false): boolean {
    if (!q.vitals.alive || !this.canFight(q, now)) return false;
    const res = drowning ? applyDrowning(q.vitals, amount) : ability ? applyAbilityDamage(q.vitals, amount) : applyDamage(q.vitals, amount, crit);
    if (!res.kinds.length) return false;
    this.events.push({ e: 'dmg', by: by.index, target: q.index, amount: res.shieldDamage + res.healthDamage, kinds: res.kinds, health: q.vitals.health, shield: q.vitals.shield, ...(ability ? { a: ability } : {}) });
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
    this.events.push({ e: 'elim', by: by.index, target: q.index });
    log('elimination', { code: this.roomId, by: by.name, target: q.name, ability: ability ?? '-' });
    return true;
  }

  // ------------------------------------------------------------------------------------------------ abilities

  private abilityHost(): AbilityHost {
    return {
      physics: this.world.physics,
      actors: () => this.players.values(),
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
    };
  }

  private onAbility(c: Client, m: unknown): void {
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
    // No casting while swimming (the hands are stroking); the client locks its slots in the water too.
    if (p.state.swimming) return reply(AbilityReject.BUSY);
    const r = this.abilities.request(p,{ slot: v.k, id: v.a, seq: v.s, cmdSeq: v.c, dir, point }, now);
    if (r === AbilityReject.OK) {
      p.castUltimate = v.k === ULTIMATE_SLOT;
      this.ledger?.cast(p.index);
    }
    reply(r);
  }

  /** Fresh life: basics ready, Ultimate charging, no wind-up, slow or pending dash. */
  private resetAbilities(p: ServerPlayer, now: number): void {
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

  private update(): void {
    const t0 = performance.now();
    const dt = Math.min(0.25, (t0 - this.lastTickAt) / 1000);
    this.lastTickAt = t0;
    this.tick++;
    const wall = Date.now();
    if (this.phase === MatchPhase.RESULTS && wall >= this.phaseEndsAt) this.returnToWarmup();
    if (this.phase === MatchPhase.ABILITY_DRAFT && this.draft?.update(wall)) {
      this.sendDraftStates();
      this.checkDraftDone();
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
        p.ammo[p.reloading] = WEAPONS[WEAPON_SLOTS[p.reloading]!].magazine;
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
      p.state.slow = currentSlow(p, wall);
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

    this.abilities.update(wall, dt);

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
      if (this.canFight(p, now) && this.dealDamage(p, p, MOVEMENT.drownDamage, false, now, undefined, true)) {
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
    p.breath = MOVEMENT.breathTime;
    p.drownT = 0;
    p.ammo.forEach((_, i) => (p.ammo[i] = WEAPONS[WEAPON_SLOTS[i]!].magazine));
    p.reloading = -1;
    p.respawnAt = 0;
    p.queue.length = 0;
    p.simTime = Date.now() - 60;
    this.resetAbilities(p, Date.now());
    this.events.push({ e: 'respawn', target: p.index });
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
          (s.airJumped ? SnapFlag.AIR_JUMPED : 0),
        p.lastSeq < 0 ? 0 : p.lastSeq,
        p.vitals.health,
        p.vitals.shield,
        manaShown(p.vitals),
        p.weapon,
        Math.round(p.simTime - now),
      ]);
    }
    const msg: SnapshotMsg = { t: now, k: this.tick, p: snaps };
    this.broadcast(S2C.SNAPSHOT, msg);
  }

  private broadcastRoomState(): void {
    const players: PlayerPublic[] = [...this.players.values()].map((p) => ({
      index: p.index,
      sessionId: p.client.sessionId,
      name: p.name,
      appearance: p.appearance,
      ready: p.ready,
      connected: p.connected,
      inMatch: p.inMatch,
      kills: p.kills,
      deaths: p.deaths,
      loadout: [...p.loadout],
      deploy: p.deploy,
      wins: p.wins,
      back: p.back,
    }));
    const msg: RoomStateMsg = { code: this.roomId, phase: this.phase, phaseEndsAt: this.phaseEndsAt, startsAt: this.startsAt, winner: this.winner, players, ufo: this.ufo };
    this.broadcast(S2C.ROOM_STATE, msg);
  }
}

/** a > b with 31-bit wraparound. */
const seqGreater = (a: number, b: number) => a !== b && ((a - b) & 0x7fffffff) < 0x40000000;
