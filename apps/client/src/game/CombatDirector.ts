/**
 * CombatDirector (client): turns local input into FIRE / RELOAD / SWITCH / READY intents, predicts the cosmetic
 * part of a shot so it feels instant (tracer, flash, recoil, sound, animation), and presents server-confirmed
 * results (hitmarkers, damage numbers, damage direction, eliminations, match phases). Abilities (keys 1–4) live in
 * its AbilityDirector; both share the hit presentation here.
 *
 * It never decides gameplay: damage, ammo, eliminations and the winner come from the server. Predicted tracers use
 * the same deterministic spread (`shotSeed`) and hitscan rules as the server, so what you see is what it resolves.
 *
 * Response stack per event (BODY · WORLD · FX · CAMERA · AUDIO · UI), intensity MICRO → COMBAT → MAJOR.
 */
import * as THREE from 'three';
import { muzzlePoint, resolvePellet, shotSeed, spreadDirections, type PlayerHitTarget } from '@graao/game-core';
import { ATTRIBUTES, WEAPONS, WEAPON_SLOTS, type WeaponDefinition } from '@graao/game-data';
import {
  ActionState,
  DIR_SCALE,
  HitKind,
  MatchPhase,
  NoticeCode,
  POS_SCALE,
  type FireMsg,
  type GameEvent,
  type MatchSummaryMsg,
  type NoticeMsg,
  type PlayerPublic,
  type RoomStateMsg,
  type SelfStatusMsg,
  type Vec3,
} from '@graao/shared';
import type { GraaoApp } from '../app/GraaoApp';
import type { Cue } from '../audio/GRAAudioManager';
import { WeaponHolder } from '../character/WeaponModels';
import { Shape } from '../render/vfx/GRAVFXSystem';
import type { ScoreboardState } from '../ui/Scoreboard';
import { AbilityDirector } from './AbilityDirector';
import { WeaponController } from './WeaponController';

/** Camera response presets (shake and kick; always at full strength for every player). */
const CAMERA_RESPONSE = {
  MICRO: { shake: 0.0, kick: 1 },
  HIT: { shake: 0.5, kick: 0 },
  HEAVY: { shake: 1.0, kick: 0 },
  LANDING: { shake: 0.35, kick: 0 },
} as const;

interface PendingShot {
  weapon: WeaponDefinition;
  dir: THREE.Vector3;
  points: THREE.Vector3[];
  targets: number[];
}

/** The final blow plays out before the results card covers the world (ms). */
const RESULTS_DELAY_MS = 1400;

const mmToV = (p: [number, number, number], out = new THREE.Vector3()) => out.set(p[0] / POS_SCALE, p[1] / POS_SCALE, p[2] / POS_SCALE);

export class CombatDirector {
  readonly weapon = new WeaponController();
  readonly abilities: AbilityDirector;
  readonly holder: WeaponHolder;
  alive = true;
  health: number = ATTRIBUTES.maxHealth;
  shield: number = ATTRIBUTES.maxShield;
  mana: number = ATTRIBUTES.maxMana;
  phase: MatchPhase = MatchPhase.FREE_ROAM;
  private startsAt = 0;
  private phaseEndsAt = 0;
  private winner = -1;
  private players: PlayerPublic[] = [];
  private respawnAt = 0;
  private killerName = '';
  private online = false;
  private snapNext = false;
  private lastFireAt = -1e9;
  private readonly pending: PendingShot[] = [];
  private countdownShown = -1;
  /** The server's summary of the match that just ended, and whether it reached this player's history. */
  private summary: MatchSummaryMsg | null = null;
  private saved = false;
  private resultsAt = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly muzzleW = new THREE.Vector3();
  private blocked = false;

  constructor(private readonly app: GraaoApp) {
    this.holder = new WeaponHolder();
    this.holder.attachTo(app.character);
    this.abilities = new AbilityDirector(app);
  }

