/**
 * graao body: the sculpted torso with arms, the legs and the feet (three Tripo sculpts) turned into the data the
 * character code builds on (apps/client/src/character/build/body-data.json).
 *
 * 1. `--src <dir>`: reads the sculpts (`tronco e braços.glb`, `pernas.glb`, `pés.glb`, ≈ 2 M triangles each,
 *    textured), straightens the torso's pose (its upper half is twisted ≈ 8° and the left arm swept ≈ 28° back and
 *    lowered ≈ 7°), mirrors each sculpt's left side onto its right, decimates them to the character budget and stores
 *    the bare geometry in assets/characters/body-base.glb, in the sculpts' own units (Tripo normalizes each one).
 * 2. Fits body-base.glb onto each body type, in GAME space (meters, +Y up, facing +Z, the character's left on +X):
 *    - maps every limb along its bones (shoulder → elbow → wrist → fingertips, hip → knee → ankle, heel → toes) and
 *      the trunk along the spine, so the sculpt's joints land on the rig's;
 *    - scales each cross-section into the procedural body the garments are built on (the torso, arm and leg rings of
 *      anatomy.ts and the foot stations): every top, bottom and shoe still fits over it. The sculpt's own surface
 *      (muscles, knees, knuckles, toes) is kept as the detail over that envelope.
 * 3. Writes body-data.json: positions per body type, triangles, the body region of each vertex and how far each vertex
 *    blends between two skinning bone sets (trunk ↔ arm, trunk ↔ leg, leg ↔ foot); see character/parts/body.ts.
 *
 *   pnpm tsx tools/character/build-body.ts [--src <dir>] [--preview <dir>]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import { MeshoptSimplifier as S } from 'meshoptimizer';
import { SLIM, STURDY, type RigProportions } from '../../apps/client/src/character/rig/GRARig';
import { ARM_Z, footAt, makeBodyShape, ringAt } from '../../apps/client/src/character/build/anatomy';
import { REGION_IDS, smoothRings, type RingSpec } from '../../apps/client/src/character/build/PartBuilder';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BASE = join(ROOT, 'assets/characters/body-base.glb');

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

interface Mesh {
  pos: Float32Array;
  index: Uint32Array;
}

/** Triangle budget per sculpt (the character budget is 12 k with the head and clothes). */
const TARGET = { torso: 3600, legs: 2000, feet: 1600 };
const SOURCES = { torso: 'tronco e braços.glb', legs: 'pernas.glb', feet: 'pés.glb' };

// ------------------------------------------------------------------------------------------------ glTF in/out

/** Positions and triangles of every primitive in a .glb (no node transforms: neither Tripo nor body-base has any). */
function readGlb(path: string): Map<string, Mesh> {
  const data = readFileSync(path);
  const jsonLen = data.readUInt32LE(12);
  const js = JSON.parse(data.subarray(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen + 8;
  const accessor = (i: number): Float32Array | Uint32Array => {
    const a = js.accessors[i];
    const bv = js.bufferViews[a.bufferView];
    const start = binStart + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const n = a.count * ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 } as Record<string, number>)[a.type]!;
    const bytes = data.subarray(start, start + n * ({ 5126: 4, 5125: 4, 5123: 2, 5121: 1 } as Record<number, number>)[a.componentType]!);
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    if (a.componentType === 5126) return new Float32Array(buf);
    if (a.componentType === 5125) return new Uint32Array(buf);
    if (a.componentType === 5123) return Uint32Array.from(new Uint16Array(buf));
    return Uint32Array.from(new Uint8Array(buf));
  };
  const out = new Map<string, Mesh>();
  js.meshes.forEach((m: { name?: string; primitives: { attributes: { POSITION: number }; indices: number }[] }, i: number) => {
    const p = m.primitives[0]!;
    out.set(m.name ?? `mesh${i}`, { pos: accessor(p.attributes.POSITION) as Float32Array, index: accessor(p.indices) as Uint32Array });
  });
  return out;
}

async function writeBase(path: string, meshes: Record<string, Mesh>): Promise<void> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene('body');
  for (const [name, m] of Object.entries(meshes)) {
    const prim = doc
      .createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(Float32Array.from(m.pos)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(Uint16Array.from(m.index)).setBuffer(buffer));
    scene.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)));
  }
  await new NodeIO().write(path, doc);
}

