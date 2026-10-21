import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Input } from './Input';
import { DEFAULT_BINDINGS } from './KeyBindings';

class ElementStub extends EventTarget {
  isContentEditable = false;
  parent: ElementStub | null = null;

  constructor(readonly tag = 'div', readonly role = '') { super(); }

  closest(selector: string): ElementStub | null {
    const matches = selector.split(',').some((part) => {
      const value = part.trim();
      return value === this.tag || value === `[role="${this.role}"]` || (value === 'a[href]' && this.tag === 'a');
    });
    return matches ? this : this.parent?.closest(selector) ?? null;
  }
}

class DocumentStub extends EventTarget {
  hidden = false;
  pointerLockElement: ElementStub | null = null;
}

describe('desktop keyboard input', () => {
  let keyboard: EventTarget;
  let documentStub: DocumentStub;
  let surface: ElementStub;
  let input: Input;

  function key(code: string, type = 'keydown', target = surface, repeat = false): Event {
    const event = new Event(type, { cancelable: true });
    Object.defineProperties(event, { code: { value: code }, repeat: { value: repeat }, target: { value: target } });
    keyboard.dispatchEvent(event);
    return event;
  }

  beforeEach(() => {
    keyboard = new EventTarget();
    documentStub = new DocumentStub();
    surface = new ElementStub('canvas');
    vi.stubGlobal('window', keyboard);
    vi.stubGlobal('document', documentStub);
    vi.stubGlobal('HTMLElement', ElementStub);
    input = new Input(surface as unknown as HTMLElement);
  });

  afterEach(() => {
    input.dispose();
    vi.unstubAllGlobals();
  });

  it('keeps normal arrow movement until spectator mode is enabled', () => {
    expect(key('ArrowLeft').defaultPrevented).toBe(false);
    expect(input.isDown('left')).toBe(true);
    expect(input.consume('spectatePrevious')).toBe(false);
    key('ArrowLeft', 'keyup');
    expect(input.isDown('left')).toBe(false);
    key('ArrowRight');
    expect(input.isDown('right')).toBe(true);
  });

  it('changes targets once per press and prevents arrow scrolling without producing movement', () => {
    input.spectatorEnabled = true;
    expect(key('ArrowLeft').defaultPrevented).toBe(true);
    expect(input.consume('spectatePrevious')).toBe(true);
    expect(input.consume('spectatePrevious')).toBe(false);
    expect(key('ArrowLeft', 'keydown', surface, true).defaultPrevented).toBe(true);
    expect(input.consume('spectatePrevious')).toBe(false);
    expect(input.isDown('left')).toBe(false);
    key('ArrowLeft', 'keyup');
    key('ArrowLeft');
    expect(input.consume('spectatePrevious')).toBe(true);
    key('ArrowRight');
    expect(input.consume('spectateNext')).toBe(true);
    expect(input.isDown('right')).toBe(false);
  });

  it('preserves WASD, Tab scoreboard and Escape while spectating', () => {
    key('KeyA');
    input.spectatorEnabled = true;
    input.scoreboardEnabled = true;
    expect(input.isDown('left')).toBe(true);
    key('KeyW');
    key('KeyS');
    key('KeyD');
    expect(['forward', 'back', 'right'].map((action) => input.isDown(action as 'forward' | 'back' | 'right'))).toEqual([true, true, true]);
    expect(key('Tab').defaultPrevented).toBe(true);
    expect(input.isDown('scoreboard')).toBe(true);
    key('Escape');
    expect(input.consume('menu')).toBe(true);
  });

  it.each([
    ['input', ''], ['textarea', ''], ['select', ''], ['div', 'textbox'], ['button', ''],
    ['span', 'button'], ['a', ''], ['div', 'tab'], ['div', 'slider'], ['div', 'combobox'],
  ])('leaves native arrow behavior on focused %s %s controls', (tag, role) => {
    input.spectatorEnabled = true;
    const control = new ElementStub(tag, role);
    const child = new ElementStub('span');
    child.parent = control;
    expect(key('ArrowRight', 'keydown', child).defaultPrevented).toBe(false);
    expect(input.consume('spectateNext')).toBe(false);
    expect(input.isDown('right')).toBe(false);
  });

  it('ignores editable content and disabled menus, clearing pending actions when disabled', () => {
    input.spectatorEnabled = true;
    const editable = new ElementStub();
    editable.isContentEditable = true;
    expect(key('ArrowLeft', 'keydown', editable).defaultPrevented).toBe(false);
    expect(input.consume('spectatePrevious')).toBe(false);
    key('ArrowLeft');
    input.enabled = false;
    expect(key('ArrowRight').defaultPrevented).toBe(false);
    input.enabled = true;
    expect(input.isDown('spectatePrevious')).toBe(false);
    expect(input.consume('spectatePrevious')).toBe(false);
    expect(input.consume('spectateNext')).toBe(false);
  });

  it('keeps a quick complete tap until the next frame consumes it exactly once', () => {
    input.spectatorEnabled = true;
    key('ArrowRight');
    key('ArrowRight', 'keyup');
    expect(input.isDown('spectateNext')).toBe(false);
    expect(input.consume('spectateNext')).toBe(true);
    expect(input.consume('spectateNext')).toBe(false);
  });

  it('clears pending spectator input when leaving spectator mode', () => {
    input.spectatorEnabled = true;
    key('ArrowLeft');
    key('ArrowLeft', 'keyup');
    input.spectatorEnabled = false;
    input.spectatorEnabled = true;
    expect(input.consume('spectatePrevious')).toBe(false);
    expect(input.isDown('spectatePrevious')).toBe(false);
  });

  it.each(['release', 'blur', 'visibility', 'pointerlock'])('releases pending target changes on %s', (reason) => {
    input.spectatorEnabled = true;
    key('ArrowRight');
    if (reason === 'release') input.releaseAll();
    else if (reason === 'blur') keyboard.dispatchEvent(new Event('blur'));
    else if (reason === 'visibility') {
      documentStub.hidden = true;
      documentStub.dispatchEvent(new Event('visibilitychange'));
    } else documentStub.dispatchEvent(new Event('pointerlockchange'));
    expect(input.consume('spectateNext')).toBe(false);
    expect(input.isDown('spectateNext')).toBe(false);
  });

  it('remaps movement and actions immediately, including their keyup', () => {
    input.setBindings({ ...DEFAULT_BINDINGS, forward: 'KeyI', jump: 'KeyJ', reload: 'KeyK' });
    key('KeyW');
    key('ArrowUp');
    key('Space');
    key('KeyR');
    expect(input.isDown('forward')).toBe(false);
    expect(input.consume('jump')).toBe(false);
    expect(input.consume('reload')).toBe(false);
    key('KeyI');
    key('KeyJ');
    key('KeyK');
    expect(input.isDown('forward')).toBe(true);
    expect(input.consume('jump')).toBe(true);
    expect(input.consume('reload')).toBe(true);
    key('KeyI', 'keyup');
    expect(input.isDown('forward')).toBe(false);
    expect(input.keyFor('forward')).toBe('KeyI');
  });

  it('keeps an action held when one of two physical keys is released', () => {
    key('KeyW');
    expect(input.consume('forward')).toBe(true);
    key('ArrowUp');
    expect(input.consume('forward')).toBe(false);
    key('KeyW', 'keyup');
    expect(input.isDown('forward')).toBe(true);
    key('ArrowUp', 'keyup');
    expect(input.isDown('forward')).toBe(false);
    key('ShiftLeft');
    key('ShiftRight');
    key('ShiftRight', 'keyup');
    expect(input.isDown('sprint')).toBe(true);
    key('ShiftLeft', 'keyup');
    expect(input.isDown('sprint')).toBe(false);
  });

  it('gives explicit keys priority over the default sprint and ready aliases', () => {
    input.setBindings({ ...DEFAULT_BINDINGS, jump: 'ShiftRight', interact: 'NumpadEnter' });
    key('ShiftRight');
    key('NumpadEnter');
    expect(input.consume('jump')).toBe(true);
    expect(input.consume('interact')).toBe(true);
    expect(input.isDown('sprint')).toBe(false);
    expect(input.consume('ready')).toBe(false);
    key('ShiftLeft');
    key('Enter');
    expect(input.isDown('sprint')).toBe(true);
    expect(input.consume('ready')).toBe(true);
  });

  it('retires aliases when their original action is remapped', () => {
    input.setBindings({ ...DEFAULT_BINDINGS, sprint: 'ControlLeft', ready: 'KeyP', left: 'KeyH' });
    key('ShiftRight');
    key('NumpadEnter');
    key('ArrowLeft');
    expect(input.isDown('sprint')).toBe(false);
    expect(input.consume('ready')).toBe(false);
    expect(input.isDown('left')).toBe(false);
    input.spectatorEnabled = true;
    key('ArrowLeft');
    expect(input.consume('spectatePrevious')).toBe(true);
    key('ControlLeft');
    key('KeyP');
    expect(input.isDown('sprint')).toBe(true);
    expect(input.consume('ready')).toBe(true);
  });

  it('clears held keys, pending taps and camera motion when bindings change', () => {
    key('KeyW');
    key('Space');
    key('Space', 'keyup');
    input.mouseDX = 100;
    input.mouseDY = 30;
    const bindings = { ...DEFAULT_BINDINGS, forward: 'KeyI' };
    input.setBindings(bindings);
    bindings.forward = 'KeyT';
    const snapshot = input.bindings;
    snapshot.forward = 'KeyO';
    expect(input.keyFor('forward')).toBe('KeyI');
    expect(input.isDown('forward')).toBe(false);
    expect(input.consume('jump')).toBe(false);
    expect(input.takeLook()).toEqual({ yaw: -0, pitch: -0 });
    key('KeyW', 'keyup');
    key('KeyI');
    expect(input.isDown('forward')).toBe(true);
  });

  it('consumes a remapped rapid tap once and ignores key repeat', () => {
    input.setBindings({ ...DEFAULT_BINDINGS, jump: 'KeyJ' });
    key('KeyJ');
    key('KeyJ', 'keydown', surface, true);
    key('KeyJ', 'keyup');
    expect(input.isDown('jump')).toBe(false);
    expect(input.consume('jump')).toBe(true);
    expect(input.consume('jump')).toBe(false);
  });

  it('prevents Space activating a focused button even when assigned to another action', () => {
    input.setBindings({ ...DEFAULT_BINDINGS, jump: 'KeyJ', ready: 'Space' });
    const button = new ElementStub('button');
    expect(key('Space', 'keydown', button).defaultPrevented).toBe(true);
    expect(input.consume('ready')).toBe(true);
    expect(input.consume('jump')).toBe(false);
  });

  it('does not carry keys typed in disabled menus or text fields into gameplay', () => {
    input.enabled = false;
    key('KeyW');
    key('Space');
    input.enabled = true;
    expect(input.isDown('forward')).toBe(false);
    expect(input.consume('jump')).toBe(false);
    const textbox = new ElementStub('input');
    key('KeyW', 'keydown', textbox);
    expect(input.isDown('forward')).toBe(false);
  });

  it('keeps fire and aim fixed to the locked game mouse after remapping', () => {
    input.setBindings({ ...DEFAULT_BINDINGS, jump: 'KeyJ' });
    function mouse(type: string, button: number, target: EventTarget): void {
      const event = new Event(type);
      Object.defineProperty(event, 'button', { value: button });
      target.dispatchEvent(event);
    }
    mouse('mousedown', 0, surface);
    expect(input.consume('fire')).toBe(false);
    documentStub.pointerLockElement = surface;
    mouse('mousedown', 0, surface);
    mouse('mousedown', 2, surface);
    expect(input.isDown('fire')).toBe(true);
    expect(input.consume('fire')).toBe(true);
    expect(input.isDown('aim')).toBe(true);
    mouse('mouseup', 0, keyboard);
    mouse('mouseup', 2, keyboard);
    expect(input.isDown('fire')).toBe(false);
    expect(input.isDown('aim')).toBe(false);
  });

  it('keeps Tab, Escape and F3 fixed after remapping and returns Tab to native menu navigation', () => {
    input.setBindings({ ...DEFAULT_BINDINGS, jump: 'KeyJ' });
    expect(key('Tab').defaultPrevented).toBe(false);
    expect(input.isDown('scoreboard')).toBe(false);
    input.scoreboardEnabled = true;
    expect(key('Tab').defaultPrevented).toBe(true);
    expect(input.isDown('scoreboard')).toBe(true);
    key('Escape');
    expect(input.consume('menu')).toBe(true);
    expect(key('F3').defaultPrevented).toBe(true);
    expect(input.consume('debug')).toBe(true);
    input.scoreboardEnabled = false;
    expect(input.isDown('scoreboard')).toBe(false);
    expect(key('Tab').defaultPrevented).toBe(false);
  });

  it('releases arrow movement when spectator mode takes ownership, preserving another held movement key', () => {
    key('ArrowLeft');
    key('KeyA');
    input.spectatorEnabled = true;
    expect(input.isDown('left')).toBe(true);
    key('KeyA', 'keyup');
    expect(input.isDown('left')).toBe(false);
    key('ArrowLeft', 'keyup');
    key('ArrowLeft');
    expect(input.consume('spectatePrevious')).toBe(true);
  });
  it('touch mode: on-screen buttons hold and press the same actions, alongside the keyboard', () => {
    input.setTouchMode(true);
    expect(input.touch).toBe(true);
    // Engaged like pointer lock (the directors read `locked`), let go by the options menu.
    expect(input.locked).toBe(false);
    input.requestLock();
    expect(input.locked).toBe(true);
    input.touchDown('jump');
    expect(input.isDown('jump')).toBe(true);
    expect(input.consume('jump')).toBe(true);
    expect(input.consume('jump')).toBe(false);
    // A key on the same action does not release the touch hold, and the other way round.
    key('Space');
    key('Space', 'keyup');
    expect(input.isDown('jump')).toBe(true);
    input.touchUp('jump');
    expect(input.isDown('jump')).toBe(false);
    key('Space');
    input.touchDown('jump');
    input.touchUp('jump');
    expect(input.isDown('jump')).toBe(true);
    key('Space', 'keyup');
    input.exitLock();
    expect(input.locked).toBe(false);
    expect(input.isDown('jump')).toBe(false);
  });

  it('touch mode: the stick is an analogue movement axis, summed with the keys and clamped to the unit disc', () => {
    input.setTouchMode(true);
    input.setStick(0.3, 0.4);
    expect(input.moveAxis()).toEqual({ x: 0.3, y: 0.4 });
    input.setStick(3, 4);
    const far = input.moveAxis();
    expect(Math.hypot(far.x, far.y)).toBeCloseTo(1);
    expect(far.x).toBeCloseTo(0.6);
    input.setStick(0, 0);
    key('KeyW');
    expect(input.moveAxis()).toEqual({ x: 0, y: 1 });
    key('KeyW', 'keyup');
    // A camera drag goes through the same look path as the mouse.
    input.addLook(100, 0);
    expect(input.takeLook().yaw).toBeCloseTo(-100 * input.sensitivity);
    // Disabled (a menu open): no stick, no look, no buttons.
    input.enabled = false;
    input.setStick(1, 0);
    input.touchDown('fire');
    expect(input.moveAxis()).toEqual({ x: 0, y: 0 });
    expect(input.isDown('fire')).toBe(false);
  });
});

