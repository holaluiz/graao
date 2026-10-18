/**
 * Appearance catalog: which ids exist, what each piece hides, and the palettes. Geometry builders live in the client
 * (`apps/client/src/character/parts`), keyed by these ids. Colors are separate from geometry (palette ids).
 */
import { APPEARANCE_KEYS, isAppearanceShape, type CharacterAppearance } from '@graao/shared';

/** Body regions that clothing can hide to avoid clipping, z-fighting and hidden overdraw. */
export type BodyRegion =
  | 'head'
  | 'ears'
  | 'neck'
  | 'torso'
  | 'hips'
  | 'upper_arms'
  | 'forearms'
  | 'hands'
  | 'upper_legs'
  | 'lower_legs'
  | 'feet';

export type PartSlot = 'hair' | 'beard' | 'top' | 'bottom' | 'shoes' | 'hat' | 'accessory' | 'extra';

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
  { id: 'face.wink', name: 'Piscadinha' },
  { id: 'face.grin', name: 'Sorridente' },
  { id: 'face.freckles', name: 'Sardinhas' },
];

export const SKIN_TONES: ColorEntry[] = [
  { id: 'skin.porcelain', name: 'Porcelana', hex: '#f6dccb' },
  { id: 'skin.peach', name: 'Pêssego', hex: '#f0c3a4' },
  { id: 'skin.honey', name: 'Mel', hex: '#d9a27a' },
  { id: 'skin.jambo', name: 'Jambo', hex: '#c88d60' },
  { id: 'skin.caramel', name: 'Caramelo', hex: '#b97b52' },
  { id: 'skin.canela', name: 'Canela', hex: '#a2673f' },
  { id: 'skin.cocoa', name: 'Cacau', hex: '#8a5636' },
  { id: 'skin.ebony', name: 'Ébano', hex: '#5e3a26' },
];

export const HAIR_COLORS: ColorEntry[] = [
  { id: 'hair.ink', name: 'Nanquim', hex: '#2a2433' },
  { id: 'hair.chestnut', name: 'Castanho', hex: '#5b3424' },
  { id: 'hair.auburn', name: 'Acobreado', hex: '#8f3f22' },
  { id: 'hair.ginger', name: 'Ruivo', hex: '#c4541f' },
  { id: 'hair.honey', name: 'Mel', hex: '#c98e45' },
  { id: 'hair.blonde', name: 'Loiro', hex: '#e6bd62' },
  { id: 'hair.platinum', name: 'Platinado (nevou)', hex: '#f1ead8' },
  { id: 'hair.ash', name: 'Cinza', hex: '#b9b3aa' },
  { id: 'hair.coral', name: 'Coral', hex: '#ee7a6b' },
  { id: 'hair.pink', name: 'Rosa-chiclete', hex: '#ef79b0' },
  { id: 'hair.lilac', name: 'Lilás', hex: '#9a86c9' },
  { id: 'hair.blue', name: 'Azul', hex: '#3e6fd0' },
  { id: 'hair.teal', name: 'Azul-petróleo', hex: '#3f8f8c' },
  { id: 'hair.green', name: 'Verde', hex: '#4daa62' },
];

/** Shared palette for every garment (tops, bottoms, shoes, hats). */
export const FABRIC_COLORS: ColorEntry[] = [
  { id: 'fabric.white', name: 'Branco', hex: '#fbf8f1' },
  { id: 'fabric.cream', name: 'Creme', hex: '#f1e8d6' },
  { id: 'fabric.canary', name: 'Canarinho', hex: '#f6d22c' },
  { id: 'fabric.mustard', name: 'Mostarda', hex: '#e6b83c' },
  { id: 'fabric.orange', name: 'Laranja', hex: '#ec8a3a' },
  { id: 'fabric.tomato', name: 'Tomate', hex: '#d9493b' },
  { id: 'fabric.pink', name: 'Pink', hex: '#e2478a' },
  { id: 'fabric.rose', name: 'Rosa', hex: '#e79bb0' },
  { id: 'fabric.plum', name: 'Ameixa', hex: '#7b4a8f' },
  { id: 'fabric.sky', name: 'Céu', hex: '#4fa3d6' },
  { id: 'fabric.turquoise', name: 'Turquesa', hex: '#2fb3ad' },
  { id: 'fabric.denim', name: 'Jeans', hex: '#5677a3' },
  { id: 'fabric.navy', name: 'Marinho', hex: '#2f3f6e' },
  { id: 'fabric.flag', name: 'Verde-bandeira', hex: '#1f9a52' },
  { id: 'fabric.leaf', name: 'Folha', hex: '#5ba361' },
  { id: 'fabric.moss', name: 'Musgo', hex: '#5f6b3a' },
  { id: 'fabric.leather', name: 'Couro', hex: '#8a5a32' },
  { id: 'fabric.charcoal', name: 'Carvão', hex: '#34343b' },
];

