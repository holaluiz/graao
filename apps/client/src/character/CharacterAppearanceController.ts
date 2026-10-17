/**
 * CharacterAppearanceController: turns a rendering-independent CharacterAppearance into one merged skinned geometry
 * (body regions hidden by clothes are dropped) plus a 16-color palette. Part geometry is cached per (body, part), so
 * switching back to anything already built is instant; color changes never touch geometry.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PARTS_BY_ID, colorHex, type BodyRegion } from '@graao/game-data';
import type { CharacterAppearance } from '@graao/shared';
import { createRig, SLIM, STURDY, type GRARig } from './rig/GRARig';
import { makeBodyShape, type BodyShape } from './build/anatomy';
import { PartBuilder, REGION_IDS, Slot } from './build/PartBuilder';
import { buildBody } from './parts/body';
import { buildFace } from './parts/face';
import { buildHair } from './parts/hair';
import { buildTop } from './parts/tops';
import { buildBottom } from './parts/bottoms';
import { buildShoes } from './parts/shoes';
import { ACCESSORY_COLORS, buildAccessory } from './parts/accessories';

export interface BuiltCharacter {
  geometry: THREE.BufferGeometry;
  rig: GRARig;
  stats: { vertices: number; triangles: number; buildMs: number; cacheHits: number };
}

type PartKind = 'face' | 'hair' | 'top' | 'bottom' | 'shoes' | 'accessory';

export class CharacterPartLibrary {
  private readonly rigs = new Map<string, GRARig>();
  private readonly shapes = new Map<string, BodyShape>();
  private readonly parts = new Map<string, THREE.BufferGeometry>();
  private readonly bodies = new Map<string, THREE.BufferGeometry>();

  rig(bodyId: string): GRARig {
    let r = this.rigs.get(bodyId);
    if (!r) {
      r = createRig(bodyId === 'body.sturdy' ? STURDY : SLIM);
      this.rigs.set(bodyId, r);
    }
    return r;
  }

  private shape(bodyId: string): BodyShape {
    let s = this.shapes.get(bodyId);
    if (!s) {
      s = makeBodyShape(this.rig(bodyId).proportions, bodyId === 'body.sturdy');
      this.shapes.set(bodyId, s);
    }
    return s;
  }

  private part(bodyId: string, kind: PartKind, id: string): { g: THREE.BufferGeometry; hit: boolean } {
    const key = `${bodyId}|${kind}|${id}`;
    const cached = this.parts.get(key);
    if (cached) return { g: cached, hit: true };
    const b = new PartBuilder();
    const s = this.shape(bodyId);
    switch (kind) {
      case 'face':
        buildFace(b, s.head, id);
        break;
      case 'hair':
        buildHair(b, s.head, id);
        break;
      case 'top':
        buildTop(b, s, id);
        break;
      case 'bottom':
        buildBottom(b, s, id);
        break;
      case 'shoes':
        buildShoes(b, s, id);
        break;
      case 'accessory':
        buildAccessory(b, s, id);
        break;
    }
    const g = b.toGeometry(this.rig(bodyId));
    this.parts.set(key, g);
    return { g, hit: false };
  }

  /** Body geometry with the given regions removed (cached per region mask). */
  private body(bodyId: string, hidden: Set<BodyRegion>): { g: THREE.BufferGeometry; hit: boolean } {
    const mask = [...hidden].sort().join(',');
    const key = `${bodyId}|${mask}`;
    const cached = this.bodies.get(key);
    if (cached) return { g: cached, hit: true };
    let base = this.bodies.get(`${bodyId}|`);
    if (!base) {
      const b = new PartBuilder();
      buildBody(b, this.shape(bodyId));
      base = b.toGeometry(this.rig(bodyId));
      this.bodies.set(`${bodyId}|`, base);
    }
    if (hidden.size === 0) return { g: base, hit: false };
    const ids = new Set([...hidden].map((r) => REGION_IDS[r]));
    const region = base.getAttribute('aRegion') as THREE.BufferAttribute;
    const idx = base.getIndex()!;
    const kept: number[] = [];
    for (let t = 0; t < idx.count; t += 3) {
      const a = idx.getX(t), b2 = idx.getX(t + 1), c = idx.getX(t + 2);
      // Drop a triangle only when all three corners are hidden: keeps borders closed under garment edges.
      if (ids.has(region.getX(a)) && ids.has(region.getX(b2)) && ids.has(region.getX(c))) continue;
      kept.push(a, b2, c);
    }
    const g = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(base.attributes)) g.setAttribute(name, attr);
    g.setIndex(kept);
    this.bodies.set(key, g);
    return { g, hit: false };
  }

  build(a: CharacterAppearance): BuiltCharacter {
    const t0 = performance.now();
    const hidden = new Set<BodyRegion>();
    for (const id of [a.hairId, a.topId, a.bottomId, a.shoesId, a.accessoryId]) {
      for (const r of PARTS_BY_ID.get(id)?.hideBodyRegions ?? []) hidden.add(r);
    }
    const pieces = [
      this.body(a.bodyId, hidden),
      this.part(a.bodyId, 'face', a.faceId),
      this.part(a.bodyId, 'hair', a.hairId),
      this.part(a.bodyId, 'top', a.topId),
      this.part(a.bodyId, 'bottom', a.bottomId),
      this.part(a.bodyId, 'shoes', a.shoesId),
      this.part(a.bodyId, 'accessory', a.accessoryId),
    ].filter((p) => (p.g.getIndex()?.count ?? 0) > 0);
    const geometry = mergeGeometries(pieces.map((p) => p.g), false)!;
    geometry.computeBoundingSphere();
    geometry.boundingSphere!.radius = Math.max(geometry.boundingSphere!.radius, 1.2);
    return {
      geometry,
      rig: this.rig(a.bodyId),
      stats: {
        vertices: geometry.getAttribute('position').count,
        triangles: (geometry.getIndex()?.count ?? 0) / 3,
        buildMs: performance.now() - t0,
        cacheHits: pieces.filter((p) => p.hit).length,
      },
    };
  }
}

