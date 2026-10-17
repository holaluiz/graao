/**
 * GRAVFXSystem: graao's small effect toolkit (not a Niagara). Three pooled GPU primitives, one draw call each:
 *
 *   - Beams: camera-facing ribbons between two points (tracers, ability lanes) with a travelling bright head, or a
 *     plain fading Trail (projectile wakes, dash streaks). Fade and thin over life.
 *   - Particles: billboards with drag and radial gravity, animated entirely in the vertex shader (muzzle flashes,
 *     impact puffs, shield shards, petals, rings, projectile cores).
 *   - Ground decals: discs laid on the terrain (a small grid conformed to the height field when spawned) for ability
 *     telegraphs (dashed rotating rim + filling disc), Shockwaves (expanding ring) and pigment splashes.
 *
 * Plus PersistentMark objects (Ultimate Marks, see UltimateMarks.ts): two meshes per marked player.
 *
 * Spawning writes one slot of a ring buffer; nothing is allocated per effect and no Object3D is created.
 * Categories decide what quality levels may drop: GameplayCritical and PersistentMark effects are never reduced.
 */
import * as THREE from 'three';
import type { UltimateMarkId } from '@graao/game-data';
import type { Vec3 } from '@graao/shared';
import type { Quality } from '../GRARenderer';
import { UltimateMark } from './UltimateMarks';

export type VFXCategory = 'GameplayCritical' | 'CombatBurst' | 'PersistentMark' | 'Environment' | 'CinematicOnly' | 'DeploymentTrail';

/** Particle shapes (fragment SDF). */
export const Shape = { DOT: 0, SPARK: 1, RING: 2, PETAL: 3, SHARD: 4 } as const;
export type Shape = (typeof Shape)[keyof typeof Shape];

const QUALITY_SCALE: Record<Quality, number> = { LOW: 0.45, MEDIUM: 0.75, HIGH: 1 };

// ------------------------------------------------------------------------------------------------ beams

