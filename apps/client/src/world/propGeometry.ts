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
  // One flat color per piece (a jitter varies the piece, never its vertices): the ink pass outlines where pieces of
  // different colors meet, so a piece must not be speckled.
  const k = jitter && rand ? 1 + (rand() - 0.5) * jitter : 1;
  for (let i = 0; i < n; i++) {
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

/**
 * Araucária (the southern Minas pine): a tall bare trunk and a candelabra crown of flat-topped tiers, wider at the top
 * (its unmistakable silhouette against the sky). Same trunk collider as before (game-core scatterColliders 'pine').
 */
export function pineGeometry(variant: number): Geo {
  const r = mulberry32(200 + variant);
  const h = 4.6 + variant * 0.5;
  const parts: Geo[] = [paint(at(new THREE.CylinderGeometry(0.12, 0.22, h, 7), 0, h / 2, 0), '#6e5040')];
  const tiers = 2 + (variant % 2);
  for (let i = 0; i < tiers; i++) {
    const y = h - 0.4 - i * 0.75;
    const w = 2.3 - i * 0.55;
    // Branch whorls (thin bars) and the flat dark-green shelves they carry.
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + i * 0.5 + r() * 0.3;
      parts.push(paint(at(new THREE.CylinderGeometry(0.03, 0.05, w, 4), Math.cos(a) * w * 0.45, y - 0.12, Math.sin(a) * w * 0.45, 0, -a, Math.PI / 2 - 0.25), '#5c4234'));
    }
    parts.push(paint(at(new THREE.CylinderGeometry(w, w * 0.75, 0.45, 9), 0, y + 0.15, 0, 0, i * 0.3, 0), i % 2 ? '#2f6447' : '#3a7352', 0.06, r));
  }
  parts.push(paint(at(new THREE.ConeGeometry(0.7, 0.6, 7), 0, h + 0.15, 0), '#3a7352'));
  return merge(parts.map(faceted));
}

/** Cerrado tree (pequizeiro, barbatimão): a twisted dark trunk, low crooked branches, flat sparse crowns. */
export function cerradoTreeGeometry(variant: number): Geo {
  const r = mulberry32(600 + variant);
  const parts: Geo[] = [];
  const bark = '#5e4433';
  parts.push(paint(at(new THREE.CylinderGeometry(0.14, 0.24, 1.6, 6), 0.1, 0.75, 0, 0, 0, 0.18), bark));
  parts.push(paint(at(new THREE.CylinderGeometry(0.1, 0.15, 1.3, 6), -0.15, 1.9, 0.05, 0.1, 0, -0.35), bark));
  const crowns = 3 + (variant % 2);
  for (let i = 0; i < crowns; i++) {
    const a = (i / crowns) * Math.PI * 2 + r() * 0.8;
    const d = 0.55 + r() * 0.5;
    const y = 2.2 + r() * 0.7;
    const s = 0.75 + r() * 0.45;
    parts.push(paint(at(new THREE.CylinderGeometry(0.05, 0.08, d * 1.3, 5), Math.cos(a) * d * 0.5, y - 0.35, Math.sin(a) * d * 0.5, Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9), bark));
    parts.push(paint(at(blob(s, 1, 0.16, 610 + variant * 7 + i, 0.42), Math.cos(a) * d, y, Math.sin(a) * d), ['#7f9a4a', '#8fa857', '#6d8a3e'][(i + variant) % 3]!, 0.08, r));
  }
  return merge(parts);
}

