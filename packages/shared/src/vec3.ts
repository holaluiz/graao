/**
 * Minimal allocation-light 3D vector helpers shared by client and server. Gameplay code never assumes global Y is up:
 * on the spherical world "up" is always `normalize(position - planetCenter)`.
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const v3copy = (a: Vec3): Vec3 => ({ x: a.x, y: a.y, z: a.z });
export const v3set = (out: Vec3, x: number, y: number, z: number): Vec3 => {
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
};
export const v3assign = (out: Vec3, a: Vec3): Vec3 => v3set(out, a.x, a.y, a.z);
export const v3add = (a: Vec3, b: Vec3, out: Vec3 = v3()): Vec3 => v3set(out, a.x + b.x, a.y + b.y, a.z + b.z);
export const v3sub = (a: Vec3, b: Vec3, out: Vec3 = v3()): Vec3 => v3set(out, a.x - b.x, a.y - b.y, a.z - b.z);
export const v3scale = (a: Vec3, s: number, out: Vec3 = v3()): Vec3 => v3set(out, a.x * s, a.y * s, a.z * s);
export const v3addScaled = (a: Vec3, b: Vec3, s: number, out: Vec3 = v3()): Vec3 =>
  v3set(out, a.x + b.x * s, a.y + b.y * s, a.z + b.z * s);
export const v3dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const v3cross = (a: Vec3, b: Vec3, out: Vec3 = v3()): Vec3 =>
  v3set(out, a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const v3len = (a: Vec3): number => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
export const v3lenSq = (a: Vec3): number => a.x * a.x + a.y * a.y + a.z * a.z;
export const v3dist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const v3normalize = (a: Vec3, out: Vec3 = v3()): Vec3 => {
  const l = v3len(a);
  return l > 1e-12 ? v3scale(a, 1 / l, out) : v3set(out, 0, 0, 0);
};
export const v3lerp = (a: Vec3, b: Vec3, t: number, out: Vec3 = v3()): Vec3 =>
  v3set(out, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
export const v3isFinite = (a: Vec3): boolean => Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z);

/** Removes the component of `v` along unit vector `n`. */
export const v3projectOnPlane = (v: Vec3, n: Vec3, out: Vec3 = v3()): Vec3 => {
  const d = v3dot(v, n);
  return v3set(out, v.x - n.x * d, v.y - n.y * d, v.z - n.z * d);
};

/** Rotates `v` around unit `axis` by `angle` radians (Rodrigues). */
export const v3rotateAxis = (v: Vec3, axis: Vec3, angle: number, out: Vec3 = v3()): Vec3 => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const d = v3dot(axis, v) * (1 - c);
  const cx = axis.y * v.z - axis.z * v.y;
  const cy = axis.z * v.x - axis.x * v.z;
  const cz = axis.x * v.y - axis.y * v.x;
  return v3set(out, v.x * c + cx * s + axis.x * d, v.y * c + cy * s + axis.y * d, v.z * c + cz * s + axis.z * d);
};

/** Angle between two unit vectors, robust near 0 and pi. */
export const v3angle = (a: Vec3, b: Vec3): number => {
  const cx = a.y * b.z - a.z * b.y;
  const cy = a.z * b.x - a.x * b.z;
  const cz = a.x * b.y - a.y * b.x;
  return Math.atan2(Math.sqrt(cx * cx + cy * cy + cz * cz), v3dot(a, b));
};
