import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TraversalMode } from '@graao/game-data';
import { jumpLabel, touchAction, TouchControls, type TouchContext } from './TouchControls';
import { Input } from './Input';

const base: TouchContext = { traversal: TraversalMode.NONE, grounded: true, canGlide: false, prompt: null, wallAhead: null, alive: true };
const at = (o: Partial<TouchContext>): TouchContext => ({ ...base, ...o });

describe('touch: one contextual button for traversal and the world', () => {
  it('follows the hands first: pull up from a ledge, let go of a wall, nothing mid-mantle or on the kite', () => {
    expect(touchAction(at({ traversal: TraversalMode.HANG, grounded: false, prompt: 'Abrir baú' }))).toEqual({ label: 'SUBIR', kind: 'mantle' });
    expect(touchAction(at({ traversal: TraversalMode.CLIMB, grounded: false }))).toEqual({ label: 'SOLTAR', kind: 'drop' });
    expect(touchAction(at({ traversal: TraversalMode.MANTLE }))).toBeNull();
    expect(touchAction(at({ traversal: TraversalMode.GLIDE, grounded: false, wallAhead: 'climb' }))).toBeNull();
  });

  it('then the world (a chest, a door, a bell), then a face or an edge in reach; hidden otherwise or when dead', () => {
    expect(touchAction(at({ prompt: 'Abrir baú', wallAhead: 'climb' }))).toEqual({ label: 'ABRIR', kind: 'interact' });
    expect(touchAction(at({ prompt: 'Tocar o sino' }))!.label).toBe('TOCAR');
    expect(touchAction(at({ wallAhead: 'climb' }))).toEqual({ label: 'ESCALAR', kind: 'climb' });
    expect(touchAction(at({ wallAhead: 'ledge' }))).toEqual({ label: 'AGARRAR', kind: 'climb' });
    // A wall is grabbed with a jump from the ground; in the air the jump button already does it.
    expect(touchAction(at({ wallAhead: 'ledge', grounded: false }))).toBeNull();
    expect(touchAction(base)).toBeNull();
    expect(touchAction(at({ alive: false, prompt: 'Abrir baú' }))).toBeNull();
  });

  it('the jump button says what holding it does: jump, open the kite in a fall, gliding', () => {
    expect(jumpLabel(base)).toBe('PULAR');
    expect(jumpLabel(at({ grounded: false, canGlide: true }))).toBe('PLANAR');
    expect(jumpLabel(at({ grounded: false, canGlide: false }))).toBe('PULAR');
    expect(jumpLabel(at({ grounded: false, traversal: TraversalMode.GLIDE }))).toBe('PLANANDO');
    expect(jumpLabel(at({ grounded: false, traversal: TraversalMode.HANG, canGlide: true }))).toBe('PULAR');
  });
});