  /** MATCH only: server time when fighting starts. */
  get matchStartsAt(): number {
    return this.startsAt;
  }

  /** The local player takes part in the running match. */
  get inMatch(): boolean {
    return !!this.me()?.inMatch;
  }

  /** Entering the in-world phase (solo or online). */
  enter(online: boolean): void {
    this.online = online;
    this.alive = true;
    this.health = ATTRIBUTES.maxHealth;
    this.shield = ATTRIBUTES.maxShield;
    this.mana = ATTRIBUTES.maxMana;
    this.phase = MatchPhase.FREE_ROAM;
    this.players = [];
    this.startsAt = 0;
    this.winner = -1;
    this.weapon.reset();
    this.abilities.enter(online);
    this.summary = null;
    this.app.hud.setDeath(false);
    this.app.results.hide();
    this.app.hud.setStatus(online ? '' : 'EXPLORANDO SOZINHO · tiros e magias de treino');
    this.app.audio.setState('NORMAL');
  }

  private get myIndex(): number {
    return this.app.net?.myIndex ?? 0;
  }

  nameOf(index: number): string {
    return this.players.find((p) => p.index === index)?.name ?? `Jogador ${index + 1}`;
  }

  private serverNow(): number {
    return this.app.net ? this.app.net.serverNow() : Date.now();
  }

  /** Movement input is ignored while eliminated. */
  get frozen(): boolean {
    return !this.alive;
  }

  private canFire(): boolean {
    if (!this.alive || !this.app.input.locked) return false;
    // Hands are busy while swimming and while an ability winds up (the server refuses shots then too).
    if (this.app.local.state.swimming || this.abilities.casting()) return false;
    if (!this.online) return !this.app.deploy.riding && !this.app.deploy.diving;
    if (this.phase === MatchPhase.RESULTS || this.phase === MatchPhase.UFO) return false;
    if (this.phase === MatchPhase.MATCH) return this.serverNow() >= this.startsAt && !!this.me()?.inMatch;
    return true;
  }

  private me(): PlayerPublic | undefined {
    return this.players.find((p) => p.index === this.myIndex);
  }

  /** Everyone in the room as of the last ROOM_STATE (lobby panel, results). */
  get roomPlayers(): readonly PlayerPublic[] {
    return this.players;
  }

  /** Live authoritative room statistics, with elimination events as a fallback until ROOM_STATE arrives. */
  get scoreboardState(): ScoreboardState {
    return { players: this.players, phase: this.phase, me: this.myIndex, eliminated: this.eliminatedInMatch, summary: this.summary };
  }

  /** Upper body holds the aim pose while aiming and shortly after any shot. */
  aimPose(aiming: boolean): boolean {
    return this.alive && (aiming || performance.now() - this.lastFireAt < 650);
  }

  animAction(): ActionState {
    return this.alive ? ActionState.NONE : ActionState.DEAD;
  }

  // ------------------------------------------------------------------------------------------------ per frame

  /** Input → intents and predicted shots. Call after the camera has been updated for this frame. */
  update(dt: number): void {
    const app = this.app;
    const input = app.input;
    const now = performance.now();
    if (input.consume('ready')) {
      if (this.phase === MatchPhase.RESULTS) this.app.results.askLobby();
      else this.setReady(!this.me()?.ready);
    }
    const firePressed = input.consume('fire');
    if (firePressed && input.locked && this.alive && app.local.state.swimming) app.hud.notice('NADANDO · SEM ARMAS NA ÁGUA', 1.1);
    const r = this.weapon.update(
      dt,
      now,
      {
        fireHeld: input.isDown('fire'),
        firePressed,
        reloadPressed: input.consume('reload'),
        switchTo: input.consume('weapon1') ? 0 : input.consume('weapon2') ? 1 : -1,
      },
      this.canFire(),
    );
    if (r.switched) {
      app.net?.sendSwitch(this.weapon.slot);
      this.holder.setSlot(this.weapon.slot);
      app.audio.play('switch');
    }
    if (r.reloadStarted) {
      app.net?.sendReload();
      app.audio.play('reload');
      app.character.anim.playUpper('reload', clipSpeed(app.character.anim.clipDuration('reload'), this.weapon.weapon.reloadTime));
    }
    if (r.empty) {
      app.audio.play('empty');
      app.hud.notice('SEM MUNIÇÃO');
    }
    if (r.fire) this.fire(r.fire.seq, r.fire.slot, r.fire.weapon);
    this.abilities.update(dt);

    this.updateBlocked();
    this.updateHud(dt);
  }

