/**
 * Faces as flat ink decals projected onto the head surface: crisp at any distance, zero textures, no outline.
 * Few marks, carefully placed (the Messenger lesson): open oval eyes with a highlight and an upper lid line, soft
 * arched brows, a small mouth with a hint of lower lip. The nose is sculpted on the head (body.ts), not drawn.
 */
import type { HeadShape } from '../build/anatomy';
import { PartBuilder, Slot, type SlotId } from '../build/PartBuilder';

type UV = [number, number];


/** Filled ellipse decal at (cu, cv) in head-local face coordinates (meters from the head center). */
function ellipse(b: PartBuilder, h: HeadShape, cu: number, cv: number, rw: number, rh: number, rot: number, slot: SlotId, lift: number, n = 14, squash?: (t: number) => number): void {
  b.begin({ slot, region: 'head', bones: ['Head'], outline: 0 });
  const c = h.frontPoint(cu, cv, lift);
  if (!c) {
    b.end({ orient: 'keep' });
    return;
  }
  const center = b.vertex(...c.p);
  b.setNormalLater(center, c.n);
  const ring: number[] = [];
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  for (let k = 0; k < n; k++) {
    const t = (k / n) * Math.PI * 2;
    const x = Math.cos(t) * rw;
    let y = Math.sin(t) * rh;
    if (squash) y *= squash(t);
    const u = cu + x * cr - y * sr;
    const v = cv + x * sr + y * cr;
    const q = h.frontPoint(u, v, lift);
    if (!q) continue;
    const id = b.vertex(...q.p);
    b.setNormalLater(id, q.n);
    ring.push(id);
  }
  for (let k = 0; k < ring.length; k++) b.tri(center, ring[k]!, ring[(k + 1) % ring.length]!);
  b.end({ orient: 'keep' });
  b.flushNormals();
}

/** Stroke decal along a polyline in face coordinates. */
function stroke(b: PartBuilder, h: HeadShape, pts: UV[], width: number, slot: SlotId, lift: number, taper = true): void {
  b.begin({ slot, region: 'head', bones: ['Head'], outline: 0 });
  const left: number[] = [];
  const right: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)]!;
    const c = pts[Math.min(pts.length - 1, i + 1)]!;
    const dx = c[0] - a[0];
    const dy = c[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    const t = i / (pts.length - 1);
    const w = (width / 2) * (taper ? 0.45 + 0.55 * Math.sin(Math.PI * t) : 1);
    const nx = (-dy / l) * w;
    const ny = (dx / l) * w;
    const [u, v] = pts[i]!;
    const L = h.frontPoint(u + nx, v + ny, lift);
    const R = h.frontPoint(u - nx, v - ny, lift);
    if (!L || !R) continue;
    const li = b.vertex(...L.p);
    const ri = b.vertex(...R.p);
    b.setNormalLater(li, L.n);
    b.setNormalLater(ri, R.n);
    left.push(li);
    right.push(ri);
  }
  for (let i = 0; i < left.length - 1; i++) {
    // Orientation: make each triangle counter-clockwise seen from the front (+Z).
    tri2(b, left[i]!, right[i]!, left[i + 1]!);
    tri2(b, right[i]!, right[i + 1]!, left[i + 1]!);
  }
  b.end({ orient: 'keep' });
  b.flushNormals();
}

function tri2(b: PartBuilder, i0: number, i1: number, i2: number): void {
  const P = b.pos;
  const ax = P[i0 * 3]!, ay = P[i0 * 3 + 1]!;
  const bx = P[i1 * 3]!, by = P[i1 * 3 + 1]!;
  const cx = P[i2 * 3]!, cy = P[i2 * 3 + 1]!;
  const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (cross >= 0) b.tri(i0, i1, i2);
  else b.tri(i0, i2, i1);
}

const arc = (cu: number, cv: number, w: number, bend: number, n = 8, tilt = 0): UV[] =>
  Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1) - 0.5;
    return [cu + t * w, cv + bend * (1 - 4 * t * t) + tilt * t] as UV;
  });

const L = 0.0022; // lift above the skin
const EYE_U = 0.042;
const EYE_V = -0.004;

/** One open eye: dark oval iris, a highlight up and toward the outer corner, and a lid line over it. */
function eye(b: PartBuilder, h: HeadShape, s: number, size = 1, lid = 1): void {
  const u = s * EYE_U;
  ellipse(b, h, u, EYE_V, 0.0102 * size, 0.0138 * size, 0, Slot.INK, L, 18);
  ellipse(b, h, u + s * 0.0034 * size, EYE_V + 0.0052 * size, 0.0033 * size, 0.0033 * size, 0, Slot.EYE_WHITE, L + 0.0008, 10);
  // Upper lid: a thin arc hugging the top of the iris, a little longer on the outer side (no slant, no fold).
  const lidPts: [number, number][] = Array.from({ length: 9 }, (_, i) => {
    const t = i / 8;
    const x = -0.0135 + 0.029 * t;
    const y = EYE_V + 0.0118 * size + 0.0042 * Math.sin(Math.PI * Math.min(1, t * 1.08)) * lid;
    return [u + s * x * size, y];
  });
  stroke(b, h, lidPts, 0.0034, Slot.INK, L + 0.0004);
}

