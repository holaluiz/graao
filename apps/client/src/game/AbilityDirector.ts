/**
 * AbilityDirector (client): keys 1–4 → ABILITY_REQUEST intents carrying the target the server validates (a direction
 * from the cast origin toward what the camera aims at, a lobbed direction for arcing seeds, a ground point for areas,
 * the move direction for dashes), plus all ability presentation.
 *
 * It never decides gameplay: the AbilityController mirror only decides whether to PREDICT (cast animation, own
 * projectile, dash, cooldown sweep) before the server answers. Everyone's casts, projectiles, areas and status effects
 * are drawn from server events; telegraphs (ground warnings, the lance's lane) are shown to every player.
 *
 * Solo practice runs the same GRAAbilitySystem locally with the local player as the only actor, so the whole pipeline
 * (requests, results, events) is identical offline.
 */
import * as THREE from 'three';
import {
  GRAAbilitySystem,
  createAbilityBarrier,
  castOrigin,
  defaultLoadout,
  lobDirection,
  newVitals,
  newAbilityRuntime,
  passiveModifiers,
  rayPlayers,
  regenMana,
  resetCooldowns,
  resolveTargetPoint,
  stepProjectile,
  statusModifiers,
  projectileReach,
  type AbilityActor,
  type ProjectileBody,
} from '@graao/game-core';
import { ABILITIES, ULTIMATE_SLOT, isAbilityId, type AbilityDefinition, type AbilityEffect, type AbilityId, type Loadout } from '@graao/game-data';
import {
  AbilityReject,
  DIR_SCALE,
  MatchPhase,
  POS_SCALE,
  VEL_SCALE,
  type AbilityRequestMsg,
  type AbilityResultMsg,
  type AbilityStateMsg,
  type AbilityRevealMsg,
  type GameEvent,
  type RoomStateMsg,
  type SelfStatusMsg,
  type StatusFx,
  type Vec3,
} from '@graao/shared';
import type { GraaoApp } from '../app/GraaoApp';
import type { Cue } from '../audio/GRAAudioManager';
import type { GraaoCharacter } from '../character/GraaoCharacter';
import type { AbilitySlotView } from '../ui/Hud';
import { DecalMode, Shape } from '../render/vfx/GRAVFXSystem';
import type { UltimateMark } from '../render/vfx/UltimateMarks';
import { AbilityWorldPresentation } from '../render/vfx/AbilityWorldPresentation';
import { AbilityController } from './AbilityController';
import { keyLabel } from './KeyBindings';

const ACTIONS = ['ability1', 'ability2', 'ability3', 'ultimate'] as const;

const mmToV = (p: [number, number, number], out = new THREE.Vector3()) => out.set(p[0] / POS_SCALE, p[1] / POS_SCALE, p[2] / POS_SCALE);
const quantDir = (d: Vec3): [number, number, number] => [Math.round(d.x * DIR_SCALE), Math.round(d.y * DIR_SCALE), Math.round(d.z * DIR_SCALE)];
const unquant = (q: [number, number, number]): Vec3 => {
  const l = Math.hypot(q[0], q[1], q[2]) || 1;
  return { x: q[0] / l, y: q[1] / l, z: q[2] / l };
};

function effectOf<K extends AbilityEffect['kind']>(def: AbilityDefinition, kind: K): Extract<AbilityEffect, { kind: K }> | undefined {
  const walk = (list: AbilityEffect[]): AbilityEffect | undefined => {
    for (const e of list) {
      if (e.kind === kind) return e;
      const inner = e.kind === 'projectile' ? walk(e.onHit) : e.kind === 'area' ? walk(e.effects) : undefined;
      if (inner) return inner;
    }
    return undefined;
  };
  return walk(def.effects) as Extract<AbilityEffect, { kind: K }> | undefined;
}

interface SentCast {
  seq: number;
  slot: number;
  def: AbilityDefinition;
  dir?: Vec3;
  point?: Vec3;
  cmdSeq: number;
  predicted: boolean;
}

interface VisualProjectile {
  id: number;
  seq: number;
  mine: boolean;
  def: AbilityDefinition;
  body: ProjectileBody;
  prev: THREE.Vector3;
  /** Server end point (fly there, then burst) and the target index it reported. */
  end: THREE.Vector3 | null;
  endHit: number;
  age: number;
  deadline: number;
  sparkle: number;
}

interface Aura {
  index: number;
  def: AbilityDefinition;
  until: number;
  acc: number;
  seq: number;
}

/** The local player as an ability actor for solo practice (its state is the live predicted state). */
class SoloActor implements AbilityActor {
  readonly index = 0;
  vitals = newVitals();
  loadout: Loadout = defaultLoadout(0);
  cooldownEnds = [0, 0, 0, 0];
  castUntil = 0;
  slowUntil = 0;
  slowFactor = 1;
  runtime = newAbilityRuntime(Date.now());
  constructor(private readonly app: GraaoApp) {}
  get state() {
    return this.app.local.state;
  }
}

export class AbilityDirector {
  readonly ctl = new AbilityController();
  readonly world: AbilityWorldPresentation;
  private online = false;
  private readonly sent = new Map<number, SentCast>();
  private readonly projectiles: VisualProjectile[] = [];
  /** Recently finished visuals (avoid drawing the same impact twice when the server's end arrives). */
  private readonly ended: { id: number; seq: number; at: THREE.Vector3; t: number }[] = [];
  private readonly timers: { at: number; fn: () => void; seq: number }[] = [];
  private readonly auras: Aura[] = [];
  private readonly marks = new Map<number, { id: string; root: THREE.Object3D; mark: UltimateMark }>();
  private readonly remoteFx = new Map<number, { slowUntil: number; dashUntil: number; prev: THREE.Vector3; acc: number }>();
  private ultWasReady = false;
  private ultKnown = false;
  private selfFxAcc = 0;
  private readonly lastLocal = new THREE.Vector3();
  private solo: GRAAbilitySystem | null = null;
  private soloActor: SoloActor | null = null;
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly deniedAt = new Array<number>(4).fill(-Infinity);

