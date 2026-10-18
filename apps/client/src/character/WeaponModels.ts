/**
 * Stylized graao weapons imported and baked from polygon_guns.glb.
 *
 * Weapon local frame: barrel along +Z, top +Y, grip toward −Y; origin at the top of the grip (where the hand holds).
 * Each model has a `muzzle` child for tracers and flashes. Geometry and materials are shared by every character;
 * one inverted ink shell per model matches the characters' comic-outline aesthetic.
 */
import * as THREE from 'three';
import { STARTING_KIT, WEAPON_SLOT_COUNT, type WeaponId } from '@graao/game-data';
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

/** A weapon's shared geometry and material (pickups on the ground draw it instanced). */
export function weaponDrawable(id: WeaponId): { geometry: THREE.BufferGeometry; material: THREE.ShaderMaterial } {
  const d = data()[id] ?? data().sunbeam;
  return { geometry: d.body, material: material! };
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

/**
 * The weapons of one character (E and Q), mounted in the right hand; only the equipped slot is visible. Slots hold
 * any weapon of the pack (picked up, swapped, dropped): a model is built the first time a weapon shows up in this
 * hand and reused after that (shared geometry and materials, so it costs one small group).
 */
export class WeaponHolder {
  readonly group = new THREE.Group();
  private readonly cache = new Map<WeaponId, WeaponModel>();
  readonly ids: (WeaponId | null)[] = new Array<WeaponId | null>(WEAPON_SLOT_COUNT).fill(null);
  slot = 0;

  constructor(ids: (WeaponId | null)[] = STARTING_KIT.weapons) {
    this.group.name = 'weaponMount';
    this.group.position.copy(HAND_MOUNT.position);
    this.group.rotation.copy(HAND_MOUNT.rotation);
    this.setWeapons(ids);
  }

  private model(id: WeaponId): WeaponModel {
    let m = this.cache.get(id);
    if (!m) {
      m = createWeaponModel(id);
      this.cache.set(id, m);
      this.group.add(m.root);
    }
    return m;
  }

  /** What is in each slot (server truth). */
  setWeapons(ids: readonly (string | null)[]): void {
    let changed = false;
    for (let i = 0; i < WEAPON_SLOT_COUNT; i++) {
      const id = (ids[i] || null) as WeaponId | null;
      if (id !== this.ids[i]) {
        this.ids[i] = id;
        changed = true;
      }
    }
    if (changed) this.setSlot(this.slot);
  }

  /** Attaches to a character's canonical RightHand bone (kept across skeleton rebuilds by GraaoCharacter). */
  attachTo(character: { attach(obj: THREE.Object3D, bone: 'RightHand'): void }): void {
    character.attach(this.group, 'RightHand');
  }

  setSlot(slot: number): void {
    this.slot = slot;
    const id = this.ids[slot];
    const show = id ? this.model(id) : null;
    for (const m of this.cache.values()) m.root.visible = m === show;
  }

  /** World position of the equipped weapon's muzzle (call after the character's world matrices are current). */
  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    const id = this.ids[this.slot];
    return id ? this.model(id).muzzle.getWorldPosition(out) : this.group.getWorldPosition(out);
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
  }
}

/** Triangles of every weapon model of the pack (F3 overlay). */
export function weaponTriangles(): number {
  const d = data();
  return Object.values(d).reduce((n, m) => n + (m.body.getAttribute('position').count + m.ink.getAttribute('position').count) / 3, 0);
}
