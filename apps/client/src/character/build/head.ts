/**
 * The head: a sculpted mesh (tools/blender/build_head.py → head-data.json) and the surfaces everything on the head is
 * laid over:
 *   - `surface(dir, scale)`: the skull with the ears and the nose filled in, as a radial table around the center
 *     (hair shells, hats, beards and side accessories hug it);
 *   - `frontPoint(u, v)`: the real face seen from the front (nose, lips and lids included), for the face decals;
 *   - `lm`: where the sculpt carves the eyes, brows, nose, mouth and ears.
 * Everything is in the rig frame (meters, +Y up, facing +Z, the character's left on +X).
 */
import * as THREE from 'three';
import DATA from './head-data.json';
import type { V3 } from './PartBuilder';

type UV = [number, number];

export interface HeadLandmarks {
  /** Face coordinates (u across, + = the character's left; v up), meters from the head center; left side only. */
  eye: UV;
  /** Half width and half height of the eye opening. */
  eyeHalf: UV;
  eyeInner: UV;
  eyeOuter: UV;
  iris: UV;
  irisHalf: UV;
  browInner: UV;
  browOuter: UV;
  browPeak: UV;
  noseTip: UV;
  mouth: UV;
  mouthHalf: number;
  chin: UV;
  /** Points on the left ear (mirror x for the right one), meters from the head center. */
  earLobe: V3;
  earTop: V3;
  earBack: V3;
  /** How far the ears reach out to the side (x). */
  earOut: number;
}

export interface HeadMesh {
  /** Rig-space positions, smooth normals and triangles of the sculpted head (with its neck stub). */
  positions: Float32Array;
  normals: Float32Array;
  index: Uint16Array;
  /** Per vertex: bit 0 = neck stub, bit 1 = ear. */
  flags: Uint8Array;
}

export const HEAD_FLAG = { NECK: 1, EAR: 2 } as const;

export interface HeadShape {
  center: V3;
  /** Half extents of the skull: across (at the center height), up to the crown, forward (at the center height). */
  a: number;
  b: number;
  c: number;
  /** Skull surface point in direction `dir` from the center, pushed out by `scale` (1 = on the skull). */
  surface(dir: THREE.Vector3, scale?: number): V3;
  /** How far from the center the ears reach in direction `dir` (spread and softened; 0 away from the ears). */
  earReach(dir: THREE.Vector3): number;
  /** Point on the face seen from the front at face coordinates (u, v), lifted `lift` along its normal; null off it. */
  frontPoint(u: number, v: number, lift?: number): { p: V3; n: V3 } | null;
  lm: HeadLandmarks;
  mesh: HeadMesh;
}

function bytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

interface Table {
  r: Float32Array;
  nt: number;
  np: number;
}

function table(t: { nt: number; np: number; quant: number; r: string }): Table {
  const b = bytes(t.r);
  return { r: Float32Array.from(new Uint16Array(b.buffer, b.byteOffset, b.byteLength / 2), (v) => v / t.quant), nt: t.nt, np: t.np };
}

interface Decoded {
  pos: Float32Array;
  normals: Float32Array;
  index: Uint16Array;
  flags: Uint8Array;
  skull: Table;
  ears: Table;
  /** Front-facing triangles binned by their x/y footprint, for rays cast along -Z. */
  grid: { x0: number; y0: number; cell: number; nx: number; ny: number; cells: Uint16Array[] };
}

let decoded: Decoded | null = null;

function decode(): Decoded {
  if (decoded) return decoded;
  const q = DATA.quant;
  const pi = bytes(DATA.positions);
  const raw = new Int16Array(pi.buffer, pi.byteOffset, pi.byteLength / 2);
  const pos = Float32Array.from(raw, (v) => v / q);
  const ii = bytes(DATA.index);
  const index = new Uint16Array(ii.buffer.slice(ii.byteOffset, ii.byteOffset + ii.byteLength));
  const flags = bytes(DATA.flags);

  // Outward winding (signed volume), then area-weighted smooth normals.
  let vol = 0;
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t]! * 3, b = index[t + 1]! * 3, c = index[t + 2]! * 3;
    vol += pos[a]! * (pos[b + 1]! * pos[c + 2]! - pos[b + 2]! * pos[c + 1]!) - pos[a + 1]! * (pos[b]! * pos[c + 2]! - pos[b + 2]! * pos[c]!) + pos[a + 2]! * (pos[b]! * pos[c + 1]! - pos[b + 1]! * pos[c]!);
  }
  if (vol < 0) {
    for (let t = 0; t < index.length; t += 3) {
      const b = index[t + 1]!;
      index[t + 1] = index[t + 2]!;
      index[t + 2] = b;
    }
  }
  const normals = new Float32Array(pos.length);
  const faceN: number[] = [];
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t]! * 3, b = index[t + 1]! * 3, c = index[t + 2]! * 3;
    const ex = pos[b]! - pos[a]!, ey = pos[b + 1]! - pos[a + 1]!, ez = pos[b + 2]! - pos[a + 2]!;
    const fx = pos[c]! - pos[a]!, fy = pos[c + 1]! - pos[a + 1]!, fz = pos[c + 2]! - pos[a + 2]!;
    const nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx;
    faceN.push(nz);
    for (const v of [a, b, c]) {
      normals[v]! += nx;
      normals[v + 1]! += ny;
      normals[v + 2]! += nz;
    }
  }
  for (let v = 0; v < normals.length; v += 3) {
    const l = Math.hypot(normals[v]!, normals[v + 1]!, normals[v + 2]!) || 1;
    normals[v]! /= l;
    normals[v + 1]! /= l;
    normals[v + 2]! /= l;
  }

  const cell = 0.006;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let v = 0; v < pos.length; v += 3) {
    x0 = Math.min(x0, pos[v]!);
    x1 = Math.max(x1, pos[v]!);
    y0 = Math.min(y0, pos[v + 1]!);
    y1 = Math.max(y1, pos[v + 1]!);
  }
  const nx = Math.ceil((x1 - x0) / cell) + 1;
  const ny = Math.ceil((y1 - y0) / cell) + 1;
  const lists: number[][] = Array.from({ length: nx * ny }, () => []);
  for (let t = 0, f = 0; t < index.length; t += 3, f++) {
    if (faceN[f]! <= 0) continue;
    const xs = [index[t]!, index[t + 1]!, index[t + 2]!].map((v) => pos[v * 3]!);
    const ys = [index[t]!, index[t + 1]!, index[t + 2]!].map((v) => pos[v * 3 + 1]!);
    const i0 = Math.floor((Math.min(...xs) - x0) / cell), i1 = Math.floor((Math.max(...xs) - x0) / cell);
    const j0 = Math.floor((Math.min(...ys) - y0) / cell), j1 = Math.floor((Math.max(...ys) - y0) / cell);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) lists[j * nx + i]!.push(t);
  }
  const cells = lists.map((l) => Uint16Array.from(l.map((t) => t / 3)));
  decoded = { pos, normals, index, flags, skull: table(DATA.skull), ears: table(DATA.ears), grid: { x0, y0, cell, nx, ny, cells } };
  return decoded;
}

