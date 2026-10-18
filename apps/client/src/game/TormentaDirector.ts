/**
 * TormentaDirector (client): presents the Tormenta. The server owns it (phases, who is outside, every point of damage);
 * this mirrors the published phase (ROOM_STATE `tormenta`) and evaluates the boundary at the server clock with the
 * same shared function the server tests with, so what is drawn is where the damage starts. Nothing is decided here.
 *
 * Response stack:
 *   WORLD   the shared Tormenta uniforms every world material reads (inside: untouched; across the boundary the colour
 *           drains in torn patches; outside: a pale sketch of the world), chalk dashes where the next region ends,
 *           the torn paper curtain standing on the boundary, paler and closer fog and a washed sky inside it
 *   FX      light paper flakes lifting off the boundary near the player; pigment peeling off whoever is outside
 *   AUDIO   INSIDE_TORMENTA (ambience ducked and dulled, the fight stays clear), the drone, a discreet warning 10 s
 *           before a reduction, the last-seconds tick, the reduction starting, entering and leaving, damage pulses
 *   UI      the Tormenta card, the planet map (safe region, Tormenta, next region around the player), the way back
 *           (arrow + metres), the pigment-loss edge, banners on phase changes
 */
import * as THREE from 'three';
import { tormentaCircleAt, tormentaEdgeMeters, tormentaInside, tormentaProgress, tormentaStage, tormentaTarget, type TormentaCircle, type TormentaStage } from '@graao/game-core';
import { PLANET, TORMENTA } from '@graao/game-data';
import { MatchPhase, v3, type RoomStateMsg, type TormentaMsg } from '@graao/shared';
import type { GraaoApp } from '../app/GraaoApp';
import type { TormentaMapView } from '../ui/TormentaMap';
import { TORMENTA_UNIFORMS } from '../render/materials/GRAStylizedMaterial';
import { TormentaCurtain } from '../render/TormentaCurtain';
import { Shape } from '../render/vfx/GRAVFXSystem';

/** Metres into the Tormenta at which the screen edge and the ambience reach their deepest. */
const DEPTH_FULL_M = 14;
const FLAKE_COLORS = ['#f4f0e8', '#e2ddd3', '#cfc8bc'];

export class TormentaDirector {
  readonly curtain = new TormentaCurtain();
  private msg: TormentaMsg | null = null;
  /** 0..1 global fade of the whole presentation (in at the match start, out at the results). */
  private on = 0;
  private time = 0;
  private readonly circle: TormentaCircle = { center: v3(), radius: Math.PI };
  private readonly next: TormentaCircle = { center: v3(), radius: Math.PI };
  private stage: TormentaStage = 'hold';
  /** The local player is outside the safe region (predicted position; the server's damage confirms it). */
  outside = false;
  /** Metres from the boundary (outside > 0). */
  edge = -Infinity;
  /** 0..1 how deep the local player is in it. */
  depth = 0;
  /** 0..1 the camera is in it (atmosphere). */
  private camDepth = 0;
  private lastSecond = -1;
  private warned = false;
  private flakeT = 0;
  private peelT = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly axis = new THREE.Vector3();
  private readonly mapUp = new THREE.Vector3();
  private readonly mapView: TormentaMapView;

  constructor(private readonly app: GraaoApp) {
    app.r.scene.add(this.curtain.mesh);
    const f = app.camera.frame;
    this.mapView = { up: this.mapUp, forward: f.forward, right: f.right, safe: this.circle, next: this.next };
  }

  /** How loud the outdoor bed may be (birds and wind fade the deeper the player is in the Tormenta). */
  get ambience(): number {
    return 1 - 0.85 * this.depth;
  }

  /** The current phase (null outside a match). */
  get phase(): TormentaMsg | null {
    return this.msg;
  }

  // ------------------------------------------------------------------------------------------------ server

