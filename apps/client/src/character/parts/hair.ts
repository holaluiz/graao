/**
 * Hair as chunky closed shells over the head surface (a few big shapes, never strands), rigid on the Head bone.
 * The hairline is a function φmax(θ) (polar angle from the crown vs. azimuth from the face) with jagged fringe tips.
 * Braids, locs and pigtails are swept tubes; curls are round clumps. Under a hat, pieces that stick up are dropped.
 */
import * as THREE from 'three';
import type { HeadShape } from '../build/anatomy';
import { PartBuilder, Slot, type RingSpec, type SlotId, type V3 } from '../build/PartBuilder';

const DEG = Math.PI / 180;
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** Triangle wave in [0, 1] with period `p` (radians). */
const tri = (x: number, p: number) => {
  const t = ((x / p) % 1 + 1) % 1;
  return 1 - Math.abs(2 * t - 1);
};

/** Unit direction from the head center: θ = azimuth (0 = face, +π/2 = the character's left), φ = polar from the crown. */
export function dirOf(theta: number, phi: number): THREE.Vector3 {
  return new THREE.Vector3(Math.sin(phi) * Math.sin(theta), Math.cos(phi), Math.sin(phi) * Math.cos(theta));
}

export interface ShellStyle {
  /** Hairline: polar angle (radians from the crown) as a function of azimuth θ (0 = face). */
  phiMax(theta: number): number;
  /** Outer shell scale relative to the skull. */
  outer(theta: number, phi: number, edge: number): number;
  /** Free-form outer point; overrides `outer` (the black power is a sphere, not a scaled skull). */
  outerAt?(theta: number, phi: number, edge: number): V3;
  slot?: SlotId;
  /** Inner shell scale (default 1.015, just above the scalp). */
  inner?: number;
}

/** Hairline from a front profile, a side angle (around the ears) and a back angle (nape). */
export function hairline(front: (t: number) => number, side: number, back: number, f0 = 40 * DEG, f1 = 75 * DEG): (t: number) => number {
  return (t) => {
    const a = Math.abs(t);
    const fr = front(t);
    if (a < f0) return fr;
    if (a < f1) return fr + (side - fr) * smooth(f0, f1, a);
    return side + (back - side) * smooth(90 * DEG, 150 * DEG, a);
  };
}

/** Closed cap over the skull from the crown down to the hairline (hair, bandanas, beanies). */
export function shell(b: PartBuilder, h: HeadShape, style: ShellStyle, nu = 36, nv = 11): void {
  b.begin({ slot: style.slot ?? Slot.HAIR, region: 'none', bones: ['Head'] });
  const d = new THREE.Vector3();
  const innerScale = style.inner ?? 1.015;
  const at = (theta: number, phi: number, scale: number): V3 => {
    d.set(Math.sin(phi) * Math.sin(theta), Math.cos(phi), Math.sin(phi) * Math.cos(theta));
    return h.surface(d, scale);
  };
  const out = (theta: number, phi: number, edge: number): V3 => (style.outerAt ? style.outerAt(theta, phi, edge) : at(theta, phi, style.outer(theta, phi, edge)));
  const topOut = b.vertex(...out(0, 0, 0));
  const topIn = b.vertex(...at(0, 0, innerScale));
  const outer: number[][] = [];
  const inner: number[][] = [];
  for (let j = 1; j <= nv; j++) {
    const rowO: number[] = [];
    const rowI: number[] = [];
    for (let i = 0; i < nu; i++) {
      const theta = (i / nu) * Math.PI * 2 - Math.PI;
      const pm = style.phiMax(theta);
      const phi = (j / nv) * pm;
      const edge = j / nv;
      rowO.push(b.vertex(...out(theta, phi, edge)));
      rowI.push(b.vertex(...at(theta, phi, innerScale)));
    }
    outer.push(rowO);
    inner.push(rowI);
  }
  for (let i = 0; i < nu; i++) {
    const i1 = (i + 1) % nu;
    b.tri(topOut, outer[0]![i]!, outer[0]![i1]!);
    b.tri(topIn, inner[0]![i1]!, inner[0]![i]!);
  }
  for (let j = 0; j < nv - 1; j++) {
    for (let i = 0; i < nu; i++) {
      const i1 = (i + 1) % nu;
      const o = outer;
      b.tri(o[j]![i]!, o[j + 1]![i]!, o[j + 1]![i1]!);
      b.tri(o[j]![i]!, o[j + 1]![i1]!, o[j]![i1]!);
      const n = inner;
      b.tri(n[j]![i]!, n[j + 1]![i1]!, n[j + 1]![i]!);
      b.tri(n[j]![i]!, n[j]![i1]!, n[j + 1]![i1]!);
    }
  }
  // Rim joining outer and inner at the hairline.
  const lo = outer[nv - 1]!;
  const li = inner[nv - 1]!;
  for (let i = 0; i < nu; i++) {
    const i1 = (i + 1) % nu;
    b.tri(lo[i]!, li[i]!, li[i1]!);
    b.tri(lo[i]!, li[i1]!, lo[i1]!);
  }
  b.end();
}

