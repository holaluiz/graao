/**
 * Loot content: rarities, item definitions (weapons, ammunition, consumables), the chest loot table, the starting kit
 * and the authored chest spots per region. Everything here is data; `@graao/game-core` (loot.ts, chests.ts,
 * lootSystem.ts) turns it into rolls, inventories and placements, and only the server rolls.
 *
 * Every weapon of the polygon_guns pack that the asset pipeline bakes (7 models) can come out of a chest.
 *
 * Ids stay in English; `name` is what players read (pt-BR). Rarity says how rare an item is and how it is presented;
 * it never scales damage (a weapon's numbers live in WEAPONS, one set per weapon).
 */
import type { AmmoType, WeaponId } from './weapons';
import { GRAAO_MAP } from './world/map';

// ------------------------------------------------------------------------------------------------ rarity

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic';
export const RARITY_ORDER: Rarity[] = ['common', 'uncommon', 'rare', 'epic'];

export interface RarityDefinition {
  id: Rarity;
  /** pt-BR label. */
  name: string;
  /** Presentation colour (label frame, glow, beam). Never the only cue: `symbol` and `pips` differ too. */
  color: string;
  /** Shape shown next to the name (circle, triangle, diamond, star). */
  symbol: string;
  /** 1–4 marks on the label. */
  pips: number;
  /** Glow strength on the ground (0–1) and height of the light column (m). */
  glow: number;
  beam: number;
}

export const RARITIES: Record<Rarity, RarityDefinition> = {
  common: { id: 'common', name: 'Comum', color: '#c9c2b4', symbol: '●', pips: 1, glow: 0.35, beam: 0 },
  uncommon: { id: 'uncommon', name: 'Incomum', color: '#7fd06a', symbol: '▲', pips: 2, glow: 0.5, beam: 0.9 },
  rare: { id: 'rare', name: 'Raro', color: '#5fb3ff', symbol: '◆', pips: 3, glow: 0.7, beam: 1.6 },
  epic: { id: 'epic', name: 'Épico', color: '#c58cff', symbol: '★', pips: 4, glow: 1, beam: 2.6 },
};

// ------------------------------------------------------------------------------------------------ ammunition

export interface AmmoDefinition {
  id: AmmoType;
  name: string;
  /** Reserve cap per player (a pickup never goes over it). */
  max: number;
  /** HUD/label tint and short tag. */
  color: string;
  tag: string;
}

/** Order of the reserve array in SELF (`res`). */
export const AMMO_TYPES: AmmoType[] = ['solar', 'petal', 'heavy'];

export const AMMO: Record<AmmoType, AmmoDefinition> = {
  solar: { id: 'solar', name: 'Cápsulas Solares', max: 180, color: '#ffc94d', tag: 'SOL' },
  petal: { id: 'petal', name: 'Cartuchos de Pétala', max: 24, color: '#f29bb5', tag: 'PÉT' },
  heavy: { id: 'heavy', name: 'Munição Pesada', max: 60, color: '#9aa7b8', tag: 'PES' },
};

// ------------------------------------------------------------------------------------------------ consumables

export type ConsumableId = 'health' | 'shield' | 'mana';
/** Order of the consumable counts in SELF (`inv`) and of the keys Z, X, C. */
export const CONSUMABLE_ORDER: ConsumableId[] = ['health', 'shield', 'mana'];

export interface ConsumableDefinition {
  id: ConsumableId;
  /** Which vital it restores (never past its maximum). */
  stat: 'health' | 'shield' | 'mana';
  amount: number;
  /** Time to use it (the hands are busy: no shots or casts meanwhile). The effect lands at the end. */
  useMs: number;
  /** After a use, this long before the next one of the same kind (ms). */
  cooldownMs: number;
  /** Carry limit. */
  maxStack: number;
  key: 'Z' | 'X' | 'C';
}

export const CONSUMABLES: Record<ConsumableId, ConsumableDefinition> = {
  health: { id: 'health', stat: 'health', amount: 50, useMs: 1100, cooldownMs: 300, maxStack: 3, key: 'Z' },
  shield: { id: 'shield', stat: 'shield', amount: 50, useMs: 1300, cooldownMs: 300, maxStack: 3, key: 'X' },
  mana: { id: 'mana', stat: 'mana', amount: 40, useMs: 600, cooldownMs: 300, maxStack: 3, key: 'C' },
};

