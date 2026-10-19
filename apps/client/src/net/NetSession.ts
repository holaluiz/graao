/**
 * Online session: create/join by room code, server clock sync, input batching, authoritative reconciliation of the
 * local player and interpolated remote players. Measures ping, bytes/s and snapshot size.
 *
 * Who runs the room: by default the player who creates it (the match room runs in their browser, `RoomHost`; guests
 * connect to it by WebRTC, `PeerLink`). `?server=` (or a build with `VITE_SERVER_URL`) uses a dedicated Colyseus server.
 */
import * as THREE from 'three';
import { Client } from '@colyseus/sdk';
import { createCharacterState, traversalOfMoveState, unpackTraversal, type CharacterState, type PlayerHitTarget } from '@graao/game-core';
import { MAP_HASH } from '@graao/game-data';
import {
  type ActionState,
  MovementState,
  C2S,
  CLIENT_VERSION,
  FACING_SCALE,
  INTERPOLATION_DELAY_MS,
  JoinError,
  NoticeCode,
  PITCH_SCALE,
  POS_SCALE,
  STAMINA_SCALE,
  PROTOCOL_VERSION,
  ROOM_NAME,
  S2C,
  SnapFlag,
  VEL_SCALE,
  type AbilityRequestMsg,
  type AbilityResultMsg,
  type AbilityStateMsg,
  type AbilityRevealMsg,
  type CharacterAppearance,
  type DevLootMsg,
  type InteractMsg,
  type MeleeMsg,
  type ProgressMsg,
  type LootDevMsg,
  type LootResultMsg,
  type LootStateMsg,
  type UseItemMsg,
  type DraftStateMsg,
  type EventsMsg,
  type FireMsg,
  type InputMsg,
  type JoinOptions,
  type MatchSummaryMsg,
  type NoticeMsg,
  type PongMsg,
  type RoomStateMsg,
  type SelfStatusMsg,
  type SnapshotMsg,
  type WelcomeMsg,
  type WorldStateMsg,
  type WorldUseMsg,
} from '@graao/shared';
import type { GraaoApp } from '../app/GraaoApp';
import { RemotePlayer } from './RemotePlayer';
import { AbilityStateCache } from './AbilityStateCache';
import { LinkClose, type RoomLink } from './RoomLink';
import { PeerLink } from './host/PeerLink';
import { RoomHost } from './host/RoomHost';
import { dedicatedServer, serverTarget } from './serverTarget';
import { signalingConfigured } from './host/signaling';

export interface RoomConnectOptions {
  roomName?: string;
  visibility?: 'public' | 'private';
  forceDedicated?: boolean;
  hosted?: boolean;
  fallbackHosted?: boolean;
  /** A room on a player's Graao Host app: its public endpoint (wss://…) and, for its owner, the owner key. */
  endpoint?: string;
  hostKey?: string;
}

function friendlyError(e: unknown, hosted = false): Error {
  const msg = (e as Error)?.message ?? String(e);
  if (msg.includes(JoinError.MAP_MISMATCH)) {
    return new Error(hosted ? 'Quem criou a sala está com outra versão do mapa do graao. Atualizem o graao (e o Graao Host) e tentem de novo.' : 'Este servidor roda outra versão do mapa do graao. Recarregue a página.');
  }
  if (msg.includes(JoinError.VERSION_MISMATCH)) {
    return new Error(hosted ? 'Quem criou a sala está com outra versão do graao. Recarreguem a página.' : 'Este servidor roda outra versão do graao. Recarregue a página.');
  }
  if (/not found|invalid room|roomId/i.test(msg)) return new Error('Nenhuma sala com esse código.');
  if (/full|locked/i.test(msg)) return new Error('Essa sala está cheia.');
  if (msg.includes(JoinError.IN_PROGRESS)) return new Error('O Draft ou a partida desta sala já começou. Aguarde o retorno ao lobby.');
  if (/room is gone/i.test(msg)) return new Error('Essa sala foi fechada.');
  if (hosted) return new Error(msg);
  if (/ECONNREFUSED|Failed to fetch|NetworkError|offline|ERR_CONNECTION|ECONNRESET|timeout/i.test(msg)) {
    return new Error(
      import.meta.env.DEV
        ? 'Não foi possível falar com o servidor do graao. Ele está rodando? (pnpm dev)'
        : 'O servidor de partidas não respondeu. Tente de novo em instantes; Explorar sozinho funciona sem ele.',
    );
  }
  return new Error(msg);
}

