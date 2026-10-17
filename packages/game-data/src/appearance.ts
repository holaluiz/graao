/**
 * Appearance catalog: which ids exist, what each piece hides, and the palettes. Geometry builders live in the client
 * (`apps/client/src/character/parts`), keyed by these ids. Colors are separate from geometry (palette ids).
 */
import { APPEARANCE_KEYS, isAppearanceShape, type CharacterAppearance } from '@graao/shared';

/** Body regions that clothing can hide to avoid clipping, z-fighting and hidden overdraw. */
export type BodyRegion =
  | 'head'
  | 'neck'
  | 'torso'
  | 'hips'
  | 'upper_arms'
  | 'forearms'
  | 'hands'
  | 'upper_legs'
  | 'lower_legs'
  | 'feet';

export type PartSlot = 'hair' | 'top' | 'bottom' | 'shoes' | 'accessory';

export interface CatalogEntry {
  id: string;
  name: string;
}

export interface CharacterPartDefinition extends CatalogEntry {
  slot: PartSlot;
  hideBodyRegions: BodyRegion[];
  /** Palette the piece's main color comes from ('none' = fixed colors only). */
  palette: 'hair' | 'fabric' | 'none';
  defaultColorId: string;
}

export interface ColorEntry extends CatalogEntry {
  /** sRGB hex. */
  hex: string;
}

export const BODIES: CatalogEntry[] = [
  { id: 'body.slim', name: 'Esguio' },
  { id: 'body.sturdy', name: 'Robusto' },
];

export const FACES: CatalogEntry[] = [
  { id: 'face.calm', name: 'Tranquilo' },
  { id: 'face.bright', name: 'Radiante' },
  { id: 'face.sleepy', name: 'Sonolento' },
];

export const SKIN_TONES: ColorEntry[] = [
  { id: 'skin.porcelain', name: 'Porcelana', hex: '#f6dccb' },
  { id: 'skin.peach', name: 'Pêssego', hex: '#f0c3a4' },
  { id: 'skin.honey', name: 'Mel', hex: '#d9a27a' },
  { id: 'skin.caramel', name: 'Caramelo', hex: '#b97b52' },
  { id: 'skin.cocoa', name: 'Cacau', hex: '#8a5636' },
  { id: 'skin.ebony', name: 'Ébano', hex: '#5e3a26' },
];

export const HAIR_COLORS: ColorEntry[] = [
  { id: 'hair.ink', name: 'Nanquim', hex: '#2a2433' },
  { id: 'hair.chestnut', name: 'Castanho', hex: '#5b3424' },
  { id: 'hair.auburn', name: 'Acobreado', hex: '#8f3f22' },
  { id: 'hair.honey', name: 'Mel', hex: '#c98e45' },
  { id: 'hair.ash', name: 'Cinza', hex: '#b9b3aa' },
  { id: 'hair.coral', name: 'Coral', hex: '#ee7a6b' },
  { id: 'hair.teal', name: 'Azul-petróleo', hex: '#3f8f8c' },
  { id: 'hair.lilac', name: 'Lilás', hex: '#9a86c9' },
];

/** Shared palette for every garment (tops, bottoms, shoes). */
export const FABRIC_COLORS: ColorEntry[] = [
  { id: 'fabric.cream', name: 'Creme', hex: '#f1e8d6' },
  { id: 'fabric.orange', name: 'Laranja', hex: '#ec8a3a' },
  { id: 'fabric.tomato', name: 'Tomate', hex: '#d9493b' },
  { id: 'fabric.mustard', name: 'Mostarda', hex: '#e6b83c' },
  { id: 'fabric.sky', name: 'Céu', hex: '#4fa3d6' },
  { id: 'fabric.navy', name: 'Marinho', hex: '#2f3f6e' },
  { id: 'fabric.leaf', name: 'Folha', hex: '#5ba361' },
  { id: 'fabric.moss', name: 'Musgo', hex: '#5f6b3a' },
  { id: 'fabric.plum', name: 'Ameixa', hex: '#7b4a8f' },
  { id: 'fabric.charcoal', name: 'Carvão', hex: '#34343b' },
  { id: 'fabric.rose', name: 'Rosa', hex: '#e79bb0' },
  { id: 'fabric.denim', name: 'Jeans', hex: '#5677a3' },
];

export const HAIRS: CharacterPartDefinition[] = [
  { id: 'hair.bob', name: 'Chanel', slot: 'hair', hideBodyRegions: [], palette: 'hair', defaultColorId: 'hair.ink' },
  { id: 'hair.crop', name: 'Curtinho', slot: 'hair', hideBodyRegions: [], palette: 'hair', defaultColorId: 'hair.chestnut' },
  { id: 'hair.ponytail', name: 'Rabo de cavalo', slot: 'hair', hideBodyRegions: [], palette: 'hair', defaultColorId: 'hair.auburn' },
  { id: 'hair.buns', name: 'Coquinhos', slot: 'hair', hideBodyRegions: [], palette: 'hair', defaultColorId: 'hair.coral' },
];

export const TOPS: CharacterPartDefinition[] = [
  { id: 'top.tee', name: 'Camiseta larga', slot: 'top', hideBodyRegions: ['torso'], palette: 'fabric', defaultColorId: 'fabric.sky' },
  { id: 'top.hoodie', name: 'Moletom', slot: 'top', hideBodyRegions: ['torso', 'upper_arms', 'forearms'], palette: 'fabric', defaultColorId: 'fabric.orange' },
  { id: 'top.longsleeve', name: 'Manga longa listrada', slot: 'top', hideBodyRegions: ['torso', 'upper_arms', 'forearms'], palette: 'fabric', defaultColorId: 'fabric.cream' },
  { id: 'top.vest', name: 'Colete de trabalho', slot: 'top', hideBodyRegions: ['torso'], palette: 'fabric', defaultColorId: 'fabric.moss' },
];

