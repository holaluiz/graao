import { DEFAULT_BINDINGS, normalizeBindings, type KeyBindings, type RebindableAction } from './KeyBindings';

/** Remappable desktop controls, fixed mouse/navigation shortcuts, and release on focus loss. */
export type Action =
  | 'forward' | 'back' | 'left' | 'right' | 'jump' | 'sprint' | 'fire' | 'aim'
  | 'weapon1' | 'weapon2' | 'holster' | 'ability1' | 'ability2' | 'ability3' | 'ultimate' | 'reload' | 'ready' | 'menu' | 'debug' | 'scoreboard'
  | 'interact' | 'item1' | 'item2' | 'item3' | 'stats' | 'stat5' | 'spectatePrevious' | 'spectateNext';

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
  private currentBindings: KeyBindings = { ...DEFAULT_BINDINGS };
  private keys = new Map<string, Action>();
  mouseDX = 0;
  mouseDY = 0;
  sensitivity = 0.0022;
  invertY = false;
  private inputEnabled = true;
  private allowScoreboard = false;
  private allowSpectator = false;
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
      if (a === 'debug' || a === 'jump' || e.code === 'Space' || (this.locked && ['weapon1', 'weapon2', 'holster', 'ability1', 'ability2', 'ability3', 'ultimate', 'interact', 'item1', 'item2', 'item3', 'stats', 'stat5'].includes(a))) e.preventDefault();
      this.pressCode(e.code, a, e.repeat);
    });
    on(window, 'keyup', (e: KeyboardEvent) => {
      this.releaseCode(e.code);
    });
    on(target, 'mousedown', (e: MouseEvent) => {
      if (!this.enabled) return;
      if (!this.locked) return;
      if (e.button === 0) {
        this.held.add('fire');
        this.pressed.add('fire');
      } else if (e.button === 2) this.held.add('aim');
    });
    on(window, 'mouseup', (e: MouseEvent) => {
      if (e.button === 0) this.held.delete('fire');
      else if (e.button === 2) this.held.delete('aim');
    });
    on(target, 'contextmenu', (e: Event) => e.preventDefault());
    on(window, 'mousemove', (e: MouseEvent) => {
      if (!this.locked || !this.enabled) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    on(window, 'blur', () => this.releaseAll());
    on(document, 'visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    });
    on(document, 'pointerlockchange', () => {
      if (!this.locked) this.releaseAll();
    });
  }

  get locked(): boolean {
    return document.pointerLockElement === this.target;
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

  private pressCode(code: string, action: Action, repeat: boolean): void {
    if (this.keyboardHeld.has(code)) return;
    if (!repeat && !this.held.has(action)) this.pressed.add(action);
    this.keyboardHeld.set(code, action);
    this.held.add(action);
  }

  private releaseCode(code: string): void {
    const action = this.keyboardHeld.get(code);
    this.keyboardHeld.delete(code);
    if (action && ![...this.keyboardHeld.values()].includes(action)) this.held.delete(action);
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
      this.releaseCode('Tab');
      this.held.delete('scoreboard');
      this.pressed.delete('scoreboard');
    }
  }

  get scoreboardEnabled(): boolean {
    return this.allowScoreboard;
  }

  requestLock(): void {
    if (this.locked) return;
    // Browsers refuse pointer lock without a user gesture; that is expected, not an error.
    const p = this.target.requestPointerLock?.() as Promise<void> | undefined;
    p?.catch?.(() => {});
  }

  exitLock(): void {
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
    this.held.clear();
    this.pressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
  }

  dispose(): void {
    for (const u of this.unsub) u();
  }
}
