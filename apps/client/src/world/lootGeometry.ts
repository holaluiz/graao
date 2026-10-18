/**
 * Code-built loot models (no Blender, no asset download): the graao chest (body, hinged lid, latch, a small glowing
 * gem) and the consumables and ammunition boxes. Same recipe as propGeometry: merged primitives, one flat colour per
 * piece (the ink pass outlines where colours meet), rounded chunky shapes that read at mid distance.
 *
 * Local frame: X side, Y up, Z front (the side that opens and faces the player). Every model sits on y = 0.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { AMMO, type AmmoType } from '@graao/game-data';

type Geo = THREE.BufferGeometry;

function paint(g: Geo, color: THREE.ColorRepresentation): Geo {
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

function at(g: Geo, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): Geo {
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz)));
  return g;
}

function merge(parts: Geo[]): Geo {
  const clean = parts.map((g) => {
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(name)) g.deleteAttribute(name);
    return g.index ? g.toNonIndexed() : g;
  });
  const g = mergeGeometries(clean, false)!;
  g.computeBoundingSphere();
  return g;
}

// ------------------------------------------------------------------------------------------------ chest

/** Chest dimensions (m); the gameplay collider (game-core CHEST_COLLIDER) wraps the closed chest. */
export const CHEST = { w: 0.9, d: 0.6, body: 0.42, lid: 0.22 } as const;
/** The lid hinges on the back top edge of the body. */
export const LID_PIVOT = new THREE.Vector3(0, CHEST.body, -CHEST.d / 2);

const WOOD = '#b8743f';
const WOOD_DARK = '#8a5232';
const LID_WOOD = '#c98549';
const BRASS = '#f0b94a';
const BRASS_DARK = '#c98a2c';

/** Body: a rounded wooden box with two brass bands, a dark foot and the latch plate in front. */
export function chestBodyGeometry(): Geo {
  const { w, d, body } = CHEST;
  return merge([
    paint(at(new RoundedBoxGeometry(w, body, d, 2, 0.06), 0, body / 2, 0), WOOD),
    paint(at(new RoundedBoxGeometry(w + 0.04, 0.07, d + 0.04, 1, 0.03), 0, 0.035, 0), WOOD_DARK),
    paint(at(new RoundedBoxGeometry(0.09, body + 0.02, d + 0.03, 1, 0.025), -w * 0.32, body / 2, 0), BRASS),
    paint(at(new RoundedBoxGeometry(0.09, body + 0.02, d + 0.03, 1, 0.025), w * 0.32, body / 2, 0), BRASS),
    // Latch plate (the lid's tongue closes over it).
    paint(at(new RoundedBoxGeometry(0.17, 0.15, 0.05, 1, 0.02), 0, body - 0.1, d / 2 + 0.01), BRASS_DARK),
    // Corner studs.
    ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => paint(at(new THREE.SphereGeometry(0.035, 6, 4), sx * (w / 2 - 0.02), 0.09, sz * (d / 2 - 0.02)), BRASS))),
  ]);
}

/**
 * Lid, modelled around its hinge (origin = LID_PIVOT): a half barrel along X with brass bands and the latch tongue in
 * front. Rotating it about X opens the chest backwards.
 */
export function chestLidGeometry(): Geo {
  const { w, d, lid } = CHEST;
  const r = d / 2;
  const sy = lid / r;
  const barrel = (len: number, rr: number, color: string, x = 0) =>
    paint(at(new THREE.CylinderGeometry(rr, rr, len, 12, 1, false, 0, Math.PI), x, 0, d / 2, 0, 0, Math.PI / 2, 1, 1, 1), color);
  const parts = [barrel(w, r, LID_WOOD), barrel(0.095, r + 0.018, BRASS, -w * 0.32), barrel(0.095, r + 0.018, BRASS, w * 0.32)];
  // Flatten the barrel's height and close its bottom with a thin board.
  for (const g of parts) g.applyMatrix4(new THREE.Matrix4().makeScale(1, sy, 1));
  parts.push(paint(at(new THREE.BoxGeometry(w, 0.03, d), 0, 0.015, d / 2), WOOD_DARK));
  // The latch tongue hangs over the front, where the gem sits.
  parts.push(paint(at(new RoundedBoxGeometry(0.15, 0.13, 0.05, 1, 0.02), 0, -0.02, d + 0.025), BRASS));
  return merge(parts);
}

