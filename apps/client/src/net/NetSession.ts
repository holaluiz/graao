/**
 * Online session over Colyseus: create/join by room code, server clock sync, input batching, authoritative
 * reconciliation of the local player and interpolated remote players. Measures ping, bytes/s and snapshot size.
 */
import * as THREE from 'three';
import { Client, type Room } from '@colyseus/sdk';
import { createCharacterState, type CharacterState, type PlayerHitTarget } from '@graao/game-core';
import {
  type ActionState,
  type MovementState,
  C2S,
  CLIENT_VERSION,
  FACING_SCALE,
  INTERPOLATION_DELAY_MS,
  JoinError,
  PITCH_SCALE,
  POS_SCALE,
  PROTOCOL_VERSION,
  ROOM_NAME,
  S2C,
  SnapFlag,
  VEL_SCALE,
  type AbilityRequestMsg,
  type AbilityResultMsg,
  type CharacterAppearance,
  type DraftStateMsg,
  type EventsMsg,
  type FireMsg,
  type InputMsg,
  type JoinOptions,
  type PongMsg,
  type RoomStateMsg,
  type SelfStatusMsg,
  type SnapshotMsg,
  type WelcomeMsg,
} from '@graao/shared';
import type { GraaoApp } from '../app/GraaoApp';
import { RemotePlayer } from './RemotePlayer';

function serverUrl(): string {
  // Dev only: ?server=ws://host:port points this tab at another match server (parallel local setups).
  const q = import.meta.env.DEV ? new URLSearchParams(location.search).get('server') : null;
  if (q && /^wss?:\/\/[\w.-]+(:\d+)?$/.test(q)) return q;
  const env = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (env) return env;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.hostname}:2567`;
}

function friendlyError(e: unknown): Error {
  const msg = (e as Error)?.message ?? String(e);
  if (msg.includes(JoinError.VERSION_MISMATCH)) return new Error('Este servidor roda outra versão do graao. Recarregue a página.');
  if (/not found|invalid room|roomId/i.test(msg)) return new Error('Nenhuma sala com esse código.');
  if (/full|locked/i.test(msg)) return new Error('Essa sala está cheia.');
  if (/ECONNREFUSED|Failed to fetch|NetworkError|offline|ERR_CONNECTION/i.test(msg)) return new Error('Não foi possível falar com o servidor do graao. Ele está rodando? (pnpm dev)');
  return new Error(msg);
}

export class NetSession {
  code = '';
  myIndex = -1;
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

  private constructor(private readonly app: GraaoApp, private readonly room: Room) {
    this.labels.className = 'nameplates';
    document.getElementById('ui')!.appendChild(this.labels);
  }

  get remoteCount(): number {
    return this.remotes.size;
  }

  /** Smoothed round-trip time (ms). */
  get rtt(): number {
    return this.rtt_;
  }

  remote(index: number): RemotePlayer | undefined {
    return this.remotes.get(index);
  }

  /** Remote players as hitscan targets at their rendered positions (cosmetic prediction only). */
  hitTargets(): PlayerHitTarget[] {
    return [...this.remotes.values()].map((r) => ({ index: r.index, feet: { x: r.pos.x, y: r.pos.y, z: r.pos.z }, alive: r.alive }));
  }

  static async connect(app: GraaoApp, kind: 'create' | 'join', code: string, name: string): Promise<NetSession> {
    const client = new Client(serverUrl());
    const options: JoinOptions = { protocol: PROTOCOL_VERSION, client: CLIENT_VERSION, name, appearance: app.appearance };
    let room: Room;
    try {
      room = kind === 'create' ? await client.create(ROOM_NAME, options) : await client.joinById(code.toUpperCase(), options);
    } catch (e) {
      throw friendlyError(e);
    }
    const s = new NetSession(app, room);
    await s.init();
    return s;
  }

  private init(): Promise<void> {
    const room = this.room;
    this.tapSocket();
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('O servidor não respondeu.')), 8000);
      room.onMessage(S2C.WELCOME, (m: WelcomeMsg & { spawn: [number, number, number] }) => {
        clearTimeout(timeout);
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
      room.onMessage(S2C.EVENTS, (m: EventsMsg) => this.app.combat.onEvents(m.ev));
      room.onMessage(S2C.SELF, (m: SelfStatusMsg) => this.app.combat.onSelf(m));
      room.onMessage(S2C.ABILITY_RESULT, (m: AbilityResultMsg) => this.app.combat.abilities.onResult(m));
      room.onMessage(S2C.DRAFT_STATE, (m: DraftStateMsg) => this.app.onDraftState(m));
      room.onMessage(S2C.NOTICE, (m: { text: string }) => console.info('[graao] notice', m.text));
      room.onLeave((codeNum: number) => {
        if (!this.left) {
          console.warn('[graao] disconnected', codeNum);
          this.app.onDisconnected('A conexão com a sala caiu.');
        }
      });
    });
  }

  /** Counts raw WebSocket bytes for the F3 overlay (best effort: transport internals are not public API). */
  private tapped = false;
  private tapSocket(): void {
    if (this.tapped) return;
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
    const seen = new Set<number>();
    for (const p of m.players) {
      seen.add(p.index);
      if (p.index === this.myIndex) continue;
      let r = this.remotes.get(p.index);
      if (!r) {
        r = new RemotePlayer(p.index, p.name, p.appearance, this.app.parts, this.app.anims, this.labels);
        this.app.r.scene.add(r.character.root);
        this.remotes.set(p.index, r);
      } else {
        r.character.setAppearance(p.appearance);
        r.setName(p.name);
      }
    }
    for (const [i, r] of this.remotes) {
      if (!seen.has(i)) {
        r.dispose();
        this.remotes.delete(i);
      }
    }
    this.app.combat.onRoomState(m);
  }

  private onSnapshot(m: SnapshotMsg): void {
    this.snapshots++;
    this.serverTick = m.k;
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
        st.airTime = st.grounded ? 0 : 1;
        st.moveState = move as CharacterState['moveState'];
        st.aim = { ...this.app.local.state.aim };
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
    for (const r of this.remotes.values()) r.update(dt, now, INTERPOLATION_DELAY_MS, this.app.r.camera, vp, this.app.world.physics);
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

  sendReload(): void {
    if (!this.left) this.room.send(C2S.RELOAD, {});
  }

  sendSwitch(slot: number): void {
    if (!this.left) this.room.send(C2S.SWITCH_WEAPON, { w: slot });
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

  leave(): void {
    if (this.left) return;
    this.left = true;
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
      'tick servidor': `${this.lastServerTickMs.toFixed(2)} ms`,
      reconciliação: `reexecutados ${this.app.local.stats.replayed} · erro ${(this.app.local.stats.lastCorrection * 100).toFixed(1)} cm`,
      'extrap. remoto': `${extrap.toFixed(0)} ms`,
      'atraso remoto': [...this.remotes.values()].map((r) => `${r.lag.toFixed(0)} ms`).join(' ') || '-',
      relógio: this.clockSynced ? `desvio ${this.clockOffset.toFixed(0)} ms` : 'sincronizando',
    };
  }
}