  onRoomState(m: RoomStateMsg): void {
    const prev = this.msg;
    this.msg = m.phase === MatchPhase.MATCH ? (m.tormenta ?? null) : null;
    const t = this.msg;
    if (!t) return;
    tormentaTarget(t, this.next);
    if (prev && prev.k === t.k && prev.t0 === t.t0) return;
    this.warned = false;
    this.lastSecond = -1;
    // The first phase arrives with the match itself (its countdown banners speak then); later phases get their own.
    if (!prev) return;
    const hud = this.app.hud;
    if (t.k > t.n) {
      hud.banner('ÁREA FINAL', 'A Tormenta não recua mais · fique dentro da área', 2.4, 'bad');
      this.app.audio.play('tormenta.final');
    } else {
      hud.banner(`TORMENTA · FASE ${t.k} DE ${t.n}`, 'Nova área marcada no chão com traços brancos', 2.2);
      this.app.audio.play('tormenta.warn', { volume: 0.7 });
    }
  }

  /** The server took Health from the local player (dmg event with `c: 'tormenta'`). */
  onHurt(amount: number): void {
    const app = this.app;
    app.hud.tormentaHurt(amount);
    app.audio.play('tormenta.hurt', { volume: 0.85 });
    app.camera.addShake(0.12, 0.18);
    this.peel(app.local.state.pos, 7);
  }

  reset(): void {
    this.msg = null;
    this.on = 0;
    this.outside = false;
    this.depth = 0;
    this.camDepth = 0;
    this.edge = -Infinity;
    TORMENTA_UNIFORMS.uTormOn.value.x = 0;
    this.app.r.tormenta = 0;
    this.app.hud.setTormenta(null);
    this.app.audio.setLoop('tormenta', 0);
  }

  // ------------------------------------------------------------------------------------------------ frame

