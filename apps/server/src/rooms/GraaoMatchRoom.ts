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
 * Match flow: warmup (FREE_ROAM, respawns on) → everyone READY → MATCH (countdown, then weapons unlock, no respawns)
 * → last participant standing wins → RESULTS → warmup again. Rules live in `@graao/game-core` (match.ts).
 */
import { Room, ServerError, type Client } from '@colyseus/core';
import {
  CharacterMotor,
  MATCH_RULES,
  applyDamage,
  createCharacterState,
  decideMatch,
  decodeInput,
  everyoneReady,
  falloff,
  latLonToDir,
  muzzlePoint,
  newVitals,
  northTangent,
  resolvePellet,
  shotSeed,
  spreadDirections,
  type GameWorld,
  type PlayerHitTarget,
} from '@graao/game-core';
import { ARENA_CENTER, ATTRIBUTES, MATCH_SPAWNS, SPAWNS, WEAPONS, WEAPON_SLOTS, validateAppearance } from '@graao/game-data';
import {
  ActionState,
  C2S,
  CLIENT_VERSION,
  DIR_SCALE,
  FACING_SCALE,
  INPUT_JITTER_BUFFER,
  JoinError,
  MAX_INPUT_BACKLOG,
  MAX_MESSAGES_PER_SECOND,
  MAX_PLAYERS,
  MVP_PLAYERS,
  MatchPhase,
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
  validateAppearanceUpdate,
  validateFire,
  validateInputMsg,
  validatePing,
  validateReady,
  validateSwitch,
  type EventsMsg,
  type GameEvent,
  type JoinOptions,
  type PlayerPublic,
  type PlayerSnap,
  type RoomStateMsg,
  type SnapshotMsg,
  type Vec3,
  type WelcomeMsg,
} from '@graao/shared';
import { ServerPlayer } from '../sim/ServerPlayer';
import { getWorld } from '../world';
import { log } from '../log';

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
}

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
    this.world = await getWorld();
    this.motor = new CharacterMotor(this.world.physics);

    this.onMessage(C2S.PLAYER_INPUT, (c, m) => this.onInput(c, m));
    this.onMessage(C2S.APPEARANCE_UPDATE, (c, m) => this.onAppearance(c, m));
    this.onMessage(C2S.FIRE, (c, m) => this.onFire(c, m));
    this.onMessage(C2S.RELOAD, (c) => this.onReload(c));
    this.onMessage(C2S.SWITCH_WEAPON, (c, m) => this.onSwitch(c, m));
    this.onMessage(C2S.READY, (c, m) => this.onReady(c, m));
    this.onMessage(C2S.PING, (c, m) => {
      const v = validatePing(m);
      if (v) c.send(S2C.PONG, { c: v.c, t: Date.now(), tick: Math.round(this.tickCost * 100) / 100 });
    });
    this.onMessage('*', (c, type) => log('unknown message', { from: c.sessionId, type }));

    this.lastTickAt = performance.now();
    this.setSimulationInterval(() => this.update(), SERVER_TICK_MS);
    log('room created', { code: this.roomId, maxClients: this.maxClients });
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
    const p = new ServerPlayer(client, index, name, { ...options.appearance }, state, body);
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
    log('join', { code: this.roomId, id: client.sessionId, index, name, client: options.client });
  }

  override onLeave(client: Client): void {
    const p = this.players.get(client.sessionId);
    if (!p) return;
    p.body.dispose();
    this.players.delete(client.sessionId);
    this.broadcastRoomState();
    log('leave', { code: this.roomId, id: client.sessionId });
    // The opponent leaving can end a match (the one still standing wins); in warmup the rest may now all be ready.
    if (this.phase === MatchPhase.MATCH) this.checkMatchEnd();
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
    if (everyoneReady([...this.players.values()])) this.startMatch();
  }

  /** Everyone ready: fresh vitals and ammo, spread spawns, countdown before weapons unlock. */
  private startMatch(): void {
    const now = Date.now();
    this.phase = MatchPhase.MATCH;
    this.startsAt = now + this.countdownMs;
    this.phaseEndsAt = 0;
    this.winner = -1;
    let slot = 0;
    for (const p of [...this.players.values()].sort((a, b) => a.index - b.index)) {
      p.ready = false;
      p.inMatch = p.connected;
      p.kills = 0;
      p.deaths = 0;
      this.resetForSpawn(p, this.spawnState(slot++, undefined, !this.closeSpawns));
    }
    this.broadcastRoomState();
    log('match start', { code: this.roomId, players: this.players.size });
  }

  private checkMatchEnd(): void {
    if (this.phase !== MatchPhase.MATCH) return;
    const r = decideMatch([...this.players.values()].map((p) => ({ index: p.index, alive: p.vitals.alive, connected: p.connected, inMatch: p.inMatch })));
    if (!r.over) return;
    this.phase = MatchPhase.RESULTS;
    this.winner = r.winner;
    this.startsAt = 0;
    this.phaseEndsAt = Date.now() + this.resultsMs;
    this.broadcastRoomState();
    log('match end', { code: this.roomId, winner: this.byIndex(r.winner)?.name ?? '-' });
  }

  /** Results over: everyone back on their feet in warmup, ready flags cleared. */
  private returnToWarmup(): void {
    this.phase = MatchPhase.FREE_ROAM;
    this.phaseEndsAt = 0;
    this.startsAt = 0;
    this.winner = -1;
    for (const p of this.players.values()) {
      p.ready = false;
      p.inMatch = false;
      if (!p.vitals.alive) this.respawn(p);
      else {
        p.vitals = newVitals();
        p.ammo.forEach((_, i) => (p.ammo[i] = WEAPONS[WEAPON_SLOTS[i]!].magazine));
      }
    }
    this.broadcastRoomState();
  }

  /** May this player deal or take damage right now? */
  private canFight(p: ServerPlayer, now: number): boolean {
    if (this.phase === MatchPhase.RESULTS) return false;
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

    for (const [ti, dmg] of perTarget) {
      const q = this.byIndex(ti);
      if (!q || !q.vitals.alive || !this.canFight(q, now)) continue;
      const res = applyDamage(q.vitals, dmg.amount, dmg.crit);
      this.events.push({ e: 'dmg', by: p.index, target: ti, amount: res.shieldDamage + res.healthDamage, kinds: res.kinds, health: q.vitals.health, shield: q.vitals.shield });
      if (res.eliminated) {
        q.deaths++;
        p.kills++;
        // No respawns inside a match: the eliminated player watches until the results.
        q.respawnAt = this.phase === MatchPhase.MATCH ? Infinity : now + ATTRIBUTES.respawnDelay * 1000;
        q.reloading = -1;
        q.queue.length = 0;
        this.events.push({ e: 'elim', by: p.index, target: ti });
        log('elimination', { code: this.roomId, by: p.name, target: q.name });
        eliminated = true;
      }
    }
    if (p.ammo[f.w] === 0) this.startReload(p);
    if (eliminated) {
      this.broadcastRoomState(); // kill counts
      this.checkMatchEnd();
    }
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
      let stepped = 0;
      // Keep a small jitter buffer once the stream is flowing: steady consumption = smooth remote motion.
      const keep = p.queue.length > INPUT_JITTER_BUFFER + 6 ? 0 : INPUT_JITTER_BUFFER;
      while (p.queue.length > keep && p.budget >= 1) {
        const cmd = p.queue.shift()!;
        this.motor.step(p.body, p.state, decodeInput(cmd, p.input), SIM_DT);
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
    }

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
    p.ammo.forEach((_, i) => (p.ammo[i] = WEAPONS[WEAPON_SLOTS[i]!].magazine));
    p.reloading = -1;
    p.respawnAt = 0;
    p.queue.length = 0;
    p.simTime = Date.now() - 60;
    this.events.push({ e: 'respawn', target: p.index });
  }

  private broadcastSnapshot(): void {
    const snaps: PlayerSnap[] = [];
    const now = Date.now();
    for (const p of this.players.values()) {
      const s = p.state;
      const r = Math.hypot(s.pos.x, s.pos.y, s.pos.z) || 1;
      const sinPitch = (s.aim.x * s.pos.x + s.aim.y * s.pos.y + s.aim.z * s.pos.z) / r;
      const action = !p.vitals.alive ? ActionState.DEAD : now < p.fireUntil ? ActionState.FIRE : p.reloading >= 0 ? ActionState.RELOAD : ActionState.NONE;
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
        (s.grounded ? SnapFlag.GROUNDED : 0) | (p.vitals.alive ? SnapFlag.ALIVE : 0) | (s.aiming ? SnapFlag.AIMING : 0),
        p.lastSeq < 0 ? 0 : p.lastSeq,
        p.vitals.health,
        p.vitals.shield,
        p.vitals.mana,
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
    }));
    const msg: RoomStateMsg = { code: this.roomId, phase: this.phase, phaseEndsAt: this.phaseEndsAt, startsAt: this.startsAt, winner: this.winner, players };
    this.broadcast(S2C.ROOM_STATE, msg);
  }
}

/** a > b with 31-bit wraparound. */
const seqGreater = (a: number, b: number) => a !== b && ((a - b) & 0x7fffffff) < 0x40000000;
