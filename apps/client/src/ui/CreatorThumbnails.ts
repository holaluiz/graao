/** Real catalog photographs, rendered from the same geometry, palette and shaders as the live avatar. */
import * as THREE from 'three';
import { APPEARANCE_KEYS, type CharacterAppearance } from '@graao/shared';
import { buildPalette, type CharacterPartLibrary } from '../character/CharacterAppearanceController';
import type { GRAAnimationLibrary } from '../character/animation/GRAAnimationLibrary';
import { buildSkeleton } from '../character/rig/GRARig';
import { createOutlineMaterial, createStylizedMaterial, setPalette } from '../render/materials/GRAStylizedMaterial';

const WIDTH = 256;
const HEIGHT = 176;
const CACHE_LIMIT = 128;

export function thumbnailCacheKey(key: keyof CharacterAppearance, id: string, appearance: CharacterAppearance, revision = 0): string {
  return JSON.stringify([revision, key, id, ...APPEARANCE_KEYS.map((k) => k === key ? id : appearance[k])]);
}

/** Fits the projected corners, so broad hats, long socks and rear accessories retain an even margin. */
export function frameThumbnail(camera: THREE.OrthographicCamera, bounds: THREE.Box3, key: keyof CharacterAppearance, id: string): void {
  const target = bounds.getCenter(new THREE.Vector3());
  const direction = new THREE.Vector3(0.48, 0.22, 1);
  if (key === 'bodyId') direction.set(0.24, 0.08, 1);
  if (key === 'faceId' || key === 'beardId') direction.set(0, 0.04, 1);
  if (key === 'shoesId') direction.set(0.8, 0.5, 1.2);
  if (id === 'extra.bandeira' || id === 'extra.mochila') direction.set(-0.6, 0.22, -1);
  camera.position.copy(target).addScaledVector(direction.normalize(), 3);
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
  const projected = new THREE.Box3();
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        projected.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse));
      }
    }
  }
  const center = projected.getCenter(new THREE.Vector3());
  const size = projected.getSize(new THREE.Vector3());
  const aspect = WIDTH / HEIGHT;
  const height = Math.max(size.y, size.x / aspect, 0.055) * 1.2;
  camera.left = center.x - height * aspect / 2;
  camera.right = center.x + height * aspect / 2;
  camera.top = center.y + height / 2;
  camera.bottom = center.y - height / 2;
  camera.updateProjectionMatrix();
}

interface ThumbnailJob {
  cacheKey: string;
  key: keyof CharacterAppearance;
  id: string;
  appearance: CharacterAppearance;
  signal?: AbortSignal;
  resolve(value: string): void;
  reject(reason: unknown): void;
  abort(): void;
}

