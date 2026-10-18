/**
 * GraaoApp: owns the renderer, the shared world, the local character and the presentation phases.
 * Phases (GRAHudDirector): MENU → CHARACTER_CREATOR → MATCH (free roam / online). Each phase controls visible UI,
 * camera context and input. Inside MATCH the server's match phase (warmup lobby → draft → UFO → match → results)
 * drives the HUD through the CombatDirector; the UFO and DROP presentation phases belong to the DeployDirector
 * (aboard, the ride owns the camera and the local player is not simulated). Between matches, with the pointer free,
 * the room's lobby panel is up; after one, the results screen.
 *
 * The player's name, look and settings live in localStorage and, when Supabase is reachable, in their cloud profile
 * (ProfileService): the cloud row wins at startup unless the player already changed something this session.
 */
import * as THREE from 'three';
import { createGameWorld, latLonToDir, mulberry32, waterDepth, type GameWorld } from '@graao/game-core';
import { DEFAULT_APPEARANCE, PLANET, REGIONS, SPAWNS, migrateAppearance, randomAppearance, validateAppearance } from '@graao/game-data';
import { ActionState, MatchPhase, MovementState, v3angle, type CharacterAppearance, type DraftStateMsg, type Vec3 } from '@graao/shared';
import { GRAAssetManager } from '../assets/GRAAssetManager';
import { GRAAudioManager } from '../audio/GRAAudioManager';
import { GRAAnimationLibrary } from '../character/animation/GRAAnimationLibrary';
import { CharacterPartLibrary } from '../character/CharacterAppearanceController';
import { GraaoCharacter } from '../character/GraaoCharacter';
import type { AnimInput } from '../character/CharacterAnimationController';
import { weaponTriangles } from '../character/WeaponModels';
import { CombatDirector } from '../game/CombatDirector';
import { DeployDirector } from '../game/DeployDirector';
import { GraaoThirdPersonCamera } from '../game/GraaoThirdPersonCamera';
import { Input } from '../game/Input';
import { LocalPlayer } from '../game/LocalPlayer';
import { Obstruction } from '../game/Obstruction';
import { WaterDirector } from '../game/WaterDirector';
import { GRARenderer, type Quality } from '../render/GRARenderer';
import { GRAVFXSystem, Shape } from '../render/vfx/GRAVFXSystem';
import { Creator } from '../ui/Creator';
import { DevOverlay } from '../ui/DevOverlay';
import { HistoryPanel } from '../ui/HistoryPanel';
import { Hud } from '../ui/Hud';
import { LobbyPanel } from '../ui/LobbyPanel';
import { Menu } from '../ui/Menu';
import { DraftScreen } from '../ui/DraftScreen';
import { ResultsScreen } from '../ui/ResultsScreen';
import { Scoreboard } from '../ui/Scoreboard';
import { PlanetView } from '../world/PlanetView';
import { AmbientLife } from '../world/AmbientLife';
import type { BoneName } from '../character/rig/GRARig';
import { autoInk } from '../ui/ink';
import { AuthoredParts } from '../character/build/AuthoredParts';
import { NetSession } from '../net/NetSession';
import { ProfileService, type CloudProfile } from '../net/ProfileService';
import { FPS_CAPS, FrameLimiter, type FpsCap } from './FrameLimiter';

export type HudPhase = 'BOOT' | 'MENU' | 'ROOM' | 'CHARACTER_CREATOR' | 'ABILITY_DRAFT' | 'UFO' | 'DROP' | 'MATCH' | 'RESULTS';