describe('a page that cannot lock the pointer (free mouse)', () => {
  let win: EventTarget;
  let doc: DocumentStub;
  let canvas: ElementStub & { requestPointerLock?: () => Promise<void>; setPointerCapture?: (id: number) => void };
  let input: Input;
  const mouse = (type: string, init: Record<string, number>) => {
    const e = new Event(type);
    for (const [k, v] of Object.entries(init)) Object.defineProperty(e, k, { value: v });
    return e;
  };
  const settle = () => new Promise((r) => setTimeout(r, 0));

  beforeEach(() => {
    win = new EventTarget();
    doc = new DocumentStub();
    canvas = new ElementStub('canvas');
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', doc);
    vi.stubGlobal('HTMLElement', ElementStub);
    input = new Input(canvas as unknown as HTMLElement);
  });

  afterEach(() => {
    input.dispose();
    vi.unstubAllGlobals();
  });

  it('a web view refusing the lock for good: a click still takes the controls, the camera turns by dragging', async () => {
    const err = Object.assign(new Error('The root document of this element is not valid for pointer lock.'), { name: 'WrongDocumentError' });
    canvas.requestPointerLock = () => Promise.reject(err);
    let changes = 0;
    input.onEngageChange = () => changes++;
    input.requestLock();
    await settle();
    expect(input.locked).toBe(true);
    expect(input.freeMouse).toBe(true);
    expect(changes).toBe(1);
    // Moving the free cursor does not turn the camera; dragging with a button held does.
    win.dispatchEvent(mouse('mousemove', { movementX: 30, movementY: 5, buttons: 0 }));
    expect(input.mouseDX).toBe(0);
    win.dispatchEvent(mouse('mousemove', { movementX: 30, movementY: 5, buttons: 2 }));
    expect(input.mouseDX).toBe(30);
    expect(input.mouseDY).toBe(5);
    // The buttons fire and aim like with the lock.
    canvas.dispatchEvent(mouse('mousedown', { button: 0 }));
    expect(input.isDown('fire')).toBe(true);
    win.dispatchEvent(mouse('mouseup', { button: 0 }));
    // The pause menu gives the controls back; the next click takes them again without asking the browser.
    input.exitLock();
    expect(input.locked).toBe(false);
    canvas.requestPointerLock = () => { throw new Error('não deveria pedir de novo'); };
    input.requestLock();
    expect(input.locked).toBe(true);
    expect(changes).toBe(3);
  });

  it('an ordinary refusal (no gesture, right after leaving the lock) keeps waiting for the lock', async () => {
    canvas.requestPointerLock = () => Promise.reject(Object.assign(new Error('exited the lock'), { name: 'SecurityError' }));
    input.requestLock();
    await settle();
    expect(input.locked).toBe(false);
    expect(input.freeMouse).toBe(false);
  });
});

