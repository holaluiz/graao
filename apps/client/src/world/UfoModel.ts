/**
 * The graao UFO, code-authored (no Blender for the MVP): a toy-like saucer that reads from orbit and from the ground.
 *
 *   - hull: a lathe profile (pale lilac-silver), an orange rim band, a pale-blue dome with a little antenna;
 *   - running lights: 12 bulbs around the rim chasing in sequence (one unlit draw call);
 *   - hatch + tractor beam: a soft additive cone under the ship while the jump window is open.
 *
 * Local frame: +Y up (the planet's local up at the ship), +Z the course, origin at the ship's centre. One inverted
 * ink shell matches the characters' outline. Diameter ≈ 9 m.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Vec3 } from '@graao/shared';
import { createStylizedMaterial } from '../render/materials/GRAStylizedMaterial';

const INK = new THREE.Color('#2a2130');
const RIM_RADIUS = 4.5;
const LIGHTS = 12;

function paint(g: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

function clean(g: THREE.BufferGeometry): THREE.BufferGeometry {
  for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(name)) g.deleteAttribute(name);
  return g.index ? g.toNonIndexed() : g;
}

/** Lathe from a (radius, height) profile, with an ink copy pushed out along the profile normals. */
function lathe(profile: [number, number][], segments: number, ink: number): { body: THREE.BufferGeometry; shell: THREE.BufferGeometry } {
  const pts = profile.map(([r, y]) => new THREE.Vector2(r, y));
  const out = profile.map(([r, y], i) => {
    const a = profile[Math.max(0, i - 1)]!;
    const b = profile[Math.min(profile.length - 1, i + 1)]!;
    // Outward normal of the profile curve (tangent rotated −90°).
    const tx = b[0] - a[0];
    const ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1;
    return new THREE.Vector2(Math.max(0, r + (ty / l) * ink), y - (tx / l) * ink);
  });
  return { body: new THREE.LatheGeometry(pts, segments), shell: new THREE.LatheGeometry(out, segments) };
}