const hair = (id: string, name: string, defaultColorId: string): CharacterPartDefinition => ({ id, name, slot: 'hair', hideBodyRegions: [], palette: 'hair', defaultColorId });

export const HAIRS: CharacterPartDefinition[] = [
  hair('hair.ondulado', 'Ondulado', 'hair.ink'),
  hair('hair.bob', 'Chanel', 'hair.ink'),
  hair('hair.crop', 'Curtinho', 'hair.chestnut'),
  hair('hair.ponytail', 'Rabo de cavalo', 'hair.auburn'),
  hair('hair.buns', 'Coquinhos', 'hair.coral'),
  hair('hair.afro', 'Black power', 'hair.ink'),
  hair('hair.cachos', 'Cacheado', 'hair.chestnut'),
  hair('hair.trancas', 'Tranças', 'hair.ink'),
  hair('hair.dreads', 'Dreads', 'hair.chestnut'),
  hair('hair.liso', 'Liso comprido', 'hair.ink'),
  hair('hair.chiquinha', 'Maria-chiquinha', 'hair.ginger'),
  hair('hair.coque', 'Coque alto', 'hair.honey'),
  hair('hair.moicano', 'Moicano', 'hair.pink'),
  hair('hair.raspado', 'Raspadinho', 'hair.platinum'),
  hair('hair.careca', 'Careca', 'hair.ink'),
];

const beard = (id: string, name: string): CharacterPartDefinition => ({ id, name, slot: 'beard', hideBodyRegions: [], palette: 'hair', defaultColorId: 'hair.ink' });

export const BEARDS: CharacterPartDefinition[] = [
  beard('beard.none', 'Sem barba'),
  beard('beard.bigode', 'Bigode'),
  beard('beard.cavanhaque', 'Cavanhaque'),
  beard('beard.cheia', 'Barba cheia'),
  beard('beard.porfazer', 'Barba por fazer'),
];

export const TOPS: CharacterPartDefinition[] = [
  { id: 'top.tee', name: 'Camiseta larga', slot: 'top', hideBodyRegions: ['torso'], palette: 'fabric', defaultColorId: 'fabric.sky' },
  { id: 'top.time', name: 'Camisa de time', slot: 'top', hideBodyRegions: ['torso'], palette: 'fabric', defaultColorId: 'fabric.canary' },
  { id: 'top.regata', name: 'Regata', slot: 'top', hideBodyRegions: [], palette: 'fabric', defaultColorId: 'fabric.white' },
  { id: 'top.cropped', name: 'Cropped', slot: 'top', hideBodyRegions: [], palette: 'fabric', defaultColorId: 'fabric.pink' },
  { id: 'top.chita', name: 'Camisa de chita', slot: 'top', hideBodyRegions: ['torso'], palette: 'fabric', defaultColorId: 'fabric.tomato' },
  { id: 'top.xadrez', name: 'Camisa xadrez', slot: 'top', hideBodyRegions: ['torso', 'upper_arms', 'forearms'], palette: 'fabric', defaultColorId: 'fabric.tomato' },
  { id: 'top.cortavento', name: 'Corta-vento', slot: 'top', hideBodyRegions: ['torso', 'upper_arms', 'forearms'], palette: 'fabric', defaultColorId: 'fabric.turquoise' },
  { id: 'top.hoodie', name: 'Moletom', slot: 'top', hideBodyRegions: ['torso', 'upper_arms', 'forearms'], palette: 'fabric', defaultColorId: 'fabric.orange' },
  { id: 'top.longsleeve', name: 'Manga longa listrada', slot: 'top', hideBodyRegions: ['torso', 'upper_arms', 'forearms'], palette: 'fabric', defaultColorId: 'fabric.cream' },
  { id: 'top.vest', name: 'Colete de trabalho', slot: 'top', hideBodyRegions: ['torso'], palette: 'fabric', defaultColorId: 'fabric.moss' },
];

