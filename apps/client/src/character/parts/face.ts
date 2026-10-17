/**
 * Faces as flat ink decals projected onto the head surface: crisp at any distance, zero textures, no outline.
 * Each face is a small set of graphic marks (eyes with a highlight, brows, mouth, optional blush).
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

export function buildFace(b: PartBuilder, h: HeadShape, faceId: string): void {
  const L = 0.0022; // lift above the skin
  const eyeU = 0.043;
  const eyeV = -0.006;
  switch (faceId) {
    case 'face.bright': {
      for (const s of [1, -1]) {
        ellipse(b, h, s * eyeU, eyeV, 0.0135, 0.0175, 0, Slot.INK, L);
        ellipse(b, h, s * eyeU + 0.005, eyeV + 0.007, 0.0045, 0.0045, 0, Slot.EYE_WHITE, L + 0.0008, 8);
        stroke(b, h, arc(s * (eyeU + 0.002), eyeV + 0.036, 0.03, 0.006, 8, s * -0.004), 0.0055, Slot.HAIR, L);
        ellipse(b, h, s * 0.066, -0.042, 0.014, 0.008, 0, Slot.BLUSH, L * 0.6, 10);
      }
      stroke(b, h, arc(0, -0.066, 0.024, -0.006, 8), 0.0045, Slot.INK, L);
      break;
    }
    case 'face.sleepy': {
      for (const s of [1, -1]) {
        stroke(b, h, arc(s * eyeU, eyeV - 0.002, 0.026, -0.006, 9), 0.0052, Slot.INK, L, false);
        stroke(b, h, arc(s * (eyeU + 0.002), eyeV + 0.03, 0.028, 0.0, 6, s * 0.003), 0.005, Slot.HAIR, L);
      }
      ellipse(b, h, 0, -0.07, 0.0055, 0.0045, 0, Slot.INK, L, 10);
      break;
    }
    case 'face.calm':
    default: {
      for (const s of [1, -1]) {
        // Almond eye: an ellipse slightly flattened on top, tilted outward, with a small highlight.
        ellipse(b, h, s * eyeU, eyeV, 0.0125, 0.0165, s * 0.12, Slot.INK, L, 16, (t) => (Math.sin(t) > 0 ? 0.82 : 1));
        ellipse(b, h, s * eyeU + 0.004, eyeV + 0.006, 0.0036, 0.0036, 0, Slot.EYE_WHITE, L + 0.0008, 8);
        stroke(b, h, arc(s * (eyeU + 0.001), eyeV + 0.034, 0.03, 0.002, 6, s * -0.002), 0.0058, Slot.HAIR, L);
      }
      stroke(b, h, arc(0, -0.068, 0.02, 0.0, 6), 0.0042, Slot.INK, L);
      break;
    }
  }
}