const STORAGE = { appearance: 'graao.appearance', name: 'graao.name', quality: 'graao.quality', fpsCap: 'graao.fpsCap' };

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
  readonly scoreboard = new Scoreboard();
  /** Cloud profile (Supabase): identity for the match server, name/look/settings, match history. */
  readonly profile = new ProfileService();
  /** After a match: the server's summary and the way back to the lobby. */
  results!: ResultsScreen;
  vfx!: GRAVFXSystem;
  world!: GameWorld;
  planet!: PlanetView;
  /** Birds and butterflies. */
  ambient!: AmbientLife;
  obstruction!: Obstruction;
  local!: LocalPlayer;
  character!: GraaoCharacter;
  combat!: CombatDirector;
  /** UFO deployment presentation (reveal, ride, dive, landing). */
  deploy!: DeployDirector;
  /** Lakes and sea around characters: splashes, swim strokes, drips, the underwater view. */
  water!: WaterDirector;
  net: NetSession | null = null;
  phase: HudPhase = 'BOOT';
  appearance: CharacterAppearance;
  name: string;
  private dev!: DevOverlay;
  private menu!: Menu;
  private creator!: Creator;
  /** Ability Draft screen (over the world while the server runs the draft). */
  private draftUi!: DraftScreen;
  /** The room between matches (pointer free). */
  private lobby!: LobbyPanel;
  private history!: HistoryPanel;
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
    // Saves from older catalogs keep every piece that still exists; new slots start empty.
    this.appearance = migrateAppearance(readStorage<unknown>(STORAGE.appearance, null, (v): v is unknown => true)) ?? { ...DEFAULT_APPEARANCE };
    this.name = readStorage<string>(STORAGE.name, '', (v): v is string => typeof v === 'string');
    this.limiter.cap = readStorage<FpsCap>(STORAGE.fpsCap, 0, (v): v is FpsCap => (FPS_CAPS as readonly unknown[]).includes(v));
    window.addEventListener('resize', () => this.r.resize());
    for (const id of ['underwater', 'paper', 'vignette']) {
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
    this.ambient = new AmbientLife(PLANET.radius, this.world.terrain, this.r.quality === 'LOW' ? 8 : 18);
    this.r.scene.add(this.ambient.group);
    this.obstruction = new Obstruction(this.world.physics, this.planet);
    this.vfx = new GRAVFXSystem(this.r.quality);
    this.vfx.setGround((d) => this.world.terrain.surfaceAt(d));
    this.r.scene.add(this.vfx.group);
    progress(0.55, 'Ensinando todo mundo a andar…');
    t = performance.now();
    await this.anims.load((f) => progress(0.55 + f * 0.3, 'Ensinando todo mundo a andar…'));
    mark('animations', t);
    // Pieces modeled in Blender (hair, hoodie, cargo shorts, sneakers); the code-built stand-ins stay if this fails.
    t = performance.now();
    try {
      const authored = new AuthoredParts();
      await this.assets.track(authored.load(this.assets.url('characters/hero-parts.glb')), 'heroParts');
      this.parts.useAuthored(authored);
    } catch (e) {
      console.warn('[graao] hero-parts.glb indisponível; usando as peças feitas em código', e);
    }
    mark('heroParts', t);
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
    this.deploy = new DeployDirector(this);
    this.water = new WaterDirector(this);
    this.camera.waterRadius = this.world.terrain.seaRadius;
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
    // The cloud profile loads behind the menu; it never delays the first frame.
    this.profile.onStatus = () => this.showProfileStatus();
    void this.profile.start().then((row) => this.applyCloudProfile(row));
    // Every vsync callback goes through the limiter; skipped callbacks cost nothing (dt spans the rendered frames).
    this.r.renderer.setAnimationLoop((t) => {
      if (this.limiter.shouldRender(t)) this.frame(t);
    });
  }

  // ------------------------------------------------------------------------------------------------ ui

  private buildUi(): void {
    this.menu = new Menu(
      {
        solo: (bots) => {
          if (bots > 0) void this.online('solo', '', this.menu.name(), bots);
          else this.playSolo();
        },
        create: (name) => void this.online('create', '', name),
        join: (code, name) => void this.online('join', code, name),
        customize: () => this.setPhase('CHARACTER_CREATOR'),
        history: () => void this.openHistory(),
        quality: (q) => {
          this.r.setQuality(q);
          this.vfx.setQuality(q);
          writeStorage(STORAGE.quality, q);
          this.profile.save({ settings: { quality: q } });
          this.menu.setNote(q === 'LOW' ? 'BAIXA mantém jogadores, tiros e avisos de combate; menos grama e sem flores após recarregar.' : `Qualidade ${q === 'HIGH' ? 'ALTA' : 'MÉDIA'}`);
        },
        fpsCap: (c) => {
          this.limiter.cap = c;
          writeStorage(STORAGE.fpsCap, c);
          this.profile.save({ settings: { fpsCap: c } });
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
      this.limiter.cap,
    );
    this.creator = new Creator(
      this.appearance,
      (a) => this.applyAppearance(a),
      () => this.setPhase('MENU'),
      (cue) => this.audio.play(cue),
    );
    this.draftUi = new DraftScreen({
      pick: (round, id) => this.net?.sendDraftPick(round, id),
      sound: (cue) => this.audio.play(cue),
    });
    this.results = new ResultsScreen({
      lobby: () => this.net?.sendReturnLobby(),
      leave: () => this.leaveRoom(),
      click: () => this.audio.play('ui.click'),
    });
    this.lobby = new LobbyPanel({
      ready: (on) => this.combat.setReady(on),
      play: () => this.input.requestLock(),
      leave: () => this.leaveRoom(),
      click: () => this.audio.play('ui.click'),
    });
    this.history = new HistoryPanel(() => this.history.show(false));
    this.hud.show(false);
    this.ui.append(this.menu.el, this.history.el, this.creator.stage, this.creator.el, this.hud.el, this.lobby.el, this.draftUi.el, this.results.el, this.scoreboard.el);
    autoInk(this.ui);
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

  /** Only the "click to play" prompt while the pointer is free; nothing over the game while playing. */
  private updateHint(): void {
    if (this.phase !== 'MATCH') return;
    const quiet = this.input.locked || this.results.visible;
    this.hud.setHint(quiet ? '' : this.net ? 'Clique no mundo para jogar · Esc de novo sai da sala' : 'Clique para jogar · Esc de novo volta ao menu');
  }

  private applyAppearance(a: CharacterAppearance): void {
    this.appearance = { ...a };
    this.character.setAppearance(a);
    writeStorage(STORAGE.appearance, a);
    this.net?.sendAppearance(a);
    this.profile.save({ appearance: a });
  }

  private rememberName(name: string): void {
    this.name = name;
    writeStorage(STORAGE.name, name);
    this.profile.save({ name });
  }

  /**
   * The cloud row arrived: it wins over this browser's copy, except for what the player already changed this session.
   * No row yet (first sign-in): this browser's name, look and settings become the profile.
   */
  private applyCloudProfile(row: CloudProfile | null): void {
    if (this.profile.status !== 'cloud') return;
    const changed = this.profile.localChanges;
    if (!row) {
      this.profile.save({ name: this.name, appearance: this.appearance, settings: { quality: this.r.quality, fpsCap: this.limiter.cap } });
      return;
    }
    // The cloud name, unless the player is typing a new one in the menu right now.
    const typing = this.menu.name() !== '' && this.menu.name() !== this.name;
    if (row.name && changed.display_name === undefined && !typing) {
      this.name = row.name;
      writeStorage(STORAGE.name, row.name);
      this.menu.setName(row.name);
    }
    const look = migrateAppearance(row.appearance);
    if (look && validateAppearance(look) && !changed.appearance) {
      this.appearance = { ...look };
      this.character.setAppearance(look);
      writeStorage(STORAGE.appearance, look);
      if (this.phase === 'CHARACTER_CREATOR') this.creator.setAppearance(look);
      this.net?.sendAppearance(look);
    }
    const fps = row.settings.fpsCap;
    if (!changed.settings && typeof fps === 'number' && (FPS_CAPS as readonly number[]).includes(fps)) {
      this.limiter.cap = fps as FpsCap;
      writeStorage(STORAGE.fpsCap, fps);
    }
  }

  private showProfileStatus(): void {
    const p = this.profile;
    this.menu.setProfile(
      p.status === 'cloud' ? '☁ Perfil salvo na nuvem' : p.status === 'connecting' ? 'Perfil: conectando…' : 'Convidado · salvo só neste navegador',
      p.status === 'cloud',
      p.detail,
    );
  }

  private async openHistory(): Promise<void> {
    this.history.show(true);
    this.history.message('Carregando…');
    try {
      this.history.setEntries(await this.profile.history(8));
    } catch (e) {
      this.history.message(`Não deu para carregar o histórico (${(e as Error).message ?? e}).`);
    }
  }

  /** Leaves the online room (lobby/results buttons, Esc twice) and goes back to the menu. */
  leaveRoom(): void {
    this.net?.leave();
    this.net = null;
    this.hud.setRoom(null);
    this.setPhase('MENU');
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
    if (p !== 'MATCH') {
      this.scoreboard.hide();
      this.input.scoreboardEnabled = false;
      this.draftUi.show(false);
      this.deploy.reset();
      this.results.hide();
      this.lobby.show(false);
    }
    this.menu.show(p === 'MENU');
    if (p !== 'MENU') this.history.show(false);
    if (p === 'MENU') this.showProfileStatus();
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
    this.rememberName(this.menu.name());
    this.local.teleport({ x: this.spawn.x, y: this.spawn.y, z: this.spawn.z }, { x: this.menuFacing.x, y: this.menuFacing.y, z: this.menuFacing.z });
    this.camera.reset(this.spawn, this.menuFacing);
    this.hud.setRoom(null);
    this.setPhase('MATCH');
    // Solo starts like a match: from the UFO (?nodrop skips it).
    if (!new URLSearchParams(location.search).has('nodrop')) this.deploy.startOffline();
  }

  private async online(kind: 'create' | 'join' | 'solo', code: string, name: string, bots = 0): Promise<void> {
    this.rememberName(name);
    this.menu.setBusy(true);
    this.menu.setNote(kind === 'solo' ? `Preparando partida com ${bots} ${bots === 1 ? 'bot' : 'bots'}…` : kind === 'create' ? 'Abrindo uma sala…' : `Entrando em ${code}…`);
    try {
      this.net?.leave();
      this.net = null;
      this.net = await NetSession.connect(this, kind, code, name || 'Jogador', bots);
      this.hud.setRoom(this.net.solo ? 'SOLO · BOTS' : this.net.code);
      this.menu.setNote('');
      this.setPhase('MATCH');
      this.net.syncState();
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
    if (this.phase === 'MATCH' && !this.input.locked && this.input.consume('menu')) this.leaveRoom();

    const feet = this.tmpPos;
    let facing = this.tmpFacing;
    let anim: AnimInput = { moveState: MovementState.IDLE as MovementState, speed: 0, grounded: true, aiming: false, aimPitch: 0, action: ActionState.NONE as ActionState };

    if (this.phase === 'MATCH') {
      const look = this.input.takeLook();
      const riding = this.deploy.riding;
      if (riding) {
        // Aboard the UFO: the ride owns the camera; the local player is not simulated (the server keeps it aboard).
        this.deploy.rideCamera(dt, look);
        this.net?.update(dt);
        feet.copy(this.deploy.focus);
      } else {
        this.camera.look(look.yaw, look.pitch);
        this.camera.aim = this.input.isDown('aim') && this.combat.alive && !this.deploy.diving && !this.local.state.swimming;
        const frame = this.camera.frame;
        const alpha = this.local.update(dt, this.input, frame, !!this.net, this.combat.frozen);
        this.net?.update(dt);
        this.local.renderPosition(alpha, feet);
        facing = this.local.renderFacing(alpha, facing);
        this.camera.update(dt, feet, this.world.physics);
      }
      this.combat.update(dt);
      this.deploy.update(dt);
      const s = this.local.state;
      const up = this.tmpUp.copy(feet).normalize();
      anim = {
        moveState: s.moveState,
        speed: this.local.speed(),
        grounded: s.grounded,
        aiming: this.combat.aimPose(s.aiming) && !s.diving,
        aimPitch: Math.asin(THREE.MathUtils.clamp(s.aim.x * up.x + s.aim.y * up.y + s.aim.z * up.z, -1, 1)),
        action: this.combat.animAction(),
        diving: s.diving,
        airJumped: s.airJumped,
        groundDist: this.deploy.groundDist,
        waterDepth: waterDepth(feet),
      };
      if (!riding) this.obstruction.update(dt, this.r.camera.position, feet, up);
      this.updatePlace(feet);
      this.updateLobby();
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
    if (this.phase === 'CHARACTER_CREATOR') this.layoutCreatorArrows();
    if (this.phase === 'MATCH') this.combat.present();
    this.water.update(dt);
    this.presentAirJumps();
    for (const c of this.lineup) c.update(dt, { moveState: MovementState.IDLE, speed: 0, grounded: true, aiming: false, aimPitch: 0, action: ActionState.NONE });
    this.vfx.update(dt);
    this.draftUi.update(this.net ? this.net.serverNow() : Date.now());
    this.updateScoreboard();
    this.r.updateSun(this.phase === 'MATCH' ? feet : this.spawn, this.time);
    this.planet.update(this.time, feet, this.r.sunDir);
    const orbit = this.r.setAltitude(PLANET.radius);
    this.planet.setOrbit(orbit, this.r.sunDir, this.r.camera.position.length() - PLANET.radius);
    this.ambient.update(dt, this.time, this.phase === 'MATCH' ? feet : this.spawn);
    this.audio.setAmbience(1 - orbit, this.time);
    this.r.render();
    this.frameMs = performance.now() - t0;
    this.dev.frame();
  }

  private updateScoreboard(): void {
    const available = this.phase === 'MATCH' && !!this.net && (this.combat.phase === MatchPhase.MATCH || this.combat.phase === MatchPhase.UFO);
    this.input.scoreboardEnabled = available;
    const held = available && this.input.isDown('scoreboard');
    if (held) this.scoreboard.setState(this.combat.scoreboardState);
    if (held !== this.scoreboard.visible) this.scoreboard.show(held);
  }

  /** Double jumps (ours and everyone else's, once each): a puff of air kicked down from the feet and a soft swish. */
  private presentAirJumps(): void {
    const remotes = this.net ? [...this.net.remotePlayers].map((r) => r.character) : [];
    for (const c of [this.character, ...remotes]) {
      if (!c.consumeAirJump() || !c.root.visible) continue;
      const feet = c.root.position;
      const down = this.tmpUp.copy(feet).normalize().negate();
      this.vfx.burst(feet, down, { color: '#f4f7ff', count: 10, speed: 3.2, size: 0.14, life: 0.38, drag: 5, spread: 1.25, shape: Shape.DOT, category: 'CombatBurst' });
      this.vfx.burst(feet, down, { color: '#ffffff', count: 1, speed: 0, speedJitter: 0, size: 1.1, sizeJitter: 0, life: 0.26, shape: Shape.RING, category: 'CombatBurst' });
      if (c === this.character) {
        this.audio.play('jump.air', { volume: 0.7 });
        continue;
      }
      const cam = this.r.camera;
      const d = new THREE.Vector3().subVectors(feet, cam.position);
      const dist = d.length();
      if (dist > 40) continue;
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
      this.audio.play('jump.air', { volume: 0.7 / (1 + dist / 12), pan: dist > 0.01 ? d.dot(right) / dist : 0, muffle: Math.min(0.8, dist / 60) });
    }
  }

  /** The room's lobby panel: online, between matches, pointer free, nothing else over the world. */
  private resultsUp = false;
  private updateLobby(): void {
    if (this.results.visible !== this.resultsUp) {
      this.resultsUp = this.results.visible;
      this.updateHint();
    }
    const net = this.net;
    const show = !!net && this.combat.phase === MatchPhase.FREE_ROAM && !this.input.locked && !this.draftUi.visible && !this.results.visible;
    if (show !== this.lobby.visible) this.lobby.show(show);
    if (show && net) this.lobby.update(net.code, [...this.combat.roomPlayers], net.myIndex);
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

  /** Projects the clothing rows (hat, hair, top, bottom, shoes) of the character to the screen for the creator arrows. */
  private layoutCreatorArrows(): void {
    const c = this.character;
    c.root.updateMatrixWorld(true);
    const cam = this.r.camera;
    const rect = this.r.canvas.getBoundingClientRect();
    const up = this.tmpUp.copy(this.spawn).normalize();
    const screen = (p: THREE.Vector3) => {
      const v = p.clone().project(cam);
      return { x: rect.left + (v.x * 0.5 + 0.5) * rect.width, y: rect.top + (-v.y * 0.5 + 0.5) * rect.height };
    };
    const bone = (name: BoneName, lift = 0) => {
      const b = c.bones.get(name);
      const p = b ? b.getWorldPosition(new THREE.Vector3()) : this.spawn.clone();
      return screen(p.addScaledVector(up, lift));
    };
    const hips = bone('Hips');
    const knee = bone('LeftLeg');
    const anchors = {
      hat: bone('HeadTop_End', 0.1),
      hair: bone('Head', 0.1),
      top: bone('Spine1'),
      bottom: { x: hips.x, y: hips.y * 0.55 + knee.y * 0.45 },
      shoes: bone('LeftFoot', -0.02),
    };
    // Arrows ~0.45 m to each side of the body (in screen px at the body's depth), clear of the arms.
    const side = new THREE.Vector3().crossVectors(up, this.menuFacing).normalize();
    const pHips = c.bones.get('Hips')!.getWorldPosition(new THREE.Vector3());
    const a = screen(pHips);
    const b = screen(pHips.clone().addScaledVector(side, 0.45));
    this.creator.layout(anchors, a.x, Math.max(60, Math.hypot(b.x - a.x, b.y - a.y)));
  }

  /** Creator framing: the character centered in the screen area the panel leaves free (measured, not guessed). */
  private placeCreatorCamera(dt: number): void {
    const up = this.spawn.clone().normalize();
    const f = this.menuFacing;
    const side = new THREE.Vector3().crossVectors(up, f).normalize();
    // Sliding camera and target sideways by `shift` puts the character at NDC x = -shift / halfWidth.
    const halfW = Math.tan(THREE.MathUtils.degToRad(40 / 2)) * this.creatorZoom * this.r.camera.aspect;
    const shift = -this.creator.freeCenterX(this.r.canvas.getBoundingClientRect()) * halfW;
    // Whole body at the default distance; zooming in rises toward the face (hats, beards, glasses).
    const focus = THREE.MathUtils.clamp(THREE.MathUtils.mapLinear(this.creatorZoom, 3.1, 1.6, 0.9, 1.38), 0.9, 1.38);
    const want = this.spawn.clone().addScaledVector(up, focus + 0.1).addScaledVector(f, this.creatorZoom).addScaledVector(side, shift);
    this.r.camera.position.lerp(want, 1 - Math.exp(-dt * 10));
    this.r.camera.up.copy(up);
    this.r.camera.lookAt(this.spawn.clone().addScaledVector(up, focus).addScaledVector(side, shift));
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
      fase: this.deploy && this.deploy.mode !== 'none' ? `${this.phase} / ${this.deploy.mode}` : this.phase,
      'tris OVNI': this.deploy?.ufo.triangles ?? 0,
      posição: s ? `lat ${lat.toFixed(1)} lon ${lon.toFixed(1)} r ${Math.hypot(s.pos.x, s.pos.y, s.pos.z).toFixed(2)}` : '-',
      movimento: s ? `${stateName(s.moveState)} ${this.local.speed().toFixed(2)} m/s ${s.grounded ? 'no chão' : 'no ar'}${waterDepth(s.pos) > 0 ? ` · água ${waterDepth(s.pos).toFixed(2)} m` : ''}` : '-',
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
