/**
 * Faces as flat ink decals projected onto the sculpted face (build/head.ts): crisp at any distance, zero textures,
 * no outline. The marks follow the sculpt's painted features: almond eyes under a heavy upper lash line that flicks
 * out at the corner, a tall dark iris tucked under it, a thin lower lid and a soft lid fold; thick angled brows in the
 * hair color; a straight mouth line under a tinted upper lip. Nose, lids and lips are sculpted (the mesh); the marks
 * only sit on them. Expressions bend these same shapes.
 */
import type { HeadShape } from '../build/anatomy';
import { PartBuilder, Slot, type SlotId } from '../build/PartBuilder';

type UV = [number, number];

/**
 * The left eye as painted on the sculpt, in meters from the eye landmark (`lm.eye`), u outward, v up. The opening is
 * the region between OPEN_BOTTOM and OPEN_TOP (both run inner → outer corner).
 */
const OPEN_TOP: UV[] = [[-0.0292, -0.0005], [-0.0234, 0.0031], [-0.0177, 0.0064], [-0.0054, 0.0089], [0.009, 0.0093], [0.0206, 0.0075], [0.0234, 0.006]];
const OPEN_BOTTOM: UV[] = [[-0.0292, -0.0005], [-0.0267, -0.0019], [-0.0234, -0.0055], [-0.0191, -0.0095], [-0.0126, -0.0116], [-0.0018, -0.0119], [0.009, -0.0111], [0.0155, -0.0084], [0.0191, -0.0034], [0.0216, 0.0024], [0.0234, 0.006]];
/** Upper edge of the lash line, from the inner corner to the tip of its flick past the outer corner. */
const LASH_TOP: UV[] = [[-0.0292, -0.0005], [-0.0234, 0.01], [-0.0177, 0.0118], [-0.0054, 0.0143], [0.009, 0.015], [0.0234, 0.0132], [0.031, 0.0112]];
const LASH_TIP: UV = [0.031, 0.0112];
const LOWER_LID: UV[] = [[-0.0198, -0.0088], [-0.0126, -0.0109], [-0.0018, -0.012], [0.0061, -0.0116], [0.0119, -0.0102]];
const FOLD: UV[] = [[-0.0249, 0.0168], [-0.0126, 0.023], [0.0054, 0.0248], [0.027, 0.0204]];
const IRIS = { c: [-0.0058, 0.0013] as UV, r: [0.012, 0.0135] as UV };
/** Brow band: lower and upper edges from the diagonal inner cut to the tapered outer tip. */
const BROW_BOTTOM: UV[] = [[-0.0343, 0.0251], [-0.027, 0.0277], [-0.0162, 0.0302], [-0.0054, 0.032], [0.009, 0.0333], [0.0234, 0.034], [0.0379, 0.0331], [0.0422, 0.0363]];
const BROW_TOP: UV[] = [[-0.0285, 0.0345], [-0.0234, 0.0367], [-0.0126, 0.0392], [0.0018, 0.0414], [0.0162, 0.0428], [0.0234, 0.0432], [0.0307, 0.0414], [0.0379, 0.0385], [0.0422, 0.0363]];

const L = 0.0022; // lift above the skin

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Piecewise-linear v(u) of a polyline whose u is monotonic (clamped at the ends). */
function vAt(line: UV[], u: number): number {
  const asc = line[0]![0] < line[line.length - 1]![0];
  for (let i = 0; i < line.length - 1; i++) {
    const [ua, va] = line[i]!;
    const [ub, vb] = line[i + 1]!;
    if ((asc && u >= ua && u <= ub) || (!asc && u <= ua && u >= ub)) return lerp(va, vb, (u - ua) / (ub - ua || 1));
  }
  const first = line[0]!;
  const last = line[line.length - 1]!;
  return (asc ? u < first[0] : u > first[0]) ? first[1] : last[1];
}

/** `n` points evenly spaced along a polyline (by arc length). */
function resample(line: UV[], n: number): UV[] {
  const acc = [0];
  for (let i = 1; i < line.length; i++) acc.push(acc[i - 1]! + Math.hypot(line[i]![0] - line[i - 1]![0], line[i]![1] - line[i - 1]![1]));
  const total = acc[acc.length - 1]!;
  const out: UV[] = [];
  for (let k = 0; k < n; k++) {
    const s = (k / (n - 1)) * total;
    let i = 0;
    while (i < line.length - 2 && acc[i + 1]! < s) i++;
    const t = (s - acc[i]!) / (acc[i + 1]! - acc[i]! || 1);
    out.push([lerp(line[i]![0], line[i + 1]![0], t), lerp(line[i]![1], line[i + 1]![1], t)]);
  }
  return out;
}

