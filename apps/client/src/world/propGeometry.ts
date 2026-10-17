/**
 * Code-authored stylized props. Every builder returns one merged BufferGeometry with a `color` attribute, in the
 * placement's local frame (X side, Y up, Z forward), using the same dimensions as the gameplay colliders
 * (`@graao/game-core` STRUCTURE_DIMS / HOUSE_VARIANTS). Large color masses, low noise, clean silhouettes.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HOUSE_VARIANTS, STRUCTURE_DIMS, mulberry32 } from '@graao/game-core';

type Geo = THREE.BufferGeometry;

function paint(g: Geo, color: THREE.ColorRepresentation, jitter = 0, rand?: () => number): Geo {
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const k = jitter && rand ? 1 + (rand() - 0.5) * jitter : 1;
    arr[i * 3] = c.r * k;
    arr[i * 3 + 1] = c.g * k;
    arr[i * 3 + 2] = c.b * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

/** Normalizes attribute sets (position, normal, color) so geometries can be merged. */
function clean(g: Geo): Geo {
  for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(name)) g.deleteAttribute(name);
  return g.index ? g.toNonIndexed() : g;
}

function at(g: Geo, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): Geo {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
  g.applyMatrix4(m);
  return g;
}

function merge(parts: Geo[]): Geo {
  const g = mergeGeometries(parts.map(clean), false)!;
  g.computeBoundingSphere();
  return g;
}

/** Faceted look: drop shared normals. */
function faceted(g: Geo): Geo {
  const n = g.index ? g.toNonIndexed() : g;
  n.deleteAttribute('normal');
  n.computeVertexNormals();
  return n;
}

/** Lumpy blob: icosphere displaced by smooth noise (canopies, bushes, rocks). */
function blob(radius: number, detail: number, amount: number, seed: number, squashY = 1): Geo {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const r = mulberry32(seed);
  const o = [r() * 10, r() * 10, r() * 10];
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = Math.sin(v.x * 3.1 + o[0]!) * Math.sin(v.y * 2.7 + o[1]!) * Math.sin(v.z * 3.3 + o[2]!);
    v.multiplyScalar(1 + n * amount);
    v.y *= squashY;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

// -------------------------------------------------------------------------------------------- nature

const LEAF = ['#6fa84f', '#86b552', '#5c9a4c'];
const LEAF_DARK = '#4f8a45';
const TRUNK = '#8a6248';

export function treeGeometry(variant: number): Geo {
  const r = mulberry32(100 + variant);
  const trunk = paint(at(new THREE.CylinderGeometry(0.16, 0.26, 2.6, 7), 0, 1.3, 0), TRUNK);
  const parts: Geo[] = [trunk];
  const blobs = variant === 2 ? 3 : 4;
  for (let i = 0; i < blobs; i++) {
    const a = (i / blobs) * Math.PI * 2 + r();
    const rad = i === 0 ? 0 : 0.75;
    const s = i === 0 ? 1.45 : 1.0 + r() * 0.3;
    parts.push(paint(at(blob(s, 1, 0.12, variant * 10 + i, 0.85), Math.cos(a) * rad, 3.0 + (i === 0 ? 0.4 : r() * 0.5), Math.sin(a) * rad), i === 0 ? LEAF[variant % 3]! : LEAF_DARK, 0.06, r));
  }
  return merge(parts);
}

export function pineGeometry(variant: number): Geo {
  const parts: Geo[] = [paint(at(new THREE.CylinderGeometry(0.13, 0.22, 2.2, 6), 0, 1.1, 0), '#7a5640')];
  const tiers = 3 + (variant % 2);
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    parts.push(paint(at(new THREE.ConeGeometry(1.35 - t * 0.85, 1.5, 7), 0, 1.6 + i * 0.95, 0, 0, i * 0.4, 0), i % 2 ? '#3f7d57' : '#4b8a5e'));
  }
  return merge(parts.map(faceted));
}