export class NetSession {
  code = '';
  myIndex = -1;
  /** Set for Graao Host rooms: the host's public endpoint. */
  graaoHostEndpoint = '';
  private readonly remotes = new Map<number, RemotePlayer>();
  private readonly labels = document.createElement('div');
  private clockOffset = 0;
  private clockSynced = false;
  private rtt_ = 0;
  private pingTimer = 0;
  private sendTimer = 0;
  private bytesIn = 0;
  private bytesOut = 0;
  private rateIn = 0;
  private rateOut = 0;
  private rateSince = performance.now();
  private lastSnapshotBytes = 0;
  private snapshots = 0;
  private serverTick = 0;
  private lastServerTickMs = 0;
  private left = false;
  /** Socket drops in this session (each one the SDK tried to recover), for the F3 overlay. */
  private drops = 0;
  private closeReason = '';
  private active = false;
  private presentation = false;
  private latestRoom: RoomStateMsg | null = null;
  private latestSelf: SelfStatusMsg | null = null;
  private latestDraft: DraftStateMsg | null = null;
  private latestLoot: LootStateMsg | null = null;
  private readonly abilityCache = new AbilityStateCache();
  private latestWorld: WorldStateMsg | null = null;

  private constructor(
    private readonly app: GraaoApp,
    private readonly room: RoomLink,
    readonly solo = false,
    /** Set when this player runs the room (created it in host mode). */
    private readonly host: RoomHost | null = null,
  ) {
    this.labels.className = 'nameplates';
    this.labels.hidden = true;
    document.getElementById('ui')!.appendChild(this.labels);
    // The hosted room failing on its own (not this player leaving) ends the session like a lost connection.
    if (host) host.onClosed = () => !this.left && app.onDisconnected(this.closeReason || 'A sala foi fechada.');
  }

  /** This player hosts an online room: everyone plays on this tab. */
  get hosting(): boolean {
    return !!this.host?.online;
  }

  get remoteCount(): number {
    return this.remotes.size;
  }

  /** Smoothed round-trip time (ms). */
  /** The last private status the server sent (what is in each weapon slot, fists, progression...). */
  get lastSelf(): SelfStatusMsg | null {
    return this.latestSelf;
  }

  get rtt(): number {
    return this.rtt_;
  }

  /** Every remote player (presentation directors iterate them). */
  get remotePlayers(): IterableIterator<RemotePlayer> {
    return this.remotes.values();
  }

  remote(index: number): RemotePlayer | undefined {
    return this.remotes.get(index);
  }

  /** Remote players as hitscan targets at their rendered positions (cosmetic prediction only). */
  hitTargets(): PlayerHitTarget[] {
    return [...this.remotes.values()].map((r) => ({ index: r.index, feet: { x: r.pos.x, y: r.pos.y, z: r.pos.z }, alive: r.alive }));
  }

