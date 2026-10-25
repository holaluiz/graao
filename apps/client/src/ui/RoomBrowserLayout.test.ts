import { describe, expect, it } from 'vitest';
import { roomRowsPerPage } from './RoomBrowserLayout';

describe('room list pagination in the visible list track', () => {
  it.each([
    [80, 76, 6, 1], // Android landscape with its browser chrome visible.
    [158, 76, 6, 2],
    [157, 76, 6, 1], // A second card would cover the footer by one pixel.
    [340, 106, 8, 3], // Portrait room cards.
    [640, 76, 10, 6],
  ])('fits rows in %i px without reserving three rows on short screens', (height, row, gap, count) => {
    expect(roomRowsPerPage(height, row, gap)).toBe(count);
    expect(count * row + (count - 1) * gap).toBeLessThanOrEqual(height);
  });

  it('keeps one usable page during initial layout or a very small keyboard viewport', () => {
    expect(roomRowsPerPage(0, 76, 6)).toBe(1);
    expect(roomRowsPerPage(40, 76, 6)).toBe(1);
    expect(roomRowsPerPage(Number.NaN, 76, 6)).toBe(1);
    expect(roomRowsPerPage(300, 0, 6)).toBe(1);
  });
});