// ------------------------------------------------------------------------------------------------ items

export type ItemId =
  | 'weapon_sunbeam'
  | 'weapon_petal'
  | 'weapon_pistol'
  | 'weapon_smg'
  | 'weapon_ak47'
  | 'weapon_sniper'
  | 'weapon_launcher'
  | 'ammo_solar'
  | 'ammo_petal'
  | 'ammo_heavy'
  | 'nectar'
  | 'shield_cell'
  | 'mana_crystal';

export type ItemKind = 'weapon' | 'ammo' | 'consumable';

/** GRAItemDefinition: one kind of thing that can lie on the ground and go into an inventory. */
export interface ItemDefinition {
  id: ItemId;
  kind: ItemKind;
  name: string;
  rarity: Rarity;
  weapon?: WeaponId;
  ammo?: AmmoType;
  consumable?: ConsumableId;
  /** Quantity per drop from a chest (inclusive range). Weapons: 1 (they come with a full magazine). */
  min: number;
  max: number;
  /** Visual key the client builds (weapons use their baked model). */
  visual: 'weapon' | 'ammo' | 'nectar' | 'shield_cell' | 'mana_crystal';
}

/** Wire order (items travel as an index into this list). Append only. */
export const ITEM_IDS: ItemId[] = [
  'weapon_sunbeam',
  'weapon_petal',
  'weapon_pistol',
  'weapon_smg',
  'weapon_ak47',
  'weapon_sniper',
  'ammo_solar',
  'ammo_petal',
  'ammo_heavy',
  'nectar',
  'shield_cell',
  'mana_crystal',
  'weapon_launcher',
];

const weapon = (id: WeaponId, name: string, rarity: Rarity): ItemDefinition => ({ id: `weapon_${id}` as ItemId, kind: 'weapon', name, rarity, weapon: id, min: 1, max: 1, visual: 'weapon' });

export const ITEMS: Record<ItemId, ItemDefinition> = {
  weapon_pistol: weapon('pistol', 'Pistola Tática', 'common'),
  weapon_sunbeam: weapon('sunbeam', 'Raio de Sol', 'common'),
  weapon_smg: weapon('smg', 'Submetralhadora', 'uncommon'),
  weapon_petal: weapon('petal', 'Rajada de Pétalas', 'uncommon'),
  weapon_ak47: weapon('ak47', 'Fuzil Kalash', 'rare'),
  weapon_sniper: weapon('sniper', 'Fuzil de Precisão', 'epic'),
  weapon_launcher: weapon('launcher', 'Lança-Foguetes', 'epic'),
  ammo_solar: { id: 'ammo_solar', kind: 'ammo', name: 'Cápsulas Solares', rarity: 'common', ammo: 'solar', min: 24, max: 36, visual: 'ammo' },
  ammo_petal: { id: 'ammo_petal', kind: 'ammo', name: 'Cartuchos de Pétala', rarity: 'common', ammo: 'petal', min: 6, max: 10, visual: 'ammo' },
  ammo_heavy: { id: 'ammo_heavy', kind: 'ammo', name: 'Munição Pesada', rarity: 'common', ammo: 'heavy', min: 12, max: 20, visual: 'ammo' },
  nectar: { id: 'nectar', kind: 'consumable', name: 'Néctar de Vida', rarity: 'uncommon', consumable: 'health', min: 1, max: 2, visual: 'nectar' },
  shield_cell: { id: 'shield_cell', kind: 'consumable', name: 'Cápsula de Escudo', rarity: 'uncommon', consumable: 'shield', min: 1, max: 2, visual: 'shield_cell' },
  mana_crystal: { id: 'mana_crystal', kind: 'consumable', name: 'Cristal de Mana', rarity: 'common', consumable: 'mana', min: 1, max: 2, visual: 'mana_crystal' },
};