  private fire(seq: number, slot: number, w: WeaponDefinition): void {
    const app = this.app;
    const cam = app.r.camera;
    const origin = cam.getWorldPosition(new THREE.Vector3());
    const dir = cam.getWorldDirection(new THREE.Vector3());
    const aiming = app.input.isDown('aim');
    if (this.online && app.net) {
      const msg: FireMsg = {
        s: seq,
        w: slot,
        o: [Math.round(origin.x * POS_SCALE), Math.round(origin.y * POS_SCALE), Math.round(origin.z * POS_SCALE)],
        d: [Math.round(dir.x * DIR_SCALE), Math.round(dir.y * DIR_SCALE), Math.round(dir.z * DIR_SCALE)],
        a: aiming ? 1 : 0,
      };
      app.net.sendFire(msg);
    }
    // Predict the same pellets the server will resolve.
    const s = app.local.state;
    const up = this.tmp.set(s.pos.x, s.pos.y, s.pos.z).normalize();
    const flat = dir.clone().addScaledVector(up, -dir.dot(up));
    const facing = flat.lengthSq() > 1e-6 ? flat.normalize() : new THREE.Vector3(s.facing.x, s.facing.y, s.facing.z);
    const muzzle = muzzlePoint(s.pos, facing);
    const targets: PlayerHitTarget[] = app.net ? app.net.hitTargets() : [];
    const dirs = spreadDirections(dir, aiming ? w.spreadAim : w.spreadHip, w.pellets, shotSeed(this.myIndex, seq));
    const shot: PendingShot = { weapon: w, dir, points: [], targets: [] };
    for (const d of dirs) {
      const res = resolvePellet(app.world.physics, origin, d, muzzle, w.range, targets, this.myIndex);
      shot.points.push(new THREE.Vector3(res.point.x, res.point.y, res.point.z));
      shot.targets.push(res.target);
    }
    this.pending.push(shot);
    this.lastFireAt = performance.now();
    // Body, camera, audio.
    app.character.anim.playUpper('fire', 1.4);
    app.camera.kick(w.cameraProfile.kick * 4 * CAMERA_RESPONSE.MICRO.kick, (Math.random() - 0.5) * w.cameraProfile.kick);
    app.audio.play(w.id === 'sunbeam' ? 'fire.sunbeam' : 'fire.petal');
  }

  /** Spawns queued shot visuals from the weapon's real muzzle. Call after the character pose and animation update. */
  present(): void {
    if (!this.pending.length) return;
    this.app.character.root.updateMatrixWorld(true);
    const muzzle = this.holder.muzzleWorld(this.muzzleW);
    for (const s of this.pending) this.drawShot(muzzle, s.dir, s.weapon, s.points, s.targets, true);
    this.pending.length = 0;
  }