  constructor(private readonly app: GraaoApp) {
    this.world = new AbilityWorldPresentation(app.r.scene, app.world.physics, app.r.camera, document.getElementById('ui')!);
  }

  private get me(): number {
    return this.app.net?.myIndex ?? 0;
  }

  private serverNow(): number {
    return this.app.net ? this.app.net.serverNow() : Date.now();
  }

  private toLocal(serverT: number): number {
    return performance.now() + (serverT - this.serverNow());
  }

  /** Entering the world (solo or online). */
  enter(online: boolean): void {
    this.solo?.clear();
    this.world.clear();
    this.world.mirrorCollisions = online;
    this.online = online;
    this.sent.clear();
    this.projectiles.length = 0;
    this.timers.length = 0;
    this.auras.length = 0;
    this.ctl.reset();
    this.ultKnown = false;
    if (online) {
      this.solo = null;
      this.soloActor = null;
    } else {
      // Solo practice: the real ability system, locally, with the local player as its only actor.
      const actor = new SoloActor(this.app);
      resetCooldowns(actor.cooldownEnds, Date.now(), 4000);
      this.soloActor = actor;
      this.solo = new GRAAbilitySystem({
        physics: this.app.world.physics,
        actors: () => [actor],
        canFight: () => true,
        damage: () => {},
        dash: (_a, dir, distance, duration, cmdSeq) => {
          if (this.app.local.nextSeq === cmdSeq) this.app.local.scheduleDash(dir, distance, duration);
        },
        emit: (e) => this.onEvent(e),
        sendPrivate: (_actor, message) => this.onReveal(message),
        createBarrier: (_view, frame) => createAbilityBarrier(this.app.world.physics, frame),
        teleport: (_actor, feet, facing) => this.app.local.teleport(feet, facing),
      });
      this.ctl.setLoadout(actor.loadout);
      this.setMark(this.me, actor.loadout[ULTIMATE_SLOT]!, this.app.character);
      this.syncSolo();
    }
  }

  /** Respawn / match start: fresh cooldowns arrive in the next SELF. */
  onRespawn(): void {
    this.ctl.reset();
    this.ultKnown = false;
    this.world.clearReveals();
    this.world.removeAttachment(this.me);
  }

  setAbilityState(state: AbilityStateMsg): void { this.world.setState(state); }
  onReveal(message: AbilityRevealMsg): void { this.world.onReveal(message); }
  clearWorld(): void {
    this.solo?.clear(); this.world.clear();
    for (const entry of this.marks.values()) this.app.vfx.detachMark(entry.mark);
    this.marks.clear(); this.remoteFx.clear();
    this.projectiles.length = this.auras.length = this.timers.length = 0;
  }

  casting(): boolean {
    return this.ctl.casting(performance.now());
  }

  // ------------------------------------------------------------------------------------------------ per frame

  update(dt: number): void {
    const app = this.app;
    const now = performance.now();
    if (this.solo && this.soloActor) {
      regenMana(this.soloActor.vitals, dt);
      this.solo.update(Date.now(), dt);
      this.syncSolo();
    }
    for (let k = 0; k < ACTIONS.length; k++) if (app.input.consume(ACTIONS[k]!)) this.press(k);
    app.local.slow = this.ctl.speed;
    app.local.state.rooted = now < this.ctl.rootedEnd;
    app.local.state.noSprint = now < this.ctl.noSprintEnd;
    app.local.state.airControl = this.ctl.airControl;
    app.local.state.sprintSpeed = this.ctl.sprintSpeed;
    for (let i = this.timers.length - 1; i >= 0; i--) {
      if (now >= this.timers[i]!.at) {
        const t = this.timers[i]!;
        this.timers.splice(i, 1);
        t.fn();
      }
    }
    this.updateProjectiles(dt);
    this.updateAuras(dt, now);
    this.updateStatusFx(dt, now);
    this.updateHud(now);
    this.world.update(this.serverNow());
  }

  /** Can this player fight right now (phase rule mirror; the server decides). */
  private canFight(): boolean {
    const c = this.app.combat;
    // Hands are stroking while swimming (the server refuses casts then too).
    if (this.app.local.state.swimming) return false;
    if (!this.online) return !this.app.deploy.riding && !this.app.deploy.diving;
    if (c.phase === MatchPhase.MATCH) return this.serverNow() >= c.matchStartsAt && c.inMatch;
    return c.phase === MatchPhase.FREE_ROAM;
  }