/** Small event-capable DOM: the assertions use real Input and pointer handlers, not a second input implementation. */
class TouchElement extends EventTarget {
  className = '';
  hidden = false;
  disabled = false;
  textContent = '';
  type = '';
  isContentEditable = false;
  readonly style: Record<string, string> = {};
  readonly dataset: Record<string, string> = {};
  readonly children: TouchElement[] = [];
  parent: TouchElement | null = null;
  readonly captures: number[] = [];
  readonly attributes = new Map<string, string>();
  readonly classList = {
    add: (...tokens: string[]) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...tokens])].join(' '); },
    remove: (...tokens: string[]) => { this.className = this.className.split(/\s+/).filter((t) => !tokens.includes(t)).join(' '); },
    contains: (token: string) => this.className.split(/\s+/).includes(token),
    toggle: (token: string, on?: boolean) => {
      const enabled = on ?? !this.classList.contains(token);
      if (enabled) this.classList.add(token); else this.classList.remove(token);
      return enabled;
    },
  };
  setAttribute(key: string, value: string): void { this.attributes.set(key, value); }
  setPointerCapture(pointerId: number): void { this.captures.push(pointerId); }
  append(...nodes: TouchElement[]): void { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  prepend(node: TouchElement): void { node.parent = this; this.children.unshift(node); }
  remove(): void { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
  closest(selector: string): TouchElement | null {
    const parts = selector.trim().split(/\s+/);
    if (this.classList.contains(parts.at(-1)!.slice(1)) && (parts.length === 1 || this.parent?.closest(parts.slice(0, -1).join(' ')))) return this;
    return this.parent?.closest(selector) ?? null;
  }
  querySelectorAll(selector: string): TouchElement[] {
    return this.children.flatMap((child) => [...(child.closest(selector) === child ? [child] : []), ...child.querySelectorAll(selector)]);
  }
}

describe('touch controls through real pointer and input lifecycles', () => {
  let win: EventTarget & { matchMedia: () => { matches: boolean } };
  let doc: EventTarget & { body: TouchElement; hidden: boolean; createElement: () => TouchElement };
  let mount: TouchElement;
  let input: Input;
  let controls: TouchControls;
  const find = (cls: string) => mount.querySelectorAll(`.${cls}`)[0]!;
  const pointer = (target: TouchElement, type: string, id: number, x = 0, y = 0, actualTarget?: TouchElement) => {
    const event = new Event(type, { cancelable: true });
    Object.defineProperties(event, { pointerId: { value: id }, clientX: { value: x }, clientY: { value: y }, ...(actualTarget ? { target: { value: actualTarget } } : {}) });
    target.dispatchEvent(event);
  };
  const hud = (parentClass: string, childClass: string, count: number): TouchElement[] => {
    const parent = new TouchElement(); parent.className = parentClass; mount.append(parent);
    const children = Array.from({ length: count }, () => { const child = new TouchElement(); child.className = childClass; parent.append(child); return child; });
    return children;
  };

  beforeEach(() => {
    win = Object.assign(new EventTarget(), { matchMedia: () => ({ matches: false }) });
    doc = Object.assign(new EventTarget(), { body: new TouchElement(), hidden: false, createElement: () => new TouchElement() });
    vi.stubGlobal('window', win); vi.stubGlobal('document', doc);
    vi.stubGlobal('Element', TouchElement); vi.stubGlobal('HTMLElement', TouchElement);
    mount = new TouchElement();
    input = new Input(new TouchElement() as unknown as HTMLElement);
    controls = new TouchControls(input, mount as unknown as HTMLElement, { pause: vi.fn() });
    controls.enable(); controls.show(true); controls.update(0, base);
  });
  afterEach(() => { controls.dispose(); input.dispose(); vi.unstubAllGlobals(); });

  it('moves, looks and fires with three independent fingers; a lost capture only releases its owner', () => {
    const stick = find('touch-stick-zone'), look = find('touch-look'), fire = find('touch-fire');
    pointer(stick, 'pointerdown', 1, 80, 240);
    pointer(stick, 'pointermove', 1, 110, 200);
    expect(input.moveAxis()).toEqual({ x: 30 / 56, y: 40 / 56 });
    pointer(look, 'pointerdown', 2, 360, 220);
    pointer(look, 'pointermove', 2, 370, 200);
    expect(input.takeLook()).toEqual({ yaw: -22 * input.sensitivity, pitch: 44 * input.sensitivity });
    pointer(fire, 'pointerdown', 3);
    expect(input.isDown('fire')).toBe(true);
    pointer(stick, 'lostpointercapture', 1);
    expect(input.moveAxis()).toEqual({ x: 0, y: 0 });
    expect(input.isDown('fire')).toBe(true);
    pointer(fire, 'pointercancel', 3);
    expect(input.isDown('fire')).toBe(false);
    pointer(look, 'lostpointercapture', 2);
    pointer(look, 'pointermove', 2, 500, 250);
    expect(input.takeLook()).toEqual({ yaw: -0, pitch: -0 });
  });

  it('does not let a second finger release a button owned by the first one', () => {
    const fire = find('touch-fire');
    pointer(fire, 'pointerdown', 1);
    pointer(fire, 'pointerdown', 2);
    pointer(fire, 'pointerup', 2);
    expect(input.isDown('fire')).toBe(true);
    pointer(fire, 'pointerup', 1);
    expect(input.isDown('fire')).toBe(false);
  });

  it('opens a held scoreboard, and closes it on capture loss or when the match stops allowing it', () => {
    const score = find('touch-scoreboard');
    expect(score.hidden).toBe(true);
    input.scoreboardEnabled = true; controls.update(0, base);
    expect(score.hidden).toBe(false);
    pointer(score, 'pointerdown', 1);
    expect(input.isDown('scoreboard')).toBe(true);
    pointer(score, 'lostpointercapture', 1);
    expect(input.isDown('scoreboard')).toBe(false);
    pointer(score, 'pointerdown', 2);
    input.scoreboardEnabled = false; controls.update(0, base);
    expect(input.isDown('scoreboard')).toBe(false);
    expect(input.isTouchHeld('scoreboard')).toBe(false);
  });

  it('uses real HUD slots for active magic, weapons and items, skipping a passive slot', () => {
    const abilities = hud('abilities', 'ab-slot', 4);
    const weapons = hud('weapons', 'slot', 2);
    const items = hud('loot-belt', 'belt-slot', 3);
    abilities[1]!.dataset.kind = 'passive';
    pointer(mount, 'pointerdown', 1, 0, 0, abilities[0]);
    expect(input.consume('ability1')).toBe(true);
    expect(input.consume('ability1')).toBe(false);
    pointer(mount, 'pointerdown', 2, 0, 0, abilities[1]);
    expect(input.consume('ability2')).toBe(false);
    pointer(mount, 'pointerdown', 3, 0, 0, abilities[3]);
    expect(input.consume('ultimate')).toBe(true);
    pointer(mount, 'pointerdown', 4, 0, 0, weapons[0]);
    expect(input.consume('weapon2')).toBe(true);
    pointer(mount, 'pointerdown', 5, 0, 0, weapons[1]);
    expect(input.consume('weapon1')).toBe(true);
    pointer(mount, 'pointerdown', 6, 0, 0, items[1]);
    expect(input.consume('item2')).toBe(true);
    controls.update(.2, base);
    expect(input.isTouchHeld('ultimate')).toBe(false);
    expect(input.isTouchHeld('item2')).toBe(false);
  });

  it('releases toggles, pointers and movement on focus loss, then accepts fresh fingers', () => {
    const stick = find('touch-stick-zone'), aim = find('touch-aim'), fire = find('touch-fire');
    pointer(stick, 'pointerdown', 1, 60, 200); pointer(stick, 'pointermove', 1, 100, 140);
    pointer(aim, 'pointerdown', 2); pointer(aim, 'pointerup', 2);
    pointer(fire, 'pointerdown', 3);
    win.dispatchEvent(new Event('blur'));
    expect(input.locked).toBe(false);
    expect(input.moveAxis()).toEqual({ x: 0, y: 0 });
    expect(input.isDown('fire')).toBe(false); expect(input.isDown('aim')).toBe(false);
    expect(aim.classList.contains('on')).toBe(false);
    pointer(stick, 'pointermove', 1, 200, 140);
    expect(input.moveAxis()).toEqual({ x: 0, y: 0 });
    pointer(stick, 'pointerdown', 4, 60, 200); pointer(stick, 'pointermove', 4, 70, 190);
    expect(input.moveAxis().x).toBeGreaterThan(0);
    controls.show(false);
    expect(input.moveAxis()).toEqual({ x: 0, y: 0 });
    expect(doc.body.classList.contains('touch-playing')).toBe(false);
  });

  it('shows deployment labels and maps the dive to sprint without carrying a jump across phases', () => {
    const jump = find('touch-jump');
    controls.update(0, at({ deployment: 'ufo' }));
    expect(jump.textContent).toBe('SALTAR');
    pointer(jump, 'pointerdown', 1);
    expect(input.consume('jump')).toBe(true);
    controls.update(0, at({ deployment: 'drop' }));
    expect(input.isDown('jump')).toBe(false);
    expect(jump.textContent).toBe('MERGULHAR');
    pointer(jump, 'pointerdown', 2);
    expect(input.isDown('sprint')).toBe(true);
    controls.update(0, at({ deployment: 'combat', swimming: true }));
    expect(input.isDown('sprint')).toBe(false);
    expect(jump.textContent).toBe('SUBIR');
  });
});