function tri2(b: PartBuilder, i0: number, i1: number, i2: number): void {
  // Orientation: counter-clockwise seen from the front (+Z).
  const P = b.pos;
  const ax = P[i0 * 3]!, ay = P[i0 * 3 + 1]!;
  const bx = P[i1 * 3]!, by = P[i1 * 3 + 1]!;
  const cx = P[i2 * 3]!, cy = P[i2 * 3 + 1]!;
  const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (Math.abs(cross) < 1e-14) return;
  if (cross > 0) b.tri(i0, i1, i2);
  else b.tri(i0, i2, i1);
}

/**
 * Decal band between two edges sampled at matching parameters (lower[i] ↔ upper[i]), with `rows` rows across so it
 * rides over the sculpt instead of cutting under it. Face coordinates; `null` samples (off the face) leave holes.
 */
function band(b: PartBuilder, h: HeadShape, lower: UV[], upper: UV[], slot: SlotId, lift: number, rows = 2): void {
  b.begin({ slot, region: 'head', bones: ['Head'], outline: 0 });
  const grid: (number | null)[][] = [];
  for (let r = 0; r <= rows; r++) {
    const t = r / rows;
    grid.push(
      lower.map((lo, i) => {
        const up = upper[i]!;
        const q = h.frontPoint(lerp(lo[0], up[0], t), lerp(lo[1], up[1], t), lift);
        if (!q) return null;
        const id = b.vertex(...q.p);
        b.setNormalLater(id, q.n);
        return id;
      }),
    );
  }
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < lower.length - 1; i++) {
      const a = grid[r]![i], c = grid[r]![i + 1], d = grid[r + 1]![i], e = grid[r + 1]![i + 1];
      if (a != null && c != null && e != null) tri2(b, a, c, e);
      if (a != null && e != null && d != null) tri2(b, a, e, d);
    }
  }
  b.end({ orient: 'keep' });
  b.flushNormals();
}

/** Filled ellipse at (cu, cv), optionally clipped between two v(u) bounds (an iris under the lids). */
function ellipse(b: PartBuilder, h: HeadShape, cu: number, cv: number, rw: number, rh: number, slot: SlotId, lift: number, n = 14, clip?: { lo: (u: number) => number; hi: (u: number) => number }): void {
  const lower: UV[] = [];
  const upper: UV[] = [];
  for (let k = 0; k <= n; k++) {
    // Cosine spacing: more columns near the rounded sides.
    const x = -Math.cos((k / n) * Math.PI);
    const u = cu + x * rw;
    const half = rh * Math.sqrt(Math.max(0, 1 - x * x));
    let lo = cv - half;
    let hi = cv + half;
    if (clip) {
      lo = Math.max(lo, clip.lo(u));
      hi = Math.min(hi, clip.hi(u));
      if (hi < lo) hi = lo;
    }
    lower.push([u, lo]);
    upper.push([u, hi]);
  }
  band(b, h, lower, upper, slot, lift, 3);
}

/** Stroke along a polyline with a width profile (meters, as a function of 0..1 along it). */
function stroke(b: PartBuilder, h: HeadShape, pts: UV[], width: (t: number) => number, slot: SlotId, lift: number, n = 14): void {
  const line = resample(pts, n);
  const lower: UV[] = [];
  const upper: UV[] = [];
  line.forEach(([u, v], i) => {
    const a = line[Math.max(0, i - 1)]!;
    const c = line[Math.min(line.length - 1, i + 1)]!;
    const du = c[0] - a[0];
    const dv = c[1] - a[1];
    const l = Math.hypot(du, dv) || 1;
    const w = width(i / (line.length - 1)) / 2;
    lower.push([u + (dv / l) * w, v - (du / l) * w]);
    upper.push([u - (dv / l) * w, v + (du / l) * w]);
  });
  band(b, h, lower, upper, slot, lift, 1);
}

const taper = (w: number, ends = 0.35) => (t: number) => w * (ends + (1 - ends) * Math.sin(Math.PI * t));

interface EyeStyle {
  /** Opening height (1 = as painted; < 1 lowers the upper lid). */
  open?: number;
  /** Uniform scale around the eye landmark. */
  size?: number;
  /** Iris shift (meters, u outward / v up). */
  look?: UV;
}

