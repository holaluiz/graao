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

const finish = (pieces: Geo[], height = 2.4): Shape => ({ body: mergeGeometries(pieces, false)!, ink: inkShell(pieces, .012), height });

function winterBranch(): Shape {
  const pieces = [prep(at(new THREE.CylinderGeometry(.025, .04, .5, 5), 0, 0, 0), '#476b5d')];
  for (const sign of [-1, 1]) for (let i = 0; i < 2; i++) {
    pieces.push(prep(at(new THREE.ConeGeometry(.09, .3, 3), sign * (.08 + i * .05), i * .15 - .07, 0, 0, 0, -sign * .9), i % 2 ? '#d9f7ee' : '#8fccb1'));
  }
  return finish(pieces);
}

function paperKite(): Shape {
  const pieces = [prep(at(new THREE.OctahedronGeometry(1), 0, .05, 0, 0, 0, 0, [.22, .3, .055]), '#f3be49')];
  for (let i = 0; i < 3; i++) pieces.push(prep(at(new THREE.OctahedronGeometry(.045), Math.sin(i * 1.6) * .06, -.3 - i * .09, 0), i % 2 ? '#ed7fa1' : '#72bfd0'));
  return finish(pieces, 2.55);
}

function paperCity(): Shape {
  const pieces: Geo[] = [];
  for (let i = 0; i < 3; i++) {
    const height = i === 1 ? .4 : .26;
    pieces.push(prep(at(new THREE.BoxGeometry(.13, height, .13), (i - 1) * .17, 0, 0), i === 1 ? '#ffcf77' : '#f4e2c1'));
    pieces.push(prep(at(new THREE.ConeGeometry(.105, .12, 4), (i - 1) * .17, height / 2 + .05, 0, 0, Math.PI / 4), '#dc8d83'));
  }
  return finish(pieces);
}

function fireflyLantern(): Shape {
  return finish([
    prep(new THREE.OctahedronGeometry(.21), '#ffef8b'),
    prep(at(new THREE.TorusGeometry(.23, .025, 5, 18), 0, 0, 0, Math.PI / 2), '#637b64'),
    prep(at(new THREE.TorusGeometry(.1, .023, 5, 14), 0, .25, 0), '#637b64'),
    prep(at(new THREE.ConeGeometry(.23, .12, 6), 0, .18, 0), '#a6c99b'),
  ]);
}

function inkWave(): Shape {
  return finish([
    prep(at(new THREE.TorusGeometry(.21, .075, 6, 23, Math.PI * 1.6), 0, 0, 0, 0, 0, -.3), '#647dca'),
    prep(at(new THREE.SphereGeometry(.09, 8, 6), .09, .04, 0), '#a9dbed'),
    prep(at(new THREE.BoxGeometry(.5, .035, .13), 0, -.23, 0), '#647dca'),
  ]);
}

function confettiRing(): Shape {
  const pieces = [prep(new THREE.TorusGeometry(.23, .025, 5, 24), '#ffe7a5')];
  const colors = ['#e993b8', '#72c6ca', '#9dd18b', '#ffcc67'];
  for (let i = 0; i < 4; i++) pieces.push(prep(at(new THREE.BoxGeometry(.09, .09, .025), Math.cos(i * Math.PI / 2) * .3, Math.sin(i * Math.PI / 2) * .3, 0, 0, 0, .3 + i), colors[i]!));
  return finish(pieces);
}

function chalkGate(): Shape {
  return finish([
    prep(at(new THREE.TorusGeometry(.16, .035, 5, 22), -.15, 0, 0, 0, .3, 0, [.7, 1.35, 1]), '#9fd3df'),
    prep(at(new THREE.TorusGeometry(.16, .035, 5, 22), .15, 0, 0, 0, -.3, 0, [.7, 1.35, 1]), '#efb4c9'),
  ]);
}

const BUILDERS: Record<UltimateMarkId, () => Shape> = {
  sun_crown: sunCrown, petal_orbit: petalOrbit, dawn_lance: dawnLance,
  winter_branch: winterBranch, paper_kite: paperKite, paper_city: paperCity, firefly_lantern: fireflyLantern,
  ink_wave: inkWave, confetti_ring: confettiRing, chalk_gate: chalkGate,
};
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
      default:
        this.spin.rotation.set(0, t * .8, .06 * Math.sin(t));
        this.spin.position.y = Math.sin(t * 1.7) * .035;
        break;
    }
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}
