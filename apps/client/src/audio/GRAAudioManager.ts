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
import { Ambience } from './Ambience';

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
  // Character creator: a piece of clothing swapped (cloth swish and a soft pop).
  | 'ui.swap'
  | 'countdown'
  | 'go'
  | 'victory'
  | 'defeat'
  | 'death'
  // Abilities: one cast cue per presentation family, plus shared impacts, warnings and HUD cues.
  | 'ab.orb'
  | 'ab.dash'
  | 'ab.pollen'
  | 'ab.shield'
  | 'ab.seed'
  | 'ab.gust'
  | 'ab.sap'
  | 'ab.heal'
  | 'ab.meteor'
  | 'ab.cyclone'
  | 'ab.lance'
  | 'ab.impact'
  | 'ab.area'
  | 'ab.boom'
  | 'ab.warn'
  | 'ab.denied'
  | 'ult.ready'
  // Ability Draft: a choice locked in, a round revealed, a disputed ability lost, the last seconds of a window.
  | 'draft.lock'
  | 'draft.reveal'
  | 'draft.lost'
  | 'draft.tick'
  // UFO deployment: the hatch opening, a jump out, a landing on the ground or in water.
  | 'ufo.open'
  | 'ufo.jump'
  | 'land'
  | 'land.water'
  // Water: someone hitting it, a swim stroke, a step while wading.
  | 'splash'
  | 'swim.stroke'
  | 'wade'
  // Movement: the double jump's puff of air.
  | 'jump.air'
  // Water: gasp upon surfacing from a long dive.
  | 'gasp';