const BEAM_VERTEX = /* glsl */ `
attribute vec3 aStart;
attribute vec3 aEnd;
attribute vec3 aColor;
attribute vec3 aTime; // birth, life, width
uniform float uTime;
varying vec2 vUv;
varying vec3 vColor;
varying float vAge;
varying float vTrail;
#include <fog_pars_vertex>
void main() {
  float age = (uTime - aTime.x) / aTime.y;
  vAge = age;
  vUv = uv;
  vColor = aColor;
  vec3 p = mix(aStart, aEnd, uv.x);
  vec3 axis = aEnd - aStart;
  float len = length(axis);
  axis = len > 1e-5 ? axis / len : vec3(0.0, 1.0, 0.0);
  vec3 side = normalize(cross(axis, normalize(cameraPosition - p)) + 1e-6);
  // Negative width = trail style (no travelling head, thins to nothing).
  float w = abs(aTime.z) * (1.0 - (aTime.z < 0.0 ? 0.9 : 0.65) * clamp(age, 0.0, 1.0));
  vTrail = aTime.z < 0.0 ? 1.0 : 0.0;
  p += side * (uv.y - 0.5) * w;
  // Dead or unborn slots collapse to a point (zero-area triangles).
  if (age < 0.0 || age > 1.0) p = vec3(0.0);
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const BEAM_FRAGMENT = /* glsl */ `
varying vec2 vUv;
varying vec3 vColor;
varying float vAge;
varying float vTrail;
#include <fog_pars_fragment>
void main() {
  float across = 1.0 - abs(vUv.y - 0.5) * 2.0;
  float core = smoothstep(0.55, 0.95, across);
  // A bright head travels along the beam in the first part of its life (tracers); trails have none.
  float head = (1.0 - vTrail) * (1.0 - smoothstep(0.0, 0.18, abs(vUv.x - clamp(vAge * 2.6, 0.0, 1.0))));
  float fade = pow(1.0 - clamp(vAge, 0.0, 1.0), 1.4);
  float a = smoothstep(0.0, 0.35, across) * fade * (0.55 + head * 0.45);
  // Soft ends so the ribbon never shows a hard cut at the muzzle or the impact.
  a *= smoothstep(0.0, 0.04, vUv.x) * (1.0 - smoothstep(0.97, 1.0, vUv.x));
  vec3 col = mix(vColor, vec3(1.0, 0.98, 0.92), core * 0.75 + head * 0.25);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

// ------------------------------------------------------------------------------------------------ particles

const PARTICLE_VERTEX = /* glsl */ `
attribute vec3 aPos;
attribute vec3 aVel;
attribute vec3 aColor;
attribute vec4 aParams; // birth, life, size, gravity
attribute vec2 aShape;  // shape, drag
uniform float uTime;
varying vec2 vUv;
varying vec3 vColor;
varying float vAge;
varying float vShape;
#include <fog_pars_vertex>
void main() {
  float t = uTime - aParams.x;
  float age = t / aParams.y;
  vAge = age;
  vUv = uv;
  vColor = aColor;
  vShape = aShape.x;
  float k = max(aShape.y, 0.001);
  vec3 up = normalize(aPos);
  float travel = (1.0 - exp(-k * t)) / k;
  vec3 c = aPos + aVel * travel - up * (0.5 * aParams.w * t * t);
  float size = aParams.z;
  int shape = int(aShape.x + 0.5);
  if (shape == 2) size *= 0.35 + age * 1.65;          // rings expand
  else size *= mix(1.0, 0.25, age * age);              // everything else shrinks
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 p;
  if (shape == 1 || shape == 4) {
    // Sparks and shards stretch along their current velocity.
    vec3 v = aVel * exp(-k * t) - up * aParams.w * t;
    float sp = length(v);
    vec3 axis = sp > 1e-4 ? v / sp : camUp;
    vec3 side = normalize(cross(axis, normalize(cameraPosition - c)) + 1e-6);
    float stretch = shape == 1 ? 1.0 + min(sp * 0.12, 3.5) : 1.4;
    p = c + axis * (uv.y - 0.5) * size * stretch + side * (uv.x - 0.5) * size * (shape == 1 ? 0.35 : 0.8);
  } else {
    p = c + (camRight * (uv.x - 0.5) + camUp * (uv.y - 0.5)) * size;
  }
  if (age < 0.0 || age > 1.0) p = vec3(0.0);
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const PARTICLE_FRAGMENT = /* glsl */ `
varying vec2 vUv;
varying vec3 vColor;
varying float vAge;
varying float vShape;
#include <fog_pars_fragment>
void main() {
  vec2 q = vUv - 0.5;
  float r = length(q) * 2.0;
  int shape = int(vShape + 0.5);
  float a;
  if (shape == 2) a = 1.0 - smoothstep(0.08, 0.16, abs(r - 0.78));             // ring
  else if (shape == 3) {                                                      // petal: pointed ellipse
    vec2 e = vec2(q.x * 2.4, q.y * 1.15);
    a = 1.0 - smoothstep(0.42, 0.5, length(e) + abs(q.y) * 0.25);
  } else if (shape == 4) a = 1.0 - smoothstep(0.85, 1.0, abs(q.x) * 2.0 + abs(q.y) * 1.2); // shard: diamond
  else if (shape == 1) a = 1.0 - smoothstep(0.6, 1.0, r);                     // spark
  else a = 1.0 - smoothstep(0.55, 1.0, r);                                    // soft dot
  float fade = 1.0 - smoothstep(0.55, 1.0, vAge);
  vec3 col = mix(vec3(1.0, 0.98, 0.9), vColor, smoothstep(0.0, 0.25, vAge) * 0.85 + 0.15);
  if (a * fade < 0.01) discard;
  gl_FragColor = vec4(col, a * fade);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

// ------------------------------------------------------------------------------------------------ ground decals

const DECAL_VERTEX = /* glsl */ `
attribute vec3 aColor;
attribute vec4 aDecal; // birth, life, mode, seed
uniform float uTime;
varying vec2 vUv;
varying vec3 vColor;
varying float vAge;
varying float vMode;
varying float vSeed;
#include <fog_pars_vertex>
void main() {
  float age = (uTime - aDecal.x) / aDecal.y;
  vAge = age;
  vUv = uv;
  vColor = aColor;
  vMode = aDecal.z;
  vSeed = aDecal.w;
  vec3 p = position;
  if (age < 0.0 || age > 1.0) p = vec3(0.0);
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const DECAL_FRAGMENT = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying vec3 vColor;
varying float vAge;
varying float vMode;
varying float vSeed;
#include <fog_pars_fragment>
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  float ang = atan(vUv.y, vUv.x);
  float age = clamp(vAge, 0.0, 1.0);
  int mode = int(vMode + 0.5);
  float a = 0.0;
  vec3 col = vColor;
  if (mode <= 1) {
    // Telegraph: rim + a disc filling from the centre to the rim exactly when the effect lands.
    float rim = smoothstep(0.86, 0.9, r) * (1.0 - smoothstep(0.965, 1.0, r));
    float fill = 1.0 - smoothstep(age - 0.02, age, r);
    float front = smoothstep(age - 0.07, age, r) * (1.0 - smoothstep(age, age + 0.02, r));
    if (mode == 0) {
      // Someone else's: dashed rotating rim and an inner ring (shape, not only color).
      float dashes = step(0.42, fract(ang / 6.28318 * 16.0 + uTime * 0.45));
      float inner = smoothstep(0.66, 0.69, r) * (1.0 - smoothstep(0.71, 0.74, r));
      a = rim * (0.45 + 0.55 * dashes) + inner * 0.55 + fill * 0.2 + front * 0.65 + 0.07;
    } else {
      // Mine: a calm solid rim.
      a = rim * 0.5 + fill * 0.12 + front * 0.35 + 0.03;
    }
    a *= smoothstep(0.0, 0.06, age) * (1.0 + smoothstep(0.82, 1.0, age) * 0.7);
    col = mix(vColor, vec3(1.0, 0.98, 0.92), front * 0.55 + rim * 0.15);
  } else if (mode == 2) {
    // Shockwave: a ring racing to the rim.
    float rr = 0.12 + 0.88 * (1.0 - pow(1.0 - age, 2.6));
    float w = 0.13 * (1.0 - age) + 0.03;
    a = (1.0 - smoothstep(0.0, w, abs(r - rr))) * (1.0 - age) * 0.95;
    col = mix(vec3(1.0, 0.98, 0.92), vColor, smoothstep(0.0, 0.5, age));
  } else {
    // Pigment splash: a soft blotch with a wobbly edge that fades in its second half.
    float n = sin(ang * 7.0 + vSeed) * 0.07 + sin(ang * 13.0 - vSeed * 2.0) * 0.035;
    a = (1.0 - smoothstep(0.5 + n, 0.82 + n, r)) * 0.55 * (1.0 - smoothstep(0.45, 1.0, age)) * smoothstep(0.0, 0.05, age);
  }
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, min(a, 1.0));
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** GroundDecal modes. */
export const DecalMode = { TELEGRAPH_ENEMY: 0, TELEGRAPH_OWN: 1, SHOCKWAVE: 2, SPLASH: 3 } as const;
export type DecalMode = (typeof DecalMode)[keyof typeof DecalMode];

/** Grid resolution of one decal (vertices per side). */
const DECAL_GRID = 11;

function quadGeometry(): THREE.InstancedBufferGeometry {
  const plane = new THREE.PlaneGeometry(1, 1, 1, 1);
  plane.translate(0.5, 0.5, 0); // uv == position.xy in [0,1]
  const g = new THREE.InstancedBufferGeometry();
  g.index = plane.index;
  g.setAttribute('position', plane.getAttribute('position'));
  g.setAttribute('uv', plane.getAttribute('uv'));
  return g;
}

function inst(g: THREE.InstancedBufferGeometry, name: string, n: number, size: number): THREE.InstancedBufferAttribute {
  const a = new THREE.InstancedBufferAttribute(new Float32Array(n * size), size);
  a.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute(name, a);
  return a;
}

export interface BurstOptions {
  color: THREE.ColorRepresentation;
  count: number;
  /** Initial speed (m/s) and its random fraction. */
  speed: number;
  speedJitter?: number;
  size: number;
  sizeJitter?: number;
  life: number;
  /** Radial gravity (m/s², toward the planet centre). */
  gravity?: number;
  drag?: number;
  shape?: Shape;
  /** Cone half-angle (rad) around `dir`; π = sphere. */
  spread?: number;
  category?: VFXCategory;
}

export class GRAVFXSystem {
  readonly group = new THREE.Group();
  private readonly uniforms = { uTime: { value: 0 } };
  private time = 0;
  private scale: number;

  private readonly beamN = 192;
  private beamCursor = 0;
  private readonly beamGeo = quadGeometry();
  private readonly bStart: THREE.InstancedBufferAttribute;
  private readonly bEnd: THREE.InstancedBufferAttribute;
  private readonly bColor: THREE.InstancedBufferAttribute;
  private readonly bTime: THREE.InstancedBufferAttribute;
  private readonly beamExpiry: Float32Array;
  private beamDirty = false;

  private readonly partN = 1024;
  private partCursor = 0;
  private readonly partGeo = quadGeometry();
  private readonly pPos: THREE.InstancedBufferAttribute;
  private readonly pVel: THREE.InstancedBufferAttribute;
  private readonly pColor: THREE.InstancedBufferAttribute;
  private readonly pParams: THREE.InstancedBufferAttribute;
  private readonly pShape: THREE.InstancedBufferAttribute;
  private readonly partExpiry: Float32Array;
  private partDirty = false;

  private readonly decalN = 20;
  private decalCursor = 0;
  private readonly decalGeo = new THREE.BufferGeometry();
  private readonly dPos: THREE.BufferAttribute;
  private readonly dColor: THREE.BufferAttribute;
  private readonly dParams: THREE.BufferAttribute;
  private readonly decalExpiry: Float32Array;
  private decalDirty = false;
  /** Terrain surface for a direction (set by the app once the world exists). */
  private ground: ((dir: Vec3) => Vec3) | null = null;

  private readonly marks = new Set<UltimateMark>();

  private readonly tmpColor = new THREE.Color();
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly tmpC = new THREE.Vector3();

  constructor(quality: Quality) {
    this.scale = QUALITY_SCALE[quality];
    this.group.name = 'GRAVFX';

    this.bStart = inst(this.beamGeo, 'aStart', this.beamN, 3);
    this.bEnd = inst(this.beamGeo, 'aEnd', this.beamN, 3);
    this.bColor = inst(this.beamGeo, 'aColor', this.beamN, 3);
    this.bTime = inst(this.beamGeo, 'aTime', this.beamN, 3);
    this.beamGeo.instanceCount = this.beamN;
    this.beamExpiry = new Float32Array(this.beamN);
    // Unborn slots: birth far in the future.
    for (let i = 0; i < this.beamN; i++) this.bTime.setXYZ(i, 1e9, 1, 0);
    const beamMat = new THREE.ShaderMaterial({
      name: 'GRAVFX/Beam',
      vertexShader: BEAM_VERTEX,
      fragmentShader: BEAM_FRAGMENT,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });
    beamMat.uniforms.uTime = this.uniforms.uTime;
    const beams = new THREE.Mesh(this.beamGeo, beamMat);
    beams.frustumCulled = false;
    beams.renderOrder = 10;

    this.pPos = inst(this.partGeo, 'aPos', this.partN, 3);
    this.pVel = inst(this.partGeo, 'aVel', this.partN, 3);
    this.pColor = inst(this.partGeo, 'aColor', this.partN, 3);
    this.pParams = inst(this.partGeo, 'aParams', this.partN, 4);
    this.pShape = inst(this.partGeo, 'aShape', this.partN, 2);
    this.partGeo.instanceCount = this.partN;
    this.partExpiry = new Float32Array(this.partN);
    for (let i = 0; i < this.partN; i++) this.pParams.setXYZW(i, 1e9, 1, 0, 0);
    const partMat = new THREE.ShaderMaterial({
      name: 'GRAVFX/Particles',
      vertexShader: PARTICLE_VERTEX,
      fragmentShader: PARTICLE_FRAGMENT,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });
    partMat.uniforms.uTime = this.uniforms.uTime;
    const parts = new THREE.Mesh(this.partGeo, partMat);
    parts.frustumCulled = false;
    parts.renderOrder = 11;

    // Ground decals: N slots × a G×G grid, one draw call. Unused slots collapse in the vertex shader.
    const G = DECAL_GRID;
    const per = G * G;
    const total = per * this.decalN;
    this.dPos = new THREE.BufferAttribute(new Float32Array(total * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.dColor = new THREE.BufferAttribute(new Float32Array(total * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.dParams = new THREE.BufferAttribute(new Float32Array(total * 4), 4).setUsage(THREE.DynamicDrawUsage);
    const uvs = new Float32Array(total * 2);
    const index: number[] = [];
    for (let k = 0; k < this.decalN; k++) {
      for (let j = 0; j < G; j++)
        for (let i = 0; i < G; i++) {
          const v = k * per + j * G + i;
          uvs[v * 2] = (i / (G - 1)) * 2 - 1;
          uvs[v * 2 + 1] = (j / (G - 1)) * 2 - 1;
          this.dParams.setXYZW(v, 1e9, 1, 0, 0);
        }
      for (let j = 0; j < G - 1; j++)
        for (let i = 0; i < G - 1; i++) {
          const a = k * per + j * G + i;
          index.push(a, a + 1, a + G, a + 1, a + G + 1, a + G);
        }
    }
    this.decalGeo.setAttribute('position', this.dPos);
    this.decalGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    this.decalGeo.setAttribute('aColor', this.dColor);
    this.decalGeo.setAttribute('aDecal', this.dParams);
    this.decalGeo.setIndex(index);
    this.decalExpiry = new Float32Array(this.decalN);
    const decalMat = new THREE.ShaderMaterial({
      name: 'GRAVFX/GroundDecal',
      vertexShader: DECAL_VERTEX,
      fragmentShader: DECAL_FRAGMENT,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    decalMat.uniforms.uTime = this.uniforms.uTime;
    const decals = new THREE.Mesh(this.decalGeo, decalMat);
    decals.frustumCulled = false;
    decals.renderOrder = 9;

    this.group.add(beams, parts, decals);
  }

  /** Where ground decals land (terrain height field). */
  setGround(surfaceAt: (dir: Vec3) => Vec3): void {
    this.ground = surfaceAt;
  }

  setQuality(q: Quality): void {
    this.scale = QUALITY_SCALE[q];
  }

  /** A ribbon from `from` to `to`. Always GameplayCritical: tracers tell players where shots come from. */
  beam(from: THREE.Vector3, to: THREE.Vector3, color: THREE.ColorRepresentation, width = 0.06, life = 0.14): void {
    const i = this.beamCursor;
    this.beamCursor = (i + 1) % this.beamN;
    this.bStart.setXYZ(i, from.x, from.y, from.z);
    this.bEnd.setXYZ(i, to.x, to.y, to.z);
    const c = this.tmpColor.set(color);
    this.bColor.setXYZ(i, c.r, c.g, c.b);
    this.bTime.setXYZ(i, this.time, life, width);
    this.beamExpiry[i] = this.time + life;
    this.beamDirty = true;
  }

  /** A plain fading ribbon (projectile wakes, dash streaks). GameplayCritical: it shows where a shot travels. */
  trail(from: THREE.Vector3, to: THREE.Vector3, color: THREE.ColorRepresentation, width = 0.08, life = 0.22): void {
    this.beam(from, to, color, -Math.abs(width), life);
  }

  /**
   * A projectile's body for this frame (re-spawned every frame while it flies): a hot white core inside a halo of
   * its own color (older halo sprites have already turned to the color; the shader starts every sprite white).
   */
  orb(at: THREE.Vector3, color: THREE.ColorRepresentation, size: number, core: THREE.ColorRepresentation = '#fff8e0'): void {
    this.burst(at, this.tmpA.set(0, 1, 0), { color: core, count: 1, speed: 0, speedJitter: 0, size: size * 0.7, sizeJitter: 0.05, life: 0.05, shape: Shape.DOT, category: 'GameplayCritical' });
    this.burst(at, this.tmpA.set(0, 1, 0), { color, count: 1, speed: 0, speedJitter: 0, size: size * 1.7, sizeJitter: 0, life: 0.14, shape: Shape.DOT, category: 'GameplayCritical' });
  }

  /**
   * A disc on the ground around `center` (radius m) living `life` s. The grid is conformed to the terrain when
   * spawned; on a roof or a rock top (centre well above the terrain) it stays a flat disc at the centre's height.
   * Telegraphs and shockwaves are GameplayCritical (never reduced); splashes are Environment.
   */
  decal(center: Vec3, radius: number, color: THREE.ColorRepresentation, life: number, mode: DecalMode): void {
    if (mode === DecalMode.SPLASH && this.scale < 0.5) return;
    const k = this.decalCursor;
    this.decalCursor = (k + 1) % this.decalN;
    const G = DECAL_GRID;
    const per = G * G;
    const up = this.tmpA.set(center.x, center.y, center.z).normalize();
    const t1 = this.tmpB.set(Math.abs(up.y) < 0.9 ? 0 : 1, Math.abs(up.y) < 0.9 ? 1 : 0, 0).cross(up).normalize();
    const t2 = this.tmpC.crossVectors(up, t1);
    const cr = Math.hypot(center.x, center.y, center.z);
    const g0 = this.ground?.({ x: up.x, y: up.y, z: up.z });
    const onTerrain = !!g0 && cr - Math.hypot(g0.x, g0.y, g0.z) < 0.6;
    const c = this.tmpColor.set(color);
    const lift = 0.07;
    for (let j = 0; j < G; j++)
      for (let i = 0; i < G; i++) {
        const v = k * per + j * G + i;
        const u = (i / (G - 1)) * 2 - 1;
        const w = (j / (G - 1)) * 2 - 1;
        let x = center.x + (t1.x * u + t2.x * w) * radius;
        let y = center.y + (t1.y * u + t2.y * w) * radius;
        let z = center.z + (t1.z * u + t2.z * w) * radius;
        const l = Math.hypot(x, y, z);
        const d = { x: x / l, y: y / l, z: z / l };
        if (onTerrain && this.ground) {
          const g = this.ground(d);
          x = g.x + d.x * lift;
          y = g.y + d.y * lift;
          z = g.z + d.z * lift;
        } else {
          x = d.x * (cr + lift);
          y = d.y * (cr + lift);
          z = d.z * (cr + lift);
        }
        this.dPos.setXYZ(v, x, y, z);
        this.dColor.setXYZ(v, c.r, c.g, c.b);
        this.dParams.setXYZW(v, this.time, life, mode, k * 1.7);
      }
    this.decalExpiry[k] = this.time + life;
    this.decalDirty = true;
  }

  /** Floats an Ultimate Mark over a character (`parent` = its root, local +Y = up). PersistentMark: always drawn. */
  attachMark(parent: THREE.Object3D, id: UltimateMarkId): UltimateMark {
    const m = new UltimateMark(id);
    parent.add(m.group);
    this.marks.add(m);
    return m;
  }

  detachMark(m: UltimateMark): void {
    m.dispose();
    this.marks.delete(m);
  }

  get markCount(): number {
    return this.marks.size;
  }

  /** A burst of particles around `dir` (unit) at `at`. */
  burst(at: THREE.Vector3, dir: THREE.Vector3, o: BurstOptions): void {
    const cat = o.category ?? 'CombatBurst';
    const n = cat === 'GameplayCritical' ? o.count : Math.max(1, Math.round(o.count * this.scale));
    const c = this.tmpColor.set(o.color);
    const spread = o.spread ?? Math.PI;
    // Basis around dir for cone sampling.
    const d = this.tmpA.copy(dir);
    if (d.lengthSq() < 1e-8) d.set(0, 1, 0);
    d.normalize();
    const t1 = this.tmpB.set(Math.abs(d.y) < 0.9 ? 0 : 1, Math.abs(d.y) < 0.9 ? 1 : 0, 0).cross(d).normalize();
    const t2 = this.tmpC.crossVectors(d, t1);
    for (let k = 0; k < n; k++) {
      const i = this.partCursor;
      this.partCursor = (i + 1) % this.partN;
      const cosA = 1 - Math.random() * (1 - Math.cos(spread));
      const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
      const phi = Math.random() * Math.PI * 2;
      const sp = o.speed * (1 + ((Math.random() - 0.5) * 2) * (o.speedJitter ?? 0.4));
      const vx = (d.x * cosA + (t1.x * Math.cos(phi) + t2.x * Math.sin(phi)) * sinA) * sp;
      const vy = (d.y * cosA + (t1.y * Math.cos(phi) + t2.y * Math.sin(phi)) * sinA) * sp;
      const vz = (d.z * cosA + (t1.z * Math.cos(phi) + t2.z * Math.sin(phi)) * sinA) * sp;
      const life = o.life * (0.75 + Math.random() * 0.5);
      const size = o.size * (1 + ((Math.random() - 0.5) * 2) * (o.sizeJitter ?? 0.3));
      this.pPos.setXYZ(i, at.x, at.y, at.z);
      this.pVel.setXYZ(i, vx, vy, vz);
      this.pColor.setXYZ(i, c.r, c.g, c.b);
      this.pParams.setXYZW(i, this.time, life, size, o.gravity ?? 0);
      this.pShape.setXY(i, o.shape ?? Shape.DOT, o.drag ?? 3);
      this.partExpiry[i] = this.time + life;
    }
    this.partDirty = true;
  }

  /** A single bright flash sprite (muzzle, impact core). */
  flash(at: THREE.Vector3, color: THREE.ColorRepresentation, size: number, life = 0.07): void {
    this.burst(at, this.tmpA.set(0, 1, 0), { color, count: 1, speed: 0, speedJitter: 0, size, sizeJitter: 0.1, life, shape: Shape.DOT, category: 'GameplayCritical' });
  }

  /** An expanding ring (shield breaks, eliminations). */
  ring(at: THREE.Vector3, color: THREE.ColorRepresentation, size: number, life = 0.35): void {
    this.burst(at, this.tmpA.set(0, 1, 0), { color, count: 1, speed: 0, speedJitter: 0, size, sizeJitter: 0, life, shape: Shape.RING, category: 'GameplayCritical' });
  }

  update(dt: number): void {
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    if (this.beamDirty) {
      for (const a of [this.bStart, this.bEnd, this.bColor, this.bTime]) a.needsUpdate = true;
      this.beamDirty = false;
    }
    if (this.partDirty) {
      for (const a of [this.pPos, this.pVel, this.pColor, this.pParams, this.pShape]) a.needsUpdate = true;
      this.partDirty = false;
    }
    if (this.decalDirty) {
      for (const a of [this.dPos, this.dColor, this.dParams]) a.needsUpdate = true;
      this.decalDirty = false;
    }
    for (const m of this.marks) m.update(dt);
  }

  /** Live effect slots (F3 overlay). */
  get active(): number {
    let n = 0;
    for (let i = 0; i < this.beamN; i++) if (this.beamExpiry[i]! > this.time) n++;
    for (let i = 0; i < this.partN; i++) if (this.partExpiry[i]! > this.time) n++;
    for (let i = 0; i < this.decalN; i++) if (this.decalExpiry[i]! > this.time) n++;
    return n + this.marks.size;
  }
}