/** Drops vertices no triangle uses (renumbering the rest). */
function compact(pos: Float32Array, index: Uint32Array): Mesh {
  const idx = Uint32Array.from(index);
  const [remap, count] = S.compactMesh(idx);
  const out = new Float32Array(count * 3);
  for (let v = 0; v < remap.length; v++) if (remap[v] !== 0xffffffff) out.set(pos.subarray(v * 3, v * 3 + 3), remap[v]! * 3);
  return { pos: out, index: idx };
}

/** Simplifies a welded, compact mesh to `tris` triangles (unused vertices stop the simplifier far above it). */
function decimate(m: Mesh, tris: number): Mesh {
  const [simplified] = S.simplify(m.index, m.pos, 3, tris * 3, 0.05, ['Prune']);
  return compact(m.pos, simplified);
}

// ------------------------------------------------------------------------------------------------ math helpers

export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Piecewise-linear table lookup (clamped at both ends). */
export function table(t: [number, number][], x: number): number {
  if (x <= t[0]![0]) return t[0]![1];
  for (let i = 0; i < t.length - 1; i++) {
    const [x0, y0] = t[i]!;
    const [x1, y1] = t[i + 1]!;
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return t[t.length - 1]![1];
}

/** Rotation about +Y by `a` radians in the convention the measurements use: x' = x cos + z sin, z' = −x sin + z cos. */
function yaw(x: number, z: number, a: number): [number, number] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [x * c + z * s, -x * s + z * c];
}