export const BOTTOMS: CharacterPartDefinition[] = [
  { id: 'bottom.culottes', name: 'Pantacourt', slot: 'bottom', hideBodyRegions: ['hips', 'upper_legs'], palette: 'fabric', defaultColorId: 'fabric.charcoal' },
  { id: 'bottom.cargo', name: 'Bermuda cargo', slot: 'bottom', hideBodyRegions: ['hips', 'upper_legs'], palette: 'fabric', defaultColorId: 'fabric.charcoal' },
  { id: 'bottom.shorts', name: 'Bermuda', slot: 'bottom', hideBodyRegions: ['hips'], palette: 'fabric', defaultColorId: 'fabric.denim' },
  { id: 'bottom.tactel', name: 'Bermuda tactel', slot: 'bottom', hideBodyRegions: ['hips', 'upper_legs'], palette: 'fabric', defaultColorId: 'fabric.navy' },
  { id: 'bottom.pants', name: 'Calça reta', slot: 'bottom', hideBodyRegions: ['hips', 'upper_legs', 'lower_legs'], palette: 'fabric', defaultColorId: 'fabric.navy' },
  { id: 'bottom.jogger', name: 'Calça jogger', slot: 'bottom', hideBodyRegions: ['hips', 'upper_legs', 'lower_legs'], palette: 'fabric', defaultColorId: 'fabric.charcoal' },
  { id: 'bottom.capoeira', name: 'Calça de capoeira', slot: 'bottom', hideBodyRegions: ['hips', 'upper_legs', 'lower_legs'], palette: 'fabric', defaultColorId: 'fabric.white' },
  { id: 'bottom.skirt', name: 'Saia plissada', slot: 'bottom', hideBodyRegions: ['hips'], palette: 'fabric', defaultColorId: 'fabric.plum' },
  { id: 'bottom.rodada', name: 'Saia rodada', slot: 'bottom', hideBodyRegions: ['hips'], palette: 'fabric', defaultColorId: 'fabric.turquoise' },
];

export const SHOES: CharacterPartDefinition[] = [
  { id: 'shoes.retro', name: 'Tênis retrô com meia', slot: 'shoes', hideBodyRegions: ['feet'], palette: 'fabric', defaultColorId: 'fabric.tomato' },
  { id: 'shoes.chunky', name: 'Tênis robusto', slot: 'shoes', hideBodyRegions: ['feet'], palette: 'fabric', defaultColorId: 'fabric.tomato' },
  { id: 'shoes.mola', name: 'Tênis de mola', slot: 'shoes', hideBodyRegions: ['feet'], palette: 'fabric', defaultColorId: 'fabric.charcoal' },
  { id: 'shoes.chuteira', name: 'Chuteira', slot: 'shoes', hideBodyRegions: ['feet'], palette: 'fabric', defaultColorId: 'fabric.canary' },
  { id: 'shoes.chinelo', name: 'Chinelo', slot: 'shoes', hideBodyRegions: [], palette: 'fabric', defaultColorId: 'fabric.flag' },
  { id: 'shoes.sandalia', name: 'Sandália de couro', slot: 'shoes', hideBodyRegions: [], palette: 'fabric', defaultColorId: 'fabric.leather' },
  { id: 'shoes.boots', name: 'Bota de trilha', slot: 'shoes', hideBodyRegions: ['feet'], palette: 'fabric', defaultColorId: 'fabric.mustard' },
  { id: 'shoes.slipons', name: 'Slip-on', slot: 'shoes', hideBodyRegions: ['feet'], palette: 'fabric', defaultColorId: 'fabric.cream' },
];

const hat = (id: string, name: string, defaultColorId: string): CharacterPartDefinition => ({ id, name, slot: 'hat', hideBodyRegions: [], palette: 'fabric', defaultColorId });

/** Hats take `hatColorId`; on fixed-material hats (straw, leather) the color goes to the band/ornaments. */
export const HATS: CharacterPartDefinition[] = [
  hat('hat.none', 'Nenhum', 'fabric.tomato'),
  hat('hat.palha', 'Chapéu de palha', 'fabric.tomato'),
  hat('hat.cangaceiro', 'Chapéu de cangaceiro', 'fabric.mustard'),
  hat('hat.malandro', 'Chapéu de malandro', 'fabric.white'),
  hat('hat.bone', 'Boné aba reta', 'fabric.navy'),
  hat('hat.bonetras', 'Boné pra trás', 'fabric.tomato'),
  hat('hat.touca', 'Touca', 'fabric.mustard'),
  hat('hat.bandana', 'Bandana', 'fabric.tomato'),
  hat('hat.turbante', 'Turbante', 'fabric.orange'),
  hat('hat.flores', 'Coroa de flores', 'fabric.pink'),
];

const fixed = (slot: PartSlot, id: string, name: string): CharacterPartDefinition => ({ id, name, slot, hideBodyRegions: [], palette: 'none', defaultColorId: 'fabric.cream' });

export const ACCESSORIES: CharacterPartDefinition[] = [
  fixed('accessory', 'acc.none', 'Nenhum'),
  fixed('accessory', 'acc.glasses', 'Óculos redondos'),
  fixed('accessory', 'acc.shades', 'Óculos espelhado'),
  fixed('accessory', 'acc.headphones', 'Fones de ouvido'),
  fixed('accessory', 'acc.hoops', 'Argolas'),
  fixed('accessory', 'acc.flor', 'Flor no cabelo'),
];

