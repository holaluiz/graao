/**
 * GraaoApp: owns the renderer, the shared world, the local character and the presentation phases.
 * Phases (GRAHudDirector): MENU → CHARACTER_CREATOR → MATCH (free roam / online). Each phase controls visible UI,
 * camera context and input. Inside MATCH the server's match phase (warmup → match → results) drives the HUD through
 * the CombatDirector.
 */
import * as THREE from 'three';
import { createGameWorld, latLonToDir, mulberry32, type GameWorld } from '@graao/game-core';
import { DEFAULT_APPEARANCE, PLANET, REGIONS, SPAWNS, randomAppearance, validateAppearance } from '@graao/game-data';
import { ActionState, MatchPhase, MovementState, v3angle, type CharacterAppearance, type DraftStateMsg, type Vec3 } from '@graao/shared';
import { GRAAssetManager } from '../assets/GRAAssetManager';
import { GRAAudioManager } from '../audio/GRAAudioManager';
import { GRAAnimationLibrary } from '../character/animation/GRAAnimationLibrary';
import { CharacterPartLibrary } from '../character/CharacterAppearanceController';
import { GraaoCharacter } from '../character/GraaoCharacter';
import { weaponTriangles } from '../character/WeaponModels';
import { CombatDirector } from '../game/CombatDirector';
import { GraaoThirdPersonCamera } from '../game/GraaoThirdPersonCamera';
import { Input } from '../game/Input';
import { LocalPlayer } from '../game/LocalPlayer';
import { Obstruction } from '../game/Obstruction';
import { GRARenderer, type Quality } from '../render/GRARenderer';
import { GRAVFXSystem } from '../render/vfx/GRAVFXSystem';
import { Creator } from '../ui/Creator';
import { DevOverlay } from '../ui/DevOverlay';
import { Hud } from '../ui/Hud';
import { Menu, type CameraResponse } from '../ui/Menu';
import { DraftScreen } from '../ui/DraftScreen';
import { PlanetView } from '../world/PlanetView';
import { NetSession } from '../net/NetSession';
import { FPS_CAPS, FrameLimiter, type FpsCap } from './FrameLimiter';

export type HudPhase = 'BOOT' | 'MENU' | 'ROOM' | 'CHARACTER_CREATOR' | 'ABILITY_DRAFT' | 'UFO' | 'DROP' | 'MATCH' | 'RESULTS';

const STORAGE = { appearance: 'graao.appearance', name: 'graao.name', quality: 'graao.quality', cameraResponse: 'graao.cameraResponse', fpsCap: 'graao.fpsCap' };
const RESPONSE_SCALE: Record<CameraResponse, number> = { FULL: 1, REDUCED: 0.4, OFF: 0 };

