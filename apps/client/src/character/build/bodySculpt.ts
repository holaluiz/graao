/**
 * The sculpted body (tools/character/build-body.ts → body-data.json): the torso with arms and hands, the pelvis with
 * legs, and the feet, fitted onto each body type's rig and into the torso, arm and leg rings garments are built from.
 * Positions are per body type; triangles, body regions and skinning blends are shared. Rig frame: meters, +Y up,
 * facing +Z, the character's left on +X.
 */
import type { BodyRegion } from '@graao/game-data';
import DATA from './body-data.json';
import { bytes } from './head';
import { REGION_IDS } from './PartBuilder';

export type SculptPart = 'torso' | 'legs' | 'feet';

export interface BodySculpt {
  positions: Float32Array;
  normals: Float32Array;
  index: Uint16Array;
  region: (BodyRegion | 'none')[];
  /** 0–1: how far each vertex follows its limb's bones instead of the trunk's (the foot's instead of the leg's). */
  blend: Float32Array;
  /** The thumb, tucked under the palm in the sculpt: it moves with the hand. */
  thumb: Uint8Array;
  /** Hidden inside another piece where they overlap (waist, ankle, neck): no ink outline there. */
  hidden: Uint8Array;
  /** Vertex range [first, count] of each sculpt. */
  parts: Record<SculptPart, [number, number]>;
}

const REGION_NAMES = Object.fromEntries(Object.entries(REGION_IDS).map(([name, id]) => [id, name])) as Record<number, BodyRegion | 'none'>;

const cache = new Map<boolean, BodySculpt>();

export function bodySculpt(sturdy: boolean): BodySculpt {
  const hit = cache.get(sturdy);
  if (hit) return hit;
  const raw = bytes(sturdy ? DATA.sturdy : DATA.slim);
  const positions = Float32Array.from(new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2), (v) => v / DATA.quant);
  const ib = bytes(DATA.index);
  const index = new Uint16Array(ib.buffer.slice(ib.byteOffset, ib.byteOffset + ib.byteLength));
  const parts = DATA.parts as Record<SculptPart, [number, number]>;
  const normals = new Float32Array(positions.length);
  const P = positions;
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t]! * 3, b = index[t + 1]! * 3, c = index[t + 2]! * 3;
    const ex = P[b]! - P[a]!, ey = P[b + 1]! - P[a + 1]!, ez = P[b + 2]! - P[a + 2]!;
    const fx = P[c]! - P[a]!, fy = P[c + 1]! - P[a + 1]!, fz = P[c + 2]! - P[a + 2]!;
    const nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx;
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
  const out: BodySculpt = {
    positions,
    normals,
    index,
    region: Array.from(bytes(DATA.region), (id) => REGION_NAMES[id] ?? 'none'),
    blend: Float32Array.from(bytes(DATA.blend), (b) => b / 255),
    thumb: bytes(DATA.flags).map((f) => f & 1),
    hidden: bytes(DATA.flags).map((f) => (f >> 1) & 1),
    parts,
  };
  cache.set(sturdy, out);
  return out;
}
