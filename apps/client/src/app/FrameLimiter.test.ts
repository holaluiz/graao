import { describe, expect, it } from 'vitest';
import { FrameLimiter, type FpsCap } from './FrameLimiter';

/** Simulates `seconds` of vsync callbacks at `hz` (with optional timestamp jitter) and returns rendered timestamps. */
function simulate(hz: number, cap: FpsCap, seconds = 4, jitterMs = 0): number[] {
  const l = new FrameLimiter();
  l.cap = cap;
  const out: number[] = [];
  const period = 1000 / hz;
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  for (let i = 0; i < hz * seconds; i++) {
    const t = 1000 + i * period + rand() * jitterMs;
    if (l.shouldRender(t)) out.push(t);
  }
  return out.filter((t) => t > 1500); // after the refresh rate is measured
}

const fps = (r: number[]) => ((r.length - 1) * 1000) / (r[r.length - 1]! - r[0]!);
const gaps = (r: number[], hz: number) => new Set(r.slice(1).map((t, i) => Math.round((t - r[i]!) / (1000 / hz))));

describe('FrameLimiter', () => {
  it('"Máximo" renders every vsync (120 and 240 Hz)', () => {
    expect(fps(simulate(120, 0))).toBeCloseTo(120, 0);
    expect(fps(simulate(240, 0))).toBeCloseTo(240, 0);
  });

  it('a cap at or above the refresh rate never drops frames, even on 59.94 / 60.1 Hz with jitter', () => {
    for (const hz of [59.94, 60, 60.1]) {
      const r = simulate(hz, 60, 6, 0.6);
      expect(gaps(r, hz)).toEqual(new Set([1]));
    }
    expect(gaps(simulate(60, 120), 60)).toEqual(new Set([1]));
  });

  it('divisor caps keep perfectly even spacing', () => {
    expect(gaps(simulate(60, 30, 6, 0.6), 60)).toEqual(new Set([2]));
    expect(gaps(simulate(60.1, 30, 10, 0.6), 60.1)).toEqual(new Set([2]));
    expect(gaps(simulate(120, 60), 120)).toEqual(new Set([2]));
    expect(gaps(simulate(240, 60), 240)).toEqual(new Set([4]));
    expect(gaps(simulate(240, 120), 240)).toEqual(new Set([2]));
    expect(fps(simulate(120, 30))).toBeCloseTo(30, 0);
  });

  it('non-divisor caps hit the average rate with n / n+1 vsync spacing', () => {
    const r = simulate(144, 120);
    expect(fps(r)).toBeGreaterThan(117);
    expect(fps(r)).toBeLessThan(123);
    expect(gaps(r, 144)).toEqual(new Set([1, 2]));
    const r60 = simulate(144, 60);
    expect(fps(r60)).toBeGreaterThan(58.5);
    expect(fps(r60)).toBeLessThan(61.5);
    expect(gaps(r60, 144)).toEqual(new Set([2, 3]));
  });

  it('measures the display refresh rate from the callbacks', () => {
    const l = new FrameLimiter();
    for (let i = 0; i < 100; i++) l.shouldRender(i * (1000 / 144));
    expect(l.refreshHz).toBeCloseTo(144, 0);
  });

  it('restarts the schedule after a long stall instead of bursting', () => {
    const l = new FrameLimiter();
    l.cap = 30;
    for (let i = 0; i < 60; i++) l.shouldRender(i * (1000 / 144));
    // 2 s without callbacks (hidden tab), then vsync again: no catch-up burst.
    const after: boolean[] = [];
    for (let i = 0; i < 10; i++) after.push(l.shouldRender(3000 + i * (1000 / 144)));
    expect(after.filter(Boolean).length).toBeLessThanOrEqual(2);
  });
});