  private drawShot(muzzle: THREE.Vector3, dir: THREE.Vector3, w: WeaponDefinition, points: THREE.Vector3[], targets: number[], local: boolean): void {
    const vfx = this.app.vfx;
    const p = w.presentationProfile;
    const sun = w.id === 'sunbeam';
    vfx.flash(muzzle, p.flash, sun ? 0.42 : 0.55, sun ? 0.06 : 0.08);
    vfx.burst(muzzle, dir, { color: p.flash, count: sun ? 4 : 7, speed: sun ? 5 : 3.5, size: sun ? 0.06 : 0.09, life: 0.16, spread: 0.5, shape: sun ? Shape.SPARK : Shape.PETAL, drag: 6 });
    points.forEach((pt, i) => {
      vfx.beam(muzzle, pt, p.tracer, sun ? 0.065 : 0.032, sun ? 0.13 : 0.17);
      const back = this.tmp2.copy(muzzle).sub(pt).normalize();
      if (targets[i]! < 0) {
        // World impact: a pigment puff and a few flecks.
        vfx.burst(pt, back, { color: p.impact, count: sun ? 5 : 2, speed: 2.2, size: sun ? 0.16 : 0.12, life: 0.35, spread: 1.1, gravity: 4, drag: 4, shape: Shape.DOT });
        if (!sun) vfx.burst(pt, back, { color: '#ffe3ea', count: 2, speed: 1.5, size: 0.1, life: 0.6, spread: 1.4, gravity: 1.5, drag: 3, shape: Shape.PETAL, category: 'Environment' });
      } else if (local) {
        vfx.burst(pt, back, { color: p.impact, count: 3, speed: 2.5, size: 0.08, life: 0.2, spread: 0.9, drag: 5, shape: Shape.SPARK });
      }
    });
  }

  private updateBlocked(): void {
    const app = this.app;
    if (!this.alive) {
      this.blocked = false;
      return;
    }
    const cam = app.r.camera;
    const origin = cam.position;
    const dir = cam.getWorldDirection(this.tmp);
    const w = this.weapon.weapon;
    const hit = app.world.physics.castRay(origin, dir, w.range);
    if (!hit) {
      this.blocked = false;
      return;
    }
    const aim = { x: origin.x + dir.x * hit.toi, y: origin.y + dir.y * hit.toi, z: origin.z + dir.z * hit.toi };
    const s = app.local.state;
    const m = muzzlePoint(s.pos, s.facing);
    const d = { x: aim.x - m.x, y: aim.y - m.y, z: aim.z - m.z };
    const len = Math.hypot(d.x, d.y, d.z);
    if (len < 0.6) {
      this.blocked = false;
      return;
    }
    const block = app.world.physics.castRay(m, { x: d.x / len, y: d.y / len, z: d.z / len }, len - 0.5);
    this.blocked = !!block;
  }

  // ------------------------------------------------------------------------------------------------ HUD

  private updateHud(dt: number): void {
    const app = this.app;
    const hud = app.hud;
    const now = performance.now();
    const w = this.weapon.weapon;
    hud.setVitals(this.health, this.shield, this.abilities.ctl.manaShown, ATTRIBUTES.maxHealth, ATTRIBUTES.maxShield, ATTRIBUTES.maxMana);
    hud.setWeapons(
      this.weapon.slot,
      WEAPON_SLOTS.map((id, i) => ({ key: i === 0 ? 'E' : 'Q', name: WEAPONS[id].name, ammo: this.weapon.ammo[i]!, magazine: WEAPONS[id].magazine })),
      this.weapon.reloadProgress(now),
    );
    const cam = app.r.camera;
    const cone = ((app.input.isDown('aim') ? w.spreadAim : w.spreadHip) * Math.PI) / 180;
    const px = (Math.tan(cone) / Math.tan(((cam.fov / 2) * Math.PI) / 180)) * (window.innerHeight / 2);
    hud.setReticle(w.reticleProfile, px + this.weapon.bloom * 7, this.blocked, this.alive && app.input.locked);
    this.updatePhaseUi();
    hud.update(dt);
    // Audio state follows attention: CRITICAL low health muffles the world, results calm it down.
    if (this.phase === MatchPhase.RESULTS) app.audio.setState('POST_MATCH');
    else app.audio.setState(this.alive && this.health <= ATTRIBUTES.maxHealth * 0.3 ? 'LOW_HEALTH' : 'NORMAL');
  }

