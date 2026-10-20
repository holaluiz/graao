/**
 * Touch controls (docs/gameplay/TRAVERSAL_STATES.md "Toque"): a floating analogue stick on the left, a camera drag on
 * the rest of the screen, and buttons on the right. Every control only presses Input actions or moves its stick — the
 * same gameplay intents the keyboard and mouse send, through the same LocalPlayer and server path (no second physics).
 *
 * - Stick: walk in the camera frame; pushed to the rim it runs (sprint held).
 * - PULAR: held like Space. In the air, holding it opens the kite (the label says PLANAR when that would happen).
 * - One contextual button for the traversal and the world, never five: SUBIR on a ledge (jump: pull up), SOLTAR on a
 *   wall (sprint: let go), ABRIR/USAR/PEGAR at a chest, a door or a bell (interact), ESCALAR/AGARRAR facing a face or an
 *   edge within a jump's reach (jump while pushing toward it); hidden otherwise.
 * - Combat: ATIRAR (held), MIRAR (toggle), RECARREGAR; the HUD's own ability slots, weapon cards and item belt are
 *   the buttons for the abilities, the weapons and the consumables (no second copy of them on screen), laid out for a
 *   thumb by `body.touch-ui` (touch.css).
 * - ☰ opens the options (the ESC menu).
 *
 * The game is played in landscape on a phone: the first touch asks for fullscreen and locks the orientation to
 * landscape where the browser allows it (Android); in portrait on a touch screen a full-screen "gire o celular" card
 * covers everything (touch.css) until the phone is turned, with a button that tries the lock again.
 */
import { TRAVERSAL, TraversalMode } from '@graao/game-data';
import type { Action, Input } from './Input';
import '../styles/touch.css';

/** What the contextual button can do now. */
export type TouchActionKind = 'mantle' | 'drop' | 'interact' | 'climb';

export interface TouchContext {
  traversal: number;
  grounded: boolean;
  /** Falling with the kite available (glide time and stamina left, high enough): holding jump would open it. */
  canGlide: boolean;
  /** The interaction prompt on screen (chest, door, bell, item), or null. */
  prompt: string | null;
  /** A climbable face, or an edge within a jump's reach, in front of the character (on foot). */
  wallAhead: 'climb' | 'ledge' | null;
  alive: boolean;
}

/** The contextual button for this moment (null: hidden), by priority: the wall or ledge the hands are on, the world, the wall ahead. */
export function touchAction(c: TouchContext): { label: string; kind: TouchActionKind } | null {
  if (!c.alive) return null;
  if (c.traversal === TraversalMode.HANG) return { label: 'SUBIR', kind: 'mantle' };
  if (c.traversal === TraversalMode.CLIMB) return { label: 'SOLTAR', kind: 'drop' };
  if (c.traversal !== TraversalMode.NONE) return null;
  if (c.prompt) return { label: promptLabel(c.prompt), kind: 'interact' };
  if (c.wallAhead && c.grounded) return { label: c.wallAhead === 'climb' ? 'ESCALAR' : 'AGARRAR', kind: 'climb' };
  return null;
}

/** The jump button's label: what holding it does now. */
export function jumpLabel(c: TouchContext): string {
  if (c.traversal === TraversalMode.GLIDE) return 'PLANANDO';
  if (!c.grounded && c.traversal === TraversalMode.NONE && c.canGlide) return 'PLANAR';
  return 'PULAR';
}

/** A short verb for the button from the prompt's action ("Abrir baú" → ABRIR). */
function promptLabel(prompt: string): string {
  const verb = prompt.trim().split(/\s+/)[0] ?? 'USAR';
  return verb.toUpperCase().slice(0, 9);
}

/** Pixels of drag → the mouse's pixels (Input.takeLook applies the look sensitivity on top). */
const LOOK_GAIN = 2.2;
/** Stick radius (px) and the share of it past which the character runs. */
const STICK_R = 56;
const RUN_AT = 0.92;

/** Keeps a finger's moves on `target` (a pointer the browser no longer tracks can't be captured: harmless). */
function capture(target: Element, pointerId: number): void {
  try {
    target.setPointerCapture?.(pointerId);
  } catch {
    // Not an active pointer (already lifted, or synthetic).
  }
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text) e.textContent = text;
  parent?.append(e);
  return e;
};

export class TouchControls {
  readonly root = el('div', 'touch');
  private readonly stickBase = el('div', 'touch-stick', this.root);
  private readonly stickKnob = el('div', 'touch-knob', this.stickBase);
  private readonly look = el('div', 'touch-look', this.root);
  private readonly pad = el('div', 'touch-pad', this.root);
  private readonly jump: HTMLButtonElement;
  private readonly action: HTMLButtonElement;
  private readonly aim: HTMLButtonElement;
  private enabled = false;
  private stickId = -1;
  private stickOrigin = { x: 0, y: 0 };
  private lookId = -1;
  private lookLast = { x: 0, y: 0 };
  private aiming = false;
  private context: TouchContext = { traversal: TraversalMode.NONE, grounded: true, canGlide: false, prompt: null, wallAhead: null, alive: true };
  private actionKind: TouchActionKind | null = null;
  /** A short forward push after ESCALAR, so a tap climbs even with the stick at rest (s left). */
  private pushFor = 0;
  /** Buttons tapped (pressed then let go a moment later), with the time left (s). */
  private readonly taps = new Map<Action, number>();
  /** Portrait on a touch screen: "turn the phone" (shown by CSS, over everything). */
  private readonly rotate = el('div', 'rotate-hint');

