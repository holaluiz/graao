/**
 * Spherical-world math. The planet center is the origin; for any entity `localUp = normalize(position)` and gravity
 * points along `-localUp`. Nothing here assumes global Y is up.
 */
import {
  v3,
  v3angle,
  v3cross,
  v3dot,
  v3len,
  v3normalize,
  v3projectOnPlane,
  v3rotateAxis,
  v3set,
  type Vec3,
} from '@graao/shared';

const DEG = Math.PI / 180;

/** lat/lon in degrees → unit direction. lat 0 lon 0 = +Z, north pole = +Y. */
export function latLonToDir(latDeg: number, lonDeg: number, out: Vec3 = v3()): Vec3 {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  const c = Math.cos(lat);
  return v3set(out, c * Math.sin(lon), Math.sin(lat), c * Math.cos(lon));
}

export function dirToLatLon(d: Vec3): { lat: number; lon: number } {
  const n = v3normalize(d);
  return { lat: Math.asin(Math.max(-1, Math.min(1, n.y))) / DEG, lon: Math.atan2(n.x, n.z) / DEG };
}

export const localUp = (p: Vec3, out: Vec3 = v3()): Vec3 => v3normalize(p, out);

/** Angular (great-circle) distance between two directions, radians. */
export const angularDistance = (a: Vec3, b: Vec3): number => v3angle(v3normalize(a), v3normalize(b));

/** Geodesic surface distance between two points at planet radius `r`. */
export const geodesicDistance = (a: Vec3, b: Vec3, r: number): number => angularDistance(a, b) * r;

/** A stable tangent pointing "north" (toward +Y) at `up`; falls back to +Z near the poles. */
export function northTangent(up: Vec3, out: Vec3 = v3()): Vec3 {
  v3projectOnPlane({ x: 0, y: 1, z: 0 }, up, out);
  if (v3len(out) < 1e-4) v3projectOnPlane({ x: 0, y: 0, z: 1 }, up, out);
  return v3normalize(out, out);
}

/** Tangent heading `yawDeg` clockwise-from-north seen from above (rotation about `up`). */
export function headingTangent(up: Vec3, yawDeg: number, out: Vec3 = v3()): Vec3 {
  northTangent(up, out);
  return v3rotateAxis(out, up, -yawDeg * DEG, out);
}

/**
 * Parallel-transports a tangent vector from the plane of `fromUp` to the plane of `toUp` with the minimal rotation,
 * then re-orthonormalizes. This is what keeps character and camera headings stable over a full lap of the planet
 * (no global reference, no pole singularity).
 */
export function transportTangent(t: Vec3, fromUp: Vec3, toUp: Vec3, out: Vec3 = v3()): Vec3 {
  const axis = v3cross(fromUp, toUp);
  const s = v3len(axis);
  const c = v3dot(fromUp, toUp);
  if (s > 1e-9) {
    v3scaleInPlace(axis, 1 / s);
    v3rotateAxis(t, axis, Math.atan2(s, c), out);
  } else {
    v3set(out, t.x, t.y, t.z);
  }
  v3projectOnPlane(out, toUp, out);
  const l = v3len(out);
  if (l < 1e-6) return northTangent(toUp, out);
  return v3set(out, out.x / l, out.y / l, out.z / l);
}

function v3scaleInPlace(a: Vec3, s: number): void {
  a.x *= s;
  a.y *= s;
  a.z *= s;
}

/** Horizon distance (m) along the surface for an eye at height `h` over a sphere of radius `r`. */
export const horizonDistance = (r: number, h: number): number => Math.sqrt(2 * r * h + h * h);
