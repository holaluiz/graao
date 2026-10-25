import { DEFAULT_BINDINGS, normalizeBindings, type KeyBindings, type RebindableAction } from './KeyBindings';

/**
 * Remappable desktop controls, fixed mouse/navigation shortcuts, and release on focus loss. Touch (TouchControls.ts)
 * presses the same actions and moves an analogue stick through this class: one set of gameplay intents for both.
 */
export type Action =
  | 'forward' | 'back' | 'left' | 'right' | 'jump' | 'sprint' | 'fire' | 'aim'
  | 'weapon1' | 'weapon2' | 'ability1' | 'ability2' | 'ability3' | 'ultimate' | 'reload' | 'ready' | 'menu' | 'debug' | 'scoreboard'
  | 'interact' | 'item1' | 'item2' | 'item3' | 'stats' | 'stat5' | 'spectatePrevious' | 'spectateNext'
  // The mouse wheel: the next weapon (wheel down) or the previous one (wheel up).
  | 'weaponNext' | 'weaponPrev';

/**
 * Wheel distance (px) that makes one step: a mouse notch is ~100 px (Firefox: 3 lines), a trackpad sends many small
 * deltas that add up. After a step the wheel rests a moment, longer for a trackpad, whose inertia keeps scrolling after
 * the swipe: one flick takes one step, not a run through the whole quick bar.
 */
const WHEEL_STEP_PX = 50;
const WHEEL_REST_MS = { notch: 90, trackpad: 320 };
/** A pause this long (ms) starts a new wheel gesture. */
const WHEEL_GESTURE_MS = 250;

const ALIASES: Record<string, RebindableAction> = {
  ArrowUp: 'forward',
  ArrowDown: 'back',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ShiftRight: 'sprint',
  NumpadEnter: 'ready',
};
const FIXED_KEYS: Record<string, Action> = {
  Escape: 'menu',
  F3: 'debug',
  Tab: 'scoreboard',
};

export class Input {
  private readonly held = new Set<Action>();
  private readonly pressed = new Set<Action>();
  private readonly keyboardHeld = new Map<string, Action>();
  /** Touch mode: actions held by on-screen buttons, the stick (x right, y forward, unit disc), the game engaged. */
  private touchMode = false;
  private touchEngaged = false;
  private readonly touchHeld = new Set<Action>();
  private readonly stick = { x: 0, y: 0 };
  /**
   * Free mouse: this page can never hold a pointer lock (an embedded web view answers WrongDocumentError). A click
   * still hands the controls to the game; the cursor stays free and the camera turns while a mouse button is held
   * (drag to look; the left button also fires, the right one aims).
   */
  private mouseFree = false;
  private freeEngaged = false;
  /** The controls were taken or given back without a pointer lock change (free mouse). */
  onEngageChange?: () => void;
  private currentBindings: KeyBindings = { ...DEFAULT_BINDINGS };
  private keys = new Map<string, Action>();
  mouseDX = 0;
  mouseDY = 0;
  sensitivity = 0.0022;
  invertY = false;
  private inputEnabled = true;
  private allowScoreboard = false;
  private allowSpectator = false;
  private wheelSum = 0;
  private wheelAt = -Infinity;
  private wheelRestUntil = -Infinity;
  private readonly unsub: (() => void)[] = [];