  constructor(private readonly input: Input, private readonly mount: HTMLElement, private readonly hooks: { pause: () => void }) {
    this.root.hidden = true;
    mount.prepend(this.root);
    const menu = this.button('touch-menu', '☰', () => this.hooks.pause());
    menu.setAttribute('aria-label', 'Opções');
    this.root.append(menu);
    this.jump = this.hold('touch-jump', 'PULAR', 'jump');
    this.action = this.button('touch-action', '', () => this.onAction());
    this.action.hidden = true;
    this.pad.append(this.hold('touch-fire', 'ATIRAR', 'fire'), this.jump, this.action);
    this.aim = this.button('touch-aim', 'MIRAR', () => this.toggleAim());
    this.pad.append(this.aim, this.button('touch-reload', 'RECARREGAR', () => this.tap('reload')));
    this.bindStick();
    this.bindLook();
    this.bindHud();
    const card = el('div', 'rotate-card', this.rotate);
    el('div', 'rotate-phone', card);
    el('p', 'rotate-title', card, 'Gire o celular');
    el('p', 'rotate-note', card, 'O graao é jogado na horizontal.');
    const again = el('button', 'rotate-btn', card, 'Tela cheia na horizontal');
    again.type = 'button';
    again.addEventListener('click', () => void this.lockLandscape());
    document.body.append(this.rotate);
  }

