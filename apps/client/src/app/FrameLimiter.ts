/**
 * FrameLimiter: optional frame-rate cap on top of requestAnimationFrame.
 *
 * Browsers present at most once per display refresh (vsync), so "Máximo" means the monitor's own rate (60, 120, 144,
 * 240 Hz…) as long as the GPU keeps up. A cap renders on a subset of the rAF callbacks:
 *   - cap ≥ refresh: every callback (never skip because of timestamp jitter);
 *   - refresh / cap close to an integer (30 on 60 Hz, 60 on 120 Hz): every n-th vsync, measured from the last rendered
 *     frame, so pacing stays perfectly even on 59.94 or 60.1 Hz displays too;
 *   - otherwise (120 on 144 Hz): an ideal-time schedule that hits the average rate; spacing then alternates between
 *     n and n + 1 vsyncs, which no cap that does not divide the refresh rate can avoid.
 * The refresh period is measured from the rAF timestamps themselves (median of recent deltas), rendered or not.
 */

/** 0 = no cap ("Máximo": the monitor's refresh rate). */
export type FpsCap = 0 | 30 | 60 | 120;
export const FPS_CAPS: readonly FpsCap[] = [30, 60, 120, 0];

export class FrameLimiter {
  cap: FpsCap = 0;
  private lastRaf = -1;
  private readonly deltas: number[] = [];
  private periodMs = 1000 / 60;
  private lastRender = -1e9;
  private nextAt = 0;

  /** Measured display refresh rate (Hz). */
  get refreshHz(): number {
    return 1000 / this.periodMs;
  }

  /** Call on every rAF callback with its timestamp (ms); true when this callback should render. */
  shouldRender(t: number): boolean {
    this.measure(t);
    if (this.cap <= 0) return this.render(t);
    const p = this.periodMs;
    const interval = 1000 / this.cap;
    if (interval <= p * 1.03) return this.render(t);
    const ratio = interval / p;
    const n = Math.round(ratio);
    if (Math.abs(ratio - n) < 0.05) return t - this.lastRender >= n * p - p / 2 ? this.render(t) : false;
    if (t < this.nextAt - p / 2) return false;
    // Far behind (tab was hidden, a long hitch): restart the schedule instead of rendering a burst.
    this.nextAt = t - this.nextAt > interval ? t + interval : this.nextAt + interval;
    this.lastRender = t;
    return true;
  }

  private render(t: number): boolean {
    this.lastRender = t;
    this.nextAt = t + (this.cap > 0 ? 1000 / this.cap : 0);
    return true;
  }

  private measure(t: number): void {
    if (this.lastRaf >= 0) {
      const d = t - this.lastRaf;
      // Ignore impossible (> 500 Hz) and stalled (< 10 Hz) gaps.
      if (d > 2 && d < 100) {
        this.deltas.push(d);
        if (this.deltas.length > 61) this.deltas.shift();
        if (this.deltas.length >= 5) {
          const s = [...this.deltas].sort((a, b) => a - b);
          this.periodMs = s[s.length >> 1]!;
        }
      }
    }
    this.lastRaf = t;
  }
}
