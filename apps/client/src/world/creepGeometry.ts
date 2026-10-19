/**
 * Code-built creep models (no Blender, no download), the propGeometry / lootGeometry recipe: merged rounded
 * primitives, one flat colour per piece (the ink pass outlines where colours meet), chunky silhouettes that read at a
 * distance. Each creep is a body plus two limbs on pivots, so the CreepView can swing them (attacks, waddles).
 *
 * Local frame: X the creep's left, Y up, Z front (where it looks and strikes). Every model stands on y = 0.
 *
 *   Barrolinho              a round clay ball with pebbles stuck in it, button eyes, stubby arms and feet.
 *   Besouro de Cristal      a low indigo shell with cyan crystals on the back, six little legs, two pincers.
 *   Pedreiro Encantado      three stacked stones with moss on top, glowing slit eyes, two huge stone arms.
 *   Guardião da Pedra-Sabão a tall soapstone figure with glowing runes, a crystal crown and heavy fists (elite).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { CreepTypeId } from '@graao/game-data';

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

const ball = (r: number, color: string, w = 14, h = 10) => paint(new THREE.SphereGeometry(r, w, h), color);
const box = (x: number, y: number, z: number, r: number, color: string) => paint(new RoundedBoxGeometry(x, y, z, 2, r), color);
const rock = (r: number, color: string, detail = 0) => paint(new THREE.DodecahedronGeometry(r, detail), color);
const crystal = (r: number, h: number, color: string) => paint(new THREE.ConeGeometry(r, h, 5, 1), color);

/** Two cartoon eyes on the front (+Z) at height `y`, `gap` apart. */
function eyes(y: number, z: number, gap: number, r: number, white = '#fbf6ea', pupil = '#2a2130'): Geo[] {
  const out: Geo[] = [];
  for (const s of [-1, 1]) {
    out.push(at(ball(r, white, 10, 8), s * gap, y, z, 0, 0, 0, 1, 1, 0.55));
    out.push(at(ball(r * 0.5, pupil, 8, 6), s * gap, y, z + r * 0.42, 0, 0, 0, 1, 1, 0.5));
  }
  return out;
}

export interface CreepModel {
  body: Geo;
  /** Limbs hang from these pivots (local frame). */
  armL: Geo;
  armR: Geo;
  pivotL: THREE.Vector3;
  pivotR: THREE.Vector3;
  /** Height of the head top (health bar, alert mark). */
  height: number;
}

function barrolinho(): CreepModel {
  const CLAY = '#b9774a';
  const CLAY_DARK = '#8f5735';
  const STONE = '#8a8174';
  const body = merge([
    at(ball(0.36, CLAY, 16, 12), 0, 0.4, 0, 0, 0, 0, 1, 0.92, 1),
    at(ball(0.2, CLAY_DARK, 10, 8), 0, 0.68, -0.04, 0, 0, 0, 1.2, 0.5, 1),
    at(rock(0.07, STONE), -0.24, 0.52, 0.2),
    at(rock(0.06, '#a39a8c'), 0.27, 0.32, 0.16),
    at(rock(0.08, STONE), 0.12, 0.62, -0.24),
    at(rock(0.05, '#6f675c'), -0.2, 0.2, -0.22),
    ...eyes(0.5, 0.3, 0.12, 0.075),
    at(ball(0.11, CLAY_DARK, 10, 8), -0.15, 0.06, 0.05, 0, 0, 0, 1, 0.55, 1.25),
    at(ball(0.11, CLAY_DARK, 10, 8), 0.15, 0.06, 0.05, 0, 0, 0, 1, 0.55, 1.25),
  ]);
  const arm = () => merge([at(ball(0.09, CLAY, 10, 8), 0, -0.1, 0.02, 0, 0, 0, 1, 1.3, 1), at(rock(0.05, STONE), 0, -0.2, 0.05)]);
  return { body, armL: arm(), armR: arm(), pivotL: new THREE.Vector3(0.34, 0.46, 0.02), pivotR: new THREE.Vector3(-0.34, 0.46, 0.02), height: 0.82 };
}

function besouro(): CreepModel {
  const SHELL = '#3d3a5c';
  const SHELL_LIGHT = '#57537e';
  const CRYSTAL = '#8fe3ff';
  const CRYSTAL_DEEP = '#4cb8e8';
  const LEG = '#26243a';
  const legs: Geo[] = [];
  for (const s of [-1, 1]) for (const z of [-0.2, 0.02, 0.22]) legs.push(at(paint(new THREE.CylinderGeometry(0.025, 0.02, 0.32, 5), LEG), s * 0.36, 0.1, z, 0, 0, s * 1.0));
  const body = merge([
    at(ball(0.4, SHELL, 16, 10), 0, 0.3, 0, 0, 0, 0, 1.05, 0.62, 1.35),
    at(ball(0.36, SHELL_LIGHT, 14, 8), 0, 0.36, -0.05, 0, 0, 0, 0.85, 0.42, 1.12),
    at(ball(0.2, LEG, 12, 8), 0, 0.28, 0.48, 0, 0, 0, 1.1, 0.8, 0.9),
    at(crystal(0.11, 0.42, CRYSTAL), 0, 0.62, -0.05, -0.15),
    at(crystal(0.08, 0.3, CRYSTAL_DEEP), -0.17, 0.56, -0.18, -0.35, 0, 0.35),
    at(crystal(0.08, 0.3, CRYSTAL_DEEP), 0.17, 0.56, -0.18, -0.35, 0, -0.35),
    at(crystal(0.06, 0.22, CRYSTAL), 0, 0.52, -0.36, -0.7),
    ...eyes(0.36, 0.62, 0.1, 0.06, CRYSTAL, '#1b2a40'),
    ...legs,
  ]);
  const pincer = (s: number) => merge([at(paint(new THREE.ConeGeometry(0.05, 0.24, 5), '#1d1c2c'), 0, 0, 0.12, Math.PI / 2, 0, s * 0.3)]);
  return { body, armL: pincer(1), armR: pincer(-1), pivotL: new THREE.Vector3(0.1, 0.24, 0.6), pivotR: new THREE.Vector3(-0.1, 0.24, 0.6), height: 0.78 };
}

