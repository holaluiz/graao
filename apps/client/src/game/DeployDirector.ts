/**
 * DeployDirector (client): presents the UFO deployment and turns the jump key into UFO_JUMP. The server owns the
 * route, the jump time and the exact state every dive starts from; this only derives the ship's position from the
 * route and presents the ritual:
 *
 *   reveal  the planet from afar, the ship's dotted route and the landmarks named; then the camera joins the ship
 *   ship    an orbit camera around the UFO (mouse), the hatch countdown and the window bar; ESPAÇO jumps
 *   dive    the shared controller predicts the skydive (WASD steer, Shift head-first); wind, speed lines, a trail
 *   landed  a landing response, then waiting for the others (the fight starts once everyone is down)
 *
 * Solo play runs the same ritual offline on a local route (the jump is applied directly).
 * Response stack: BODY (skydive pose, flare, landing) · WORLD (ship, beam, route) · FX (trail, dust, splash) ·
 * CAMERA (reveal, orbit, dive pitch + FOV, landing impulse) · AUDIO (hum, hatch, wind, thud) · UI (deploy panel).
 */
import * as THREE from 'three';
import { diveStart, jumpOpen, landedInWater, latLonToDir, makeUfoRoute, routeFrame, ufoHeading, ufoPosition, waterDepth, type DiveStart } from '@graao/game-core';
import { PLANET, REGIONS } from '@graao/game-data';
import { DeployState, MatchPhase, POS_SCALE, type GameEvent, type RoomStateMsg, type UfoRouteMsg } from '@graao/shared';
import type { GraaoApp } from '../app/GraaoApp';
import { SpeedLines } from '../render/SpeedLines';
import { DecalMode, Shape } from '../render/vfx/GRAVFXSystem';
import { UfoModel } from '../world/UfoModel';
import { UfoRoutePath } from '../world/UfoRoutePath';

export type DeployMode = 'none' | 'reveal' | 'ship' | 'dive' | 'landed';

/** Seconds the camera takes to swoop from the far view onto the ship at the end of the reveal. */
const SWOOP_MS = 1800;
/** The ship stays in the sky this long after the window closes, flying off along its route (ms). */
const LINGER_MS = 9000;

const ease = (k: number) => k * k * (3 - 2 * k);

export class DeployDirector {
  readonly ufo = new UfoModel();
  private readonly path: UfoRoutePath;
  private readonly speed: SpeedLines;
  private readonly labels = document.createElement('div');
  private readonly labelEls: { el: HTMLElement; dir: THREE.Vector3; pos: THREE.Vector3 }[] = [];
  mode: DeployMode = 'none';
  private route: UfoRouteMsg | null = null;
  private offline = false;
  private phase: MatchPhase = MatchPhase.FREE_ROAM;
  private players: RoomStateMsg['players'] = [];
  private jumpAskedAt = -1e9;
  private wasOpen = false;
  private shipYaw = 0;
  private shipPitch = 0.55;
  private blend: { pos: THREE.Vector3; quat: THREE.Quaternion; t: number; dur: number } | null = null;
  private landedAt = 0;
  private trailTimer = 0;
  private readonly lastTrail = new Map<number, THREE.Vector3>();
  /** Height above whatever is below the local diver (m). */
  groundDist = 0;
  /** The point the frame focuses on while riding (ground under the camera's interest): sun, grass, place names. */
  readonly focus = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly tmp3 = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();

  constructor(private readonly app: GraaoApp) {
    this.path = new UfoRoutePath(app.world);
    this.speed = new SpeedLines(app.r.quality);
    this.ufo.visible = false;
    app.r.scene.add(this.ufo.root, this.path.points, this.speed.mesh);
    this.labels.className = 'landmarks';
    this.labels.hidden = true;
    for (const r of REGIONS) {
      const el = document.createElement('div');
      el.className = 'landmark';
      el.textContent = r.name;
      this.labels.appendChild(el);
      const d = latLonToDir(r.lat, r.lon);
      const dir = new THREE.Vector3(d.x, d.y, d.z);
      const g = app.world.terrain.surfaceAt(dir);
      this.labelEls.push({ el, dir, pos: new THREE.Vector3(g.x, g.y, g.z).addScaledVector(dir, 6) });
    }
    document.getElementById('ui')!.appendChild(this.labels);
  }