  /**
   * Fullscreen and a landscape lock (inside a user gesture: a touch). Browsers that refuse either (iPhone Safari, a
   * desktop) keep the rotate card for portrait; nothing else depends on it.
   */
  async lockLandscape(): Promise<void> {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
    } catch {
      // No fullscreen here (iPhone, an iframe without permission): the rotate card asks instead.
    }
    try {
      await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape');
    } catch {
      // No orientation lock outside fullscreen or on this browser.
    }
  }

  /** Touch mode on (the first touch of the screen, or `?touch`): the layer shows in matches from now on. */
  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.input.setTouchMode(true);
    document.body.classList.add('touch-ui');
  }

  get active(): boolean {
    return this.enabled;
  }

  /** Shown during the match (not under a menu); hiding lets go of everything it held. */
  show(on: boolean): void {
    const visible = this.enabled && on;
    if (this.root.hidden === !visible) return;
    this.root.hidden = !visible;
    if (!visible) this.releaseAll();
  }

  /** Per frame: labels from the local state, taps let go, the push after ESCALAR. */
  update(dt: number, context: TouchContext): void {
    if (!this.enabled || this.root.hidden) return;
    this.context = context;
    for (const [a, left] of this.taps) {
      if (left - dt <= 0) {
        this.taps.delete(a);
        this.input.touchUp(a);
      } else this.taps.set(a, left - dt);
    }
    if (this.pushFor > 0) {
      this.pushFor -= dt;
      if (this.stickId < 0) this.input.setStick(0, this.pushFor > 0 ? 1 : 0);
    }
    const act = touchAction(context);
    this.actionKind = act?.kind ?? null;
    this.action.hidden = !act;
    if (act && this.action.textContent !== act.label) this.action.textContent = act.label;
    const jl = jumpLabel(context);
    if (this.jump.textContent !== jl) this.jump.textContent = jl;
    this.jump.classList.toggle('glide', jl !== 'PULAR');
    this.root.classList.toggle('dead', !context.alive);
  }

  private onAction(): void {
    switch (this.actionKind) {
      case 'mantle':
        return this.tap('jump');
      case 'drop':
        // A fresh sprint press lets go of the wall (tap releases first: even while the stick holds sprint).
        return this.tap('sprint');
      case 'interact':
        return this.tap('interact');
      case 'climb':
        this.pushFor = 0.45;
        return this.tap('jump');
      default:
    }
  }

  private toggleAim(): void {
    this.aiming = !this.aiming;
    if (this.aiming) this.input.touchDown('aim');
    else this.input.touchUp('aim');
    this.aim.classList.toggle('on', this.aiming);
  }

  /** Presses an action for a moment (a key tapped). */
  private tap(a: Action): void {
    this.input.touchUp(a);
    this.input.touchDown(a);
    this.taps.set(a, 0.12);
  }

  private releaseAll(): void {
    for (const a of this.taps.keys()) this.input.touchUp(a);
    this.taps.clear();
    for (const a of ['jump', 'fire', 'aim', 'sprint'] as const) this.input.touchUp(a);
    this.aiming = false;
    this.aim.classList.remove('on');
    this.stickId = -1;
    this.lookId = -1;
    this.pushFor = 0;
    this.input.setStick(0, 0);
    this.stickBase.classList.remove('on');
  }

  private button(cls: string, label: string, onPress: () => void): HTMLButtonElement {
    const b = el('button', `touch-btn ${cls}`, undefined, label);
    b.type = 'button';
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.input.requestLock();
      onPress();
      b.classList.add('down');
    });
    const up = () => b.classList.remove('down');
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    return b;
  }

  /** A button held for as long as the finger stays on it. */
  private hold(cls: string, label: string, action: Action): HTMLButtonElement {
    const b = this.button(cls, label, () => this.input.touchDown(action));
    const release = () => this.input.touchUp(action);
    b.addEventListener('pointerup', release);
    b.addEventListener('pointercancel', release);
    b.addEventListener('lostpointercapture', release);
    b.addEventListener('pointerdown', (e) => capture(b, e.pointerId));
    return b;
  }

  /**
   * The HUD as buttons: an ability slot casts it (1, 2, 3, Suprema), a weapon card takes that weapon (Q, E),
   * an item of the belt is used — the same actions as their keys.
   */
  private bindHud(): void {
    const groups: [string, readonly Action[]][] = [
      ['.abilities .ab-slot', ['ability1', 'ability2', 'ability3', 'ultimate']],
      ['.weapons .slot', ['weapon2', 'weapon1']],
      ['.loot-belt .belt-slot', ['item1', 'item2', 'item3']],
    ];
    this.mount.addEventListener('pointerdown', (e) => {
      if (!this.enabled || this.root.hidden || !(e.target instanceof Element)) return;
      for (const [sel, actions] of groups) {
        const hit = e.target.closest(sel);
        if (!hit) continue;
        const action = actions[[...this.mount.querySelectorAll(sel)].indexOf(hit)];
        if (!action) return;
        e.preventDefault();
        this.input.requestLock();
        this.tap(action);
        return;
      }
    });
  }

  private bindStick(): void {
    const zone = el('div', 'touch-stick-zone', this.root);
    zone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.input.requestLock();
      if (this.stickId >= 0) return;
      this.stickId = e.pointerId;
      this.stickOrigin = { x: e.clientX, y: e.clientY };
      capture(zone, e.pointerId);
      this.stickBase.style.left = `${e.clientX}px`;
      this.stickBase.style.top = `${e.clientY}px`;
      this.stickBase.classList.add('on');
      this.moveStick(e.clientX, e.clientY);
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickId) this.moveStick(e.clientX, e.clientY);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = -1;
      this.stickBase.classList.remove('on');
      this.stickKnob.style.transform = '';
      this.input.setStick(0, 0);
      this.input.touchUp('sprint');
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  private moveStick(x: number, y: number): void {
    let dx = (x - this.stickOrigin.x) / STICK_R;
    let dy = (y - this.stickOrigin.y) / STICK_R;
    const l = Math.hypot(dx, dy);
    if (l > 1) {
      dx /= l;
      dy /= l;
    }
    this.stickKnob.style.transform = `translate(${dx * STICK_R}px, ${dy * STICK_R}px)`;
    this.input.setStick(dx, -dy);
    if (l >= RUN_AT) this.input.touchDown('sprint');
    else this.input.touchUp('sprint');
  }

  private bindLook(): void {
    this.look.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.input.requestLock();
      if (this.lookId >= 0) return;
      this.lookId = e.pointerId;
      this.lookLast = { x: e.clientX, y: e.clientY };
      capture(this.look, e.pointerId);
    });
    this.look.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookId) return;
      this.input.addLook((e.clientX - this.lookLast.x) * LOOK_GAIN, (e.clientY - this.lookLast.y) * LOOK_GAIN);
      this.lookLast = { x: e.clientX, y: e.clientY };
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId === this.lookId) this.lookId = -1;
    };
    this.look.addEventListener('pointerup', end);
    this.look.addEventListener('pointercancel', end);
  }
}

/** Is the kite available to a falling character (mirrors the motor's opening rule, without the clearance ray)? */
export const glideAvailable = (s: { grounded: boolean; traversal: number; stamina: number; glideSteps: number; vel: { x: number; y: number; z: number }; pos: { x: number; y: number; z: number } }, glideSteps: number): boolean => {
  if (s.grounded || s.traversal !== TraversalMode.NONE) return false;
  const l = Math.hypot(s.pos.x, s.pos.y, s.pos.z) || 1;
  const vs = (s.vel.x * s.pos.x + s.vel.y * s.pos.y + s.vel.z * s.pos.z) / l;
  return vs < -TRAVERSAL.glide.minFallSpeed && s.glideSteps < glideSteps && s.stamina >= TRAVERSAL.stamina.minGlide;
};
