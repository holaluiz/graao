/**
 * Code-authored graao weapons (no Blender needed for the MVP). Two chunky, toy-like blasters that read at a glance:
 *
 *   - sunbeam ("Raio de Sol"): cream body, orange ribs, a little sun disc at the muzzle.
 *   - petal ("Rajada de Pétalas"): pink bell-mouthed body with five petals around the muzzle, mint grip.
 *
 * Weapon local frame: barrel along +Z, top +Y, grip toward −Y; origin at the top of the grip (where the hand holds).
 * Each model has a `muzzle` child for tracers and flashes. Geometry and materials are shared by every character;
 * one inverted ink shell per model matches the characters' outline.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { WeaponId } from '@graao/game-data';
import { createStylizedMaterial } from '../render/materials/GRAStylizedMaterial';
import { INK_STATE } from '../render/InkPass';

type Geo = THREE.BufferGeometry;

const INK = new THREE.Color('#2a2130');

function paint(g: Geo, color: THREE.ColorRepresentation): Geo {
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

function place(g: Geo, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): Geo {
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1)));
  return g;
}

/** Scales a primitive about its own centre so it grows by `w` on every side (ink shell for convex pieces). */
function inflate(g: Geo, w: number): Geo {
  const c = g.clone();
  c.computeBoundingBox();
  const b = c.boundingBox!;
  const center = b.getCenter(new THREE.Vector3());
  const size = b.getSize(new THREE.Vector3());
  c.translate(-center.x, -center.y, -center.z);
  c.scale((size.x + 2 * w) / Math.max(size.x, 1e-4), (size.y + 2 * w) / Math.max(size.y, 1e-4), (size.z + 2 * w) / Math.max(size.z, 1e-4));
  c.translate(center.x, center.y, center.z);
  return c;
}

function clean(g: Geo): Geo {
  for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(name)) g.deleteAttribute(name);
  return g.index ? g.toNonIndexed() : g;
}

interface Piece {
  geo: Geo;
  color: THREE.ColorRepresentation;
  /** Skip the ink shell (tiny details). */
  noInk?: boolean;
}

function build(pieces: Piece[], inkWidth = 0.006): { body: Geo; ink: Geo } {
  const body = mergeGeometries(pieces.map((p) => clean(paint(p.geo, p.color))), false)!;
  const ink = mergeGeometries(pieces.filter((p) => !p.noInk).map((p) => clean(paint(inflate(p.geo, inkWidth), INK))), false)!;
  body.computeBoundingSphere();
  ink.computeBoundingSphere();
  return { body, ink };
}

function roundedBox(w: number, h: number, d: number, r: number): Geo {
  // A capsule-ish box: a box with its long edges softened by two capsules (cheap and reads as "rounded" at play size).
  const core = new THREE.BoxGeometry(w, h - r * 2, d);
  const top = new THREE.CapsuleGeometry(r, d - r * 2, 3, 8);
  place(top, 0, (h - r * 2) / 2, 0, Math.PI / 2, 0, 0);
  top.scale(w / (r * 2), 1, 1);
  const bottom = new THREE.CapsuleGeometry(r, d - r * 2, 3, 8);
  place(bottom, 0, -(h - r * 2) / 2, 0, Math.PI / 2, 0, 0);
  bottom.scale(w / (r * 2), 1, 1);
  return mergeGeometries([clean(core), clean(top), clean(bottom)], false)!;
}