/** The item that carries a weapon / an ammo type / a consumable (death drops and swaps put things back on the ground). */
export const weaponItem = (w: WeaponId): ItemId | null => (ITEM_IDS as string[]).includes(`weapon_${w}`) ? (`weapon_${w}` as ItemId) : null;
export const AMMO_ITEM: Record<AmmoType, ItemId> = { solar: 'ammo_solar', petal: 'ammo_petal', heavy: 'ammo_heavy' };
export const CONSUMABLE_ITEM: Record<ConsumableId, ItemId> = { health: 'nectar', shield: 'shield_cell', mana: 'mana_crystal' };

// ------------------------------------------------------------------------------------------------ loot table

export interface Weighted<T> {
  v: T;
  w: number;
}

/**
 * GRALootTable data for chests. A chest holds `rewards` items: the first from `primary`, the rest from `secondary`.
 * A weapon brings a pack of its own ammunition when the chest still has room (`weaponBringsAmmo`). Per match, at least
 * `minWeaponShare` of the chests hold a weapon and at most `maxEpicPerMatch` epic items appear (so a 1v1 never hinges
 * on one lucky chest, and nobody opens chest after chest without a weapon).
 */
export const CHEST_LOOT = {
  rewards: [
    { v: 2, w: 60 },
    { v: 3, w: 40 },
  ] as Weighted<number>[],
  primary: [
    { v: 'weapon', w: 60 },
    { v: 'consumable', w: 28 },
    { v: 'ammo', w: 12 },
  ] as Weighted<ItemKind>[],
  secondary: [
    { v: 'ammo', w: 45 },
    { v: 'consumable', w: 45 },
    { v: 'weapon', w: 10 },
  ] as Weighted<ItemKind>[],
  weapon: [
    { v: 'weapon_pistol', w: 22 },
    { v: 'weapon_sunbeam', w: 18 },
    { v: 'weapon_smg', w: 18 },
    { v: 'weapon_petal', w: 18 },
    { v: 'weapon_ak47', w: 14 },
    { v: 'weapon_sniper', w: 4 },
    { v: 'weapon_launcher', w: 3 },
  ] as Weighted<ItemId>[],
  ammo: [
    { v: 'ammo_solar', w: 45 },
    { v: 'ammo_petal', w: 25 },
    { v: 'ammo_heavy', w: 30 },
  ] as Weighted<ItemId>[],
  consumable: [
    { v: 'nectar', w: 40 },
    { v: 'shield_cell', w: 40 },
    { v: 'mana_crystal', w: 20 },
  ] as Weighted<ItemId>[],
  weaponBringsAmmo: true,
  /** Everyone lands unarmed: two in three chests hold a weapon. */
  minWeaponShare: 0.65,
  maxEpicPerMatch: 2,
  /**
   * Starter chests (the first chest of every region in the match, so wherever someone lands there is one within
   * reach) always hold one basic weapon from this list, never a rare one. The rest of the chest is rolled as usual.
   */
  starterWeapon: [
    { v: 'weapon_pistol', w: 30 },
    { v: 'weapon_sunbeam', w: 30 },
    { v: 'weapon_smg', w: 20 },
    { v: 'weapon_petal', w: 20 },
  ] as Weighted<ItemId>[],
};

// ------------------------------------------------------------------------------------------------ kit and rules

/**
 * Battle Royale: every participant (host, guests and bots) boards the UFO and starts the fight with empty hands —
 * no weapon in E or Q, no reserve, no consumables — and fights with fists until a chest gives them a weapon.
 */
export const MATCH_KIT = {
  weapons: [null, null] as (WeaponId | null)[],
  reserve: { solar: 0, petal: 0, heavy: 0 } as Record<AmmoType, number>,
  consumables: { health: 0, shield: 0, mana: 0 } as Record<ConsumableId, number>,
};

/**
 * Training kits (the development warmup and the offline exploring mode, where there is nothing to loot): the Raio de
 * Sol in E, Q free for what they find, a little solar reserve, no consumables. Bots keep the classic two-weapon
 * loadout there and never run out of reserve. In a Battle Royale match everyone gets MATCH_KIT instead.
 */
