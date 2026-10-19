/**
 * The universal glider: a paper kite ("pipa") held over the head by a cross-bar (docs/gameplay/GLIDING.md). Only
 * presentation — the glide itself is the shared motor's (game-core). Unlit vertex colours with an ink shell, like the
 * Ultimate marks; one shared geometry and material for every character, ≈ 300 triangles.
 *
 * Frame: the character's visual root (facing +Z, up +Y). The canopy sits over the head and stays near level while the
 * body leans into the glide (`update` counter-rotates the lean).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

type Geo = THREE.BufferGeometry;
const INK = new THREE.Color('#2a2130');

function prep(g: Geo, color: THREE.ColorRepresentation): Geo {
  const out = g.index ? g.toNonIndexed() : g;
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

function inkShell(pieces: Geo[], w: number): Geo {
  return mergeGeometries(pieces.map((p) => {
    const g = p.clone();
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) + nor.getX(i) * w, pos.getY(i) + nor.getY(i) * w, pos.getZ(i) + nor.getZ(i) * w);
    const col = g.getAttribute('color');
    for (let i = 0; i < col.count; i++) col.setXYZ(i, INK.r, INK.g, INK.b);
    return g;
  }), false)!;
}

/** Canopy in its own frame: centre at the origin, wide along X, nose toward +Z. */
function canopy(): { body: Geo; ink: Geo } {
  const pieces: Geo[] = [];
  // Four paper panels of a flat diamond (two-tone, like a festa junina pipa), thin enough to read as paper.
  const panels: [number, number, string][] = [[1, 1, '#f2c230'], [-1, 1, '#3fa66b'], [1, -1, '#2f6fa8'], [-1, -1, '#e8573f']];
  for (const [sx, sz, color] of panels) {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(sx * 0.95, 0);
    shape.lineTo(0, sz * (sz > 0 ? 0.62 : 0.78));
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.025, bevelEnabled: false });
    // Shape XY → canopy XZ (flat), lifted so the panels meet on the sticks.
    pieces.push(prep(at(g, 0, 0.0125, 0, Math.PI / 2, 0, 0), color));
  }
  // Bamboo sticks (cross) and the bar the hands hold, under the canopy.
  pieces.push(prep(at(new THREE.CylinderGeometry(0.018, 0.018, 1.95, 5), 0, -0.01, 0, 0, 0, Math.PI / 2), '#c09062'));
  pieces.push(prep(at(new THREE.CylinderGeometry(0.018, 0.018, 1.45, 5), 0, -0.01, -0.08, Math.PI / 2, 0, 0), '#c09062'));
  // A short tail of paper bows behind it.
  for (let i = 0; i < 4; i++) pieces.push(prep(at(new THREE.OctahedronGeometry(0.06), Math.sin(i * 1.7) * 0.05, -0.02 - i * 0.03, -0.85 - i * 0.2, 0, 0, 0, [1.4, 0.4, 1]), i % 2 ? '#ed7fa1' : '#72bfd0'));
  return { body: mergeGeometries(pieces, false)!, ink: inkShell(pieces, 0.012) };
}

/** Bar and strings from the hands to the canopy, in the character frame. */
function rigging(): { body: Geo; ink: Geo } {
  const pieces: Geo[] = [prep(at(new THREE.CylinderGeometry(0.02, 0.02, 0.62, 6), 0, 0, 0, 0, 0, Math.PI / 2), '#8a6248')];
  for (const sx of [-1, 1]) pieces.push(prep(at(new THREE.CylinderGeometry(0.006, 0.006, 0.62, 3), sx * 0.22, 0.3, 0, 0, 0, sx * 0.55), '#f4f1ea'));
  return { body: mergeGeometries(pieces, false)!, ink: inkShell(pieces, 0.008) };
}

let shared: { canopy: { body: Geo; ink: Geo }; rigging: { body: Geo; ink: Geo }; body: THREE.MeshBasicMaterial; ink: THREE.MeshBasicMaterial } | null = null;

export class GliderKite {
  readonly group = new THREE.Group();
  private readonly canopy = new THREE.Group();
  private open = 0;
  private t = Math.random() * 10;

  constructor() {
    shared ??= {
      canopy: canopy(),
      rigging: rigging(),
      body: new THREE.MeshBasicMaterial({ vertexColors: true, fog: true, side: THREE.DoubleSide }),
      ink: new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide, fog: true }),
    };
    this.group.name = 'GliderKite';
    const bar = new THREE.Group();
    bar.add(new THREE.Mesh(shared.rigging.body, shared.body), new THREE.Mesh(shared.rigging.ink, shared.ink));
    // The bar sits in the hands, over the head; the canopy above it.
    bar.position.set(0, 2.05, 0.08);
    this.canopy.position.set(0, 2.62, 0.02);
    this.canopy.add(new THREE.Mesh(shared.canopy.body, shared.body), new THREE.Mesh(shared.canopy.ink, shared.ink));
    this.group.add(bar, this.canopy);
    this.group.visible = false;
  }

  /** Opens (scales in) while gliding, folds away after; `lean` is the body's forward tilt to keep the canopy level. */
  update(dt: number, gliding: boolean, lean: number): void {
    this.t += dt;
    this.open = THREE.MathUtils.damp(this.open, gliding ? 1 : 0, gliding ? 14 : 10, dt);
    if (this.open < 0.01 && !gliding) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    this.group.scale.setScalar(Math.max(0.01, this.open));
    // Nose a little up, a gentle flutter; level against the body's lean.
    this.canopy.rotation.set(-lean + 0.22 + Math.sin(this.t * 7.3) * 0.025, 0, Math.sin(this.t * 2.1) * 0.05);
  }
}