  /** Aboard (reveal or ship): the local player is not simulated and the camera belongs to the ride. */
  get riding(): boolean {
    return this.mode === 'reveal' || this.mode === 'ship';
  }

  get diving(): boolean {
    return this.mode === 'dive';
  }

  private now(): number {
    return this.app.net ? this.app.net.serverNow() : Date.now();
  }

  private get myIndex(): number {
    return this.app.net?.myIndex ?? 0;
  }

  // ------------------------------------------------------------------------------------------------ flow

  /** Online: phase, route and everyone's deploy state. */
  onRoomState(m: RoomStateMsg): void {
    this.phase = m.phase;
    this.players = m.players;
    if (m.ufo) {
      this.route = m.ufo;
      this.offline = false;
      this.path.setRoute(m.ufo);
    }
    const me = m.players.find((p) => p.index === this.myIndex);
    if (m.phase === MatchPhase.UFO && me?.deploy === DeployState.SHIP && !this.riding) this.board();
    // The fight started (everyone down), or the room went back to warmup: the deployment is over for us.
    else if ((m.phase === MatchPhase.MATCH || m.phase === MatchPhase.FREE_ROAM) && this.mode !== 'none') this.finish();
  }

  /** Solo: the same ritual on a local route (shorter reveal), no server involved. */
  startOffline(): void {
    this.offline = true;
    this.route = makeUfoRoute(Math.random, Date.now(), { revealMs: 3400 });
    this.path.setRoute(this.route);
    this.board();
  }

  /** Leaving the world (menu, disconnect): drop everything. */
  reset(): void {
    if (this.mode !== 'none') this.finish();
    this.route = null;
    this.offline = false;
    this.ufo.visible = false;
  }

  private board(): void {
    const app = this.app;
    const r = this.route;
    if (!r) return;
    this.mode = this.now() < r.open - SWOOP_MS * 0.5 ? 'reveal' : 'ship';
    this.shipYaw = 0;
    this.shipPitch = 0.55;
    this.wasOpen = false;
    this.jumpAskedAt = -1e9;
    this.blend = null;
    app.character.root.visible = false;
    app.hud.setMode('ufo');
    app.audio.setState('UFO');
    if (this.mode === 'reveal') paperWipe();
  }

  private requestJump(): void {
    const r = this.route;
    if (!r) return;
    const now = this.now();
    if (!jumpOpen(r, now)) {
      if (now < r.open) this.app.hud.notice(`A ESCOTILHA ABRE EM ${Math.max(1, Math.ceil((r.open - now) / 1000))} S`, 1.1);
      return;
    }
    if (this.offline) {
      this.beginDive(diveStart(r, now));
      return;
    }
    if (performance.now() - this.jumpAskedAt < 600) return;
    this.jumpAskedAt = performance.now();
    this.app.net?.sendUfoJump();
    this.app.audio.play('ui.click');
  }

  /** Out of the hatch: the local player starts predicting the dive from the server's exact start state. */
  private beginDive(d: DiveStart, auto = false): void {
    const app = this.app;
    const cam = app.r.camera;
    this.blend = { pos: cam.position.clone(), quat: cam.quaternion.clone(), t: 0, dur: 0.7 };
    app.local.teleport(d.pos, d.facing);
    app.local.state.vel = { ...d.vel };
    app.local.state.diving = true;
    const feet = this.tmp.set(d.pos.x, d.pos.y, d.pos.z);
    app.camera.reset(feet, this.tmp2.set(d.facing.x, d.facing.y, d.facing.z));
    app.camera.pitch = -0.72;
    app.character.root.visible = true;
    this.mode = 'dive';
    this.lastTrail.delete(this.myIndex);
    app.hud.setMode('drop');
    app.audio.setState('NORMAL');
    app.audio.play('ufo.jump');
    this.puff(feet, '#fff3d6', 6);
    if (auto) app.hud.notice('SALTO AUTOMÁTICO', 1.4);
  }