/** The gem on the latch (drawn unlit so it glows). In the lid's frame, like the lid. */
export function chestGemGeometry(): Geo {
  const g = new THREE.OctahedronGeometry(0.05, 0);
  at(g, 0, -0.02, CHEST.d + 0.06, 0, Math.PI / 4, 0, 1, 1.35, 0.7);
  g.computeBoundingSphere();
  return g;
}

// ------------------------------------------------------------------------------------------------ consumables

/** Néctar de Vida: a round bottle (pink nectar) with a cork and a white cross on its belly. */
export function nectarGeometry(): Geo {
  return merge([
    paint(at(new THREE.SphereGeometry(0.12, 16, 12), 0, 0.12, 0), '#ff6f84'),
    paint(at(new THREE.CylinderGeometry(0.045, 0.055, 0.08, 10), 0, 0.26, 0), '#ffd7de'),
    paint(at(new THREE.CylinderGeometry(0.05, 0.045, 0.05, 10), 0, 0.32, 0), '#a8794f'),
    paint(at(new THREE.BoxGeometry(0.11, 0.035, 0.03), 0, 0.13, 0.115), '#ffffff'),
    paint(at(new THREE.BoxGeometry(0.035, 0.11, 0.03), 0, 0.13, 0.115), '#ffffff'),
  ]);
}

/** Cápsula de Escudo: an upright capsule (sky blue) belted by a hexagonal ring, with a hex cap. */
export function shieldCellGeometry(): Geo {
  return merge([
    paint(at(new THREE.CapsuleGeometry(0.075, 0.16, 6, 14), 0, 0.17, 0), '#6fbaff'),
    paint(at(new THREE.TorusGeometry(0.1, 0.022, 6, 6), 0, 0.17, 0, Math.PI / 2, 0, 0), '#eaf6ff'),
    paint(at(new THREE.CylinderGeometry(0.06, 0.06, 0.03, 6), 0, 0.335, 0), '#2f6fb4'),
  ]);
}

/** Cristal de Mana: a long violet crystal with two small shards at its foot. */
export function manaCrystalGeometry(): Geo {
  const tall = new THREE.OctahedronGeometry(0.1, 0);
  at(tall, 0, 0.2, 0, 0, Math.PI / 4, 0, 0.9, 2.0, 0.9);
  const small = new THREE.OctahedronGeometry(0.05, 0);
  at(small, 0.09, 0.06, 0.02, 0, 0, 0.5, 1, 1.6, 1);
  const small2 = new THREE.OctahedronGeometry(0.04, 0);
  at(small2, -0.08, 0.05, -0.03, 0, 0, -0.6, 1, 1.6, 1);
  const g = merge([paint(tall, '#a98bff'), paint(small, '#c9b6ff'), paint(small2, '#8a6cf0')]);
  g.deleteAttribute('normal');
  g.computeVertexNormals();
  return g;
}

/** An ammunition box in its type's colour, three round tips sticking out of the top and its tag band. */
export function ammoBoxGeometry(type: AmmoType): Geo {
  const c = AMMO[type].color;
  const tips = [-0.08, 0, 0.08].map((x) =>
    type === 'petal'
      ? paint(at(new THREE.CylinderGeometry(0.03, 0.03, 0.08, 10), x, 0.22, 0), '#d94f73')
      : paint(at(new THREE.CapsuleGeometry(0.022, 0.05, 3, 8), x, 0.22, 0), type === 'heavy' ? '#d7dde6' : '#ffe9a3'),
  );
  return merge([
    paint(at(new RoundedBoxGeometry(0.3, 0.17, 0.2, 2, 0.03), 0, 0.085, 0), c),
    paint(at(new THREE.BoxGeometry(0.31, 0.05, 0.21), 0, 0.09, 0), '#2a2130'),
    ...tips,
  ]);
}

// ------------------------------------------------------------------------------------------------ rarity glow

/** A soft disc on the ground (additive), coloured per instance by rarity. */
export function glowDiscGeometry(): Geo {
  const g = new THREE.CircleGeometry(0.55, 24);
  g.rotateX(-Math.PI / 2);
  return g;
}

/** A thin column of light (additive), fading upward in its texture; scaled per rarity. */
export function beamGeometry(): Geo {
  const g = new THREE.CylinderGeometry(0.07, 0.11, 1, 10, 1, true);
  g.translate(0, 0.5, 0);
  return g;
}

/** Radial (disc) or vertical (beam) alpha falloff, generated once. */
export function falloffTexture(kind: 'radial' | 'vertical'): THREE.Texture {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = kind === 'radial' ? ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2) : ctx.createLinearGradient(0, size, 0, 0);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(kind === 'radial' ? 0.45 : 0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
