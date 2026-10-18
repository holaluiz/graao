/**
 * Ambience: the outdoor bed under everything. Plays the recorded wind audio bed and beach/waves bed seamlessly
 * on loop.
 *
 *   - Wind: global outdoor bed, volume fades with altitude (0 in orbit, 1 on ground).
 *   - Beach / Sea: shoreline bed, volume fades with proximity to water/beach (1 on beach/water, 0 inland).
 *
 * A synthesized noise bed is kept as an offline/network fallback if the recorded asset is unavailable.
 * Procedural bird calls (whistle, trill, bem-te-vi) remain available via `enableBirds`.
 */
export class Ambience {
  private readonly out: GainNode;
  private readonly windGain: GainNode;
  private readonly beachGain: GainNode;

  private windSource: AudioBufferSourceNode | null = null;
  private beachSource: AudioBufferSourceNode | null = null;
  private windLevel = 0;
  private beachLevel = 0;

  // Fallback procedural nodes (only wired if wind audio fails or is pending)
  private fallbackAir: BiquadFilterNode | null = null;
  private fallbackGust: BiquadFilterNode | null = null;
  private fallbackGustGain: GainNode | null = null;
  private fallbackRustle: GainNode | null = null;
  private fallbackGain: GainNode | null = null;

  private nextBird = 0;
  enableBirds = false;

  constructor(
    private readonly ctx: AudioContext,
    destination: AudioNode,
    windBuffer?: AudioBuffer | null,
    beachBuffer?: AudioBuffer | null,
    windUrl?: string,
    beachUrl?: string,
    private readonly fallbackNoise?: AudioBuffer | null,
  ) {
    this.out = ctx.createGain();
    this.out.gain.value = 1;
    this.out.connect(destination);

    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windGain.connect(this.out);

    this.beachGain = ctx.createGain();
    this.beachGain.gain.value = 0;
    this.beachGain.connect(this.out);

    if (windBuffer) {
      this.setWindBuffer(windBuffer);
    } else if (windUrl) {
      void this.loadWindFromUrl(windUrl);
    } else if (fallbackNoise) {
      this.initFallback(fallbackNoise);
    }

    if (beachBuffer) {
      this.setBeachBuffer(beachBuffer);
    } else if (beachUrl) {
      void this.loadBeachFromUrl(beachUrl);
    }

    this.nextBird = ctx.currentTime + 1.5;
  }

  /** Attaches and starts the recorded wind buffer looping seamlessly. */
  setWindBuffer(buffer: AudioBuffer): void {
    if (this.windSource) {
      try {
        this.windSource.stop();
        this.windSource.disconnect();
      } catch {
        /* no-op */
      }
      this.windSource = null;
    }

    // Disable fallback synth if active
    if (this.fallbackGain) {
      this.fallbackGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(this.windGain);
    const offset = buffer.duration > 0 ? Math.random() * buffer.duration : 0;
    src.start(0, offset);
    this.windSource = src;
  }

  /** Attaches and starts the recorded beach/water buffer looping seamlessly. */
  setBeachBuffer(buffer: AudioBuffer): void {
    if (this.beachSource) {
      try {
        this.beachSource.stop();
        this.beachSource.disconnect();
      } catch {
        /* no-op */
      }
      this.beachSource = null;
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(this.beachGain);
    const offset = buffer.duration > 0 ? Math.random() * buffer.duration : 0;
    src.start(0, offset);
    this.beachSource = src;
  }

  setBuffer(buffer: AudioBuffer): void {
    this.setWindBuffer(buffer);
  }

  private async loadWindFromUrl(url: string): Promise<void> {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const arrayBuf = await res.arrayBuffer();
      const decoded = await this.ctx.decodeAudioData(arrayBuf);
      this.setWindBuffer(decoded);
    } catch (e) {
      console.warn('[Ambience] Failed to load wind audio, using fallback:', e);
      if (this.fallbackNoise && !this.windSource) {
        this.initFallback(this.fallbackNoise);
      }
    }
  }

  private async loadBeachFromUrl(url: string): Promise<void> {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const arrayBuf = await res.arrayBuffer();
      const decoded = await this.ctx.decodeAudioData(arrayBuf);
      this.setBeachBuffer(decoded);
    } catch (e) {
      console.warn('[Ambience] Failed to load beach audio:', e);
    }
  }

  private initFallback(noise: AudioBuffer): void {
    if (this.fallbackGain) return;
    const ctx = this.ctx;
    this.fallbackGain = ctx.createGain();
    this.fallbackGain.gain.value = 1;
    this.fallbackGain.connect(this.windGain);

    this.fallbackAir = ctx.createBiquadFilter();
    this.fallbackAir.type = 'lowpass';
    this.fallbackAir.frequency.value = 420;
    this.fallbackAir.Q.value = 0.4;
    const airGain = ctx.createGain();
    airGain.gain.value = 0.5;
    this.fallbackAir.connect(airGain).connect(this.fallbackGain);

    this.fallbackGust = ctx.createBiquadFilter();
    this.fallbackGust.type = 'bandpass';
    this.fallbackGust.frequency.value = 700;
    this.fallbackGust.Q.value = 0.8;
    this.fallbackGustGain = ctx.createGain();
    this.fallbackGustGain.gain.value = 0.2;
    this.fallbackGust.connect(this.fallbackGustGain).connect(this.fallbackGain);

    const rustleFilter = ctx.createBiquadFilter();
    rustleFilter.type = 'highpass';
    rustleFilter.frequency.value = 3200;
    this.fallbackRustle = ctx.createGain();
    this.fallbackRustle.gain.value = 0;
    rustleFilter.connect(this.fallbackRustle).connect(this.fallbackGain);

    for (const [pan, rate] of [[-0.7, 0.91], [0.7, 1.07]] as const) {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      src.playbackRate.value = rate;
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      src.connect(p);
      p.connect(this.fallbackAir);
      p.connect(this.fallbackGust);
      p.connect(rustleFilter);
      src.start(0, Math.random());
    }
  }

  update(windLevel: number, beachLevel = 0, time = 0): void {
    const t = this.ctx.currentTime;
    if (Math.abs(windLevel - this.windLevel) > 0.01) {
      this.windLevel = windLevel;
      this.windGain.gain.setTargetAtTime(windLevel * 0.75, t, 0.5);
    }

    if (Math.abs(beachLevel - this.beachLevel) > 0.01) {
      this.beachLevel = beachLevel;
      this.beachGain.gain.setTargetAtTime(beachLevel * 0.85, t, 0.4);
    }

    if (this.fallbackGust && this.fallbackAir && this.fallbackGustGain && this.fallbackRustle) {
      // Gusts: a smooth irregular curve 0..1 from a few incommensurate slow sines.
      const g = Math.max(0, Math.min(1, 0.5 + 0.28 * Math.sin(time * 0.071) + 0.18 * Math.sin(time * 0.193 + 1.3) + 0.12 * Math.sin(time * 0.47 + 2.1)));
      this.fallbackGust.frequency.setTargetAtTime(380 + g * 900, t, 0.3);
      this.fallbackGustGain.gain.setTargetAtTime(0.06 + g * g * 0.42, t, 0.3);
      this.fallbackAir.frequency.setTargetAtTime(300 + g * 260, t, 0.3);
      this.fallbackRustle.gain.setTargetAtTime(Math.max(0, g - 0.62) * 0.18, t, 0.25);
    }

    if (this.enableBirds && windLevel > 0.05 && t >= this.nextBird) {
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
