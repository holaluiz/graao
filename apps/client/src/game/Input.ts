/**
 * Desktop input: WASD move, mouse camera (pointer lock), Space jump, Shift sprint, LMB fire, RMB aim, E/Q weapon
 * slots, R reload, Enter ready (warmup), 1–4 abilities, Esc menu. On focus loss every held input is released so nothing stays stuck.
 */
export type Action =
  | 'forward' | 'back' | 'left' | 'right' | 'jump' | 'sprint' | 'fire' | 'aim'
  | 'weapon1' | 'weapon2' | 'ability1' | 'ability2' | 'ability3' | 'ultimate' | 'reload' | 'ready' | 'menu' | 'debug';

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
  Enter: 'ready',
  NumpadEnter: 'ready',
  Escape: 'menu',
  F3: 'debug',
};

export class Input {
  private readonly held = new Set<Action>();
  private readonly pressed = new Set<Action>();
  mouseDX = 0;
  mouseDY = 0;
  sensitivity = 0.0022;
  invertY = false;
  enabled = true;
  private readonly unsub: (() => void)[] = [];

  constructor(private readonly target: HTMLElement) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const on = (t: EventTarget, type: string, fn: (e: any) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(type, fn as EventListener, opts);
      this.unsub.push(() => t.removeEventListener(type, fn as EventListener, opts));
    };
    on(window, 'keydown', (e: KeyboardEvent) => {
      const a = KEYS[e.code];
      if (!a) return;
      // Typing a name or a room code is not gameplay (Enter would mark "ready", E/Q would switch weapons...).
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (a === 'debug' || (this.locked && ['jump', 'weapon1', 'weapon2', 'ability1', 'ability2', 'ability3', 'ultimate'].includes(a))) e.preventDefault();
      if (!e.repeat) this.pressed.add(a);
      this.held.add(a);
    });
    on(window, 'keyup', (e: KeyboardEvent) => {
      const a = KEYS[e.code];
      if (a) this.held.delete(a);
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
