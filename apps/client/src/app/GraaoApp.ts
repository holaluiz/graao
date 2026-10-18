/**
 * GraaoApp: owns the renderer, the shared world, the local character and the presentation phases.
 * MENU → ROOM_BROWSER → ROOM_LOBBY → ABILITY_DRAFT → LOADING → MATCH follows the server's room phase.
 * Menus render a decorative avatar; only UFO/drop/match/results present the match world. Deployment owns its camera,
 * and the local character is not simulated aboard. Customization returns to its originating menu or lobby.
 *
 * The player's name, look and settings live in localStorage and, when Supabase is reachable, in their cloud profile
 * (ProfileService): the cloud row wins at startup unless the player already changed something this session.
 */
import * as THREE from 'three';
import { createGameWorld, latLonToDir, mulberry32, waterDepth, type GameWorld } from '@graao/game-core';
import { DEFAULT_APPEARANCE, PLANET, REGIONS, SPAWNS, migrateAppearance, randomAppearance, validateAppearance } from '@graao/game-data';
import { ActionState, MatchPhase, MovementState, v3angle, type CharacterAppearance, type DraftStateMsg, type NoticeMsg, type RoomStateMsg, type Vec3 } from '@graao/shared';
import { GRAAssetManager } from '../assets/GRAAssetManager';
import { GRAAudioManager } from '../audio/GRAAudioManager';
import { GRAAnimationLibrary } from '../character/animation/GRAAnimationLibrary';
import { CharacterPartLibrary } from '../character/CharacterAppearanceController';
import { GraaoCharacter } from '../character/GraaoCharacter';
import type { AnimInput } from '../character/CharacterAnimationController';
import { weaponTriangles } from '../character/WeaponModels';
import { CombatDirector } from '../game/CombatDirector';
import { DeployDirector } from '../game/DeployDirector';
import { LootDirector } from '../game/LootDirector';
import { GraaoThirdPersonCamera } from '../game/GraaoThirdPersonCamera';
import { Input } from '../game/Input';
import { LocalPlayer } from '../game/LocalPlayer';
import { Obstruction } from '../game/Obstruction';
import { TormentaDirector } from '../game/TormentaDirector';
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
import { RoomBrowser, type CreateRoomSettings } from '../ui/RoomBrowser';
import { SettingsPanel, type GameSettings } from '../ui/SettingsPanel';
import { PreparationScreen } from '../ui/PreparationScreen';
import { Modal, Toast, button, field, node } from '../ui/components';
import { PlanetView } from '../world/PlanetView';
import { AmbientLife } from '../world/AmbientLife';
import { autoInk } from '../ui/ink';
import { AuthoredParts } from '../character/build/AuthoredParts';
import { NetSession, type RoomConnectOptions } from '../net/NetSession';
import { ProfileService, type CloudProfile } from '../net/ProfileService';
import { signalingConfigured } from '../net/host/signaling';
import { FPS_CAPS, FrameLimiter, type FpsCap } from './FrameLimiter';

export type HudPhase = 'BOOT' | 'MENU' | 'ROOM_BROWSER' | 'ROOM_LOBBY' | 'LOADING' | 'ROOM' | 'CHARACTER_CREATOR' | 'ABILITY_DRAFT' | 'UFO' | 'DROP' | 'MATCH' | 'RESULTS';