const BEAM_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const BEAM_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uOpen;
varying vec2 vUv;
void main() {
  // vUv.y: 1 at the hatch, 0 at the far end. Soft rings travel down the beam.
  float along = 1.0 - vUv.y;
  float rings = 0.55 + 0.45 * sin(along * 26.0 - uTime * 7.0);
  float edge = sin(vUv.x * 3.14159 * 2.0 * 6.0 + uTime * 1.5) * 0.08 + 0.92;
  float a = (1.0 - smoothstep(0.0, 1.0, along)) * rings * edge * uOpen * 0.42;
  gl_FragColor = vec4(vec3(1.0, 0.93, 0.66) * (0.8 + rings * 0.35), a);
}
`;

const LIGHT_VERTEX = /* glsl */ `
attribute float aIndex;
uniform float uTime;
varying float vGlow;
void main() {
  // A chase around the rim: each bulb peaks in turn.
  float phase = fract(uTime * 0.9 - aIndex / ${LIGHTS}.0);
  vGlow = pow(1.0 - phase, 3.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const LIGHT_FRAGMENT = /* glsl */ `
varying float vGlow;
void main() {
  vec3 dim = vec3(0.93, 0.62, 0.30);
  vec3 lit = vec3(1.0, 0.97, 0.80);
  gl_FragColor = vec4(mix(dim, lit, vGlow), 1.0);
  #include <colorspace_fragment>
}
`;

export class UfoModel {
  readonly root = new THREE.Group();
  /** Hull, dome and lights: spins slowly about the ship's up. */
  private readonly spin = new THREE.Group();
  private readonly beam: THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial>;
  private readonly lightMat: THREE.ShaderMaterial;
  private open = 0;
  private time = 0;
  readonly triangles: number;
  private readonly basis = new THREE.Matrix4();
  private readonly up = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private readonly wobble = new THREE.Quaternion();

  constructor() {
    this.root.name = 'UFO';
    const hull = lathe(
      [
        [0, -0.95],
        [1.3, -0.98],
        [2.7, -0.78],
        [3.8, -0.4],
        [RIM_RADIUS, -0.02],
        [3.9, 0.32],
        [2.7, 0.56],
        [1.7, 0.7],
        [0, 0.72],
      ],
      48,
      0.11,
    );
    const rim = new THREE.TorusGeometry(RIM_RADIUS - 0.05, 0.2, 8, 48).rotateX(Math.PI / 2);
    const dome = new THREE.SphereGeometry(1.95, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.62, 0);
    const collar = new THREE.CylinderGeometry(2.05, 2.15, 0.18, 32).translate(0, 0.66, 0);
    const mast = new THREE.CylinderGeometry(0.06, 0.08, 0.9, 8).translate(0, 2.95, 0);
    const knob = new THREE.SphereGeometry(0.2, 12, 8).translate(0, 3.45, 0);
    const hatch = new THREE.CylinderGeometry(1.25, 1.25, 0.06, 28).translate(0, -0.97, 0);
    const body = mergeGeometries(
      [
        clean(paint(hull.body, '#e9e2f1')),
        clean(paint(rim, '#ec8a3a')),
        clean(paint(dome, '#a9dbf2')),
        clean(paint(collar, '#ec8a3a')),
        clean(paint(mast, '#8b7fa3')),
        clean(paint(knob, '#ffd36e')),
        clean(paint(hatch, '#3b3048')),
      ],
      false,
    )!;
    body.computeBoundingSphere();
    // Ink: the hull's offset shell plus slightly inflated dome and rim.
    const domeInk = new THREE.SphereGeometry(2.05, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.62, 0);
    const rimInk = new THREE.TorusGeometry(RIM_RADIUS - 0.05, 0.3, 8, 48).rotateX(Math.PI / 2);
    const ink = mergeGeometries([clean(hull.shell), clean(domeInk), clean(rimInk)], false)!;
    const mat = createStylizedMaterial({ variant: 'world', vertexColors: true, pigment: 0.06, edgePooling: 0.05 });
    const inkMat = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide, fog: true });
    const bodyMesh = new THREE.Mesh(body, mat);
    bodyMesh.castShadow = true;
    const inkMesh = new THREE.Mesh(ink, inkMat);

    // Running lights on the lower slope of the rim.
    const bulbs: THREE.BufferGeometry[] = [];
    for (let i = 0; i < LIGHTS; i++) {
      const a = (i / LIGHTS) * Math.PI * 2;
      const g = new THREE.SphereGeometry(0.24, 10, 6).translate(Math.cos(a) * 3.95, -0.36, Math.sin(a) * 3.95);
      for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
      g.setAttribute('aIndex', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count).fill(i), 1));
      bulbs.push(g);
    }
    this.lightMat = new THREE.ShaderMaterial({ name: 'UFO/Lights', vertexShader: LIGHT_VERTEX, fragmentShader: LIGHT_FRAGMENT, uniforms: { uTime: { value: 0 } } });
    const lights = new THREE.Mesh(mergeGeometries(bulbs, false)!, this.lightMat);

    this.spin.add(bodyMesh, inkMesh, lights);

    // Tractor beam: an open cone from the hatch down, additive, fading toward its end.
    const beamGeo = new THREE.CylinderGeometry(1.1, 3.6, 16, 32, 1, true).translate(0, -0.95 - 8, 0);
    this.beam = new THREE.Mesh(
      beamGeo,
      new THREE.ShaderMaterial({
        name: 'UFO/Beam',
        vertexShader: BEAM_VERTEX,
        fragmentShader: BEAM_FRAGMENT,
        uniforms: { uTime: { value: 0 }, uOpen: { value: 0 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    this.beam.visible = false;
    this.beam.renderOrder = 12;
    this.root.add(this.spin, this.beam);
    this.triangles = (body.getAttribute('position').count + ink.getAttribute('position').count) / 3 + (lights.geometry.index ? lights.geometry.index.count / 3 : lights.geometry.getAttribute('position').count / 3);
  }

  /**
   * Places the ship at `pos` (world) flying along `heading`, with a gentle bob and wobble; the beam opens while
   * `hatchOpen`.
   */
  update(dt: number, pos: Vec3, heading: Vec3, hatchOpen: boolean): void {
    this.time += dt;
    const t = this.time;
    this.up.set(pos.x, pos.y, pos.z).normalize();
    this.fwd.set(heading.x, heading.y, heading.z).addScaledVector(this.up, -this.fwd.dot(this.up)).normalize();
    this.side.crossVectors(this.up, this.fwd).normalize();
    this.basis.makeBasis(this.side, this.up, this.fwd);
    this.root.quaternion.setFromRotationMatrix(this.basis);
    // Nose slightly down along the course, a slow wobble on top.
    this.wobble.setFromEuler(new THREE.Euler(0.07 + Math.sin(t * 0.9) * 0.025, 0, Math.sin(t * 0.7) * 0.03));
    this.root.quaternion.multiply(this.wobble);
    this.root.position.set(pos.x, pos.y, pos.z).addScaledVector(this.up, Math.sin(t * 1.3) * 0.3);
    this.spin.rotation.y = t * 0.35;
    this.open += ((hatchOpen ? 1 : 0) - this.open) * (1 - Math.exp(-dt * 4));
    this.beam.visible = this.open > 0.01;
    this.beam.material.uniforms.uOpen!.value = this.open;
    this.beam.material.uniforms.uTime!.value = t;
    this.lightMat.uniforms.uTime!.value = t;
  }

  set visible(v: boolean) {
    this.root.visible = v;
  }

  get visible(): boolean {
    return this.root.visible;
  }
}
