/**
 * CharacterAppearanceController: turns a rendering-independent CharacterAppearance into one merged skinned geometry
 * (body regions hidden by clothes are dropped) plus a color palette (`PALETTE_SIZE` slots). Part geometry is cached per (body, part), so
 * switching back to anything already built is instant; color changes never touch geometry.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PARTS_BY_ID, colorHex, type BodyRegion } from '@graao/game-data';
import type { CharacterAppearance } from '@graao/shared';
import { createRig, SLIM, STURDY, type GRARig } from './rig/GRARig';
import { makeBodyShape, type BodyShape } from './build/anatomy';
import { PALETTE_SIZE, PartBuilder, REGION_IDS, Slot } from './build/PartBuilder';
import { buildBody } from './parts/body';
import { buildFace } from './parts/face';
import { buildBeard } from './parts/beard';
import { buildHair } from './parts/hair';
import { buildHat } from './parts/hats';
import { buildTop } from './parts/tops';
import { buildBottom } from './parts/bottoms';
import { buildShoes } from './parts/shoes';
import { ACCESSORY_COLORS, buildAccessory } from './parts/accessories';
import type { AuthoredParts } from './build/AuthoredParts';
import { EXTRA_COLORS, buildExtra } from './parts/extras';

export interface BuiltCharacter {
  geometry: THREE.BufferGeometry;
  rig: GRARig;
  stats: { vertices: number; triangles: number; buildMs: number; cacheHits: number };
}

type PartKind = 'face' | 'beard' | 'hair' | 'top' | 'bottom' | 'shoes' | 'hat' | 'accessory' | 'extra';

/** Hats that sit over the hair (the flower crown does not, so buns and crests stay). */
const hatCovers = (hatId: string) => hatId !== 'hat.none' && hatId !== 'hat.flores';

/** Other ids a part's geometry depends on; they join its cache key. */
function partDeps(kind: PartKind, a: CharacterAppearance): string {
  switch (kind) {
    case 'hair':
      return hatCovers(a.hatId) ? 'covered' : '';
    case 'hat':
    case 'accessory':
      return a.hairId;
    case 'extra':
      return a.topId;
    default:
      return '';
  }
}

/**
 * Code-built stand-ins for the Blender-authored pieces (used until hero-parts.glb loads, and in tests/tools without it).
 */
const AUTHORED_FALLBACK: Record<string, string> = {
  'hair.ondulado': 'hair.cachos',
  'bottom.cargo': 'bottom.shorts',
  'shoes.retro': 'shoes.chunky',
};

export class CharacterPartLibrary {
  /** Pieces modeled in Blender; when one exists for (body, piece) it replaces the code-built version. */
  private authored: AuthoredParts | null = null;
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

  /** Switches to Blender-authored pieces where available (drops cached geometry so they take effect). */
  useAuthored(parts: AuthoredParts): void {
    this.authored = parts;
    this.parts.clear();
  }

