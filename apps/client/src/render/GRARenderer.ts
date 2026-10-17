/**
 * Renderer core: WebGL2 (Three r186 WebGLRenderer), scene, camera, quality levels, painted sky and the sun rig.
 *
 * Sun: on a small planet a fixed world sun would leave half the world in night. graao uses a "local golden hour":
 * the sun direction is derived from the focus point's local up and a fixed world tangent field, so wherever the
 * player stands the light is warm and low; it drifts slowly as the player travels and never jumps. The shadow
 * camera follows the focus point and snaps to shadow texels to avoid shimmering.
 */
import * as THREE from 'three';
import { GLSL_NOISE } from './materials/GRAStylizedMaterial';

export type Quality = 'LOW' | 'MEDIUM' | 'HIGH';

export const QUALITY: Record<Quality, { pixelRatio: number; shadowMap: number; shadowRadius: number; shadows: boolean; grassFraction: number; flowers: boolean; antialias: boolean }> = {
  LOW: { pixelRatio: 1, shadowMap: 1024, shadowRadius: 1.5, shadows: true, grassFraction: 0.35, flowers: false, antialias: false },
  MEDIUM: { pixelRatio: 1.25, shadowMap: 2048, shadowRadius: 2.5, shadows: true, grassFraction: 0.7, flowers: true, antialias: true },
  HIGH: { pixelRatio: 2, shadowMap: 2048, shadowRadius: 3, shadows: true, grassFraction: 1, flowers: true, antialias: true },
};

