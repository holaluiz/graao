/**
 * GraaoCharacter: one visual character instance.
 *
 *   root (PlayerRoot visual, aligned to localUp on the planet)
 *   └── visualRoot (CharacterVisualRoot: the skydive tilt, belly-down while diving, feet-first near the ground; the
 *         double-jump flip; lifted to the water line while swimming)
 *         ├── Hips … (GRA_Rig_MixamoCompatible bones)
 *         ├── mesh     (merged SkinnedMesh: body + clothes + hair + accessory, palette material)
 *         └── outline  (same geometry, inverted-hull ink)
 *
 * The gameplay capsule lives elsewhere (game-core); this class only presents it.
 */
import * as THREE from 'three';
import { MOVEMENT } from '@graao/game-data';
import { MovementState, type CharacterAppearance } from '@graao/shared';
import { createOutlineMaterial, createStylizedMaterial, setPalette, setWetness } from '../render/materials/GRAStylizedMaterial';
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
  /** Current skydive tilt (rad, forward about the side axis) and its pivot height (hips). */
  private tilt = 0;
  private static readonly TILT_PIVOT = 0.95;
  private static readonly TILT_DIVE = 1.3;
  /** Double jump: a forward flip about the same hips pivot, FLIP_TIME s long (progress 0..1, 1 = done). */
  private flip = 1;
  private wasAirJumped = false;
  private airJumpPending = false;
  private static readonly FLIP_TIME = 0.5;
  /**
   * Wetness after the water: how high on the body (m above the feet) it reached and how wet that still is (1 soaked →
   * 0 dry). Soaked for WET_HOLD s after leaving the water, then dries over WET_DRY s.
   */
  wetLine = 0;
  wetness = 0;
  private dryTime = 0;
  private static readonly WET_HOLD = 5;
  private static readonly WET_DRY = 14;
  /** Current lift (m) of the body from the capsule's feet to the water line while swimming. */
  private swimLift = 0;
  private readonly feet = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

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
    this.feet.copy(feet);
    this.up.copy(up);
  }

  update(dt: number, s: AnimInput): void {
    // Skydive: belly-down, flaring back to feet-first over the last metres so the landing reads.
    const flare = s.groundDist === undefined ? 1 : THREE.MathUtils.smoothstep(s.groundDist, 2.5, 10);
    const target = s.diving ? THREE.MathUtils.lerp(0.15, GraaoCharacter.TILT_DIVE, flare) : 0;
    this.tilt += (target - this.tilt) * (1 - Math.exp(-dt * (s.diving ? 5 : 9)));
    if (Math.abs(this.tilt) < 1e-4 && target === 0) this.tilt = 0;
    // Double jump (rising edge of the spent flag while airborne): a tucked forward flip, fast out and easing in.
    const airJumped = !!s.airJumped && !s.grounded;
    if (airJumped && !this.wasAirJumped) {
      this.flip = 0;
      this.airJumpPending = true;
      this.anim.playOneShot('jumpStart', { speed: 1.8 });
    }
    this.wasAirJumped = airJumped;
    if (s.grounded || s.moveState === MovementState.SWIM) this.flip = 1;
    else if (this.flip < 1) this.flip = Math.min(1, this.flip + dt / GraaoCharacter.FLIP_TIME);
    const spin = this.flip < 1 ? Math.PI * 2 * (1 - (1 - this.flip) ** 2) : 0;
    const h = GraaoCharacter.TILT_PIVOT;
    // The swim clips are authored with their origin at the water line (head out, legs hanging below it): while
    // swimming the body is lifted from the capsule's feet up to the surface.
    const swimming = s.moveState === MovementState.SWIM;
    const lift = swimming ? THREE.MathUtils.clamp(s.waterDepth ?? MOVEMENT.swimFloatDepth, 0, MOVEMENT.swimFloatDepth + 0.25) : 0;
    this.swimLift = THREE.MathUtils.damp(this.swimLift, lift, 8, dt);
    if (Math.abs(this.swimLift) < 1e-4 && lift === 0) this.swimLift = 0;
    const pitch = this.tilt + spin;
    this.visualRoot.rotation.set(pitch, 0, 0);
    this.visualRoot.position.set(0, h * (1 - Math.cos(pitch)) + this.swimLift, -h * Math.sin(pitch));
    this.updateWetness(dt, s.waterDepth, swimming);
    this.anim.update(dt, s);
  }

  /** True once per double jump (the frame its flip starts): the caller puffs air under the feet. */
  consumeAirJump(): boolean {
    const p = this.airJumpPending;
    this.airJumpPending = false;
    return p;
  }

  private updateWetness(dt: number, depth: number | undefined, swimming: boolean): void {
    if (depth !== undefined && depth > 0.02) {
      // In the water: soaked up to the surface (all over when swimming: splashes reach the hair).
      const line = swimming ? 2.4 : depth + 0.1;
      this.wetLine = this.wetness > 0.05 ? Math.max(this.wetLine, line) : line;
      this.wetness = 1;
      this.dryTime = 0;
    } else if (this.wetness > 0) {
      this.dryTime += dt;
      this.wetness = 1 - THREE.MathUtils.smoothstep(this.dryTime, GraaoCharacter.WET_HOLD, GraaoCharacter.WET_HOLD + GraaoCharacter.WET_DRY);
      if (this.wetness <= 0.001) {
        this.wetness = 0;
        this.wetLine = 0;
      }
    }
    setWetness(this.material, this.wetness, this.wetLine, this.feet, this.up);
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
