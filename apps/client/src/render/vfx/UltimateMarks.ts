/**
 * Ultimate Marks (GRAVFXSystem category PersistentMark): a small floating sign over a player's head that tells
 * opponents WHICH Ultimate that player carries — never whether it is ready (it never changes with the cooldown).
 *
 * Readable by shape and motion, not color: a rotating sun crown, three petals orbiting the head, a spinning dawn
 * lance bobbing upright. Mounted on the character root (not a bone, not the mesh), so clothing, hair and animation
 * never hide it. Unlit with an ink shell like the weapons; kept on every quality level.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { UltimateMarkId } from '@graao/game-data';

type Geo = THREE.BufferGeometry;
const INK = new THREE.Color('#2a2130');

function prep(g: Geo, color: THREE.ColorRepresentation): Geo {
  const out = g.index ? g.toNonIndexed() : g;
  // Keep the primitives' smooth normals (the ink shell is pushed along them, so curved pieces stay closed).
  for (const name of Object.keys(out.attributes)) if (name !== 'position' && name !== 'normal') out.deleteAttribute(name);
  const c = new THREE.Color(color);
  const n = out.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  out.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return out;
}

const at = (g: Geo, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s: [number, number, number] = [1, 1, 1]): Geo =>
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(...s)));

/** Ink shell: every piece pushed out along its normals (smooth convex pieces, so it reads as an outline). */
function inkShell(pieces: Geo[], w: number): Geo {
  const shells = pieces.map((p) => {
    const g = p.clone();
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) + nor.getX(i) * w, pos.getY(i) + nor.getY(i) * w, pos.getZ(i) + nor.getZ(i) * w);
    const col = g.getAttribute('color');
    for (let i = 0; i < col.count; i++) col.setXYZ(i, INK.r, INK.g, INK.b);
    return g;
  });
  return mergeGeometries(shells, false)!;
}

interface Shape {
  body: Geo;
  ink: Geo;
  /** Height of the sign above the feet (m). */
  height: number;
}

function sunCrown(): Shape {
  const pieces: Geo[] = [prep(at(new THREE.TorusGeometry(0.17, 0.032, 8, 28), 0, 0, 0, Math.PI / 2), '#ffb43c')];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    // Triangular rays pointing outward and a little up: a crown, readable from any side.
    const ray = new THREE.ConeGeometry(0.045, 0.16, 4);
    pieces.push(prep(at(ray, Math.cos(a) * 0.27, 0.02, Math.sin(a) * 0.27, 0, -a, -Math.PI / 2 + 0.35), k % 2 ? '#ffe08a' : '#ff9a3c'));
  }
  pieces.push(prep(at(new THREE.SphereGeometry(0.06, 12, 8), 0, 0, 0), '#fff3c4'));
  return { body: mergeGeometries(pieces, false)!, ink: inkShell(pieces, 0.012), height: 2.32 };
}

function petalOrbit(): Shape {
  const pieces: Geo[] = [];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    const petal = new THREE.SphereGeometry(1, 14, 8);
    // Pointed along the orbit direction, tilted like a blade.
    pieces.push(prep(at(petal, Math.cos(a) * 0.48, Math.sin(a * 2) * 0.05, Math.sin(a) * 0.48, 0.5, -a, 0, [0.16, 0.03, 0.07]), k === 0 ? '#f29bb5' : k === 1 ? '#ffd1de' : '#e77d9c'));
  }
  return { body: mergeGeometries(pieces, false)!, ink: inkShell(pieces, 0.01), height: 2.08 };
}

function dawnLance(): Shape {
  const pieces: Geo[] = [
    prep(at(new THREE.OctahedronGeometry(1, 0), 0, 0, 0, 0, 0, 0, [0.08, 0.3, 0.08]), '#ff8fb0'),
    prep(at(new THREE.TorusGeometry(0.11, 0.018, 6, 20), 0, 0, 0, Math.PI / 2), '#fff0c8'),
  ];
  return { body: mergeGeometries(pieces, false)!, ink: inkShell(pieces, 0.012), height: 2.4 };
}

const BUILDERS: Record<UltimateMarkId, () => Shape> = { sun_crown: sunCrown, petal_orbit: petalOrbit, dawn_lance: dawnLance };
const cache = new Map<UltimateMarkId, Shape>();
let bodyMat: THREE.MeshBasicMaterial | null = null;
let inkMat: THREE.MeshBasicMaterial | null = null;

function shape(id: UltimateMarkId): Shape {
  let s = cache.get(id);
  if (!s) {
    s = BUILDERS[id]();
    cache.set(id, s);
  }
  bodyMat ??= new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
  inkMat ??= new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide, fog: true });
  return s;
}

export class UltimateMark {
  readonly group = new THREE.Group();
  private readonly spin = new THREE.Group();
  private t = Math.random() * 10;
  readonly triangles: number;

  constructor(readonly id: UltimateMarkId) {
    const s = shape(id);
    this.group.name = `ultimateMark.${id}`;
    this.group.position.y = s.height;
    const body = new THREE.Mesh(s.body, bodyMat!);
    const ink = new THREE.Mesh(s.ink, inkMat!);
    body.renderOrder = ink.renderOrder = 2;
    this.spin.add(body, ink);
    this.group.add(this.spin);
    this.triangles = (s.body.getAttribute('position').count + s.ink.getAttribute('position').count) / 3;
  }

  /** Constant motion per mark: it never speeds up, dims or changes with the Ultimate's cooldown. */
  update(dt: number): void {
    this.t += dt;
    const t = this.t;
    switch (this.id) {
      case 'sun_crown':
        this.spin.rotation.set(0.18 * Math.sin(t * 0.9), t * 0.9, 0);
        this.spin.position.y = Math.sin(t * 1.6) * 0.03;
        break;
      case 'petal_orbit':
        this.spin.rotation.set(0, t * 2.4, 0);
        this.spin.position.y = Math.sin(t * 2.4) * 0.04;
        break;
      case 'dawn_lance':
        this.spin.rotation.set(0, t * 2.2, 0.12 * Math.sin(t * 1.1));
        this.spin.position.y = Math.sin(t * 2.8) * 0.07;
        break;
    }
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}
