/**
 * Ambience: the outdoor bed under everything, synthesized like the rest of graao's audio (no files).
 *
 *   - Wind: two decorrelated noise beds (left/right) through a low-pass "air" and a band-pass "gust" whose level and
 *     color follow a slow gust curve, plus a faint leaf rustle that only rises with the strongest gusts.
 *   - Birds: calls scheduled at random intervals, each placed somewhere around the listener (pan + distance
 *     low-pass): a melodic whistle (thrush-like), a quick chirp trill, and the bem-te-vi's three-note call.
 *
 * `update(level, time)` runs every frame: `level` fades the whole bed (0 in orbit, 1 on the ground).
 */
export class Ambience {
  private readonly out: GainNode;
  private readonly air: BiquadFilterNode;
  private readonly gust: BiquadFilterNode;
  private readonly gustGain: GainNode;
  private readonly rustle: GainNode;
  private nextBird = 0;
  private level = 0;

  constructor(private readonly ctx: AudioContext, destination: AudioNode, private readonly noise: AudioBuffer) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(destination);

    this.air = ctx.createBiquadFilter();
    this.air.type = 'lowpass';
    this.air.frequency.value = 420;
    this.air.Q.value = 0.4;
    const airGain = ctx.createGain();
    airGain.gain.value = 0.5;
    this.air.connect(airGain).connect(this.out);

    this.gust = ctx.createBiquadFilter();
    this.gust.type = 'bandpass';
    this.gust.frequency.value = 700;
    this.gust.Q.value = 0.8;
    this.gustGain = ctx.createGain();
    this.gustGain.gain.value = 0.2;
    this.gust.connect(this.gustGain).connect(this.out);

    const rustleFilter = ctx.createBiquadFilter();
    rustleFilter.type = 'highpass';
    rustleFilter.frequency.value = 3200;
    this.rustle = ctx.createGain();
    this.rustle.gain.value = 0;
    rustleFilter.connect(this.rustle).connect(this.out);

    for (const [pan, rate] of [[-0.7, 0.91], [0.7, 1.07]] as const) {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      src.playbackRate.value = rate;
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      src.connect(p);
      p.connect(this.air);
      p.connect(this.gust);
      p.connect(rustleFilter);
      src.start(0, Math.random());
    }
    this.nextBird = ctx.currentTime + 1.5;
  }

  update(level: number, time: number): void {
    const t = this.ctx.currentTime;
    if (Math.abs(level - this.level) > 0.01) {
      this.level = level;
      this.out.gain.setTargetAtTime(level * 0.55, t, 0.6);
    }
    // Gusts: a smooth irregular curve 0..1 from a few incommensurate slow sines.
    const g = Math.max(0, Math.min(1, 0.5 + 0.28 * Math.sin(time * 0.071) + 0.18 * Math.sin(time * 0.193 + 1.3) + 0.12 * Math.sin(time * 0.47 + 2.1)));
    this.gust.frequency.setTargetAtTime(380 + g * 900, t, 0.3);
    this.gustGain.gain.setTargetAtTime(0.06 + g * g * 0.42, t, 0.3);
    this.air.frequency.setTargetAtTime(300 + g * 260, t, 0.3);
    this.rustle.gain.setTargetAtTime(Math.max(0, g - 0.62) * 0.18, t, 0.25);

    if (level > 0.05 && t >= this.nextBird) {
      this.bird(t + 0.05);
      // Sometimes a second bird answers.
      const answer = Math.random() < 0.3;
      this.nextBird = t + (answer ? 0.9 + Math.random() * 0.8 : 2.2 + Math.random() * 5.5);
    }
  }

  /** One call at a random place around the listener. */
  private bird(t: number): void {
    const ctx = this.ctx;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    const far = Math.random();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 9000 - far * 5500;
    const g = ctx.createGain();
    g.gain.value = (0.16 - far * 0.1) * (0.8 + Math.random() * 0.4);
    lp.connect(g).connect(pan).connect(this.out);
    const kind = Math.random();
    if (kind < 0.4) this.whistle(lp, t);
    else if (kind < 0.75) this.trill(lp, t);
    else this.bemTeVi(lp, t);
  }

  private note(out: AudioNode, t: number, f0: number, f1: number, dur: number, gain: number, vibrato = 0): void {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    if (vibrato > 0) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 28 + Math.random() * 12;
      const lg = ctx.createGain();
      lg.gain.value = vibrato;
      lfo.connect(lg).connect(o.frequency);
      lfo.start(t);
      lfo.stop(t + dur + 0.02);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.02, dur * 0.25));
    g.gain.setValueAtTime(gain, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** Melodic phrase: 3–6 sliding notes in a pleasant range. */
  private whistle(out: AudioNode, t: number): void {
    const n = 3 + Math.floor(Math.random() * 4);
    let f = 1800 + Math.random() * 900;
    for (let i = 0; i < n; i++) {
      const dur = 0.09 + Math.random() * 0.14;
      const next = Math.min(3800, Math.max(1500, f * (0.8 + Math.random() * 0.5)));
      this.note(out, t, f, next, dur, 0.6, 18);
      t += dur + 0.03 + Math.random() * 0.06;
      f = next * (0.9 + Math.random() * 0.25);
    }
  }

  /** Quick chirps falling in pitch. */
  private trill(out: AudioNode, t: number): void {
    const n = 4 + Math.floor(Math.random() * 7);
    const top = 4200 + Math.random() * 1600;
    const step = 0.055 + Math.random() * 0.025;
    for (let i = 0; i < n; i++) this.note(out, t + i * step, top * (1 - i * 0.012), top * 0.55, 0.035, 0.5);
  }

  /** "bem-te-VI": two short notes and a long rising one. */
  private bemTeVi(out: AudioNode, t: number): void {
    this.note(out, t, 2500, 2850, 0.12, 0.55);
    this.note(out, t + 0.17, 3050, 3150, 0.1, 0.5);
    this.note(out, t + 0.34, 2350, 3350, 0.34, 0.6, 30);
  }
}