/** Ipê in bloom (yellow, purple or pink by variant): a slim pale trunk, a round crown of flowers, petals on the ground. */
export function ipeGeometry(variant: number): Geo {
  const r = mulberry32(700 + variant);
  const bloom = ['#f2c230', '#b5609f', '#f19bbd'][variant % 3]!;
  const light = ['#f7d65a', '#cd7fbb', '#f6b9d0'][variant % 3]!;
  const parts: Geo[] = [paint(at(new THREE.CylinderGeometry(0.15, 0.24, 3.4, 7), 0, 1.7, 0), '#a58566')];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    parts.push(paint(at(new THREE.CylinderGeometry(0.06, 0.1, 1.5, 5), Math.cos(a) * 0.45, 3.4, Math.sin(a) * 0.45, Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7), '#8f7258'));
  }
  const blobs = 4;
  for (let i = 0; i < blobs; i++) {
    const a = (i / blobs) * Math.PI * 2 + r();
    const rad = i === 0 ? 0 : 0.95;
    parts.push(paint(at(blob(i === 0 ? 1.55 : 1.05, 1, 0.14, 720 + variant * 9 + i, 0.8), Math.cos(a) * rad, 4.2 + (i === 0 ? 0.35 : r() * 0.4), Math.sin(a) * rad), i % 2 ? light : bloom, 0.05, r));
  }
  // Fallen petals: a thin disc around the trunk.
  parts.push(paint(at(new THREE.CylinderGeometry(1.9, 1.9, 0.03, 12), 0, 0.17, 0), light));
  return merge(parts);
}

/** Jerivá palm: a slim curved trunk, drooping fronds, a cluster of orange coconuts. */
export function palmGeometry(variant: number): Geo {
  const r = mulberry32(800 + variant);
  const parts: Geo[] = [];
  const lean = (variant - 1) * 0.07;
  let x = 0;
  let y = 0;
  for (let i = 0; i < 4; i++) {
    const segH = 1.45;
    parts.push(paint(at(new THREE.CylinderGeometry(0.15, 0.19, segH, 7), x, y + segH / 2, 0, 0, 0, -lean * (i + 1)), '#a58566'));
    x += Math.sin(lean * (i + 1)) * segH;
    y += Math.cos(lean * (i + 1)) * segH;
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + r() * 0.3;
    const frond = new THREE.BoxGeometry(0.42, 0.04, 2.0);
    frond.translate(0, 0, 1.0);
    parts.push(paint(at(frond, x, y + 0.1, 0, 0.55 + r() * 0.25, a, 0), i % 2 ? '#5f9a48' : '#6faa52'));
  }
  for (let i = 0; i < 4; i++) parts.push(paint(at(new THREE.IcosahedronGeometry(0.13, 0), x + Math.cos(i * 1.6) * 0.25, y - 0.35, Math.sin(i * 1.6) * 0.25), '#e0962e'));
  return merge(parts.map(faceted));
}

/** Canela-de-ema (Vellozia) of the campo rupestre: forked dark stems ending in green tufts, a purple flower. */
export function canelaGeometry(variant: number): Geo {
  const r = mulberry32(900 + variant);
  const parts: Geo[] = [paint(at(new THREE.CylinderGeometry(0.05, 0.08, 0.7, 5), 0, 0.35, 0), '#4a4352')];
  const forks = 2 + (variant % 2);
  for (let i = 0; i < forks; i++) {
    const a = (i / forks) * Math.PI * 2 + r();
    parts.push(paint(at(new THREE.CylinderGeometry(0.035, 0.05, 0.55, 5), Math.cos(a) * 0.12, 0.88, Math.sin(a) * 0.12, Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5), '#4a4352'));
    parts.push(paint(at(new THREE.ConeGeometry(0.2, 0.4, 6), Math.cos(a) * 0.28, 1.25, Math.sin(a) * 0.28), '#7f9a52'));
  }
  parts.push(paint(at(new THREE.ConeGeometry(0.06, 0.12, 5), 0, 1.5, 0), '#b5609f'));
  return merge(parts.map(faceted));
}