/** A chunky tuft: a flattened cone sticking out of the hair at direction (theta, phi). */
function tuft(b: PartBuilder, h: HeadShape, theta: number, phi: number, len: number, width: number, tilt: number, scale: number): void {
  const d = new THREE.Vector3(Math.sin(phi) * Math.sin(theta), Math.cos(phi), Math.sin(phi) * Math.cos(theta));
  const base = new THREE.Vector3(...h.surface(d, scale * 0.97));
  const out = new THREE.Vector3().subVectors(base, new THREE.Vector3(...h.center)).normalize();
  // Bend the tip toward the back/down a little.
  const tipDir = out.clone().applyAxisAngle(new THREE.Vector3(Math.cos(theta), 0, -Math.sin(theta)), tilt).normalize();
  const mid = base.clone().addScaledVector(tipDir, len * 0.5);
  const tip = base.clone().addScaledVector(tipDir, len);
  b.tube(
    [
      { p: [base.x, base.y, base.z], ra: width, rb: width * 0.55 },
      { p: [mid.x, mid.y, mid.z], ra: width * 0.6, rb: width * 0.35 },
      { p: [tip.x, tip.y, tip.z], ra: width * 0.08, rb: width * 0.06 },
    ],
    { slot: Slot.HAIR, bones: ['Head'], ref: [Math.cos(theta), 0, -Math.sin(theta)], segments: 8, capStart: 'round', capEnd: 'flat' },
  );
}

/** Swept tube hanging from the scalp at (θ, φ): braids and locs. `bump` alternates ring radii for a braided look. */
function strand(b: PartBuilder, h: HeadShape, theta: number, phi: number, len: number, drift: number, r: number, bump: number, rings = 10, segments = 6): V3 {
  const start = h.surface(dirOf(theta, phi), 1.0);
  const ox = Math.sin(theta);
  const oz = Math.cos(theta);
  const spec: RingSpec[] = [];
  for (let i = 0; i <= rings; i++) {
    const u = i / rings;
    // Out over the head's curve first, then straight down.
    const push = drift * Math.sin(Math.min(1, u * 2.4) * (Math.PI / 2));
    const rr = r * (i % 2 ? 1 - bump : 1) * (1 - 0.3 * u);
    spec.push({ p: [start[0] + ox * push, start[1] - len * u, start[2] + oz * push], ra: rr, rb: rr });
  }
  b.tube(spec, { slot: Slot.HAIR, bones: ['Head'], ref: [1, 0, 0], segments, capStart: 'round', capEnd: 'round' });
  return spec[spec.length - 1]!.p;
}

/**
 * How far each style stands off the skull (shell scale): hats are fitted over it, and side accessories (flower,
 * headphones, earrings) move out with it.
 */
const HAIR_FIT: Record<string, number> = {
  'hair.ondulado': 1.32,
  'hair.bob': 1.15,
  'hair.crop': 1.09,
  'hair.ponytail': 1.07,
  'hair.buns': 1.06,
  'hair.afro': 1.42,
  'hair.cachos': 1.2,
  'hair.trancas': 1.06,
  'hair.dreads': 1.1,
  'hair.liso': 1.12,
  'hair.chiquinha': 1.08,
  'hair.coque': 1.06,
  'hair.moicano': 1.03,
  'hair.raspado': 1.03,
  'hair.careca': 1.0,
};
export function hairFit(hairId: string): number {
  return HAIR_FIT[hairId] ?? 1.1;
}

/** The black power's sphere (shared by the hair, by wrapped hats and by the hat seat). */
const AFRO = { c: [0, 0.05, -0.018] as V3, r: 0.212, sx: 1.08, sy: 0.95, sz: 0.98 };