export const STARTING_KIT = {
  weapons: ['sunbeam', null] as (WeaponId | null)[],
  reserve: { solar: 48, petal: 0, heavy: 0 } as Record<AmmoType, number>,
  consumables: { health: 0, shield: 0, mana: 0 } as Record<ConsumableId, number>,
};
export const BOT_KIT = {
  weapons: ['sunbeam', 'petal'] as (WeaponId | null)[],
  reserve: { solar: 180, petal: 24, heavy: 0 } as Record<AmmoType, number>,
  consumables: { health: 0, shield: 0, mana: 0 } as Record<ConsumableId, number>,
};

export const LOOT_RULES = {
  /**
   * Active chests per match: every region gets its minimum (CHEST_REGIONS: 25 in all), the rest spread out; for up
   * to 10 players who all land unarmed on R = 100 m that is almost three chests per player, denser in the towns.
   */
  chestsPerMatch: 28,
  /** No two active chests closer than this (degrees of arc; 1° ≈ 1.75 m). */
  minChestSpacingDeg: 6,
  /** Chest lid opening before the rewards appear (server time, ms). Short: nobody is locked in place. */
  openMs: 450,
  /** Interaction reach from the feet (m): chest centre, item. The server allows `slack` more (latency). */
  chestRange: 2.4,
  itemRange: 2.0,
  slack: 0.9,
  /** One INTERACT / USE_ITEM every this many ms per player (more is refused). */
  requestIntervalMs: 90,
  /** Pickups around a chest: distance from its centre (m) and the fan step (degrees). */
  scatterRadius: 1.3,
  scatterStepDeg: 46,
  /** Items on the ground per room before the oldest death/swap drops are cleared. */
  maxItems: 160,
  /** A death drop never leaves more than this of one ammo type (the rest is lost). */
  deathAmmoCap: 60,
};

// ------------------------------------------------------------------------------------------------ chest spots

export interface ChestSpotDef {
  /** Stable id (debug labels, tests). */
  id: string;
  region: string;
  lat: number;
  lon: number;
  /** Why here (dev overlay). */
  hint: string;
  /** Preferred facing (degrees clockwise from north); the validator may turn it toward a free approach. */
  yaw?: number;
  /**
   * What the chest stands on: the terrain (default) or a prop surface — a house floor, a flat roof — found by a ray
   * cast down from `height` (m above the terrain) + 1.2 m, and refused when it lands more than 0.5 m away from it.
   */
  surface?: 'terrain' | 'prop';
  height?: number;
  /** Under a roof on purpose (inside a house, a workshop): checks 1.9 m of headroom instead of open sky. */
  covered?: boolean;
}

/**
 * Region groups the spawner spreads chests over (wilderness spots use 'Trilhas'). `vantage`: high, exposed spots reached
 * by climbing, riding a wind or magic (docs/world/VERTICAL_WORLD_DESIGN.md) — their chests are rolled twice, keeping the
 * one with the rarer best item (better loot for a riskier climb). New regions go at the end: the index is on the wire.
 */
export const CHEST_REGIONS: { name: string; min: number; vantage?: boolean }[] = [
  { name: 'Vila das Lanternas', min: 4 },
  { name: 'Bairro do Horizonte', min: 4 },
  { name: 'Bosque dos Varais', min: 3 },
  { name: 'Velho Observatório', min: 1 },
  { name: 'Lago Espelho', min: 3 },
  { name: 'Fenda de Cristal', min: 2 },
  { name: 'Serra do Mirante', min: 1 },
  { name: 'Lasca do Céu', min: 1 },
  { name: 'Arcos Afundados', min: 1 },
  { name: 'Planalto Norte', min: 2 },
  { name: 'Trilhas', min: 3 },
  // The summit of the Serra do Mirante and the Arquipélago dos Sinos: one chest up there every match.
  { name: 'Alturas', min: 1, vantage: true },
];

/**
 * Authored candidates, kept in the map file with the rest of the layout (world/planeta-graao.map.json; the dev map
 * editor shows and moves them). Each is checked against the real collision surface (trimesh + props) and nudged up to
 * a few metres to the nearest valid spot (see game-core chests.ts); `tools/loot/chest-spots.ts` prints the result.
 */
export const CHEST_SPOTS: ChestSpotDef[] = GRAAO_MAP.chestSpots;
