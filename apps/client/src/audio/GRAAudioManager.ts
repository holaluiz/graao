/**
 * GRAAudioManager: Web Audio mixer for graao.
 *
 * Buses by category (Threat, Weapons, Abilities, Match, UI, Music, Environment) with per-category voice limits;
 * when a category is full the oldest voice is cut. Priority comes from routing: enemy threat sits on its own bus that
 * the LOW_HEALTH state never muffles, while the "world" buses (weapons, environment, music) get a low-pass.
 *
 * MVP sounds are synthesized (oscillators + filtered noise), so the game ships zero audio files for now and every
 * cue is tweakable in code. Recorded assets can replace any cue later behind the same names.
 */
export type AudioCategory = 'threat' | 'weapons' | 'abilities' | 'match' | 'ui' | 'music' | 'environment';
export type AudioState = 'NORMAL' | 'LOW_HEALTH' | 'UFO' | 'POST_MATCH';

export type Cue =
  | 'fire.sunbeam'
  | 'fire.petal'
  | 'hit.body'
  | 'hit.crit'
  | 'hit.shield'
  | 'hit.shieldBreak'
  | 'hit.elim'
  | 'hurt.health'
  | 'hurt.shield'
  | 'hurt.shieldBreak'
  | 'reload'
  | 'empty'
  | 'switch'
  | 'ui.click'
  | 'ui.ready'
  | 'countdown'
  | 'go'
  | 'victory'
  | 'defeat'
  | 'death';

const VOICE_LIMIT: Record<AudioCategory, number> = { threat: 8, weapons: 10, abilities: 8, match: 4, ui: 4, music: 2, environment: 6 };
const CATEGORY_GAIN: Record<AudioCategory, number> = { threat: 0.9, weapons: 0.75, abilities: 0.8, match: 0.9, ui: 0.55, music: 0.5, environment: 0.5 };

const CUE_CATEGORY: Record<Cue, AudioCategory> = {
  'fire.sunbeam': 'weapons',
  'fire.petal': 'weapons',
  'hit.body': 'weapons',
  'hit.crit': 'weapons',
  'hit.shield': 'weapons',
  'hit.shieldBreak': 'weapons',
  'hit.elim': 'match',
  'hurt.health': 'threat',
  'hurt.shield': 'threat',
  'hurt.shieldBreak': 'threat',
  reload: 'weapons',
  empty: 'weapons',
  switch: 'weapons',
  'ui.click': 'ui',
  'ui.ready': 'ui',
  countdown: 'match',
  go: 'match',
  victory: 'match',
  defeat: 'match',
  death: 'match',
};

export interface PlayOptions {
  /** 0..1 volume multiplier. */
  volume?: number;
  /** -1 (left) .. 1 (right). */
  pan?: number;
  /** Route to the threat bus (enemy sounds) instead of the cue's own category. */
  threat?: boolean;
  /** Pitch multiplier. */
  pitch?: number;
  /** Seconds of low-pass muffling for distant sounds (0 = clear). */
  muffle?: number;
}

interface Voice {
  stop(): void;
  endsAt: number;
}