/** Continuous layers driven every frame by a level (0 = silent): the dive's wind and the UFO's hum. */
export type AudioLoop = 'wind' | 'hum';

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
  'ui.swap': 'ui',
  'draft.lock': 'ui',
  'draft.reveal': 'match',
  'draft.lost': 'match',
  'draft.tick': 'ui',
  countdown: 'match',
  go: 'match',
  victory: 'match',
  defeat: 'match',
  death: 'match',
  'ab.orb': 'abilities',
  'ab.dash': 'abilities',
  'ab.pollen': 'abilities',
  'ab.shield': 'abilities',
  'ab.seed': 'abilities',
  'ab.gust': 'abilities',
  'ab.sap': 'abilities',
  'ab.heal': 'abilities',
  'ab.meteor': 'abilities',
  'ab.cyclone': 'abilities',
  'ab.lance': 'abilities',
  'ab.impact': 'abilities',
  'ab.area': 'abilities',
  'ab.boom': 'abilities',
  'ab.warn': 'threat',
  'ab.denied': 'ui',
  'ult.ready': 'match',
  'ufo.open': 'match',
  'ufo.jump': 'environment',
  land: 'environment',
  'land.water': 'environment',
  splash: 'environment',
  'swim.stroke': 'environment',
  wade: 'environment',
  'jump.air': 'environment',
  gasp: 'environment',
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
  private readonly loops = new Map<AudioLoop, { gain: GainNode; filter: BiquadFilterNode; base: number }>();
  state: AudioState = 'NORMAL';
  volume = 0.8;
  /** The camera is under the water: the world is heard muffled (on top of the state's own filter). */
  private underwater = false;
  /** Wind and birds (built on first use). */
  private ambience: Ambience | null = null;

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
    this.applyWorldFilter();
  }

  setUnderwater(on: boolean): void {
    if (on === this.underwater) return;
    this.underwater = on;
    this.applyWorldFilter();
  }

  private applyWorldFilter(): void {
    if (!this.ctx) return;
    const s = this.state;
    // Aboard the UFO the world is heard through the hull; under water, through the water.
    const freq = Math.min(s === 'LOW_HEALTH' ? 900 : s === 'POST_MATCH' ? 2600 : s === 'UFO' ? 5200 : 20000, this.underwater ? 650 : 20000);
    this.world.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.12);
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

  /** Outdoor bed (wind gusts, birds) at `level` (0 silent … 1 on the ground); `time` (s) drives the gusts. */
  setAmbience(level: number, time: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.noise) return;
    this.ambience ??= new Ambience(ctx, this.buses.get('environment')!, this.noise);
    this.ambience.update(level, time);
  }

  /**
   * Sets a continuous layer's level (0..1) and tone (`tone` 0..1: the wind gets brighter with speed). The layer is
   * built on first use and keeps running silently afterwards (no per-frame allocation).
   */
  setLoop(name: AudioLoop, level: number, tone = 0.5): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    let l = this.loops.get(name);
    if (!l) {
      if (level <= 0.001) return;
      l = this.buildLoop(ctx, name);
      this.loops.set(name, l);
    }
    const t = ctx.currentTime;
    l.gain.gain.setTargetAtTime(Math.max(0, Math.min(1, level)) * l.base, t, 0.12);
    if (name === 'wind') l.filter.frequency.setTargetAtTime(380 + tone * 1700, t, 0.15);
  }

  private buildLoop(ctx: AudioContext, name: AudioLoop): { gain: GainNode; filter: BiquadFilterNode; base: number } {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.connect(gain).connect(this.buses.get('environment')!);
    if (name === 'wind') {
      // Rushing air: looping noise through a moving band-pass.
      filter.type = 'bandpass';
      filter.Q.value = 0.6;
      filter.frequency.value = 600;
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      src.connect(filter);
      src.start();
      return { gain, filter, base: 0.9 };
    }
    // The ship's hum: a low fifth with a slow wobble.
    filter.type = 'lowpass';
    filter.frequency.value = 700;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.45;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 4;
    lfo.connect(lfoGain);
    for (const [f, type, g] of [[62, 'sine', 0.6], [93, 'triangle', 0.22], [124.5, 'sine', 0.18]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      lfoGain.connect(o.frequency);
      const og = ctx.createGain();
      og.gain.value = g;
      o.connect(og).connect(filter);
      o.start();
    }
    lfo.start();
    return { gain, filter, base: 0.5 };
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
      case 'ui.swap':
        this.noiseBurst(out, t, 0.16, 0.22, 'bandpass', 900 * p, 2600 * p, 0.9);
        this.osc(out, 'sine', t + 0.05, 520 * p, 780 * p, 0.09, 0.14);
        return 0.2;
      case 'ui.ready':
        this.osc(out, 'sine', t, 660, 660, 0.09, 0.2);
        this.osc(out, 'sine', t + 0.08, 990, 990, 0.12, 0.2);
        return 0.2;
      case 'countdown':
        this.osc(out, 'sine', t, 880, 880, 0.12, 0.3);
        return 0.13;
      case 'draft.lock':
        // A card pressed onto paper: a soft tap and a small bell.
        this.noiseBurst(out, t, 0.05, 0.25, 'lowpass', 1400, 600);
        this.osc(out, 'triangle', t + 0.02, 1318.5, 1318.5, 0.22, 0.14, 0.005);
        return 0.25;
      case 'draft.reveal':
        // Cards turning over: a quick paper sweep and an open fifth.
        this.noiseBurst(out, t, 0.18, 0.18, 'bandpass', 2400, 5200, 1.2);
        this.osc(out, 'triangle', t + 0.06, 587.33, 587.33, 0.4, 0.16, 0.01);
        this.osc(out, 'triangle', t + 0.12, 880, 880, 0.45, 0.14, 0.01);
        return 0.6;
      case 'draft.lost':
        // Someone else kept it: two notes stepping down, then a hopeful lift (pick again).
        this.osc(out, 'sine', t, 659.25, 659.25, 0.14, 0.2);
        this.osc(out, 'sine', t + 0.13, 523.25, 523.25, 0.16, 0.2);
        this.osc(out, 'triangle', t + 0.3, 783.99, 783.99, 0.18, 0.12);
        return 0.5;
      case 'draft.tick':
        this.osc(out, 'square', t, 1760, 1760, 0.025, 0.05);
        return 0.03;
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
      // ------------------------------------------------------------------------------------------ abilities
      case 'ab.orb':
        // A bright rising "fwoom" with a shimmer on top.
        this.osc(out, 'triangle', t, 420 * p, 1250 * p, 0.16, 0.3, 0.01);
        this.osc(out, 'sine', t + 0.02, 1680 * p, 2520 * p, 0.12, 0.1);
        this.noiseBurst(out, t, 0.18, 0.18, 'bandpass', 1800 * p, 4200 * p, 1.2);
        return 0.2;
      case 'ab.dash':
        this.noiseBurst(out, t, 0.28, 0.42, 'bandpass', 700 * p, 2600 * p, 0.9);
        this.osc(out, 'sine', t, 240 * p, 520 * p, 0.12, 0.12, 0.01);
        return 0.3;
      case 'ab.pollen':
        this.noiseBurst(out, t, 0.14, 0.25, 'bandpass', 3200 * p, 1800 * p, 1.5);
        for (let k = 0; k < 3; k++) this.osc(out, 'sine', t + k * 0.04, (1900 + k * 420) * p, (2100 + k * 420) * p, 0.08, 0.08);
        return 0.22;
      case 'ab.shield':
        // Crystalline chime: stacked fifths ringing out.
        for (const [k, f] of [523.25, 783.99, 1174.66, 1567.98].entries()) this.osc(out, 'sine', t + k * 0.03, f * p, f * p, 0.5 - k * 0.07, 0.14, 0.008);
        this.noiseBurst(out, t, 0.08, 0.12, 'highpass', 6000);
        return 0.52;
      case 'ab.seed':
        this.osc(out, 'square', t, 320 * p, 180 * p, 0.06, 0.12);
        this.noiseBurst(out, t, 0.12, 0.28, 'bandpass', 1400 * p, 900 * p, 2);
        return 0.13;
      case 'ab.gust':
        this.noiseBurst(out, t, 0.45, 0.5, 'lowpass', 2400, 400, 0.7);
        this.osc(out, 'sine', t, 160 * p, 60 * p, 0.35, 0.4, 0.01);
        return 0.46;
      case 'ab.sap':
        // A sticky "blorp": low sine with a fast wobble.
        this.osc(out, 'sine', t, 260 * p, 120 * p, 0.18, 0.4);
        this.osc(out, 'triangle', t + 0.03, 520 * p, 300 * p, 0.1, 0.12);
        return 0.2;
      case 'ab.heal':
        for (const [k, f] of [392, 493.88, 587.33, 783.99].entries()) this.osc(out, 'triangle', t + k * 0.07, f * p, f * p, 0.55, 0.13, 0.02);
        this.noiseBurst(out, t, 0.3, 0.06, 'highpass', 7000);
        return 0.8;
      case 'ab.meteor':
        // Wind-up roar rising toward the fall.
        this.noiseBurst(out, t, 1.1, 0.4, 'bandpass', 300, 2400, 0.8);
        this.osc(out, 'sawtooth', t, 70 * p, 210 * p, 1.0, 0.16, 0.2);
        return 1.1;
      case 'ab.cyclone':
        this.noiseBurst(out, t, 0.9, 0.38, 'bandpass', 900, 3400, 1.4);
        for (let k = 0; k < 4; k++) this.osc(out, 'sine', t + k * 0.12, 660 * p, 990 * p, 0.12, 0.08);
        return 0.9;
      case 'ab.lance':
        // Charging hum that climbs, then a release crack.
        this.osc(out, 'sawtooth', t, 180 * p, 900 * p, 0.7, 0.12, 0.15);
        this.osc(out, 'sine', t, 360 * p, 1800 * p, 0.7, 0.12, 0.15);
        this.noiseBurst(out, t + 0.68, 0.12, 0.45, 'highpass', 2500);
        this.osc(out, 'square', t + 0.68, 1600 * p, 500 * p, 0.12, 0.2);
        return 0.82;
      case 'ab.impact':
        this.osc(out, 'sine', t, 520 * p, 180 * p, 0.1, 0.35);
        this.noiseBurst(out, t, 0.08, 0.25, 'bandpass', 2600 * p, 900 * p, 1.2);
        return 0.11;
      case 'ab.area':
        this.osc(out, 'sine', t, 150 * p, 55 * p, 0.3, 0.55);
        this.noiseBurst(out, t, 0.3, 0.38, 'lowpass', 3200, 500, 0.8);
        return 0.32;
      case 'ab.boom':
        this.osc(out, 'sine', t, 110 * p, 32 * p, 0.7, 0.8, 0.005);
        this.noiseBurst(out, t, 0.7, 0.55, 'lowpass', 4200, 200, 0.7);
        this.osc(out, 'triangle', t, 260 * p, 90 * p, 0.25, 0.25);
        return 0.72;
      case 'ab.warn':
        // Two-tone warning ping: an ability is about to land here.
        this.osc(out, 'triangle', t, 990, 990, 0.09, 0.22);
        this.osc(out, 'triangle', t + 0.11, 740, 740, 0.12, 0.22);
        return 0.24;
      case 'ab.denied':
        this.osc(out, 'square', t, 150, 140, 0.07, 0.1);
        this.osc(out, 'square', t + 0.09, 130, 120, 0.09, 0.1);
        return 0.19;
      case 'ufo.open':
        // The hatch opens: an airy hiss and a bright rising fifth ("go now").
        this.noiseBurst(out, t, 0.5, 0.25, 'highpass', 2500, 6000, 0.7);
        this.osc(out, 'triangle', t + 0.05, 587.33, 587.33, 0.3, 0.18, 0.01);
        this.osc(out, 'triangle', t + 0.2, 880, 880, 0.45, 0.18, 0.01);
        return 0.65;
      case 'ufo.jump':
        // A hatch clunk, then air rushing past.
        this.osc(out, 'square', t, 180 * p, 90 * p, 0.06, 0.12);
        this.noiseBurst(out, t + 0.03, 0.7, 0.45, 'bandpass', 500 * p, 2400 * p, 0.8);
        return 0.75;
      case 'land':
        // A soft heavy thump and a puff of dust.
        this.osc(out, 'sine', t, 130 * p, 45 * p, 0.28, 0.75);
        this.noiseBurst(out, t, 0.32, 0.35, 'lowpass', 1600, 300, 0.7);
        return 0.33;
      case 'land.water':
        this.noiseBurst(out, t, 0.6, 0.5, 'bandpass', 1800 * p, 600 * p, 0.6);
        this.osc(out, 'sine', t, 220 * p, 80 * p, 0.2, 0.35);
        for (let k = 0; k < 4; k++) this.osc(out, 'sine', t + 0.08 + k * 0.07, (900 + k * 260) * p, (700 + k * 200) * p, 0.05, 0.06);
        return 0.62;
      case 'splash':
        // A smaller plunge: a wet slap, a low gulp and a few droplets.
        this.noiseBurst(out, t, 0.38, 0.4, 'bandpass', 2400 * p, 700 * p, 0.7);
        this.osc(out, 'sine', t, 300 * p, 110 * p, 0.15, 0.2);
        for (let k = 0; k < 3; k++) this.osc(out, 'sine', t + 0.06 + k * 0.06, (1100 + k * 300) * p, (800 + k * 200) * p, 0.04, 0.05);
        return 0.45;
      case 'swim.stroke':
        // An arm cutting the water: a soft rising swish and a little bloop.
        this.noiseBurst(out, t, 0.22, 0.18, 'bandpass', 900 * p, 1500 * p, 0.9);
        this.osc(out, 'sine', t + 0.12, 420 * p, 260 * p, 0.08, 0.05);
        return 0.3;
      case 'wade':
        this.noiseBurst(out, t, 0.14, 0.16, 'bandpass', 1600 * p, 900 * p, 1.2);
        return 0.16;
      case 'jump.air':
        // Air kicked down under the feet: a short rising swish with a light lift on top.
        this.noiseBurst(out, t, 0.2, 0.3, 'bandpass', 500 * p, 2000 * p, 0.8);
        this.osc(out, 'sine', t, 320 * p, 640 * p, 0.09, 0.07, 0.01);
        return 0.22;
      case 'gasp':
        // A sharp intake of breath upon surfacing: breathy noise rushing in with a quick rise.
        this.noiseBurst(out, t, 0.35, 0.3, 'bandpass', 600 * p, 2800 * p, 0.9);
        this.osc(out, 'sine', t + 0.05, 200 * p, 380 * p, 0.15, 0.08);
        return 0.36;
      case 'ult.ready':
        [659.25, 830.61, 987.77, 1318.51].forEach((f, k) => this.osc(out, 'triangle', t + k * 0.075, f, f, 0.4, 0.17, 0.01));
        this.noiseBurst(out, t + 0.2, 0.4, 0.07, 'highpass', 6500);
        return 0.7;
    }
  }
}
