import { describe, expect, it } from 'vitest';
import { visibleViewport } from './Viewport';

describe('visible mobile viewport', () => {
  it('fits landscape below browser bars and shrinks when the keyboard appears', () => {
    expect(visibleViewport(800, 390, { width: 740, height: 280, offsetLeft: 30, offsetTop: 0, scale: 1 }))
      .toEqual({ width: 740, height: 280, left: 30, top: 0 });
    expect(visibleViewport(390, 844, { width: 390, height: 390, offsetLeft: 0, offsetTop: 70, scale: 1 }))
      .toEqual({ width: 390, height: 390, left: 0, top: 70 });
  });
  it('leaves browser zoom in charge and falls back on invalid or unavailable readings', () => {
    expect(visibleViewport(390, 844, { width: 195, height: 422, offsetLeft: 40, offsetTop: 50, scale: 2 }))
      .toEqual({ width: 390, height: 844, left: 0, top: 0 });
    expect(visibleViewport(390, 844, { width: NaN, height: 0, offsetLeft: -1, offsetTop: Infinity, scale: 1 }))
      .toEqual({ width: 390, height: 844, left: 0, top: 0 });
    expect(visibleViewport(844, 390)).toEqual({ width: 844, height: 390, left: 0, top: 0 });
  });
});