/** Closed eye (sleep, wink, a big laugh): a soft downward smile curve. */
function closedEye(b: PartBuilder, h: HeadShape, s: number): void {
  stroke(b, h, arc(s * EYE_U, EYE_V - 0.001, 0.025, 0.0065, 9), 0.0042, Slot.INK, L, false);
}

/** Brows: soft arches in the hair color; `lift` raises them (surprise), `tilt` angles the inner end (worry/mischief). */
function brows(b: PartBuilder, h: HeadShape, lift = 0, tilt = 0, width = 0.0052): void {
  for (const s of [1, -1]) stroke(b, h, arc(s * (EYE_U + 0.002), EYE_V + 0.033 + lift, 0.029, 0.0045, 8, s * (-0.003 + tilt)), width, Slot.HAIR, L);
}

/** Small closed mouth with a hint of a smile and a lower lip shadow. */
function mouth(b: PartBuilder, h: HeadShape, smile = 0.0025, w = 0.02, du = 0): void {
  stroke(b, h, arc(du, -0.066, w, -smile, 8), 0.0034, Slot.INK, L);
  ellipse(b, h, du, -0.0712, w * 0.36, 0.0026, 0, Slot.LIPS, L * 0.7, 10);
}

function blush(b: PartBuilder, h: HeadShape): void {
  for (const s of [1, -1]) ellipse(b, h, s * 0.064, -0.039, 0.0125, 0.0068, 0, Slot.BLUSH, L * 0.6, 12);
}

export function buildFace(b: PartBuilder, h: HeadShape, faceId: string): void {
  switch (faceId) {
    case 'face.bright': {
      for (const s of [1, -1]) eye(b, h, s, 1.1, 1.2);
      brows(b, h, 0.003);
      blush(b, h);
      // Open "D" smile.
      ellipse(b, h, 0, -0.066, 0.0125, 0.0085, 0, Slot.INK, L, 16, (t) => (Math.sin(t) > 0 ? 0.15 : 1));
      ellipse(b, h, 0, -0.0705, 0.0065, 0.0028, 0, Slot.BLUSH, L + 0.0008, 10);
      break;
    }
    case 'face.sleepy': {
      for (const s of [1, -1]) {
        // Heavy lids: the iris shows only below a thicker, flatter lid line.
        ellipse(b, h, s * EYE_U, EYE_V - 0.003, 0.0098, 0.009, 0, Slot.INK, L, 16, (t) => (Math.sin(t) > 0 ? 0.35 : 1));
        stroke(b, h, arc(s * EYE_U, EYE_V - 0.0005, 0.03, 0.0015, 8), 0.0042, Slot.INK, L + 0.0004, false);
      }
      brows(b, h, -0.003, 0.002);
      mouth(b, h, 0.0005, 0.016);
      break;
    }
    case 'face.wink': {
      eye(b, h, 1);
      closedEye(b, h, -1);
      brows(b, h, 0.001);
      blush(b, h);
      mouth(b, h, 0.006, 0.024, 0.004);
      break;
    }
    case 'face.grin': {
      for (const s of [1, -1]) eye(b, h, s, 1.04);
      brows(b, h, 0.002);
      // Wide open smile with teeth and tongue.
      ellipse(b, h, 0, -0.064, 0.02, 0.0135, 0, Slot.INK, L, 20, (t) => (Math.sin(t) > 0 ? 0.16 : 1));
      ellipse(b, h, 0, -0.0625, 0.0155, 0.0032, 0, Slot.EYE_WHITE, L + 0.0008, 12);
      ellipse(b, h, 0, -0.0728, 0.0085, 0.0038, 0, Slot.BLUSH, L + 0.0008, 10);
      break;
    }
    case 'face.freckles': {
      for (const s of [1, -1]) {
        eye(b, h, s);
        for (const [u, v] of [[0.052, -0.03], [0.064, -0.036], [0.058, -0.045], [0.073, -0.043], [0.046, -0.038], [0.068, -0.027]] as const) {
          ellipse(b, h, s * u, v, 0.0028, 0.0028, 0, Slot.LIPS, L * 0.8, 7);
        }
        ellipse(b, h, s * 0.019, -0.024, 0.002, 0.002, 0, Slot.LIPS, L * 0.8, 6);
      }
      brows(b, h);
      mouth(b, h, 0.004);
      break;
    }
    case 'face.calm':
    default: {
      for (const s of [1, -1]) eye(b, h, s);
      brows(b, h);
      mouth(b, h);
      break;
    }
  }
}