function pedreiro(): CreepModel {
  const STONE = '#8f8a7c';
  const STONE_LIGHT = '#a9a395';
  const STONE_DARK = '#6f6a5e';
  const MOSS = '#5f7f4e';
  const GLOW = '#ffe27a';
  const body = merge([
    at(box(0.86, 0.5, 0.7, 0.14, STONE_DARK), 0, 0.27, 0, 0, 0.1),
    at(box(0.72, 0.46, 0.6, 0.13, STONE), 0, 0.72, 0, 0, -0.12),
    at(box(0.52, 0.38, 0.48, 0.12, STONE_LIGHT), 0, 1.13, 0.02, 0, 0.08),
    at(ball(0.2, MOSS, 10, 6), 0.06, 1.33, -0.02, 0, 0, 0, 1.4, 0.45, 1.1),
    at(box(0.09, 0.04, 0.03, 0.015, GLOW), -0.11, 1.16, 0.25),
    at(box(0.09, 0.04, 0.03, 0.015, GLOW), 0.11, 1.16, 0.25),
    at(rock(0.09, STONE_LIGHT), 0.32, 0.5, 0.25),
    at(rock(0.07, MOSS), -0.3, 0.92, 0.2),
  ]);
  const arm = () => merge([
    at(box(0.26, 0.36, 0.26, 0.08, STONE), 0, -0.2, 0),
    at(box(0.34, 0.4, 0.34, 0.1, STONE_DARK), 0, -0.62, 0.04),
    at(ball(0.07, MOSS, 8, 6), 0.05, -0.05, 0.08),
  ]);
  return { body, armL: arm(), armR: arm(), pivotL: new THREE.Vector3(0.52, 1.0, 0), pivotR: new THREE.Vector3(-0.52, 1.0, 0), height: 1.45 };
}

function guardiao(): CreepModel {
  const SOAP = '#6f8f86';
  const SOAP_LIGHT = '#8eaba1';
  const SOAP_DARK = '#4f6a63';
  const RUNE = '#7dffd8';
  const GOLD = '#f0c35a';
  const body = merge([
    at(box(0.8, 0.5, 0.62, 0.12, SOAP_DARK), 0, 0.26, 0),
    at(box(0.92, 0.7, 0.66, 0.16, SOAP), 0, 0.84, 0),
    at(box(0.56, 0.44, 0.5, 0.12, SOAP_LIGHT), 0, 1.4, 0.02),
    // Glowing runes on the chest and the brow (the elite reads from afar).
    at(box(0.07, 0.3, 0.03, 0.015, RUNE), 0, 0.88, 0.34),
    at(box(0.22, 0.06, 0.03, 0.015, RUNE), 0, 0.96, 0.34),
    at(box(0.12, 0.05, 0.03, 0.015, RUNE), -0.12, 1.45, 0.27),
    at(box(0.12, 0.05, 0.03, 0.015, RUNE), 0.12, 1.45, 0.27),
    // Shoulder stones and a crystal crown.
    at(box(0.3, 0.2, 0.42, 0.08, SOAP_LIGHT), 0.56, 1.1, 0),
    at(box(0.3, 0.2, 0.42, 0.08, SOAP_LIGHT), -0.56, 1.1, 0),
    at(crystal(0.07, 0.3, RUNE), 0, 1.78, 0),
    at(crystal(0.05, 0.22, GOLD), -0.15, 1.72, 0, 0, 0, 0.35),
    at(crystal(0.05, 0.22, GOLD), 0.15, 1.72, 0, 0, 0, -0.35),
  ]);
  const arm = () => merge([
    at(box(0.26, 0.5, 0.26, 0.08, SOAP), 0, -0.24, 0),
    at(box(0.4, 0.38, 0.4, 0.12, SOAP_DARK), 0, -0.68, 0.04),
    at(box(0.05, 0.22, 0.03, 0.012, RUNE), 0, -0.68, 0.25),
  ]);
  return { body, armL: arm(), armR: arm(), pivotL: new THREE.Vector3(0.62, 1.1, 0), pivotR: new THREE.Vector3(-0.62, 1.1, 0), height: 1.9 };
}

const BUILDERS: Record<CreepTypeId, () => CreepModel> = { barrolinho, besouro, pedreiro, guardiao };
const cache = new Map<CreepTypeId, CreepModel>();

/** The shared model of a creep type (built once per page). */
export function creepModel(type: CreepTypeId): CreepModel {
  let m = cache.get(type);
  if (!m) {
    m = BUILDERS[type]();
    cache.set(type, m);
  }
  return m;
}