export function rockGeometry(variant: number): Geo {
  const g = blob(0.95, 1, 0.22, 300 + variant, 0.72);
  return merge([paint(faceted(g), ['#a79c8e', '#9a9488', '#b3a593'][variant % 3]!, 0.1, mulberry32(variant))]);
}

export function bushGeometry(variant: number): Geo {
  const r = mulberry32(500 + variant);
  const parts: Geo[] = [];
  for (let i = 0; i < 3; i++) {
    const a = r() * Math.PI * 2;
    parts.push(paint(at(blob(0.45 + r() * 0.2, 1, 0.12, variant * 7 + i, 0.8), Math.cos(a) * 0.35, 0.35, Math.sin(a) * 0.35), i ? LEAF_DARK : LEAF[(variant + 1) % 3]!, 0.08, r));
  }
  return merge(parts);
}

// -------------------------------------------------------------------------------------------- architecture

const WALLS = ['#f2e2c9', '#e9c8b5', '#d8e3d2'];
const ROOFS = ['#d0694e', '#4f8f8c', '#c98a4a'];

export function houseGeometry(variant: number): Geo {
  const v = HOUSE_VARIANTS[variant % HOUSE_VARIANTS.length]!;
  const parts: Geo[] = [];
  // Foundation sinks into slopes; walls; trim band.
  parts.push(paint(at(new THREE.BoxGeometry(v.w + 0.2, 1.4, v.d + 0.2), 0, -0.4, 0), '#a89a8a'));
  parts.push(paint(at(new THREE.BoxGeometry(v.w, v.h, v.d), 0, v.h / 2, 0), WALLS[variant % 3]!));
  // Gable roof as a prism (extruded triangle along X).
  const o = v.overhang;
  const shape = new THREE.Shape();
  shape.moveTo(-(v.d / 2 + o), 0);
  shape.lineTo(v.d / 2 + o, 0);
  shape.lineTo(0, v.roofH);
  shape.lineTo(-(v.d / 2 + o), 0);
  const roof = new THREE.ExtrudeGeometry(shape, { depth: v.w + o * 2, bevelEnabled: false });
  roof.translate(0, 0, -(v.w / 2 + o));
  roof.rotateY(Math.PI / 2);
  parts.push(paint(at(roof, 0, v.h, 0), ROOFS[variant % 3]!));
  // Door, windows, chimney.
  parts.push(paint(at(new THREE.BoxGeometry(0.95, 1.9, 0.12), 0.6, 0.95, v.d / 2 + 0.02), '#5b4a5e'));
  const winColor = '#8fb4c9';
  const floors = v.h > 4.5 ? 2 : 1;
  for (let f = 0; f < floors; f++) {
    const wy = 1.55 + f * 2.3;
    parts.push(paint(at(new THREE.BoxGeometry(0.85, 0.85, 0.1), -v.w / 4 - 0.2, wy, v.d / 2 + 0.03), winColor));
    if (f > 0 || v.w > 5) parts.push(paint(at(new THREE.BoxGeometry(0.85, 0.85, 0.1), v.w / 4 + 0.6, wy + (f ? 0 : 0.0), v.d / 2 + 0.03), winColor));
    parts.push(paint(at(new THREE.BoxGeometry(0.1, 0.8, 0.8), v.w / 2 + 0.03, wy, 0), winColor));
    parts.push(paint(at(new THREE.BoxGeometry(0.1, 0.8, 0.8), -v.w / 2 - 0.03, wy, 0), winColor));
  }
  parts.push(paint(at(new THREE.BoxGeometry(0.55, 1.4, 0.55), -v.w / 3, v.h + v.roofH * 0.55, -v.d / 6), '#b58a6e'));
  // Awning over the door.
  parts.push(paint(at(new THREE.BoxGeometry(1.5, 0.12, 0.7), 0.6, 2.15, v.d / 2 + 0.35, 0.25, 0, 0), ROOFS[(variant + 1) % 3]!));
  return merge(parts);
}