  private press(slot: number): void {
    const app = this.app;
    if (this.ctl.def(slot).kind === 'passive') return;
    if (!app.input.locked) return;
    if (app.local.state.swimming && app.combat.alive) {
      app.hud.notice('NADANDO · SEM MAGIAS NA ÁGUA', 1.1);
      app.hud.abilityDenied(slot);
      app.audio.play('ab.denied');
      return;
    }
    // Hands busy with a consumable (the server refuses it too).
    if (app.loot.using) {
      app.hud.notice('MÃOS OCUPADAS', 0.9);
      app.hud.abilityDenied(slot);
      app.audio.play('ab.denied');
      return;
    }
    const now = performance.now();
    const p = this.ctl.press(slot, now, app.combat.alive, this.canFight());
    if (!p) return;
    const def = p.def;
    const cam = app.r.camera;
    const origin = cam.getWorldPosition(new THREE.Vector3());
    const camDir = cam.getWorldDirection(new THREE.Vector3());
    const feet = app.local.state.pos;
    let dir: Vec3 | undefined;
    let point: Vec3 | undefined;
    const dash = effectOf(def, 'dash');
    const proj = effectOf(def, 'projectile');
    if (dash) dir = this.moveDirection(camDir);
    else if (def.targetType === 'direction') {
      // Toward what the camera aims at (world or a player), from where the projectile leaves the caster.
      const reach = projectileReach(def) + 10;
      const hit = app.world.physics.castRay(origin, camDir, reach);
      const tw = hit ? hit.toi : reach;
      const hp = rayPlayers(origin, camDir, tw, app.net ? app.net.hitTargets() : [], this.me);
      const aim = origin.clone().addScaledVector(camDir, hp ? hp.t : tw);
      const from = castOrigin(feet, camDir);
      dir = proj && proj.gravity > 0 && hit && !hp ? lobDirection(from, aim, proj.speed, proj.gravity) : new THREE.Vector3(aim.x - from.x, aim.y - from.y, aim.z - from.z).normalize();
    } else if (def.targetType === 'point') {
      point = resolveTargetPoint(app.world.physics, app.world.terrain, feet, origin, camDir, def.range);
    }
    const d = dir ? quantDir(dir) : undefined;
    const pt: [number, number, number] | undefined = point ? [Math.round(point.x * POS_SCALE), Math.round(point.y * POS_SCALE), Math.round(point.z * POS_SCALE)] : undefined;
    // What the server will use exactly (quantized), so prediction and authority compute the same thing.
    const qDir = d ? unquant(d) : undefined;
    const qPoint = pt ? { x: pt[0] / POS_SCALE, y: pt[1] / POS_SCALE, z: pt[2] / POS_SCALE } : undefined;
    const cmdSeq = p.predicted && dash && qDir ? app.local.scheduleDash(qDir, dash.distance, dash.duration) : app.local.nextSeq;
    const cast: SentCast = { seq: p.seq, slot, def, dir: qDir, point: qPoint, cmdSeq, predicted: p.predicted };
    this.sent.set(p.seq, cast);
    if (p.predicted) this.presentCast(this.me, def, qDir, qPoint, true, p.seq);
    const msg: AbilityRequestMsg = { s: p.seq, k: slot, a: p.id, c: cmdSeq, ...(d ? { d } : {}), ...(pt ? { p: pt } : {}) };
    if (this.online) app.net?.sendAbility(msg);
    else if (this.solo && this.soloActor) {
      const r = this.solo.request(this.soloActor, { slot, id: p.id, seq: p.seq, cmdSeq, dir: qDir, point: qPoint }, Date.now());
      this.syncSolo();
      this.onResult({ s: p.seq, k: slot, ok: r === AbilityReject.OK, r });
    }
  }

  /** WASD in the camera frame, else where the camera looks (flattened). */
  private moveDirection(camDir: THREE.Vector3): Vec3 {
    const app = this.app;
    const f = app.camera.frame;
    let mx = 0;
    let my = 0;
    if (app.input.isDown('forward')) my += 1;
    if (app.input.isDown('back')) my -= 1;
    if (app.input.isDown('right')) mx += 1;
    if (app.input.isDown('left')) mx -= 1;
    const w = f.forward.clone().multiplyScalar(my).addScaledVector(f.right, mx);
    if (w.lengthSq() < 1e-4) {
      const up = this.tmp.set(app.local.state.pos.x, app.local.state.pos.y, app.local.state.pos.z).normalize();
      w.copy(camDir).addScaledVector(up, -camDir.dot(up));
    }
    w.normalize();
    return { x: w.x, y: w.y, z: w.z };
  }

  /** Solo: mirror the local actor like a SELF status. */
  private syncSolo(): void {
    const a = this.soloActor;
    if (!a) return;
    const n = Date.now();
    const status = statusModifiers(a.runtime, n);
    const passive = passiveModifiers(a.loadout, a.runtime.passive, n, a.vitals.alive);
    const until = (kind: string) => Math.max(0, ...a.runtime.effects.filter((effect) => effect.kind === kind).map((effect) => effect.endsAt));
    this.ctl.applyServer(
      { weapon: 0, ammo: [], reloading: false, reloadEndsAt: 0, alive: true, respawnAt: 0, shotSeq: -1, mana: Math.floor(a.vitals.mana + 1e-6), cd: [...a.cooldownEnds], castUntil: a.castUntil, abilitySeq: -1, slowUntil: a.slowUntil, slow: Math.round(a.slowFactor * 100), wpn: [], res: [], inv: [], useUntil: 0, useItem: -1,
        tempShield: a.vitals.temporaryShield ?? 0, tempShieldUntil: a.vitals.temporaryShieldUntil ?? 0,
        silencedUntil: until('silence'), rootedUntil: until('root'), noSprintUntil: until('noSprint'),
        speed: Math.round(status.speedFactor * 100), airControl: Math.round(passive.airControl * 100), sprintSpeed: Math.round(passive.speed * 100),
        passiveActive: a.loadout.map((id) => ABILITIES[id].kind === 'passive' && a.runtime.passive.active),
      },
      performance.now(),
      n,
      (t) => performance.now() + (t - n),
    );
    this.app.combat.mana = a.vitals.mana;
  }

  // ------------------------------------------------------------------------------------------------ server messages

  onResult(r: AbilityResultMsg): void {
    const app = this.app;
    const res = this.ctl.onResult(r);
    const cast = this.sent.get(r.s);
    this.sent.delete(r.s);
    if (r.ok && cast) {
      const who = this.characterOf(this.me);
      if (who) this.world.onCast(this.me, cast.def, who.character.root, this.serverNow(), cast.dir);
      if (res.late) this.presentCast(this.me, cast.def, cast.dir, cast.point, true, cast.seq);
      // Own telegraphs wait for the server's yes (a refused one would linger on the ground).
      this.telegraph(this.me, cast.def, cast.dir, cast.point, true);
      return;
    }
    if (res.rollback && cast) {
      app.local.cancelDash(cast.cmdSeq);
      this.cancelPredicted(cast.seq);
    }
    const now = performance.now();
    if (now - (this.deniedAt[r.k] ?? -Infinity) < 600) return;
    this.deniedAt[r.k] = now;
    switch (r.r) {
      case AbilityReject.NO_MANA:
        app.hud.abilityDenied(r.k);
        app.hud.manaDenied();
        app.audio.play('ab.denied');
        break;
      case AbilityReject.COOLDOWN:
      case AbilityReject.BUSY:
        app.hud.abilityDenied(r.k);
        app.audio.play('ab.denied');
        break;
      case AbilityReject.OUT_OF_RANGE:
        app.hud.notice('FORA DE ALCANCE', 1.0);
        app.hud.abilityDenied(r.k);
        break;
      case AbilityReject.BLOCKED:
        app.hud.notice('SEM LINHA DE VISÃO', 1.0);
        app.hud.abilityDenied(r.k);
        break;
      case AbilityReject.SILENCED:
        app.hud.abilityDenied(r.k);
        app.audio.play('ab.denied');
        break;
      case AbilityReject.BAD_TARGET:
        app.hud.notice('ALVO INVÁLIDO', 1.0);
        app.hud.abilityDenied(r.k);
        break;
      case AbilityReject.PHASE:
        if (app.combat.phase === MatchPhase.MATCH) app.hud.notice('AGUARDE O INÍCIO', 1.0);
        break;
      case AbilityReject.NOT_OWNED:
        app.hud.notice('HABILIDADE NÃO EQUIPADA', 1.0);
        break;
    }
  }