function sunbeamPieces(): { pieces: Piece[]; muzzle: THREE.Vector3 } {
  const L = 0.27;
  const pieces: Piece[] = [
    // Body: from just behind the hand to the muzzle.
    { geo: place(roundedBox(0.062, 0.078, L, 0.022), 0, 0.03, L / 2 - 0.06), color: '#f6ead2' },
    // Orange ribs.
    { geo: place(new THREE.CylinderGeometry(0.044, 0.044, 0.02, 14), 0, 0.03, 0.08, Math.PI / 2), color: '#ec8a3a' },
    { geo: place(new THREE.CylinderGeometry(0.044, 0.044, 0.02, 14), 0, 0.03, 0.13, Math.PI / 2), color: '#ec8a3a' },
    // Barrel and sun disc.
    { geo: place(new THREE.CylinderGeometry(0.022, 0.026, 0.06, 12), 0, 0.03, L - 0.04, Math.PI / 2), color: '#ec8a3a' },
    { geo: place(new THREE.CylinderGeometry(0.036, 0.036, 0.014, 16), 0, 0.03, L - 0.006, Math.PI / 2), color: '#ffd36e' },
    { geo: place(new THREE.SphereGeometry(0.018, 10, 8), 0, 0.03, L + 0.004), color: '#fff3c4', noInk: true },
    // Grip and trigger guard.
    { geo: place(roundedBox(0.046, 0.12, 0.05, 0.018), 0, -0.04, -0.012, -0.28), color: '#8a5a3c' },
    { geo: place(new THREE.TorusGeometry(0.022, 0.006, 6, 12, Math.PI), 0, -0.012, 0.03, 0, Math.PI / 2, Math.PI), color: '#34343b', noInk: true },
    // Sight.
    { geo: place(new THREE.BoxGeometry(0.014, 0.02, 0.03), 0, 0.078, 0.09), color: '#ec8a3a' },
  ];
  return { pieces, muzzle: new THREE.Vector3(0, 0.03, L + 0.02) };
}

function petalPieces(): { pieces: Piece[]; muzzle: THREE.Vector3 } {
  const L = 0.24;
  const pieces: Piece[] = [
    { geo: place(roundedBox(0.074, 0.088, 0.17, 0.026), 0, 0.035, 0.03), color: '#f29bb5' },
    // Bell mouth.
    { geo: place(new THREE.CylinderGeometry(0.06, 0.038, 0.09, 16, 1, true), 0, 0.035, L - 0.05, Math.PI / 2), color: '#e77d9c' },
    { geo: place(new THREE.CylinderGeometry(0.03, 0.03, 0.06, 12), 0, 0.035, L - 0.07, Math.PI / 2), color: '#5b3a4a', noInk: true },
    // Grip and a mint stock plate.
    { geo: place(roundedBox(0.05, 0.12, 0.055, 0.02), 0, -0.04, -0.015, -0.3), color: '#7fc8a9' },
    { geo: place(new THREE.BoxGeometry(0.05, 0.05, 0.03), 0, 0.03, -0.07), color: '#7fc8a9' },
    { geo: place(new THREE.TorusGeometry(0.024, 0.006, 6, 12, Math.PI), 0, -0.012, 0.035, 0, Math.PI / 2, Math.PI), color: '#34343b', noInk: true },
  ];
  // Five petals around the muzzle.
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + Math.PI / 2;
    const petal = new THREE.SphereGeometry(0.032, 10, 6);
    petal.scale(0.55, 1, 0.3);
    pieces.push({ geo: place(petal, Math.cos(a) * 0.072, 0.035 + Math.sin(a) * 0.072, L - 0.005, 0, 0, a - Math.PI / 2), color: k % 2 ? '#ffd1de' : '#ffe3ea' });
  }
  pieces.push({ geo: place(new THREE.SphereGeometry(0.022, 10, 8), 0, 0.035, L - 0.02), color: '#ffd36e', noInk: true });
  return { pieces, muzzle: new THREE.Vector3(0, 0.035, L + 0.02) };
}

interface ModelData {
  body: Geo;
  ink: Geo;
  muzzle: THREE.Vector3;
}

let cache: Record<WeaponId, ModelData> | null = null;
let material: THREE.ShaderMaterial | null = null;
let inkMaterial: THREE.MeshBasicMaterial | null = null;

function data(): Record<WeaponId, ModelData> {
  if (!cache) {
    const s = sunbeamPieces();
    const p = petalPieces();
    cache = { sunbeam: { ...build(s.pieces), muzzle: s.muzzle }, petal: { ...build(p.pieces), muzzle: p.muzzle } };
    // Clean, unpigmented shading so the small props do not "swim" through world-space noise as they move.
    material = createStylizedMaterial({ variant: 'world', vertexColors: true, pigment: 0, edgePooling: 0 });
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
  const d = data()[id];
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
 * the line of the forearm (weapon +Z → hand −X). The grip's middle lands inside the closed fist (GraaoCharacter curls
 * the fingers around it).
 */
export const HAND_MOUNT = {
  position: new THREE.Vector3(-0.074, -0.036, 0.036),
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
    this.models = (['sunbeam', 'petal'] as WeaponId[]).map((id) => createWeaponModel(id));
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