/** Outer surface of the hair volume in direction `d` from the head center (hats wrap it; ignores the hairline). */
export function hairOuter(h: HeadShape, hairId: string, d: THREE.Vector3, pad = 0): V3 {
  if (hairId === 'hair.afro') {
    const c = h.center;
    const r = AFRO.r * 1.03 + pad;
    return [c[0] + AFRO.c[0] + d.x * r * AFRO.sx, c[1] + AFRO.c[1] + d.y * r * AFRO.sy, c[2] + AFRO.c[2] + d.z * r * AFRO.sz];
  }
  const p = h.surface(d, hairFit(hairId));
  return [p[0] + d.x * pad, p[1] + d.y * pad, p[2] + d.z * pad];
}

/**
 * Where a brimmed hat sits: uniform scale of the hat around the head center and how far it rises. Bigger hair raises
 * the hat to where the hair is as narrow as the hat band; the black power wears it perched on top.
 */
export function hatSeat(hairId: string): { k: number; lift: number } {
  if (hairId === 'hair.afro') return { k: 1.25, lift: 0.14 };
  const fit = hairFit(hairId);
  return { k: 1 + (fit - 1) * 0.55, lift: (fit - 1) * 0.133 };
}

const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** `covered`: a hat is on, so pieces that stick up (buns, crests) are left out instead of piercing it. */
export function buildHair(b: PartBuilder, h: HeadShape, hairId: string, covered = false): void {
  const c = h.center;
  const P = (x: number, y: number, z: number): V3 => [c[0] + x, c[1] + y, c[2] + z];
  const onHead = { slot: Slot.HAIR, bones: ['Head' as const] };
  switch (hairId) {
    case 'hair.careca':
      break;
    case 'hair.afro': {
      // A big lumpy sphere above and behind the skull, melting into the scalp at the hairline.
      const C = P(...AFRO.c);
      const R = AFRO.r;
      shell(
        b,
        h,
        {
          phiMax: hairline(() => 58 * DEG, 94 * DEG, 110 * DEG),
          outer: () => 1.04,
          outerAt: (t, phi, edge) => {
            const d = dirOf(t, phi);
            const lump = 1 + 0.035 * Math.sin(5 * t + 1) * Math.sin(4 * phi) + 0.02 * Math.sin(9 * t) * Math.sin(7 * phi + 0.5);
            const sphere: V3 = [C[0] + d.x * R * AFRO.sx * lump, C[1] + d.y * R * AFRO.sy * lump, C[2] + d.z * R * AFRO.sz * lump];
            return lerp3(sphere, h.surface(d, 1.04), smooth(0.72, 1, edge));
          },
        },
        44,
        15,
      );
      break;
    }
    case 'hair.cachos': {
      const pm = hairline((t) => 60 * DEG + 9 * DEG * tri(t + 0.2, 10 * DEG), 116 * DEG, 122 * DEG, 38 * DEG, 72 * DEG);
      const out = (t: number, phi: number, edge: number) =>
        1.13 + 0.09 * smooth(50 * DEG, 110 * DEG, phi) + 0.025 * Math.sin(7 * t) * Math.sin(5 * phi) - 0.05 * smooth(0.85, 1, edge);
      shell(b, h, { phiMax: pm, outer: out }, 40, 12);
      // Curls: round clumps along the lower edge (the face stays clear), small ones on the fringe, a few on the crown.
      for (let i = 0; i < 18; i++) {
        const t = -Math.PI + ((i + 0.5) * 2 * Math.PI) / 18;
        if (Math.abs(t) < 42 * DEG) continue;
        const phi = pm(t) - 7 * DEG;
        const r = 0.03 + 0.006 * Math.sin(i * 2.3);
        b.ellipsoid(h.surface(dirOf(t, phi), out(t, phi, 0.9) + 0.01), [r, r * 0.9, r], onHead, 9, 6);
      }
      for (const t of [-0.55, -0.22, 0.12, 0.45]) {
        const phi = pm(t) - 5 * DEG;
        b.ellipsoid(h.surface(dirOf(t, phi), out(t, phi, 0.9)), [0.022, 0.02, 0.02], onHead, 8, 6);
      }
      for (const [t, phi] of [[0.5, 0.5], [-0.6, 0.55], [2.4, 0.75], [-2.2, 0.8], [3.1, 0.45], [1.4, 0.4], [-1.3, 0.45]] as const) {
        b.ellipsoid(h.surface(dirOf(t, phi), out(t, phi, 0.3)), [0.034, 0.03, 0.034], onHead, 9, 6);
      }
      break;
    }
    case 'hair.trancas': {
      // Tight cornrow ridges running front to back, then box braids down the back and over the ears, with beads.
      shell(
        b,
        h,
        {
          phiMax: hairline((t) => 56 * DEG + 2 * DEG * tri(t, 14 * DEG), 92 * DEG, 104 * DEG),
          outer: (t, _p, edge) => 1.05 + 0.01 * Math.sin(16 * t) - 0.015 * smooth(0.85, 1, edge),
        },
        64,
        10,
      );
      const tips: V3[] = [];
      for (let i = 0; i < 9; i++) tips.push(strand(b, h, Math.PI + (i - 4) * 17 * DEG, 100 * DEG, 0.3 - Math.abs(i - 4) * 0.012, 0.045, 0.0105, 0.2, 12));
      for (const t of [80, 96, -80, -96]) tips.push(strand(b, h, t * DEG, 90 * DEG, 0.16, 0.022, 0.0095, 0.2, 8));
      tips.forEach((p, i) => {
        if (i % 2 === 0) b.ellipsoid([p[0], p[1] + 0.022, p[2]], [0.011, 0.012, 0.011], { slot: Slot.HAIR_ACCENT, bones: ['Head'] }, 8, 5);
      });
      break;
    }
    case 'hair.dreads': {
      const pm = hairline((t) => 58 * DEG + 5 * DEG * tri(t, 18 * DEG), 90 * DEG, 104 * DEG);
      shell(b, h, { phiMax: pm, outer: (t, phi, edge) => 1.08 + 0.025 * Math.sin(6 * t + 0.7) * Math.sin(5 * phi) - 0.03 * smooth(0.85, 1, edge) }, 40, 11);
      // Thick locs all around (the face stays clear) and a second, longer row at the back.
      for (let i = 0; i < 16; i++) {
        const t = -Math.PI + ((i + 0.5) * 2 * Math.PI) / 16;
        if (Math.abs(t) < 45 * DEG) continue;
        strand(b, h, t, pm(t) - 12 * DEG, Math.abs(t) > 120 * DEG ? 0.2 : 0.15, 0.035, 0.018, 0.15, 7, 7);
      }
      for (let i = 0; i < 5; i++) strand(b, h, Math.PI + (i - 2) * 22 * DEG + 11 * DEG, 88 * DEG, 0.24, 0.05, 0.017, 0.15, 8, 7);
      break;
    }
    case 'hair.liso': {
      // Curtain fringe parted in the middle, a long straight sheet down the back, locks framing the face.
      shell(
        b,
        h,
        {
          phiMax: hairline((t) => 64 * DEG + 12 * DEG * smooth(0, 38 * DEG, Math.abs(t)) + 2 * DEG * tri(t, 9 * DEG), 118 * DEG, 120 * DEG, 38 * DEG, 70 * DEG),
          outer: (_t, phi, edge) => 1.09 + 0.05 * smooth(60 * DEG, 110 * DEG, phi) - 0.045 * smooth(0.85, 1, edge),
        },
        40,
        12,
      );
      b.tube(
        [
          { p: P(0, 0.0, -0.105), ra: 0.118, rb: 0.055, n: 2.6 },
          { p: P(0, -0.1, -0.13), ra: 0.122, rb: 0.04, n: 2.8 },
          { p: P(0, -0.22, -0.15), ra: 0.124, rb: 0.03, n: 3 },
          { p: P(0, -0.33, -0.158), ra: 0.115, rb: 0.024, n: 3 },
        ],
        { ...onHead, ref: [1, 0, 0], segments: 16, capStart: 'flat', capEnd: 'round', capScale: 0.4 },
      );
      for (const sx of [1, -1]) {
        b.tube(
          [
            { p: P(sx * 0.118, 0.02, 0.03), ra: 0.03, rb: 0.02 },
            { p: P(sx * 0.13, -0.06, 0.035), ra: 0.032, rb: 0.018 },
            { p: P(sx * 0.135, -0.14, 0.03), ra: 0.026, rb: 0.014 },
            { p: P(sx * 0.13, -0.17, 0.025), ra: 0.012, rb: 0.008 },
          ],
          { ...onHead, ref: [0, 0, 1], segments: 10, capStart: 'flat', capEnd: 'round' },
        );
      }
      break;
    }
    case 'hair.chiquinha': {
      shell(b, h, {
        phiMax: hairline((t) => 60 * DEG + 3 * DEG * tri(t, 8 * DEG), 96 * DEG, 104 * DEG),
        outer: (_t, _p, edge) => 1.075 - 0.02 * smooth(0.85, 1, edge),
      });
      for (const sx of [1, -1]) {
        b.ellipsoid(P(sx * 0.13, 0.045, -0.03), [0.022, 0.028, 0.028], { slot: Slot.HAIR_ACCENT, bones: ['Head'] }, 10, 6);
        b.tube(
          [
            { p: P(sx * 0.125, 0.05, -0.03), ra: 0.03, rb: 0.03 },
            { p: P(sx * 0.165, 0.035, -0.04), ra: 0.038, rb: 0.036 },
            { p: P(sx * 0.195, -0.03, -0.045), ra: 0.036, rb: 0.034 },
            { p: P(sx * 0.2, -0.1, -0.04), ra: 0.026, rb: 0.024 },
            { p: P(sx * 0.19, -0.15, -0.032), ra: 0.008, rb: 0.008 },
          ],
          { ...onHead, ref: [0, 0, 1], segments: 10, capStart: 'round', capEnd: 'flat' },
        );
      }
      break;
    }
    case 'hair.coque': {
      // Combed back (streaks along the meridians) into a top bun.
      shell(
        b,
        h,
        {
          phiMax: hairline((t) => 58 * DEG + 1.5 * DEG * tri(t, 10 * DEG), 90 * DEG, 100 * DEG),
          outer: (t, _p, edge) => 1.055 + 0.006 * Math.sin(12 * t) - 0.015 * smooth(0.85, 1, edge),
        },
        48,
        11,
      );
      if (!covered) {
        b.ellipsoid(P(0, 0.178, -0.035), [0.068, 0.056, 0.066], onHead, 14, 9);
        b.ellipsoid(P(0, 0.15, -0.033), [0.05, 0.014, 0.05], { slot: Slot.HAIR_ACCENT, bones: ['Head'] }, 12, 6);
      }
      break;
    }
    case 'hair.moicano': {
      // Shaved sides (a thin shell in the hair color) and a spiky crest along the midline.
      shell(b, h, { phiMax: hairline(() => 54 * DEG, 88 * DEG, 104 * DEG), outer: (_t, _p, edge) => 1.024 - 0.006 * smooth(0.85, 1, edge) }, 32, 9);
      if (!covered) {
        const ridge: RingSpec[] = [];
        for (let i = 0; i <= 10; i++) {
          const a = -0.75 + (i / 10) * 2.6;
          ridge.push({ p: h.surface(new THREE.Vector3(0, Math.cos(a), -Math.sin(a)), 1.06), ra: 0.028, rb: 0.022 });
        }
        b.tube(ridge, { ...onHead, ref: [1, 0, 0], segments: 10, capStart: 'round', capEnd: 'round' });
        for (let i = 0; i < 7; i++) {
          const a = -0.6 + i * 0.35;
          const len = 0.07 + 0.025 * Math.sin((i / 6) * Math.PI);
          if (a < 0) tuft(b, h, 0, -a, len, 0.042, -0.25, 1.07);
          else tuft(b, h, Math.PI, a, len, 0.042, 0.25, 1.07);
        }
      }
      break;
    }
    case 'hair.raspado': {
      // "Na régua": a straight front line with sharp corners at the temples, very short all over.
      shell(
        b,
        h,
        {
          phiMax: (t) => {
            const a = Math.abs(t);
            if (a < 34 * DEG) return 52 * DEG;
            if (a < 40 * DEG) return 52 * DEG + 26 * DEG * smooth(34 * DEG, 40 * DEG, a);
            if (a < 75 * DEG) return 78 * DEG + 10 * DEG * smooth(40 * DEG, 75 * DEG, a);
            return 88 * DEG + 14 * DEG * smooth(90 * DEG, 150 * DEG, a);
          },
          outer: () => 1.026,
        },
        56,
        9,
      );
      break;
    }
    case 'hair.crop': {
      shell(b, h, {
        phiMax: (t) => {
          const a = Math.abs(t);
          const front = 50 * DEG + 7 * DEG * tri(t + 0.1, 11 * DEG);
          const side = 84 * DEG;
          const back = 100 * DEG;
          if (a < 40 * DEG) return front;
          if (a < 75 * DEG) return front + (side - front) * smooth(40 * DEG, 75 * DEG, a);
          return side + (back - side) * smooth(90 * DEG, 150 * DEG, a);
        },
        outer: (_t, phi, edge) => 1.075 + 0.02 * Math.sin(phi) - 0.025 * smooth(0.8, 1, edge),
      });
      tuft(b, h, 0.25, 0.35, 0.07, 0.04, 0.9, 1.07);
      tuft(b, h, -0.35, 0.42, 0.065, 0.038, 1.0, 1.07);
      tuft(b, h, 2.8, 0.55, 0.06, 0.04, 0.6, 1.07);
      break;
    }
    case 'hair.ponytail': {
      shell(b, h, {
        phiMax: (t) => {
          const a = Math.abs(t);
          // Side-swept fringe: longer on the character's right.
          const front = 52 * DEG + 14 * DEG * smooth(-0.8, 0.8, -t) + 4 * DEG * tri(t, 13 * DEG);
          const side = 88 * DEG;
          const back = 98 * DEG;
          if (a < 45 * DEG) return front;
          if (a < 80 * DEG) return front + (side - front) * smooth(45 * DEG, 80 * DEG, a);
          return side + (back - side) * smooth(90 * DEG, 150 * DEG, a);
        },
        outer: (_t, _p, edge) => 1.065 - 0.02 * smooth(0.85, 1, edge),
      });
      b.ellipsoid(P(0, 0.06, -0.125), [0.03, 0.026, 0.022], { slot: Slot.HAIR_ACCENT, bones: ['Head'] }, 10, 6);
      b.tube(
        [
          { p: P(0, 0.07, -0.13), ra: 0.042, rb: 0.036 },
          { p: P(0, 0.02, -0.17), ra: 0.046, rb: 0.04 },
          { p: P(0, -0.07, -0.19), ra: 0.038, rb: 0.033 },
          { p: P(0, -0.15, -0.18), ra: 0.024, rb: 0.022 },
          { p: P(0, -0.2, -0.165), ra: 0.008, rb: 0.008 },
        ],
        { slot: Slot.HAIR, bones: ['Head'], ref: [1, 0, 0], segments: 10, capStart: 'round', capEnd: 'flat' },
      );
      break;
    }
    case 'hair.buns': {
      shell(b, h, {
        phiMax: (t) => {
          const a = Math.abs(t);
          const front = 56 * DEG + 6 * DEG * tri(t, 9 * DEG);
          const side = 86 * DEG;
          const back = 102 * DEG;
          if (a < 40 * DEG) return front;
          if (a < 75 * DEG) return front + (side - front) * smooth(40 * DEG, 75 * DEG, a);
          return side + (back - side) * smooth(90 * DEG, 150 * DEG, a);
        },
        outer: (_t, _p, edge) => 1.06 - 0.02 * smooth(0.85, 1, edge),
      });
      for (const s of covered ? [] : [1, -1]) {
        b.ellipsoid([c[0] + s * 0.085, c[1] + 0.115, c[2] - 0.02], [0.058, 0.054, 0.056], { slot: Slot.HAIR, bones: ['Head'] }, 12, 8);
        b.ellipsoid([c[0] + s * 0.07, c[1] + 0.085, c[2] - 0.016], [0.034, 0.016, 0.034], { slot: Slot.HAIR_ACCENT, bones: ['Head'] }, 10, 6);
      }
      break;
    }
    case 'hair.bob':
    default: {
      shell(b, h, {
        phiMax: (t) => {
          const a = Math.abs(t);
          const front = 63 * DEG + 8 * DEG * tri(t + 0.05, 12 * DEG);
          const side = 112 * DEG;
          if (a < 42 * DEG) return front;
          if (a < 72 * DEG) return front + (side - front) * smooth(42 * DEG, 72 * DEG, a);
          return side - 4 * DEG * tri(t, 16 * DEG);
        },
        outer: (_t, phi, edge) => 1.1 + 0.075 * smooth(55 * DEG, 105 * DEG, phi) - 0.06 * smooth(0.82, 1, edge),
      });
      tuft(b, h, 2.6, 0.5, 0.055, 0.045, 0.7, 1.12);
      tuft(b, h, -2.9, 0.62, 0.05, 0.04, 0.6, 1.12);
      break;
    }
  }
}