export function towerGeometry(): Geo {
  const t = STRUCTURE_DIMS.tower;
  const parts: Geo[] = [];
  parts.push(paint(at(new THREE.CylinderGeometry(t.radius * 1.12, t.radius * 1.25, 1.6, 16), 0, 0.2, 0), '#9d8f84'));
  parts.push(paint(at(new THREE.CylinderGeometry(t.radius * 0.94, t.radius, t.height, 16), 0, t.height / 2, 0), '#ece0cc'));
  for (const y of [3.5, 7.2, 10.6]) parts.push(paint(at(new THREE.CylinderGeometry(t.radius * 1.03, t.radius * 1.03, 0.35, 16), 0, y, 0), '#c9775a'));
  parts.push(paint(at(new THREE.CylinderGeometry(t.radius * 1.15, t.radius * 1.1, 0.5, 16), 0, t.height, 0), '#c9775a'));
  parts.push(paint(at(new THREE.SphereGeometry(t.domeRadius, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0, t.height + 0.2, 0), '#5e9fb0'));
  // Telescope slit and the telescope itself.
  parts.push(paint(at(new THREE.BoxGeometry(0.9, 2.6, 0.5), 0, t.height + 1.8, t.domeRadius * 0.62, -0.75, 0, 0), '#2f3b4f'));
  parts.push(paint(at(new THREE.CylinderGeometry(0.28, 0.4, 3.4, 10), 0, t.height + 2.6, t.domeRadius * 0.8, 0.9, 0, 0), '#e2b65c'));
  // Windows and door.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    parts.push(paint(at(new THREE.BoxGeometry(0.6, 1.0, 0.25), Math.sin(a) * t.radius * 0.97, 5.2 + (i % 2) * 3.6, Math.cos(a) * t.radius * 0.97, 0, a, 0), '#3f5f7a'));
  }
  parts.push(paint(at(new THREE.BoxGeometry(1.3, 2.2, 0.3), 0, 1.1, t.radius * 0.97), '#5b4a5e'));
  return merge(parts);
}

export function giantTreeGeometry(): Geo {
  const g = STRUCTURE_DIMS.giantTree;
  const r = mulberry32(777);
  const parts: Geo[] = [];
  parts.push(paint(at(new THREE.CylinderGeometry(g.trunkRadius * 0.7, g.trunkRadius * 1.15, g.trunkHeight, 12, 4), 0, g.trunkHeight / 2 - 0.5, 0), '#8a6248'));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    parts.push(paint(at(new THREE.CylinderGeometry(0.35, 0.95, 4.8, 7), Math.cos(a) * 2.2, 0.6, Math.sin(a) * 2.2, Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9), '#7c573f'));
  }
  // Branches.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.7;
    parts.push(paint(at(new THREE.CylinderGeometry(0.4, 0.8, 7, 7), Math.cos(a) * 3, g.trunkHeight - 2, Math.sin(a) * 3, Math.sin(a) * 1.0, 0, -Math.cos(a) * 1.0), '#7c573f'));
  }
  const canopy: [number, number, number, number][] = [
    [0, 20, 0, 7.5],
    [5.5, 18.5, 1.5, 5.2],
    [-5, 19, -2, 5.6],
    [1.5, 18, -5.5, 5],
    [-2, 18.5, 5.2, 5],
    [0, 24, 0.5, 5],
  ];
  canopy.forEach(([x, y, z, s], i) => parts.push(paint(at(blob(s, 2, 0.1, 40 + i, 0.8), x, y, z), i % 2 ? '#5f9c4b' : '#79b152', 0.08, r)));
  // Glowing fruit lanterns.
  for (let i = 0; i < 14; i++) {
    const a = r() * Math.PI * 2;
    const rad = 4 + r() * 4;
    parts.push(paint(at(new THREE.IcosahedronGeometry(0.35, 1), Math.cos(a) * rad, 14.5 + r() * 2, Math.sin(a) * rad), '#ffd36e'));
  }
  return merge(parts);
}