  private updatePhaseUi(): void {
    const hud = this.app.hud;
    if (!this.online) return;
    const now = this.serverNow();
    const connected = this.players.filter((p) => p.connected);
    if (this.phase === MatchPhase.FREE_ROAM) {
      const ready = connected.filter((p) => p.ready).length;
      if (this.app.net?.solo) hud.setStatus('SOLO COM BOTS · ENTER para começar', 'relevant');
      else if (connected.length < 2) hud.setStatus(`AQUECIMENTO · aguardando oponente · código ${this.app.net?.code ?? ''}`);
      else if (this.me()?.ready) hud.setStatus(`PRONTO ✓ · aguardando os outros (${ready}/${connected.length}) · ENTER cancela`, 'relevant');
      else hud.setStatus(`AQUECIMENTO · ENTER quando estiver pronto (${ready}/${connected.length})`, 'relevant');
    } else if (this.phase === MatchPhase.MATCH) {
      if (now < this.startsAt) {
        const n = Math.ceil((this.startsAt - now) / 1000);
        if (n !== this.countdownShown) {
          this.countdownShown = n;
          hud.banner(String(n), 'Prepare-se', 1.1);
          this.app.audio.play('countdown');
        }
        hud.setStatus('PARTIDA · armas liberadas em instantes');
      } else {
        if (this.countdownShown > 0) {
          this.countdownShown = 0;
          hud.banner('LUTEM!', 'O último de pé vence · TAB: placar', 1.2, 'good');
          this.app.audio.play('go');
        }
        const standing = this.players.filter((p) => p.inMatch && p.connected).length - this.eliminatedInMatch.size;
        hud.setStatus(`PARTIDA · ${Math.max(0, standing)} de pé`);
      }
    } else if (this.phase === MatchPhase.RESULTS) {
      hud.setStatus('');
      // The final blow plays out first; then the card, with the pointer free for its buttons.
      const app = this.app;
      if (this.summary && performance.now() - this.resultsAt >= RESULTS_DELAY_MS) {
        if (!app.results.visible) app.input.exitLock();
        app.results.show(this.summary, this.myIndex, this.players, app.net?.solo ? 'solo' : this.saved ? 'saved' : app.profile.status === 'cloud' ? 'pending' : 'guest');
        app.results.update(Math.ceil((this.phaseEndsAt - now) / 1000), this.players);
      }
    }
    if (!this.alive) {
      const sub =
        this.phase === MatchPhase.MATCH || this.phase === MatchPhase.RESULTS
          ? `por ${this.killerName} · aguarde o fim da partida`
          : `por ${this.killerName} · voltando em ${Math.max(0, Math.ceil((this.respawnAt - now) / 1000))} s`;
      this.app.hud.setDeath(this.phase !== MatchPhase.RESULTS, sub);
    }
  }

  private readonly eliminatedInMatch = new Set<number>();

  /** READY intent (ENTER or the lobby button); the server decides when everyone is. */
  setReady(ready: boolean): void {
    if (!this.online || this.phase !== MatchPhase.FREE_ROAM || !this.app.net) return;
    this.app.net.sendReady(ready);
    this.app.audio.play(ready ? 'ui.ready' : 'ui.click');
  }

  /** MATCH_SUMMARY arrives just before the ROOM_STATE that turns the phase to RESULTS. */
  onSummary(m: MatchSummaryMsg): void {
    this.summary = m;
    this.saved = false;
  }

  onNotice(m: NoticeMsg): void {
    if (m.code === NoticeCode.MATCH_SAVED) this.saved = true;
    else if (m.text) this.app.hud.notice(m.text, 2);
  }

  // ------------------------------------------------------------------------------------------------ server messages

