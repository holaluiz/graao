/**
 * CreepDirector (client): draws and animates the creeps from the server's snapshots (10 Hz) and events, and presents
 * everything about them — the telegraph before a blow, the blow, getting hurt, the defeat — plus their health bars,
 * the "!" when one notices you and damage numbers for your own hits. It never decides gameplay: positions, states,
 * health, damage and XP are the server's.
 *
 * Each creep is a body and two limbs on pivots (creepGeometry.ts) with its own GRAStylized material (ink outline, a
 * rim light used for hit flashes, wind-up glow and the elite's runes). Motion is procedural on top of the
 * interpolated position: breathing, waddling, the wind-up lean, the lunge, squash on hits, crumbling on defeat.
 * The visual root never moves anything authoritative (no root motion).
 */
import * as THREE from 'three';
import { CREEPS, CREEP_TYPE_IDS, type CreepTypeDef, type CreepTypeId } from '@graao/game-data';
import type { MeleeBody, PlayerHitTarget } from '@graao/game-core';
import { CREEP_TARGET_BASE, CreepStateCode, FACING_SCALE, HitKind, POS_SCALE, type CreepSnap, type GameEvent } from '@graao/shared';
import type { GraaoApp } from '../app/GraaoApp';
import { createStylizedMaterial } from '../render/materials/GRAStylizedMaterial';
import { DecalMode, Shape } from '../render/vfx/GRAVFXSystem';
import { creepModel } from '../world/creepGeometry';

/** Render this far behind the server clock (two 10 Hz samples plus jitter). */
const RENDER_DELAY_MS = 190;
/** Bars and marks only within this distance (m). */
const BAR_RANGE = 28;
/** Creeps are drawn up to this distance (m); beyond it they are hidden (the planet is small: rarely needed). */
const DRAW_RANGE = 90;

interface Sample {
  t: number;
  pos: THREE.Vector3;
  facing: THREE.Vector3;
}

interface CreepVis {
  id: number;
  type: CreepTypeId;
  def: CreepTypeDef;
  samples: Sample[];
  state: CreepStateCode;
  health: number;
  target: number;
  root: THREE.Group;
  body: THREE.Mesh;
  armL: THREE.Mesh;
  armR: THREE.Mesh;
  pivotL: THREE.Group;
  pivotR: THREE.Group;
  mat: THREE.ShaderMaterial;
  height: number;
  /** Rendered feet and facing. */
  pos: THREE.Vector3;
  facing: THREE.Vector3;
  speed: number;
  phase: number;
  hitT: number;
  windStart: number;
  windUntil: number;
  windArea: boolean;
  strikeT: number;
  deadT: number;
  dead: boolean;
  spawnT: number;
  alertT: number;
  seenAt: number;
  bar: HTMLElement | null;
  barFill: HTMLElement | null;
}

export class CreepDirector {
  private readonly group = new THREE.Group();
  private readonly creeps = new Map<number, CreepVis>();
  private readonly bars: HTMLElement;
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly tmp3 = new THREE.Vector3();
  private readonly m4 = new THREE.Matrix4();
  private time = 0;

  constructor(private readonly app: GraaoApp) {
    this.group.name = 'creeps';
    app.r.scene.add(this.group);
    this.bars = document.createElement('div');
    this.bars.className = 'creep-bars';
    app.hud.el.appendChild(this.bars);
  }

  /** Everything gone (leaving a room, a new match). */
  reset(): void {
    for (const c of this.creeps.values()) this.remove(c);
    this.creeps.clear();
  }

  get count(): number {
    return this.creeps.size;
  }

  // ------------------------------------------------------------------------------------------------ queries

  /** Creep hit targets at their rendered positions (cosmetic shot prediction). */
  hitTargets(): PlayerHitTarget[] {
    const out: PlayerHitTarget[] = [];
    for (const c of this.creeps.values()) if (!c.dead) out.push({ index: CREEP_TARGET_BASE + c.id, feet: { x: c.pos.x, y: c.pos.y, z: c.pos.z }, alive: true, box: c.def.hitbox });
    return out;
  }

