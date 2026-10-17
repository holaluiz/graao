/**
 * Hair as chunky closed shells over the head surface (a few big shapes, never strands), rigid on the Head bone.
 * The hairline is a function φmax(θ) (polar angle from the crown vs. azimuth from the face) with jagged fringe tips.
 */
import * as THREE from 'three';
import type { HeadShape } from '../build/anatomy';
import { PartBuilder, Slot, type V3 } from '../build/PartBuilder';

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

interface ShellStyle {
  /** Hairline: polar angle (radians from the crown) as a function of azimuth θ (0 = face). */
  phiMax(theta: number): number;
  /** Outer shell scale relative to the skull. */
  outer(theta: number, phi: number, edge: number): number;
}

function shell(b: PartBuilder, h: HeadShape, style: ShellStyle, nu = 36, nv = 11): void {
  b.begin({ slot: Slot.HAIR, region: 'none', bones: ['Head'] });
  const d = new THREE.Vector3();
  const at = (theta: number, phi: number, scale: number): V3 => {
    d.set(Math.sin(phi) * Math.sin(theta), Math.cos(phi), Math.sin(phi) * Math.cos(theta));
    return h.surface(d, scale);
  };
  const topOut = b.vertex(...at(0, 0, style.outer(0, 0, 0)));
  const topIn = b.vertex(...at(0, 0, 1.015));
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
      rowO.push(b.vertex(...at(theta, phi, style.outer(theta, phi, edge))));
      rowI.push(b.vertex(...at(theta, phi, 1.015)));
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

export function buildHair(b: PartBuilder, h: HeadShape, hairId: string): void {
  switch (hairId) {
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
      const c = h.center;
      const P = (x: number, y: number, z: number): V3 => [c[0] + x, c[1] + y, c[2] + z];
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
      const c = h.center;
      for (const s of [1, -1]) {
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
