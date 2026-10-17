/**
 * GraaoCharacter: one visual character instance.
 *
 *   root (PlayerRoot visual, aligned to localUp on the planet)
 *   └── visualRoot (CharacterVisualRoot: turn lean, landing squash)
 *         ├── Hips … (GRA_Rig_MixamoCompatible bones)
 *         ├── mesh     (merged SkinnedMesh: body + clothes + hair + accessory, palette material)
 *         └── outline  (same geometry, inverted-hull ink)
 *
 * The gameplay capsule lives elsewhere (game-core); this class only presents it.
 */
import * as THREE from 'three';
import type { CharacterAppearance } from '@graao/shared';
import { createOutlineMaterial, createStylizedMaterial, setPalette } from '../render/materials/GRAStylizedMaterial';
import { buildSkeleton, type BoneName, type GRARig } from './rig/GRARig';
import { buildPalette, geometryKey, type CharacterPartLibrary } from './CharacterAppearanceController';
import { CharacterAnimationController, type AnimInput } from './CharacterAnimationController';
import type { GRAAnimationLibrary } from './animation/GRAAnimationLibrary';

export class GraaoCharacter {
  readonly root = new THREE.Group();
  readonly visualRoot = new THREE.Group();
  readonly material = createStylizedMaterial({ variant: 'character' });
  readonly outlineMaterial = createOutlineMaterial(this.material.uniforms.uPalette!.value as THREE.Color[]);
  mesh!: THREE.SkinnedMesh;
  outline!: THREE.SkinnedMesh;
  skeleton!: THREE.Skeleton;
  bones = new Map<BoneName, THREE.Bone>();
  anim!: CharacterAnimationController;
  appearance: CharacterAppearance;
  stats = { vertices: 0, triangles: 0, buildMs: 0, cacheHits: 0, bones: 0 };
  private rig: GRARig | null = null;
  private geoKey = '';
  private readonly attachments = new Map<THREE.Object3D, BoneName>();

  constructor(
    private readonly parts: CharacterPartLibrary,
    private readonly anims: GRAAnimationLibrary,
    appearance: CharacterAppearance,
    opts: { outline?: boolean; castShadow?: boolean } = {},
  ) {
    this.root.name = 'PlayerRoot';
    this.visualRoot.name = 'CharacterVisualRoot';
    this.root.add(this.visualRoot);
    this.appearance = { ...appearance };
    this.rebuild(appearance, true);
    this.outline.visible = opts.outline ?? true;
    this.mesh.castShadow = opts.castShadow ?? true;
  }

  /** Applies a new appearance: palette-only when geometry ids are unchanged; rebuilds the skeleton on body change. */
  setAppearance(a: CharacterAppearance): void {
    const bodyChanged = a.bodyId !== this.appearance.bodyId;
    this.appearance = { ...a };
    if (bodyChanged) this.rebuild(a, true);
    else if (geometryKey(a) !== this.geoKey) this.rebuild(a, false);
    setPalette(this.material, buildPalette(a));
  }

  private rebuild(a: CharacterAppearance, newSkeleton: boolean): void {
    const built = this.parts.build(a);
    this.geoKey = geometryKey(a);
    if (newSkeleton || !this.rig || this.rig !== built.rig) {
      // Fresh skeleton for this body type; re-parent attachments and recreate the animation controller.
      const oldAttach = [...this.attachments];
      if (this.mesh) {
        this.visualRoot.remove(this.mesh, this.outline);
        this.visualRoot.remove(this.skeleton.bones[0]!);
        this.anim.dispose();
      }
      this.rig = built.rig;
      const { root, bones, skeleton } = buildSkeleton(built.rig);
      this.skeleton = skeleton;
      this.bones = new Map(bones.map((b) => [b.name as BoneName, b]));
      this.visualRoot.add(root);
      const castShadow = this.mesh?.castShadow ?? true;
      const outlineVisible = this.outline?.visible ?? true;
      this.mesh = new THREE.SkinnedMesh(built.geometry, this.material);
      this.outline = new THREE.SkinnedMesh(built.geometry, this.outlineMaterial);
      for (const m of [this.mesh, this.outline]) {
        m.bind(skeleton, new THREE.Matrix4());
        m.frustumCulled = true;
        this.visualRoot.add(m);
      }
      this.mesh.castShadow = castShadow;
      this.mesh.receiveShadow = true;
      this.outline.castShadow = false;
      this.outline.visible = outlineVisible;
      this.anim = new CharacterAnimationController(this.visualRoot, this.anims);
      for (const [obj, bone] of oldAttach) this.attach(obj, bone);
    } else {
      const old = this.mesh.geometry;
      this.mesh.geometry = built.geometry;
      this.outline.geometry = built.geometry;
      if (old !== built.geometry) old.dispose();
    }
    this.stats = { ...built.stats, bones: this.skeleton.bones.length };
    setPalette(this.material, buildPalette(a));
  }

  /** Rigid attachment to a named canonical bone (weapons, rigid accessories). */
  attach(obj: THREE.Object3D, bone: BoneName): void {
    this.bones.get(bone)?.add(obj);
    this.attachments.set(obj, bone);
  }

  detach(obj: THREE.Object3D): void {
    obj.removeFromParent();
    this.attachments.delete(obj);
  }

  /** Places the character: feet position, local up and facing tangent (world space). */
  setPose(feet: THREE.Vector3, up: THREE.Vector3, facing: THREE.Vector3): void {
    const side = new THREE.Vector3().crossVectors(up, facing).normalize();
    const fwd = new THREE.Vector3().crossVectors(side, up).normalize();
    const m = new THREE.Matrix4().makeBasis(side, up, fwd);
    this.root.quaternion.setFromRotationMatrix(m);
    this.root.position.copy(feet);
  }

  update(dt: number, s: AnimInput): void {
    this.anim.update(dt, s);
  }

  setFade(f: number): void {
    this.material.uniforms.uFade!.value = f;
    this.outlineMaterial.uniforms.uFade!.value = f;
  }

  dispose(): void {
    this.anim.dispose();
    this.root.removeFromParent();
    this.material.dispose();
    this.outlineMaterial.dispose();
  }
}