/** Points where the mesh crosses the plane `axis = value` (one per crossing edge). */
function slice(pos: Float32Array, index: Uint32Array, axis: 0 | 1 | 2, value: number, keep?: (p: number[]) => boolean): number[][] {
  const out: number[][] = [];
  for (let t = 0; t < index.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = index[t + e]! * 3;
      const b = index[t + ((e + 1) % 3)]! * 3;
      const da = pos[a + axis]! - value;
      const db = pos[b + axis]! - value;
      if (da * db >= 0) continue;
      const k = da / (da - db);
      const p = [0, 1, 2].map((i) => pos[a + i]! + (pos[b + i]! - pos[a + i]!) * k);
      if (!keep || keep(p)) out.push(p);
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ pose

/** Upper torso twist (sculpt units): the yaw in degrees that makes each height band mirror-symmetric. */
const TWIST: [number, number][] = [
  [0.04, -1],
  [0.12, -2],
  [0.19, -4.5],
  [0.25, -8],
  [0.32, -8.5],
];
/** The sculpt's shoulder joints sit this far out (sculpt units, after untwisting). */
const PIVOT_X = 0.115;

/** Untwists the torso and swings its left arm about the shoulder into a level T-pose (sculpt units, in place). */
function straightenTorso(m: Mesh): void {
  const P = m.pos;
  for (let v = 0; v < P.length; v += 3) {
    const [x, z] = yaw(P[v]!, P[v + 2]!, (table(TWIST, P[v + 1]!) * Math.PI) / 180);
    P[v] = x;
    P[v + 2] = z;
  }
  // Arm axis: principal direction of the upper arm and forearm.
  const pts: number[][] = [];
  for (let v = 0; v < P.length; v += 3) if (P[v]! > 0.17 && P[v]! < 0.42) pts.push([P[v]!, P[v + 1]!, P[v + 2]!]);
  const { mean, dir } = principal(pts);
  const t = (PIVOT_X - mean[0]!) / dir[0]!;
  const pivot = mean.map((c, i) => c + dir[i]! * t);
  const a = Math.atan(dir[2]! / dir[0]!);
  const [dx] = yaw(dir[0]!, dir[2]!, a);
  const b = Math.atan(-dir[1]! / dx);
  console.log(`left arm: pivot ${pivot.map((c) => c.toFixed(4))}, yaw ${((a * 180) / Math.PI).toFixed(1)}°, pitch ${((b * 180) / Math.PI).toFixed(1)}°`);
  for (let v = 0; v < P.length; v += 3) {
    const w = smoothstep(0.05, 0.14, P[v]!);
    if (w <= 0) continue;
    let x = P[v]! - pivot[0]!;
    let y = P[v + 1]! - pivot[1]!;
    let z = P[v + 2]! - pivot[2]!;
    [x, z] = yaw(x, z, a * w);
    const c = Math.cos(b * w);
    const sn = Math.sin(b * w);
    [x, y] = [x * c - y * sn, x * sn + y * c];
    P[v] = pivot[0]! + x;
    P[v + 1] = pivot[1]! + y;
    P[v + 2] = pivot[2]! + z;
  }
}

/**
 * Keeps the character's left side (x >= 0) and mirrors it onto the right: the sculpts are not symmetric (the right
 * shoulder sits ~7 cm further back), and a mirrored body gets mirrored garment fits and skin weights. Triangles
 * crossing x = 0 are cut there; the cut vertices are shared by both halves, so the result stays closed.
 */
function mirrorLeft(m: Mesh): Mesh {
  const P = m.pos;
  const out: number[] = [];
  const kept = new Map<number, number>();
  const cuts = new Map<string, number>();
  const keep = (v: number) => {
    let i = kept.get(v);
    if (i === undefined) {
      i = out.length / 3;
      out.push(P[v * 3]!, P[v * 3 + 1]!, P[v * 3 + 2]!);
      kept.set(v, i);
    }
    return i;
  };
  const cut = (a: number, b: number) => {
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    let i = cuts.get(key);
    if (i === undefined) {
      const k = P[a * 3]! / (P[a * 3]! - P[b * 3]!);
      i = out.length / 3;
      out.push(0, P[a * 3 + 1]! + (P[b * 3 + 1]! - P[a * 3 + 1]!) * k, P[a * 3 + 2]! + (P[b * 3 + 2]! - P[a * 3 + 2]!) * k);
      cuts.set(key, i);
    }
    return i;
  };
  const tris: number[] = [];
  for (let t = 0; t < m.index.length; t += 3) {
    const v = [m.index[t]!, m.index[t + 1]!, m.index[t + 2]!];
    const inside = v.map((i) => P[i * 3]! >= 0);
    const n = inside.filter(Boolean).length;
    if (n === 3) tris.push(keep(v[0]!), keep(v[1]!), keep(v[2]!));
    if (n === 0 || n === 3) continue;
    // Rotate (keeping the winding) so the lone vertex comes first.
    const lone = inside.findIndex((x) => (n === 1 ? x : !x));
    const [a, b, c] = [v[lone]!, v[(lone + 1) % 3]!, v[(lone + 2) % 3]!];
    if (n === 1) tris.push(keep(a), cut(a, b), cut(a, c));
    else {
      const ab = cut(a, b);
      const ca = cut(c, a);
      tris.push(ab, keep(b), keep(c), ab, keep(c), ca);
    }
  }
  const half = out.length / 3;
  const mirror: number[] = [];
  for (let i = 0; i < half; i++) {
    if (out[i * 3] === 0) mirror.push(i);
    else {
      mirror.push(out.length / 3);
      out.push(-out[i * 3]!, out[i * 3 + 1]!, out[i * 3 + 2]!);
    }
  }
  const count = tris.length;
  for (let t = 0; t < count; t += 3) {
    const [a, b, c] = [tris[t]!, tris[t + 1]!, tris[t + 2]!];
    if (mirror[a] === a && mirror[b] === b && mirror[c] === c) continue;
    tris.push(mirror[a]!, mirror[c]!, mirror[b]!);
  }
  return { pos: Float32Array.from(out), index: Uint32Array.from(tris) };
}

/** Welds the sculpt's UV seams: one vertex per position. */
function weld(m: Mesh): Mesh {
  const remap = S.generatePositionRemap(m.pos, 3);
  return compact(m.pos, m.index.map((i) => remap[i]!));
}

/** Mean and principal direction (power iteration on the covariance). */
function principal(pts: number[][]): { mean: number[]; dir: number[] } {
  const mean = [0, 1, 2].map((i) => pts.reduce((s, p) => s + p[i]!, 0) / pts.length);
  const C = [0, 1, 2].map((i) => [0, 1, 2].map((j) => pts.reduce((s, p) => s + (p[i]! - mean[i]!) * (p[j]! - mean[j]!), 0)));
  let d = [1, 0, 0];
  for (let k = 0; k < 64; k++) {
    const n = [0, 1, 2].map((i) => C[i]![0]! * d[0]! + C[i]![1]! * d[1]! + C[i]![2]! * d[2]!);
    const l = Math.hypot(n[0]!, n[1]!, n[2]!);
    d = n.map((c) => c / l);
  }
  return { mean, dir: d };
}

// ------------------------------------------------------------------------------------------------ fit

/** Piecewise-linear map through (sculpt, game) knots, extended linearly past both ends. */
function knots(k: [number, number][]): (x: number) => number {
  return (x) => {
    let i = 0;
    while (i < k.length - 2 && x > k[i + 1]![0]) i++;
    const [x0, y0] = k[i]!;
    const [x1, y1] = k[i + 1]!;
    return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  };
}

const range = (from: number, to: number, step: number) => Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => from + i * step);

/** Extents of the sculpt's cross-section at each station along `axis` (null where the plane misses it). */
function sections(m: Mesh, axis: 0 | 1 | 2, at: number[], keep?: (p: number[]) => boolean): ({ lo: number[]; hi: number[] } | null)[] {
  return at.map((v) => {
    const q = slice(m.pos, m.index, axis, v, keep);
    if (q.length < 3) return null;
    return { lo: [0, 1, 2].map((i) => Math.min(...q.map((p) => p[i]!))), hi: [0, 1, 2].map((i) => Math.max(...q.map((p) => p[i]!))) };
  });
}

/**
 * Smooth curve through per-station values: gaps take the nearest value, `grow` stations of running maximum keep bumps
 * inside it (a muscle stays a bump over the envelope, it does not set the envelope), then `blur` stations of box blur.
 */
function curve(at: number[], values: (number | null)[], grow: number, blur: number): (x: number) => number {
  let v = values.map((x, i) => {
    if (x !== null) return x;
    for (let d = 1; d < values.length; d++) {
      const a = values[i - d];
      const b = values[i + d];
      if (a !== undefined && a !== null) return a;
      if (b !== undefined && b !== null) return b;
    }
    return 0;
  });
  const pass = (r: number, f: (w: number[]) => number) => (v = v.map((_, i) => f(v.slice(Math.max(0, i - r), i + r + 1))));
  if (grow > 0) pass(grow, (w) => Math.max(...w));
  for (let k = 0; k < 2; k++) pass(blur, (w) => w.reduce((s, x) => s + x, 0) / w.length);
  const step = at[1]! - at[0]!;
  return (x) => {
    const f = Math.min(at.length - 1, Math.max(0, (x - at[0]!) / step));
    const i = Math.min(at.length - 2, Math.floor(f));
    return v[i]! + (v[i + 1]! - v[i]!) * (f - i);
  };
}

/** Center and half extent of a section along axis `i` as smooth curves (extents grow over bumps, centers do not). */
function axisCurves(at: number[], secs: ({ lo: number[]; hi: number[] } | null)[], i: number) {
  return {
    c: curve(at, secs.map((s) => (s ? (s.lo[i]! + s.hi[i]!) / 2 : null)), 0, 2),
    h: curve(at, secs.map((s) => (s ? (s.hi[i]! - s.lo[i]!) / 2 : null)), 1, 2),
  };
}

/**
 * Moves an offset (a, b) from a ring's center onto the ring's own superellipse (scaled by `f`), by `w`. Where two
 * sculpts overlap, both are pulled onto the same smooth ring (then one sinks inside the other), so the seam disappears.
 */
function toRing(a: number, b: number, r: RingSpec, f: number, w: number): [number, number] {
  const l = Math.hypot(a, b);
  if (w <= 0 || l < 1e-9) return [a, b];
  const n = r.n ?? 2;
  const R = f / Math.pow(Math.pow(Math.abs(a / l) / r.ra, n) + Math.pow(Math.abs(b / l) / r.rb, n), 1 / n);
  const k = 1 + (R / l - 1) * w;
  return [a * k, b * k];
}

interface Fitted {
  pos: Float32Array;
  region: Uint8Array;
  /** 0–255: how far the vertex follows its limb's bone set instead of the trunk's (the foot's instead of the leg's). */
  blend: Uint8Array;
  /** Bit 0: the thumb (tucked under the palm in the sculpt, it moves with the hand). Bit 1: hidden inside another
   * piece past a seam, so it draws no ink outline (the hull would poke through the piece covering it). */
  flags: Uint8Array;
}

/** Sculpt landmarks (units of body-base.glb, after straightening). */
const TORSO_Y = { waist: 0, shoulder: 0.2527, neckTop: 0.36 };
const ARM_X = { shoulder: PIVOT_X, elbow: 0.285, wrist: 0.44, tip: 0.57 };
const LEG_Y = { ankle: 0, knee: 0.45, hip: 0.86, waist: 0.98, crotch: 0.78 };
const FOOT_Z = { heel: -0.454, toe: 0.489 };
/** The hand keeps the wrist's girth instead of the sculpt's long, slender hand (game hands are short and small). */
const HAND_SCALE = 1.2;
/** The sculpt's thumb: under the palm (below this height) between the wrist and the knuckles. */
const THUMB = { below: 0.2405, from: 0.45, to: 0.545 };

/**
 * Where the pieces overlap (game meters): the torso's bottom sinks into the pelvis below `waist` and the pelvis's top
 * into the torso above it; the sculpted legs end in a cuff at `legBottom`, inside the ankle, which sinks into the shin
 * above `ankle`. Around each seam both pieces lie on the same ring (`toRing`).
 */
const SEAM = { waistBottom: 0.885, waistTop: 0.935, waist: 0.91, legBottom: 0.1, ankle: 0.15 };
/**
 * Cross-section scale of a piece `d` meters past a seam on its covered side: a hair inside the other piece at the seam
 * (both cross there), well inside further on, where the covering piece's own relief would let it show through.
 */
const sunk = (d: number) => 1 - 0.03 * smoothstep(-0.004, 0.004, d) - 0.12 * smoothstep(0.006, 0.025, d);
const FLAG = { thumb: 1, hidden: 2 };
/** Past a seam by more than this, the sunk piece is covered (its ink would poke through the piece over it). */
const HIDDEN = 0;
/** Weight of the seam band around `at` (full within ±`inner`, none past ±`outer`). */
const band = (y: number, at: number, inner: number, outer: number) => smoothstep(outer, inner, Math.abs(y - at));

function fit(base: Map<string, Mesh>, p: RigProportions, sturdy: boolean): Fitted {
  const s = makeBodyShape(p, sturdy);
  const torsoRings = smoothRings(s.torso);
  const armRings = smoothRings(s.arm);
  const legRings = smoothRings(s.leg);
  const torso = base.get('torso')!;
  const legs = base.get('legs')!;
  const feet = base.get('feet')!;
  const n = (torso.pos.length + legs.pos.length + feet.pos.length) / 3;
  const out: Fitted = { pos: new Float32Array(n * 3), region: new Uint8Array(n), blend: new Uint8Array(n), flags: new Uint8Array(n) };
  let o = 0;
  const emit = (q: number[], region: keyof typeof REGION_IDS, blend: number, flags = 0) => {
    out.pos.set(q, o * 3);
    out.region[o] = REGION_IDS[region];
    out.blend[o] = Math.round(Math.min(1, Math.max(0, blend)) * 255);
    out.flags[o] = flags;
    o++;
  };
  const armY = p.shoulderY - 0.003;

  // ---- torso, arms and hands
  {
    const ys = range(0, 0.36, 0.01);
    const trunk = sections(torso, 1, ys, (q) => q[1]! < 0.15 || Math.abs(q[0]!) < 0.1);
    const ex = curve(ys, trunk.map((t) => (t ? Math.max(-t.lo[0]!, t.hi[0]!) : null)), 1, 2);
    const tz = axisCurves(ys, trunk, 2);
    const yT = knots([
      [TORSO_Y.waist, SEAM.waistBottom],
      [TORSO_Y.shoulder, p.shoulderY],
      [TORSO_Y.neckTop, p.shoulderY + 0.145],
    ]);
    const xs = range(0.15, ARM_X.wrist, 0.01);
    const arm = sections(torso, 0, xs, (q) => q[1]! > 0.18);
    const ay = axisCurves(xs, arm, 1);
    const az = axisCurves(xs, arm, 2);
    // The sculpt's hand points ≈ 9° back from the forearm: straightened by shearing it onto the arm's line.
    const tips = sections(torso, 0, [ARM_X.tip - 0.02])[0]!;
    const sweep = ((tips.lo[2]! + tips.hi[2]!) / 2 - az.c(ARM_X.wrist)) / (ARM_X.tip - 0.02 - ARM_X.wrist);
    const xA = knots([
      [ARM_X.shoulder, p.shoulderX],
      [ARM_X.elbow, p.elbowX],
      [ARM_X.wrist, p.wristX],
      [ARM_X.tip, p.wristX + p.handLen],
    ]);
    const P = torso.pos;
    for (let v = 0; v < P.length; v += 3) {
      const [x, y, z] = [P[v]!, P[v + 1]!, P[v + 2]!];
      const side = x < 0 ? -1 : 1;
      const ax = Math.abs(x);
      // Trunk: along the spine, each cross-section scaled into the torso ring at its height.
      const yr = yT(y);
      const r = ringAt(torsoRings, 1, yr);
      // On the ring at the waist (sinking under the pelvis below it) and inside the head's neck at the top.
      const neck = 1 - 0.15 * smoothstep(1.27, 1.31, yr);
      const [tx, tz2] = toRing(x * (r.ra / ex(y)) * neck, (z - tz.c(y)) * (r.rb / tz.h(y)) * neck, r, 1, band(yr, SEAM.waist, 0.012, 0.03));
      const k = sunk(SEAM.waist - yr);
      const T = [tx * k, yr, r.p[2] + tz2 * k];
      // Arm: along the bones, each cross-section scaled into the arm ring; the hand keeps the wrist's scale.
      const xr = xA(ax);
      const ar = ringAt(armRings, 0, xr);
      const A = [xr, armY + (y - ay.c(ax)) * (ar.ra / ay.h(ax)), ARM_Z + (z - az.c(ax)) * (ar.rb / az.h(ax))];
      const H = [xr, armY + (y - ay.c(ARM_X.wrist)) * HAND_SCALE, ARM_Z + (z - az.c(ARM_X.wrist) - (ax - ARM_X.wrist) * sweep) * HAND_SCALE];
      const wh = smoothstep(ARM_X.wrist - 0.015, ARM_X.wrist + 0.015, ax);
      const L = A.map((c, i) => c + (H[i]! - c) * wh);
      const w = smoothstep(0.075, 0.15, ax) * smoothstep(0.14, 0.2, y);
      const q = T.map((c, i) => c + (L[i]! - c) * w);
      q[0] = Math.abs(q[0]!) * side;
      const qx = Math.abs(q[0]!);
      const region = w < 0.5 ? (q[1]! >= 0.93 ? 'torso' : 'hips') : qx < p.elbowX ? 'upper_arms' : qx < p.wristX - 0.003 ? 'forearms' : 'hands';
      const thumb = ax > THUMB.from && ax < THUMB.to && y < THUMB.below ? FLAG.thumb : 0;
      const hidden = w < 0.5 && (q[1]! < SEAM.waist - HIDDEN || q[1]! > 1.3) ? FLAG.hidden : 0;
      emit(q, region, w, thumb | hidden);
    }
  }

  // ---- pelvis and legs
  {
    const ys = range(0, LEG_Y.crotch + 0.02, 0.01);
    const leg = sections(legs, 1, ys, (q) => q[0]! > 0);
    const lx = axisCurves(ys, leg, 0);
    const lz = axisCurves(ys, leg, 2);
    const ps = range(0.7, 0.98, 0.01);
    const pelvis = sections(legs, 1, ps);
    const pex = curve(ps, pelvis.map((t) => (t ? Math.max(-t.lo[0]!, t.hi[0]!) : null)), 1, 2);
    const pz = axisCurves(ps, pelvis, 2);
    const yL = knots([
      [LEG_Y.ankle, SEAM.legBottom],
      [LEG_Y.knee, p.kneeY],
      [LEG_Y.hip, p.hipsY - 0.06],
      [LEG_Y.waist, SEAM.waistTop],
    ]);
    const P = legs.pos;
    for (let v = 0; v < P.length; v += 3) {
      const [x, y, z] = [P[v]!, P[v + 1]!, P[v + 2]!];
      const side = x < 0 ? -1 : 1;
      const ax = Math.abs(x);
      const yr = yL(y);
      const tr = ringAt(torsoRings, 1, yr);
      const lr = ringAt(legRings, 1, yr);
      // Pelvis: as wide as the old torso tube with the thigh tubes poking out of it; on the torso ring at the waist,
      // sinking under the torso above it.
      const W = Math.max(tr.ra, yr < 0.87 ? p.legSocketX + lr.ra : 0);
      const D = Math.max(tr.rb, lr.rb);
      const [px, pz2] = toRing(ax * (W / pex(y)), (z - pz.c(y)) * (D / pz.h(y)), tr, 1, band(yr, SEAM.waist, 0.012, 0.03));
      const kp = sunk(yr - SEAM.waist);
      const Pv = [px * kp, yr, tr.p[2] + pz2 * kp];
      // Legs: the cuff the sculpt ends in and the shin above it lie on the leg ring, inside the ankle below the seam.
      const [lxo, lzo] = toRing((ax - lx.c(y)) * (lr.ra / lx.h(y)), (z - lz.c(y)) * (lr.rb / lz.h(y)), lr, 1, smoothstep(SEAM.ankle + 0.04, SEAM.ankle + 0.015, yr));
      const kl = sunk(SEAM.ankle - yr);
      const Lv = [p.legSocketX + lxo * kl, yr, lr.p[2] + lzo * kl];
      const w = smoothstep(LEG_Y.crotch + 0.06, LEG_Y.crotch - 0.01, y);
      const q = Pv.map((c, i) => c + (Lv[i]! - c) * w);
      q[0] = q[0]! * side;
      const region = w < 0.5 ? (yr >= 0.93 ? 'torso' : 'hips') : yr > p.kneeY - 0.01 ? 'upper_legs' : 'lower_legs';
      const hidden = (w < 0.5 && yr > SEAM.waist + HIDDEN) || (w >= 0.5 && yr < SEAM.ankle - HIDDEN);
      emit(q, region, w, hidden ? FLAG.hidden : 0);
    }
  }

  // ---- feet
  {
    const zs = range(-0.45, 0.48, 0.01);
    const foot = sections(feet, 2, zs, (q) => q[0]! > 0 && q[1]! < 0.3);
    const fx = axisCurves(zs, foot, 0);
    const zF = knots([
      [FOOT_Z.heel, -0.07],
      [FOOT_Z.toe, 0.168],
    ]);
    // Height of the old bare foot over the sculpt's: before the instep the slices cut the ankle, so it stays constant.
    const ytop = curve(zs, foot.map((t) => (t ? t.hi[1]! : null)), 1, 2);
    const k = curve(zs, zs.map((z) => {
      const f = footAt(zF(Math.max(z, 0.04)));
      return (f.y + f.h) / ytop(Math.max(z, 0.04));
    }), 0, 2);
    const K = k(0.04);
    const ys = range(0.2, 0.86, 0.01);
    const stub = sections(feet, 1, ys, (q) => q[0]! > 0);
    const sx = axisCurves(ys, stub, 0);
    const sz = axisCurves(ys, stub, 2);
    const P = feet.pos;
    for (let v = 0; v < P.length; v += 3) {
      const [x, y, z] = [P[v]!, P[v + 1]!, P[v + 2]!];
      const side = x < 0 ? -1 : 1;
      const ax = Math.abs(x);
      const zr = zF(z);
      const f = footAt(zr);
      const F = [p.legSocketX + (ax - fx.c(z)) * (f.w / fx.h(z)), y * k(z), zr];
      // Ankle: a shin column like the leg's, on the leg ring over the legs' cuff, sinking under the shin above the seam.
      const yr = y * K;
      const lr = ringAt(legRings, 1, yr);
      const [so, sz2] = toRing((ax - sx.c(y)) * (lr.ra / sx.h(y)), (z - sz.c(y)) * (lr.rb / sz.h(y)), lr, 1, smoothstep(SEAM.legBottom - 0.01, SEAM.legBottom + 0.015, yr));
      const ks = sunk(yr - SEAM.ankle);
      const S = [p.legSocketX + so * ks, yr, lr.p[2] + sz2 * ks];
      const w = smoothstep(0.17, 0.3, y);
      const q = F.map((c, i) => c + (S[i]! - c) * w);
      q[0] = q[0]! * side;
      emit(q, q[1]! < 0.09 ? 'feet' : 'lower_legs', 1 - w, q[1]! > SEAM.ankle + HIDDEN ? FLAG.hidden : 0);
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ preview

function writeObj(path: string, meshes: Mesh[]): void {
  let s = '';
  let base = 1;
  for (const m of meshes) {
    for (let v = 0; v < m.pos.length; v += 3) s += `v ${m.pos[v]!.toFixed(5)} ${m.pos[v + 1]!.toFixed(5)} ${m.pos[v + 2]!.toFixed(5)}\n`;
    for (let t = 0; t < m.index.length; t += 3) s += `f ${m.index[t]! + base} ${m.index[t + 1]! + base} ${m.index[t + 2]! + base}\n`;
    base += m.pos.length / 3;
  }
  writeFileSync(path, s);
}

function profile(m: Mesh, axis: 0 | 1 | 2, from: number, to: number, step: number, keep?: (p: number[]) => boolean): void {
  for (let v = from; v <= to + 1e-9; v += step) {
    const q = slice(m.pos, m.index, axis, v, keep);
    if (q.length < 3) continue;
    const ext = [0, 1, 2].map((i) => [Math.min(...q.map((p) => p[i]!)), Math.max(...q.map((p) => p[i]!))]);
    console.log(`${'xyz'[axis]}=${v.toFixed(3)} ` + ext.map(([a, b], i) => `${'xyz'[i]}[${a!.toFixed(4)},${b!.toFixed(4)}]`).join(' '));
  }
}

// ------------------------------------------------------------------------------------------------ main

await S.ready;
const src = arg('--src');
if (src) {
  const out: Record<string, Mesh> = {};
  for (const [key, file] of Object.entries(SOURCES) as [keyof typeof SOURCES, string][]) {
    const m = weld([...readGlb(join(src, file)).values()][0]!);
    if (key === 'torso') straightenTorso(m);
    out[key] = decimate(weld(mirrorLeft(m)), TARGET[key]);
    console.log(`${file}: ${m.index.length / 3} → ${out[key]!.index.length / 3} triangles, ${out[key]!.pos.length / 3} vertices`);
  }
  await writeBase(BASE, out);
  console.log('wrote', BASE);
}

const base = readGlb(BASE);
const order = ['torso', 'legs', 'feet'];
const index: number[] = [];
const parts: Record<string, [number, number]> = {};
let offset = 0;
for (const k of order) {
  const m = base.get(k)!;
  for (const i of m.index) index.push(i + offset);
  parts[k] = [offset, m.pos.length / 3];
  offset += m.pos.length / 3;
}
const fits = { slim: fit(base, SLIM, false), sturdy: fit(base, STURDY, true) };
const QUANT = 20000;
const b64 = (a: ArrayBufferView) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64');
const quant = (f: Fitted) => b64(Int16Array.from(f.pos, (v) => Math.round(v * QUANT)));
const data = {
  source: 'tools/character/build-body.ts from assets/characters/body-base.glb',
  quant: QUANT,
  parts,
  slim: quant(fits.slim),
  sturdy: quant(fits.sturdy),
  index: b64(Uint16Array.from(index)),
  region: b64(fits.slim.region),
  blend: b64(fits.slim.blend),
  flags: b64(fits.slim.flags),
};
const OUT = join(ROOT, 'apps/client/src/character/build/body-data.json');
writeFileSync(OUT, JSON.stringify(data));
console.log(`wrote ${OUT}: ${offset} vertices, ${index.length / 3} triangles`);

const preview = arg('--preview');
if (preview) {
  mkdirSync(preview, { recursive: true });
  for (const [k, m] of base) writeObj(join(preview, `base-${k}.obj`), [m]);
  for (const [k, f] of Object.entries(fits)) {
    const head = makeBodyShape(k === 'slim' ? SLIM : STURDY, k === 'sturdy').head.mesh;
    writeObj(join(preview, `fit-${k}.obj`), [{ pos: f.pos, index: Uint32Array.from(index) }, { pos: head.positions, index: Uint32Array.from(head.index) }]);
  }
}
if (args.includes('--measure')) {
  const torso = base.get('torso')!;
  console.log('--- left arm along x (above the armpit)');
  profile(torso, 0, 0.06, 0.58, 0.01, (p) => p[1]! > 0.12);
  console.log('--- trunk along y (inside the armpits)');
  profile(torso, 1, 0.005, 0.36, 0.01, (p) => Math.abs(p[0]!) < 0.12);
  console.log('--- legs along y (left leg)');
  profile(base.get('legs')!, 1, 0.005, 0.98, 0.02, (p) => p[0]! > 0);
  console.log('--- left foot along z');
  profile(base.get('feet')!, 2, -0.46, 0.49, 0.02, (p) => p[0]! > 0 && p[1]! < 0.3);
  console.log('--- left foot along y');
  profile(base.get('feet')!, 1, 0.005, 0.87, 0.03, (p) => p[0]! > 0);
}