  private part(a: CharacterAppearance, kind: PartKind, pieceId: string): { g: THREE.BufferGeometry; hit: boolean } {
    const bodyId = a.bodyId;
    const deps = partDeps(kind, a);
    const key = `${bodyId}|${kind}|${pieceId}|${deps}`;
    const cached = this.parts.get(key);
    if (cached) return { g: cached, hit: true };
    const b = new PartBuilder();
    const s = this.shape(bodyId);
    const authored = this.authored?.get(bodyId, kind === 'hair' && deps === 'covered' ? `${pieceId}#covered` : pieceId);
    if (authored) {
      for (const m of authored) b.mesh(m.positions, m.normals, m.index, { slot: m.slot, bones: m.bones, region: 'none' });
      const g = b.toGeometry(this.rig(bodyId));
      this.parts.set(key, g);
      return { g, hit: false };
    }
    const id = AUTHORED_FALLBACK[pieceId] ?? pieceId;
    switch (kind) {
      case 'face':
        buildFace(b, s.head, id);
        break;
      case 'beard':
        buildBeard(b, s.head, id);
        break;
      case 'hair':
        buildHair(b, s.head, id, deps === 'covered');
        break;
      case 'hat':
        buildHat(b, s.head, id, a.hairId);
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
        buildAccessory(b, s, id, a.hairId);
        break;
      case 'extra':
        buildExtra(b, s, id, a.topId);
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
    for (const id of [a.hairId, a.beardId, a.topId, a.bottomId, a.shoesId, a.hatId, a.accessoryId, a.extraId]) {
      for (const r of PARTS_BY_ID.get(id)?.hideBodyRegions ?? []) hidden.add(r);
    }
    const pieces = [
      this.body(a.bodyId, hidden),
      this.part(a, 'face', a.faceId),
      this.part(a, 'beard', a.beardId),
      this.part(a, 'hair', a.hairId),
      this.part(a, 'top', a.topId),
      this.part(a, 'bottom', a.bottomId),
      this.part(a, 'shoes', a.shoesId),
      this.part(a, 'hat', a.hatId),
      this.part(a, 'accessory', a.accessoryId),
      this.part(a, 'extra', a.extraId),
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

const INK = '#2a2130';
const PAPER = '#fbf6ea';

/** Football-shirt trim per shirt color: the canarinho gets green, the greens get yellow. */
const JERSEY_TRIM: Record<string, string> = {
  'fabric.canary': '#1f9a52',
  'fabric.mustard': '#1f9a52',
  'fabric.flag': '#f6d22c',
  'fabric.leaf': '#f6d22c',
  'fabric.moss': '#f6d22c',
  'fabric.plum': '#f6d22c',
  'fabric.white': '#2f3f6e',
  'fabric.cream': '#2f3f6e',
};

/** A contrasting third color: the hue's complement, or a fixed pop color when the base is nearly gray. */
function complement(col: THREE.Color, light: boolean): THREE.Color {
  const hsl = { h: 0, s: 0, l: 0 };
  col.getHSL(hsl);
  if (hsl.s < 0.25) return c(light ? '#e2478a' : '#2fb3ad');
  return col.clone().offsetHSL(0.5, 0, 0);
}

/** Resolves the palette slots for an appearance (linear colors). */
export function buildPalette(a: CharacterAppearance): THREE.Color[] {
  const pal = Array.from({ length: PALETTE_SIZE }, () => new THREE.Color('#ff00ff'));
  const skin = c(colorHex(a.skinId));
  const hair = c(colorHex(a.hairColorId));
  const top = c(colorHex(a.topColorId));
  const bottom = c(colorHex(a.bottomColorId));
  const shoes = c(colorHex(a.shoesColorId));
  const hat = c(colorHex(a.hatColorId));
  pal[Slot.SKIN] = skin;
  pal[Slot.BLUSH] = skin.clone().lerp(c('#ff6b7a'), 0.32);
  pal[Slot.INK] = c(INK);
  pal[Slot.EYE_WHITE] = c('#fff7ea');
  pal[Slot.HAIR] = hair;
  pal[Slot.HAIR_ACCENT] = c('#f2c14e');
  pal[Slot.STUBBLE] = hair.clone().lerp(skin, 0.45);
  pal[Slot.LEAF] = c('#3f9a4f');
  pal[Slot.POLLEN] = c('#ffd23f');

  pal[Slot.TOP] = top;
  const light = luminance(top) > 0.45;
  pal[Slot.TOP_ACCENT] = light ? c('#34343b') : c('#f6efe2');
  pal[Slot.TOP_DETAIL] = c(PAPER);
  switch (a.topId) {
    case 'top.hoodie':
      pal[Slot.TOP_ACCENT] = darker(top, 0.88);
      break;
    case 'top.longsleeve':
      pal[Slot.TOP_ACCENT] = light ? c('#2f3f6e') : c('#f1e8d6');
      break;
    case 'top.vest':
      pal[Slot.TOP_ACCENT] = c('#f1e8d6');
      break;
    case 'top.time':
      pal[Slot.TOP_ACCENT] = c(JERSEY_TRIM[a.topColorId] ?? (light ? INK : PAPER));
      break;
    case 'top.chita':
      // Red flowers on light chita, white ones on dark or red chita.
      pal[Slot.TOP_ACCENT] = luminance(top) > 0.3 ? c('#d9433b') : c(PAPER);
      break;
    case 'top.xadrez':
      pal[Slot.TOP_ACCENT] = darker(top, 0.6);
      pal[Slot.TOP_DETAIL] = light ? c(INK) : c(PAPER);
      break;
    case 'top.cortavento':
      pal[Slot.TOP_ACCENT] = light ? c('#2f3f6e') : c('#f6efe2');
      pal[Slot.TOP_DETAIL] = complement(top, light);
      break;
  }

  pal[Slot.BOTTOM] = bottom;
  const lightBottom = luminance(bottom) > 0.45;
  pal[Slot.BOTTOM_ACCENT] = darker(bottom, 0.78);
  pal[Slot.BOTTOM_DETAIL] = lightBottom ? c('#34343b') : c(PAPER);
  if (a.bottomId === 'bottom.capoeira') pal[Slot.BOTTOM_DETAIL] = c('#3f9a4f');
  if (a.bottomId === 'bottom.rodada') {
    pal[Slot.BOTTOM_ACCENT] = lightBottom ? darker(bottom, 0.8) : c(PAPER);
    pal[Slot.BOTTOM_DETAIL] = lightBottom ? c('#e2478a') : c(PAPER);
  }

  pal[Slot.SHOES] = shoes;
  const SOLES: Record<string, string> = { 'shoes.boots': '#5a4334', 'shoes.chuteira': '#34343b', 'shoes.sandalia': '#5a3b24', 'shoes.retro': '#f7f4ee' };
  pal[Slot.SOLE] = c(SOLES[a.shoesId] ?? '#f4efe6');
  pal[Slot.SHOES_DETAIL] = a.shoesId === 'shoes.chuteira' ? (luminance(shoes) > 0.45 ? c(INK) : c(PAPER)) : c('#c9ced6');
  if (a.shoesId === 'shoes.retro') pal[Slot.SHOES_DETAIL] = darker(shoes, 0.5);

  pal[Slot.HAT] = hat;
  const lightHat = luminance(hat) > 0.45;
  pal[Slot.HAT_ACCENT] = darker(hat, 0.72);
  switch (a.hatId) {
    case 'hat.palha':
      pal[Slot.HAT] = c('#e7c26a');
      pal[Slot.HAT_ACCENT] = hat;
      break;
    case 'hat.cangaceiro':
      pal[Slot.HAT] = c('#7a4e2c');
      pal[Slot.HAT_ACCENT] = hat;
      break;
    case 'hat.malandro':
      pal[Slot.HAT_ACCENT] = c(INK);
      break;
    case 'hat.bone':
    case 'hat.bonetras':
      pal[Slot.HAT_ACCENT] = lightHat ? c(INK) : c(PAPER);
      break;
    case 'hat.bandana':
      pal[Slot.HAT_ACCENT] = luminance(hat) > 0.6 ? c(INK) : c(PAPER);
      break;
    case 'hat.flores':
      pal[Slot.HAT_ACCENT] = c(PAPER);
      break;
  }

  const acc = ACCESSORY_COLORS[a.accessoryId] ?? ACCESSORY_COLORS['acc.none']!;
  pal[Slot.ACC] = c(acc.acc);
  pal[Slot.ACC_ACCENT] = c(acc.accent);
  const extra = EXTRA_COLORS[a.extraId] ?? EXTRA_COLORS['extra.none']!;
  pal[Slot.EXTRA] = c(extra.main);
  pal[Slot.EXTRA_ACCENT] = c(extra.accent);
  pal[Slot.EXTRA_DETAIL] = c(extra.detail);
  pal[Slot.MARK] = c('#ffe066');
  // Freckles (face.freckles) use the lips slot.
  pal[Slot.LIPS] = darker(skin, 0.68);
  return pal;
}

/** Ids that change geometry (everything else only changes the palette). */
export function geometryKey(a: CharacterAppearance): string {
  return [a.bodyId, a.faceId, a.beardId, a.hairId, a.topId, a.bottomId, a.shoesId, a.hatId, a.accessoryId, a.extraId].join('|');
}
