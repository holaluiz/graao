/**
 * GRAStylizedMaterial: graao's small material family (one shader, variants by defines).
 *
 * Lighting is authored, not physical: one sun with a soft graphic ramp, warm sunlit color, cool shadow color, a
 * hemisphere fill whose "up" is the planet's local up per fragment, and Three's shadow map. World variant adds
 * watercolor-inspired pigment breakup (world-space), edge pooling and a soft paper dissolve for camera obstruction.
 * Character variant reads colors from a per-character palette (geometry never stores colors) and stays clean.
 */
import * as THREE from 'three';

/** Character palette size: the uniform array in both shaders and the slots `buildPalette` fills. */
export const PALETTE_SIZE = 32;

export const GLSL_NOISE = /* glsl */ `
float graHash3(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float graNoise3(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(graHash3(i + vec3(0, 0, 0)), graHash3(i + vec3(1, 0, 0)), f.x),
                 mix(graHash3(i + vec3(0, 1, 0)), graHash3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(graHash3(i + vec3(0, 0, 1)), graHash3(i + vec3(1, 0, 1)), f.x),
                 mix(graHash3(i + vec3(0, 1, 1)), graHash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float graFbm3(vec3 p) {
  return graNoise3(p) * 0.55 + graNoise3(p * 2.07 + 7.1) * 0.3 + graNoise3(p * 4.13 - 3.3) * 0.15;
}
float graHash2(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
`;

const vertex = /* glsl */ `
#include <common>
#include <color_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <fog_pars_vertex>

#ifdef USE_PALETTE
attribute float aSlot;
uniform vec3 uPalette[${PALETTE_SIZE}];
varying float vSoak;
#endif
#ifdef USE_INSTANCE_FADE
attribute float instanceFade;
#endif
#ifdef USE_TERRAIN
attribute float aHeight;
varying float vHeight;
#endif

uniform vec3 uBaseColor;

varying vec3 vBase;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vFade;
varying float vUnlit;

void main() {
  #include <color_vertex>
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  #include <project_vertex>

  vec4 worldPosition = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    worldPosition = instanceMatrix * worldPosition;
  #endif
  worldPosition = modelMatrix * worldPosition;
  vWorldPos = worldPosition.xyz;
  vWorldNormal = normalize(inverseTransformDirection(transformedNormal, viewMatrix));

  vBase = uBaseColor;
  vUnlit = 0.0;
  #if defined(USE_COLOR) || defined(USE_INSTANCING_COLOR)
    vBase *= vColor.rgb;
  #endif
  #ifdef USE_PALETTE
    int slot = int(aSlot + 0.5);
    vBase = uPalette[slot];
    vUnlit = (slot == 2 || slot == 3) ? 0.9 : 0.0;
    // How much a soaking darkens this part: cloth and hair fully, skin a little, eyes and ink not at all.
    vSoak = (slot == 2 || slot == 3) ? 0.0 : (slot == 0 || slot == 1 || slot == 15) ? 0.3 : 1.0;
  #endif
  vFade = 0.0;
  #ifdef USE_INSTANCE_FADE
    vFade = instanceFade;
  #endif
  #ifdef USE_TERRAIN
    vHeight = aHeight;
  #endif

  #include <shadowmap_vertex>
  #include <fog_vertex>
}
`;

