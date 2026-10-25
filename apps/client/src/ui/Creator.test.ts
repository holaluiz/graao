import { describe, expect, it } from 'vitest';
import { FABRIC_COLORS } from '@graao/game-data';
import { creatorGestureDelta, creatorPalettePage } from './Creator';

describe('mobile appearance interaction', () => {
  it('keeps every color reachable once through thumb-sized compact pages', () => {
    const first = creatorPalettePage(FABRIC_COLORS, 0, true);
    expect(first.colors.length).toBeLessThanOrEqual(6);
    const colors = Array.from({ length: first.pages }, (_, page) => creatorPalettePage(FABRIC_COLORS, page, true).colors).flat();
    expect(colors.map((color) => color.id)).toEqual(FABRIC_COLORS.map((color) => color.id));
    expect(new Set(colors.map((color) => color.id)).size).toBe(FABRIC_COLORS.length);
    expect(creatorPalettePage(FABRIC_COLORS, 99, true).page).toBe(first.pages - 1);
    expect(creatorPalettePage(FABRIC_COLORS, -1, true).page).toBe(0);
  });

  it('restores the entire palette to a single page on a larger screen', () => {
    expect(creatorPalettePage(FABRIC_COLORS, 2, false)).toEqual({ colors: FABRIC_COLORS, page: 0, pages: 1 });
    expect(creatorPalettePage([], 0, true)).toEqual({ colors: [], page: 0, pages: 1 });
  });

  it('rotates with a one-finger drag without zooming or depending on movementX', () => {
    expect(creatorGestureDelta([{ x: 100, y: 90 }], [{ x: 125, y: 120 }])).toEqual({ rotation: .3, zoom: 0 });
  });

  it('pinches toward the avatar on spread, away on contraction, and bounds abrupt jumps', () => {
    const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    expect(creatorGestureDelta(points, [{ x: -10, y: 0 }, { x: 110, y: 0 }])).toMatchObject({ rotation: 0 });
    expect(creatorGestureDelta(points, [{ x: -10, y: 0 }, { x: 110, y: 0 }]).zoom).toBeLessThan(0);
    expect(creatorGestureDelta(points, [{ x: 10, y: 0 }, { x: 90, y: 0 }]).zoom).toBeGreaterThan(0);
    expect(creatorGestureDelta(points, [{ x: -1000, y: 0 }, { x: 1000, y: 0 }]).zoom).toBe(-.5);
    expect(creatorGestureDelta(points, [{ x: 1, y: 0 }, { x: 1, y: 0 }]).zoom).toBe(0);
  });

  it('does not jump when the pointer count changes or the gesture ends', () => {
    expect(creatorGestureDelta([{ x: 1, y: 0 }], [{ x: 1, y: 0 }, { x: 50, y: 0 }])).toEqual({ rotation: 0, zoom: 0 });
    expect(creatorGestureDelta([], [])).toEqual({ rotation: 0, zoom: 0 });
  });
});
