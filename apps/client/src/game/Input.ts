/**
 * Desktop input: WASD move, mouse camera (pointer lock), Space jump, Shift sprint, LMB fire, RMB aim, E/Q weapon
 * slots, R reload, Enter ready (warmup), 1–4 abilities, F interact (open a chest, pick up), Z/X/C consumables (Vida,
 * Escudo, Mana), Tab scoreboard, Esc menu, Left/Right change spectator target. On focus loss every held input is
 * released so nothing stays stuck.
 */
export type Action =
  | 'forward' | 'back' | 'left' | 'right' | 'jump' | 'sprint' | 'fire' | 'aim'
  | 'weapon1' | 'weapon2' | 'ability1' | 'ability2' | 'ability3' | 'ultimate' | 'reload' | 'ready' | 'menu' | 'debug' | 'scoreboard'
  | 'interact' | 'item1' | 'item2' | 'item3' | 'spectatePrevious' | 'spectateNext';

const KEYS: Record<string, Action> = {
  KeyW: 'forward',
  KeyS: 'back',
  KeyA: 'left',
  KeyD: 'right',
  ArrowUp: 'forward',
  ArrowDown: 'back',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Space: 'jump',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  KeyE: 'weapon1',
  KeyQ: 'weapon2',
  Digit1: 'ability1',
  Digit2: 'ability2',
  Digit3: 'ability3',
  Digit4: 'ultimate',
  KeyR: 'reload',
  KeyF: 'interact',
  KeyZ: 'item1',
  KeyX: 'item2',
  KeyC: 'item3',
  Enter: 'ready',
  NumpadEnter: 'ready',
  Escape: 'menu',
  F3: 'debug',
  Tab: 'scoreboard',
};

export class Input {
  private readonly held = new Set<Action>();
  private readonly pressed = new Set<Action>();
  mouseDX = 0;
  mouseDY = 0;
  sensitivity = 0.0022;
  invertY = false;
  private inputEnabled = true;
  private allowScoreboard = false;
  private allowSpectator = false;
  private readonly unsub: (() => void)[] = [];

  constructor(private readonly target: HTMLElement) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const on = (t: EventTarget, type: string, fn: (e: any) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(type, fn as EventListener, opts);
      this.unsub.push(() => t.removeEventListener(type, fn as EventListener, opts));
    };
    on(window, 'keydown', (e: KeyboardEvent) => {
      let a = KEYS[e.code];
      if (!a) return;
      // Typing a name or a room code is not gameplay (Enter would mark "ready", E/Q would switch weapons...).
      if (e.target instanceof HTMLElement && (e.target.isContentEditable || e.target.closest('input, textarea, select, [role="textbox"]'))) return;
      if (this.allowSpectator && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
        // Arrow keys keep their native navigation on focused controls and while a menu has disabled gameplay.
        if (!this.enabled || (e.target instanceof HTMLElement && e.target.closest('button, a[href], [role="button"], [role="tab"], [role="menuitem"], [role="slider"], [role="spinbutton"], [role="listbox"], [role="combobox"], [role="option"]'))) return;
        e.preventDefault();
        a = e.code === 'ArrowLeft' ? 'spectatePrevious' : 'spectateNext';
        if (!e.repeat && !this.held.has(a)) this.pressed.add(a);
        this.held.add(a);
        return;
      }
      // Tab keeps its normal focus-navigation behavior in menus. In the match it only reveals a held overlay;
      // pointer lock stays with the game and keyup / blur / visibility loss all close it through the held set.
      if (a === 'scoreboard') {
        if (!this.enabled || !this.allowScoreboard) return;
        e.preventDefault();
      }
      // Space never scrolls or presses a focused button (it jumps, also out of the UFO without pointer lock).
      if (a === 'debug' || (a === 'jump' && this.enabled) || (this.locked && ['weapon1', 'weapon2', 'ability1', 'ability2', 'ability3', 'ultimate', 'interact', 'item1', 'item2', 'item3'].includes(a))) e.preventDefault();
      if (!e.repeat) this.pressed.add(a);
      this.held.add(a);
    });
    on(window, 'keyup', (e: KeyboardEvent) => {
      const a = KEYS[e.code];
      if (a) this.held.delete(a);
      const spectatorAction = e.code === 'ArrowLeft' ? 'spectatePrevious' : e.code === 'ArrowRight' ? 'spectateNext' : null;
      if (spectatorAction) this.held.delete(spectatorAction);
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
    this.held.clear();
    this.pressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
  }

  dispose(): void {
    for (const u of this.unsub) u();
  }
}