const c = (hex: string) => new THREE.Color(hex);
const darker = (col: THREE.Color, k: number) => col.clone().multiplyScalar(k);
const luminance = (col: THREE.Color) => 0.2126 * col.r + 0.7152 * col.g + 0.0722 * col.b;

/** Resolves the 16 palette slots for an appearance (linear colors). */
export function buildPalette(a: CharacterAppearance): THREE.Color[] {
  const pal = Array.from({ length: 16 }, () => new THREE.Color('#ff00ff'));
  const skin = c(colorHex(a.skinId));
  const hair = c(colorHex(a.hairColorId));
  const top = c(colorHex(a.topColorId));
  const bottom = c(colorHex(a.bottomColorId));
  const shoes = c(colorHex(a.shoesColorId));
  pal[Slot.SKIN] = skin;
  pal[Slot.BLUSH] = skin.clone().lerp(c('#ff6b7a'), 0.32);
  pal[Slot.INK] = c('#2a2130');
  pal[Slot.EYE_WHITE] = c('#fff7ea');
  pal[Slot.HAIR] = hair;
  pal[Slot.HAIR_ACCENT] = c('#f2c14e');
  pal[Slot.TOP] = top;
  const light = luminance(top) > 0.45;
  switch (a.topId) {
    case 'top.hoodie':
      pal[Slot.TOP_ACCENT] = darker(top, 0.78);
      break;
    case 'top.longsleeve':
      pal[Slot.TOP_ACCENT] = light ? c('#2f3f6e') : c('#f1e8d6');
      break;
    case 'top.vest':
      pal[Slot.TOP_ACCENT] = c('#f1e8d6');
      break;
    default:
      pal[Slot.TOP_ACCENT] = light ? c('#34343b') : c('#f6efe2');
  }
  pal[Slot.BOTTOM] = bottom;
  pal[Slot.BOTTOM_ACCENT] = darker(bottom, 0.78);
  pal[Slot.SHOES] = shoes;
  pal[Slot.SOLE] = a.shoesId === 'shoes.boots' ? c('#5a4334') : c('#f4efe6');
  const acc = ACCESSORY_COLORS[a.accessoryId] ?? ACCESSORY_COLORS['acc.none']!;
  pal[Slot.ACC] = c(acc.acc);
  pal[Slot.ACC_ACCENT] = c(acc.accent);
  pal[Slot.MARK] = c('#ffe066');
  pal[Slot.LIPS] = darker(skin, 0.85);
  return pal;
}

/** Ids that change geometry (everything else only changes the palette). */
export function geometryKey(a: CharacterAppearance): string {
  return [a.bodyId, a.faceId, a.hairId, a.topId, a.bottomId, a.shoesId, a.accessoryId].join('|');
}
