/**
 * GRAVFXSystem: graao's small effect toolkit (not a Niagara). Two pooled GPU primitives, one draw call each:
 *
 *   - Beams: camera-facing ribbons between two points (tracers, sunbeams, ability beams). Fade and thin over life.
 *   - Particles: billboards with drag and radial gravity, animated entirely in the vertex shader (muzzle flashes,
 *     impact puffs, shield shards, petals, rings).
 *
 * Spawning writes one slot of a ring buffer; nothing is allocated per effect and no Object3D is created.
 * Categories decide what quality levels may drop: GameplayCritical effects are never reduced.
 */
import * as THREE from 'three';
import type { Quality } from '../GRARenderer';

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
  float w = aTime.z * (1.0 - 0.65 * clamp(age, 0.0, 1.0));
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
#include <fog_pars_fragment>
void main() {
  float across = 1.0 - abs(vUv.y - 0.5) * 2.0;
  float core = smoothstep(0.55, 0.95, across);
  // A bright head travels along the beam in the first part of its life.
  float head = 1.0 - smoothstep(0.0, 0.18, abs(vUv.x - clamp(vAge * 2.6, 0.0, 1.0)));
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

  private readonly beamN = 96;
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

    this.group.add(beams, parts);
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
  }

  /** Live effect slots (F3 overlay). */
  get active(): number {
    let n = 0;
    for (let i = 0; i < this.beamN; i++) if (this.beamExpiry[i]! > this.time) n++;
    for (let i = 0; i < this.partN; i++) if (this.partExpiry[i]! > this.time) n++;
    return n;
  }
}