const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vDir = wp.xyz - cameraPosition;
  gl_Position = projectionMatrix * viewMatrix * wp;
  gl_Position.z = gl_Position.w; // far plane
}
`;

const SKY_FRAGMENT = /* glsl */ `
uniform vec3 uUp;
uniform vec3 uSunDir;
uniform vec3 uZenith;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec3 uBelow;
uniform vec3 uSunColor;
uniform vec3 uCloudLight;
uniform vec3 uCloudShade;
uniform float uTime;
uniform float uOrbit;
uniform float uLimb;
uniform vec3 uSpace;
uniform vec3 uSpaceDeep;
varying vec3 vDir;
${GLSL_NOISE}
void main() {
  vec3 d = normalize(vDir);
  float h = dot(d, uUp);
  vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.32, h));
  col = mix(col, uZenith, smoothstep(0.3, 0.95, h));
  col = mix(col, uBelow, smoothstep(0.0, -0.35, h));
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(sd, 6.0) * 0.28 + pow(sd, 60.0) * 0.5);
  col = mix(col, vec3(1.0, 0.97, 0.9), smoothstep(0.9993, 0.9997, sd));
  // Painted cloud masses: thresholded noise in a band above the horizon, drifting slowly.
  vec3 p = d * 2.6 + vec3(uTime * 0.004, 0.0, uTime * 0.002);
  float n = graFbm3(p) + graNoise3(p * 3.1) * 0.18;
  float band = smoothstep(-0.02, 0.12, h) * (1.0 - smoothstep(0.55, 0.85, h));
  float cloud = smoothstep(0.6, 0.66, n) * band;
  float shade = smoothstep(0.62, 0.78, graFbm3(p + d * 0.08 + 1.7));
  vec3 cc = mix(uCloudLight, uCloudShade, shade * 0.7);
  cc += uSunColor * pow(sd, 4.0) * 0.25;
  col = mix(col, cc, cloud * 0.92);
  // From orbit (UFO): a painted dusk around the planet, a warm halo hugging its limb and a few soft stars.
  if (uOrbit > 0.001) {
    // Angle from the planet's centre as seen from the camera; uLimb is the planet's angular radius.
    float ang = acos(clamp(dot(d, -uUp), -1.0, 1.0));
    float halo = 1.0 - smoothstep(uLimb, uLimb * 1.5 + 0.02, ang);
    vec3 space = mix(uSpaceDeep, uSpace, 1.0 - smoothstep(uLimb, uLimb * 3.5 + 0.3, ang));
    vec3 cell = floor(d * 64.0);
    float hsh = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    float star = step(0.962, hsh) * smoothstep(0.24, 0.0, length(fract(d * 64.0) - 0.5)) * (1.0 - halo);
    vec3 orbitCol = mix(space, uHorizon, pow(halo, 1.6) * 0.92) + vec3(star * 0.5);
    orbitCol += uSunColor * (pow(sd, 8.0) * 0.22 + pow(sd, 90.0) * 0.55);
    col = mix(col, orbitCol, uOrbit);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export const SKY = {
  zenith: new THREE.Color('#4f86c9'),
  mid: new THREE.Color('#9cc4e6'),
  horizon: new THREE.Color('#f7cfa6'),
  below: new THREE.Color('#e9c3a8'),
  sun: new THREE.Color('#ffd9a0'),
  cloudLight: new THREE.Color('#fff4e6'),
  cloudShade: new THREE.Color('#c9b3d9'),
  fog: new THREE.Color('#e7cdb4'),
  space: new THREE.Color('#7489c6'),
  spaceDeep: new THREE.Color('#2e3a6b'),
};

export class GRARenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.05, 2000);
  readonly sun = new THREE.DirectionalLight(0xffffff, 1);
  readonly sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  readonly fog = new THREE.FogExp2(SKY.fog.getHex(), 0.0085);
  readonly sunDir = new THREE.Vector3(0, 1, 0);
  quality: Quality;
  private shadowExtent = 26;
  private readonly fixedTangent = new THREE.Vector3(0.62, 0.22, -0.75).normalize();

  constructor(readonly canvas: HTMLCanvasElement, quality: Quality = 'HIGH') {
    this.quality = quality;
    const q = QUALITY[quality];
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: q.antialias, powerPreference: 'high-performance', alpha: false, stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = q.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false;
    this.scene.fog = this.fog;
    this.scene.background = SKY.fog.clone();

    this.sun.castShadow = q.shadows;
    this.sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
    this.sun.shadow.radius = q.shadowRadius;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.035;
    const cam = this.sun.shadow.camera;
    cam.left = -this.shadowExtent;
    cam.right = this.shadowExtent;
    cam.top = this.shadowExtent;
    cam.bottom = -this.shadowExtent;
    cam.near = 1;
    cam.far = 140;
    this.scene.add(this.sun, this.sun.target);

    const skyMat = new THREE.ShaderMaterial({
      name: 'GRASky',
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      uniforms: {
        uUp: { value: new THREE.Vector3(0, 1, 0) },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uZenith: { value: SKY.zenith },
        uMid: { value: SKY.mid },
        uHorizon: { value: SKY.horizon },
        uBelow: { value: SKY.below },
        uSunColor: { value: SKY.sun },
        uCloudLight: { value: SKY.cloudLight },
        uCloudShade: { value: SKY.cloudShade },
        uTime: { value: 0 },
        uOrbit: { value: 0 },
        uLimb: { value: 1.57 },
        uSpace: { value: SKY.space },
        uSpaceDeep: { value: SKY.spaceDeep },
      },
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), skyMat);
    this.sky.renderOrder = -1000;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
    this.resize();
  }

  setQuality(q: Quality): void {
    this.quality = q;
    const cfg = QUALITY[q];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cfg.pixelRatio));
    this.sun.shadow.mapSize.set(cfg.shadowMap, cfg.shadowMap);
    this.sun.shadow.radius = cfg.shadowRadius;
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    this.resize();
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY[this.quality].pixelRatio));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  /**
   * Sun for a focus point: elevation ≈ 32° where the fixed tangent field is strong, rising toward noon where it
   * vanishes (two points on the planet). Continuous everywhere; never night.
   */
  updateSun(focus: THREE.Vector3, time: number): void {
    const up = focus.clone().normalize();
    const t = this.fixedTangent.clone().addScaledVector(up, -this.fixedTangent.dot(up));
    this.sunDir.copy(up).multiplyScalar(0.62).add(t).normalize();
    const texel = (this.shadowExtent * 2) / this.sun.shadow.mapSize.x;
    // Light space basis to snap the focus to texel increments.
    const lz = this.sunDir.clone().negate();
    const lx = new THREE.Vector3().crossVectors(up, lz).normalize();
    if (lx.lengthSq() < 1e-6) lx.set(1, 0, 0);
    const ly = new THREE.Vector3().crossVectors(lz, lx);
    const fx = Math.round(focus.dot(lx) / texel) * texel;
    const fy = Math.round(focus.dot(ly) / texel) * texel;
    const fz = focus.dot(lz);
    const snapped = lx.multiplyScalar(fx).add(ly.multiplyScalar(fy)).add(lz.multiplyScalar(fz));
    this.sun.target.position.copy(snapped);
    this.sun.position.copy(snapped).addScaledVector(this.sunDir, 70);
    this.sun.target.updateMatrixWorld();
    const u = this.sky.material.uniforms;
    u.uUp!.value.copy(this.camera.position).normalize();
    u.uSunDir!.value.copy(this.sunDir);
    u.uTime!.value = time;
  }

  /**
   * Atmosphere by camera altitude: the warm ground haze thins as the camera climbs (the planet must read from the
   * UFO) and the sky turns into the orbit dusk. Returns the orbit blend (0 on the ground, 1 in orbit).
   */
  setAltitude(planetRadius: number): number {
    const dist = this.camera.position.length();
    const alt = dist - planetRadius;
    this.fog.density = THREE.MathUtils.lerp(0.0085, 0.0011, THREE.MathUtils.smoothstep(alt, 14, 140));
    const orbit = THREE.MathUtils.smoothstep(alt, 30, 190);
    const u = this.sky.material.uniforms;
    u.uOrbit!.value = orbit;
    u.uLimb!.value = Math.asin(Math.min(1, planetRadius / Math.max(dist, planetRadius)));
    // Near plane: precise depth from afar, close-up framing on the ground.
    const near = alt > 30 ? 0.5 : 0.05;
    if (this.camera.near !== near) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
    return orbit;
  }

  render(): void {
    this.sky.position.copy(this.camera.position);
    this.renderer.info.reset();
    this.renderer.render(this.scene, this.camera);
  }
}