  private onLanded(at: THREE.Vector3, water: boolean): void {
    const app = this.app;
    this.mode = 'landed';
    this.landedAt = performance.now();
    app.hud.setMode('combat');
    app.camera.addShake(0.6, 0.3);
    this.landingFx(at, water, true);
  }

  private finish(): void {
    const app = this.app;
    this.mode = 'none';
    this.blend = null;
    app.character.root.visible = true;
    app.hud.setMode('combat');
    app.hud.setDeploy(null);
    app.camera.fovBoost = 0;
    app.audio.setLoop('wind', 0);
    app.audio.setLoop('hum', 0);
    if (app.audio.state === 'UFO') app.audio.setState('NORMAL');
    this.labels.hidden = true;
    this.speed.update(0, app.r.camera, this.vel.set(0, 0, 0), 0);
  }

  // ------------------------------------------------------------------------------------------------ events

  onEvent(e: Extract<GameEvent, { e: 'jump' } | { e: 'land' }>): void {
    const app = this.app;
    const at = new THREE.Vector3(e.at[0] / POS_SCALE, e.at[1] / POS_SCALE, e.at[2] / POS_SCALE);
    if (e.e === 'jump') {
      if (e.target === this.myIndex) {
        if (this.mode === 'dive' || this.mode === 'landed') return;
        const vel = { x: e.v[0] / 100, y: e.v[1] / 100, z: e.v[2] / 100 };
        const v3 = new THREE.Vector3(vel.x, vel.y, vel.z);
        const up = at.clone().normalize();
        const facing = v3.clone().addScaledVector(up, -v3.dot(up)).normalize();
        this.beginDive({ pos: { x: at.x, y: at.y, z: at.z }, vel, facing: { x: facing.x, y: facing.y, z: facing.z } }, e.auto);
      } else {
        // Someone else left the ship: their samples start over from the hatch.
        app.net?.remote(e.target)?.onRespawn();
        this.lastTrail.delete(e.target);
        this.puff(at, '#fff3d6', 8);
        const { pan, dist } = this.spatial(at);
        app.audio.play('ufo.jump', { pan, volume: 0.5 / (1 + dist / 30), muffle: Math.min(0.8, dist / 120) });
      }
    } else if (e.target === this.myIndex) {
      // Normally predicted already; a landing the server forced (stuck diver) is presented here.
      if (this.mode === 'dive') this.onLanded(at, e.water);
    } else {
      this.lastTrail.delete(e.target);
      this.landingFx(at, e.water, false);
    }
  }

  private landingFx(at: THREE.Vector3, water: boolean, mine: boolean): void {
    const app = this.app;
    const vfx = app.vfx;
    const up = this.tmp3.copy(at).normalize();
    if (water) app.water.splash(at, 1);
    else {
      vfx.ring(at.clone().addScaledVector(up, 0.15), '#f6e7c8', 3.6, 0.5);
      vfx.burst(at, up, { color: '#e8d4b0', count: 16, speed: 3.6, size: 0.42, life: 0.9, gravity: 2.5, drag: 3, spread: 1.45, shape: Shape.DOT });
    }
    vfx.decal(at, 1.8, '#f3e2bd', 0.7, DecalMode.SHOCKWAVE);
    if (mine) app.audio.play(water ? 'land.water' : 'land');
    else {
      // An opponent touching down is information: on the threat bus, panned and attenuated.
      const { pan, dist } = this.spatial(at);
      app.audio.play(water ? 'land.water' : 'land', { threat: true, pan, volume: 1 / (1 + dist / 18), muffle: Math.min(0.85, dist / 80) });
    }
  }

  private puff(at: THREE.Vector3, color: string, count: number): void {
    this.app.vfx.burst(at, this.tmp3.copy(at).normalize().negate(), { color, count, speed: 2.4, size: 0.3, life: 0.55, drag: 2.5, spread: 1.2, shape: Shape.DOT, category: 'DeploymentTrail' });
  }