  static async connect(app: GraaoApp, kind: 'create' | 'join' | 'solo', code: string, name: string, bots = 0, settings: RoomConnectOptions = {}): Promise<NetSession> {
    const roomOptions = kind === 'solo' ? { soloBots: bots, roomName: `Treino de ${name}`, visibility: 'private' as const } : kind === 'create' ? { bots, roomName: settings.roomName, visibility: settings.visibility ?? 'public' as const } : {};
    let room: RoomLink | undefined;
    let host: RoomHost | null = null;
    let useDedicated = !settings.endpoint && !settings.hosted && (settings.forceDedicated || dedicatedServer());
    if (settings.endpoint) {
      // A Graao Host room runs on another player's PC: no identity token goes there, only a name (and the owner key).
      const options: JoinOptions = { protocol: PROTOCOL_VERSION, client: CLIENT_VERSION, map: MAP_HASH, name, appearance: app.appearance, ...(settings.hostKey ? { hostKey: settings.hostKey } : {}) };
      try {
        room = await new Client(settings.endpoint).joinById(code.toUpperCase(), options);
      } catch (e) {
        const msg = (e as Error)?.message ?? String(e);
        throw /fetch|network|ECONN|timeout|failed/i.test(msg) && !/full|locked|VERSION|MAP_MISMATCH|IN_PROGRESS/i.test(msg)
          ? new Error('Não foi possível conectar ao PC que hospeda essa sala. A hospedagem pode ter sido encerrada.')
          : friendlyError(e, true);
      }
    }
    if (useDedicated) {
      const target = serverTarget();
      const client = new Client(target.url);
      // A signed-in player proves who they are with the Supabase access token (the server verifies it); else a guest.
      // Only the build's own server ever receives it (a ?server= link plays as a guest).
      const token = target.official ? await app.profile.accessToken() : null;
      const options: JoinOptions = { protocol: PROTOCOL_VERSION, client: CLIENT_VERSION, map: MAP_HASH, name, appearance: app.appearance, ...(token ? { token } : {}), ...roomOptions };
      try {
        room = kind === 'join' ? await client.joinById(code.toUpperCase(), options) : await client.create(ROOM_NAME, options);
      } catch (e) {
        const message = (e as Error).message || String(e);
        if (kind === 'join' && settings.fallbackHosted && signalingConfigured() && !/VERSION_MISMATCH|MAP_MISMATCH|ROOM_FULL|IN_PROGRESS|AUTH_FAILED|BAD_APPEARANCE|full|locked/i.test(message)) useDedicated = false;
        else throw friendlyError(e);
      }
    }
    if (!useDedicated && !settings.endpoint) {
      // Hosted by a player: no identity token leaves this browser (the host is just another player).
      const options: JoinOptions = { protocol: PROTOCOL_VERSION, client: CLIENT_VERSION, map: MAP_HASH, name, appearance: app.appearance, ...roomOptions };
      try {
        if (kind === 'join') room = await PeerLink.connect(code.toUpperCase(), options);
        else {
          // Solo practice runs here too, offline: only an online room publishes its code.
          host = await RoomHost.create({ ...options }, kind === 'create');
          room = await host.connectLocal(options);
        }
      } catch (e) {
        host?.close();
        throw friendlyError(e, true);
      }
    }
    if (!room) throw new Error('Não foi possível abrir a conexão com a sala.');
    const s = new NetSession(app, room, kind === 'solo', host);
    s.graaoHostEndpoint = settings.endpoint ?? '';
    try {
      await s.init();
    } catch (e) {
      s.leave();
      throw e;
    }
    return s;
  }