  meleeBodies(): MeleeBody[] {
    const out: MeleeBody[] = [];
    for (const c of this.creeps.values()) if (!c.dead) out.push({ id: c.id, creep: true, feet: { x: c.pos.x, y: c.pos.y, z: c.pos.z }, alive: true, ...c.def.hitbox });
    return out;
  }

  /** Rendered feet of creep `id` (damage direction), or undefined. */
  position(id: number): THREE.Vector3 | undefined {
    return this.creeps.get(id)?.pos;
  }

  typeOf(id: number): CreepTypeDef | undefined {
    return this.creeps.get(id)?.def;
  }

  // ------------------------------------------------------------------------------------------------ network

  onSnapshot(t: number, list: CreepSnap[]): void {
    const seen = new Set<number>();
    for (const s of list) {
      const [id, ty, px, py, pz, fx, fy, fz, state, health, target] = s;
      const type = CREEP_TYPE_IDS[ty];
      if (!type) continue;
      seen.add(id);
      let c = this.creeps.get(id);
      if (!c) c = this.create(id, type, new THREE.Vector3(px / POS_SCALE, py / POS_SCALE, pz / POS_SCALE));
      const facing = new THREE.Vector3(fx / FACING_SCALE, fy / FACING_SCALE, fz / FACING_SCALE).normalize();
      c.samples.push({ t, pos: new THREE.Vector3(px / POS_SCALE, py / POS_SCALE, pz / POS_SCALE), facing });
      if (c.samples.length > 6) c.samples.shift();
      if (state === CreepStateCode.ALERT && c.state !== CreepStateCode.ALERT) c.alertT = this.time;
      if (state === CreepStateCode.DEAD && !c.dead) this.die(c, -1);
      c.state = state as CreepStateCode;
      c.health = health;
      c.target = target;
      c.seenAt = this.time;
    }
    // Gone from the snapshots (removed by the server): drop it after its defeat has played.
    for (const c of this.creeps.values()) if (!seen.has(c.id) && (!c.dead || this.time - c.deadT > 1.2)) this.dropLater(c);
  }

  private dropLater(c: CreepVis): void {
    if (this.time - c.seenAt > 0.6) {
      this.remove(c);
      this.creeps.delete(c.id);
    }
  }