function readStorage<T>(key: string, fallback: T, valid: (v: unknown) => v is T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const v = JSON.parse(raw) as unknown;
    return valid(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
function writeStorage(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* private mode */
  }
}

export class GraaoApp {
  readonly r: GRARenderer;
  readonly assets = new GRAAssetManager();
  readonly anims = new GRAAnimationLibrary(this.assets);
  readonly parts = new CharacterPartLibrary();
  readonly input: Input;
  readonly camera: GraaoThirdPersonCamera;
  readonly audio = new GRAAudioManager();
  readonly hud = new Hud();
  vfx!: GRAVFXSystem;
  world!: GameWorld;
  planet!: PlanetView;
  obstruction!: Obstruction;
  local!: LocalPlayer;
  character!: GraaoCharacter;
  combat!: CombatDirector;
  net: NetSession | null = null;
  phase: HudPhase = 'BOOT';
  appearance: CharacterAppearance;
  name: string;
  private cameraResponse: CameraResponse;
  private dev!: DevOverlay;
  private menu!: Menu;
  private creator!: Creator;
  /** Ability Draft screen (over the world while the server runs the draft). */
  private draftUi!: DraftScreen;
  private lastT = 0;
  private time = 0;
  private creatorYaw = 0;
  private creatorZoom = 3.1;
  private dragging = false;
  private menuFacing = new THREE.Vector3();
  private spawn = new THREE.Vector3();
  private place = '';
  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpFacing = new THREE.Vector3();
  private readonly tmpUp = new THREE.Vector3();
  private frameMs = 0;
  /** Optional frame-rate cap ("Limite de FPS"); "Máximo" follows the monitor's refresh rate. */
  readonly limiter = new FrameLimiter();

  constructor(canvas: HTMLCanvasElement, private readonly ui: HTMLElement) {
    const q = new URLSearchParams(location.search).get('quality')?.toUpperCase();
    const quality = (['LOW', 'MEDIUM', 'HIGH'].includes(q ?? '') ? q : readStorage<string>(STORAGE.quality, 'HIGH', (v): v is string => typeof v === 'string')) as Quality;
    this.r = new GRARenderer(canvas, quality);
    this.input = new Input(canvas);
    this.camera = new GraaoThirdPersonCamera(this.r.camera);
    this.appearance = readStorage(STORAGE.appearance, DEFAULT_APPEARANCE, validateAppearance);
    this.name = readStorage<string>(STORAGE.name, '', (v): v is string => typeof v === 'string');
    this.cameraResponse = readStorage<CameraResponse>(STORAGE.cameraResponse, 'FULL', (v): v is CameraResponse => v === 'FULL' || v === 'REDUCED' || v === 'OFF');
    this.limiter.cap = readStorage<FpsCap>(STORAGE.fpsCap, 0, (v): v is FpsCap => (FPS_CAPS as readonly unknown[]).includes(v));
    window.addEventListener('resize', () => this.r.resize());
    for (const id of ['paper', 'vignette']) {
      const d = document.createElement('div');
      d.id = id;
      document.body.appendChild(d);
    }
  }

  readonly loadMs: Record<string, number> = {};

  async load(progress: (f: number, label: string) => void): Promise<void> {
    const mark = (k: string, t0: number) => (this.loadMs[k] = Math.round(performance.now() - t0));
    const tAll = performance.now();
    progress(0.02, 'Moldando o planeta…');
    await nextFrame();
    let t = performance.now();
    this.world = await createGameWorld({ includeVisual: true });
    mark('world', t);
    progress(0.35, 'Plantando grama e casinhas…');
    await nextFrame();
    t = performance.now();
    this.planet = new PlanetView(this.world, this.r.quality);
    mark('planetView', t);
    this.r.scene.add(this.planet.group);
    this.obstruction = new Obstruction(this.world.physics, this.planet);
    this.vfx = new GRAVFXSystem(this.r.quality);
    this.vfx.setGround((d) => this.world.terrain.surfaceAt(d));
    this.r.scene.add(this.vfx.group);
    progress(0.55, 'Ensinando todo mundo a andar…');
    t = performance.now();
    await this.anims.load((f) => progress(0.55 + f * 0.3, 'Ensinando todo mundo a andar…'));
    mark('animations', t);
    progress(0.88, 'Escolhendo a roupa…');
    await nextFrame();
    const s = SPAWNS[0]!;
    const dir = latLonToDir(s.lat, s.lon);
    const ground = this.world.terrain.surfaceAt(dir);
    this.spawn.set(ground.x, ground.y, ground.z);
    // Face the village well so the menu camera stands on the plaza and houses fill the background.
    const well = latLonToDir(8, 0);
    const toWell = { x: well.x - dir.x, y: well.y - dir.y, z: well.z - dir.z };
    const d = toWell.x * dir.x + toWell.y * dir.y + toWell.z * dir.z;
    const f0 = new THREE.Vector3(toWell.x - dir.x * d, toWell.y - dir.y * d, toWell.z - dir.z * d).normalize();
    const facing = { x: f0.x, y: f0.y, z: f0.z };
    this.menuFacing.set(facing.x, facing.y, facing.z);
    this.local = new LocalPlayer(this.world.physics, { x: ground.x + dir.x * 0.05, y: ground.y + dir.y * 0.05, z: ground.z + dir.z * 0.05 }, facing);
    this.character = new GraaoCharacter(this.parts, this.anims, this.appearance);
    this.r.scene.add(this.character.root);
    this.combat = new CombatDirector(this);
    this.combat.responseScale = RESPONSE_SCALE[this.cameraResponse];
    if (new URLSearchParams(location.search).has('lineup')) this.spawnLineup(dir);
    this.buildUi();
    t = performance.now();
    this.compileShaders();
    mark('shaders', t);
    mark('total', tAll);
    progress(1, 'Pronto');
  }

  /** Dev: a row of random characters next to the spawn (clothing review and multi-character cost). */
  private readonly lineup: GraaoCharacter[] = [];
  private spawnLineup(dir: Vec3): void {
    const up = new THREE.Vector3(dir.x, dir.y, dir.z);
    const side = new THREE.Vector3().crossVectors(up, this.menuFacing).normalize();
    const n = Number(new URLSearchParams(location.search).get('lineup') || 6);
    for (let i = 0; i < n; i++) {
      const c = new GraaoCharacter(this.parts, this.anims, randomAppearance(mulberry32(i * 977 + 3)));
      const k = (i + 1) * 0.9 * (i % 2 ? 1 : -1) * 0.5 + (i % 2 ? 0.45 : -0.45);
      const p = this.spawn.clone().addScaledVector(side, k * 1.6).addScaledVector(this.menuFacing, -0.4 - (i % 3) * 0.3);
      const pd = p.clone().normalize();
      const g = this.world.terrain.surfaceAt({ x: pd.x, y: pd.y, z: pd.z });
      c.setPose(new THREE.Vector3(g.x, g.y, g.z), pd, this.menuFacing);
      this.r.scene.add(c.root);
      this.lineup.push(c);
    }
  }

  /** Warm up shader programs so the reveal does not hitch. */
  private compileShaders(): void {
    this.placeMenuCamera(0);
    this.r.renderer.compile(this.r.scene, this.r.camera);
  }

  unlockAudio(): void {
    this.audio.unlock();
  }

  start(): void {
    this.setPhase('MENU');
    // Every vsync callback goes through the limiter; skipped callbacks cost nothing (dt spans the rendered frames).
    this.r.renderer.setAnimationLoop((t) => {
      if (this.limiter.shouldRender(t)) this.frame(t);
    });
  }

  // ------------------------------------------------------------------------------------------------ ui

  private buildUi(): void {
    this.menu = new Menu(
      {
        solo: () => this.playSolo(),
        create: (name) => void this.online('create', '', name),
        join: (code, name) => void this.online('join', code, name),
        customize: () => this.setPhase('CHARACTER_CREATOR'),
        quality: (q) => {
          this.r.setQuality(q);
          this.vfx.setQuality(q);
          writeStorage(STORAGE.quality, q);
          this.menu.setNote(q === 'LOW' ? 'BAIXA mantém jogadores, tiros e avisos de combate; menos grama e sem flores após recarregar.' : `Qualidade ${q === 'HIGH' ? 'ALTA' : 'MÉDIA'}`);
        },
        cameraResponse: (c) => {
          this.cameraResponse = c;
          this.combat.responseScale = RESPONSE_SCALE[c];
          writeStorage(STORAGE.cameraResponse, c);
        },
        fpsCap: (c) => {
          this.limiter.cap = c;
          writeStorage(STORAGE.fpsCap, c);
          const hz = Math.round(this.limiter.refreshHz);
          this.menu.setNote(
            c === 0
              ? `Máximo: segue o monitor (${hz} Hz). O navegador não mostra mais quadros que isso.`
              : c >= hz
                ? `Seu monitor mostra até ${hz} Hz: o limite de ${c} não muda nada aqui.`
                : `Limite de ${c} FPS (monitor de ${hz} Hz).${(hz / c) % 1 > 0.05 && (hz / c) % 1 < 0.95 ? ` Para movimento mais liso, prefira um valor que divida ${hz}.` : ''}`,
          );
        },
        click: () => this.audio.play('ui.click'),
      },
      this.name,
      this.r.quality,
      this.cameraResponse,
      this.limiter.cap,
    );
    this.creator = new Creator(
      this.appearance,
      (a) => this.applyAppearance(a),
      () => this.setPhase('MENU'),
    );
    this.draftUi = new DraftScreen({
      pick: (round, id) => this.net?.sendDraftPick(round, id),
      sound: (cue) => this.audio.play(cue),
    });
    this.hud.show(false);
    this.ui.append(this.menu.el, this.creator.el, this.hud.el, this.draftUi.el);
    this.dev = new DevOverlay({ renderer: this.r.renderer, extra: () => this.devStats() });

    const canvas = this.r.canvas;
    canvas.addEventListener('click', () => {
      if (this.phase === 'MATCH' && !this.draftUi.visible) this.input.requestLock();
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (this.phase === 'CHARACTER_CREATOR') {
        this.dragging = true;
        canvas.setPointerCapture(e.pointerId);
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.dragging) this.creatorYaw += e.movementX * 0.012;
    });
    canvas.addEventListener('pointerup', () => (this.dragging = false));
    canvas.addEventListener('wheel', (e) => {
      if (this.phase === 'CHARACTER_CREATOR') this.creatorZoom = THREE.MathUtils.clamp(this.creatorZoom + e.deltaY * 0.0025, 1.6, 4.6);
    }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      if (this.phase === 'MATCH') this.updateHint();
    });
  }

  private updateHint(): void {
    if (this.phase !== 'MATCH') return;
    this.hud.setHint(
      this.input.locked
        ? 'WASD mover · Espaço pular · Shift correr · Botão esq. atirar · Botão dir. mirar · E/Q armas · R recarregar · 1 2 3 magias · 4 suprema · F3 dados · Esc soltar'
        : 'Clique para jogar · Esc de novo volta ao menu',
    );
  }

  private applyAppearance(a: CharacterAppearance): void {
    this.appearance = { ...a };
    this.character.setAppearance(a);
    writeStorage(STORAGE.appearance, a);
    this.net?.sendAppearance(a);
  }

  /**
   * The server opened (or closed) the Ability Draft: its screen covers the world, gameplay input is off and the
   * pointer is released so cards can be clicked. Closing it hands the world back (a click locks the pointer again).
   */
  setDraft(on: boolean): void {
    if (this.draftUi.visible === on) return;
    this.draftUi.show(on);
    this.hud.show(this.phase === 'MATCH' && !on);
    this.input.releaseAll();
    this.input.enabled = this.phase === 'MATCH' && !on;
    if (on) this.input.exitLock();
    else this.updateHint();
  }

  /** DRAFT_STATE always follows the ROOM_STATE that opened the draft, so the screen is already up. */
  onDraftState(m: DraftStateMsg): void {
    if (!this.net || this.phase !== 'MATCH' || this.combat.phase !== MatchPhase.ABILITY_DRAFT) return;
    this.draftUi.setState(m, this.net.myIndex, (i) => this.combat.nameOf(i));
  }

  setPhase(p: HudPhase): void {
    this.phase = p;
    if (p !== 'MATCH') this.draftUi.show(false);
    this.menu.show(p === 'MENU');
    this.creator.show(p === 'CHARACTER_CREATOR');
    if (p === 'CHARACTER_CREATOR') this.creator.setAppearance(this.appearance);
    this.hud.show(p === 'MATCH');
    // Nothing pressed in menus carries into the world.
    if (p === 'MATCH') this.input.releaseAll();
    this.input.enabled = p === 'MATCH';
    if (p !== 'MATCH') this.input.exitLock();
    if (p === 'MATCH') {
      this.combat.enter(!!this.net);
      this.updateHint();
      this.input.requestLock();
    }
    if (p === 'MENU') this.menu.setBusy(false);
  }

  private playSolo(): void {
    this.name = this.menu.name();
    writeStorage(STORAGE.name, this.name);
    this.local.teleport({ x: this.spawn.x, y: this.spawn.y, z: this.spawn.z }, { x: this.menuFacing.x, y: this.menuFacing.y, z: this.menuFacing.z });
    this.camera.reset(this.spawn, this.menuFacing);
    this.hud.setRoom(null);
    this.setPhase('MATCH');
  }

  private async online(kind: 'create' | 'join', code: string, name: string): Promise<void> {
    this.name = name;
    writeStorage(STORAGE.name, name);
    this.menu.setBusy(true);
    this.menu.setNote(kind === 'create' ? 'Abrindo uma sala…' : `Entrando em ${code}…`);
    try {
      this.net?.leave();
      this.net = await NetSession.connect(this, kind, code, name || 'Jogador');
      this.hud.setRoom(this.net.code);
      this.menu.setNote('');
      this.setPhase('MATCH');
    } catch (e) {
      this.menu.setBusy(false);
      this.menu.setNote((e as Error).message ?? String(e), true);
    }
  }

  onDisconnected(msg: string): void {
    this.net?.leave();
    this.net = null;
    this.hud.setRoom(null);
    this.setPhase('MENU');
    this.menu.setNote(msg, true);
  }

  // ------------------------------------------------------------------------------------------------ frame

  private frame(t: number): void {
    const t0 = performance.now();
    const dt = this.lastT ? Math.min(0.1, (t - this.lastT) / 1000) : 1 / 60;
    this.lastT = t;
    this.time += dt;
    if (this.input.consume('debug')) this.dev.toggle();
    if (this.phase === 'MATCH' && !this.input.locked && this.input.consume('menu')) {
      this.net?.leave();
      this.net = null;
      this.hud.setRoom(null);
      this.setPhase('MENU');
    }

    const feet = this.tmpPos;
    let facing = this.tmpFacing;
    let anim = { moveState: MovementState.IDLE as MovementState, speed: 0, grounded: true, aiming: false, aimPitch: 0, action: ActionState.NONE as ActionState };

    if (this.phase === 'MATCH') {
      const look = this.input.takeLook();
      this.camera.look(look.yaw, look.pitch);
      this.camera.aim = this.input.isDown('aim') && this.combat.alive;
      const frame = this.camera.frame;
      const alpha = this.local.update(dt, this.input, frame, !!this.net, this.combat.frozen);
      this.net?.update(dt);
      this.local.renderPosition(alpha, feet);
      facing = this.local.renderFacing(alpha, facing);
      this.camera.update(dt, feet, this.world.physics);
      this.combat.update(dt);
      const s = this.local.state;
      const up = this.tmpUp.copy(feet).normalize();
      anim = {
        moveState: s.moveState,
        speed: this.local.speed(),
        grounded: s.grounded,
        aiming: this.combat.aimPose(s.aiming),
        aimPitch: Math.asin(THREE.MathUtils.clamp(s.aim.x * up.x + s.aim.y * up.y + s.aim.z * up.z, -1, 1)),
        action: this.combat.animAction(),
      };
      this.obstruction.update(dt, this.r.camera.position, feet, up);
      this.updatePlace(feet);
    } else {
      feet.copy(this.spawn);
      if (this.phase === 'CHARACTER_CREATOR') {
        facing.copy(this.menuFacing).applyAxisAngle(this.tmpUp.copy(feet).normalize(), this.creatorYaw);
        this.placeCreatorCamera(dt);
      } else {
        facing.copy(this.menuFacing);
        this.placeMenuCamera(this.time);
      }
      this.net?.update(dt);
    }

    this.character.setPose(feet, this.tmpUp.copy(feet).normalize(), facing);
    this.character.update(dt, anim);
    if (this.phase === 'MATCH') this.combat.present();
    for (const c of this.lineup) c.update(dt, { moveState: MovementState.IDLE, speed: 0, grounded: true, aiming: false, aimPitch: 0, action: ActionState.NONE });
    this.vfx.update(dt);
    this.draftUi.update(this.net ? this.net.serverNow() : Date.now());
    this.r.updateSun(this.phase === 'MATCH' ? feet : this.spawn, this.time);
    this.planet.update(this.time, feet, this.r.sunDir);
    this.r.render();
    this.frameMs = performance.now() - t0;
    this.dev.frame();
  }

  /** Menu framing: the character on the right third, the village and the sky behind. */
  private placeMenuCamera(time: number): void {
    const up = this.spawn.clone().normalize();
    const f = this.menuFacing;
    const side = new THREE.Vector3().crossVectors(up, f).normalize();
    const sway = Math.sin(time * 0.25) * 0.25;
    const off = THREE.MathUtils.clamp((this.r.camera.aspect - 0.9) * 1.6, 0.25, 1.45);
    const pos = this.spawn.clone().addScaledVector(up, 1.2).addScaledVector(f, 3.6).addScaledVector(side, -off - sway);
    const target = this.spawn.clone().addScaledVector(up, 1.0).addScaledVector(side, -off * 1.05 - sway * 0.5);
    this.r.camera.position.copy(pos);
    this.r.camera.up.copy(up);
    this.r.camera.lookAt(target);
    if (this.r.camera.fov !== 55) {
      this.r.camera.fov = 55;
      this.r.camera.updateProjectionMatrix();
    }
  }

  private placeCreatorCamera(dt: number): void {
    const up = this.spawn.clone().normalize();
    const f = this.menuFacing;
    const side = new THREE.Vector3().crossVectors(up, f).normalize();
    const shift = this.creatorZoom * 0.32 * THREE.MathUtils.clamp(this.r.camera.aspect, 0.8, 1.8);
    const want = this.spawn.clone().addScaledVector(up, 1.0).addScaledVector(f, this.creatorZoom).addScaledVector(side, shift);
    this.r.camera.position.lerp(want, 1 - Math.exp(-dt * 10));
    this.r.camera.up.copy(up);
    this.r.camera.lookAt(this.spawn.clone().addScaledVector(up, 0.9).addScaledVector(side, shift));
    if (this.r.camera.fov !== 40) {
      this.r.camera.fov = 40;
      this.r.camera.updateProjectionMatrix();
    }
  }

  private updatePlace(feet: THREE.Vector3): void {
    const dir = feet.clone().normalize() as unknown as Vec3;
    let best = '';
    let bestD = Infinity;
    for (const r of REGIONS) {
      const d = v3angle(dir, latLonToDir(r.lat, r.lon)) * (180 / Math.PI);
      if (d < r.radiusDeg && d < bestD) {
        bestD = d;
        best = r.name;
      }
    }
    if (best && best !== this.place) {
      this.place = best;
      this.hud.setPlace(best);
    }
  }

  private devStats(): Record<string, string | number> {
    const c = this.character.stats;
    const s = this.local?.state;
    const lat = s ? (Math.asin(THREE.MathUtils.clamp(s.pos.y / Math.hypot(s.pos.x, s.pos.y, s.pos.z), -1, 1)) * 180) / Math.PI : 0;
    const lon = s ? (Math.atan2(s.pos.x, s.pos.z) * 180) / Math.PI : 0;
    const out: Record<string, string | number> = {
      'cpu quadro ms': this.frameMs.toFixed(2),
      qualidade: this.r.quality,
      monitor: `${this.limiter.refreshHz.toFixed(0)} Hz · limite ${this.limiter.cap || 'máximo'}`,
      'malhas skinned': 2 + (this.net?.remoteCount ?? 0) * 2,
      'tris personagem': `${c.triangles} (${c.vertices} vértices)`,
      'ossos': c.bones,
      'montagem ms': c.buildMs.toFixed(1),
      'tris armas': weaponTriangles(),
      'tris terreno': this.planet.stats.terrainTris,
      'instâncias props': this.planet.stats.propInstances,
      grama: this.planet.stats.grassInstances,
      'props dissolvendo': this.obstruction.stats.fading,
      'VFX ativos': this.vfx.active,
      habilidades: this.combat.abilities.stats(),
      fase: this.phase,
      posição: s ? `lat ${lat.toFixed(1)} lon ${lon.toFixed(1)} r ${Math.hypot(s.pos.x, s.pos.y, s.pos.z).toFixed(2)}` : '-',
      movimento: s ? `${stateName(s.moveState)} ${this.local.speed().toFixed(2)} m/s ${s.grounded ? 'no chão' : 'no ar'}` : '-',
      planeta: `R ${PLANET.radius} m`,
      'carga ms': Object.entries(this.loadMs).map(([k, v]) => `${k} ${v}`).join(' · '),
      animações: this.anims.report ? `${this.anims.clips.size} clipes, ${this.anims.report.ms.toFixed(0)} ms, fonte ${[...new Set(Object.values(this.anims.report.source))].join('/')}` : '-',
    };
    if (this.net) Object.assign(out, this.net.stats());
    return out;
  }
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const stateName = (v: number) => Object.keys(MovementState).find((k) => MovementState[k as keyof typeof MovementState] === v) ?? String(v);