/** Golden grass tuft (capim-dourado and the dry grass of the campos): a fan of thin blades. */
export function capimGeometry(variant: number): Geo {
  const r = mulberry32(950 + variant);
  const parts: Geo[] = [];
  for (let i = 0; i < 7; i++) {
    const a = r() * Math.PI * 2;
    const t = 0.15 + r() * 0.25;
    const h = 0.55 + r() * 0.35;
    parts.push(paint(at(new THREE.ConeGeometry(0.045, h, 3), Math.cos(a) * 0.08, h / 2, Math.sin(a) * 0.08, Math.sin(a) * t, 0, -Math.cos(a) * t), ['#d8c06a', '#c9a94e', '#e3cf84'][(i + variant) % 3]!));
  }
  return merge(parts);
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

/** Per-variant palettes: pastel plaster, a darker plinth, a painted accent (door, shutters) and terracotta tiles. */
const HOUSE_LOOKS = [
  { wall: '#f3e3c8', plinth: '#d6b08d', accent: '#3f8f8a', tile: '#cf6a4c' },
  { wall: '#f2c4b0', plinth: '#c48b78', accent: '#4b77b6', tile: '#b9563f' },
  { wall: '#cfe6d4', plinth: '#9dbea6', accent: '#e0a03a', tile: '#d27b45' },
];
const TRIM = '#fbf7ee';
const GLASS = '#86b9cc';
const METAL = '#b9bec0';

type Side = 'front' | 'back' | 'left' | 'right';
type AddFn = (g: Geo, color: THREE.ColorRepresentation) => void;

/** Box in a facade-local frame (x along the wall, y up, z out of the wall). */
const B = (w: number, h: number, d: number, x: number, y: number, z: number, rx = 0) => at(new THREE.BoxGeometry(w, h, d), x, y, z, rx);

/**
 * Brazilian-village houses with Messenger-grade detail: plinth band, corner trims and a cornice, framed windows with
 * sills, lintels, mullions and slatted shutters, a paneled door with its step and awning, tiled roof slabs with ridge,
 * fascia and verge boards over gable walls, and the life of a street: AC unit, light meter, downspout, planters and
 * (on the tall house) a blue rooftop water tank. Everything stays inside the gameplay collider but for shallow reliefs.
 */
export function houseGeometry(variant: number): Geo {
  const v = HOUSE_VARIANTS[variant % HOUSE_VARIANTS.length]!;
  const look = HOUSE_LOOKS[variant % HOUSE_LOOKS.length]!;
  const accentDark = new THREE.Color(look.accent).multiplyScalar(0.8);
  const tileDark = new THREE.Color(look.tile).multiplyScalar(0.82);
  const parts: Geo[] = [];
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, rx = 0) =>
    parts.push(paint(at(new THREE.BoxGeometry(w, h, d), x, y, z, rx), color));
  /** Places facade-local pieces on one side of the house, centered at (u along the wall, y). */
  const onWall = (side: Side, u: number, y: number, build: (add: AddFn) => void) => {
    const m = new THREE.Matrix4();
    if (side === 'front') m.makeRotationY(0).setPosition(u, y, v.d / 2);
    else if (side === 'back') m.makeRotationY(Math.PI).setPosition(-u, y, -v.d / 2);
    else if (side === 'right') m.makeRotationY(Math.PI / 2).setPosition(v.w / 2, y, -u);
    else m.makeRotationY(-Math.PI / 2).setPosition(-v.w / 2, y, u);
    build((g, color) => parts.push(paint(g.applyMatrix4(m), color)));
  };

  const windowAt = (side: Side, u: number, y: number, shutters: boolean, planter = false) =>
    onWall(side, u, y, (add) => {
      add(B(0.98, 1.12, 0.07, 0, 0, 0.035), TRIM);
      add(B(0.8, 0.94, 0.04, 0, 0, 0.06), GLASS);
      add(B(0.05, 0.94, 0.03, 0, 0, 0.085), TRIM);
      add(B(0.8, 0.05, 0.03, 0, 0.14, 0.085), TRIM);
      add(B(1.14, 0.07, 0.17, 0, -0.6, 0.085), TRIM);
      add(B(1.08, 0.09, 0.09, 0, 0.6, 0.045), TRIM);
      if (shutters) {
        for (const k of [-1, 1]) {
          add(B(0.42, 1.06, 0.04, k * 0.72, 0, 0.03), look.accent);
          for (let i = 0; i < 4; i++) add(B(0.34, 0.03, 0.02, k * 0.72, -0.36 + i * 0.24, 0.058), accentDark);
        }
      }
      if (planter) {
        add(B(0.86, 0.2, 0.2, 0, -0.74, 0.12), '#c4734e');
        for (const k of [-0.25, 0.02, 0.27]) add(at(new THREE.IcosahedronGeometry(0.15, 1), k, -0.58, 0.12, 0, 0, 0, 1, 0.8, 0.9), k > 0 ? '#5f9c4b' : '#79b152');
      }
    });

  const doorAt = (side: Side, u: number) =>
    onWall(side, u, 0, (add) => {
      add(B(1.14, 2.14, 0.07, 0, 1.07, 0.035), TRIM);
      add(B(0.92, 2.0, 0.08, 0, 1.0, 0.05), look.accent);
      add(B(0.66, 0.74, 0.02, 0, 1.46, 0.1), accentDark);
      add(B(0.66, 0.62, 0.02, 0, 0.55, 0.1), accentDark);
      add(at(new THREE.SphereGeometry(0.04, 8, 6), 0.33, 1.0, 0.12), '#e8c25a');
      add(B(1.4, 0.14, 0.42, 0, 0.07, 0.21), '#c9c2b6');
      // Awning on two brackets.
      add(B(1.6, 0.08, 0.72, 0, 2.42, 0.34, 0.32), look.tile);
      for (const k of [-0.68, 0.68]) add(B(0.06, 0.06, 0.5, k, 2.26, 0.25, -0.6), TRIM);
    });

  // Foundation (sinks into slopes), plinth band, walls, corner trims, cornice (and a floor band on the tall house).
  box(v.w + 0.2, 1.4, v.d + 0.2, 0, -0.4, 0, '#a89a8a');
  box(v.w + 0.06, 0.5, v.d + 0.06, 0, 0.25, 0, look.plinth);
  box(v.w, v.h, v.d, 0, v.h / 2, 0, look.wall);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.16, v.h - 0.5, 0.16, sx * (v.w / 2 - 0.05), 0.5 + (v.h - 0.5) / 2, sz * (v.d / 2 - 0.05), TRIM);
  box(v.w + 0.16, 0.16, v.d + 0.16, 0, v.h - 0.08, 0, TRIM);
  const twoFloors = v.h > 4.5;
  if (twoFloors) box(v.w + 0.1, 0.12, v.d + 0.1, 0, 2.75, 0, TRIM);

  // Roof: gable walls under two tiled slabs, tile rows, ridge cap, fascia and verge boards.
  const o = v.overhang;
  const gable = new THREE.Shape();
  gable.moveTo(-v.d / 2, 0);
  gable.lineTo(v.d / 2, 0);
  gable.lineTo(0, v.roofH);
  gable.lineTo(-v.d / 2, 0);
  const gableGeo = new THREE.ExtrudeGeometry(gable, { depth: v.w, bevelEnabled: false });
  gableGeo.translate(0, 0, -v.w / 2);
  gableGeo.rotateY(Math.PI / 2);
  parts.push(paint(at(gableGeo, 0, v.h, 0), look.wall));
  const run = v.d / 2 + o;
  const slope = Math.atan2(v.roofH, run);
  const len = Math.hypot(run, v.roofH) + 0.06;
  for (const k of [1, -1]) {
    // Slab k = +1 covers the front slope (+Z), k = -1 the back one; n is the slope's outward normal.
    const nY = Math.cos(slope);
    const nZ = Math.sin(slope) * k;
    const cy = v.h + v.roofH / 2;
    const cz = (k * run) / 2;
    box(v.w + 2 * o, 0.12, len, 0, cy + nY * 0.06, cz + nZ * 0.06, look.tile, k * slope);
    for (const t of [0.2, 0.4, 0.6, 0.8]) {
      const y = v.h + v.roofH * (1 - t);
      const z = k * run * t;
      box(v.w + 2 * o, 0.035, 0.07, 0, y + nY * 0.135, z + nZ * 0.135, tileDark, k * slope);
    }
    box(v.w + 2 * o, 0.16, 0.05, 0, v.h - 0.03, k * (run + 0.02), TRIM);
    for (const sx of [-1, 1]) box(0.07, 0.15, len, sx * (v.w / 2 + o), cy + nY * 0.05, cz + nZ * 0.05, TRIM, k * slope);
  }
  parts.push(paint(at(new THREE.CylinderGeometry(0.1, 0.1, v.w + 2 * o + 0.04, 10), 0, v.h + v.roofH + 0.08, 0, 0, 0, Math.PI / 2), tileDark));

  // Openings per variant.
  if (variant % 3 === 0) {
    doorAt('front', 1.15);
    windowAt('front', -1.15, 1.55, true, true);
    windowAt('back', -1.2, 1.55, false);
    windowAt('back', 1.2, 1.55, false);
    windowAt('left', 0, 1.55, true);
    windowAt('right', 0.6, 1.55, false);
  } else if (variant % 3 === 1) {
    doorAt('front', -0.95);
    windowAt('front', 1.0, 1.55, true, true);
    windowAt('front', -1.05, 3.95, true);
    windowAt('front', 1.05, 3.95, true);
    windowAt('back', 0, 1.55, false);
    windowAt('back', 0, 3.95, false);
    windowAt('left', 0, 3.95, false);
    windowAt('right', 0.7, 1.55, true);
    // Blue fiberglass water tank on the ridge.
    parts.push(paint(at(new THREE.CylinderGeometry(0.46, 0.4, 0.62, 16), -v.w / 4, v.h + v.roofH + 0.2, 0), '#4f8fc0'));
    parts.push(paint(at(new THREE.CylinderGeometry(0.5, 0.5, 0.08, 16), -v.w / 4, v.h + v.roofH + 0.54, 0), '#3d76a3'));
  } else {
    doorAt('front', 0);
    windowAt('front', -1.95, 1.5, true, true);
    windowAt('front', 1.95, 1.5, true, true);
    windowAt('back', -1.4, 1.5, false);
    windowAt('back', 1.4, 1.5, false);
    windowAt('right', 0, 1.5, false);
  }

  // Street life: AC unit with grille, fan and drain pipe; light meter by the door; downspout at a front corner.
  onWall('right', variant % 3 === 1 ? -1.1 : -v.d / 2 + 0.75, twoFloors ? 3.3 : 2.35, (add) => {
    add(B(0.74, 0.48, 0.3, 0, 0, 0.15), '#e9e9e4');
    for (let i = 0; i < 4; i++) add(B(0.6, 0.025, 0.02, -0.04, -0.16 + i * 0.1, 0.31), METAL);
    add(at(new THREE.CylinderGeometry(0.15, 0.15, 0.02, 14), 0.2, 0, 0.31, Math.PI / 2), '#9aa1a4');
    add(at(new THREE.CylinderGeometry(0.025, 0.025, 1.9, 6), -0.28, -1.15, 0.1), METAL);
  });
  onWall('front', variant % 3 === 1 ? -0.1 : variant % 3 === 0 ? 0.3 : 0.85, 1.55, (add) => {
    add(B(0.32, 0.42, 0.12, 0, 0, 0.06), '#c9ccc9');
    add(B(0.18, 0.12, 0.02, 0, 0.06, 0.125), '#3b4a52');
  });
  parts.push(paint(at(new THREE.CylinderGeometry(0.05, 0.05, v.h, 8), v.w / 2 + 0.07, v.h / 2, v.d / 2 + 0.07), METAL));
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
