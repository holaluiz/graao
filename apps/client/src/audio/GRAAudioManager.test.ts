import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GRAAudioManager, type AudioCategory, type AudioLoop, type Cue } from './GRAAudioManager';

const ambienceInstances = vi.hoisted(() => [] as { destination: unknown; update: ReturnType<typeof vi.fn> }[]);
vi.mock('./Ambience', () => ({
  Ambience: class {
    readonly update = vi.fn();
    constructor(_ctx: unknown, readonly destination: unknown) { ambienceInstances.push(this); }
  },
}));

class Parameter {
  value = 0;
  readonly targets: number[] = [];
  setTargetAtTime(value: number): void { this.value = value; this.targets.push(value); }
  setValueAtTime(value: number): void { this.value = value; }
  exponentialRampToValueAtTime(value: number): void { this.value = value; }
}

class Node {
  readonly gain = new Parameter();
  readonly frequency = new Parameter();
  readonly Q = new Parameter();
  readonly pan = new Parameter();
  readonly playbackRate = new Parameter();
  readonly threshold = new Parameter();
  readonly ratio = new Parameter();
  readonly attack = new Parameter();
  readonly release = new Parameter();
  readonly connections: unknown[] = [];
  readonly start = vi.fn();
  readonly stop = vi.fn();
  readonly disconnect = vi.fn();
  connect<T>(destination: T): T { this.connections.push(destination); return destination; }
}

class Context {
  static latest: Context;
  readonly destination = new Node();
  readonly gains: Node[] = [];
  readonly sources: Node[] = [];
  currentTime = 8;
  sampleRate = 32;
  state = 'running';
  resume = vi.fn(async () => undefined);
  constructor() { Context.latest = this; }
  createDynamicsCompressor(): Node { return new Node(); }
  createGain(): Node { const node = new Node(); this.gains.push(node); return node; }
  createBiquadFilter(): Node { return new Node(); }
  createStereoPanner(): Node { return new Node(); }
  createOscillator(): Node { const node = new Node(); this.sources.push(node); return node; }
  createBufferSource(): Node { const node = new Node(); this.sources.push(node); return node; }
  createBuffer(_channels: number, length: number): { getChannelData(): Float32Array } {
    return { getChannelData: () => new Float32Array(length) };
  }
}

interface Mixer {
  master: Node;
  world: Node;
  ambientDuck: Node;
  ambientFilter: Node;
  ambientSignal: Node;
  foley: Node;
  buses: Map<AudioCategory, Node>;
  loops: Map<AudioLoop, { gain: Node; filter: Node; base: number }>;
  voices: Map<AudioCategory, { endsAt: number; stop(): void }[]>;
}

function mixer(audio: GRAAudioManager): Mixer { return audio as unknown as Mixer; }