const STORAGE = { appearance: 'graao.appearance', name: 'graao.name', fpsCap: 'graao.fpsCap', settings: 'graao.settings' };

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
  /** The match's shrinking safe region: world pigment, curtain, HUD, sound (mirrors the server). */
  tormenta!: TormentaDirector;
  /** Chests, items on the ground, pickups and consumables (mirrors the server). */
  loot!: LootDirector;
  net: NetSession | null = null;
  phase: HudPhase = 'BOOT';
  appearance: CharacterAppearance;
  name: string;
  private dev!: DevOverlay;
  private menu!: Menu;
  private browser!: RoomBrowser;
  private settings!: SettingsPanel;
  private pause!: Modal;
  private training: Modal | null = null;
  private readonly preparation = new PreparationScreen();
  private readonly toast = new Toast();
  private roomState: RoomStateMsg | null = null;
  private creatorReturn: 'MENU' | 'ROOM_LOBBY' = 'MENU';
  private preparationId = -1;
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
  readonly spawn = new THREE.Vector3();
  private place = '';
  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpFacing = new THREE.Vector3();
  private readonly tmpUp = new THREE.Vector3();
  private frameMs = 0;
  /** Optional frame-rate cap ("Limite de FPS"); "Máximo" follows the monitor's refresh rate. */
  readonly limiter = new FrameLimiter();

  constructor(canvas: HTMLCanvasElement, private readonly ui: HTMLElement) {
    // Presentation settings live in their own screen; the development quality override remains available.
    const q = new URLSearchParams(location.search).get('quality')?.toUpperCase();
    const savedSettings = readStorage<Partial<GameSettings>>(STORAGE.settings, {}, (v): v is Partial<GameSettings> => !!v && typeof v === 'object');
    const quality = (['LOW', 'MEDIUM', 'HIGH'].includes(q ?? '') ? q : ['LOW', 'MEDIUM', 'HIGH'].includes(savedSettings.quality ?? '') ? savedSettings.quality : 'HIGH') as Quality;
    this.r = new GRARenderer(canvas, quality);
    this.input = new Input(canvas);
    this.camera = new GraaoThirdPersonCamera(this.r.camera);
    this.audio.setVolume(typeof savedSettings.volume === 'number' ? THREE.MathUtils.clamp(savedSettings.volume, 0, 1) : .8);
    if (typeof savedSettings.sensitivity === 'number') this.input.sensitivity = THREE.MathUtils.clamp(savedSettings.sensitivity, .0005, .005);
    this.input.invertY = savedSettings.invertY === true;
    // Saves from older catalogs keep every piece that still exists; new slots start empty.
    this.appearance = migrateAppearance(readStorage<unknown>(STORAGE.appearance, null, (_v): _v is unknown => true)) ?? { ...DEFAULT_APPEARANCE };
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
    t = performance.now();
    try {
      await Promise.all([
        this.assets.track(this.audio.loadAmbience(this.assets.url('audio/wind.mp3')), 'ambienceWind'),
        this.assets.track(this.audio.loadBeach(this.assets.url('audio/beach.mp3')), 'ambienceBeach'),
      ]);
    } catch (e) {
      console.warn('[graao] áudio ambiente indisponível', e);
    }
    mark('ambienceAudio', t);
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
    this.loot = new LootDirector(this);
    this.combat = new CombatDirector(this);
    this.deploy = new DeployDirector(this);
    this.water = new WaterDirector(this);
    this.tormenta = new TormentaDirector(this);
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
    this.menu = new Menu({
      play: () => this.setPhase('ROOM_BROWSER'),
      customize: () => this.openCreator(),
      settings: () => this.settings.show(),
      train: () => this.openTraining(),
      name: (name) => this.rememberName(name),
      click: () => this.audio.play('ui.click'),
    }, this.name);
    this.browser = new RoomBrowser({
      back: () => this.setPhase('MENU'),
      create: (settings) => void this.createRoom(settings),
      join: (code, fallbackHosted) => void this.online('join', code, this.name, 0, { forceDedicated: true, fallbackHosted }),
      click: () => this.audio.play('ui.click'),
    });
    this.browser.playerName = this.name;
    this.browser.hostedAvailable = signalingConfigured();
    this.settings = new SettingsPanel({
      quality: this.r.quality, fpsCap: this.limiter.cap, volume: this.audio.volume,
      sensitivity: this.input.sensitivity, invertY: this.input.invertY,
    }, (settings) => {
      this.r.setQuality(settings.quality);
      this.vfx.setQuality(settings.quality);
      this.limiter.cap = settings.fpsCap;
      this.audio.setVolume(settings.volume);
      this.input.sensitivity = settings.sensitivity;
      this.input.invertY = settings.invertY;
      writeStorage(STORAGE.settings, settings);
      writeStorage(STORAGE.fpsCap, settings.fpsCap);
      this.profile.save({ settings: { fpsCap: settings.fpsCap, quality: settings.quality } });
    });
    this.creator = new Creator(this.appearance, {
      preview: (a) => this.character.setAppearance(a),
      save: (a) => { this.applyAppearance(a); this.setPhase(this.creatorReturn); this.toast.show('Aparência salva'); },
      discard: (a) => { this.character.setAppearance(a); this.setPhase(this.creatorReturn); },
      resetView: () => { this.creatorYaw = 0; this.creatorZoom = 3.1; },
      sound: (cue) => this.audio.play(cue),
    });
    this.draftUi = new DraftScreen({ pick: (round, id) => this.net?.sendDraftPick(round, id), sound: (cue) => this.audio.play(cue) });
    this.results = new ResultsScreen({ lobby: () => this.net?.sendReturnLobby(), leave: () => this.leaveRoom(), click: () => this.audio.play('ui.click') });
    this.lobby = new LobbyPanel({
      ready: (on) => this.combat.setReady(on),
      start: () => this.net?.sendStartMatch(),
      bots: (count) => this.net?.sendRoomSettings(count),
      customize: () => this.openCreator(),
      leave: () => this.leaveRoom(),
      click: () => this.audio.play('ui.click'),
      notify: (text) => this.toast.show(text),
    });
    this.pause = new Modal('Um respiro', () => { this.input.enabled = this.phase === 'MATCH'; });
    const pauseActions = node('div', 'pause-actions');
    pauseActions.append(
      button('Continuar', () => { this.pause.hide(); if (this.phase === 'MATCH') this.input.requestLock(); }, true),
      button('Configurações', () => { this.pause.hide(); this.settings.show(); }),
      button('Sair da sala', () => { this.pause.hide(); this.leaveRoom(); }),
    );
    this.pause.body.append(pauseActions);
    this.history = new HistoryPanel(() => this.history.show(false));
    this.hud.show(false);
    this.ui.append(this.menu.el, this.browser.el, this.history.el, this.creator.stage, this.creator.el, this.hud.el,
      this.lobby.el, this.draftUi.el, this.preparation.el, this.results.el, this.scoreboard.el, this.pause.el, this.settings.el, this.toast.el);
    autoInk(this.ui);
    this.dev = new DevOverlay({ renderer: this.r.renderer, extra: () => this.devStats() });
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || e.repeat || e.defaultPrevented) return;
      this.input.consume('menu');
      if (this.settings.visible) { this.settings.hide(); return; }
      if (this.pause.visible) { this.pause.hide(); return; }
      if (this.training?.visible) { this.training.hide(); return; }
      if (this.phase === 'ROOM_BROWSER') { if (!this.browser.closeModal()) this.setPhase('MENU'); return; }
      if (this.phase === 'CHARACTER_CREATOR') { this.character.setAppearance(this.appearance); this.setPhase(this.creatorReturn); return; }
      if (this.net || this.phase === 'MATCH') {
        this.input.exitLock(); this.input.releaseAll(); this.input.enabled = false; this.pause.show();
      }
    });
    const canvas = this.r.canvas;
    canvas.addEventListener('click', () => {
      if (this.phase === 'MATCH' && !this.pause.visible && !this.settings.visible) this.input.requestLock();
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
    this.hud.setHint(quiet ? '' : this.net ? 'Clique no mundo para jogar · ESC abre opções' : 'Clique para jogar · ESC abre opções');
  }

  private applyAppearance(a: CharacterAppearance): void {
    this.appearance = { ...a };
    this.character.setAppearance(a);
    writeStorage(STORAGE.appearance, a);
    this.net?.sendAppearance(a);
    this.profile.save({ appearance: a });
  }

  private rememberName(name: string): void {
    this.name = name.trim().slice(0, 16);
    this.menu.setName(this.name);
    this.browser.playerName = this.name;
    writeStorage(STORAGE.name, this.name);
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
      this.profile.save({ name: this.name, appearance: this.appearance, settings: { fpsCap: this.limiter.cap } });
      return;
    }
    // The cloud name, unless the player is typing a new one in the menu right now.
    const typing = this.menu.name() !== '' && this.menu.name() !== this.name;
    if (row.name && changed.display_name === undefined && !typing) {
      this.name = row.name;
      writeStorage(STORAGE.name, row.name);
      this.menu.setName(row.name);
      this.browser.playerName = row.name;
    }
    const look = migrateAppearance(row.appearance);
    if (look && validateAppearance(look) && !changed.appearance && this.phase !== 'CHARACTER_CREATOR') {
      this.appearance = { ...look };
      this.character.setAppearance(look);
      writeStorage(STORAGE.appearance, look);
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

  /** Leave the room explicitly; ESC only opens options. */
  leaveRoom(): void {
    const online = !!this.net;
    this.combat.connectionLost = false;
    this.net?.leave();
    this.net = null;
    this.roomState = null;
    this.preparationId = -1;
    this.local.outbox.length = 0;
    this.loot.reset();
    this.hud.setRoom(null);
    this.pause.hide();
    this.setPhase(online ? 'ROOM_BROWSER' : 'MENU');
  }

  setDraft(on: boolean): void {
    this.draftUi.show(on);
  }

  onDraftState(m: DraftStateMsg): void {
    if (!this.net || this.phase !== 'ABILITY_DRAFT') return;
    this.draftUi.setState(m, this.net.myIndex, (i) => this.combat.nameOf(i));
  }

  onRoomNotice(m: NoticeMsg): void {
    if (m.text) this.toast.show(m.text, m.kind === 'error');
  }

  /** Presentation follows the authoritative room phase; only UFO onward runs the world. */
  onRoomState(m: RoomStateMsg): void {
    this.roomState = m;
    if (!this.net) return;
    if (m.phase === MatchPhase.LOBBY) {
      this.preparationId = -1;
      if (this.phase !== 'CHARACTER_CREATOR' || this.creatorReturn !== 'ROOM_LOBBY') this.setPhase('ROOM_LOBBY');
      this.lobby.update(m, this.net.myIndex);
    } else if (m.phase === MatchPhase.ABILITY_DRAFT) {
      this.setPhase('ABILITY_DRAFT');
    } else if (m.phase === MatchPhase.PREPARATION) {
      this.setPhase('LOADING');
      const prep = m.preparation;
      if (prep) {
        this.preparation.waiting(prep.ready.length, prep.ready.length + prep.waiting.length);
        if (prep.id !== this.preparationId) void this.prepareMatch(prep.id);
      }
    } else if (m.phase === MatchPhase.UFO || m.phase === MatchPhase.MATCH || m.phase === MatchPhase.RESULTS || m.phase === MatchPhase.FREE_ROAM) {
      this.setPhase('MATCH');
    } else if (m.phase === MatchPhase.CLOSED) {
      this.onDisconnected('A sala foi encerrada pelo anfitrião.');
    }
  }

  private async prepareMatch(id: number): Promise<void> {
    this.preparationId = id;
    const net = this.net;
    const current = () => this.net === net && this.preparationId === id && this.phase === 'LOADING';
    const started = performance.now();
    try {
      this.preparation.step(0, 'Verificando o planeta e os recursos…');
      await nextFrame();
      if (!current()) return;
      if (!this.world || !this.planet || !this.anims.clips.size) throw new Error('Os recursos do planeta não estão prontos.');
      this.preparation.step(1, 'Conferindo os participantes e suas habilidades…');
      await nextFrame();
      if (!current()) return;
      if (!this.roomState?.players.length) throw new Error('A lista de participantes não chegou.');
      this.preparation.step(2, 'Preparando a imagem da partida…');
      net?.preparePresentation();
      this.compileShaders();
      await nextFrame();
      if (!current()) return;
      this.loadMs.preparation = Math.round(performance.now() - started);
      this.preparation.step(3, 'Tudo pronto. Aguardando os outros jogadores…');
      net?.sendPrepared(id, true);
    } catch (e) {
      if (!current()) return;
      const message = (e as Error).message || 'Não foi possível preparar a partida.';
      this.toast.show(message, true);
      net?.sendPrepared(id, false, message);
    }
  }

  setPhase(p: HudPhase): void {
    if (this.phase === p) return;
    const previous = this.phase;
    this.phase = p;
    if (p !== 'CHARACTER_CREATOR') this.r.camera.clearViewOffset();
    if (previous === 'CHARACTER_CREATOR' && p !== this.creatorReturn) this.character.setAppearance(this.appearance);
    this.input.releaseAll();
    this.local.outbox.length = 0;
    this.pause.hide();
    this.settings.hide();
    this.menu.show(p === 'MENU');
    this.browser.show(p === 'ROOM_BROWSER');
    this.creator.show(p === 'CHARACTER_CREATOR');
    if (p === 'CHARACTER_CREATOR') this.creator.setAppearance(this.appearance);
    this.lobby.show(p === 'ROOM_LOBBY');
    this.draftUi.show(p === 'ABILITY_DRAFT');
    this.preparation.show(p === 'LOADING');
    this.hud.show(p === 'MATCH');
    this.history.show(false);
    this.input.enabled = p === 'MATCH';
    if (p !== 'MATCH') {
      this.scoreboard.hide();
      this.input.scoreboardEnabled = false;
      this.input.exitLock();
      this.deploy.reset();
      this.tormenta.reset();
      this.obstruction.reset();
      this.results.hide();
      this.character.root.visible = true;
    }
    this.combat.holder.setVisible(p === 'MATCH');
    this.net?.setPresentation(p === 'MATCH');
    if (p === 'MATCH') this.updateHint();
    if (p === 'MENU') { this.menu.setBusy(false); this.showProfileStatus(); }
    if (p === 'ROOM_LOBBY' && this.roomState && this.net) this.lobby.update(this.roomState, this.net.myIndex);
  }

  private openCreator(): void {
    this.creatorReturn = this.phase === 'ROOM_LOBBY' ? 'ROOM_LOBBY' : 'MENU';
    if (this.creatorReturn === 'ROOM_LOBBY') this.combat.setReady(false);
    this.creatorYaw = 0;
    this.creatorZoom = 3.1;
    this.setPhase('CHARACTER_CREATOR');
  }

  private openTraining(): void {
    this.training?.el.remove();
    const modal = new Modal('Treinar sozinho');
    this.training = modal;
    const bots = node('select', 'field');
    for (let i = 0; i <= 9; i++) { const option = node('option', '', i ? `${i} ${i === 1 ? 'bot' : 'bots'}` : 'Sem bots · explorar o planeta'); option.value = String(i); bots.append(option); }
    modal.body.append(node('p', 'gra-muted', 'Treino privado. Com bots, você monta a partida no lobby.'), field('Adversários', bots), button('Começar treino', () => {
      modal.hide();
      const count = Number(bots.value);
      if (!count) this.playSolo();
      else void this.online('solo', '', this.name, count, { hosted: true });
    }, true));
    this.ui.append(modal.el);
    modal.show();
  }

  private async createRoom(settings: CreateRoomSettings): Promise<void> {
    await this.online('create', '', this.name, settings.bots, {
      roomName: settings.roomName, visibility: settings.visibility,
      forceDedicated: !settings.hosted, hosted: settings.hosted,
    });
  }

  private playSolo(): void {
    this.loot.reset();
    this.roomState = null;
    this.combat.enter(false);
    this.local.teleport({ x: this.spawn.x, y: this.spawn.y, z: this.spawn.z }, { x: this.menuFacing.x, y: this.menuFacing.y, z: this.menuFacing.z });
    this.camera.reset(this.spawn, this.menuFacing);
    this.hud.setRoom(null);
    this.setPhase('MATCH');
    if (!new URLSearchParams(location.search).has('nodrop')) this.deploy.startOffline();
    this.input.requestLock();
  }

  private async online(kind: 'create' | 'join' | 'solo', code: string, name: string, bots = 0, settings: RoomConnectOptions = {}): Promise<void> {
    this.rememberName(name || 'Jogador');
    this.menu.setBusy(true);
    this.browser.setBusy(true);
    const text = kind === 'join' ? `Entrando em ${code}…` : 'Abrindo a sala…';
    this.browser.message(text);
    this.menu.setNote(text);
    try {
      this.net?.leave();
      this.net = null;
      this.roomState = null;
      this.preparationId = -1;
      this.loot.reset();
      this.local.outbox.length = 0;
      this.net = await NetSession.connect(this, kind, code, this.name, bots, settings);
      this.combat.enter(true);
      this.lobby.setConnection(false);
      this.hud.setRoom(this.net.solo ? 'TREINO · BOTS' : this.net.code);
      this.menu.setNote('');
      this.browser.closeModal();
      this.setPhase('ROOM_LOBBY');
      this.net.syncState();
    } catch (e) {
      const message = (e as Error).message ?? String(e);
      this.browser.message(message, true);
      this.menu.setNote(message, true);
      this.toast.show(message, true);
    } finally {
      this.menu.setBusy(false);
      this.browser.setBusy(false);
    }
  }

  onConnectionDrop(dropped: boolean): void {
    this.combat.connectionLost = dropped;
    this.lobby.setConnection(dropped);
    this.toast.show(dropped ? 'Conexão interrompida. Tentando reconectar…' : 'Conexão restabelecida.', dropped);
  }

  onDisconnected(msg: string): void {
    this.combat.connectionLost = false;
    this.net?.leave();
    this.net = null;
    this.roomState = null;
    this.preparationId = -1;
    this.local.outbox.length = 0;
    this.loot.reset();
    this.hud.setRoom(null);
    this.setPhase('ROOM_BROWSER');
    this.browser.message(msg, true);
    this.toast.show(msg, true);
  }

  // ------------------------------------------------------------------------------------------------ frame

  private frame(t: number): void {
    const t0 = performance.now();
    const dt = this.lastT ? Math.min(0.1, (t - this.lastT) / 1000) : 1 / 60;
    this.lastT = t;
    this.time += dt;
    this.input.enabled = this.phase === 'MATCH' && !this.pause.visible && !this.settings.visible;
    if (this.input.consume('debug')) this.dev.toggle();


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
      // Loot first: its weapon replacement card may own E and Q this frame.
      this.loot.update(dt, this.time);
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
    if (this.phase === 'CHARACTER_CREATOR') this.layoutCreatorButtons();
    if (this.phase === 'MATCH') this.combat.present();
    this.water.update(dt);
    this.tormenta.update(dt);
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
    const envLevel = (1 - orbit) * this.tormenta.ambience;
    this.audio.setAmbience(envLevel, envLevel * this.water.beachProximity, this.time);
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

  private updateLobby(): void {
    if (this.lobby.visible !== (this.phase === 'ROOM_LOBBY')) this.lobby.show(this.phase === 'ROOM_LOBBY');
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

  /** Projects the top of the character's head to the screen for the creator's close and dice buttons. */
  private layoutCreatorButtons(): void {
    const c = this.character;
    c.root.updateMatrixWorld(true);
    const cam = this.r.camera;
    const rect = this.r.canvas.getBoundingClientRect();
    const up = this.tmpUp.copy(this.spawn).normalize();
    const screen = (p: THREE.Vector3) => {
      const v = p.clone().project(cam);
      return { x: rect.left + (v.x * 0.5 + 0.5) * rect.width, y: rect.top + (-v.y * 0.5 + 0.5) * rect.height };
    };
    const head = c.bones.get('HeadTop_End');
    const headTop = screen((head ? head.getWorldPosition(new THREE.Vector3()) : this.spawn.clone()).addScaledVector(up, 0.1));
    // Buttons ~0.45 m to each side of the body (in screen px at the body's depth), clear of the head and hat.
    const side = new THREE.Vector3().crossVectors(up, this.menuFacing).normalize();
    const pHips = c.bones.get('Hips')!.getWorldPosition(new THREE.Vector3());
    const a = screen(pHips);
    const b = screen(pHips.clone().addScaledVector(side, 0.45));
    this.creator.layout(headTop.y, a.x, Math.max(60, Math.hypot(b.x - a.x, b.y - a.y)));
  }

  /** Creator framing: the character centered in the screen area the panel leaves free (measured, not guessed). */
  private placeCreatorCamera(dt: number): void {
    const up = this.spawn.clone().normalize();
    const f = this.menuFacing;
    const view = this.r.canvas.getBoundingClientRect();
    const bounds = this.creator.previewBounds();
    // Fit the reserved preview by widening the lens, keeping the camera clear of village buildings.
    const framing = Math.max(1, view.height / Math.max(110, bounds.height) * .95);
    const distance = this.creatorZoom;
    const halfH = Math.tan(THREE.MathUtils.degToRad(20)) * framing * distance;
    // Whole body at the default distance; zooming in rises toward the face (hats, beards, glasses).
    const focus = THREE.MathUtils.clamp(THREE.MathUtils.mapLinear(this.creatorZoom, 3.1, 1.6, 0.9, 1.38), 0.9, 1.38);
    const target = this.spawn.clone().addScaledVector(up, focus);
    const want = target.clone().addScaledVector(up, .1).addScaledVector(f, distance);
    this.r.camera.position.lerp(want, 1 - Math.exp(-dt * 10));
    // Keep the preview camera in front of scenery instead of dissolving props across the avatar.
    const back = this.r.camera.position.clone().sub(target);
    const length = back.length();
    if (length > .001) {
      back.divideScalar(length);
      const hit = this.world.physics.castRay(target, back, length + .3);
      if (hit) this.r.camera.position.copy(target).addScaledVector(back, Math.max(.35, Math.min(length, hit.toi - .3)));
    }
    // Preserve the full-body framing when an obstacle pulls the camera closer.
    const fov = THREE.MathUtils.radToDeg(2 * Math.atan(halfH / Math.max(.35, this.r.camera.position.distanceTo(target))));
    this.r.camera.up.copy(up);
    this.r.camera.lookAt(target);
    if (Math.abs(this.r.camera.fov - fov) > .01) {
      this.r.camera.fov = fov;
      this.r.camera.updateProjectionMatrix();
    }
    // Shift the lens to the free UI region without moving the camera into scenery or below the ground.
    const offsetX = view.width / 2 - (bounds.left - view.left + bounds.width / 2);
    const offsetY = view.height / 2 - (bounds.top - view.top + bounds.height / 2);
    const lens = this.r.camera.view;
    if (!lens?.enabled || lens.fullWidth !== view.width || lens.fullHeight !== view.height || lens.offsetX !== offsetX || lens.offsetY !== offsetY) {
      this.r.camera.setViewOffset(view.width, view.height, offsetX, offsetY, view.width, view.height);
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
      tormenta: this.tormenta.stats(),
      loot: this.loot.stats(),
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