export class GRAAudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private world!: BiquadFilterNode;
  private readonly buses = new Map<AudioCategory, GainNode>();
  private readonly voices = new Map<AudioCategory, Voice[]>();
  private noise: AudioBuffer | null = null;
  state: AudioState = 'NORMAL';
  volume = 0.8;

  /** Creates/resumes the context; must run inside a user gesture (ENTER button). */
  unlock(): void {
    try {
      if (!this.ctx) this.build(new AudioContext());
      void this.ctx!.resume();
    } catch {
      this.ctx = null;
    }
  }

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  private build(ctx: AudioContext): void {
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.15;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(comp);
    this.world = ctx.createBiquadFilter();
    this.world.type = 'lowpass';
    this.world.frequency.value = 20000;
    this.world.Q.value = 0.5;
    this.world.connect(this.master);
    for (const cat of Object.keys(VOICE_LIMIT) as AudioCategory[]) {
      const g = ctx.createGain();
      g.gain.value = CATEGORY_GAIN[cat];
      // Threat, match and UI stay clear in every state; the rest goes through the "world" filter.
      g.connect(cat === 'threat' || cat === 'match' || cat === 'ui' ? this.master : this.world);
      this.buses.set(cat, g);
      this.voices.set(cat, []);
    }
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  setState(s: AudioState): void {
    if (s === this.state || !this.ctx) {
      this.state = s;
      return;
    }
    this.state = s;
    const t = this.ctx.currentTime;
    const freq = s === 'LOW_HEALTH' ? 900 : s === 'POST_MATCH' ? 2600 : 20000;
    this.world.frequency.setTargetAtTime(freq, t, 0.12);
  }

  play(cue: Cue, o: PlayOptions = {}): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const cat = o.threat ? 'threat' : CUE_CATEGORY[cue];
    const list = this.voices.get(cat)!;
    const now = ctx.currentTime;
    for (let i = list.length - 1; i >= 0; i--) if (list[i]!.endsAt < now) list.splice(i, 1);
    if (list.length >= VOICE_LIMIT[cat]) list.shift()?.stop();

    // Per-voice chain: [sources] → gain → (muffle) → pan → bus.
    const out = ctx.createGain();
    out.gain.value = o.volume ?? 1;
    let tail: AudioNode = out;
    if (o.muffle && o.muffle > 0) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = Math.max(500, 9000 * (1 - Math.min(1, o.muffle)));
      tail.connect(lp);
      tail = lp;
    }
    if (o.pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, o.pan));
      tail.connect(p);
      tail = p;
    }
    tail.connect(this.buses.get(cat)!);
    const pitch = (o.pitch ?? 1) * (0.97 + Math.random() * 0.06);
    const dur = this.synth(cue, out, now, pitch);
    const nodes: AudioScheduledSourceNode[] = (out as unknown as { __src?: AudioScheduledSourceNode[] }).__src ?? [];
    list.push({
      endsAt: now + dur,
      stop: () => {
        for (const n of nodes) {
          try {
            n.stop();
          } catch {
            /* already stopped */
          }
        }
      },
    });
  }

  // ------------------------------------------------------------------------------------------------ synthesis

  private osc(out: GainNode, type: OscillatorType, t: number, f0: number, f1: number, dur: number, gain: number, attack = 0.004): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
    this.track(out, o);
  }

  private noiseBurst(out: GainNode, t: number, dur: number, gain: number, type: BiquadFilterType, f0: number, f1 = f0, q = 1): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loopStart = Math.random() * 0.5;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
    this.track(out, src);
  }

  private track(out: GainNode, n: AudioScheduledSourceNode): void {
    const o = out as unknown as { __src?: AudioScheduledSourceNode[] };
    (o.__src ??= []).push(n);
  }

  /** Builds one cue; returns its duration (s). */
  private synth(cue: Cue, out: GainNode, t: number, p: number): number {
    switch (cue) {
      case 'fire.sunbeam':
        // Bright zap with a falling pitch, a click on top.
        this.osc(out, 'sawtooth', t, 1500 * p, 420 * p, 0.09, 0.22);
        this.osc(out, 'square', t, 760 * p, 260 * p, 0.07, 0.08);
        this.noiseBurst(out, t, 0.04, 0.35, 'highpass', 3000);
        return 0.1;
      case 'fire.petal':
        // Soft thump plus an airy whoosh (a puff of petals).
        this.osc(out, 'sine', t, 190 * p, 55 * p, 0.16, 0.55);
        this.noiseBurst(out, t, 0.2, 0.32, 'bandpass', 2400 * p, 700 * p, 0.8);
        this.osc(out, 'triangle', t + 0.01, 620 * p, 300 * p, 0.06, 0.12);
        return 0.22;
      case 'hit.body':
        this.osc(out, 'triangle', t, 1900 * p, 1700 * p, 0.05, 0.28);
        this.noiseBurst(out, t, 0.03, 0.15, 'highpass', 4000);
        return 0.06;
      case 'hit.crit':
        this.osc(out, 'sine', t, 2350 * p, 2350 * p, 0.12, 0.3);
        this.osc(out, 'sine', t + 0.03, 3520 * p, 3520 * p, 0.14, 0.22);
        return 0.18;
      case 'hit.shield':
        // Glassy ping with a little shimmer.
        this.osc(out, 'sine', t, 1250 * p, 1180 * p, 0.12, 0.25);
        this.osc(out, 'sine', t, 2510 * p, 2400 * p, 0.08, 0.1);
        this.noiseBurst(out, t, 0.05, 0.12, 'highpass', 6000);
        return 0.13;
      case 'hit.shieldBreak':
        this.noiseBurst(out, t, 0.32, 0.4, 'bandpass', 5200, 900, 1.4);
        for (let k = 0; k < 4; k++) this.osc(out, 'sine', t + k * 0.035, (2600 - k * 380) * p, (2400 - k * 380) * p, 0.12, 0.14);
        return 0.34;
      case 'hit.elim':
        // A warm chord swelling, then a low thump: "you got them".
        for (const f of [523.25, 659.25, 783.99]) this.osc(out, 'triangle', t, f * p, f * p, 0.65, 0.16, 0.02);
        this.osc(out, 'sine', t, 140, 50, 0.3, 0.5);
        return 0.66;
      case 'hurt.health':
        this.osc(out, 'sine', t, 120, 60, 0.22, 0.7);
        this.noiseBurst(out, t, 0.12, 0.3, 'lowpass', 900, 300);
        return 0.23;
      case 'hurt.shield':
        this.osc(out, 'sine', t, 700, 520, 0.14, 0.3);
        this.noiseBurst(out, t, 0.08, 0.15, 'bandpass', 3000, 1500);
        return 0.15;
      case 'hurt.shieldBreak':
        this.noiseBurst(out, t, 0.4, 0.45, 'bandpass', 3800, 500, 1.2);
        this.osc(out, 'sine', t, 900, 300, 0.35, 0.3);
        return 0.42;
      case 'reload':
        this.noiseBurst(out, t, 0.035, 0.35, 'bandpass', 2600, 2600, 4);
        this.noiseBurst(out, t + 0.22, 0.04, 0.4, 'bandpass', 1800, 1800, 4);
        this.osc(out, 'square', t + 0.22, 420, 380, 0.03, 0.06);
        return 0.28;
      case 'empty':
        this.noiseBurst(out, t, 0.025, 0.3, 'bandpass', 3200, 3200, 6);
        return 0.03;
      case 'switch':
        this.noiseBurst(out, t, 0.06, 0.2, 'bandpass', 1400, 2200, 2);
        this.osc(out, 'triangle', t + 0.04, 900, 1100, 0.04, 0.08);
        return 0.09;
      case 'ui.click':
        this.osc(out, 'triangle', t, 1100, 900, 0.04, 0.16);
        return 0.05;
      case 'ui.ready':
        this.osc(out, 'sine', t, 660, 660, 0.09, 0.2);
        this.osc(out, 'sine', t + 0.08, 990, 990, 0.12, 0.2);
        return 0.2;
      case 'countdown':
        this.osc(out, 'sine', t, 880, 880, 0.12, 0.3);
        return 0.13;
      case 'go':
        this.osc(out, 'sine', t, 1320, 1320, 0.28, 0.32);
        this.osc(out, 'triangle', t, 660, 660, 0.28, 0.15);
        return 0.3;
      case 'victory':
        [523.25, 659.25, 783.99, 1046.5].forEach((f, k) => this.osc(out, 'triangle', t + k * 0.11, f, f, 0.5, 0.2, 0.01));
        return 0.9;
      case 'defeat':
        [392, 349.23, 311.13, 261.63].forEach((f, k) => this.osc(out, 'sine', t + k * 0.16, f, f * 0.98, 0.5, 0.2, 0.02));
        return 1.1;
      case 'death':
        this.osc(out, 'sine', t, 300, 70, 0.6, 0.4);
        this.noiseBurst(out, t, 0.5, 0.2, 'lowpass', 1200, 200);
        return 0.6;
    }
  }
}