  private spatial(p: THREE.Vector3): { pan: number; dist: number } {
    const cam = this.app.r.camera;
    const d = this.tmp2.copy(p).sub(cam.position);
    const dist = d.length();
    const right = this.tmp3.set(1, 0, 0).applyQuaternion(cam.quaternion);
    return { pan: dist > 0.01 ? d.dot(right) / dist : 0, dist };
  }

  // ------------------------------------------------------------------------------------------------ per frame

  /** While riding: the reveal and orbit cameras (instead of the third-person camera). Call before `update`. */
  rideCamera(dt: number, look: { yaw: number; pitch: number }): void {
    const r = this.route;
    if (!r) return;
    const cam = this.app.r.camera;
    const now = this.now();
    const ship = ufoPosition(r, now, this.tmp);
    const head = ufoHeading(r, now);
    const up = this.tmp2.copy(ship).normalize();
    const fwd = new THREE.Vector3(head.x, head.y, head.z);
    const side = new THREE.Vector3().crossVectors(up, fwd).normalize();
    this.shipYaw += look.yaw;
    this.shipPitch = THREE.MathUtils.clamp(this.shipPitch - look.pitch, 0.05, 1.25);
    const dist = 19;
    const orbit = fwd
      .clone()
      .multiplyScalar(-Math.cos(this.shipYaw))
      .addScaledVector(side, Math.sin(this.shipYaw))
      .multiplyScalar(Math.cos(this.shipPitch))
      .addScaledVector(up, Math.sin(this.shipPitch));
    const shipPos = new THREE.Vector3().copy(ship).addScaledVector(orbit, dist);
    // Look past the ship at the ground ahead: the planet below fills the lower half of the frame.
    const shipTarget = new THREE.Vector3().copy(ship).addScaledVector(up, -17).addScaledVector(fwd, 8);
    let pos = shipPos;
    let target = shipTarget;
    let camUp = up.clone();
    let fov = 62;
    if (this.mode === 'reveal') {
      // Far view beside the orbit plane, above the drop zone, drifting slowly; then a swoop onto the ship.
      const f = routeFrame(r);
      const c = new THREE.Vector3(f.c.x, f.c.y, f.c.z);
      const n = new THREE.Vector3(f.n.x, f.n.y, f.n.z);
      const h = new THREE.Vector3(f.h.x, f.h.y, f.h.z);
      const far = c.clone().multiplyScalar(0.8).addScaledVector(n, 0.5).addScaledVector(h, -0.25).normalize();
      far.applyAxisAngle(c, (now - r.t0) * 0.00003).multiplyScalar(500);
      const farTarget = c.clone().multiplyScalar(28);
      const reveal = Math.max(1, r.open - r.t0);
      const k = ease(THREE.MathUtils.clamp((now - r.t0 - (reveal - SWOOP_MS)) / SWOOP_MS, 0, 1));
      pos = far.lerp(shipPos, k);
      target = farTarget.lerp(shipTarget, k);
      camUp = n.lerp(up, k).normalize();
      fov = THREE.MathUtils.lerp(46, 62, k);
      if (now >= r.open) this.mode = 'ship';
    }
    cam.position.copy(pos);
    cam.up.copy(camUp);
    cam.lookAt(target);
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    // Focus: the ground under where the view is looking (sun, grass, place names).
    const g = this.app.world.terrain.surfaceAt(target.clone().normalize());
    this.focus.set(g.x, g.y, g.z);
    void dt;
  }