  private init(): Promise<void> {
    const room = this.room;
    this.tapSocket();
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('O servidor não respondeu.')), 8000);
      room.onMessage(S2C.WELCOME, (m: WelcomeMsg & { spawn: [number, number, number] }) => {
        clearTimeout(timeout);
        // The server checks the map on join; this covers the other direction (a newer server, an older page).
        if (m.map && m.map !== MAP_HASH) {
          reject(new Error('Esta sala roda outra versão do mapa do graao. Recarregue a página.'));
          return;
        }
        this.code = m.code;
        this.myIndex = m.index;
        this.clockOffset = m.serverTime - Date.now();
        const [x, y, z] = m.spawn;
        const up = new THREE.Vector3(x, y, z).normalize();
        const facing = new THREE.Vector3(0, 1, 0).addScaledVector(up, -up.y).normalize();
        this.app.local.teleport({ x, y, z }, { x: facing.x, y: facing.y, z: facing.z });
        this.app.camera.reset(new THREE.Vector3(x, y, z), facing);
        resolve();
      });
      room.onMessage(S2C.ROOM_STATE, (m: RoomStateMsg) => this.onRoomState(m));
      room.onMessage(S2C.SNAPSHOT, (m: SnapshotMsg) => this.onSnapshot(m));
      room.onMessage(S2C.PONG, (m: PongMsg) => this.onPong(m));
      room.onMessage(S2C.EVENTS, (m: EventsMsg) => {
        this.abilityCache.onEvents(m.ev);
        if (!this.active) return;
        this.app.interactives.onEvents(m.ev);
        this.app.combat.onEvents(m.ev);
      });
      room.onMessage(S2C.WORLD_STATE, (m: WorldStateMsg) => {
        this.latestWorld = m;
        if (this.active) this.app.interactives.onState(m);
      });
      room.onMessage(S2C.SELF, (m: SelfStatusMsg) => {
        this.latestSelf = m;
        if (this.active) this.app.combat.onSelf(m);
      });
      room.onMessage(S2C.ABILITY_RESULT, (m: AbilityResultMsg) => this.app.combat.abilities.onResult(m));
      room.onMessage(S2C.ABILITY_STATE, (m: AbilityStateMsg) => {
        this.abilityCache.setState(m);
        if (this.active) this.app.combat.abilities.setAbilityState(m);
      });
      room.onMessage(S2C.ABILITY_REVEAL, (m: AbilityRevealMsg) => {
        this.abilityCache.onReveal(m);
        if (this.active) this.app.combat.abilities.onReveal(m);
      });
      room.onMessage(S2C.PROGRESS, (m: ProgressMsg) => {
        if (this.active) this.app.progression.onProgress(m);
      });
      room.onMessage(S2C.DRAFT_STATE, (m: DraftStateMsg) => {
        this.latestDraft = m;
        if (this.active) this.app.onDraftState(m);
      });
      room.onMessage(S2C.MATCH_SUMMARY, (m: MatchSummaryMsg) => this.app.combat.onSummary(m));
      room.onMessage(S2C.LOOT_STATE, (m: LootStateMsg) => {
        this.latestLoot = m;
        if (this.active) this.app.loot.onState(m);
      });
      room.onMessage(S2C.LOOT_RESULT, (m: LootResultMsg) => this.app.loot.onResult(m));
      room.onMessage(S2C.LOOT_DEV, (m: LootDevMsg) => this.app.loot.onDev(m));
      room.onMessage(S2C.NOTICE, (m: NoticeMsg) => {
        if (m.code === NoticeCode.HOST_LEFT || m.code === NoticeCode.ROOM_CLOSED) this.closeReason = m.text;
        this.app.combat.onNotice(m);
        this.app.onRoomNotice(m);
      });
      // A dropped socket is not the end: the SDK reconnects on its own and the server keeps the seat for a while.
      room.onDrop(() => {
        this.drops++;
        if (!this.left) this.app.onConnectionDrop(true);
      });
      room.onReconnect(() => {
        if (!this.left) this.app.onConnectionDrop(false);
      });
      room.onLeave((codeNum: number) => {
        if (!this.left) {
          console.warn('[graao] disconnected', codeNum);
          this.app.onDisconnected(
            this.closeReason || (codeNum === LinkClose.HOST_CLOSED
              ? 'Quem criou a sala saiu: a sala fechou.'
              : codeNum === LinkClose.REFUSED
                ? 'A sala não guardou sua vaga a tempo.'
                : 'A conexão com a sala caiu.'),
          );
        }
      });
    });
  }

  /** Counts raw WebSocket bytes for the F3 overlay (best effort: transport internals are not public API). */
  private tapped = false;
  private tapSocket(): void {
    if (this.tapped) return;
    if (this.room.meter) {
      this.tapped = true;
      this.room.meter(
        (n) => {
          this.bytesIn += n;
          if (this.lastSnapshotBytes === 0 || n <= this.lastSnapshotBytes * 3) this.lastSnapshotBytes = n;
        },
        (n) => (this.bytesOut += n),
      );
      return;
    }
    const conn = (this.room as unknown as { connection?: { transport?: { ws?: WebSocket } } }).connection;
    const ws = conn?.transport?.ws;
    if (!ws) return;
    this.tapped = true;
    ws.addEventListener('message', (e: MessageEvent) => {
      const n = e.data instanceof ArrayBuffer ? e.data.byteLength : typeof e.data === 'string' ? e.data.length : (e.data as Blob).size ?? 0;
      this.bytesIn += n;
      // Track the typical (snapshot) frame size; ignore the occasional large room-state frame.
      if (this.lastSnapshotBytes === 0 || n <= this.lastSnapshotBytes * 3) this.lastSnapshotBytes = n;
    });
    const send = ws.send.bind(ws);
    ws.send = (data: Parameters<WebSocket['send']>[0]) => {
      this.bytesOut += typeof data === 'string' ? data.length : data instanceof Blob ? data.size : data.byteLength;
      send(data);
    };
  }

  serverNow(): number {
    return Date.now() + this.clockOffset;
  }

  private onPong(m: PongMsg): void {
    const now = Date.now();
    const rtt = now - m.c;
    this.rtt_ = this.rtt_ ? this.rtt_ * 0.8 + rtt * 0.2 : rtt;
    const offset = m.t + rtt / 2 - now;
    this.clockOffset = this.clockSynced ? this.clockOffset * 0.9 + offset * 0.1 : offset;
    this.clockSynced = true;
    this.lastServerTickMs = m.tick;
  }

  private onRoomState(m: RoomStateMsg): void {
    this.latestRoom = m;
    if (!this.active) return;
    if (this.presentation) this.syncRemotes(m);
    this.app.combat.onRoomState(m);
    this.app.onRoomState(m);
  }

  /** Lobby and Draft keep only the roster; build opponents for loading or world presentation. */
  private syncRemotes(m: RoomStateMsg): void {
    const seen = new Set<number>();
    for (const p of m.players) {
      seen.add(p.index);
      if (p.index === this.myIndex) continue;
      let r = this.remotes.get(p.index);
      if (!r) {
        r = new RemotePlayer(p.index, p.name, p.appearance, this.app.parts, this.app.anims, this.labels);
        this.app.r.scene.add(r.character.root);
        r.character.root.visible = this.presentation;
        this.remotes.set(p.index, r);
      } else {
        r.character.setAppearance(p.appearance);
        r.setName(p.dropped ? `${p.name} · reconectando…` : p.name);
      }
      r.setWeapons(p.weapons);
    }
    for (const [i, r] of this.remotes) {
      if (!seen.has(i)) {
        r.dispose();
        this.remotes.delete(i);
      }
    }
  }

  setPresentation(on: boolean): void {
    if (on === this.presentation) return;
    this.presentation = on;
    this.labels.hidden = !on;
    if (on && this.latestRoom) {
      this.syncRemotes(this.latestRoom);
      this.app.combat.abilities.onRoomState(this.latestRoom);
    }
    for (const remote of this.remotes.values()) remote.character.root.visible = on;
  }

  /** Build the frozen roster's models during loading without running or showing any opponent. */
  preparePresentation(): void {
    if (!this.latestRoom || this.left) return;
    this.syncRemotes(this.latestRoom);
    for (const remote of this.remotes.values()) {
      remote.onRespawn();
      remote.character.root.visible = false;
    }
    this.labels.hidden = true;
  }

  /** Initial messages can arrive before the app has entered the session's world. */
  syncState(): void {
    this.active = true;
    if (this.latestRoom) this.onRoomState(this.latestRoom);
    if (this.latestSelf) this.app.combat.onSelf(this.latestSelf);
    if (this.latestDraft) this.app.onDraftState(this.latestDraft);
    if (this.latestLoot) this.app.loot.onState(this.latestLoot);
    this.app.combat.abilities.setAbilityState(this.abilityCache.state(this.serverNow()));
    for (const reveal of this.abilityCache.privateReveals(this.serverNow())) this.app.combat.abilities.onReveal(reveal);
    if (this.latestWorld) this.app.interactives.onState(this.latestWorld);
  }

  private onSnapshot(m: SnapshotMsg): void {
    if (!this.active) return;
    this.snapshots++;
    this.serverTick = m.k;
    // Creeps ride every other snapshot (10 Hz), with the server clock of that snapshot.
    if (m.c) this.app.creeps.onSnapshot(m.t, m.c);
    for (const s of m.p) {
      const [index, px, py, pz, vx, vy, vz, fx, fy, fz, pitch, move, action, flags, ack, health, shield, mana, weapon] = s;
      const simDt = s[19] ?? 0;
      if (index === this.myIndex) {
        this.app.combat.onSelfSnapshot(health, shield, mana, (flags & SnapFlag.ALIVE) !== 0);
        // Aboard the UFO nothing is simulated locally; the dive starts from the `jump` event, not from a snapshot.
        if ((flags & SnapFlag.ON_SHIP) !== 0 || this.app.deploy.riding) continue;
        const st: CharacterState = createCharacterState({ x: px / POS_SCALE, y: py / POS_SCALE, z: pz / POS_SCALE }, { x: fx / FACING_SCALE, y: fy / FACING_SCALE, z: fz / FACING_SCALE });
        const len = Math.hypot(st.facing.x, st.facing.y, st.facing.z) || 1;
        st.facing.x /= len;
        st.facing.y /= len;
        st.facing.z /= len;
        st.vel.x = vx / VEL_SCALE;
        st.vel.y = vy / VEL_SCALE;
        st.vel.z = vz / VEL_SCALE;
        st.grounded = (flags & SnapFlag.GROUNDED) !== 0;
        st.aiming = (flags & SnapFlag.AIMING) !== 0;
        st.diving = (flags & SnapFlag.DIVING) !== 0;
        st.airJumped = (flags & SnapFlag.AIR_JUMPED) !== 0;
        st.airTime = st.grounded ? 0 : 1;
        st.moveState = move as CharacterState['moveState'];
        st.swimming = move === MovementState.SWIM;
        // Traversal: the mode rides on moveState, stamina and the step timers on their own fields (older servers: none).
        st.traversal = traversalOfMoveState(move);
        if (s[20] !== undefined) st.stamina = s[20] / STAMINA_SCALE;
        if (s[21] !== undefined) unpackTraversal(s[21], st);
        if (s[22] !== undefined) st.ledgeR = s[22] / POS_SCALE;
        st.aim = { ...this.app.local.state.aim };
        const localAbility = this.app.local.state;
        st.rooted = localAbility.rooted;
        st.noSprint = localAbility.noSprint;
        st.airControl = localAbility.airControl;
        st.sprintSpeed = localAbility.sprintSpeed;
        if (localAbility.abilityMovement) st.abilityMovement = { ...localAbility.abilityMovement, ...(localAbility.abilityMovement.anchor ? { anchor: { ...localAbility.abilityMovement.anchor } } : {}) };
        if (this.app.combat.consumeSnap()) {
          // Respawn / match start: the server moved us; teleport instead of reconciling across the planet.
          this.app.local.teleport(st.pos, st.facing);
          this.app.camera.reset(new THREE.Vector3(st.pos.x, st.pos.y, st.pos.z), new THREE.Vector3(st.facing.x, st.facing.y, st.facing.z));
        } else this.app.local.reconcile(st, ack);
        continue;
      }
      const r = this.remotes.get(index);
      if (!r) continue;
      r.setWeapon(weapon);
      r.push({
        t: m.t + simDt,
        pos: new THREE.Vector3(px / POS_SCALE, py / POS_SCALE, pz / POS_SCALE),
        vel: new THREE.Vector3(vx / VEL_SCALE, vy / VEL_SCALE, vz / VEL_SCALE),
        facing: new THREE.Vector3(fx, fy, fz).normalize(),
        aimPitch: pitch / PITCH_SCALE,
        moveState: move as MovementState,
        action: action as ActionState,
        flags,
        health,
        shield,
      }, this.serverNow());
    }
  }

  update(dt: number): void {
    if (this.left) return;
    this.tapSocket();
    // Inputs: flush every ~33 ms (2 commands per message at 60 Hz).
    this.sendTimer += dt;
    const out = this.app.local.outbox;
    if (out.length && (this.sendTimer >= 1 / 30 || out.length >= 4)) {
      this.sendTimer = 0;
      const msg: InputMsg = { i: out.splice(0, Math.min(out.length, 10)) };
      this.room.send(C2S.PLAYER_INPUT, msg);
    }
    this.pingTimer += dt;
    if (this.pingTimer > 1) {
      this.pingTimer = 0;
      this.room.send(C2S.PING, { c: Date.now() });
    }
    // Rates use the wall clock (frame dt is capped and would inflate them in throttled tabs).
    const elapsed = (performance.now() - this.rateSince) / 1000;
    if (elapsed >= 1) {
      this.rateIn = this.bytesIn / elapsed;
      this.rateOut = this.bytesOut / elapsed;
      this.bytesIn = 0;
      this.bytesOut = 0;
      this.rateSince = performance.now();
    }
    const vp = { w: window.innerWidth, h: window.innerHeight };
    const now = this.serverNow();
    if (this.presentation) for (const r of this.remotes.values()) r.update(dt, now, INTERPOLATION_DELAY_MS, this.app.r.camera, vp, this.app.world.physics);
  }

  sendAppearance(a: CharacterAppearance): void {
    if (!this.left) this.room.send(C2S.APPEARANCE_UPDATE, { appearance: a });
  }

  sendFire(m: FireMsg): void {
    if (!this.left) this.room.send(C2S.FIRE, m);
  }

  sendAbility(m: AbilityRequestMsg): void {
    if (!this.left) this.room.send(C2S.ABILITY_REQUEST, m);
  }

  sendInteract(m: InteractMsg): void {
    if (!this.left) this.room.send(C2S.INTERACT, m);
  }

  sendUseItem(m: UseItemMsg): void {
    if (!this.left) this.room.send(C2S.USE_ITEM, m);
  }

  sendWorldUse(m: WorldUseMsg): void {
    if (!this.left) this.room.send(C2S.WORLD_USE, m);
  }

  /** Dev builds only (the server ignores it in production). */
  sendDevLoot(m: DevLootMsg): void {
    if (!this.left && import.meta.env.DEV) this.room.send(C2S.DEV_LOOT, m);
  }

  sendReload(): void {
    if (!this.left) this.room.send(C2S.RELOAD, {});
  }

  /** SWITCH_WEAPON: 0 (E), 1 (Q) or FISTS_SLOT (weapons put away, punches). */
  sendSwitch(slot: number): void {
    if (!this.left) this.room.send(C2S.SWITCH_WEAPON, { w: slot });
  }

  /** A punch with empty hands (the server picks the target, if any). */
  sendMelee(m: MeleeMsg): void {
    if (!this.left) this.room.send(C2S.MELEE, m);
  }

  /** Spend one attribute point (STAT_IDS index); SELF brings the result. */
  sendAllocate(seq: number, k: number): void {
    if (!this.left) this.room.send(C2S.ALLOCATE_STAT, { s: seq, k });
  }

  sendDraftPick(round: number, id: string): void {
    if (!this.left) this.room.send(C2S.DRAFT_PICK, { r: round, a: id });
  }

  sendUfoJump(): void {
    if (!this.left) this.room.send(C2S.UFO_JUMP, {});
  }

  sendReady(ready: boolean): void {
    if (!this.left) this.room.send(C2S.READY, { r: ready ? 1 : 0 });
  }

  sendStartMatch(): void { if (!this.left) this.room.send(C2S.START_MATCH, {}); }
  sendRoomSettings(bots: number): void { if (!this.left) this.room.send(C2S.ROOM_SETTINGS, { bots }); }
  sendPrepared(id: number, ok: boolean, error?: string): void { if (!this.left) this.room.send(C2S.PREPARED, { id, ok, ...(error ? { error } : {}) }); }

  sendReturnLobby(): void {
    if (!this.left) this.room.send(C2S.RETURN_LOBBY, {});
  }

  leave(): void {
    if (this.left) return;
    this.left = true;
    this.app.combat.abilities.clearWorld();
    void this.room.leave(true).catch(() => {});
    for (const r of this.remotes.values()) r.dispose();
    this.remotes.clear();
    this.labels.remove();
  }

  stats(): Record<string, string | number> {
    let extrap = 0;
    for (const r of this.remotes.values()) extrap = Math.max(extrap, r.extrapolatedMs);
    return {
      sala: this.code,
      ping: `${this.rtt_.toFixed(0)} ms`,
      'rede entra/sai': `${(this.rateIn / 1024).toFixed(2)} / ${(this.rateOut / 1024).toFixed(2)} KB/s`,
      snapshot: `${this.lastSnapshotBytes} B (#${this.snapshots}, tick ${this.serverTick})`,
      entidades: this.remotes.size + 1,
      bots: this.latestRoom?.players.filter((p) => p.bot).length ?? 0,
      'quedas conexão': this.drops,
      'tick servidor': `${this.lastServerTickMs.toFixed(2)} ms`,
      reconciliação: `reexecutados ${this.app.local.stats.replayed} · erro ${(this.app.local.stats.lastCorrection * 100).toFixed(1)} cm`,
      'extrap. remoto': `${extrap.toFixed(0)} ms`,
      'atraso remoto': [...this.remotes.values()].map((r) => `${r.lag.toFixed(0)} ms`).join(' ') || '-',
      relógio: this.clockSynced ? `desvio ${this.clockOffset.toFixed(0)} ms` : 'sincronizando',
    };
  }
}