  /** Per frame, after the local player and the camera moved. */
  update(dt: number): void {
    const app = this.app;
    this.time += dt;
    const m = app.phase === 'MATCH' ? this.msg : null;
    this.on = THREE.MathUtils.damp(this.on, m ? 1 : 0, 2.5, dt);
    const u = TORMENTA_UNIFORMS;
    u.uTormOn.value.set(this.on < 0.002 ? 0 : this.on, this.time, PLANET.radius);
    if (!m) {
      // The match is over: the HUD and the sound state go at once; the world gets its colour back over a moment.
      this.outside = false;
      app.hud.setTormenta(null);
      app.r.tormenta = this.camDepth = THREE.MathUtils.damp(this.camDepth, 0, 3, dt);
      this.depth = THREE.MathUtils.damp(this.depth, 0, 3, dt);
      app.audio.setLoop('tormenta', 0);
      this.curtain.update();
      return;
    }
    const now = app.net ? app.net.serverNow() : Date.now();
    tormentaCircleAt(m, now, this.circle);
    this.stage = tormentaStage(m, now);
    const c = this.circle.center;
    // While the whole planet is safe the region is pushed past the antipode, so no shader ever finds an edge.
    u.uTorm.value.set(c.x, c.y, c.z, this.circle.radius >= Math.PI - 1e-4 ? Math.PI + 0.2 : this.circle.radius);
    const n = this.next.center;
    u.uTormNext.value.set(n.x, n.y, n.z, this.stage === 'hold' && this.next.radius < this.circle.radius - 1e-6 ? this.next.radius : -1);
    this.curtain.update();

    // The local player, at its predicted position (the same test the server runs on the authoritative one).
    const combat = app.combat;
    const fighting = combat.inMatch && combat.alive && !app.deploy.riding;
    const pos = app.local.state.pos;
    this.edge = tormentaEdgeMeters(this.circle, pos);
    const nextEdge = tormentaEdgeMeters(this.next, pos);
    const wasOutside = this.outside;
    this.outside = fighting && this.edge > 0;
    this.depth = THREE.MathUtils.damp(this.depth, this.outside ? THREE.MathUtils.clamp(0.25 + this.edge / DEPTH_FULL_M, 0, 1) : 0, 4, dt);
    // The atmosphere follows the camera (a spectator sees it too).
    const camEdge = tormentaEdgeMeters(this.circle, app.r.camera.position);
    this.camDepth = THREE.MathUtils.damp(this.camDepth, THREE.MathUtils.clamp((camEdge + 1) / 9, 0, 1) * this.on, 3, dt);
    app.r.tormenta = this.camDepth;
    if (this.outside !== wasOutside && fighting) app.audio.play(this.outside ? 'tormenta.enter' : 'tormenta.exit', { volume: 0.8 });
    app.audio.setLoop('tormenta', this.depth * 0.9 + (this.stage === 'shrink' ? 0.08 : 0));

    // The clock: hold → reduction starts at `a`; shrink → ends at `b`.
    const seconds = this.stage === 'final' ? -1 : ((this.stage === 'hold' ? m.a : m.b) - now) / 1000;
    if (this.stage === 'hold' && m.k <= m.n) this.countdown(seconds, m);
    else if (this.stage === 'shrink' && this.lastSecond !== -2) {
      this.lastSecond = -2;
      if (now - m.a < 1500) {
        app.audio.play('tormenta.shrink', { volume: 0.8 });
        app.hud.banner('A TORMENTA AVANÇA', tormentaInside(this.next, pos) ? 'Você já está na próxima área' : 'Corra para a área marcada', 1.8, 'bad');
      }
    }
    const holdLen = Math.max(1, m.a - m.t0);
    const progress = this.stage === 'hold' ? THREE.MathUtils.clamp((now - m.t0) / holdLen, 0, 1) : tormentaProgress(m, now);
    app.hud.setTormenta({
      stage: this.stage,
      phase: Math.min(m.k, m.n + 1),
      phases: m.n,
      seconds,
      progress,
      dps: Math.round((m.dmg * 1000) / Math.max(1, m.every)),
      guide: fighting,
      outside: this.outside,
      edge: this.edge,
      nextEdge,
      arrow: this.arrowToward(this.outside ? this.circle : this.next),
      depth: this.depth,
      map: fighting ? this.mapFor(pos) : null,
    });
    this.particles(dt, pos);
  }

  /** The discreet warning 10 s before a reduction, then a tick for each of the last 5 seconds (rising). */
  private countdown(seconds: number, m: TormentaMsg): void {
    const app = this.app;
    if (!this.warned && seconds <= TORMENTA.warnMs / 1000 && seconds > 1) {
      this.warned = true;
      app.audio.play('tormenta.warn', { volume: 0.75 });
      if (this.app.combat.alive) app.hud.notice(`A TORMENTA AVANÇA EM ${Math.ceil(seconds)} s`, 1.8);
    }
    const s = Math.ceil(seconds);
    if (s !== this.lastSecond && s >= 1 && s <= 5 && m.a > m.t0) {
      this.lastSecond = s;
      app.audio.play('tormenta.tick', { pitch: 1 + (5 - s) * 0.09, volume: 0.45 + (5 - s) * 0.1 });
    }
  }

  /** The planet map's input this frame (shared objects: the circles and the camera frame are read in place). */
  private mapFor(pos: { x: number; y: number; z: number }): TormentaMapView {
    this.mapUp.set(pos.x, pos.y, pos.z).normalize();
    this.mapView.next = this.stage === 'final' ? null : this.next;
    return this.mapView;
  }

  /** Screen angle (rad) toward the region's centre along the planet: 0 = straight ahead, + to the right. */
  private arrowToward(region: TormentaCircle): number {
    const f = this.app.camera.frame;
    const p = this.app.local.state.pos;
    const up = this.tmp.set(p.x, p.y, p.z).normalize();
    const c = region.center;
    // The great circle toward the centre leaves along the centre's projection on the tangent plane.
    const t = this.tmp2.set(c.x, c.y, c.z).addScaledVector(up, -(c.x * up.x + c.y * up.y + c.z * up.z));
    if (t.lengthSq() < 1e-10) return 0;
    return Math.atan2(t.dot(f.right), t.dot(f.forward));
  }