export function archGeometry(): Geo {
  const a = STRUCTURE_DIMS.arch;
  const px = a.span / 2 + a.pillar / 2;
  const stone = '#c7b7a2';
  const parts: Geo[] = [];
  for (const sx of [-1, 1]) {
    parts.push(paint(at(new THREE.BoxGeometry(a.pillar, a.height + 1, a.pillar), sx * px, a.height / 2 - 0.5, 0), stone));
    parts.push(paint(at(new THREE.BoxGeometry(a.pillar * 1.35, 0.4, a.pillar * 1.35), sx * px, a.height - 0.1, 0), '#b3a28e'));
  }
  parts.push(paint(at(new THREE.BoxGeometry(px * 2 + a.pillar + 0.6, a.lintel, a.pillar + 0.2), 0, a.height + a.lintel / 2, 0, 0, 0, 0.03), stone));
  // A crystal growing through the lintel (the world is "fractured").
  parts.push(paint(at(new THREE.OctahedronGeometry(0.6, 0), px * 0.5, a.height + a.lintel + 0.6, 0, 0, 0.4, 0.3, 0.7, 1.8, 0.7), '#9b8cf0'));
  return merge(parts.map(faceted));
}

export function crystalClusterGeometry(): Geo {
  const r = mulberry32(31);
  const parts: Geo[] = [paint(at(blob(1.3, 1, 0.2, 9, 0.5), 0, 0.2, 0), '#8c8296')];
  const colors = ['#9b8cf0', '#7fd6e8', '#c2a3ff'];
  for (let i = 0; i < 7; i++) {
    const a = r() * Math.PI * 2;
    const tilt = 0.15 + r() * 0.5;
    const h = 1.6 + r() * 2.8;
    const c = new THREE.CylinderGeometry(0, 0.32 + r() * 0.2, h, 6);
    parts.push(paint(at(c, Math.cos(a) * 0.6 * r(), h / 2 + 0.3, Math.sin(a) * 0.6 * r(), Math.cos(a) * tilt, 0, Math.sin(a) * tilt), colors[i % 3]!));
  }
  parts.push(paint(at(new THREE.CylinderGeometry(0, 0.55, 4.6, 6), 0.2, 2.6, -0.1), '#b8a6ff'));
  return merge(parts.map(faceted));
}

export function floatingShardGeometry(): Geo {
  const sh = STRUCTURE_DIMS.shard;
  const parts: Geo[] = [];
  const cone = new THREE.CylinderGeometry(sh.radius, 0.2, sh.depth, 9, 3);
  parts.push(paint(faceted(at(cone, 0, -sh.depth / 2, 0)), '#a1907e'));
  parts.push(paint(at(new THREE.CylinderGeometry(sh.radius * 1.02, sh.radius * 1.02, 0.35, 9), 0, 0.05, 0), '#86b552'));
  const r = mulberry32(55);
  for (let i = 0; i < 5; i++) {
    const a = r() * Math.PI * 2;
    const h = 2 + r() * 3;
    parts.push(paint(faceted(at(new THREE.CylinderGeometry(0, 0.4, h, 6), Math.cos(a) * 2.5, h / 2, Math.sin(a) * 2.5, 0.2 * Math.cos(a), 0, 0.2 * Math.sin(a))), '#7fd6e8'));
  }
  parts.push(at(treeGeometry(1), 1.5, 0.1, -1.2));
  return merge(parts);
}

export function lampGeometry(): Geo {
  return merge([
    paint(at(new THREE.CylinderGeometry(0.06, 0.09, 3.1, 6), 0, 1.55, 0), '#3d3a45'),
    paint(at(new THREE.BoxGeometry(0.42, 0.5, 0.42), 0, 3.25, 0), '#ffd879'),
    paint(at(new THREE.ConeGeometry(0.38, 0.3, 4), 0, 3.65, 0, 0, Math.PI / 4, 0), '#3d3a45'),
  ]);
}