export const BOTTOMS: CharacterPartDefinition[] = [
  { id: 'bottom.culottes', name: 'Pantacourt', slot: 'bottom', hideBodyRegions: ['hips', 'upper_legs'], palette: 'fabric', defaultColorId: 'fabric.charcoal' },
  { id: 'bottom.shorts', name: 'Bermuda', slot: 'bottom', hideBodyRegions: ['hips'], palette: 'fabric', defaultColorId: 'fabric.denim' },
  { id: 'bottom.pants', name: 'Calça reta', slot: 'bottom', hideBodyRegions: ['hips', 'upper_legs', 'lower_legs'], palette: 'fabric', defaultColorId: 'fabric.navy' },
  { id: 'bottom.skirt', name: 'Saia plissada', slot: 'bottom', hideBodyRegions: ['hips'], palette: 'fabric', defaultColorId: 'fabric.plum' },
];

export const SHOES: CharacterPartDefinition[] = [
  { id: 'shoes.chunky', name: 'Tênis robusto', slot: 'shoes', hideBodyRegions: ['feet'], palette: 'fabric', defaultColorId: 'fabric.tomato' },
  { id: 'shoes.boots', name: 'Bota de trilha', slot: 'shoes', hideBodyRegions: ['feet'], palette: 'fabric', defaultColorId: 'fabric.mustard' },
  { id: 'shoes.slipons', name: 'Slip-on', slot: 'shoes', hideBodyRegions: ['feet'], palette: 'fabric', defaultColorId: 'fabric.cream' },
];

export const ACCESSORIES: CharacterPartDefinition[] = [
  { id: 'acc.none', name: 'Nenhum', slot: 'accessory', hideBodyRegions: [], palette: 'none', defaultColorId: 'fabric.cream' },
  { id: 'acc.glasses', name: 'Óculos redondos', slot: 'accessory', hideBodyRegions: [], palette: 'none', defaultColorId: 'fabric.cream' },
  { id: 'acc.headphones', name: 'Fones de ouvido', slot: 'accessory', hideBodyRegions: [], palette: 'none', defaultColorId: 'fabric.cream' },
  { id: 'acc.bag', name: 'Bolsa transversal', slot: 'accessory', hideBodyRegions: [], palette: 'none', defaultColorId: 'fabric.mustard' },
];

export const PARTS_BY_ID: ReadonlyMap<string, CharacterPartDefinition> = new Map(
  [...HAIRS, ...TOPS, ...BOTTOMS, ...SHOES, ...ACCESSORIES].map((p) => [p.id, p]),
);

const ids = (list: CatalogEntry[]) => new Set(list.map((e) => e.id));
const VALID: Record<keyof CharacterAppearance, Set<string>> = {
  bodyId: ids(BODIES),
  faceId: ids(FACES),
  skinId: ids(SKIN_TONES),
  hairId: ids(HAIRS),
  hairColorId: ids(HAIR_COLORS),
  topId: ids(TOPS),
  topColorId: ids(FABRIC_COLORS),
  bottomId: ids(BOTTOMS),
  bottomColorId: ids(FABRIC_COLORS),
  shoesId: ids(SHOES),
  shoesColorId: ids(FABRIC_COLORS),
  accessoryId: ids(ACCESSORIES),
};

export const DEFAULT_APPEARANCE: CharacterAppearance = {
  bodyId: 'body.slim',
  faceId: 'face.calm',
  skinId: 'skin.peach',
  hairId: 'hair.bob',
  hairColorId: 'hair.ink',
  topId: 'top.tee',
  topColorId: 'fabric.sky',
  bottomId: 'bottom.culottes',
  bottomColorId: 'fabric.charcoal',
  shoesId: 'shoes.chunky',
  shoesColorId: 'fabric.tomato',
  accessoryId: 'acc.headphones',
};

/** Full validation: shape plus catalog membership. The server rejects anything else. */
export function validateAppearance(a: unknown): a is CharacterAppearance {
  if (!isAppearanceShape(a)) return false;
  return APPEARANCE_KEYS.every((k) => VALID[k].has(a[k]));
}

/** Options per appearance key, used by the creator UI and by `randomAppearance`. */
export const APPEARANCE_OPTIONS: Record<keyof CharacterAppearance, CatalogEntry[]> = {
  bodyId: BODIES,
  faceId: FACES,
  skinId: SKIN_TONES,
  hairId: HAIRS,
  hairColorId: HAIR_COLORS,
  topId: TOPS,
  topColorId: FABRIC_COLORS,
  bottomId: BOTTOMS,
  bottomColorId: FABRIC_COLORS,
  shoesId: SHOES,
  shoesColorId: FABRIC_COLORS,
  accessoryId: ACCESSORIES,
};

export function randomAppearance(rand: () => number = Math.random): CharacterAppearance {
  const pick = (list: CatalogEntry[]) => list[Math.floor(rand() * list.length) % list.length]!.id;
  const out = {} as CharacterAppearance;
  for (const k of APPEARANCE_KEYS) out[k] = pick(APPEARANCE_OPTIONS[k]);
  return out;
}

export function colorHex(id: string): string {
  for (const list of [SKIN_TONES, HAIR_COLORS, FABRIC_COLORS]) {
    const e = list.find((c) => c.id === id);
    if (e) return e.hex;
  }
  return '#ff00ff';
}