  onEvent(e: GameEvent): void {
    const me = this.app.net?.myIndex ?? -1;
    switch (e.e) {
      case 'creepSpawn': {
        const type = CREEP_TYPE_IDS[e.ty];
        if (!type) break;
        const at = new THREE.Vector3(e.at[0] / POS_SCALE, e.at[1] / POS_SCALE, e.at[2] / POS_SCALE);
        const c = this.creeps.get(e.id) ?? this.create(e.id, type, at);
        c.spawnT = this.time;
        if (this.near(at, 40)) {
          const up = this.tmp.copy(at).normalize();
          this.app.vfx.burst(this.tmp2.copy(at).addScaledVector(up, 0.2), up, { color: c.def.look.accent, count: 10, speed: 2.4, size: 0.14, life: 0.6, gravity: 5, drag: 2, spread: 1.3, shape: Shape.DOT, category: 'Environment' });
        }
        break;
      }
      case 'creepAtk': {
        const c = this.creeps.get(e.id);
        if (!c) break;
        const atk = c.def.attacks[e.k] ?? c.def.attacks[0]!;
        if (e.ph === 0) {
          c.windStart = this.time;
          c.windUntil = this.time + atk.windupMs / 1000;
          c.windArea = !!atk.area;
          // The telegraph: a red decal where the blow will land (around it for a slam, in front for a swing).
          const up = this.tmp.copy(c.pos).normalize();
          const center = atk.area ? this.tmp2.copy(c.pos) : this.tmp2.copy(c.pos).addScaledVector(c.facing, Math.min(atk.range, c.def.radius + atk.range * 0.5));
          center.addScaledVector(up, 0.02);
          this.app.vfx.decal(center, atk.area ? atk.range : Math.max(0.9, atk.range * 0.6), atk.area ? '#ff6b4a' : '#ff9b5a', atk.windupMs / 1000 + 0.15, DecalMode.TELEGRAPH_ENEMY);
          if (this.near(c.pos, 30)) {
            const s = this.spatial(c.pos);
            this.app.audio.play('creep.windup', { threat: true, pan: s.pan, volume: (e.t === me ? 1 : 0.7) / (1 + s.dist / 10), pitch: c.def.tier === 'elite' ? 0.7 : c.def.tier === 'tough' ? 0.8 : c.def.tier === 'agile' ? 1.4 : 1.1 });
          }
        } else {
          c.windUntil = 0;
          c.strikeT = this.time;
          const up = this.tmp.copy(c.pos).normalize();
          const at = atk.area ? this.tmp2.copy(c.pos) : this.tmp2.copy(c.pos).addScaledVector(c.facing, c.def.radius + atk.range * 0.5);
          at.addScaledVector(up, 0.1);
          this.app.vfx.burst(at, up, { color: c.def.look.body, count: atk.area ? 18 : 7, speed: atk.area ? 4.5 : 2.4, size: 0.16, life: 0.5, gravity: 7, drag: 2, spread: atk.area ? 1.5 : 1.0, shape: Shape.DOT, category: 'CombatBurst' });
          if (atk.area) this.app.vfx.ring(at, '#ffd3a0', atk.range * 2, 0.4);
        }
        break;
      }
      case 'creepHit': {
        const c = this.creeps.get(e.id);
        if (!c) break;
        c.health = e.health;
        if (e.amount <= 0) {
          // Walking home after a chase: immune (a faint shimmer says so).
          if (e.by === me) this.app.hud.notice('IMUNE · VOLTANDO PARA CASA', 0.8);
          break;
        }
        c.hitT = this.time;
        const up = this.tmp.copy(c.pos).normalize();
        const chest = this.tmp2.copy(c.pos).addScaledVector(up, c.def.hitbox.top * 0.55);
        this.app.vfx.burst(chest, up, { color: c.def.look.accent, count: e.m ? 8 : 5, speed: 2.8, size: 0.11, life: 0.35, gravity: 6, drag: 3, spread: 1.3, shape: c.type === 'besouro' || c.type === 'guardiao' ? Shape.SHARD : Shape.DOT, category: 'GameplayCritical' });
        if (e.by === me) {
          this.app.hud.hit([e.health <= 0 ? HitKind.ELIMINATION : HitKind.BODY, ...(e.a ? [HitKind.ABILITY] : [])]);
          this.app.audio.play(e.m ? 'melee.hit' : 'creep.hit', { pitch: c.def.tier === 'elite' ? 0.75 : c.def.tier === 'tough' ? 0.85 : 1.05 });
          const head = this.tmp3.copy(c.pos).addScaledVector(up, c.height + 0.35).project(this.app.r.camera);
          if (head.z < 1) this.app.hud.damageNumber(((head.x + 1) / 2) * window.innerWidth, ((1 - head.y) / 2) * window.innerHeight, e.amount, e.a ? [HitKind.BODY, HitKind.ABILITY] : [HitKind.BODY]);
        } else if (this.near(c.pos, 25)) {
          const s = this.spatial(c.pos);
          this.app.audio.play('creep.hit', { pan: s.pan, volume: 0.6 / (1 + s.dist / 8) });
        }
        break;
      }
      case 'creepDie': {
        const c = this.creeps.get(e.id);
        if (c && !c.dead) this.die(c, e.by);
        break;
      }
    }
  }

