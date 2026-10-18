import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Input } from './Input';

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

describe('spectator keyboard input', () => {
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
});
