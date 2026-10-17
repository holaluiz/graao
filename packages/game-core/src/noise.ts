/**
 * Deterministic 3D gradient noise (improved Perlin) with a seeded permutation. Uses only +, *, floor so client and
 * server compute bit-identical terrain.
 */
import { mulberry32 } from './rng';

const GRAD = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
] as const;

export interface Noise3 {
  (x: number, y: number, z: number): number;
}

export function createNoise3(seed: number): Noise3 {
  const rand = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = p[i]!;
    p[i] = p[j]!;
    p[j] = t;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]!;

  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const dot = (g: number, x: number, y: number, z: number) => {
    const v = GRAD[g % 12]!;
    return v[0] * x + v[1] * y + v[2] * z;
  };

  return (x: number, y: number, z: number): number => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const zi = Math.floor(z);
    const X = xi & 255;
    const Y = yi & 255;
    const Z = zi & 255;
    const xf = x - xi;
    const yf = y - yi;
    const zf = z - zi;
    const u = fade(xf);
    const v = fade(yf);
    const w = fade(zf);
    const A = perm[X]! + Y;
    const AA = perm[A]! + Z;
    const AB = perm[A + 1]! + Z;
    const B = perm[X + 1]! + Y;
    const BA = perm[B]! + Z;
    const BB = perm[B + 1]! + Z;
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    return lerp(
      lerp(
        lerp(dot(perm[AA]!, xf, yf, zf), dot(perm[BA]!, xf - 1, yf, zf), u),
        lerp(dot(perm[AB]!, xf, yf - 1, zf), dot(perm[BB]!, xf - 1, yf - 1, zf), u),
        v,
      ),
      lerp(
        lerp(dot(perm[AA + 1]!, xf, yf, zf - 1), dot(perm[BA + 1]!, xf - 1, yf, zf - 1), u),
        lerp(dot(perm[AB + 1]!, xf, yf - 1, zf - 1), dot(perm[BB + 1]!, xf - 1, yf - 1, zf - 1), u),
        v,
      ),
      w,
    );
  };
}

/** Fractal sum of `octaves` layers, roughly in [-1, 1]. */
export function fbm3(n: Noise3, x: number, y: number, z: number, octaves: number, lacunarity = 2.03, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * n(x * f + o * 17.1, y * f - o * 9.3, z * f + o * 3.7);
    norm += amp;
    amp *= gain;
    f *= lacunarity;
  }
  return sum / norm;
}