  // ------------------------------------------------------------------------------------------------ fx

  /** Light flakes off the boundary near the player, and pigment peeling off whoever is outside. */
  private particles(dt: number, pos: { x: number; y: number; z: number }): void {
    const app = this.app;
    const r = this.circle.radius;
    if (this.on < 0.5 || r >= Math.PI - 0.02) return;
    const vfx = app.vfx;
    // Boundary flakes: only when the boundary is within reach of the eye.
    if (Math.abs(this.edge) < 38) {
      this.flakeT -= dt;
      while (this.flakeT <= 0) {
        this.flakeT += 0.07;
        const c = this.circle.center;
        const up = this.tmp.set(pos.x, pos.y, pos.z).normalize();
        // The boundary point closest to the player, then slid along the boundary by up to ±26 m.
        const cv = this.axis.set(c.x, c.y, c.z);
        const toward = this.tmp2.copy(up).addScaledVector(cv, -up.dot(cv));
        if (toward.lengthSq() < 1e-8) break;
        toward.normalize();
        const at = this.tmp2.copy(cv).multiplyScalar(Math.cos(r)).addScaledVector(toward, Math.sin(r));
        const along = ((Math.random() * 2 - 1) * 26) / (PLANET.radius * Math.max(0.05, Math.sin(r)));
        at.applyAxisAngle(cv, along).normalize();
        const ground = app.world.terrain.surfaceAt({ x: at.x, y: at.y, z: at.z });
        const p = this.tmp.set(ground.x, ground.y, ground.z).addScaledVector(at, 0.2 + Math.random() * 3.2);
        if (p.distanceToSquared(app.r.camera.position) > 44 * 44) continue;
        vfx.burst(p, at, {
          color: FLAKE_COLORS[Math.floor(Math.random() * FLAKE_COLORS.length)]!,
          count: 1,
          speed: 0.7,
          size: 0.14,
          life: 2.4,
          gravity: -0.45,
          drag: 0.9,
          spread: 1.2,
          shape: Math.random() < 0.5 ? Shape.SHARD : Shape.PETAL,
          category: 'Environment',
        });
      }
    }
    // Pigment peeling off characters outside (the local one by prediction, remotes by the server's flag).
    this.peelT -= dt;
    if (this.peelT > 0) return;
    this.peelT = 0.16;
    if (this.outside) this.peel(pos, 2);
    for (const rp of app.net?.remotePlayers ?? []) {
      if (rp.inTormenta && rp.alive && rp.pos.distanceToSquared(app.r.camera.position) < 40 * 40) this.peel(rp.pos, 1);
    }
  }

  private peel(feet: { x: number; y: number; z: number }, count: number): void {
    const up = this.tmp.set(feet.x, feet.y, feet.z).normalize();
    const chest = this.tmp2.set(feet.x, feet.y, feet.z).addScaledVector(up, 0.7 + Math.random() * 0.8);
    this.app.vfx.burst(chest, up, { color: FLAKE_COLORS[0]!, count, speed: 1.4, size: 0.12, life: 1.3, gravity: -0.8, drag: 1.6, spread: 1.4, shape: Shape.SHARD, category: 'Environment' });
  }

  /** F3 overlay. */
  stats(): string {
    const m = this.msg;
    if (!m) return '-';
    return `fase ${Math.min(m.k, m.n + 1)}/${m.n} ${this.stage} · raio ${((this.circle.radius * 180) / Math.PI).toFixed(1)}° · borda ${Number.isFinite(this.edge) ? this.edge.toFixed(1) : '-'} m${this.outside ? ' · FORA' : ''}`;
  }
}
