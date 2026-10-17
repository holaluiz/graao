/**
 * Camera-local speed lines for the drop: thin streaks around the view that rush past along the relative wind.
 * Purely presentation (never networked); one instanced draw call, positions updated on the CPU (a few dozen streaks).
 *
 * Streaks live in camera space, start ahead of the camera off the view axis (the centre stays clear for reading the
 * ground) and travel along the wind; they respawn ahead once they pass the camera.
 */
import * as THREE from 'three';
import type { Quality } from './GRARenderer';

const COUNT: Record<Quality, number> = { LOW: 18, MEDIUM: 32, HIGH: 44 };

const VERTEX = /* glsl */ `
attribute vec3 aA;
attribute vec3 aB;
attribute float aAlpha;
uniform float uWidth;
varying float vAlpha;
varying vec2 vUv;
void main() {
  vUv = uv;
  vAlpha = aAlpha;
  // Points are already in camera space (the mesh follows the camera): a ribbon facing the eye.
  vec3 p = mix(aA, aB, uv.x);
  vec3 axis = normalize(aB - aA + 1e-6);
  vec3 side = normalize(cross(axis, normalize(-p)) + 1e-6);
  p += side * (uv.y - 0.5) * uWidth * (0.4 + 0.6 * sin(uv.x * 3.14159));
  gl_Position = projectionMatrix * vec4(p, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform float uOpacity;
varying float vAlpha;
varying vec2 vUv;
void main() {
  float ends = sin(vUv.x * 3.14159);
  float across = 1.0 - abs(vUv.y - 0.5) * 2.0;
  float a = ends * smoothstep(0.0, 0.6, across) * vAlpha * uOpacity;
  if (a < 0.003) discard;
  gl_FragColor = vec4(1.0, 0.98, 0.94, a);
}
`;

export class SpeedLines {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private readonly a: THREE.InstancedBufferAttribute;
  private readonly b: THREE.InstancedBufferAttribute;
  private readonly alpha: THREE.InstancedBufferAttribute;
  private readonly pos: THREE.Vector3[] = [];
  private readonly seed: number[] = [];
  private readonly n: number;
  private level = 0;
  private readonly wind = new THREE.Vector3();
  private readonly inv = new THREE.Matrix4();

  constructor(quality: Quality) {
    this.n = COUNT[quality];
    const plane = new THREE.PlaneGeometry(1, 1, 6, 1);
    plane.translate(0.5, 0.5, 0);
    const g = new THREE.InstancedBufferGeometry();
    g.index = plane.index;
    g.setAttribute('position', plane.getAttribute('position'));
    g.setAttribute('uv', plane.getAttribute('uv'));
    const attr = (size: number) => new THREE.InstancedBufferAttribute(new Float32Array(this.n * size), size).setUsage(THREE.DynamicDrawUsage);
    this.a = attr(3);
    this.b = attr(3);
    this.alpha = attr(1);
    g.setAttribute('aA', this.a);
    g.setAttribute('aB', this.b);
    g.setAttribute('aAlpha', this.alpha);
    g.instanceCount = this.n;
    this.mesh = new THREE.Mesh(
      g,
      new THREE.ShaderMaterial({
        name: 'GRASpeedLines',
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: { uWidth: { value: 0.075 }, uOpacity: { value: 0 } },
        transparent: true,
        depthWrite: false,
        depthTest: false,
        // The ribbon is built in the shader; its winding depends on the wind direction.
        side: THREE.DoubleSide,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 30;
    this.mesh.visible = false;
    for (let i = 0; i < this.n; i++) {
      this.pos.push(new THREE.Vector3());
      this.seed.push(Math.random());
      this.respawn(i, true);
    }
  }

  /** A new streak ahead of the camera along the wind, off the view axis. */
  private respawn(i: number, anywhere: boolean): void {
    const ang = Math.random() * Math.PI * 2;
    const r = 1.6 + Math.random() * 3.4;
    const depth = anywhere ? 2 + Math.random() * 16 : 14 + Math.random() * 6;
    this.pos[i]!.set(Math.cos(ang) * r, Math.sin(ang) * r * 0.75, -depth);
    this.seed[i] = Math.random();
  }

  /**
   * `camera`: the view; `velocity`: the player's world velocity (m/s); `strength` 0..1 (0 hides the effect).
   * Call after the camera has been placed for this frame.
   */
  update(dt: number, camera: THREE.Camera, velocity: THREE.Vector3, strength: number): void {
    this.level += (strength - this.level) * (1 - Math.exp(-dt * 6));
    this.mesh.visible = this.level > 0.01;
    if (!this.mesh.visible) return;
    this.mesh.material.uniforms.uOpacity!.value = this.level * 0.85;
    // Relative wind in camera space: the world flows opposite to the player's motion.
    this.inv.copy(camera.matrixWorld).invert();
    this.wind.copy(velocity).negate().transformDirection(this.inv).multiplyScalar(velocity.length());
    const speed = this.wind.length();
    const dir = speed > 1e-3 ? this.wind.clone().divideScalar(speed) : new THREE.Vector3(0, 0, 1);
    const len = THREE.MathUtils.clamp(speed * 0.09, 0.6, 3.2);
    for (let i = 0; i < this.n; i++) {
      const p = this.pos[i]!;
      p.addScaledVector(this.wind, dt * (0.8 + this.seed[i]! * 0.6));
      if (p.z > -0.8 || p.z < -26 || Math.hypot(p.x, p.y) > 9) this.respawn(i, false);
      this.a.setXYZ(i, p.x, p.y, p.z);
      this.b.setXYZ(i, p.x - dir.x * len, p.y - dir.y * len, p.z - dir.z * len);
      // Fade in after spawning far away, fade out close to the eye.
      const near = THREE.MathUtils.smoothstep(-p.z, 0.8, 3);
      const far = 1 - THREE.MathUtils.smoothstep(-p.z, 14, 20);
      this.alpha.setX(i, near * far * (0.5 + this.seed[i]! * 0.5));
    }
    this.a.needsUpdate = this.b.needsUpdate = this.alpha.needsUpdate = true;
  }
}
