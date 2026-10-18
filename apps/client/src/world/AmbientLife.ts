/**
 * AmbientLife: the small things that make the planet breathe (the Messenger lesson): flocks of birds gliding and
 * flapping high over the planet, and butterflies fluttering low around wherever the player is, scattering when the
 * player walks through them. Everything is instanced and animated in the vertex shader (wing flaps) with a handful of
 * per-frame instance matrices on the CPU; no textures.
 */
import * as THREE from 'three';
import type { Vec3 } from '@graao/shared';

interface Terrain {
  seaRadius: number;
  surfaceAt(dir: Vec3, out?: Vec3): Vec3;
}

const vertex = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute float aWing;
attribute float aPhase;
attribute vec3 aColor;
uniform float uTime;
uniform float uFlapHz;
uniform float uBase;
uniform float uAmp;
uniform float uGlide;
varying vec3 vColor;
varying float vTip;
void main() {
  vec3 p = position;
  float w = abs(aWing);
  // Flap (with gliding stretches for the birds): wings rotate about the body axis, both tips rising together.
  float glide = mix(1.0, smoothstep(-0.25, 0.45, sin(uTime * 0.35 + aPhase * 13.0)), uGlide);
  float a = uBase + sin((uTime * uFlapHz + aPhase) * 6.2831853) * uAmp * (0.12 + 0.88 * glide);
  if (w > 0.0) {
    float x = abs(p.x);
    p.x = sign(p.x) * x * cos(a);
    p.y += x * sin(a);
  }
  vColor = aColor;
  vTip = w;
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const fragment = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
varying vec3 vColor;
varying float vTip;
void main() {
  // Two flat tones: the upper side in full color, the underside a shade darker.
  vec3 c = gl_FrontFacing ? vColor : vColor * 0.72;
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

function makeMaterial(flapHz: number, base: number, amp: number, glide: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'GRAAmbientLife',
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      { uTime: { value: 0 }, uFlapHz: { value: flapHz }, uBase: { value: base }, uAmp: { value: amp }, uGlide: { value: glide } },
    ]),
    side: THREE.DoubleSide,
    fog: true,
  });
}

