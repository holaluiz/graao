/**
 * The planet's own sounds (docs/world/WORLD_DESIGN.md, "Áudio e ambientação"), all synthesized here — no recordings,
 * nothing licensed:
 *
 * - Region beds under the wind loop: the Bairro's distant murmur, water by the lake, the falls and the fountains,
 *   insects and leaves in the Bosque, a faint hum in the Fenda. Each region of the map has a soundscape; where the
 *   listener stands mixes them (region radius, a soft edge), and the water points of the map (the waterfall, the
 *   chafariz, the bica, the streams) add water as you walk up to them.
 * - Calls now and then: a sabiá's whistle and the chapel bell in the Vila, a bem-te-vi, pigeons and a bicycle bell in
 *   the Bairro, an egret on the lake, a hawk over the serras, crickets in the Bosque.
 * - Doors (a creak and the latch, a thud) and crates (a knock, the crunch of a break), placed by distance and side.
 *
 * Levels stay low and the beds go through the ambience bus (ducked by the Tormenta, the ambience slider), so steps,
 * shots and warnings always come first.
 */
import { KIT_PREFABS, REGIONS } from '@graao/game-data';
import type { Placement } from '@graao/game-core';
import type { Vec3 } from '@graao/shared';
import type { GRAAudioManager } from './GRAAudioManager';

type Bed = 'murmur' | 'water' | 'insects' | 'leaves' | 'crystal';
type Call = 'sabia' | 'bemtevi' | 'pombo' | 'sino' | 'garca' | 'gaviao' | 'grilo' | 'bicicleta';

interface Soundscape {
  beds: Partial<Record<Bed, number>>;
  /** Mean seconds between two calls of each kind (while the region is fully heard). */
  calls: Partial<Record<Call, number>>;
}

/** Soundscapes by region key; the open country between regions uses `campo`. */
const SCAPES: Record<string, Soundscape> = {
  vila: { beds: { leaves: 0.25 }, calls: { sabia: 9, sino: 70 } },
  bairro: { beds: { murmur: 0.6, leaves: 0.1 }, calls: { bemtevi: 12, pombo: 15, bicicleta: 40 } },
  lago: { beds: { water: 0.45, leaves: 0.15 }, calls: { garca: 16, sabia: 22 } },
  bosque: { beds: { insects: 0.4, leaves: 0.45 }, calls: { sabia: 8, grilo: 6 } },
  arcos: { beds: { insects: 0.25, leaves: 0.35 }, calls: { sabia: 14 } },
  serra: { beds: { leaves: 0.05 }, calls: { gaviao: 22 } },
  planalto: { beds: { leaves: 0.08 }, calls: { gaviao: 26, bemtevi: 40 } },
  fenda: { beds: { crystal: 0.35 }, calls: { gaviao: 40 } },
  campo: { beds: { leaves: 0.18, insects: 0.1 }, calls: { bemtevi: 24, sabia: 30 } },
};

/** Water points: kit prefabs that splash, and how far they carry (m). */
const WATER_POINTS: Record<string, number> = { 'cachoeira-agua': 30, 'chafariz-agua': 11, 'bica-agua': 7, 'riacho-4': 7 };

const DEG = Math.PI / 180;
const BED_GAIN = 0.32;

interface BedNodes {
  gain: GainNode;
  level: number;
}

export class WorldAudio {
  /** Region weights at the listener, for the dev overlay. */
  readonly weights: Record<string, number> = {};
  private ctxOut: { ctx: AudioContext; bus: AudioNode; noise: AudioBuffer } | null = null;
  private beds: Partial<Record<Bed, BedNodes>> = {};
  private readonly nextCall: Partial<Record<Call, number>> = {};
  private readonly water: { pos: Vec3; reach: number }[] = [];
  private readonly regions = REGIONS.filter((r) => SCAPES[r.key]).map((r) => ({ key: r.key, radius: r.radiusDeg, dir: dirOf(r.lat, r.lon) }));
  private time = 0;

  constructor(private readonly audio: GRAAudioManager, placements: readonly Placement[]) {
    for (const p of placements) {
      const reach = p.prefab && KIT_PREFABS[p.prefab] ? WATER_POINTS[p.prefab] : undefined;
      if (reach) this.water.push({ pos: p.position, reach });
    }
  }