  private die(c: CreepVis, by: number): void {
    c.dead = true;
    c.deadT = this.time;
    c.windUntil = 0;
    const up = this.tmp.copy(c.pos).normalize();
    const at = this.tmp2.copy(c.pos).addScaledVector(up, c.def.hitbox.top * 0.5);
    const me = this.app.net?.myIndex ?? -1;
    if (by < 0) {
      // Dissolved by the Tormenta (no XP): it fades into grey dust.
      this.app.vfx.burst(at, up, { color: '#cfcac0', count: 14, speed: 1.6, size: 0.16, life: 1.0, gravity: -0.8, drag: 1.5, spread: 1.6, shape: Shape.DOT, category: 'Environment' });
      return;
    }
    this.app.vfx.ring(at, c.def.look.glow ?? '#ffe8a8', c.def.tier === 'elite' ? 3.2 : 2.2, 0.5);
    this.app.vfx.burst(at, up, { color: c.def.look.body, count: c.def.tier === 'elite' ? 26 : 16, speed: 4, size: 0.18, life: 0.8, gravity: 8, drag: 2, spread: 1.4, shape: Shape.DOT, category: 'GameplayCritical' });
    this.app.vfx.burst(at, up, { color: c.def.look.accent, count: 10, speed: 3, size: 0.14, life: 0.9, gravity: 6, drag: 2, spread: 1.5, shape: Shape.SHARD, category: 'GameplayCritical' });
    if (by === me || this.near(c.pos, 25)) {
      const s = this.spatial(c.pos);
      this.app.audio.play('creep.die', { pan: by === me ? 0 : s.pan, volume: by === me ? 1 : 0.6 / (1 + s.dist / 10), pitch: c.def.tier === 'elite' ? 0.7 : 1 });
    }
    if (by === me) this.app.hud.feed('Você', c.def.name, 'killer');
  }

  // ------------------------------------------------------------------------------------------------ views

  private create(id: number, type: CreepTypeId, at: THREE.Vector3): CreepVis {
    const def = CREEPS[type];
    const model = creepModel(type);
    const mat = createStylizedMaterial({ variant: 'world', vertexColors: true, pigment: 0.04, tormenta: false });
    if (def.look.glow) {
      mat.uniforms.uRimColor!.value = new THREE.Color(def.look.glow);
      mat.uniforms.uRim!.value = 0.35;
    }
    const root = new THREE.Group();
    const body = new THREE.Mesh(model.body, mat);
    const pivotL = new THREE.Group();
    const pivotR = new THREE.Group();
    pivotL.position.copy(model.pivotL);
    pivotR.position.copy(model.pivotR);
    const armL = new THREE.Mesh(model.armL, mat);
    const armR = new THREE.Mesh(model.armR, mat);
    pivotL.add(armL);
    pivotR.add(armR);
    const visual = new THREE.Group();
    visual.name = 'visual';
    visual.add(body, pivotL, pivotR);
    visual.scale.setScalar(def.look.scale);
    root.add(visual);
    for (const m of [body, armL, armR]) m.frustumCulled = true;
    this.group.add(root);
    const up = at.clone().normalize();
    const facing = new THREE.Vector3(0, 1, 0).projectOnPlane(up).normalize();
    const c: CreepVis = {
      id, type, def, samples: [], state: CreepStateCode.IDLE, health: def.health, target: -1, root, body, armL, armR, pivotL, pivotR, mat,
      height: model.height * def.look.scale, pos: at.clone(), facing: facing.lengthSq() > 0.5 ? facing : new THREE.Vector3(1, 0, 0), speed: 0,
      phase: (id * 1.37) % 6.28, hitT: -10, windStart: -10, windUntil: 0, windArea: false, strikeT: -10, deadT: 0, dead: false, spawnT: this.time, alertT: -10, seenAt: this.time, bar: null, barFill: null,
    };
    this.creeps.set(id, c);
    return c;
  }

  private remove(c: CreepVis): void {
    this.group.remove(c.root);
    c.mat.dispose();
    c.bar?.remove();
  }

  /** Interpolated feet and facing at the render time. */
  private sample(c: CreepVis, t: number): void {
    const s = c.samples;
    if (!s.length) return;
    let a = s[0]!;
    let b = s[s.length - 1]!;
    for (let i = 0; i < s.length - 1; i++) {
      if (s[i]!.t <= t && s[i + 1]!.t >= t) {
        a = s[i]!;
        b = s[i + 1]!;
        break;
      }
    }
    const span = b.t - a.t;
    const k = span > 0 ? THREE.MathUtils.clamp((t - a.t) / span, 0, 1) : 1;
    const before = this.tmp3.copy(c.pos);
    c.pos.lerpVectors(a.pos, b.pos, k);
    c.facing.lerpVectors(a.facing, b.facing, k);
    const up = this.tmp.copy(c.pos).normalize();
    c.facing.projectOnPlane(up);
    if (c.facing.lengthSq() < 1e-6) c.facing.set(0, 1, 0).projectOnPlane(up);
    c.facing.normalize();
    c.speed = THREE.MathUtils.lerp(c.speed, before.distanceTo(c.pos) / Math.max(1e-3, this.lastDt), 0.25);
  }

