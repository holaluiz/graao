import { describe, expect, it } from 'vitest';
import { BINDING_ACTIONS, DEFAULT_BINDINGS, isBindingCode, keyLabel, normalizeBindings, rebindKey } from './KeyBindings';

describe('saved keyboard bindings', () => {
  it('migrates missing settings without sharing mutable defaults', () => {
    for (const saved of [undefined, null, false, 'KeyW', [], 12]) {
      const result = normalizeBindings(saved);
      expect(result).toEqual(DEFAULT_BINDINGS);
      result.forward = 'KeyI';
      expect(DEFAULT_BINDINGS.forward).toBe('KeyW');
    }
    expect(BINDING_ACTIONS).toHaveLength(18);
  });

  it('preserves valid custom mappings while filling new or corrupt saved fields', () => {
    const bindings = normalizeBindings({ forward: 'KeyI', jump: 'Tab', sprint: 'ShiftRight', ready: 3, fire: 'KeyT' });
    expect(bindings.forward).toBe('KeyI');
    expect(bindings.sprint).toBe('ShiftRight');
    expect(bindings.jump).toBe('Space');
    expect(bindings.ready).toBe('Enter');
    expect(bindings).not.toHaveProperty('fire');
    expect(normalizeBindings(bindings)).toEqual(bindings);
  });

  it('repairs duplicated saved keys without changing unrelated defaults', () => {
    const result = normalizeBindings({ forward: 'KeyS', back: 'KeyS', jump: 'ShiftLeft', sprint: 'ShiftLeft' });
    expect(result.forward).toBe('KeyS');
    expect(result.jump).toBe('ShiftLeft');
    expect(result.back).toBe('KeyW');
    expect(result.sprint).toBe('Space');
    expect(result.left).toBe('KeyA');
    expect(new Set(Object.values(result)).size).toBe(18);
    expect(Object.values(result).every(isBindingCode)).toBe(true);
  });

  it('does not read inherited settings fields', () => {
    expect(normalizeBindings(Object.create({ forward: 'KeyI' }))).toEqual(DEFAULT_BINDINGS);
  });

  it('reports the occupied action and keeps the original mapping untouched', () => {
    const current = { ...DEFAULT_BINDINGS };
    expect(rebindKey(current, 'jump', 'KeyF')).toEqual({ ok: false, reason: 'conflict', conflict: 'interact' });
    expect(current).toEqual(DEFAULT_BINDINGS);
  });

  it('accepts an unused physical key or the same current key without mutating the source', () => {
    const current = { ...DEFAULT_BINDINGS };
    expect(rebindKey(current, 'jump', 'KeyJ')).toEqual({ ok: true, bindings: { ...DEFAULT_BINDINGS, jump: 'KeyJ' } });
    expect(rebindKey(current, 'jump', 'Space')).toEqual({ ok: true, bindings: DEFAULT_BINDINGS });
    expect(current).toEqual(DEFAULT_BINDINGS);
  });

  it.each(['Tab', 'Escape', 'F3', 'F1', 'F12', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'AltLeft', 'MetaRight', 'Delete'])('reserves %s for the browser and fixed navigation', (code) => {
    expect(rebindKey({ ...DEFAULT_BINDINGS }, 'jump', code)).toEqual({ ok: false, reason: 'reserved' });
  });

  it.each(['w', 'W', 'Spacebar', 'KeyAA', 'Digit12', 'NotAKey', '', 'Mouse0'])('rejects malformed or unsupported code %s', (code) => {
    expect(rebindKey({ ...DEFAULT_BINDINGS }, 'jump', code)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('labels physical key codes in Portuguese, including modifier sides', () => {
    expect(['KeyQ', 'Digit9', 'Space', 'ShiftRight', 'ControlLeft', 'NumpadEnter', 'Escape', 'ArrowLeft'].map(keyLabel))
      .toEqual(['Q', '9', 'Espaço', 'Shift dir.', 'Ctrl esq.', 'Enter num.', 'Esc', '←']);
  });
});