  /** Every frame in the world (after the camera and the combat director). */
  update(dt: number): void {
    const app = this.app;
    const r = this.route;
    const now = this.now();
    // The ship: flying while the deployment runs, then off along its route for a few seconds.
    const shipVisible = !!r && now < r.close + LINGER_MS && (this.mode !== 'none' || this.phase === MatchPhase.UFO || this.phase === MatchPhase.MATCH);
    this.ufo.visible = shipVisible;
    if (r && shipVisible) {
      const open = jumpOpen(r, now) && (this.riding || this.phase === MatchPhase.UFO);
      this.ufo.update(dt, ufoPosition(r, now), ufoHeading(r, now), open);
    }
    this.path.update(now, this.riding ? 1 : 0, app.r.renderer.getPixelRatio());

    if (this.riding && r) {
      app.audio.setLoop('hum', 0.8);
      if (app.input.consume('jump')) this.requestJump();
      const open = jumpOpen(r, now);
      if (open && !this.wasOpen) {
        this.wasOpen = true;
        app.audio.play('ufo.open');
      }
      // Solo: nobody drops us when the window closes, so do it here.
      if (this.offline && now >= r.close) this.beginDive(diveStart(r, r.close), true);
    } else app.audio.setLoop('hum', 0);

    if (this.mode === 'dive') this.updateDive(dt);
    else {
      app.audio.setLoop('wind', 0);
      this.speed.update(dt, app.r.camera, this.vel.set(0, 0, 0), 0);
      app.camera.fovBoost = THREE.MathUtils.damp(app.camera.fovBoost, 0, 4, dt);
    }
    if (this.mode === 'landed' && this.offline && performance.now() - this.landedAt > 1800) this.finish();

    this.updateRemoteTrails(dt);
    this.applyBlend(dt);
    this.updateLabels();
    this.updateHud(now);
  }

  private updateDive(dt: number): void {
    const app = this.app;
    const s = app.local.state;
    const pos = this.tmp.set(s.pos.x, s.pos.y, s.pos.z);
    const up = this.tmp2.copy(pos).normalize();
    const hit = app.world.physics.castRay({ x: pos.x + up.x * 0.3, y: pos.y + up.y * 0.3, z: pos.z + up.z * 0.3 }, { x: -up.x, y: -up.y, z: -up.z }, 400);
    this.groundDist = hit ? Math.max(0, hit.toi - 0.3) : Math.max(0, pos.length() - (PLANET.radius + app.world.terrain.heightAt(up)));
    // Over a lake the dive ends at the surface, not on the bed.
    this.groundDist = Math.min(this.groundDist, Math.max(0, -waterDepth(pos)));
    this.vel.set(s.vel.x, s.vel.y, s.vel.z);
    const speed = this.vel.length();
    const fall = Math.max(0, -this.vel.dot(up));
    app.camera.fovBoost = THREE.MathUtils.damp(app.camera.fovBoost, THREE.MathUtils.clamp(fall / 38, 0, 1) * 12, 3, dt);
    // Over the last metres the view levels out toward a playable framing (never pushes the other way).
    const level = THREE.MathUtils.lerp(-0.2, -0.72, THREE.MathUtils.smoothstep(this.groundDist, 6, 30));
    if (app.camera.pitch < level) app.camera.pitch = THREE.MathUtils.damp(app.camera.pitch, level, 5, dt);
    this.speed.update(dt, app.r.camera, this.vel, THREE.MathUtils.clamp((speed - 8) / 22, 0, 1));
    app.audio.setLoop('wind', THREE.MathUtils.clamp(speed / 30, 0.15, 1), THREE.MathUtils.clamp(fall / 38, 0, 1));
    this.trail(this.myIndex, pos, dt);
    if (!s.diving) this.onLanded(pos.clone(), landedInWater(app.world.terrain, pos));
  }

  /** Pigment puffs and a pale ribbon behind a diver (opponents read where someone is landing). */
  private trail(index: number, feet: THREE.Vector3, dt: number): void {
    const up = this.tmp3.copy(feet).normalize();
    const body = feet.clone().addScaledVector(up, 0.9);
    const last = this.lastTrail.get(index);
    if (last && last.distanceToSquared(body) < 400) this.app.vfx.trail(last, body, '#ffe7b8', 0.1, 0.55);
    this.lastTrail.set(index, body);
    this.trailTimer += dt;
    if (this.trailTimer > 0.06) {
      this.trailTimer = 0;
      this.app.vfx.burst(body, up, { color: '#f7dcae', count: 1, speed: 0.6, size: 0.26, life: 0.8, drag: 1.5, spread: 0.9, shape: Shape.PETAL, category: 'DeploymentTrail' });
    }
  }

  private updateRemoteTrails(dt: number): void {
    const net = this.app.net;
    if (!net) return;
    for (const p of this.players) {
      if (p.index === this.myIndex) continue;
      const rp = net.remote(p.index);
      if (rp?.diving) this.trail(p.index, rp.pos, dt);
    }
  }