/** One open eye on side `s` (+1 = the character's left). */
function eye(b: PartBuilder, h: HeadShape, s: number, st: EyeStyle = {}): void {
  const k = st.size ?? 1;
  const open = st.open ?? 1;
  const [eu, ev] = h.lm.eye;
  const F = (p: UV): UV => [s * (eu + p[0] * k), ev + p[1] * k];
  const bottom = (u: number) => vAt(OPEN_BOTTOM, u);
  const top = (u: number) => lerp(bottom(u), vAt(OPEN_TOP, u), open);
  const N = 18;
  const u0 = OPEN_TOP[0]![0];
  const u1 = OPEN_TOP[OPEN_TOP.length - 1]![0];
  const cols = Array.from({ length: N }, (_, i) => lerp(u0, u1, (1 - Math.cos((i / (N - 1)) * Math.PI)) / 2));
  // White of the eye.
  band(b, h, cols.map((u) => F([u, bottom(u)])), cols.map((u) => F([u, top(u)])), Slot.EYE_WHITE, L, 3);
  // Iris: tall dark oval clipped by the lids (eye-local clip, mapped to the side).
  const ic: UV = [IRIS.c[0] + (st.look?.[0] ?? 0), IRIS.c[1] + (st.look?.[1] ?? 0)];
  const lowerIris: UV[] = [];
  const upperIris: UV[] = [];
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const x = -Math.cos((i / n) * Math.PI);
    const u = ic[0] + x * IRIS.r[0];
    const half = IRIS.r[1] * Math.sqrt(Math.max(0, 1 - x * x));
    const lo = Math.max(ic[1] - half, bottom(u) + 0.0004);
    const hi = Math.max(lo, Math.min(ic[1] + half, top(u)));
    lowerIris.push(F([u, lo]));
    upperIris.push(F([u, hi]));
  }
  band(b, h, lowerIris, upperIris, Slot.INK, L + 0.0004, 3);
  // A small catch light up toward the outer side (kept under the lid).
  const hu = ic[0] + IRIS.r[0] * 0.38;
  const hv = Math.min(ic[1] + IRIS.r[1] * 0.25, top(hu) - 0.0032);
  if (hv - 0.002 > bottom(hu)) {
    const c = F([hu, hv]);
    ellipse(b, h, c[0], c[1], 0.0021 * k, 0.0021 * k, Slot.EYE_WHITE, L + 0.0008, 8);
  }
  // Lash line: from the inner corner along the (possibly lowered) upper lid, flicking out past the outer corner.
  const M = 16;
  const lidLine = resample([...OPEN_TOP.map(([u]) => [u, top(u)] as UV), LASH_TIP], M);
  const lashTop = resample(LASH_TOP, M);
  const openTop = resample([...OPEN_TOP, LASH_TIP], M);
  const lashUpper = lidLine.map((p, i) => [p[0] + lashTop[i]![0] - openTop[i]![0], p[1] + lashTop[i]![1] - openTop[i]![1]] as UV);
  band(b, h, lidLine.map(F), lashUpper.map(F), Slot.INK, L + 0.0012, 2);
  // Thin lower lid under the iris and a soft fold over the lid.
  stroke(b, h, LOWER_LID.map(F), taper(0.0013 * k, 0.2), Slot.INK, L + 0.0004, 10);
  if (open > 0.7) stroke(b, h, FOLD.map((p) => F([p[0], p[1] - (1 - open) * 0.01])), taper(0.0011 * k, 0.1), Slot.LIPS, L, 10);
}

/** Closed eye (a wink, a laugh): the lash line arched over a shut lid, keeping its flick. */
function closedEye(b: PartBuilder, h: HeadShape, s: number): void {
  const [eu, ev] = h.lm.eye;
  const F = (p: UV): UV => [s * (eu + p[0]), ev + p[1]];
  const arc: UV[] = [[-0.028, -0.004], [-0.018, 0.0015], [-0.004, 0.0035], [0.01, 0.0025], [0.021, -0.0005], [0.029, 0.003]];
  stroke(b, h, arc.map(F), (t) => 0.0042 * (0.3 + 0.7 * Math.sin(Math.PI * Math.min(1, t * 1.15))), Slot.INK, L + 0.0012, 16);
}

/** Brows in the hair color: `lift` raises them (surprise), `tilt` lifts the inner end (worry) or drops it (mischief). */
function brows(b: PartBuilder, h: HeadShape, lift = 0, tilt = 0): void {
  const [eu, ev] = h.lm.eye;
  const N = 14;
  const lower = resample(BROW_BOTTOM, N);
  const upper = resample(BROW_TOP, N);
  for (const s of [1, -1]) {
    // Tilt pivots about the outer end: the inner end moves by `tilt`.
    const F = (p: UV): UV => [s * (eu + p[0]), ev + p[1] + lift + tilt * Math.max(0, (0.042 - p[0]) / 0.076)];
    band(b, h, lower.map(F), upper.map(F), Slot.HAIR, L, 2);
  }
}