export const EXTRAS: CharacterPartDefinition[] = [
  fixed('extra', 'extra.none', 'Nenhum'),
  fixed('extra', 'extra.cordao', 'Cordão dourado'),
  fixed('extra', 'extra.pochete', 'Pochete'),
  fixed('extra', 'extra.bag', 'Bolsa transversal'),
  fixed('extra', 'extra.mochila', 'Mochila'),
  fixed('extra', 'extra.bandeira', 'Bandeira nas costas'),
  fixed('extra', 'extra.fitinhas', 'Fitinhas no pulso'),
];

export const PARTS_BY_ID: ReadonlyMap<string, CharacterPartDefinition> = new Map(
  [...HAIRS, ...BEARDS, ...TOPS, ...BOTTOMS, ...SHOES, ...HATS, ...ACCESSORIES, ...EXTRAS].map((p) => [p.id, p]),
);

/** Options per appearance key, used by the creator UI, `randomAppearance` and validation. */
export const APPEARANCE_OPTIONS: Record<keyof CharacterAppearance, CatalogEntry[]> = {
  bodyId: BODIES,
  faceId: FACES,
  beardId: BEARDS,
  skinId: SKIN_TONES,
  hairId: HAIRS,
  hairColorId: HAIR_COLORS,
  topId: TOPS,
  topColorId: FABRIC_COLORS,
  bottomId: BOTTOMS,
  bottomColorId: FABRIC_COLORS,
  shoesId: SHOES,
  shoesColorId: FABRIC_COLORS,
  hatId: HATS,
  hatColorId: FABRIC_COLORS,
  accessoryId: ACCESSORIES,
  extraId: EXTRAS,
};

const VALID = Object.fromEntries(APPEARANCE_KEYS.map((k) => [k, new Set(APPEARANCE_OPTIONS[k].map((e) => e.id))])) as Record<
  keyof CharacterAppearance,
  Set<string>
>;

export const DEFAULT_APPEARANCE: CharacterAppearance = {
  bodyId: 'body.slim',
  faceId: 'face.calm',
  beardId: 'beard.none',
  skinId: 'skin.caramel',
  hairId: 'hair.ondulado',
  hairColorId: 'hair.ink',
  topId: 'top.hoodie',
  topColorId: 'fabric.cream',
  bottomId: 'bottom.cargo',
  bottomColorId: 'fabric.charcoal',
  shoesId: 'shoes.retro',
  shoesColorId: 'fabric.tomato',
  hatId: 'hat.none',
  hatColorId: 'fabric.tomato',
  accessoryId: 'acc.headphones',
  extraId: 'extra.mochila',
};

/** Full validation: shape plus catalog membership. The server rejects anything else. */
export function validateAppearance(a: unknown): a is CharacterAppearance {
  if (!isAppearanceShape(a)) return false;
  return APPEARANCE_KEYS.every((k) => VALID[k].has(a[k]));
}

/**
 * Upgrades an appearance saved by an older catalog: missing or unknown ids take the default, pieces that moved slot
 * follow (the crossbody bag went from accessory to extra). Returns null when `raw` is not an object.
 */
export function migrateAppearance(raw: unknown): CharacterAppearance | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const out: CharacterAppearance = { ...DEFAULT_APPEARANCE };
  for (const k of APPEARANCE_KEYS) {
    const v = o[k];
    if (typeof v === 'string' && VALID[k].has(v)) out[k] = v;
  }
  if (o.accessoryId === 'acc.bag' && o.extraId === undefined) {
    out.accessoryId = 'acc.none';
    out.extraId = 'extra.bag';
  }
  return out;
}

/** Slots where "none" is the first option; random looks leave them empty half of the time. */
const OPTIONAL_KEYS: ReadonlySet<keyof CharacterAppearance> = new Set(['beardId', 'hatId', 'accessoryId', 'extraId']);

export function randomAppearance(rand: () => number = Math.random): CharacterAppearance {
  const pick = (list: CatalogEntry[]) => list[Math.floor(rand() * list.length) % list.length]!.id;
  const out = {} as CharacterAppearance;
  for (const k of APPEARANCE_KEYS) {
    const list = APPEARANCE_OPTIONS[k];
    out[k] = OPTIONAL_KEYS.has(k) && rand() < 0.5 ? list[0]!.id : pick(list);
  }
  return out;
}

export function colorHex(id: string): string {
  for (const list of [SKIN_TONES, HAIR_COLORS, FABRIC_COLORS]) {
    const e = list.find((c) => c.id === id);
    if (e) return e.hex;
  }
  return '#ff00ff';
}