describe('mouse wheel weapon switching', () => {
  let keyboard: EventTarget;
  let documentStub: DocumentStub;
  let surface: ElementStub;
  let input: Input;

  beforeEach(() => {
    keyboard = new EventTarget();
    documentStub = new DocumentStub();
    surface = new ElementStub('canvas');
    vi.stubGlobal('window', keyboard);
    vi.stubGlobal('document', documentStub);
    vi.stubGlobal('HTMLElement', ElementStub);
    input = new Input(surface as unknown as HTMLElement);
  });

  afterEach(() => {
    input.dispose();
    vi.unstubAllGlobals();
  });

  it('steps the weapon once per wheel notch while the game has the controls', () => {
    function wheel(deltaY: number, deltaMode = 0): void {
      const event = new Event('wheel');
      Object.defineProperties(event, { deltaY: { value: deltaY }, deltaMode: { value: deltaMode } });
      keyboard.dispatchEvent(event);
    }
    wheel(100);
    expect(input.consume('weaponNext')).toBe(false); // menus: the wheel scrolls them, never the weapon
    documentStub.pointerLockElement = surface;
    wheel(100);
    expect(input.consume('weaponNext')).toBe(true);
    expect(input.consume('weaponNext')).toBe(false);
    input.wheel(-100, 10_000);
    expect(input.consume('weaponPrev')).toBe(true);
    // Two notches 40 ms apart are one step; the next one after the rest is another.
    input.wheel(100, 20_000);
    input.wheel(100, 20_040);
    expect(input.consume('weaponNext')).toBe(true);
    input.wheel(100, 20_150);
    expect(input.consume('weaponNext')).toBe(true);
    // Firefox counts lines: three lines are a notch.
    input.wheel(3 * 40, 30_000);
    expect(input.consume('weaponNext')).toBe(true);
    input.enabled = false;
    input.wheel(100, 40_000);
    input.enabled = true;
    expect(input.consume('weaponNext')).toBe(false);
  });

  it('takes one step per trackpad swipe, its inertia included', () => {
    documentStub.pointerLockElement = surface;
    let steps = 0;
    // A swipe and its inertia: 4 px every 16 ms for a second, a stream of small deltas.
    for (let t = 0; t < 1000; t += 16) {
      input.wheel(4, 50_000 + t);
      if (input.consume('weaponNext')) steps++;
    }
    expect(steps).toBe(1);
    // A new swipe after a pause takes the next step; the other way is the previous weapon.
    for (let t = 0; t < 300; t += 16) input.wheel(-4, 52_000 + t);
    expect(input.consume('weaponPrev')).toBe(true);
    expect(input.consume('weaponNext')).toBe(false);
  });
});
