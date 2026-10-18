/**
 * Stylized graao weapons imported and baked from polygon_guns.glb.
 *
 * Weapon local frame: barrel along +Z, top +Y, grip toward −Y; origin at the top of the grip (where the hand holds).
 * Each model has a `muzzle` child for tracers and flashes. Geometry and materials are shared by every character;
 * one inverted ink shell per model matches the characters' comic-outline aesthetic.
 */
import * as THREE from 'three';
import { WEAPON_SLOTS, type WeaponId } from '@graao/game-data';
import { createStylizedMaterial } from '../render/materials/GRAStylizedMaterial';
import { INK_STATE } from '../render/InkPass';
import { decodeBakedWeapons, type BakedWeapon } from './WeaponData';

const INK = new THREE.Color('#2a2130');

let cache: Record<WeaponId, BakedWeapon> | null = null;
let material: THREE.ShaderMaterial | null = null;
let inkMaterial: THREE.MeshBasicMaterial | null = null;

function data(): Record<WeaponId, BakedWeapon> {
  if (!cache) {
    cache = decodeBakedWeapons();
    // Clean, unpigmented shading so the small props do not "swim" through world-space noise as they move.
    material = createStylizedMaterial({ variant: 'world', vertexColors: true, pigment: 0, edgePooling: 0, tormenta: false });
    inkMaterial = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide, vertexColors: false, fog: true });
  }
  return cache;
}

export interface WeaponModel {
  root: THREE.Group;
  muzzle: THREE.Object3D;
}

/** A new instance of a weapon model (shares geometry and materials with every other instance). */
export function createWeaponModel(id: WeaponId): WeaponModel {
  const d = data()[id] ?? data().sunbeam;
  const root = new THREE.Group();
  root.name = `weapon.${id}`;
  const body = new THREE.Mesh(d.body, material!);
  body.castShadow = true;
  const ink = new THREE.Mesh(d.ink, inkMaterial!);
  ink.visible = !INK_STATE.post;
  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  muzzle.position.copy(d.muzzle);
  root.add(body, ink, muzzle);
  return { root, muzzle };
}

/**
 * Mount transform from the weapon frame to the canonical RightHand bone (bind: T-pose, fingers along −X, palm −Y,
 * thumb +Z). Held like a real pistol: the grip runs across the palm from the index side down past the little finger
 * (weapon −Y → hand −Z), the top of the weapon sits on the thumb side (weapon +Y → hand +Z) and the barrel continues
 * the line of the forearm (weapon +Z → hand −X). The grip runs through the middle of the closed fist (GraaoCharacter
 * curls the fingers around it) and comes out under the little finger.
 */
export const HAND_MOUNT = {
  position: new THREE.Vector3(-0.066, -0.004, 0.036),
  rotation: new THREE.Euler().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0)),
  ),
};

/** Both weapons of one character, mounted in the right hand; only the equipped slot is visible. */
export class WeaponHolder {
  readonly group = new THREE.Group();
  readonly models: WeaponModel[];
  slot = 0;

  constructor() {
    this.group.name = 'weaponMount';
    this.group.position.copy(HAND_MOUNT.position);
    this.group.rotation.copy(HAND_MOUNT.rotation);
    this.models = (WEAPON_SLOTS as WeaponId[]).map((id) => createWeaponModel(id));
    for (const m of this.models) this.group.add(m.root);
    this.setSlot(0);
  }

  /** Attaches to a character's canonical RightHand bone (kept across skeleton rebuilds by GraaoCharacter). */
  attachTo(character: { attach(obj: THREE.Object3D, bone: 'RightHand'): void }): void {
    character.attach(this.group, 'RightHand');
  }

  setSlot(slot: number): void {
    this.slot = slot;
    this.models.forEach((m, i) => (m.root.visible = i === slot));
  }

  /** World position of the equipped weapon's muzzle (call after the character's world matrices are current). */
  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.models[this.slot]!.muzzle.getWorldPosition(out);
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
  }
}

/** Triangles of both weapon models (F3 overlay). */
export function weaponTriangles(): number {
  const d = data();
  return Object.values(d).reduce((n, m) => n + (m.body.getAttribute('position').count + m.ink.getAttribute('position').count) / 3, 0);
}