  constructor(private readonly target: HTMLElement) {
    this.setBindings(DEFAULT_BINDINGS);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const on = (t: EventTarget, type: string, fn: (e: any) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(type, fn as EventListener, opts);
      this.unsub.push(() => t.removeEventListener(type, fn as EventListener, opts));
    };
    on(window, 'keydown', (e: KeyboardEvent) => {
      let a: Action | undefined = this.allowSpectator && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')
        ? e.code === 'ArrowLeft' ? 'spectatePrevious' : 'spectateNext'
        : this.keys.get(e.code);
      if (!a) return;
      // Typing a name or a room code is not gameplay (Enter would mark "ready", E/Q would switch weapons...).
      if (e.target instanceof HTMLElement && (e.target.isContentEditable || e.target.closest('input, textarea, select, [role="textbox"]'))) return;
      if (!this.enabled) return;
      if (this.allowSpectator && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
        // Arrow keys keep their native navigation on focused controls and while a menu has disabled gameplay.
        if (!this.enabled || (e.target instanceof HTMLElement && e.target.closest('button, a[href], [role="button"], [role="tab"], [role="menuitem"], [role="slider"], [role="spinbutton"], [role="listbox"], [role="combobox"], [role="option"]'))) return;
        e.preventDefault();
        a = e.code === 'ArrowLeft' ? 'spectatePrevious' : 'spectateNext';
        this.pressCode(e.code, a, e.repeat);
        return;
      }
      // Tab keeps its normal focus-navigation behavior in menus. In the match it only reveals a held overlay;
      // pointer lock stays with the game and keyup / blur / visibility loss all close it through the held set.
      if (a === 'scoreboard') {
        if (!this.enabled || !this.allowScoreboard) return;
        e.preventDefault();
      }
      // A remapped Space still must not scroll/press a focused control; jumping also works without pointer lock.
      if (a === 'debug' || a === 'jump' || e.code === 'Space' || (this.locked && ['weapon1', 'weapon2', 'ability1', 'ability2', 'ability3', 'ultimate', 'interact', 'item1', 'item2', 'item3', 'stats', 'stat5'].includes(a))) e.preventDefault();
      this.pressCode(e.code, a, e.repeat);
    });
    on(window, 'keyup', (e: KeyboardEvent) => {
      this.releaseCode(e.code);
    });
    on(target, 'mousedown', (e: MouseEvent) => {
      if (!this.enabled) return;
      // Touch taps also emulate mouse clicks: in touch mode the fire button fires, never a tap on the world.
      if (!this.locked || this.touchMode) return;
      if (e.button === 0) {
        this.held.add('fire');
        this.pressed.add('fire');
      } else if (e.button === 2) this.held.add('aim');
    });
    on(window, 'mouseup', (e: MouseEvent) => {
      if (this.touchMode) return; // Compatibility mouse events must not release another finger's fire or aim.
      if (e.button === 0) this.held.delete('fire');
      else if (e.button === 2) this.held.delete('aim');
    });
    on(target, 'contextmenu', (e: Event) => e.preventDefault());
    on(window, 'wheel', (e: WheelEvent) => this.wheel(e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1), performance.now()), { passive: true });
    // Free mouse: the drag goes on outside the window while the button is held.
    on(target, 'pointerdown', (e: PointerEvent) => {
      if (this.mouseFree && this.freeEngaged && e.pointerType === 'mouse') target.setPointerCapture?.(e.pointerId);
    });
    on(window, 'mousemove', (e: MouseEvent) => {
      if (!this.locked || !this.enabled || this.touchMode) return;
      // Free mouse: only a drag turns the camera (a free cursor would run into the edge of the window).
      if (this.mouseFree && !(e.buttons & 3)) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    on(window, 'blur', () => {
      this.releaseAll();
      if (this.touchMode) this.setTouchEngaged(false);
    });
    on(document, 'visibilitychange', () => {
      if (document.hidden) {
        this.releaseAll();
        if (this.touchMode) this.setTouchEngaged(false);
      }
    });
    on(document, 'pointerlockchange', () => {
      if (!this.locked) this.releaseAll();
    });
  }

  /** The game owns the controls: pointer lock on desktop (or the free mouse), the engaged touch layer on a touch screen. */
  get locked(): boolean {
    return this.touchMode ? this.touchEngaged : this.mouseFree ? this.freeEngaged : document.pointerLockElement === this.target;
  }

  /** This page cannot lock the pointer: the camera turns by dragging (see `mouseFree`). */
  get freeMouse(): boolean {
    return this.mouseFree && !this.touchMode;
  }

  private setFreeEngaged(on: boolean): void {
    if (on === this.freeEngaged) return;
    this.freeEngaged = on;
    if (!on) this.releaseAll();
    this.onEngageChange?.();
  }

  private setTouchEngaged(on: boolean): void {
    if (on === this.touchEngaged) return;
    this.touchEngaged = on;
    if (!on) this.releaseAll();
    this.onEngageChange?.();
  }

  get touch(): boolean {
    return this.touchMode;
  }

  /** Switches to touch controls (the first touch of the screen, or `?touch`): no pointer lock from then on. */
  setTouchMode(on: boolean): void {
    if (on === this.touchMode) return;
    this.releaseAll();
    this.touchMode = on;
    this.touchEngaged = false;
  }

  /** An on-screen button went down: the action is held (and pressed once) like a key. */
  touchDown(action: Action): void {
    if (!this.enabled || this.touchHeld.has(action)) return;
    if (!this.held.has(action)) this.pressed.add(action);
    this.touchHeld.add(action);
    this.held.add(action);
  }

  touchUp(action: Action): void {
    if (!this.touchHeld.delete(action)) return;
    if (![...this.keyboardHeld.values()].includes(action)) this.held.delete(action);
  }

  isTouchHeld(action: Action): boolean {
    return this.touchHeld.has(action);
  }

  /** The touch stick, clamped to the unit disc (x right, y forward). */
  setStick(x: number, y: number): void {
    const l = Math.hypot(x, y);
    const k = l > 1 ? 1 / l : 1;
    this.stick.x = this.enabled ? x * k : 0;
    this.stick.y = this.enabled ? y * k : 0;
  }

  /** A camera drag on the touch screen, in pixels (the same look path as the mouse). */
  addLook(dx: number, dy: number): void {
    if (!this.enabled) return;
    this.mouseDX += dx;
    this.mouseDY += dy;
  }

  /**
   * Movement intent (x right, y forward): the keys give ±1 per axis, the touch stick an analogue value; together they
   * are clamped to the unit disc.
   */
  moveAxis(): { x: number; y: number } {
    let x = this.enabled ? this.stick.x : 0;
    let y = this.enabled ? this.stick.y : 0;
    if (this.isDown('forward')) y += 1;
    if (this.isDown('back')) y -= 1;
    if (this.isDown('right')) x += 1;
    if (this.isDown('left')) x -= 1;
    const l = Math.hypot(x, y);
    return l > 1 ? { x: x / l, y: y / l } : { x, y };
  }

  get bindings(): KeyBindings {
    return { ...this.currentBindings };
  }

  keyFor(action: RebindableAction): string {
    return this.currentBindings[action];
  }

  setBindings(bindings: Readonly<KeyBindings>): void {
    this.releaseAll();
    this.currentBindings = normalizeBindings(bindings);
    this.keys = new Map(Object.entries(this.currentBindings).map(([action, code]) => [code, action as RebindableAction]));
    // Legacy aliases follow only unchanged defaults; an explicit remapping always owns its key.
    for (const [code, action] of Object.entries(ALIASES)) {
      if (!this.keys.has(code) && this.currentBindings[action] === DEFAULT_BINDINGS[action]) this.keys.set(code, action);
    }
    for (const [code, action] of Object.entries(FIXED_KEYS)) this.keys.set(code, action);
    // The attribute panel's fifth row (Energia): Digit5, unless a remapping already owns that key.
    if (!this.keys.has('Digit5')) this.keys.set('Digit5', 'stat5');
  }

  /** A wheel movement of `dy` px (down positive) at `now` ms: steps the weapon while the game has the controls. */
  wheel(dy: number, now: number): void {
    if (!this.locked || !this.enabled || this.touchMode || !dy) return;
    const notch = Math.abs(dy) >= 40;
    if (now < this.wheelRestUntil) {
      // Resting after a step; a trackpad still streaming its inertia keeps it resting.
      if (!notch) this.wheelRestUntil = now + WHEEL_REST_MS.trackpad;
      this.wheelSum = 0;
      return;
    }
    if (now - this.wheelAt > WHEEL_GESTURE_MS || Math.sign(dy) !== Math.sign(this.wheelSum)) this.wheelSum = 0;
    this.wheelAt = now;
    this.wheelSum += dy;
    if (Math.abs(this.wheelSum) < WHEEL_STEP_PX) return;
    this.pressed.add(this.wheelSum > 0 ? 'weaponNext' : 'weaponPrev');
    this.wheelSum = 0;
    this.wheelRestUntil = now + (notch ? WHEEL_REST_MS.notch : WHEEL_REST_MS.trackpad);
  }

  private pressCode(code: string, action: Action, repeat: boolean): void {
    if (this.keyboardHeld.has(code)) return;
    if (!repeat && !this.held.has(action)) this.pressed.add(action);
    this.keyboardHeld.set(code, action);
    this.held.add(action);
  }

  private releaseCode(code: string): void {
    const action = this.keyboardHeld.get(code);
    this.keyboardHeld.delete(code);
    if (action && ![...this.keyboardHeld.values()].includes(action) && !this.touchHeld.has(action)) this.held.delete(action);
  }

  get enabled(): boolean {
    return this.inputEnabled;
  }

  set enabled(enabled: boolean) {
    this.inputEnabled = enabled;
    if (!enabled) this.releaseAll();
  }

  /** Left/Right change the followed player only while the spectator HUD is active. */
  set spectatorEnabled(enabled: boolean) {
    if (enabled !== this.allowSpectator) {
      this.releaseCode('ArrowLeft');
      this.releaseCode('ArrowRight');
      for (const action of ['spectatePrevious', 'spectateNext'] as const) {
        this.held.delete(action);
        this.pressed.delete(action);
      }
    }
    this.allowSpectator = enabled;
  }

  get spectatorEnabled(): boolean {
    return this.allowSpectator;
  }

  /** The UI controller enables Tab only while the live match is on screen. */
  set scoreboardEnabled(enabled: boolean) {
    this.allowScoreboard = enabled;
    if (!enabled) {
      this.touchUp('scoreboard');
      this.releaseCode('Tab');
      this.held.delete('scoreboard');
      this.pressed.delete('scoreboard');
    }
  }

  get scoreboardEnabled(): boolean {
    return this.allowScoreboard;
  }

  requestLock(): void {
    if (this.touchMode) {
      this.setTouchEngaged(true);
      return;
    }
    if (this.mouseFree || typeof this.target.requestPointerLock !== 'function') {
      this.mouseFree = true;
      this.setFreeEngaged(true);
      return;
    }
    if (this.locked) return;
    // Browsers refuse pointer lock without a user gesture or right after leaving it; that is expected, not an error.
    // A page that can never lock it (an embedded web view) switches to the free mouse.
    const p = this.target.requestPointerLock() as Promise<void> | undefined;
    p?.catch?.((e: unknown) => {
      const name = (e as { name?: string } | null)?.name;
      if (name !== 'WrongDocumentError' && name !== 'NotSupportedError') return;
      this.mouseFree = true;
      this.setFreeEngaged(true);
    });
  }

  exitLock(): void {
    if (this.touchMode) {
      this.setTouchEngaged(false);
      return;
    }
    if (this.mouseFree) {
      this.setFreeEngaged(false);
      return;
    }
    if (this.locked) document.exitPointerLock();
  }

  isDown(a: Action): boolean {
    return this.enabled && this.held.has(a);
  }

  /** True once per key press (consumed). */
  consume(a: Action): boolean {
    const had = this.pressed.has(a);
    this.pressed.delete(a);
    return had && this.enabled;
  }

  /** Camera look delta since last call (radians), with sensitivity applied. */
  takeLook(): { yaw: number; pitch: number } {
    const yaw = -this.mouseDX * this.sensitivity;
    const pitch = -this.mouseDY * this.sensitivity * (this.invertY ? -1 : 1);
    this.mouseDX = 0;
    this.mouseDY = 0;
    return { yaw, pitch };
  }

  releaseAll(): void {
    this.keyboardHeld.clear();
    this.touchHeld.clear();
    this.stick.x = 0;
    this.stick.y = 0;
    this.held.clear();
    this.pressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
  }

  dispose(): void {
    for (const u of this.unsub) u();
  }
}