describe('separate audio volumes', () => {
  beforeEach(() => {
    ambienceInstances.length = 0;
    vi.stubGlobal('AudioContext', Context);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('applies selected levels on first unlock while retaining category balance and preselected acoustic state', () => {
    const audio = new GRAAudioManager();
    audio.setVolume(0.6);
    audio.setEffectsVolume(0.25);
    audio.setAmbienceVolume(0.4);
    audio.setState('INSIDE_TORMENTA');
    audio.setUnderwater(true);
    expect(audio.ready).toBe(false);
    audio.unlock();
    expect(audio.ready).toBe(true);
    const graph = mixer(audio);
    expect(graph.master.gain.value).toBe(0.6);
    expect(graph.buses.get('ui')!.gain.value).toBeCloseTo(0.55 * 0.25);
    expect(graph.buses.get('weapons')!.gain.value).toBeCloseTo(0.75 * 0.25);
    expect(graph.buses.get('threat')!.gain.value).toBeCloseTo(0.9 * 0.25);
    expect(graph.buses.get('abilities')!.gain.value).toBeCloseTo(0.8 * 0.25);
    expect(graph.buses.get('match')!.gain.value).toBeCloseTo(0.9 * 0.25);
    expect(graph.buses.get('loot')!.gain.value).toBeCloseTo(0.7 * 0.25);
    expect(graph.buses.get('environment')!.gain.value).toBeCloseTo(0.5 * 0.4);
    expect(graph.buses.get('music')!.gain.value).toBeCloseTo(0.5 * 0.4);
    expect(graph.ambientSignal.gain.value).toBeCloseTo(0.9 * 0.4);
    expect(graph.foley.gain.value).toBeCloseTo(0.5 * 0.25);
    expect(graph.foley.connections).toContain(graph.ambientDuck);
    expect(graph.world.frequency.value).toBe(650);
    expect(graph.ambientFilter.frequency.value).toBe(750);
    expect(graph.ambientDuck.gain.value).toBe(0.3);
  });

  it('changes live effects independently from ambience, master volume and Tormenta ducking', () => {
    const audio = new GRAAudioManager();
    audio.unlock();
    audio.setState('INSIDE_TORMENTA');
    audio.setVolume(0.7);
    audio.setAmbienceVolume(0.3);
    const graph = mixer(audio);
    audio.setEffectsVolume(0);
    for (const cat of ['ui', 'weapons', 'abilities', 'match', 'threat', 'loot'] as const) {
      expect(graph.buses.get(cat)!.gain.value).toBe(0);
    }
    expect(graph.buses.get('environment')!.gain.value).toBeCloseTo(0.15);
    expect(graph.foley.gain.value).toBe(0);
    expect(graph.ambientSignal.gain.value).toBeCloseTo(0.27);
    audio.setEffectsVolume(1);
    expect(graph.buses.get('weapons')!.gain.value).toBe(0.75);
    expect(graph.buses.get('ui')!.gain.value).toBe(0.55);
    audio.setAmbienceVolume(0);
    expect(graph.buses.get('environment')!.gain.value).toBe(0);
    expect(graph.buses.get('music')!.gain.value).toBe(0);
    expect(graph.ambientSignal.gain.value).toBe(0);
    expect(graph.buses.get('match')!.gain.value).toBe(0.9);
    expect(graph.foley.gain.value).toBe(0.5);
    expect(graph.master.gain.value).toBe(0.7);
    expect(graph.ambientDuck.gain.value).toBe(0.3);
    expect(graph.ambientFilter.frequency.value).toBe(750);
  });

  it('keeps continuous wind, UFO, beach and storm layers on ambience while warning cues remain effects', () => {
    const audio = new GRAAudioManager();
    audio.unlock();
    audio.setAmbience(0.7, 0.9, 10);
    const graph = mixer(audio);
    expect(ambienceInstances[0]!.destination).toBe(graph.buses.get('environment'));
    expect(ambienceInstances[0]!.update).toHaveBeenCalledWith(0.7, 0.9, 10);
    for (const name of ['wind', 'hum', 'tormenta'] as const) audio.setLoop(name, 0.6);
    expect(graph.loops.get('wind')!.gain.connections).toContain(graph.buses.get('environment'));
    expect(graph.loops.get('hum')!.gain.connections).toContain(graph.buses.get('environment'));
    expect(graph.loops.get('tormenta')!.gain.connections).toContain(graph.ambientSignal);
    expect(graph.ambientSignal.connections).toContain(graph.master);
    const stormLevel = graph.loops.get('tormenta')!.gain.gain.value;
    audio.setEffectsVolume(0);
    expect(graph.ambientSignal.gain.value).toBe(0.9);
    expect(graph.loops.get('tormenta')!.gain.gain.value).toBe(stormLevel);
    audio.setState('INSIDE_TORMENTA');
    expect(graph.ambientSignal.gain.value).toBe(0.9);
    audio.play('tormenta.warn');
    audio.play('tormenta.hurt');
    expect(graph.voices.get('match')).toHaveLength(1);
    expect(graph.voices.get('threat')).toHaveLength(1);
    audio.setAmbienceVolume(0);
    audio.setEffectsVolume(1);
    expect(graph.ambientSignal.gain.value).toBe(0);
    expect(graph.buses.get('match')!.gain.value).toBe(0.9);
  });

  it('preserves cue routing, threat overrides and voice limits while changing levels', () => {
    const audio = new GRAAudioManager();
    audio.unlock();
    const graph = mixer(audio);
    const cues: [Cue, AudioCategory][] = [
      ['fire.sunbeam', 'weapons'], ['ui.click', 'ui'], ['go', 'match'], ['ab.orb', 'abilities'],
      ['hurt.health', 'threat'], ['loot.pickup', 'loot'], ['land', 'environment'],
    ];
    for (const [cue, category] of cues) {
      const gainCount = Context.latest.gains.length;
      audio.play(cue);
      expect(Context.latest.gains[gainCount]!.connections).toContain(category === 'environment' ? graph.foley : graph.buses.get(category));
    }
    const gainCount = Context.latest.gains.length;
    audio.play('land', { threat: true });
    expect(Context.latest.gains[gainCount]!.connections).toContain(graph.buses.get('threat'));
    const before = graph.voices.get('ui')![0]!;
    const stop = vi.spyOn(before, 'stop');
    for (let i = 0; i < 3; i++) audio.play('ui.click');
    expect(graph.voices.get('ui')).toHaveLength(4);
    audio.setEffectsVolume(0.2);
    audio.setAmbienceVolume(0.8);
    expect(stop).not.toHaveBeenCalled();
    audio.play('ui.click');
    expect(stop).toHaveBeenCalledOnce();
    expect(graph.voices.get('ui')).toHaveLength(4);
  });

  it('retains movement and water action effects when ambience is muted', () => {
    const audio = new GRAAudioManager();
    audio.unlock();
    audio.setAmbienceVolume(0);
    const graph = mixer(audio);
    expect(graph.buses.get('environment')!.gain.value).toBe(0);
    expect(graph.foley.gain.value).toBe(0.5);
    const actions: Cue[] = ['ufo.jump', 'land', 'land.water', 'splash', 'swim.stroke', 'wade', 'jump.air', 'gasp'];
    for (const cue of actions) {
      const gainCount = Context.latest.gains.length;
      audio.play(cue);
      expect(Context.latest.gains[gainCount]!.connections).toContain(graph.foley);
    }
    // Existing environmental category limits still cap these overlapping actions at six voices.
    expect(graph.voices.get('environment')).toHaveLength(6);
    audio.setEffectsVolume(0);
    expect(graph.foley.gain.value).toBe(0);
    audio.setAmbienceVolume(1);
    expect(graph.foley.gain.value).toBe(0);
    expect(graph.buses.get('environment')!.gain.value).toBe(0.5);
  });

  it('clamps finite levels and rejects invalid values before and after unlock', () => {
    const audio = new GRAAudioManager();
    audio.setEffectsVolume(-3);
    audio.setAmbienceVolume(4);
    audio.setVolume(2);
    expect([audio.effectsVolume, audio.ambienceVolume, audio.volume]).toEqual([0, 1, 1]);
    audio.unlock();
    audio.setEffectsVolume(0.2);
    audio.setAmbienceVolume(0.3);
    audio.setVolume(0.4);
    for (const value of [NaN, Infinity, -Infinity]) {
      audio.setEffectsVolume(value);
      audio.setAmbienceVolume(value);
      audio.setVolume(value);
    }
    expect([audio.effectsVolume, audio.ambienceVolume, audio.volume]).toEqual([0.2, 0.3, 0.4]);
    expect(mixer(audio).buses.get('weapons')!.gain.value).toBeCloseTo(0.15);
    expect(mixer(audio).buses.get('environment')!.gain.value).toBeCloseTo(0.15);
    expect(mixer(audio).master.gain.value).toBe(0.4);
  });
});