/** Builds a geometry from a body polygon (fan, aWing = 0) and a right wing polygon (fan from the hinge, mirrored). */
function winged(body: [number, number][], wing: [number, number][], scale: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const wingAttr: number[] = [];
  const push = (x: number, z: number, wv: number) => {
    pos.push(x * scale, 0, z * scale);
    wingAttr.push(wv);
  };
  for (let i = 1; i < body.length - 1; i++) {
    for (const [x, z] of [body[0]!, body[i]!, body[i + 1]!]) push(x, z, 0);
  }
  for (const side of [1, -1]) {
    for (let i = 1; i < wing.length - 1; i++) {
      for (const [x, z] of [wing[0]!, wing[i]!, wing[i + 1]!]) push(x * side, z, x === 0 ? 0 : side);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aWing', new THREE.Float32BufferAttribute(wingAttr, 1));
  return g;
}

interface Flock {
  axis: THREE.Vector3;
  start: THREE.Vector3;
  omega: number;
  alt: number;
}

interface Butterfly {
  home: THREE.Vector3;
  up: THREE.Vector3;
  t1: THREE.Vector3;
  t2: THREE.Vector3;
  phase: number;
  r: number;
  h: number;
  speed: number;
  pos: THREE.Vector3;
  scare: number;
}

const BUTTERFLY_COLORS = ['#ffffff', '#f5ba53', '#ffd998', '#9dbfe6', '#ade3d0', '#3d7fd6', '#f29bb5'];

export class AmbientLife {
  readonly group = new THREE.Group();
  private readonly birds: THREE.InstancedMesh;
  private readonly butterflies: THREE.InstancedMesh;
  private readonly birdMat = makeMaterial(2.6, 0.12, 0.75, 1);
  private readonly flyMat = makeMaterial(5.5, 0.55, 0.85, 0);
  private readonly flocks: Flock[] = [];
  private readonly flies: Butterfly[] = [];
  private readonly birdsPerFlock = 6;
  private readonly m = new THREE.Matrix4();
  private readonly v = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly s = new THREE.Vector3(1, 1, 1);
  private rand = 1;

  constructor(private readonly radius: number, private readonly terrain: Terrain, butterflyCount: number) {
    this.group.name = 'ambientLife';
    const rnd = () => {
      this.rand = (this.rand * 16807) % 2147483647;
      return (this.rand - 1) / 2147483646;
    };
    this.random = rnd;

    // Birds: gull-like silhouettes, ~0.8 m wingspan.
    const birdGeo = winged(
      [[0, 0.22], [0.035, 0.05], [0.025, -0.16], [0, -0.24], [-0.025, -0.16], [-0.035, 0.05]],
      [[0, 0.05], [0.18, 0.06], [0.4, -0.02], [0.36, -0.06], [0.16, -0.06], [0, -0.07]],
      1,
    );
    const flockCount = 3;
    const nBirds = flockCount * this.birdsPerFlock;
    this.addInstanced(birdGeo, nBirds, (i) => [i * 0.137, new THREE.Color(i % 3 === 0 ? '#dfe7e8' : '#f6f8f6')]);
    this.birds = new THREE.InstancedMesh(birdGeo, this.birdMat, nBirds);
    for (let k = 0; k < flockCount; k++) {
      const axis = new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
      const start = new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).cross(axis).normalize();
      this.flocks.push({ axis, start, omega: (6 + rnd() * 3) / (radius + 20) * (k % 2 ? 1 : -1), alt: 13 + rnd() * 14 });
    }

    // Butterflies: two-lobed wings, ~17 cm across (a touch large, so they read at play distance).
    const flyGeo = winged(
      [[0, 0.03], [0.006, 0.0], [0, -0.035], [-0.006, 0.0]],
      [[0, 0.0], [0, 0.014], [0.028, 0.034], [0.05, 0.026], [0.054, 0.006], [0.04, -0.008], [0.034, -0.028], [0.016, -0.034], [0, -0.014]],
      1.6,
    );
    this.addInstanced(flyGeo, butterflyCount, (i) => [rnd(), new THREE.Color(BUTTERFLY_COLORS[i % BUTTERFLY_COLORS.length]!)]);
    this.butterflies = new THREE.InstancedMesh(flyGeo, this.flyMat, butterflyCount);
    for (let i = 0; i < butterflyCount; i++) {
      this.flies.push({ home: new THREE.Vector3(), up: new THREE.Vector3(), t1: new THREE.Vector3(), t2: new THREE.Vector3(), phase: rnd() * 100, r: 0, h: 0, speed: 0, pos: new THREE.Vector3(), scare: 0 });
    }
    for (const mesh of [this.birds, this.butterflies]) {
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);
    }
  }

  private random: () => number;

  private addInstanced(g: THREE.BufferGeometry, count: number, per: (i: number) => [number, THREE.Color]): void {
    const phase = new Float32Array(count);
    const color = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const [p, c] = per(i);
      phase[i] = p;
      color.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    g.setAttribute('aColor', new THREE.InstancedBufferAttribute(color, 3));
  }

  /** Places a butterfly's flight area somewhere on land 3–14 m from `focus` (several tries; stays put if all fail). */
  private respawn(b: Butterfly, focus: THREE.Vector3, first: boolean): void {
    const up = focus.clone().normalize();
    const t1 = new THREE.Vector3(up.y, -up.x, 0.3).cross(up).normalize();
    const t2 = new THREE.Vector3().crossVectors(up, t1);
    for (let tries = 0; tries < 6; tries++) {
      const a = this.random() * Math.PI * 2;
      const d = (first ? 2.5 : 7) + this.random() * (first ? 11 : 7);
      const dir = focus.clone().addScaledVector(t1, Math.cos(a) * d).addScaledVector(t2, Math.sin(a) * d).normalize();
      const g = this.terrain.surfaceAt({ x: dir.x, y: dir.y, z: dir.z });
      const p = new THREE.Vector3(g.x, g.y, g.z);
      if (p.length() < this.terrain.seaRadius + 0.3) continue;
      b.home.copy(p);
      b.up.copy(dir);
      b.t1.set(dir.y, -dir.x, 0.3).cross(dir).normalize();
      b.t2.crossVectors(dir, b.t1);
      b.r = 0.6 + this.random() * 1.8;
      b.h = 0.35 + this.random() * 0.9;
      b.speed = 0.25 + this.random() * 0.35;
      b.pos.copy(p).addScaledVector(dir, b.h);
      return;
    }
  }

  update(dt: number, time: number, focus: THREE.Vector3): void {
    this.birdMat.uniforms.uTime!.value = time;
    this.flyMat.uniforms.uTime!.value = time;

    // Birds: each flock flies a slow circle around the planet in a loose V, bobbing.
    let i = 0;
    for (const f of this.flocks) {
      const center = this.v.copy(f.start).applyAxisAngle(f.axis, f.omega * time);
      this.fwd.crossVectors(f.axis, center).normalize().multiplyScalar(Math.sign(f.omega));
      for (let k = 0; k < this.birdsPerFlock; k++) {
        const rank = Math.ceil(k / 2);
        const sideSign = k % 2 ? 1 : -1;
        this.up.copy(center).normalize();
        this.side.crossVectors(this.up, this.fwd).normalize();
        const bob = Math.sin(time * 0.8 + k * 1.7) * 0.5;
        const p = this.up.clone().multiplyScalar(this.radius + f.alt + bob + rank * 0.25)
          .addScaledVector(this.fwd, -rank * 1.6 + Math.sin(time * 0.5 + k) * 0.3)
          .addScaledVector(this.side, sideSign * rank * 1.3);
        this.m.makeBasis(this.side, this.up, this.fwd).setPosition(p);
        this.birds.setMatrixAt(i++, this.m);
      }
    }
    this.birds.instanceMatrix.needsUpdate = true;

    // Butterflies: Lissajous loops around a home spot near the player; they scatter from the player and move on
    // when left behind.
    const n = this.flies.length;
    for (let k = 0; k < n; k++) {
      const b = this.flies[k]!;
      if (b.r === 0) this.respawn(b, focus, true);
      else if (b.home.distanceTo(focus) > 19) this.respawn(b, focus, false);
      const t = time * b.speed + b.phase;
      const target = this.v.copy(b.home)
        .addScaledVector(b.t1, Math.sin(t * 1.3) * b.r)
        .addScaledVector(b.t2, Math.sin(t * 0.9 + 1.1) * b.r * 0.8)
        .addScaledVector(b.up, b.h + Math.sin(t * 3.1) * 0.18 + Math.sin(t * 7.3) * 0.05);
      // Scatter: up and away from the player within ~1.8 m.
      const toPlayer = focus.distanceTo(target);
      b.scare = Math.max(b.scare - dt * 0.35, toPlayer < 1.8 ? 1 : 0);
      if (b.scare > 0) {
        const away = target.clone().sub(focus).normalize();
        target.addScaledVector(away, b.scare * 1.6).addScaledVector(b.up, b.scare * 1.2);
      }
      const prev = this.fwd.copy(b.pos);
      b.pos.lerp(target, 1 - Math.exp(-dt * 4));
      const vel = prev.subVectors(b.pos, prev);
      this.up.copy(b.up);
      if (vel.lengthSq() < 1e-8) vel.copy(b.t1);
      vel.addScaledVector(this.up, -vel.dot(this.up)).normalize();
      this.side.crossVectors(this.up, vel).normalize();
      this.m.makeBasis(this.side, this.up, vel).setPosition(b.pos);
      this.m.scale(this.s.setScalar(b.r > 0 ? 1 : 0));
      this.butterflies.setMatrixAt(k, this.m);
    }
    this.butterflies.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.birds.geometry.dispose();
    this.butterflies.geometry.dispose();
    this.birdMat.dispose();
    this.flyMat.dispose();
  }
}
