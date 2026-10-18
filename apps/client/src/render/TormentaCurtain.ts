/**
 * TormentaCurtain: the boundary of the safe region read from afar, a torn sheet of washed-out paper standing on the
 * circle. One ring strip (one draw call, 384 triangles) placed entirely in the vertex shader from the shared Tormenta
 * uniforms, so it follows the authoritative boundary with no CPU work. Both faces render (the old zone wall vanished
 * from inside, legacy K-41), it is mostly transparent so it never blocks sight, and it fades near the camera so
 * walking through it is not a white wall. Hidden while the whole planet is still safe.
 */
import * as THREE from 'three';
import { GLSL_NOISE, TORMENTA_UNIFORMS } from './materials/GRAStylizedMaterial';

const SEGMENTS = 192;

const VERTEX = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec2 aRing;
uniform vec4 uTorm;
uniform vec3 uTormOn;
uniform vec2 uSpan;
varying vec2 vUv;
varying vec3 vWorldPos;
void main() {
  vec3 c = uTorm.xyz;
  vec3 t1 = normalize(cross(c, abs(c.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 t2 = cross(c, t1);
  float th = aRing.x * 6.2831853;
  vec3 d = c * cos(uTorm.w) + (t1 * cos(th) + t2 * sin(th)) * sin(uTorm.w);
  vec3 wp = d * (uTormOn.z + mix(uSpan.x, uSpan.y, aRing.y));
  vWorldPos = wp;
  // u in metres along the boundary (streaks and the torn top keep their size whatever the radius).
  vUv = vec2(aRing.x * 6.2831853 * uTormOn.z * sin(uTorm.w), aRing.y);
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAGMENT = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uTormOn;
uniform float uVisible;
uniform vec3 uPaper;
uniform vec3 uInk;
varying vec2 vUv;
varying vec3 vWorldPos;
${GLSL_NOISE}
void main() {
  float h = vUv.y;
  // A torn top edge, irregular along the boundary.
  float top = 0.56 + 0.36 * graNoise3(vec3(vUv.x * 0.22, uTormOn.y * 0.05, 0.0)) + 0.06 * graNoise3(vec3(vUv.x * 1.7, 4.0, 0.0));
  if (h > top) discard;
  // Washed pigment draining in vertical streaks, slowly sliding down.
  float streak = graNoise3(vec3(vUv.x * 0.9, h * 2.2 + uTormOn.y * 0.12, 2.0));
  float a = 0.12 + 0.24 * smoothstep(0.5, 0.85, streak);
  a *= 1.0 - smoothstep(top - 0.22, top, h) * 0.6;
  vec3 col = mix(uPaper, vec3(1.0), 0.35 * (1.0 - h));
  // Graphite along the tear.
  float tear = 1.0 - smoothstep(0.0, 0.018, top - h);
  col = mix(col, uInk, tear * 0.85);
  a = max(a, tear * 0.7);
  // Gone near the camera; drawn only once the region is smaller than the planet.
  a *= smoothstep(1.5, 7.0, distance(cameraPosition, vWorldPos)) * uTormOn.x * uVisible;
  if (a < 0.003) discard;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export class TormentaCurtain {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;

  constructor() {
    const ring: number[] = [];
    const index: number[] = [];
    for (let i = 0; i <= SEGMENTS; i++) {
      const u = i / SEGMENTS;
      ring.push(u, 0, u, 1);
      if (i < SEGMENTS) {
        const a = i * 2;
        index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('aRing', new THREE.Float32BufferAttribute(ring, 2));
    // Positions come from the shader; this only gives the attribute count.
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(((SEGMENTS + 1) * 2) * 3), 3));
    g.setIndex(index);
    const mat = new THREE.ShaderMaterial({
      name: 'GRATormentaCurtain',
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          // From 6 m under the mean ground (hidden in hills) to 14 m above it.
          uSpan: { value: new THREE.Vector2(-6, 14) },
          uVisible: { value: 0 },
          uPaper: { value: new THREE.Color('#ece6da') },
          uInk: { value: new THREE.Color('#4a454d') },
        },
      ]),
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });
    Object.assign(mat.uniforms, { uTorm: TORMENTA_UNIFORMS.uTorm, uTormOn: TORMENTA_UNIFORMS.uTormOn });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.name = 'tormenta_curtain';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    this.mesh.visible = false;
  }

  /** Shown while the Tormenta is live and the region is smaller than the planet. */
  update(): void {
    const on = TORMENTA_UNIFORMS.uTormOn.value.x;
    const r = TORMENTA_UNIFORMS.uTorm.value.w;
    const vis = on > 0.001 ? THREE.MathUtils.smoothstep(Math.PI - r, 0.01, 0.12) : 0;
    this.mesh.material.uniforms.uVisible!.value = vis;
    this.mesh.visible = vis > 0.001;
  }
}
