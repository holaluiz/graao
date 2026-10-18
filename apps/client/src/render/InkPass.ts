/**
 * InkPass: drawn outlines as a screen-space post process (the "comic panel" look).
 *
 * The scene renders into a color target; then every inked mesh (anything drawn with a GRAStylized material: terrain,
 * props, characters, weapons, the UFO) renders again with one override material into an INFO target:
 *   r = view depth (m), gb = view-space normal xy, a = surface id (signed: negative = no ink here).
 * A full-screen pass finds discontinuities of depth (silhouettes, steps), normal (creases) and surface id (where two
 * garments, a window and its wall, or two canopy masses meet) and draws a dark slate line there, broken up by
 * world-space noise on the world so lines read hand-drawn, solid on characters. Surface ids come from the character
 * palette slot or, on props, from the flat vertex color of each piece.
 */
import * as THREE from 'three';
import { GLSL_NOISE } from './materials/GRAStylizedMaterial';

/** Whether the post-process outline is live (meshes skip their own inverted-hull ink when it is). */
export const INK_STATE = { post: false };

/** Layer of the meshes the info pass draws (enabled on top of layer 0, so the main camera still sees them). */
export const INK_LAYER = 5;

const infoVertex = /* glsl */ `
#include <common>
#include <color_pars_vertex>
#include <skinning_pars_vertex>
attribute float aSlot;
attribute float aOutline;
attribute float instanceFade;
varying vec3 vViewN;
varying float vDepth;
varying vec3 vWPos;
varying float vSlot;
varying float vFade;
void main() {
  #include <color_vertex>
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  vViewN = normalize(transformedNormal);
  vDepth = -mvPosition.z;
  vec4 wp = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    wp = instanceMatrix * wp;
  #endif
  vWPos = (modelMatrix * wp).xyz;
  // Face decals (no outline weight) and soft marks (blush, freckles, lips, stubble) belong to the skin: no ink.
  int slot = int(aSlot + 0.5);
  vSlot = (aSlot > -0.5 && (aOutline < 0.01 || slot == 1 || slot == 14 || slot == 15 || slot == 21)) ? 0.0 : aSlot;
  vFade = instanceFade;
}
`;

const infoFragment = /* glsl */ `
varying vec3 vViewN;
varying float vDepth;
varying vec3 vWPos;
varying float vSlot;
varying float vFade;
varying vec4 vColor;
${GLSL_NOISE}
void main() {
  // Same paper dissolve as the color pass, so a faded obstruction loses its ink with it.
  if (vFade > 0.001) {
    float paper = graNoise3(vec3(gl_FragCoord.xy * 0.11, 0.0)) * 0.6 + graHash2(floor(gl_FragCoord.xy * 0.5)) * 0.4;
    if (paper < vFade) discard;
  }
  vec3 n = normalize(vViewN);
  if (!gl_FrontFacing) n = -n;
  float id;
  float ink = 1.0;
  if (vSlot > -0.5) {
    // Characters: one id per palette slot (skin, top, bottom, shoes, hair…), almost unbroken lines.
    id = 0.02 + floor(vSlot + 0.5) * 0.01;
    ink = step(0.12, graNoise3(vWPos * 34.0));
  } else {
    // Props: one id per flat piece color; lines broken by large world-space noise (hand-drawn, never ruled).
    vec3 q = floor(vColor.rgb * 255.0 + 0.5);
    id = 0.5 + 0.5 * fract(sin(dot(q, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    float b = graNoise3(vWPos * 0.9) * graNoise3(vWPos * 0.37 + 11.0);
    ink = step(0.07, b);
  }
  gl_FragColor = vec4(vDepth, n.xy, ink > 0.5 ? id : -id);
}
`;

const quadVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const quadFragment = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tInfo;
uniform vec2 uTexel;
uniform float uThick;
uniform vec3 uInk;
uniform vec2 uFade;
uniform float uStrength;
varying vec2 vUv;

struct S { float d; vec3 n; float id; float ink; };
S info(vec2 uv) {
  vec4 t = texture2D(tInfo, uv);
  S s;
  bool sky = t.r <= 0.0;
  s.d = sky ? 1e4 : t.r;
  s.n = vec3(t.g, t.b, sqrt(max(0.0, 1.0 - t.g * t.g - t.b * t.b)));
  s.id = sky ? 0.0 : abs(t.a);
  s.ink = (sky || t.a < 0.0) ? 0.0 : 1.0;
  return s;
}