  /** Smooth cut from the ride camera to the dive camera (the third-person camera has already placed itself). */
  private applyBlend(dt: number): void {
    const b = this.blend;
    if (!b) return;
    b.t = Math.min(1, b.t + dt / b.dur);
    const k = ease(b.t);
    const cam = this.app.r.camera;
    cam.position.lerpVectors(b.pos, cam.position, k);
    cam.quaternion.slerpQuaternions(b.quat, cam.quaternion, k);
    if (b.t >= 1) this.blend = null;
  }

  /** Landmark names over the planet while riding (only those facing the camera). */
  private updateLabels(): void {
    const on = this.riding;
    this.labels.hidden = !on;
    if (!on) return;
    const cam = this.app.r.camera;
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const l of this.labelEls) {
      const toCam = this.tmp3.copy(cam.position).sub(l.pos);
      const dist = toCam.length();
      const facing = toCam.divideScalar(dist).dot(l.dir);
      let visible = facing > 0.2 && dist > 25;
      let x = 0;
      let y = 0;
      if (visible) {
        const p = this.tmp2.copy(l.pos).project(cam);
        visible = p.z < 1 && Math.abs(p.x) < 1.05 && Math.abs(p.y) < 1.05;
        x = ((p.x + 1) / 2) * w;
        y = ((1 - p.y) / 2) * h;
      }
      l.el.style.display = visible ? 'block' : 'none';
      if (visible) {
        l.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
        l.el.style.opacity = String(THREE.MathUtils.clamp((facing - 0.2) * 4, 0, 1));
      }
    }
  }

  private updateHud(now: number): void {
    const hud = this.app.hud;
    const r = this.route;
    if (this.mode === 'none' || !r) {
      hud.setDeploy(null);
      return;
    }
    const aboard = this.players.filter((p) => p.inMatch && p.deploy === DeployState.SHIP).length;
    const falling = this.players.filter((p) => p.inMatch && p.deploy === DeployState.DIVING).length;
    const down = this.players.filter((p) => p.inMatch && p.deploy === DeployState.LANDED).length;
    if (!this.offline && this.phase === MatchPhase.UFO) hud.setStatus(`OVNI · ${aboard} a bordo · ${falling} caindo · ${down} no chão`);
    if (this.mode === 'reveal' || (this.mode === 'ship' && now < r.open)) {
      hud.setDeploy({ title: 'A BORDO DO OVNI', line: `Veja a rota e os marcos · a escotilha abre em ${Math.max(1, Math.ceil((r.open - now) / 1000))} s`, tone: 'quiet' });
    } else if (this.mode === 'ship') {
      const left = Math.max(0, r.close - now);
      const asked = performance.now() - this.jumpAskedAt < 1500;
      hud.setDeploy({
        title: asked ? 'SALTANDO…' : 'SALTE QUANDO QUISER',
        line: `Salto automático em ${Math.ceil(left / 1000)} s · escolha onde cair no planeta`,
        key: 'ESPAÇO',
        keyLabel: 'SALTAR',
        progress: left / Math.max(1, r.close - r.open),
        tone: left < 4000 ? 'urgent' : 'relevant',
      });
    } else if (this.mode === 'dive') {
      hud.setDeploy({ title: 'QUEDA', line: `${Math.round(this.groundDist)} m · WASD planar · SHIFT mergulho rápido`, altitude: this.groundDist, tone: 'quiet' });
    } else if (this.mode === 'landed') {
      const waiting = aboard + falling;
      hud.setDeploy(
        this.offline
          ? { title: 'NO CHÃO', line: 'Bem-vindo ao planeta', tone: 'relevant' }
          : { title: 'NO CHÃO', line: waiting > 0 ? `Esperando ${waiting} ${waiting === 1 ? 'jogador pousar' : 'jogadores pousarem'} · armas travadas até lá` : 'Todos no chão', tone: 'relevant' },
      );
    }
  }
}

/** Paper wipe into the world reveal (a pigment hole opening in the page, never a black fade). */
function paperWipe(): void {
  const el = document.createElement('div');
  el.className = 'paper-wipe';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1400);
}