/** Straight mouth line with a hint of a smile under a tinted upper lip. */
function mouth(b: PartBuilder, h: HeadShape, smile = 0.0012, wScale = 1, du = 0): void {
  const [, mv] = h.lm.mouth;
  const w = h.lm.mouthHalf * 0.94 * wScale;
  const line: UV[] = Array.from({ length: 9 }, (_, i) => {
    const t = i / 8 - 0.5;
    return [du + t * 2 * w, mv + smile * 4 * t * t - 0.0006 * (1 - 4 * t * t)] as UV;
  });
  // Upper lip: a lens from the line up to its bow (not to the corners).
  const lw = w * 0.82;
  const lipLower: UV[] = [];
  const lipUpper: UV[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10 - 0.5;
    const u = du + t * 2 * lw;
    const base = mv + smile * 4 * (u - du) * (u - du) / (w * w) * 0.25 + 0.0008;
    lipLower.push([u, base]);
    lipUpper.push([u, base + 0.0058 * Math.pow(1 - 4 * t * t, 0.6) * (1 - 0.25 * Math.exp(-((t * 9) ** 2)))]);
  }
  band(b, h, lipLower, lipUpper, Slot.LIPS, L * 0.7, 2);
  stroke(b, h, line, taper(0.002, 0.55), Slot.INK, L, 14);
}

/** Open mouth: a dark lens hanging from the mouth line (`depth` deep), with optional teeth and tongue. */
function openMouth(b: PartBuilder, h: HeadShape, halfW: number, depth: number, teeth: boolean): void {
  const [, mv] = h.lm.mouth;
  const top = mv + 0.0012;
  const lower: UV[] = [];
  const upper: UV[] = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14 - 0.5;
    const u = t * 2 * halfW;
    const lift = 0.0018 * (4 * t * t); // corners turned up
    upper.push([u, top + lift]);
    lower.push([u, top + lift - depth * Math.pow(Math.max(0, 1 - 4 * t * t), 0.75)]);
  }
  band(b, h, lower, upper, Slot.INK, L, 3);
  if (teeth) band(b, h, upper.slice(2, -2).map(([u, v]) => [u, v - 0.0034] as UV), upper.slice(2, -2), Slot.EYE_WHITE, L + 0.0008, 1);
  ellipse(b, h, 0, top - depth * 0.78, halfW * 0.42, depth * 0.24, Slot.BLUSH, L + 0.0008, 10);
}

function blush(b: PartBuilder, h: HeadShape): void {
  const [eu, ev] = h.lm.eye;
  for (const s of [1, -1]) ellipse(b, h, s * (eu + 0.006), ev - 0.026, 0.0135, 0.0068, Slot.BLUSH, L * 0.6, 12);
}

export function buildFace(b: PartBuilder, h: HeadShape, faceId: string): void {
  switch (faceId) {
    case 'face.bright': {
      for (const s of [1, -1]) eye(b, h, s, { size: 1.07, open: 1.12 });
      brows(b, h, 0.004, 0.001);
      blush(b, h);
      openMouth(b, h, h.lm.mouthHalf * 0.62, 0.011, false);
      break;
    }
    case 'face.sleepy': {
      for (const s of [1, -1]) eye(b, h, s, { open: 0.42, look: [0, -0.002] });
      brows(b, h, -0.002, 0.002);
      mouth(b, h, 0.0004, 0.7);
      break;
    }
    case 'face.wink': {
      eye(b, h, 1);
      closedEye(b, h, -1);
      brows(b, h, 0.001, -0.0015);
      blush(b, h);
      mouth(b, h, 0.004, 1, 0.003);
      break;
    }
    case 'face.grin': {
      for (const s of [1, -1]) eye(b, h, s, { open: 0.85 });
      brows(b, h, 0.002);
      openMouth(b, h, h.lm.mouthHalf * 1.02, 0.015, true);
      break;
    }
    case 'face.freckles': {
      const [eu, ev] = h.lm.eye;
      for (const s of [1, -1]) {
        eye(b, h, s);
        for (const [u, v] of [[-0.008, -0.024], [0.004, -0.029], [-0.002, -0.036], [0.013, -0.034], [-0.016, -0.031], [0.009, -0.022]] as const) {
          ellipse(b, h, s * (eu + u), ev + v, 0.0027, 0.0027, Slot.LIPS, L * 0.8, 6);
        }
        ellipse(b, h, s * 0.012, ev - 0.02, 0.0019, 0.0019, Slot.LIPS, L * 0.8, 6);
      }
      brows(b, h);
      mouth(b, h, 0.002);
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