/** One lazily created WebGL context; at most one photograph per animation frame while the creator is visible. */
export class CreatorThumbnails {
  private renderer: THREE.WebGLRenderer | null = null;
  private material: THREE.ShaderMaterial | null = null;
  private outlineMaterial: THREE.ShaderMaterial | null = null;
  private scene: THREE.Scene | null = null;
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 20);
  private readonly cache = new Map<string, string>();
  private readonly queue: ThumbnailJob[] = [];
  private active = false;
  private disposed = false;
  private frame: number | null = null;
  private failure: unknown = null;

  constructor(private readonly parts: CharacterPartLibrary, _anims?: GRAAnimationLibrary) {}

  request(key: keyof CharacterAppearance, id: string, appearance: CharacterAppearance, signal?: AbortSignal): Promise<string> {
    if (this.disposed || !this.active || signal?.aborted) return Promise.reject(this.aborted());
    if (this.failure) return Promise.reject(this.failure);
    const cacheKey = thumbnailCacheKey(key, id, appearance, this.parts.revision);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      this.cache.delete(cacheKey);
      this.cache.set(cacheKey, cached);
      return Promise.resolve(cached);
    }
    return new Promise((resolve, reject) => {
      const job: ThumbnailJob = {
        cacheKey, key, id, appearance: { ...appearance, [key]: id }, signal, resolve, reject,
        abort: () => {
          const index = this.queue.indexOf(job);
          if (index >= 0) this.queue.splice(index, 1);
          signal?.removeEventListener('abort', job.abort);
          reject(this.aborted());
        },
      };
      signal?.addEventListener('abort', job.abort, { once: true });
      this.queue.push(job);
      this.schedule();
    });
  }

  setActive(on: boolean): void {
    if (this.disposed) return;
    this.active = on;
    if (on) this.schedule();
    else this.cancelPending();
  }

  dispose(): void {
    this.disposed = true;
    this.active = false;
    this.cancelPending();
    this.cache.clear();
    this.material?.dispose();
    this.outlineMaterial?.dispose();
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.renderer = null;
    this.scene = null;
  }

  private aborted(): DOMException { return new DOMException('Thumbnail request cancelled', 'AbortError'); }

  private cancelPending(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    for (const job of this.queue.splice(0)) {
      job.signal?.removeEventListener('abort', job.abort);
      job.reject(this.aborted());
    }
  }

  private schedule(): void {
    if (!this.active || this.disposed || this.frame !== null || !this.queue.length) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      const job = this.queue.shift();
      if (job) {
        job.signal?.removeEventListener('abort', job.abort);
        if (job.signal?.aborted) job.reject(this.aborted());
        else {
          try {
            const image = this.render(job);
            this.cache.set(job.cacheKey, image);
            if (this.cache.size > CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value!);
            job.resolve(image);
          } catch (error) { job.reject(error); }
        }
      }
      this.schedule();
    });
  }

  private initialize(): void {
    if (this.renderer) return;
    try {
      this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(WIDTH, HEIGHT, false);
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.NoToneMapping;
      this.scene = new THREE.Scene();
      const sun = new THREE.DirectionalLight('#ffffff', 1);
      sun.position.set(-3, 105, 5);
      sun.target.position.set(0, 100, 0);
      this.scene.add(sun, sun.target);
      this.material = createStylizedMaterial({ variant: 'character' });
      this.outlineMaterial = createOutlineMaterial(this.material.uniforms.uPalette!.value as THREE.Color[]);
      this.outlineMaterial.uniforms.uWidth!.value = 0.6;
    } catch (error) {
      this.renderer?.dispose();
      this.renderer = null;
      this.failure = error;
      throw error;
    }
  }

  private render(job: ThumbnailJob): string {
    this.initialize();
    const { geometry, rig } = this.parts.previewGeometry(job.appearance, job.key);
    if (!geometry.getAttribute('position').count) {
      geometry.dispose();
      throw new Error('This catalog option has no visible geometry');
    }
    const skeleton = buildSkeleton(rig);
    // Keep the shader's radial hemisphere fill aligned with +Y, as it is at the top of the game planet.
    const group = new THREE.Group();
    group.position.y = 100;
    group.add(skeleton.root);
    const mesh = new THREE.SkinnedMesh(geometry, this.material!);
    const outline = new THREE.SkinnedMesh(geometry, this.outlineMaterial!);
    mesh.bind(skeleton.skeleton, new THREE.Matrix4());
    outline.bind(skeleton.skeleton, new THREE.Matrix4());
    mesh.frustumCulled = false;
    outline.frustumCulled = false;
    group.add(mesh, outline);
    this.scene!.add(group);
    try {
      if (job.key === 'bodyId' || job.key === 'topId') {
        for (const bone of skeleton.bones) {
          if (bone.name === 'LeftArm') bone.rotation.z = -1.12;
          if (bone.name === 'RightArm') bone.rotation.z = 1.12;
        }
      }
      group.updateMatrixWorld(true);
      skeleton.skeleton.update();
      mesh.computeBoundingBox();
      const bounds = mesh.boundingBox!.clone().applyMatrix4(mesh.matrixWorld);
      frameThumbnail(this.camera, bounds, job.key, job.id);
      setPalette(this.material!, buildPalette(job.appearance));
      this.renderer!.render(this.scene!, this.camera);
      return this.renderer!.domElement.toDataURL('image/png');
    } finally {
      group.removeFromParent();
      geometry.dispose();
      skeleton.skeleton.dispose();
    }
  }
}