  onSelf(s: SelfStatusMsg): void {
    const net = this.app.net;
    if (!net) return;
    this.ctl.applyServer(s, performance.now(), net.serverNow(), (t) => this.toLocal(t));
    if (s.abilityMovement) this.app.local.state.abilityMovement = { ...s.abilityMovement, ...(s.abilityMovement.anchor ? { anchor: { ...s.abilityMovement.anchor } } : {}) };
    else delete this.app.local.state.abilityMovement;
  }

  onRoomState(m: RoomStateMsg): void {
    const seen = new Set<number>();
    for (const p of m.players) {
      seen.add(p.index);
      const ult = p.loadout?.[ULTIMATE_SLOT];
      if (p.index === this.me) {
        if (p.loadout?.length) this.ctl.setLoadout(p.loadout);
        if (ult) this.setMark(p.index, ult, this.app.character);
      } else {
        const r = this.app.net?.remote(p.index);
        if (r && ult) this.setMark(p.index, ult, r.character);
      }
    }
    for (const [i, e] of this.marks) {
      if (!seen.has(i)) {
        this.app.vfx.detachMark(e.mark);
        this.marks.delete(i);
        this.remoteFx.delete(i);
      }
    }
  }

  /** Ultimate Mark: which Ultimate a player carries, on every client, for the whole match. */
  private setMark(index: number, ult: string, character: GraaoCharacter): void {
    if (!isAbilityId(ult)) return;
    const id = ABILITIES[ult].presentation.mark;
    const e = this.marks.get(index);
    if (e && e.id === id && e.root === character.root) return;
    if (e) this.app.vfx.detachMark(e.mark);
    if (!id) {
      this.marks.delete(index);
      return;
    }
    this.marks.set(index, { id, root: character.root, mark: this.app.vfx.attachMark(character.root, id) });
  }

  onEvent(e: GameEvent): void {
    const me = this.me;
    switch (e.e) {
      case 'abilityEntity': this.world.onEntity(e.entity); break;
      case 'abilityEntityEnd': this.world.removeEntity(e.id); break;
      case 'cast': {
        if (e.by === me) return; // presented on prediction or on the late acceptance
        if (!isAbilityId(e.a)) return;
        const def = ABILITIES[e.a];
        const dir = e.d ? unquant(e.d) : undefined;
        const point = e.p ? { x: e.p[0] / POS_SCALE, y: e.p[1] / POS_SCALE, z: e.p[2] / POS_SCALE } : undefined;
        this.presentCast(e.by, def, dir, point, false, e.s);
        this.telegraph(e.by, def, dir, point, false);
        const who = this.characterOf(e.by);
        if (who) this.world.onCast(e.by, def, who.character.root, this.serverNow(), dir);
        break;
      }
      case 'proj': {
        if (!isAbilityId(e.a)) return;
        const def = ABILITIES[e.a];
        if (e.by === me) {
          const v = this.projectiles.find((p) => p.mine && p.seq === e.s && p.id < 0);
          if (v) {
            v.id = e.id;
            return;
          }
          const done = this.ended.find((x) => x.seq === e.s && x.id < 0);
          if (done) {
            done.id = e.id;
            return;
          }
        }
        const pe = effectOf(def, 'projectile');
        if (!pe) return;
        const from = mmToV(e.from);
        const vel = { x: e.v[0] / VEL_SCALE, y: e.v[1] / VEL_SCALE, z: e.v[2] / VEL_SCALE };
        this.spawnProjectile(def, { x: from.x, y: from.y, z: from.z }, vel, e.by === me, e.s, e.id);
        break;
      }
      case 'projEnd': {
        const at = mmToV(e.at);
        const v = this.projectiles.find((p) => p.id === e.id);
        if (v) {
          v.end = at;
          v.endHit = e.t;
          v.deadline = v.age + 0.3;
          return;
        }
        const done = this.ended.find((x) => x.id === e.id);
        if (done && done.at.distanceTo(at) < 1.5) return;
        // Not drawn (or ended elsewhere locally): burst where the server says.
        this.impactFx(null, at, e.t);
        break;
      }
      case 'area':
        if (isAbilityId(e.a)) this.areaFx(ABILITIES[e.a], mmToV(e.at), e.r / 100, e.n, e.by);
        break;
      case 'fx':
        this.statusFx(e.target, e.k, e.v, e.by);
        break;
      case 'elim': this.world.removeAttachment(e.target); break;
    }
  }

  // ------------------------------------------------------------------------------------------------ presentation

  private characterOf(index: number): { character: GraaoCharacter; pos: THREE.Vector3 } | null {
    if (index === this.me) {
      const s = this.app.local.state.pos;
      return { character: this.app.character, pos: this.tmp2.set(s.x, s.y, s.z) };
    }
    const r = this.app.net?.remote(index);
    return r ? { character: r.character, pos: r.pos } : null;
  }