  /** Beds and calls for a listener at `ear` (the camera) looking with `right` to its right; `level` 0…1 (orbit, Tormenta). */
  update(dt: number, ear: Vec3, right: Vec3, level: number): void {
    this.time += dt;
    const out = this.connect();
    if (!out) return;
    const len = Math.hypot(ear.x, ear.y, ear.z) || 1;
    const dir = { x: ear.x / len, y: ear.y / len, z: ear.z / len };
    // Region weights: full inside 70 % of the radius, fading to nothing 15 % past it.
    let strongest = 0;
    for (const r of this.regions) {
      const ang = Math.acos(Math.max(-1, Math.min(1, dir.x * r.dir.x + dir.y * r.dir.y + dir.z * r.dir.z))) / DEG;
      const w = Math.max(0, Math.min(1, (r.radius * 1.15 - ang) / (r.radius * 0.45)));
      this.weights[r.key] = w;
      strongest = Math.max(strongest, w);
    }
    this.weights.campo = 1 - strongest;
    const target: Record<Bed, number> = { murmur: 0, water: 0, insects: 0, leaves: 0, crystal: 0 };
    for (const [key, w] of Object.entries(this.weights)) {
      if (w <= 0) continue;
      for (const [bed, v] of Object.entries(SCAPES[key]!.beds)) target[bed as Bed] += w * v;
    }
    for (const p of this.water) {
      const d = Math.hypot(p.pos.x - ear.x, p.pos.y - ear.y, p.pos.z - ear.z);
      if (d < p.reach) target.water = Math.max(target.water, (1 - d / p.reach) ** 1.5 * (p.reach > 20 ? 1 : 0.6));
    }
    const t = out.ctx.currentTime;
    for (const bed of Object.keys(target) as Bed[]) {
      const b = this.bed(bed);
      const v = Math.min(1, target[bed]) * level * BED_GAIN;
      if (Math.abs(v - b.level) > 0.002) {
        b.gain.gain.setTargetAtTime(v, t, 0.6);
        b.level = v;
      }
    }
    // Calls: each kind on its own random clock, scaled by how much of its regions is heard.
    if (level < 0.05) return;
    for (const call of ['sabia', 'bemtevi', 'pombo', 'sino', 'garca', 'gaviao', 'grilo', 'bicicleta'] as Call[]) {
      let rate = 0;
      for (const [key, w] of Object.entries(this.weights)) {
        const every = SCAPES[key]!.calls[call];
        if (every && w > 0) rate += w / every;
      }
      if (rate <= 0) continue;
      const due = this.nextCall[call] ?? this.time + Math.random() / rate;
      if (this.nextCall[call] === undefined) this.nextCall[call] = due;
      if (this.time < due) continue;
      this.nextCall[call] = this.time + (0.5 + Math.random()) / rate;
      this.call(call, level, (Math.random() - 0.5) * 1.4);
    }
    void right;
  }

  /** A door swung open (creak, latch) or shut (thud, latch) at `at`. */
  door(at: Vec3, open: boolean, ear: Vec3, right: Vec3): void {
    const v = this.place(at, ear, right, 34);
    const out = this.audio.output('loot');
    if (!v || !out) return;
    const { ctx } = out;
    const t = ctx.currentTime;
    const g = this.voice(out, v.gain * 0.9, v.pan);
    if (open) {
      // Wooden creak: a rough tone gliding up, then the latch.
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(190, t);
      o.frequency.exponentialRampToValueAtTime(420, t + 0.32);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 900;
      bp.Q.value = 3;
      const og = ctx.createGain();
      og.gain.setValueAtTime(0, t);
      og.gain.linearRampToValueAtTime(0.18, t + 0.05);
      og.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
      o.connect(bp).connect(og).connect(g);
      o.start(t);
      o.stop(t + 0.4);
      this.knock(out, g, t + 0.01, 2600, 0.05, 0.35);
    } else {
      this.knock(out, g, t, 170, 0.16, 0.9);
      this.knock(out, g, t + 0.02, 1400, 0.05, 0.4);
      this.knock(out, g, t + 0.09, 2800, 0.04, 0.3);
    }
  }