  onRoomState(m: RoomStateMsg): void {
    const prev = this.phase;
    this.players = m.players;
    this.phase = m.phase;
    this.startsAt = m.startsAt;
    this.phaseEndsAt = m.phaseEndsAt;
    this.winner = m.winner;
    if (prev !== m.phase) {
      // The Ability Draft is a screen over the world; leaving it (match start, or called off) gives the world back.
      this.app.setDraft(m.phase === MatchPhase.ABILITY_DRAFT);
      if (m.phase === MatchPhase.UFO) {
        // Boarding: fresh weapons and abilities arrive with SELF; nothing to fight with until everyone has landed.
        this.weapon.reset();
        this.abilities.onRespawn();
        this.app.results.hide();
      } else if (m.phase === MatchPhase.MATCH) {
        this.weapon.reset();
        this.abilities.onRespawn();
        this.eliminatedInMatch.clear();
        this.countdownShown = -1;
        this.app.results.hide();
      } else if (m.phase === MatchPhase.RESULTS) {
        const win = m.winner === this.myIndex;
        this.resultsAt = performance.now();
        this.app.audio.play(m.winner < 0 ? 'defeat' : win ? 'victory' : 'defeat');
        this.app.hud.setDeath(false);
      } else if (m.phase === MatchPhase.FREE_ROAM) {
        this.app.results.hide();
        if (prev === MatchPhase.ABILITY_DRAFT) this.app.hud.banner('DRAFT CANCELADO', 'Faltaram jogadores · de volta ao aquecimento', 2.4, 'bad');
        else this.app.hud.banner('AQUECIMENTO', 'Treine à vontade · ENTER quando estiver pronto', 2.2);
      }
    }
    this.abilities.onRoomState(m);
    this.app.deploy.onRoomState(m);
  }

  onSelf(s: SelfStatusMsg): void {
    const net = this.app.net;
    if (!net) return;
    this.weapon.applyServer(s, performance.now(), net.rtt, (t) => performance.now() + (t - net.serverNow()));
    this.holder.setSlot(this.weapon.slot);
    if (!s.alive) this.respawnAt = s.respawnAt;
    this.abilities.onSelf(s);
  }

  /** Authoritative vitals from my own snapshot entry. */
  onSelfSnapshot(health: number, shield: number, mana: number, alive: boolean): void {
    this.health = health;
    this.shield = shield;
    this.mana = mana;
    this.abilities.ctl.mana = mana;
    if (alive !== this.alive && alive) this.revive();
    this.alive = alive;
  }

  /** True once after my respawn: the next snapshot teleports instead of reconciling. */
  consumeSnap(): boolean {
    const s = this.snapNext;
    this.snapNext = false;
    return s;
  }

  private revive(): void {
    this.alive = true;
    this.weapon.reset();
    this.abilities.onRespawn();
    this.app.hud.setDeath(false);
  }

  onEvents(events: GameEvent[]): void {
    const me = this.myIndex;
    for (const e of events) {
      switch (e.e) {
        case 'shot':
          if (e.by !== me) this.remoteShot(e.by, e.w, e.to, e.t);
          break;
        case 'dmg':
          this.onDamage(e.by, e.target, e.amount, e.kinds, e.health, e.shield);
          break;
        case 'elim':
          this.onElimination(e.by, e.target);
          break;
        case 'respawn':
          if (e.target === me) {
            this.snapNext = true;
            this.revive();
            this.health = ATTRIBUTES.maxHealth;
            this.shield = ATTRIBUTES.maxShield;
          } else this.app.net?.remote(e.target)?.onRespawn();
          this.eliminatedInMatch.delete(e.target);
          break;
        case 'cast':
        case 'proj':
        case 'projEnd':
        case 'area':
        case 'fx':
          this.abilities.onEvent(e);
          break;
        case 'jump':
        case 'land':
          this.app.deploy.onEvent(e);
          break;
        case 'reload':
          if (e.by !== me) {
            const r = this.app.net?.remote(e.by);
            const w = WEAPONS[WEAPON_SLOTS[e.w]!];
            r?.character.anim.playUpper('reload', clipSpeed(r.character.anim.clipDuration('reload'), w.reloadTime));
          }
          break;
      }
    }
  }