export function wellGeometry(): Geo {
  const w = STRUCTURE_DIMS.well;
  return merge([
    paint(at(new THREE.CylinderGeometry(w.radius, w.radius * 1.05, w.height + 0.6, 12), 0, (w.height - 0.6) / 2, 0), '#b5a796'),
    paint(at(new THREE.CylinderGeometry(w.radius * 0.8, w.radius * 0.8, 0.05, 12), 0, w.height - 0.05, 0), '#4f8fb0'),
    paint(at(new THREE.BoxGeometry(0.12, 1.8, 0.12), w.radius * 0.85, w.height + 0.9, 0), '#7a5640'),
    paint(at(new THREE.BoxGeometry(0.12, 1.8, 0.12), -w.radius * 0.85, w.height + 0.9, 0), '#7a5640'),
    paint(at(new THREE.ConeGeometry(1.35, 0.9, 4), 0, w.height + 2.1, 0, 0, Math.PI / 4, 0), '#d0694e'),
  ]);
}

export function wallGeometry(): Geo {
  const w = STRUCTURE_DIMS.wall;
  const r = mulberry32(8);
  const parts: Geo[] = [];
  const n = 6;
  for (let i = 0; i < n; i++) {
    const x = -w.length / 2 + (i + 0.5) * (w.length / n);
    const h = w.height * (0.8 + r() * 0.3);
    parts.push(paint(at(new THREE.BoxGeometry(w.length / n - 0.05, h + 0.8, w.thickness), x, (h - 0.8) / 2, (r() - 0.5) * 0.06), i % 2 ? '#c2b39e' : '#b9a994'));
  }
  return merge(parts.map(faceted));
}

// -------------------------------------------------------------------------------------------- grass and flowers

/** A tuft of tapered blades; `aTip` (0 root → 1 tip) drives sway and color in the grass shader. */
export function grassTuftGeometry(): Geo {
  const blades = 5;
  const pos: number[] = [];
  const tip: number[] = [];
  const r = mulberry32(4242);
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + r();
    const ox = Math.cos(a) * 0.09 * r();
    const oz = Math.sin(a) * 0.09 * r();
    const h = 0.32 + r() * 0.3;
    const w = 0.035 + r() * 0.02;
    const lean = 0.12 + r() * 0.15;
    const dx = Math.cos(a + Math.PI / 2) * w;
    const dz = Math.sin(a + Math.PI / 2) * w;
    const lx = Math.cos(a) * lean;
    const lz = Math.sin(a) * lean;
    const p0 = [ox - dx, 0, oz - dz];
    const p1 = [ox + dx, 0, oz + dz];
    const p2 = [ox + dx * 0.55 + lx * 0.5, h * 0.55, oz + dz * 0.55 + lz * 0.5];
    const p3 = [ox - dx * 0.55 + lx * 0.5, h * 0.55, oz - dz * 0.55 + lz * 0.5];
    const p4 = [ox + lx, h, oz + lz];
    const quad = [p0, p1, p2, p0, p2, p3, p3, p2, p4];
    const tips = [0, 0, 0.55, 0, 0.55, 0.55, 0.55, 0.55, 1];
    quad.forEach((p, i) => {
      pos.push(p[0]!, p[1]!, p[2]!);
      tip.push(tips[i]!);
    });
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aTip', new THREE.Float32BufferAttribute(tip, 1));
  // Normals point mostly up so grass shades like the ground under it.
  const n = new Float32Array(pos.length);
  for (let i = 0; i < n.length; i += 3) n[i + 1] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  return g;
}

export function flowerGeometry(): Geo {
  const parts: Geo[] = [
    paint(at(new THREE.CylinderGeometry(0.012, 0.015, 0.36, 4), 0, 0.18, 0), '#5f9c4b'),
    paint(at(new THREE.IcosahedronGeometry(0.07, 0), 0, 0.38, 0, 0, 0, 0, 1, 0.6, 1), '#ffffff'),
  ];
  return merge(parts);
}
