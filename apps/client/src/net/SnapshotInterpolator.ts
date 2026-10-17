/**
 * Snapshot interpolation for one remote entity, independent of rendering.
 *
 * Samples are timestamped on the entity's own server-side simulation clock (snapshot time + simDt). The interpolator
 * measures how old samples are when they arrive (network latency + that clock's offset) and renders `margin` ms behind
 * that measured lag, so it adapts to each player's steady offset without wall-clock snapping.
 */
export interface TimedSample {
  t: number;
}

export interface InterpolationResult<S extends TimedSample> {
  a: S;
  b: S;
  alpha: number;
  /** > 0 when rendering past the newest sample (ms). */
  extrapolateMs: number;
}

export class SnapshotInterpolator<S extends TimedSample> {
  readonly samples: S[] = [];
  /** Smoothed age (ms) of samples on arrival. */
  lag = -1;

  constructor(private readonly capacity = 40) {}

  /** Adds a sample; `arrivalNow` is the server clock when it arrived. */
  push(s: S, arrivalNow: number): void {
    const last = this.samples[this.samples.length - 1];
    if (last && s.t <= last.t) {
      // The entity's clock was resynced after a stall: restart the buffer.
      if (last.t - s.t > 500) this.samples.length = 0;
      else return;
    }
    const age = arrivalNow - s.t;
    // Follow quickly when samples arrive later than expected, relax slowly when they get earlier.
    if (this.lag < 0) this.lag = age;
    else this.lag += (age - this.lag) * (age > this.lag ? 0.25 : 0.04);
    this.samples.push(s);
    if (this.samples.length > this.capacity) this.samples.shift();
  }

  sample(serverNow: number, margin: number): InterpolationResult<S> | null {
    const sm = this.samples;
    if (sm.length === 0) return null;
    const t = serverNow - Math.max(0, this.lag) - margin;
    const first = sm[0]!;
    const last = sm[sm.length - 1]!;
    if (t <= first.t) return { a: first, b: first, alpha: 0, extrapolateMs: 0 };
    if (t >= last.t) return { a: last, b: last, alpha: 0, extrapolateMs: Math.min(150, t - last.t) };
    for (let i = sm.length - 2; i >= 0; i--) {
      const a = sm[i]!;
      if (a.t <= t) {
        const b = sm[i + 1]!;
        return { a, b, alpha: (t - a.t) / Math.max(1, b.t - a.t), extrapolateMs: 0 };
      }
    }
    return { a: first, b: first, alpha: 0, extrapolateMs: 0 };
  }
}