const fragment = /* glsl */ `
#include <common>
#include <packing>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>

${GLSL_NOISE}

vec3 graRgb2Hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 graHsv2Rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

uniform vec3 uSunColor;
uniform vec3 uShadowTint;
uniform vec3 uSkyFill;
uniform vec3 uGroundFill;
uniform float uRampCenter;
uniform float uRampSoftness;
uniform float uPigment;
uniform float uPigmentScale;
uniform float uMacro;
uniform float uEdgePooling;
uniform float uRim;
uniform vec3 uRimColor;
uniform float uFade;
uniform float uTime;
uniform float uPlanetRadius;
uniform float uSeaLevel;

varying vec3 vBase;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vFade;
varying float vUnlit;
#ifdef USE_TERRAIN
varying float vHeight;
uniform vec3 uGrassColor;
uniform vec3 uGrassDry;
uniform vec3 uSandColor;
uniform vec3 uRockColor;
uniform vec3 uCliffColor;
#endif
#ifdef USE_PALETTE
varying float vSoak;
uniform float uWet;
uniform float uWetLine;
uniform vec3 uFeet;
uniform vec3 uBodyUp;
#endif

void main() {
  vec3 N = normalize(vWorldNormal);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 up = normalize(vWorldPos);
  vec3 base = vBase;

  // Wet (characters out of the water): soaked below the line the water reached, darker and richer, drying over time.
  float wet = 0.0;
  #ifdef USE_PALETTE
    if (uWet > 0.001) {
      float hb = dot(vWorldPos - uFeet, uBodyUp) + (graNoise3(vWorldPos * 11.0) - 0.5) * 0.07;
      wet = uWet * (1.0 - smoothstep(uWetLine - 0.04, uWetLine + 0.04, hb));
      base = mix(base, pow(base, vec3(1.35)) * 0.8, wet * vSoak);
    }
  #endif

  #ifdef USE_TERRAIN
    // Terrain coloring from height and slope, broken up by large world-space pigment patches.
    float slope = 1.0 - clamp(dot(N, up), 0.0, 1.0);
    float patches = graFbm3(vWorldPos * 0.055);
    float fine = graNoise3(vWorldPos * 0.6);
    vec3 grass = mix(uGrassColor, uGrassDry, smoothstep(0.5, 0.72, patches) * 0.8);
    grass = mix(grass, uGrassColor * vec3(0.82, 0.95, 0.9), smoothstep(0.45, 0.25, patches) * 0.6);
    float sand = 1.0 - smoothstep(0.1, 0.65, vHeight - uSeaLevel + (fine - 0.5) * 0.35);
    base = mix(grass, uSandColor, sand);
    float rocky = smoothstep(0.32, 0.5, slope + (patches - 0.5) * 0.25);
    base = mix(base, mix(uRockColor, uCliffColor, smoothstep(0.55, 0.8, slope)), rocky);
    base *= 0.94 + 0.12 * fine;
  #endif

  // Sun: soft graphic ramp × shadow map.
  float ndl = 0.6;
  float shadow = 1.0;
  vec3 L = up;
  #if NUM_DIR_LIGHTS > 0
    L = normalize(inverseTransformDirection(directionalLights[0].direction, viewMatrix));
    float sunFacing = dot(N, L);
    #ifdef USE_PALETTE
      // Characters are lit for the camera (a portrait key light): mostly the sun, raised, and pulled toward the view, so
      // faces read and the shade wraps the far side of the body instead of cutting across the face.
      L = normalize(L * 0.4 + up * 0.3 + V * 0.75);
    #endif
    ndl = dot(N, L);
    #if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
      shadow = receiveShadow ? getShadow(directionalShadowMap[0], directionalLightShadows[0].shadowMapSize, directionalLightShadows[0].shadowIntensity, directionalLightShadows[0].shadowBias, directionalLightShadows[0].shadowRadius, vDirectionalShadowCoord[0]) : 1.0;
    #endif
  #endif
  #ifdef USE_PALETTE
    #if NUM_DIR_LIGHTS > 0
      // The real sun's shadow map only where the surface faces that sun (shade from trees and houses); on the far side
      // it would only be the body shadowing itself, which the portrait light already shapes.
      shadow = mix(1.0, shadow, smoothstep(0.05, 0.35, sunFacing));
    #endif
  #endif
  float lit = smoothstep(uRampCenter - uRampSoftness, uRampCenter + uRampSoftness, ndl) * shadow;

  // Watercolor pigment: large soft value/hue breakup in world space (never on characters).
  #ifdef USE_PIGMENT
    float pg = graFbm3(vWorldPos * uPigmentScale);
    base *= 1.0 + (pg - 0.5) * uPigment;
    float macro = graNoise3(vWorldPos * 0.018);
    base = mix(base, base * vec3(1.06, 0.98, 0.9), (macro - 0.5) * uMacro * 2.0);
  #endif

  // Two flat tones, like ink and wash: the lit color, and a shadow color that is the same pigment darker, a touch
  // warmer in hue and richer (HSV), plus a little cool sky bounce on surfaces facing up.
  float hemi = dot(N, up) * 0.5 + 0.5;
  vec3 hsv = graRgb2Hsv(base);
  hsv.x = fract(hsv.x - 0.02 + 1.0);
  hsv.y = min(1.0, hsv.y * 1.12);
  hsv.z *= 0.6;
  vec3 shade = graHsv2Rgb(hsv) * uShadowTint + base * mix(uGroundFill, uSkyFill, hemi) * 0.08;
  vec3 sun = base * uSunColor;
  vec3 col = mix(shade, sun, lit);

  // Edge pooling: pigment gathers where surfaces turn away (watercolor), a light rim on characters.
  float rim = 1.0 - clamp(dot(N, V), 0.0, 1.0);
  col *= 1.0 - uEdgePooling * smoothstep(0.5, 1.0, rim);
  col += uRimColor * uRim * smoothstep(0.6, 1.0, rim) * (0.35 + 0.65 * lit);
  if (wet > 0.001) {
    // Wet sheen: crisp painted sun glints and a cool rim of reflected sky.
    float spec = pow(max(dot(N, normalize(L + V)), 0.0), 40.0);
    col += vec3(1.0, 0.97, 0.9) * smoothstep(0.3, 0.55, spec) * 0.4 * wet * (0.3 + 0.7 * shadow);
    col += vec3(0.62, 0.8, 1.0) * smoothstep(0.55, 1.0, rim) * 0.22 * wet;
  }

  col = mix(col, base, vUnlit);

  // Paper dissolve for obstruction (instance fade or material fade).
  float fade = max(vFade, uFade);
  if (fade > 0.001) {
    float paper = graNoise3(vec3(gl_FragCoord.xy * 0.11, 0.0)) * 0.6 + graHash2(floor(gl_FragCoord.xy * 0.5)) * 0.4;
    if (paper < fade) discard;
  }

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export interface GRAStylizedOptions {
  variant: 'world' | 'character' | 'terrain' | 'foliage';
  color?: THREE.ColorRepresentation;
  vertexColors?: boolean;
  instanceFade?: boolean;
  pigment?: number;
  edgePooling?: number;
  side?: THREE.Side;
}

/** Look constants shared by every GRAStylizedMaterial (golden hour). */
export const LOOK = {
  sun: new THREE.Color('#fff7ea'),
  /** Multiplies the HSV shadow color (a faint cool cast keeps shade from going muddy). */
  shadowTint: new THREE.Color('#eef4ff'),
  skyFill: new THREE.Color('#bfe6ef'),
  groundFill: new THREE.Color('#d8c9a8'),
  rimWarm: new THREE.Color('#ffd7a3'),
};

export function createStylizedMaterial(o: GRAStylizedOptions): THREE.ShaderMaterial {
  const defines: Record<string, string> = {};
  if (o.variant === 'character') defines.USE_PALETTE = '';
  if (o.variant === 'world' || o.variant === 'terrain' || o.variant === 'foliage') defines.USE_PIGMENT = '';
  if (o.variant === 'terrain') defines.USE_TERRAIN = '';
  if (o.instanceFade) defines.USE_INSTANCE_FADE = '';

  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.lights,
    THREE.UniformsLib.fog,
    {
      uBaseColor: { value: new THREE.Color(o.color ?? '#ffffff') },
      uPalette: { value: Array.from({ length: PALETTE_SIZE }, () => new THREE.Color('#ff00ff')) },
      uSunColor: { value: LOOK.sun.clone() },
      uShadowTint: { value: LOOK.shadowTint.clone() },
      uSkyFill: { value: LOOK.skyFill.clone() },
      uGroundFill: { value: LOOK.groundFill.clone() },
      // Characters: a hard cut between light and shade (graphic); the world a little softer so moving shadows ease.
      uRampCenter: { value: o.variant === 'character' ? -0.12 : 0.04 },
      uRampSoftness: { value: o.variant === 'character' ? 0.02 : o.variant === 'foliage' ? 0.14 : 0.06 },
      uPigment: { value: o.pigment ?? (o.variant === 'terrain' ? 0.12 : 0.06) },
      uPigmentScale: { value: o.variant === 'foliage' ? 0.35 : 0.22 },
      uMacro: { value: o.variant === 'character' ? 0 : 0.2 },
      uEdgePooling: { value: o.edgePooling ?? 0.0 },
      uRim: { value: 0.0 },
      uRimColor: { value: LOOK.rimWarm.clone() },
      uFade: { value: 0 },
      uTime: { value: 0 },
      uPlanetRadius: { value: 100 },
      uSeaLevel: { value: -0.7 },
      uWet: { value: 0 },
      uWetLine: { value: 0 },
      uFeet: { value: new THREE.Vector3() },
      uBodyUp: { value: new THREE.Vector3(0, 1, 0) },
      uGrassColor: { value: new THREE.Color('#69ad55') },
      uGrassDry: { value: new THREE.Color('#a6c46a') },
      uSandColor: { value: new THREE.Color('#ead9b0') },
      uRockColor: { value: new THREE.Color('#a7a49a') },
      uCliffColor: { value: new THREE.Color('#8c8a86') },
    },
  ]);

  const m = new THREE.ShaderMaterial({
    name: `GRAStylized/${o.variant}`,
    uniforms,
    vertexShader: vertex,
    fragmentShader: fragment,
    defines,
    lights: true,
    fog: true,
    vertexColors: o.vertexColors ?? false,
    side: o.side ?? THREE.FrontSide,
  });
  return m;
}

/** Writes a palette (linear colors) into a character material. */
export function setPalette(m: THREE.ShaderMaterial, colors: THREE.Color[]): void {
  const pal = m.uniforms.uPalette!.value as THREE.Color[];
  for (let i = 0; i < pal.length; i++) pal[i]!.copy(colors[i] ?? pal[i]!);
}

/**
 * Wetness of a character material: `amount` 0 (dry) … 1 (soaked), below `line` m above the feet; `feet`/`up` place
 * that line on the body in world space (set every frame with the pose).
 */
export function setWetness(m: THREE.ShaderMaterial, amount: number, line: number, feet: THREE.Vector3, up: THREE.Vector3): void {
  const u = m.uniforms;
  u.uWet!.value = amount;
  u.uWetLine!.value = line;
  (u.uFeet!.value as THREE.Vector3).copy(feet);
  (u.uBodyUp!.value as THREE.Vector3).copy(up);
}

// ------------------------------------------------------------------------------------------------ outline

const outlineVertex = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
#include <fog_pars_vertex>
attribute float aSlot;
attribute float aOutline;
uniform vec3 uPalette[${PALETTE_SIZE}];
uniform float uWidth;
varying vec3 vInk;
void main() {
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
  vec3 vn = normalize(normalMatrix * objectNormal);
  // Roughly constant on-screen width, never thicker than ~1.4 cm in the world.
  float w = uWidth * aOutline * clamp(-mvPosition.z, 1.0, 12.0) * 0.0042;
  w = min(w, 0.014 * aOutline);
  mvPosition.xyz += vn * w;
  gl_Position = projectionMatrix * mvPosition;
  vec3 base = uPalette[int(aSlot + 0.5)];
  vInk = mix(base * 0.28, vec3(0.13, 0.09, 0.14), 0.55);
  #include <fog_vertex>
}
`;

const outlineFragment = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float uFade;
varying vec3 vInk;
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
void main() {
  if (uFade > 0.001 && h2(floor(gl_FragCoord.xy * 0.5)) < uFade) discard;
  gl_FragColor = vec4(vInk, 1.0);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** Inverted-hull ink outline for characters (shares the palette uniform array with the color material). */
export function createOutlineMaterial(palette: THREE.Color[]): THREE.ShaderMaterial {
  // The palette array is shared by reference with the color material, so color changes reach both.
  return new THREE.ShaderMaterial({
    name: 'GRAOutline',
    uniforms: { ...THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uWidth: { value: 1.0 }, uFade: { value: 0 } }]), uPalette: { value: palette } },
    vertexShader: outlineVertex,
    fragmentShader: outlineFragment,
    side: THREE.BackSide,
    fog: true,
  });
}
