/**
 * Wind volumes (docs/gameplay/WIND_VOLUMES.md): the map's `winds`, resolved into world-space columns that the shared
 * CharacterMotor samples every airborne step — client prediction and the authoritative server run the same volumes
 * from the same data, so a client can never claim a wind that is not there. A column stands along the local up of its
 * centre (on a 100 m planet a 6 m-wide column barely leans against the up of its edge), from `base` m over the ground
 * under it to `base + height`; its force fades over the outer `edgeFade` of the radius and the top `topFade` of the
 * height, so riding out of one is never a jolt. Event winds (`trigger`) blow only while their bell rings
 * (interactives.ts), which the motor learns through `CharacterMotor.windActive`.
 */
import { TRAVERSAL, type MapWind } from '@graao/game-data';
import { v3, v3cross, v3dot, v3normalize, type Vec3 } from '@graao/shared';
import { headingTangent, latLonToDir } from './sphere';

export interface WindVolume {
  /** Index in the map's `winds` (stable on the wire: bells name the winds they wake by index). */
  index: number;
  id: string;
  kind: MapWind['kind'];
  /** Unit up at the centre (the column's axis) and the bottom centre of the column (world). */
  axis: Vec3;
  base: Vec3;
  height: number;
  radius: number;
  /** Directional winds: where they blow (unit tangent at the centre); null for updrafts. */
  dir: Vec3 | null;
  strength: number;
  /** Placement id of the bell that wakes it (null: always blowing). */
  trigger: string | null;
}

/** Minimal terrain needed to stand a column on the ground. */
export interface WindTerrain {
  heightAt(dir: Vec3): number;
}

export function resolveWinds(terrain: WindTerrain, winds: readonly MapWind[] = [], radius = 100): WindVolume[] {
  return winds.map((w, index) => {
    const axis = v3normalize(latLonToDir(w.lat, w.lon));
    const r = radius + terrain.heightAt(axis) + w.base;
    return {
      index,
      id: w.id,
      kind: w.kind,
      axis,
      base: { x: axis.x * r, y: axis.y * r, z: axis.z * r },
      height: w.height,
      radius: w.radius,
      dir: w.kind === 'directional' ? headingTangent(axis, w.yaw ?? 0) : null,
      strength: w.strength,
      trigger: w.trigger ?? null,
    };
  });
}

/** What the wind does at a point: the strongest updraft's rise speed and the strongest directional wind. */
export interface WindSample {
  /** Rise speed a glider is lifted toward (m/s, faded); 0 outside every updraft. */
  lift: number;
  /** Speed a directional wind carries toward along `dir` (m/s, faded); 0 when none. */
  push: number;
  /** Direction of `push`, on the tangent plane of `up` (unit). */
  dir: Vec3;
}

/** How far into a volume `pos` is (1 well inside … 0 at or past its edges). */
export function windFade(v: WindVolume, pos: Vec3): number {
  const dx = pos.x - v.base.x;
  const dy = pos.y - v.base.y;
  const dz = pos.z - v.base.z;
  const along = dx * v.axis.x + dy * v.axis.y + dz * v.axis.z;
  if (along < 0 || along > v.height) return 0;
  const ox = dx - v.axis.x * along;
  const oy = dy - v.axis.y * along;
  const oz = dz - v.axis.z * along;
  const off = Math.hypot(ox, oy, oz);
  if (off > v.radius) return 0;
  const w = TRAVERSAL.wind;
  const edge = Math.min(1, (v.radius - off) / Math.max(1e-6, v.radius * w.edgeFade));
  const top = Math.min(1, (v.height - along) / Math.max(1e-6, v.height * w.topFade));
  return edge * top;
}

const tmpDir = v3();

/**
 * Samples the wind at `pos` (local up `up`): `active(i)` says whether event wind `i` blows now (always-on winds need no
 * answer). Fills and returns `out`.
 */
export function sampleWind(vols: readonly WindVolume[], active: (index: number) => boolean, pos: Vec3, up: Vec3, out: WindSample): WindSample {
  out.lift = 0;
  out.push = 0;
  for (const v of vols) {
    if (v.trigger !== null && !active(v.index)) continue;
    const f = windFade(v, pos);
    if (f <= 0) continue;
    if (v.kind === 'updraft') out.lift = Math.max(out.lift, v.strength * f);
    else if (v.strength * f > out.push && v.dir) {
      // The wind's direction carried to this point's tangent plane.
      const k = v3dot(v.dir, up);
      tmpDir.x = v.dir.x - up.x * k;
      tmpDir.y = v.dir.y - up.y * k;
      tmpDir.z = v.dir.z - up.z * k;
      const l = Math.hypot(tmpDir.x, tmpDir.y, tmpDir.z);
      if (l < 1e-6) continue;
      out.push = v.strength * f;
      out.dir.x = tmpDir.x / l;
      out.dir.y = tmpDir.y / l;
      out.dir.z = tmpDir.z / l;
    }
  }
  return out;
}

export const newWindSample = (): WindSample => ({ lift: 0, push: 0, dir: v3() });

/** Right-hand side of a directional wind at its centre (editor and VFX: the column's cross axis). */
export function windSide(v: WindVolume): Vec3 {
  return v.dir ? v3normalize(v3cross(v.axis, v.dir)) : v3normalize(v3cross(v.axis, headingTangent(v.axis, 0)));
}
