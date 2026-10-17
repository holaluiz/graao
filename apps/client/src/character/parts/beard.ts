/**
 * Facial hair in the hair color, rigid on the Head bone. The mustache is a tube laid on the face; full beards are thin
 * slabs over the jaw that leave the mouth decal visible. Stubble is a flat, ink-free film in a skin-tinted hair color.
 */
import type { HeadShape } from '../build/anatomy';
import { PartBuilder, Slot, type RingSpec, type SlotId, type V3 } from '../build/PartBuilder';
import { dirOf } from './hair';

const DEG = Math.PI / 180;
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Tube along the face through (u, v) points (head-local face coordinates), lifted `lift` off the skin. */
function faceTube(b: PartBuilder, h: HeadShape, pts: [number, number, number][], lift: number, depth: number): void {
  const rings: RingSpec[] = [];
  for (const [u, v, r] of pts) {
    const f = h.frontPoint(u, v, lift);
    if (f) rings.push({ p: f.p, ra: r, rb: depth });
  }
  if (rings.length >= 2) b.tube(rings, { slot: Slot.HAIR, bones: ['Head'], ref: [0, 1, 0], segments: 8, outline: 0.6 });
}

function mustache(b: PartBuilder, h: HeadShape): void {
  faceTube(
    b,
    h,
    [
      [-0.038, -0.064, 0.0045],
      [-0.024, -0.055, 0.0075],
      [-0.008, -0.051, 0.0085],
      [0.008, -0.051, 0.0085],
      [0.024, -0.055, 0.0075],
      [0.038, -0.064, 0.0045],
    ],
    0.004,
    0.0055,
  );
}

/** Slab over the lower face: from `top(θ)` (just under the mouth in front, ear level at the sides) to under the jaw. */
function jaw(b: PartBuilder, h: HeadShape, slot: SlotId, scale: (edge: number) => number, t: number, outline: number): void {
  const top = (th: number) => {
    const a = Math.abs(th);
    return 121 * DEG + (93 - 121) * DEG * smooth(22 * DEG, 62 * DEG, a);
  };
  const bottom = (th: number) => 158 * DEG + (128 - 158) * DEG * smooth(20 * DEG, 90 * DEG, Math.abs(th));
  const cols = 26;
  const rows = 8;
  const grid: V3[][] = [];
  for (let i = 0; i < rows; i++) {
    const row: V3[] = [];
    const v = i / (rows - 1);
    for (let j = 0; j < cols; j++) {
      const u = j / (cols - 1);
      const th = (-100 + 200 * u) * DEG;
      const phi = top(th) + (bottom(th) - top(th)) * v;
      // Fuller in the middle of the patch, flush at its borders.
      const edge = Math.min(1, 4 * Math.min(u, 1 - u), 3 * Math.min(v, 1 - v));
      row.push(h.surface(dirOf(th, phi), scale(edge)));
    }
    grid.push(row);
  }
  b.slab(grid, t, { slot, bones: ['Head'], outline });
}

export function buildBeard(b: PartBuilder, h: HeadShape, beardId: string): void {
  switch (beardId) {
    case 'beard.bigode':
      mustache(b, h);
      break;
    case 'beard.cavanhaque': {
      mustache(b, h);
      // Lines from the mustache tips down to a goatee on the chin.
      for (const s of [1, -1]) {
        faceTube(
          b,
          h,
          [
            [s * 0.037, -0.064, 0.004],
            [s * 0.033, -0.082, 0.0042],
            [s * 0.022, -0.1, 0.0045],
          ],
          0.004,
          0.004,
        );
      }
      const chin = h.frontPoint(0, -0.103, 0.006);
      if (chin) b.ellipsoid(chin.p, [0.022, 0.02, 0.011], { slot: Slot.HAIR, bones: ['Head'], outline: 0.6 }, 10, 6);
      break;
    }
    case 'beard.cheia':
      mustache(b, h);
      jaw(b, h, Slot.HAIR, (e) => 1.012 + 0.028 * e, 0.024, 0.8);
      break;
    case 'beard.porfazer':
      jaw(b, h, Slot.STUBBLE, () => 1.004, 0.004, 0);
      break;
    default:
      break;
  }
}
