/**
 * PlanetView: renders the shared GameWorld — terrain chunks (one per icosahedron face, frustum-culled), a light
 * translucent water sphere, instanced props (one InstancedMesh per prop type/variant with a per-instance fade for the
 * obstruction dissolve) and grass tufts that bend around the local player (never networked).
 */
import * as THREE from 'three';
import { PLANET } from '@graao/game-data';
import type { GameWorld, Placement, PlacementKind } from '@graao/game-core';
import { createStylizedMaterial, GLSL_NOISE } from '../render/materials/GRAStylizedMaterial';
import type { Quality } from '../render/GRARenderer';
import * as G from './propGeometry';

export interface PropInstanceRef {
  mesh: THREE.InstancedMesh;
  index: number;
  placement: Placement;
}

const WATER_VERTEX = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
uniform float uTime;
varying vec3 vWorldPos;
varying vec3 vNormalW;
void main() {
  vec3 p = position;
  vec3 n = normalize(p);
  float w = sin(dot(p, vec3(0.31, 0.17, 0.23)) + uTime * 0.9) * 0.06 + sin(dot(p, vec3(-0.21, 0.29, 0.13)) * 1.7 + uTime * 1.3) * 0.04;
  p += n * w;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorldPos = wp.xyz;
  vNormalW = n;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const WATER_FRAGMENT = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float uTime;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uSky;
uniform vec3 uSunDir;
varying vec3 vWorldPos;
varying vec3 vNormalW;
${GLSL_NOISE}
void main() {
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 N = normalize(vNormalW + (vec3(graNoise3(vWorldPos * 0.6 + uTime * 0.3), graNoise3(vWorldPos * 0.6 - uTime * 0.25 + 9.0), 0.5) - 0.5) * 0.18);
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
  vec3 col = mix(uShallow, uDeep, 0.55 + 0.45 * graNoise3(vWorldPos * 0.05));
  col = mix(col, uSky, fres * 0.65);
  // Painted glints: thresholded noise lit by the sun.
  float g = smoothstep(0.78, 0.86, graNoise3(vWorldPos * 1.4 + vec3(uTime * 0.4, 0.0, uTime * 0.3)));
  col += vec3(1.0, 0.95, 0.85) * g * 0.35 * max(dot(reflect(-V, N), uSunDir), 0.0);
  gl_FragColor = vec4(col, 0.82 + fres * 0.15);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

const GRASS_VERTEX = /* glsl */ `
#include <common>
#include <shadowmap_pars_vertex>
#include <fog_pars_vertex>
attribute float aTip;
uniform float uTime;
uniform vec3 uPlayer;
uniform float uFadeDist;
varying float vTip;
varying vec3 vWorldPos;
varying vec3 vNormalW;
varying float vDistFade;
void main() {
  vTip = aTip;
  vec4 root = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec4 worldPosition = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vec3 up = normalize(root.xyz);
  // Wind sway.
  float sway = sin(uTime * 1.7 + root.x * 0.35 + root.z * 0.27) * 0.06 + sin(uTime * 2.9 + root.y * 0.5) * 0.03;
  vec3 tangent = normalize(cross(up, vec3(0.3, 0.9, 0.2)));
  worldPosition.xyz += tangent * sway * aTip * aTip;
  // Bend away from the local player.
  vec3 toBlade = worldPosition.xyz - uPlayer;
  vec3 flatDir = toBlade - up * dot(toBlade, up);
  float d = length(flatDir);
  float bend = (1.0 - smoothstep(0.25, 1.1, d)) * aTip;
  worldPosition.xyz += normalize(flatDir + 1e-4) * bend * 0.32 - up * bend * 0.18;
  vWorldPos = worldPosition.xyz;
  vNormalW = up;
  float camDist = distance(cameraPosition, root.xyz);
  vDistFade = smoothstep(uFadeDist, uFadeDist * 0.75, camDist);
  // Shrink far tufts to nothing (cheap LOD).
  worldPosition.xyz = mix(root.xyz, worldPosition.xyz, vDistFade);
  vec4 mvPosition = viewMatrix * worldPosition;
  gl_Position = projectionMatrix * mvPosition;
  vec3 transformedNormal = normalMatrix * vec3(0.0, 1.0, 0.0);
  #include <shadowmap_vertex>
  #include <fog_vertex>
}
`;

const GRASS_FRAGMENT = /* glsl */ `
#include <common>
#include <packing>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
uniform vec3 uRoot;
uniform vec3 uTipColor;
uniform vec3 uDry;
uniform vec3 uSunColor;
uniform vec3 uShadowTint;
varying float vTip;
varying vec3 vWorldPos;
varying vec3 vNormalW;
varying float vDistFade;
${GLSL_NOISE}
void main() {
  float patchN = graFbm3(vWorldPos * 0.055);
  vec3 base = mix(uRoot, uTipColor, vTip);
  base = mix(base, uDry, smoothstep(0.45, 0.7, patchN) * 0.6 * vTip);
  float shadow = 1.0;
  #if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
    shadow = getShadow(directionalShadowMap[0], directionalLightShadows[0].shadowMapSize, directionalLightShadows[0].shadowIntensity, directionalLightShadows[0].shadowBias, directionalLightShadows[0].shadowRadius, vDirectionalShadowCoord[0]);
  #endif
  float lit = mix(0.35, 1.0, shadow) * (0.7 + 0.3 * vTip);
  vec3 col = mix(base * uShadowTint, base * uSunColor, lit);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export class PlanetView {
  readonly group = new THREE.Group();
  readonly terrainMaterial = createStylizedMaterial({ variant: 'terrain' });
  readonly propMaterial = createStylizedMaterial({ variant: 'world', vertexColors: true, instanceFade: true });
  readonly foliageMaterial = createStylizedMaterial({ variant: 'foliage', vertexColors: true, instanceFade: true });
  readonly crystalMaterial = createStylizedMaterial({ variant: 'world', vertexColors: true, instanceFade: true, edgePooling: -0.25 });
  readonly water: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly grassMaterial: THREE.ShaderMaterial;
  /** Placement id → instance (solid props only), for camera obstruction fades. */
  readonly instances = new Map<number, PropInstanceRef>();
  readonly instancedMeshes: THREE.InstancedMesh[] = [];
  private readonly fades = new Map<THREE.InstancedMesh, Float32Array>();
  stats = { terrainTris: 0, propInstances: 0, grassInstances: 0, drawGroups: 0 };

  constructor(private readonly world: GameWorld, quality: Quality) {
    this.group.name = 'Planet';
    this.terrainMaterial.uniforms.uSeaLevel!.value = PLANET.seaLevel;
    this.buildTerrain();
    this.water = this.buildWater();
    this.grassMaterial = this.buildGrassMaterial();
    this.buildProps(quality);
  }

  private buildTerrain(): void {
    const m = this.world.mesh;
    // Split by icosahedron face for frustum culling; vertices are copied per chunk with the global smooth normals.
    for (let face = 0; face < 20; face++) {
      const remap = new Map<number, number>();
      const pos: number[] = [];
      const nor: number[] = [];
      const hgt: number[] = [];
      const idx: number[] = [];
      for (let t = 0; t < m.indices.length / 3; t++) {
        if (m.triangleFace[t] !== face) continue;
        for (let k = 0; k < 3; k++) {
          const v = m.indices[t * 3 + k]!;
          let id = remap.get(v);
          if (id === undefined) {
            id = pos.length / 3;
            remap.set(v, id);
            pos.push(m.positions[v * 3]!, m.positions[v * 3 + 1]!, m.positions[v * 3 + 2]!);
            nor.push(m.normals[v * 3]!, m.normals[v * 3 + 1]!, m.normals[v * 3 + 2]!);
            hgt.push(m.heights[v]!);
          }
          idx.push(id);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('aHeight', new THREE.Float32BufferAttribute(hgt, 1));
      g.setIndex(idx);
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, this.terrainMaterial);
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      mesh.name = `terrain_${face}`;
      this.group.add(mesh);
      this.stats.terrainTris += idx.length / 3;
    }
  }

  private buildWater(): THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> {
    const g = new THREE.IcosahedronGeometry(this.world.terrain.seaRadius, 24);
    const mat = new THREE.ShaderMaterial({
      name: 'GRAWater',
      vertexShader: WATER_VERTEX,
      fragmentShader: WATER_FRAGMENT,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uShallow: { value: new THREE.Color('#5fc4c4') },
          uDeep: { value: new THREE.Color('#2f7fa8') },
          uSky: { value: new THREE.Color('#bfe0f0') },
          uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        },
      ]),
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = 'water';
    mesh.renderOrder = 10;
    this.group.add(mesh);
    return mesh;
  }

  private buildGrassMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      name: 'GRAGrass',
      vertexShader: GRASS_VERTEX,
      fragmentShader: GRASS_FRAGMENT,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.lights,
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uPlayer: { value: new THREE.Vector3() },
          uFadeDist: { value: 34 },
          uRoot: { value: new THREE.Color('#5a9a46') },
          uTipColor: { value: new THREE.Color('#a8d468') },
          uDry: { value: new THREE.Color('#d9c873') },
          uSunColor: { value: new THREE.Color('#ffe2b8') },
          uShadowTint: { value: new THREE.Color('#8f9ab8') },
        },
      ]),
      lights: true,
      fog: true,
      side: THREE.DoubleSide,
    });
  }

  private buildProps(quality: Quality): void {
    const byKey = new Map<string, Placement[]>();
    const keyOf = (p: Placement) => {
      switch (p.kind) {
        case 'tree':
        case 'rock':
        case 'bush':
        case 'pine':
          return `${p.kind}:${p.variant % 3}`;
        case 'house':
          return `house:${p.variant % 3}`;
        default:
          return p.kind;
      }
    };
    const grassFraction = quality === 'LOW' ? 0.35 : quality === 'MEDIUM' ? 0.7 : 1;
    for (const p of this.world.layout.placements) {
      if (p.kind === 'grass' || p.kind === 'flower') continue;
      const k = keyOf(p);
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k)!.push(p);
    }
    const geometryFor = (key: string): { g: THREE.BufferGeometry; mat: THREE.Material } => {
      const [kind, v] = key.split(':') as [PlacementKind, string | undefined];
      const variant = Number(v ?? 0);
      switch (kind) {
        case 'tree':
          return { g: G.treeGeometry(variant), mat: this.foliageMaterial };
        case 'pine':
          return { g: G.pineGeometry(variant), mat: this.foliageMaterial };
        case 'rock':
          return { g: G.rockGeometry(variant), mat: this.propMaterial };
        case 'bush':
          return { g: G.bushGeometry(variant), mat: this.foliageMaterial };
        case 'house':
          return { g: G.houseGeometry(variant), mat: this.propMaterial };
        case 'tower':
          return { g: G.towerGeometry(), mat: this.propMaterial };
        case 'giant_tree':
          return { g: G.giantTreeGeometry(), mat: this.foliageMaterial };
        case 'arch':
          return { g: G.archGeometry(), mat: this.propMaterial };
        case 'crystal_cluster':
          return { g: G.crystalClusterGeometry(), mat: this.crystalMaterial };
        case 'floating_shard':
          return { g: G.floatingShardGeometry(), mat: this.propMaterial };
        case 'lamp':
          return { g: G.lampGeometry(), mat: this.propMaterial };
        case 'well':
          return { g: G.wellGeometry(), mat: this.propMaterial };
        case 'wall':
          return { g: G.wallGeometry(), mat: this.propMaterial };
        default:
          return { g: G.rockGeometry(0), mat: this.propMaterial };
      }
    };
    const m4 = new THREE.Matrix4();
    const basis = new THREE.Matrix4();
    const tint = new THREE.Color();
    for (const [key, list] of byKey) {
      const { g, mat } = geometryFor(key);
      const fade = new Float32Array(list.length);
      g.setAttribute('instanceFade', new THREE.InstancedBufferAttribute(fade, 1));
      const mesh = new THREE.InstancedMesh(g, mat, list.length);
      mesh.name = `props:${key}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      list.forEach((p, i) => {
        basis.makeBasis(
          new THREE.Vector3(p.side.x, p.side.y, p.side.z),
          new THREE.Vector3(p.up.x, p.up.y, p.up.z),
          new THREE.Vector3(p.forward.x, p.forward.y, p.forward.z),
        );
        m4.copy(basis).scale(new THREE.Vector3(p.scale, p.scale, p.scale)).setPosition(p.position.x, p.position.y, p.position.z);
        mesh.setMatrixAt(i, m4);
        const j = ((p.seed % 1000) / 1000 - 0.5) * 0.14;
        tint.setRGB(1 + j, 1 + j * 0.6, 1 - j * 0.4);
        mesh.setColorAt(i, tint);
        if (!p.visualOnly) this.instances.set(p.id, { mesh, index: i, placement: p });
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
      this.instancedMeshes.push(mesh);
      this.fades.set(mesh, fade);
      this.stats.propInstances += list.length;
    }

    // Grass and flowers: chunked by nearest icosahedron face for culling.
    const grass = this.world.layout.placements.filter((p) => p.kind === 'grass');
    const keepEvery = Math.max(1, Math.round(1 / grassFraction));
    this.buildChunkedInstances(grass.filter((_, i) => i % keepEvery === 0), G.grassTuftGeometry(), this.grassMaterial, 'grass', false);
    if (quality !== 'LOW') {
      const flowers = this.world.layout.placements.filter((p) => p.kind === 'flower');
      const fm = createStylizedMaterial({ variant: 'foliage', vertexColors: true });
      this.buildChunkedInstances(flowers, G.flowerGeometry(), fm, 'flowers', true);
    }
  }

  private buildChunkedInstances(list: Placement[], geo: THREE.BufferGeometry, mat: THREE.Material, name: string, colored: boolean): void {
    const centers = icosaFaceCenters();
    const chunks = new Map<number, Placement[]>();
    for (const p of list) {
      let best = 0;
      let bd = -2;
      for (let i = 0; i < centers.length; i++) {
        const d = centers[i]!.x * p.up.x + centers[i]!.y * p.up.y + centers[i]!.z * p.up.z;
        if (d > bd) {
          bd = d;
          best = i;
        }
      }
      if (!chunks.has(best)) chunks.set(best, []);
      chunks.get(best)!.push(p);
    }
    const m4 = new THREE.Matrix4();
    const palette = ['#ffffff', '#ffd36e', '#f29bb5', '#b9a6ff', '#ff9f6b'].map((c) => new THREE.Color(c));
    for (const [face, ps] of chunks) {
      const mesh = new THREE.InstancedMesh(geo, mat, ps.length);
      mesh.name = `${name}_${face}`;
      ps.forEach((p, i) => {
        m4.makeBasis(new THREE.Vector3(p.side.x, p.side.y, p.side.z), new THREE.Vector3(p.up.x, p.up.y, p.up.z), new THREE.Vector3(p.forward.x, p.forward.y, p.forward.z))
          .scale(new THREE.Vector3(p.scale, p.scale, p.scale))
          .setPosition(p.position.x, p.position.y, p.position.z);
        mesh.setMatrixAt(i, m4);
        if (colored) mesh.setColorAt(i, palette[p.seed % palette.length]!);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.stats.grassInstances += ps.length;
    }
  }

  /** Sets the dissolve target of a prop instance (0 = opaque, 1 = gone). */
  setInstanceFade(ref: PropInstanceRef, value: number): void {
    const arr = this.fades.get(ref.mesh)!;
    if (Math.abs(arr[ref.index]! - value) < 1e-3) return;
    arr[ref.index] = value;
    (ref.mesh.geometry.getAttribute('instanceFade') as THREE.InstancedBufferAttribute).needsUpdate = true;
  }

  getInstanceFade(ref: PropInstanceRef): number {
    return this.fades.get(ref.mesh)![ref.index]!;
  }

  update(time: number, player: THREE.Vector3, sunDir: THREE.Vector3): void {
    this.water.material.uniforms.uTime!.value = time;
    (this.water.material.uniforms.uSunDir!.value as THREE.Vector3).copy(sunDir);
    this.grassMaterial.uniforms.uTime!.value = time;
    (this.grassMaterial.uniforms.uPlayer!.value as THREE.Vector3).copy(player);
  }
}

let faceCenters: THREE.Vector3[] | null = null;
function icosaFaceCenters(): THREE.Vector3[] {
  if (faceCenters) return faceCenters;
  const g = new THREE.IcosahedronGeometry(1, 0);
  const pos = g.getAttribute('position');
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < pos.count; i += 3) {
    const c = new THREE.Vector3();
    for (let k = 0; k < 3; k++) c.add(new THREE.Vector3().fromBufferAttribute(pos, i + k));
    out.push(c.normalize());
  }
  faceCenters = out;
  return out;
}