  /** Spatial audio for a world point (pan by the camera's right, attenuated, threat bus for enemies). */
  private play(cue: Cue, at: THREE.Vector3 | null, enemy: boolean, volume = 1): void {
    if (!at) {
      this.app.audio.play(cue, { volume });
      return;
    }
    const cam = this.app.r.camera;
    const d = this.tmp.copy(at).sub(cam.position);
    const dist = d.length();
    const pan = dist > 0.01 ? d.dot(this.app.camera.frame.right) / dist : 0;
    this.app.audio.play(cue, { threat: enemy, pan, volume: volume / (1 + dist / 16), muffle: Math.min(0.8, dist / 90) });
  }

  /** BODY + AUDIO of a cast; projectiles leave after the wind-up. */
  private presentCast(by: number, def: AbilityDefinition, dir: Vec3 | undefined, _point: Vec3 | undefined, mine: boolean, seq: number): void {
    const who = this.characterOf(by);
    if (!who) return;
    const anim = who.character.anim;
    const castTime = def.castTime;
    switch (def.presentation.anim) {
      case 'cast':
        anim.playUpper('cast', 1.7);
        break;
      case 'throw':
        anim.playUpper('throw', 1.6);
        break;
      case 'buff':
        anim.playUpper('castEnter', 1.3);
        break;
      case 'dash': {
        const dur = anim.clipDuration('dash');
        anim.playOneShot('dash', { speed: dur > 0 ? Math.min(3, dur / 0.45) : 1 });
        break;
      }
      case 'channel':
        anim.playUpper('castHold', 1, Math.max(0.2, castTime));
        this.timers.push({ at: performance.now() + castTime * 1000, fn: () => who.character.anim.playUpper('cast', 1.6), seq: -1 });
        break;
    }
    const enemy = by !== this.me;
    const at = who.pos.clone();
    this.play(`ab.${def.presentation.cue}` as Cue, mine ? null : at, enemy);
    if (def.slotType === 'ultimate') this.app.camera.addShake(0.25, 0.25);
    // A hand flash for every cast.
    const up = this.tmp.copy(at).normalize();
    const hand = at.clone().addScaledVector(up, 1.35);
    this.app.vfx.burst(hand, up, { color: def.presentation.color2, count: 8, speed: 2.4, size: 0.1, life: 0.35, spread: 1.4, drag: 4, shape: Shape.SPARK });
    // Own projectiles are predicted: they leave the hand when the wind-up ends.
    const pe = effectOf(def, 'projectile');
    if (mine && pe && dir) {
      const launch = () => {
        const from = castOrigin(this.app.local.state.pos, dir);
        this.spawnProjectile(def, from, { x: dir.x * pe.speed, y: dir.y * pe.speed, z: dir.z * pe.speed }, true, seq, -1);
      };
      if (castTime > 0) this.timers.push({ at: performance.now() + castTime * 1000, fn: launch, seq });
      else launch();
    }
    // Areas that follow the caster (gust, cyclone) get an aura of particles for their lifetime.
    const area = def.effects.find((e) => e.kind === 'area') as Extract<AbilityEffect, { kind: 'area' }> | undefined;
    if (area?.follow) this.auras.push({ index: by, def, until: performance.now() + (castTime + area.delay + Math.max(0, area.pulses - 1) * area.interval) * 1000 + 150, acc: 0, seq: mine ? seq : -1 });
  }

  /** WORLD warning everyone sees: ground ring for areas, a lane for charged shots. */
  private telegraph(by: number, def: AbilityDefinition, dir: Vec3 | undefined, point: Vec3 | undefined, mine: boolean): void {
    const vfx = this.app.vfx;
    const area = def.effects.find((e) => e.kind === 'area') as Extract<AbilityEffect, { kind: 'area' }> | undefined;
    const mode = mine ? DecalMode.TELEGRAPH_OWN : DecalMode.TELEGRAPH_ENEMY;
    if (def.presentation.telegraph === 'ring' && area) {
      const center = area.follow ? this.characterOf(by)?.pos : point ? new THREE.Vector3(point.x, point.y, point.z) : null;
      if (!center) return;
      const life = def.castTime + area.delay + Math.max(0, area.pulses - 1) * area.interval;
      if (life > 0.15) vfx.decal(center, area.radius, def.presentation.color, life, mode);
      // An enemy area about to land near me: warning ping (Threat bus).
      const s = this.app.local.state.pos;
      if (!mine && Math.hypot(center.x - s.x, center.y - s.y, center.z - s.z) < area.radius * 1.8) this.app.audio.play('ab.warn', { threat: true });
    } else if (def.presentation.telegraph === 'lane' && dir) {
      const who = this.characterOf(by);
      if (!who) return;
      const from = castOrigin(who.pos, dir);
      const a = new THREE.Vector3(from.x, from.y, from.z);
      const b = a.clone().addScaledVector(new THREE.Vector3(dir.x, dir.y, dir.z), projectileReach(def));
      const hit = this.app.world.physics.castRay(from, dir, projectileReach(def));
      if (hit) b.copy(a).addScaledVector(new THREE.Vector3(dir.x, dir.y, dir.z), hit.toi);
      vfx.trail(a, b, def.presentation.color, mine ? 0.08 : 0.16, Math.max(0.2, def.castTime));
      if (!mine) this.app.audio.play('ab.warn', { threat: true });
    }
  }

  private spawnProjectile(def: AbilityDefinition, from: Vec3, vel: Vec3, mine: boolean, seq: number, id: number): void {
    const pe = effectOf(def, 'projectile')!;
    this.projectiles.push({
      id,
      seq,
      mine,
      def,
      body: { pos: { ...from }, vel: { ...vel }, gravity: pe.gravity, radius: pe.radius, life: pe.lifetime },
      prev: new THREE.Vector3(from.x, from.y, from.z),
      end: null,
      endHit: -1,
      age: 0,
      deadline: pe.lifetime + 0.5,
      sparkle: 0,
    });
  }