  private lastDt = 1 / 60;

  update(dt: number): void {
    this.time += dt;
    this.lastDt = dt;
    if (!this.creeps.size) return;
    const now = (this.app.net ? this.app.net.serverNow() : Date.now()) - RENDER_DELAY_MS;
    const cam = this.app.r.camera;
    const eye = cam.position;
    for (const c of [...this.creeps.values()]) {
      if (!c.dead || this.time - c.deadT < 0.1) this.sample(c, now);
      const far = c.pos.distanceTo(eye) > DRAW_RANGE;
      c.root.visible = !far && !(c.dead && this.time - c.deadT > 1.1);
      if (c.root.visible) this.animate(c, dt);
      this.updateBar(c, eye);
      // Bodies that the server removed while we were away from the snapshots.
      if (this.time - c.seenAt > 3) {
        this.remove(c);
        this.creeps.delete(c.id);
      }
    }
  }

  private animate(c: CreepVis, dt: number): void {
    const up = this.tmp.copy(c.pos).normalize();
    const x = this.tmp2.crossVectors(up, c.facing).normalize();
    this.m4.makeBasis(x, up, c.facing);
    c.root.quaternion.setFromRotationMatrix(this.m4);
    c.root.position.copy(c.pos);
    const visual = c.root.children[0]!;
    const t = this.time;
    const moving = c.speed > 0.25 && !c.dead;
    c.phase += dt * (moving ? 6 + c.speed * 2.2 : 2.2);
    // Base pose: breathing, then the waddle while walking.
    let sy = 1 + Math.sin(c.phase) * (moving ? 0.03 : 0.025);
    let sxz = 1 - (sy - 1) * 0.6;
    let lean = 0;
    let roll = moving ? Math.sin(c.phase) * 0.12 : 0;
    let bob = moving ? Math.abs(Math.sin(c.phase)) * 0.06 : 0;
    let armL = moving ? Math.sin(c.phase) * 0.6 : Math.sin(c.phase * 0.5) * 0.08;
    let armR = -armL;
    let lunge = 0;
    // Spawn: pops out of the ground.
    const sp = THREE.MathUtils.clamp((t - c.spawnT) / 0.45, 0, 1);
    const spawnScale = sp < 1 ? 0.3 + 0.7 * (1 - Math.pow(1 - sp, 3)) * (1 + Math.sin(sp * Math.PI) * 0.15) : 1;
    // Alert: a little hop.
    const al = t - c.alertT;
    if (al < 0.5) bob += Math.sin((al / 0.5) * Math.PI) * 0.18;
    // Wind-up: leans back, arms raised, the rim glows hotter as the blow comes.
    let rim = c.def.look.glow ? 0.35 : 0;
    let rimColor = c.def.look.glow ?? '#ffffff';
    if (c.windUntil > t) {
      const w = THREE.MathUtils.clamp((t - c.windStart) / Math.max(0.05, c.windUntil - c.windStart), 0, 1);
      lean = -0.32 * w;
      armL = armR = -2.2 * w;
      if (c.windArea) {
        armL = armR = -2.8 * w;
        sy *= 1 + 0.12 * w;
      }
      rim = 0.6 + 0.8 * w * (0.7 + 0.3 * Math.sin(t * 30));
      rimColor = '#ff7a3a';
      roll = 0;
    }
    // The blow: a lunge forward and the arms crashing down, settling over the recovery.
    const st = t - c.strikeT;
    if (st < 0.5) {
      const k = st < 0.08 ? st / 0.08 : Math.max(0, 1 - (st - 0.08) / 0.42);
      lunge = 0.28 * k;
      lean = 0.3 * k;
      // Arms crash down in front (rotation about X: negative swings a hanging limb forward).
      armL = armR = -0.9 * k;
    }
    // Hit: squash and a white flash.
    const ht = t - c.hitT;
    if (ht < 0.22) {
      const k = 1 - ht / 0.22;
      sy *= 1 - 0.18 * k;
      sxz *= 1 + 0.14 * k;
      rim = Math.max(rim, 1.6 * k);
      rimColor = '#ffffff';
    }
    // Defeat: crumbles down and sinks.
    if (c.dead) {
      const k = THREE.MathUtils.clamp((t - c.deadT) / 0.9, 0, 1);
      sy *= 1 - 0.85 * k;
      sxz *= 1 + 0.35 * k;
      bob -= 0.2 * k;
      armL = armR = -0.4 * k;
    }
    // Walking home (immune): a calm, upright gait.
    if (c.state === CreepStateCode.RETURN) rim = Math.max(rim, 0.25 + 0.15 * Math.sin(t * 6));
    const s = c.def.look.scale * spawnScale;
    visual.scale.set(s * sxz, s * sy, s * sxz);
    visual.position.set(0, bob, lunge);
    visual.rotation.set(lean, 0, roll);
    c.pivotL.rotation.x = armL;
    c.pivotR.rotation.x = armR;
    c.mat.uniforms.uRim!.value = rim;
    (c.mat.uniforms.uRimColor!.value as THREE.Color).set(rimColor);
  }