void main() {
  vec4 scene = texture2D(tColor, vUv);
  vec2 o = uTexel * uThick;
  S c = info(vUv);
  S l = info(vUv - vec2(o.x, 0.0));
  S r = info(vUv + vec2(o.x, 0.0));
  S d = info(vUv - vec2(0.0, o.y));
  S u = info(vUv + vec2(0.0, o.y));

  // Depth: second difference (planes vanish, steps and silhouettes stay), relative to the distance and relaxed on
  // surfaces seen edge-on (their depth curves fast across the screen).
  float lap = abs(l.d + r.d - 2.0 * c.d) + abs(d.d + u.d - 2.0 * c.d);
  float grazing = mix(4.0, 1.0, smoothstep(0.08, 0.5, c.n.z));
  float depthEdge = smoothstep(0.012, 0.03, lap / (c.d * grazing));

  // Creases: the normal turns sharply between neighbours.
  float nd = max(max(1.0 - dot(c.n, l.n), 1.0 - dot(c.n, r.n)), max(1.0 - dot(c.n, d.n), 1.0 - dot(c.n, u.n)));
  float normalEdge = smoothstep(0.16, 0.32, nd);

  // Surface id changes: garment against skin, window against wall.
  float di = max(max(abs(c.id - l.id), abs(c.id - r.id)), max(abs(c.id - d.id), abs(c.id - u.id)));
  float idEdge = step(0.002, di);

  // The nearest sample owns the line (its ink mask, its distance fade).
  float nd0 = c.d;
  float inkMask = c.ink;
  if (l.d < nd0) { nd0 = l.d; inkMask = l.ink; }
  if (r.d < nd0) { nd0 = r.d; inkMask = r.ink; }
  if (d.d < nd0) { nd0 = d.d; inkMask = d.ink; }
  if (u.d < nd0) { nd0 = u.d; inkMask = u.ink; }
  float fade = 1.0 - smoothstep(uFade.x, uFade.y, nd0);
  float line = clamp(depthEdge + normalEdge + idEdge, 0.0, 1.0) * inkMask * fade * uStrength;

  vec3 ink = mix(uInk, scene.rgb * 0.3, 0.2);
  gl_FragColor = vec4(mix(scene.rgb, ink, line), 1.0);
  #include <colorspace_fragment>
}
`;

export class InkPass {
  readonly enabled: boolean;
  private readonly color: THREE.WebGLRenderTarget;
  private readonly info: THREE.WebGLRenderTarget;
  private readonly infoMaterial: THREE.ShaderMaterial;
  private readonly quad: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly size = new THREE.Vector2();
  private readonly clear = new THREE.Color();

  constructor(private readonly renderer: THREE.WebGLRenderer, samples: number) {
    const ext = renderer.extensions;
    this.enabled = ext.has('EXT_color_buffer_float');
    INK_STATE.post = this.enabled;
    this.color = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples, depthBuffer: true });
    this.info = new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType, depthBuffer: true, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.infoMaterial = new THREE.ShaderMaterial({ name: 'GRAInkInfo', vertexShader: infoVertex, fragmentShader: infoFragment, side: THREE.DoubleSide, vertexColors: true });
    // Pieces without the attribute: no palette slot, white, never faded.
    (this.infoMaterial as unknown as { defaultAttributeValues: Record<string, number[]> }).defaultAttributeValues = {
      color: [1, 1, 1],
      uv: [0, 0],
      uv1: [0, 0],
      aSlot: [-1],
      aOutline: [1],
      instanceFade: [0],
    };
    this.quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        name: 'GRAInkComposite',
        vertexShader: quadVertex,
        fragmentShader: quadFragment,
        uniforms: {
          tColor: { value: this.color.texture },
          tInfo: { value: this.info.texture },
          uTexel: { value: new THREE.Vector2(1, 1) },
          uThick: { value: 1 },
          uInk: { value: new THREE.Color('#373f42') },
          uFade: { value: new THREE.Vector2(45, 140) },
          uStrength: { value: 0.92 },
        },
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.quad.frustumCulled = false;
  }

  setSize(): void {
    this.renderer.getDrawingBufferSize(this.size);
    const w = Math.max(1, Math.floor(this.size.x));
    const h = Math.max(1, Math.floor(this.size.y));
    this.color.setSize(w, h);
    this.info.setSize(w, h);
    const u = this.quad.material.uniforms;
    (u.uTexel!.value as THREE.Vector2).set(1 / w, 1 / h);
    // About 1 px at 900 px tall, scaling with the drawing buffer (DPR and window height).
    u.uThick!.value = Math.max(1, h / 760);
  }

  /** Puts every mesh drawn with a GRAStylized material on the ink layer (cheap; runs every frame for new objects). */
  private tag(scene: THREE.Scene): void {
    scene.traverseVisible((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.ShaderMaterial;
      const stylized = !Array.isArray(mat) && typeof mat.name === 'string' && mat.name.startsWith('GRAStylized');
      // A character faded out by the camera (too close) leaves the ink pass too.
      const faded = stylized && (mat.uniforms?.uFade?.value ?? 0) > 0.4;
      if (stylized && !faded) m.layers.enable(INK_LAYER);
      else m.layers.disable(INK_LAYER);
    });
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    const r = this.renderer;
    // 1. Color.
    r.setRenderTarget(this.color);
    r.render(scene, camera);

    // 2. Info (no shadows re-render, no background, no fog).
    this.tag(scene);
    const background = scene.background;
    const autoShadow = r.shadowMap.autoUpdate;
    const mask = camera.layers.mask;
    r.getClearColor(this.clear);
    const alpha = r.getClearAlpha();
    scene.background = null;
    scene.overrideMaterial = this.infoMaterial;
    r.shadowMap.autoUpdate = false;
    camera.layers.set(INK_LAYER);
    r.setRenderTarget(this.info);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, false);
    r.render(scene, camera);
    camera.layers.mask = mask;
    r.shadowMap.autoUpdate = autoShadow;
    scene.overrideMaterial = null;
    scene.background = background;
    r.setClearColor(this.clear, alpha);

    // 3. Composite to the screen.
    r.setRenderTarget(null);
    r.render(this.quad, this.quadCamera);
  }

  dispose(): void {
    this.color.dispose();
    this.info.dispose();
    this.infoMaterial.dispose();
    this.quad.material.dispose();
    this.quad.geometry.dispose();
  }
}