  private remoteShot(by: number, slot: number, to: [number, number, number][], t: number[]): void {
    const r = this.app.net?.remote(by);
    if (!r) return;
    const w = WEAPONS[WEAPON_SLOTS[slot]!];
    r.setWeapon(slot);
    r.character.anim.playUpper('fire', 1.4);
    r.firedAt = performance.now();
    r.character.root.updateMatrixWorld(true);
    const muzzle = r.holder.muzzleWorld(new THREE.Vector3());
    const pts = to.map((p) => mmToV(p));
    const dir = (pts[0] ?? muzzle).clone().sub(muzzle).normalize();
    this.drawShot(muzzle, dir, w, pts, t, false);
    // Enemy fire is a threat: its own bus, panned and attenuated by distance.
    const { pan, dist } = this.spatial(muzzle);
    this.app.audio.play(w.id === 'sunbeam' ? 'fire.sunbeam' : 'fire.petal', { threat: true, pan, volume: 1 / (1 + dist / 14), muffle: Math.min(0.8, dist / 90), pitch: 0.94 });
  }

  private spatial(p: THREE.Vector3): { pan: number; dist: number } {
    const cam = this.app.r.camera;
    const d = this.tmp2.copy(p).sub(cam.position);
    const dist = d.length();
    const right = this.app.camera.frame.right;
    return { pan: dist > 0.01 ? d.dot(right) / dist : 0, dist };
  }

  private onDamage(by: number, target: number, amount: number, kinds: HitKind[], health: number, shield: number): void {
    const app = this.app;
    const me = this.myIndex;
    const has = (k: HitKind) => kinds.includes(k);
    // by === target: drowning (no hitmarker for hurting yourself).
    if (by === me && target !== me) {
      app.hud.hit(kinds);
      const cue: Cue = has(HitKind.SHIELD_BREAK) ? 'hit.shieldBreak' : has(HitKind.CRITICAL) ? 'hit.crit' : has(HitKind.SHIELD) && !has(HitKind.BODY) ? 'hit.shield' : 'hit.body';
      if (!has(HitKind.ELIMINATION)) app.audio.play(cue);
    }
    if (target === me) {
      this.health = health;
      this.shield = shield;
      const attacker = app.net?.remote(by);
      if (attacker) {
        const angle = this.angleTo(attacker.pos);
        app.hud.damageFrom(angle, has(HitKind.SHIELD) || has(HitKind.SHIELD_BREAK));
      }
      const resp = has(HitKind.CRITICAL) || has(HitKind.SHIELD_BREAK) ? CAMERA_RESPONSE.HEAVY : CAMERA_RESPONSE.HIT;
      app.camera.addShake(resp.shake, 0.22);
      app.audio.play(has(HitKind.SHIELD_BREAK) ? 'hurt.shieldBreak' : has(HitKind.BODY) || has(HitKind.CRITICAL) ? 'hurt.health' : 'hurt.shield');
      if (has(HitKind.SHIELD_BREAK)) app.hud.notice('SEU ESCUDO QUEBROU', 1.2);
      if (!has(HitKind.ELIMINATION)) app.character.anim.playOneShot('hit', { speed: 1.5 });
      this.hitFx(app.local.state.pos, kinds);
    } else {
      const r = app.net?.remote(target);
      if (r) {
        if (!has(HitKind.ELIMINATION)) r.character.anim.playOneShot('hit', { speed: 1.5 });
        this.hitFx(r.pos, kinds);
        if (by === me) {
          // Damage number above the target's head.
          const up = this.tmp.copy(r.pos).normalize();
          const head = this.tmp2.copy(r.pos).addScaledVector(up, 1.95).project(app.r.camera);
          if (head.z < 1) app.hud.damageNumber(((head.x + 1) / 2) * window.innerWidth, ((1 - head.y) / 2) * window.innerHeight, amount, kinds);
        }
      }
    }
  }