/** Radius in direction (θ azimuth, 0 = face; φ polar, 0 = crown): bilinear in a radial table. */
function radial(t: Table, theta: number, phi: number): number {
  const { nt, np, r } = t;
  const x = ((theta + Math.PI) / (Math.PI * 2)) * nt;
  const y = Math.min(np, Math.max(0, (phi / Math.PI) * np));
  const i0 = Math.floor(x);
  const tx = x - i0;
  const j0 = Math.min(np - 1, Math.floor(y));
  const ty = y - j0;
  const at = (j: number, i: number) => r[j * nt + (((i % nt) + nt) % nt)]!;
  const a = at(j0, i0) * (1 - tx) + at(j0, i0 + 1) * tx;
  const b = at(j0 + 1, i0) * (1 - tx) + at(j0 + 1, i0 + 1) * tx;
  return a * (1 - ty) + b * ty;
}

/** Front-most hit of the ray along -Z through head-local (x, y): position z and interpolated normal. */
function castFront(d: Decoded, x: number, y: number): { z: number; n: V3 } | null {
  const g = d.grid;
  const i = Math.floor((x - g.x0) / g.cell);
  const j = Math.floor((y - g.y0) / g.cell);
  if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) return null;
  const P = d.pos;
  const N = d.normals;
  let best: { z: number; n: V3 } | null = null;
  for (const f of g.cells[j * g.nx + i]!) {
    const a = d.index[f * 3]! * 3, b = d.index[f * 3 + 1]! * 3, c = d.index[f * 3 + 2]! * 3;
    const ax = P[a]!, ay = P[a + 1]!, bx = P[b]!, by = P[b + 1]!, cx = P[c]!, cy = P[c + 1]!;
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(det) < 1e-12) continue;
    const w0 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / det;
    const w1 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / det;
    const w2 = 1 - w0 - w1;
    if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
    const z = w0 * P[a + 2]! + w1 * P[b + 2]! + w2 * P[c + 2]!;
    if (best && z <= best.z) continue;
    const nx = w0 * N[a]! + w1 * N[b]! + w2 * N[c]!;
    const ny = w0 * N[a + 1]! + w1 * N[b + 1]! + w2 * N[c + 1]!;
    const nz = w0 * N[a + 2]! + w1 * N[b + 2]! + w2 * N[c + 2]!;
    const l = Math.hypot(nx, ny, nz) || 1;
    best = { z, n: [nx / l, ny / l, nz / l] };
  }
  return best;
}

export function makeHead(center: V3): HeadShape {
  const d = decode();
  const positions = new Float32Array(d.pos.length);
  for (let v = 0; v < d.pos.length; v += 3) {
    positions[v] = d.pos[v]! + center[0];
    positions[v + 1] = d.pos[v + 1]! + center[1];
    positions[v + 2] = d.pos[v + 2]! + center[2];
  }
  const dir = new THREE.Vector3();
  const surface = (to: THREE.Vector3, scale = 1): V3 => {
    dir.copy(to).normalize();
    const r = radial(d.skull, Math.atan2(dir.x, dir.z), Math.acos(THREE.MathUtils.clamp(dir.y, -1, 1))) * scale;
    return [center[0] + dir.x * r, center[1] + dir.y * r, center[2] + dir.z * r];
  };
  const earReach = (to: THREE.Vector3): number => {
    dir.copy(to).normalize();
    return radial(d.ears, Math.atan2(dir.x, dir.z), Math.acos(THREE.MathUtils.clamp(dir.y, -1, 1)));
  };
  const frontPoint = (u: number, v: number, lift = 0.0018) => {
    const hit = castFront(d, u, v);
    if (!hit || hit.n[2] < 0.12) return null;
    const n = hit.n;
    return { p: [center[0] + u + n[0] * lift, center[1] + v + n[1] * lift, center[2] + hit.z + n[2] * lift] as V3, n };
  };
  return {
    center,
    a: radial(d.skull, Math.PI / 2, Math.PI / 2),
    b: radial(d.skull, 0, 0),
    c: radial(d.skull, 0, Math.PI / 2),
    surface,
    earReach,
    frontPoint,
    lm: DATA.landmarks as unknown as HeadLandmarks,
    mesh: { positions, normals: d.normals, index: d.index, flags: d.flags },
  };
}