  /** A crate took a hit (knock) or broke (crunch and falling boards) at `at`. */
  crate(at: Vec3, broken: boolean, ear: Vec3, right: Vec3): void {
    const v = this.place(at, ear, right, 40);
    const out = this.audio.output('weapons');
    if (!v || !out) return;
    const t = out.ctx.currentTime;
    const g = this.voice(out, v.gain, v.pan);
    if (!broken) {
      this.knock(out, g, t, 620, 0.07, 0.7);
      this.knock(out, g, t, 180, 0.09, 0.5);
      return;
    }
    this.knock(out, g, t, 300, 0.22, 1.0);
    for (let i = 0; i < 6; i++) this.knock(out, g, t + 0.04 + i * 0.05 + Math.random() * 0.04, 500 + Math.random() * 1400, 0.05, 0.45 - i * 0.05);
  }

  // ------------------------------------------------------------------------------------------------ internals

  private connect(): { ctx: AudioContext; bus: AudioNode; noise: AudioBuffer } | null {
    if (this.ctxOut) return this.ctxOut;
    const out = this.audio.output('environment');
    if (!out) return null;
    this.ctxOut = out;
    return out;
  }

  /** Volume and pan of a point source (null when out of earshot). */
  private place(at: Vec3, ear: Vec3, right: Vec3, reach: number): { gain: number; pan: number } | null {
    const dx = at.x - ear.x, dy = at.y - ear.y, dz = at.z - ear.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > reach) return null;
    const pan = d > 0.1 ? (dx * right.x + dy * right.y + dz * right.z) / d : 0;
    return { gain: (1 - d / reach) ** 1.4, pan: Math.max(-0.85, Math.min(0.85, pan)) };
  }

  private voice(out: { ctx: AudioContext; bus: AudioNode }, gain: number, pan: number): GainNode {
    const g = out.ctx.createGain();
    g.gain.value = gain;
    const p = out.ctx.createStereoPanner();
    p.pan.value = pan;
    g.connect(p).connect(out.bus);
    return g;
  }

  /** A filtered noise knock (wood, latch, boards). */
  private knock(out: { ctx: AudioContext; noise: AudioBuffer }, dest: AudioNode, t: number, freq: number, dur: number, gain: number): void {
    const { ctx } = out;
    const src = ctx.createBufferSource();
    src.buffer = out.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = 2.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(bp).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  /** A looping bed (built on first use). */
  private bed(kind: Bed): BedNodes {
    const have = this.beds[kind];
    if (have) return have;
    const { ctx, bus, noise } = this.ctxOut!;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(bus);
    const loop = () => {
      const s = ctx.createBufferSource();
      s.buffer = noise;
      s.loop = true;
      s.loopStart = Math.random() * 0.3;
      s.playbackRate.value = 0.93 + Math.random() * 0.14;
      s.start();
      return s;
    };
    const lfo = (hz: number, depth: number, target: AudioParam) => {
      const o = ctx.createOscillator();
      o.frequency.value = hz;
      const d = ctx.createGain();
      d.gain.value = depth;
      o.connect(d).connect(target);
      o.start();
    };
    if (kind === 'murmur') {
      // A neighbourhood far away: low rumble with a slow swell.
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 340;
      const g = ctx.createGain();
      g.gain.value = 0.8;
      lfo(0.07, 0.25, g.gain);
      loop().connect(lp).connect(g).connect(gain);
    } else if (kind === 'water') {
      // Running water: a broad band with a wandering gurgle.
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1100;
      bp.Q.value = 0.6;
      lfo(0.9, 320, bp.frequency);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 260;
      loop().connect(hp).connect(bp).connect(gain);
    } else if (kind === 'insects') {
      // Cicadas: a narrow high band pulsing fast.
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 5200;
      bp.Q.value = 9;
      const g = ctx.createGain();
      g.gain.value = 0.55;
      lfo(28, 0.45, g.gain);
      const swell = ctx.createGain();
      swell.gain.value = 1.4;
      lfo(0.05, 0.9, swell.gain);
      loop().connect(bp).connect(g).connect(swell).connect(gain);
    } else if (kind === 'leaves') {
      // Leaves in the wind: airy noise in slow gusts.
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1600;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 6500;
      const g = ctx.createGain();
      g.gain.value = 0.35;
      lfo(0.13, 0.3, g.gain);
      loop().connect(hp).connect(lp).connect(g).connect(gain);
    } else {
      // Crystals: two soft high tones beating slowly.
      for (const [f, a] of [[1318.5, 0.05], [1975.5, 0.035], [1320.8, 0.04]] as const) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.value = a;
        lfo(0.11 + f / 20000, a * 0.8, g.gain);
        o.connect(g).connect(gain);
        o.start();
      }
    }
    const b = { gain, level: 0 };
    this.beds[kind] = b;
    return b;
  }

  /** One call, panned at random (the birds are around, not at a point). */
  private call(kind: Call, level: number, pan: number): void {
    const out = this.ctxOut;
    if (!out) return;
    const { ctx } = out;
    const t = ctx.currentTime + 0.02;
    const g = this.voice(out, 0.5 * level, pan);
    const tone = (at: number, f0: number, f1: number, dur: number, amp: number, type: OscillatorType = 'sine', vib = 0) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, at);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), at + dur);
      if (vib) {
        const l = ctx.createOscillator();
        l.frequency.value = 7;
        const d = ctx.createGain();
        d.gain.value = vib;
        l.connect(d).connect(o.frequency);
        l.start(at);
        l.stop(at + dur + 0.05);
      }
      const e = ctx.createGain();
      e.gain.setValueAtTime(0, at);
      e.gain.linearRampToValueAtTime(amp, at + Math.min(0.03, dur * 0.3));
      e.gain.exponentialRampToValueAtTime(0.0008, at + dur);
      o.connect(e).connect(g);
      o.start(at);
      o.stop(at + dur + 0.05);
    };
    switch (kind) {
      case 'sabia': {
        // A short melodic phrase of clear whistles.
        let at = t;
        const n = 3 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) {
          const f = 1700 + Math.random() * 1500;
          const d = 0.1 + Math.random() * 0.14;
          tone(at, f, f * (0.85 + Math.random() * 0.35), d, 0.05);
          at += d + 0.05 + Math.random() * 0.08;
        }
        break;
      }
      case 'bemtevi':
        tone(t, 2300, 2600, 0.11, 0.05);
        tone(t + 0.16, 3000, 2800, 0.09, 0.05);
        tone(t + 0.3, 2700, 2200, 0.2, 0.055);
        break;
      case 'pombo':
        for (let i = 0; i < 3; i++) tone(t + i * 0.55, 420, 360, 0.42, 0.05, 'sine', 18);
        break;
      case 'sino': {
        // The chapel bell, far away: three strokes of inharmonic partials.
        for (let k = 0; k < 3; k++) {
          for (const [m, a] of [[1, 0.05], [2.0, 0.025], [2.4, 0.02], [3.0, 0.015], [4.2, 0.008]] as const) tone(t + k * 1.6, 392 * m, 392 * m * 0.998, 3.2 / Math.sqrt(m), a);
        }
        break;
      }
      case 'garca':
        tone(t, 760, 520, 0.26, 0.035, 'sawtooth');
        break;
      case 'gaviao':
        tone(t, 2500, 1450, 1.0, 0.04, 'sine', 40);
        break;
      case 'grilo':
        for (let i = 0; i < 4; i++) tone(t + i * 0.07, 4600, 4500, 0.035, 0.025, 'triangle');
        break;
      case 'bicicleta':
        for (const at of [t, t + 0.18]) {
          tone(at, 2100, 2080, 0.5, 0.025);
          tone(at, 3420, 3400, 0.35, 0.015);
        }
        break;
    }
  }
}

function dirOf(lat: number, lon: number): Vec3 {
  const la = lat * DEG;
  const lo = lon * DEG;
  return { x: Math.cos(la) * Math.sin(lo), y: Math.sin(la), z: Math.cos(la) * Math.cos(lo) };
}