  /** World/FX layer of a hit at a character standing at `feet`. Shape tells the kind, not only color. */
  private hitFx(feet: Vec3, kinds: HitKind[]): void {
    const vfx = this.app.vfx;
    const up = this.tmp.set(feet.x, feet.y, feet.z).normalize();
    const chest = this.tmp2.set(feet.x, feet.y, feet.z).addScaledVector(up, 1.05);
    const has = (k: HitKind) => kinds.includes(k);
    if (has(HitKind.SHIELD_BREAK)) {
      vfx.ring(chest, '#7fc4ff', 2.2, 0.4);
      vfx.burst(chest, up, { color: '#9fd4ff', count: 14, speed: 4.5, size: 0.14, life: 0.6, gravity: 9, drag: 2, shape: Shape.SHARD, category: 'GameplayCritical' });
    } else if (has(HitKind.SHIELD)) {
      vfx.burst(chest, up, { color: '#8fcaff', count: 5, speed: 2.4, size: 0.11, life: 0.3, gravity: 4, drag: 3, shape: Shape.SHARD, category: 'GameplayCritical' });
    }
    if (has(HitKind.BODY) || has(HitKind.CRITICAL)) {
      vfx.burst(chest, up, { color: has(HitKind.CRITICAL) ? '#ffd36e' : '#ffb08a', count: has(HitKind.CRITICAL) ? 8 : 5, speed: 2.8, size: 0.1, life: 0.3, gravity: 6, drag: 3, shape: Shape.DOT, category: 'GameplayCritical' });
    }
    if (has(HitKind.ABILITY)) {
      // Magic hits: lilac diamonds spinning off, on top of the shield/health shape.
      vfx.burst(chest, up, { color: '#d8c8ff', count: 7, speed: 3.2, size: 0.12, life: 0.4, gravity: 3, drag: 3, shape: Shape.SHARD, category: 'GameplayCritical' });
    }
  }

  private onElimination(by: number, target: number): void {
    const app = this.app;
    const me = this.myIndex;
    this.eliminatedInMatch.add(target);
    // Eliminated by yourself = drowned: the water takes the credit in the feed.
    const killer = by === target ? 'Água' : this.nameOf(by);
    const victim = this.nameOf(target);
    app.hud.feed(killer, victim, by === me && target !== me ? 'killer' : target === me ? 'victim' : null);
    const pos = target === me ? app.local.state.pos : app.net?.remote(target)?.pos;
    if (pos) {
      const up = this.tmp.set(pos.x, pos.y, pos.z).normalize();
      const at = this.tmp2.set(pos.x, pos.y, pos.z).addScaledVector(up, 0.9);
      app.vfx.ring(at, '#ffd36e', 3.2, 0.55);
      app.vfx.burst(at, up, { color: '#ffe8a8', count: 18, speed: 5, size: 0.16, life: 0.9, gravity: 5, drag: 2.5, shape: Shape.PETAL, category: 'GameplayCritical' });
    }
    if (by === me && target !== me) {
      app.audio.play('hit.elim');
      app.hud.hit([HitKind.ELIMINATION]);
      app.hud.banner('ELIMINAÇÃO', victim, 1.4, 'good');
    }
    if (target === me) {
      this.alive = false;
      this.killerName = killer;
      app.audio.play('death');
      app.camera.addShake(CAMERA_RESPONSE.HEAVY.shake, 0.35);
    }
  }

  /** Screen-space angle (rad) of a world point around the reticle: 0 ahead, + to the right. */
  private angleTo(p: THREE.Vector3): number {
    const f = this.app.camera.frame;
    const s = this.app.local.state.pos;
    const d = this.tmp.set(p.x - s.x, p.y - s.y, p.z - s.z);
    return Math.atan2(d.dot(f.right), d.dot(f.forward));
  }
}

/** timeScale that makes a clip of `duration` last `seconds`. */
function clipSpeed(duration: number, seconds: number): number {
  return duration > 0 ? Math.max(0.3, Math.min(3, duration / seconds)) : 1;
}
