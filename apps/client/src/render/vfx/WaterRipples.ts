/**
 * WaterRipples: expanding rings lying on the sea surface (swim strokes, wakes, wading steps, splashes). A pooled ring
 * buffer of instanced quads in the surface's tangent plane, animated entirely in the shader: one draw call, nothing
 * allocated per ripple. Kept apart from the ground decals so a busy lake never steals a combat telegraph's slot.
 */
import * as THREE from 'three';

const VERTEX = /* glsl */ `
attribute vec3 aCenter;
attribute vec4 aParams; // birth, life, size, strength
uniform float uTime;
varying vec2 vUv;
varying float vAge;
varying float vStrength;
#include <fog_pars_vertex>
void main() {
  float age = (uTime - aParams.x) / aParams.y;
  vAge = age;
  vStrength = aParams.w;
  vUv = uv * 2.0 - 1.0;
  vec3 up = normalize(aCenter);
  vec3 ref = abs(up.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t1 = normalize(cross(ref, up));
  vec3 t2 = cross(up, t1);
  vec3 p = aCenter + (t1 * vUv.x + t2 * vUv.y) * aParams.z;
  // Dead or unborn slots collapse to a point.
  if (age < 0.0 || age > 1.0) p = vec3(0.0);
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAGMENT = /* glsl */ `
varying vec2 vUv;
varying float vAge;
varying float vStrength;
#include <fog_pars_fragment>
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  float age = clamp(vAge, 0.0, 1.0);
  // Two painted rings racing out and thinning, the inner one fainter.
  float grow = 1.0 - pow(1.0 - age, 2.2);
  float r1 = 0.12 + 0.88 * grow;
  float r2 = r1 * 0.6;
  float w = 0.05 + 0.06 * (1.0 - age);
  float ring = (1.0 - smoothstep(0.0, w, abs(r - r1))) + 0.5 * (1.0 - smoothstep(0.0, w * 0.8, abs(r - r2)));
  float a = ring * pow(1.0 - age, 1.3) * vStrength * 0.75;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(0.94, 0.99, 1.0), min(a, 1.0));
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export class WaterRipples {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private readonly n = 96;
  private cursor = 0;
  private time = 0;
  private readonly center: THREE.InstancedBufferAttribute;
  private readonly params: THREE.InstancedBufferAttribute;
  private dirty = false;

  /** `surfaceRadius`: the sea sphere's radius (ripples float a little above its waves' mean). */
  constructor(private readonly surfaceRadius: number) {
    const plane = new THREE.PlaneGeometry(1, 1, 1, 1);
    plane.translate(0.5, 0.5, 0);
    const g = new THREE.InstancedBufferGeometry();
    g.index = plane.index;
    g.setAttribute('position', plane.getAttribute('position'));
    g.setAttribute('uv', plane.getAttribute('uv'));
    this.center = new THREE.InstancedBufferAttribute(new Float32Array(this.n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.params = new THREE.InstancedBufferAttribute(new Float32Array(this.n * 4), 4).setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < this.n; i++) this.params.setXYZW(i, 1e9, 1, 0, 0);
    g.setAttribute('aCenter', this.center);
    g.setAttribute('aParams', this.params);
    g.instanceCount = this.n;
    const mat = new THREE.ShaderMaterial({
      name: 'GRAWaterRipples',
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.name = 'waterRipples';
    this.mesh.frustumCulled = false;
    // Over the water sphere (10), under the particles (11).
    this.mesh.renderOrder = 10.5;
  }

  /** A ripple centred on the surface above/below `at`: `size` m radius at the end of `life` s, `strength` 0..1. */
  spawn(at: THREE.Vector3, size: number, life: number, strength: number): void {
    const i = this.cursor;
    this.cursor = (i + 1) % this.n;
    const l = at.length() || 1;
    const r = this.surfaceRadius + 0.06;
    this.center.setXYZ(i, (at.x / l) * r, (at.y / l) * r, (at.z / l) * r);
    this.params.setXYZW(i, this.time, life, size, strength);
    this.dirty = true;
  }

  update(dt: number): void {
    this.time += dt;
    this.mesh.material.uniforms.uTime!.value = this.time;
    if (this.dirty) {
      this.center.needsUpdate = true;
      this.params.needsUpdate = true;
      this.dirty = false;
    }
  }
}