  private cancelPredicted(seq: number): void {
    for (let i = this.auras.length - 1; i >= 0; i--) if (this.auras[i]!.seq === seq && this.auras[i]!.index === this.me) this.auras.splice(i, 1);
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]!;
      if (p.mine && p.seq === seq) {
        this.app.vfx.burst(this.tmp.set(p.body.pos.x, p.body.pos.y, p.body.pos.z), this.tmp2.set(0, 1, 0), { color: '#ffffff', count: 6, speed: 1.4, size: 0.1, life: 0.3, drag: 4 });
        this.projectiles.splice(i, 1);
      }
    }
    for (let i = this.timers.length - 1; i >= 0; i--) if (this.timers[i]!.seq === seq) this.timers.splice(i, 1);
  }

  private updateProjectiles(dt: number): void {
    const vfx = this.app.vfx;
    const physics = this.app.world.physics;
    const now = performance.now();
    for (let i = this.ended.length - 1; i >= 0; i--) if (now - this.ended[i]!.t > 2000) this.ended.splice(i, 1);
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]!;
      p.age += dt;
      p.prev.set(p.body.pos.x, p.body.pos.y, p.body.pos.z);
      const pos = this.tmp.set(p.body.pos.x, p.body.pos.y, p.body.pos.z);
      let finished = false;
      let hitAt: THREE.Vector3 | null = null;
      let hitT = -1;
      if (p.end) {
        // The server ended it: race to its end point, then burst there.
        const to = this.tmp2.copy(p.end).sub(pos);
        const dist = to.length();
        const step = Math.max(Math.hypot(p.body.vel.x, p.body.vel.y, p.body.vel.z), 20) * dt * 1.5;
        if (dist <= step || p.age >= p.deadline) {
          pos.copy(p.end);
          finished = true;
          hitAt = p.end;
          hitT = p.endHit;
        } else pos.addScaledVector(to, step / dist);
        p.body.pos.x = pos.x;
        p.body.pos.y = pos.y;
        p.body.pos.z = pos.z;
      } else {
        // Same kinematics as the server; only the world stops a visual (players: wait for the server).
        const r = stepProjectile(physics, p.body, dt, [], -1);
        pos.set(p.body.pos.x, p.body.pos.y, p.body.pos.z);
        if (r.kind === 'world') {
          finished = true;
          hitAt = pos.clone();
          hitT = -1;
        } else if (r.kind === 'expired' || p.age > p.deadline) {
          finished = true;
          hitAt = pos.clone();
          hitT = -2;
        }
      }
      const pr = p.def.presentation;
      const lance = p.def.id === 'dawn_lance';
      vfx.trail(p.prev, pos, pr.color, lance ? 0.34 : 0.13, lance ? 0.3 : 0.24);
      vfx.orb(pos, pr.color, lance ? 0.75 : 0.5, pr.color2);
      p.sparkle += dt;
      if (p.sparkle > 0.04) {
        p.sparkle = 0;
        const shape = p.def.id === 'thorn_seed' ? Shape.PETAL : p.def.id === 'sap_snare' ? Shape.DOT : lance ? Shape.SHARD : Shape.SPARK;
        vfx.burst(pos, this.tmp2.set(p.body.vel.x, p.body.vel.y, p.body.vel.z).normalize().negate(), { color: pr.color, count: 2, speed: 1.2, size: lance ? 0.16 : 0.09, life: 0.35, spread: 0.8, gravity: p.def.id === 'sap_snare' ? 6 : 1, drag: 3, shape });
      }
      if (finished) {
        this.projectiles.splice(i, 1);
        this.ended.push({ id: p.id, seq: p.mine ? p.seq : -1, at: (hitAt ?? pos).clone(), t: now });
        this.impactFx(p.def, hitAt ?? pos, hitT);
      }
    }
  }

  /** WORLD/FX/AUDIO at a projectile's end. */
  private impactFx(def: AbilityDefinition | null, at: THREE.Vector3, target: number): void {
    const vfx = this.app.vfx;
    const up = this.tmp2.copy(at).normalize();
    const color = def?.presentation.color ?? '#ffffff';
    if (target === -2) {
      vfx.burst(at, up, { color, count: 5, speed: 1.2, size: 0.12, life: 0.4, drag: 3 });
      return;
    }
    vfx.flash(at, def?.presentation.color2 ?? '#ffffff', def?.id === 'dawn_lance' ? 1.6 : 0.9, 0.09);
    vfx.burst(at, up, { color, count: def?.id === 'dawn_lance' ? 18 : 10, speed: 4, size: 0.12, life: 0.45, spread: 1.3, gravity: 6, drag: 3, shape: def?.id === 'dawn_lance' ? Shape.SHARD : Shape.SPARK, category: 'GameplayCritical' });
    vfx.ring(at, color, def?.id === 'dawn_lance' ? 2.6 : 1.4, 0.3);
    if (def?.id === 'sap_snare') vfx.decal(at, 1.3, color, 2.2, DecalMode.SPLASH);
    this.play('ab.impact', at, false, 0.9);
  }

  /** WORLD/FX/CAMERA/AUDIO of an area pulse. */
  private areaFx(def: AbilityDefinition, center: THREE.Vector3, radius: number, pulse: number, by: number): void {
    const vfx = this.app.vfx;
    const pr = def.presentation;
    const up = this.tmp2.copy(center).normalize().clone();
    vfx.decal(center, radius, pr.color, def.id === 'sun_meteor' ? 0.7 : 0.5, DecalMode.SHOCKWAVE);
    switch (def.id) {
      case 'sun_meteor': {
        // The fall: a fat beam from the sky, then a big burst and a scorch.
        const sky = center.clone().addScaledVector(up, 28);
        vfx.beam(sky, center, pr.color2, 1.4, 0.32);
        vfx.flash(center, pr.color2, 4.5, 0.18);
        vfx.burst(center, up, { color: pr.color, count: 46, speed: 9, size: 0.22, life: 0.9, spread: 1.4, gravity: 10, drag: 1.8, shape: Shape.SPARK, category: 'GameplayCritical' });
        vfx.burst(center, up, { color: '#fff3c4', count: 18, speed: 4, size: 0.4, life: 0.8, spread: 1.6, gravity: 2, drag: 2, shape: Shape.DOT });
        vfx.decal(center, radius * 0.85, '#7a3d1a', 5, DecalMode.SPLASH);
        this.play('ab.boom', center, by !== this.me, 1.3);
        break;
      }
      case 'pollen_burst':
        vfx.burst(center, up, { color: pr.color, count: 30, speed: 4.5, size: 0.16, life: 0.9, spread: 1.5, gravity: 2, drag: 2.5, shape: Shape.DOT });
        vfx.burst(center, up, { color: pr.color2, count: 12, speed: 2, size: 0.3, life: 1.2, spread: 1.6, gravity: 0.5, drag: 2, shape: Shape.DOT, category: 'Environment' });
        vfx.decal(center, radius * 0.9, pr.color, 2.5, DecalMode.SPLASH);
        this.play('ab.area', center, by !== this.me);
        break;
      case 'thorn_seed':
        vfx.burst(center, up, { color: pr.color, count: 22, speed: 7, size: 0.16, life: 0.55, spread: 1.4, gravity: 9, drag: 2, shape: Shape.SHARD, category: 'GameplayCritical' });
        vfx.decal(center, radius * 0.7, '#5e8a3a', 2.5, DecalMode.SPLASH);
        this.play('ab.area', center, by !== this.me);
        break;
      case 'gust_ring':
        vfx.burst(center.clone().addScaledVector(up, 0.8), up, { color: pr.color, count: 28, speed: 10, size: 0.14, life: 0.45, spread: Math.PI / 2, drag: 4, shape: Shape.SPARK, category: 'GameplayCritical' });
        this.play('ab.area', center, by !== this.me, 0.8);
        break;
      case 'petal_cyclone':
        vfx.burst(center.clone().addScaledVector(up, 1), up, { color: pulse % 2 ? pr.color2 : pr.color, count: 22, speed: 7, size: 0.18, life: 0.55, spread: Math.PI / 2, drag: 3, shape: Shape.PETAL, category: 'GameplayCritical' });
        this.play('ab.area', center, by !== this.me, 0.6);
        break;
      default:
        vfx.burst(center, up, { color: pr.color, count: 16, speed: 5, size: 0.14, life: 0.5, spread: 1.4, gravity: 6, drag: 2.5 });
        this.play('ab.area', center, by !== this.me);
    }
    // CAMERA: the closer the blast, the stronger the shake.
    const s = this.app.local.state.pos;
    const d = Math.hypot(center.x - s.x, center.y - s.y, center.z - s.z);
    if (d < radius * 2.5) this.app.camera.addShake((def.slotType === 'ultimate' ? 0.9 : 0.4) * (1 - d / (radius * 2.5)), 0.3);
  }

  /** Status effects landing on someone (shield, heal, slow, knockback, dash). */
  private statusFx(target: number, k: StatusFx, v: number, by: number): void {
    const vfx = this.app.vfx;
    const who = this.characterOf(target);
    if (!who) return;
    const up = this.tmp2.copy(who.pos).normalize().clone();
    const chest = who.pos.clone().addScaledVector(up, 1.0);
    const enemyCaster = by !== this.me;
    switch (k) {
      case 'shield':
        vfx.ring(chest, '#7fc4ff', 2.0, 0.45);
        vfx.burst(chest, up, { color: '#9fd4ff', count: 16, speed: 3, size: 0.13, life: 0.7, spread: 1.2, gravity: -2, drag: 2.5, shape: Shape.SHARD, category: 'GameplayCritical' });
        vfx.burst(chest, up, { color: '#8fd46e', count: 8, speed: 2.2, size: 0.14, life: 0.8, spread: 1.4, gravity: -1, drag: 2, shape: Shape.PETAL });
        this.play('ab.shield', target === this.me ? null : chest, false);
        break;
      case 'heal':
        vfx.decal(who.pos, 1.6, '#8fd46e', 1.6, DecalMode.SPLASH);
        vfx.burst(who.pos.clone().addScaledVector(up, 0.2), up, { color: '#f7c6d8', count: 18, speed: 2.6, size: 0.15, life: 1.0, spread: 0.9, gravity: -1.5, drag: 2, shape: Shape.PETAL, category: 'GameplayCritical' });
        this.play('ab.heal', target === this.me ? null : chest, false);
        break;
      case 'slow': {
        vfx.burst(chest, up, { color: '#e09a3c', count: 10, speed: 2, size: 0.14, life: 0.6, spread: 1.6, gravity: 8, drag: 2, shape: Shape.DOT, category: 'GameplayCritical' });
        if (target !== this.me) this.fxOf(target).slowUntil = performance.now() + v;
        break;
      }
      case 'knock':
        vfx.burst(chest, up, { color: '#ffffff', count: 14, speed: 6, size: 0.12, life: 0.4, spread: 1.6, drag: 4, shape: Shape.SPARK, category: 'GameplayCritical' });
        if (target === this.me) this.app.camera.addShake(1.0, 0.35);
        break;
      case 'dash':
        if (target !== this.me) {
          const f = this.fxOf(target);
          f.dashUntil = performance.now() + v + 80;
          f.prev.copy(who.pos);
          this.play('ab.dash', who.pos, enemyCaster, 0.8);
        }
        break;
    }
  }

  private fxOf(index: number) {
    let f = this.remoteFx.get(index);
    if (!f) {
      f = { slowUntil: 0, dashUntil: 0, prev: new THREE.Vector3(), acc: 0 };
      this.remoteFx.set(index, f);
    }
    return f;
  }

  private updateAuras(dt: number, now: number): void {
    const vfx = this.app.vfx;
    for (let i = this.auras.length - 1; i >= 0; i--) {
      const a = this.auras[i]!;
      if (now > a.until) {
        this.auras.splice(i, 1);
        continue;
      }
      a.acc += dt;
      if (a.acc < 0.05) continue;
      a.acc = 0;
      const who = this.characterOf(a.index);
      if (!who) continue;
      const up = this.tmp2.copy(who.pos).normalize().clone();
      const t = now / 1000;
      // Petals (or wind) circling the caster: the area moves with them.
      const area = a.def.effects.find((e) => e.kind === 'area') as Extract<AbilityEffect, { kind: 'area' }>;
      const side = new THREE.Vector3(1, 0, 0).cross(up).normalize();
      const fwd = side.clone().cross(up).normalize();
      for (let k = 0; k < 3; k++) {
        const ang = t * 5 + (k / 3) * Math.PI * 2;
        const p = who.pos.clone().addScaledVector(up, 0.8 + k * 0.25).addScaledVector(side, Math.cos(ang) * area.radius * 0.8).addScaledVector(fwd, Math.sin(ang) * area.radius * 0.8);
        const tangent = side.clone().multiplyScalar(-Math.sin(ang)).addScaledVector(fwd, Math.cos(ang));
        vfx.burst(p, tangent, { color: k % 2 ? a.def.presentation.color2 : a.def.presentation.color, count: 1, speed: 6, size: 0.2, life: 0.35, spread: 0.2, drag: 2, shape: a.def.id === 'petal_cyclone' ? Shape.PETAL : Shape.SPARK, category: 'GameplayCritical' });
      }
    }
  }

  /** Dash streaks and slow drips (local predicted state; remotes from their fx events). */
  private updateStatusFx(dt: number, now: number): void {
    const vfx = this.app.vfx;
    const s = this.app.local.state;
    const cur = this.tmp.set(s.pos.x, s.pos.y, s.pos.z);
    const up = this.tmp2.copy(cur).normalize().clone();
    this.selfFxAcc += dt;
    if (s.dashSteps > 0 && this.lastLocal.lengthSq() > 0) {
      vfx.trail(this.lastLocal.clone().addScaledVector(up, 1.0), cur.clone().addScaledVector(up, 1.0), '#e6fbf4', 0.5, 0.28);
      vfx.burst(cur.clone().addScaledVector(up, 0.6), up, { color: '#bfeee0', count: 2, speed: 1.5, size: 0.12, life: 0.3, drag: 3, shape: Shape.SPARK });
    }
    if (now < this.ctl.slowEnd && this.selfFxAcc > 0.15) {
      this.selfFxAcc = 0;
      vfx.burst(cur.clone().addScaledVector(up, 0.4), up, { color: '#e09a3c', count: 2, speed: 0.6, size: 0.1, life: 0.6, gravity: 6, drag: 2, shape: Shape.DOT });
    }
    this.lastLocal.copy(cur);
    for (const [index, f] of this.remoteFx) {
      const r = this.app.net?.remote(index);
      if (!r) continue;
      const rup = r.pos.clone().normalize();
      f.acc += dt;
      if (now < f.dashUntil) {
        vfx.trail(f.prev.clone().addScaledVector(rup, 1.0), r.pos.clone().addScaledVector(rup, 1.0), '#e6fbf4', 0.5, 0.28);
      }
      if (now < f.slowUntil && f.acc > 0.15) {
        f.acc = 0;
        vfx.burst(r.pos.clone().addScaledVector(rup, 0.4), rup, { color: '#e09a3c', count: 2, speed: 0.6, size: 0.1, life: 0.6, gravity: 6, drag: 2, shape: Shape.DOT });
      }
      f.prev.copy(r.pos);
    }
  }

  // ------------------------------------------------------------------------------------------------ HUD

  private updateHud(now: number): void {
    const hud = this.app.hud;
    const alive = this.app.combat.alive;
    const fight = this.canFight();
    const mana = this.ctl.manaShown;
    const casting = this.ctl.casting(now);
    const slots: AbilitySlotView[] = this.ctl.loadout.map((id: AbilityId, i) => {
      const def = ABILITIES[id];
      const left = this.ctl.cooldownLeft(i, now);
      const state: AbilitySlotView['state'] = !alive ? 'disabled' : def.kind === 'passive' ? 'passive' : !fight ? 'disabled'
        : now < this.ctl.silencedEnd && !def.tags.includes('cleanse') ? 'silenced'
          : now < this.ctl.blockedEnd && !def.tags.includes('cleanse') ? 'blocked'
            : this.ctl.targetState(i, now) ?? (casting && i === this.ctl.castSlot ? 'casting' : left > 0 ? 'cooldown' : mana < def.manaCost ? 'nomana' : 'ready');
      return { key: keyLabel(this.app.input.keyFor(ACTIONS[i]!)), name: def.name, description: def.blurb, kind: def.kind, active: alive && this.ctl.passiveActive[i], icon: def.presentation.icon, color: def.presentation.color, cost: def.manaCost, ultimate: i === ULTIMATE_SLOT, cd: this.ctl.cooldownFrac(i, now), secondsLeft: left, state };
    });
    hud.setAbilities(slots);
    hud.setEffects(Math.max(0, (this.ctl.slowEnd - now) / 1000), this.ctl.slowFactor);
    hud.setAbilityStatus(Math.max(0, (this.ctl.silencedEnd - now) / 1000), now < this.ctl.temporaryShieldEnd ? this.ctl.temporaryShield : 0);
    // Ultimate charged (cooldown over, alive, allowed to fight — never announced aboard the UFO or mid-drop):
    // URGENT once, then the HUD settles to RELEVANT/QUIET.
    const ult = this.ctl.loadout[ULTIMATE_SLOT]!;
    const ready = alive && fight && now >= this.ctl.silencedEnd && now >= this.ctl.blockedEnd && this.ctl.cooldownLeft(ULTIMATE_SLOT, now) <= 0;
    if (this.ultKnown && ready && !this.ultWasReady) {
      hud.ultimateReady(ABILITIES[ult].name);
      this.app.audio.play('ult.ready');
    }
    this.ultWasReady = ready;
    this.ultKnown = this.ultKnown || this.ctl.cooldownLeft(ULTIMATE_SLOT, now) > 0;
  }

  /** F3: live ability visuals. */
  stats(): string {
    return `${this.projectiles.length} projéteis · ${this.auras.length} auras · ${this.marks.size} marcas · ${this.world.stats()}`;
  }
}