  private updateBar(c: CreepVis, eye: THREE.Vector3): void {
    const me = this.app.net?.myIndex ?? -1;
    const d = c.pos.distanceTo(eye);
    const hurt = c.health < c.def.health;
    const show = !c.dead && c.root.visible && d < BAR_RANGE && (hurt || c.target === me || c.def.tier === 'elite' || this.time - c.alertT < 1.2);
    if (!show) {
      if (c.bar) c.bar.hidden = true;
      return;
    }
    if (!c.bar) {
      c.bar = document.createElement('div');
      c.bar.className = `creep-bar tier-${c.def.tier}`;
      const name = document.createElement('div');
      name.className = 'creep-name';
      name.textContent = c.def.tier === 'elite' ? `★ ${c.def.name}` : c.def.name;
      const track = document.createElement('div');
      track.className = 'creep-track';
      c.barFill = document.createElement('i');
      track.appendChild(c.barFill);
      const alert = document.createElement('div');
      alert.className = 'creep-alert';
      alert.textContent = '!';
      c.bar.append(alert, name, track);
      this.bars.appendChild(c.bar);
    }
    const up = this.tmp.copy(c.pos).normalize();
    const p = this.tmp2.copy(c.pos).addScaledVector(up, c.height + 0.25).project(this.app.r.camera);
    if (p.z >= 1 || Math.abs(p.x) > 1.2 || Math.abs(p.y) > 1.2) {
      c.bar.hidden = true;
      return;
    }
    c.bar.hidden = false;
    c.bar.style.transform = `translate(${(((p.x + 1) / 2) * window.innerWidth).toFixed(1)}px, ${(((1 - p.y) / 2) * window.innerHeight).toFixed(1)}px) translate(-50%, -100%) scale(${THREE.MathUtils.clamp(14 / Math.max(6, d), 0.6, 1.1).toFixed(2)})`;
    c.barFill!.style.width = `${Math.max(0, Math.min(1, c.health / c.def.health)) * 100}%`;
    c.bar.classList.toggle('alert', this.time - c.alertT < 0.9 || c.state === CreepStateCode.ALERT);
    c.bar.classList.toggle('me', c.target === me && !c.dead);
    c.bar.classList.toggle('home', c.state === CreepStateCode.RETURN);
  }

  private near(p: THREE.Vector3, range: number): boolean {
    return p.distanceTo(this.app.r.camera.position) < range;
  }

  private spatial(p: THREE.Vector3): { pan: number; dist: number } {
    const cam = this.app.r.camera;
    const d = this.tmp3.copy(p).sub(cam.position);
    const dist = d.length();
    const right = this.app.camera.frame.right;
    return { pan: dist > 0.01 ? d.dot(right) / dist : 0, dist };
  }
}
