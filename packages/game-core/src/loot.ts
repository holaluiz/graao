/**
 * GRALootTable + GRAInventory: the pure rules of loot, shared by the server (authoritative) and the client (UI hints
 * only). Rolling is seeded (same seed → same contents), inventories are plain data, every transfer returns exactly
 * what moved so nothing can be counted twice.
 */
import {
  AMMO,
  AMMO_ITEM,
  AMMO_TYPES,
  CHEST_LOOT,
  CONSUMABLES,
  CONSUMABLE_ITEM,
  CONSUMABLE_ORDER,
  ITEMS,
  ITEM_IDS,
  LOOT_RULES,
  WEAPONS,
  WEAPON_SLOT_COUNT,
  weaponItem,
  type AmmoType,
  type ConsumableId,
  type ItemId,
  type ItemKind,
  type Rarity,
  type WeaponId,
  type Weighted,
} from '@graao/game-data';
import { mulberry32 } from './rng';

// ------------------------------------------------------------------------------------------------ table

export interface LootDrop {
  item: ItemId;
  qty: number;
}

export function pickWeighted<T>(list: Weighted<T>[], rand: () => number): T {
  let total = 0;
  for (const e of list) total += e.w;
  let r = rand() * total;
  for (const e of list) {
    r -= e.w;
    if (r < 0) return e.v;
  }
  return list[list.length - 1]!.v;
}

const qtyOf = (item: ItemId, rand: () => number): number => {
  const d = ITEMS[item];
  return d.min + Math.floor(rand() * (d.max - d.min + 1));
};

function rollOfKind(kind: ItemKind, rand: () => number, inChest: LootDrop[]): LootDrop {
  if (kind === 'weapon') {
    // Never the same weapon twice in one chest.
    const have = new Set(inChest.map((d) => d.item));
    const list = CHEST_LOOT.weapon.filter((e) => !have.has(e.v));
    const item = pickWeighted(list.length ? list : CHEST_LOOT.weapon, rand);
    return { item, qty: 1 };
  }
  if (kind === 'ammo') {
    // Ammunition for a weapon in the same chest first (a weapon without its ammunition is a tease).
    const w = inChest.find((d) => ITEMS[d.item].kind === 'weapon');
    const item = CHEST_LOOT.weaponBringsAmmo && w ? AMMO_ITEM[WEAPONS[ITEMS[w.item].weapon!].ammo] : pickWeighted(CHEST_LOOT.ammo, rand);
    return { item, qty: qtyOf(item, rand) };
  }
  const item = pickWeighted(CHEST_LOOT.consumable, rand);
  return { item, qty: qtyOf(item, rand) };
}

/** One chest's contents (2–3 rewards). Same `rand` sequence → same contents. */
export function rollChest(rand: () => number): LootDrop[] {
  const n = pickWeighted(CHEST_LOOT.rewards, rand);
  const out: LootDrop[] = [];
  out.push(rollOfKind(pickWeighted(CHEST_LOOT.primary, rand), rand, out));
  // A weapon brings its ammunition as the second reward.
  if (CHEST_LOOT.weaponBringsAmmo && ITEMS[out[0]!.item].kind === 'weapon' && n >= 2) out.push(rollOfKind('ammo', rand, out));
  while (out.length < n) {
    let kind = pickWeighted(CHEST_LOOT.secondary, rand);
    // One ammunition pack per chest (a second one would only repeat it): something else instead.
    if (kind === 'ammo' && out.some((d) => ITEMS[d.item].kind === 'ammo')) kind = 'consumable';
    const d = rollOfKind(kind, rand, out);
    // The same consumable twice is one stack (a chest still holds at least two different rewards).
    const same = ITEMS[d.item].kind === 'consumable' ? out.find((o) => o.item === d.item) : undefined;
    if (same && out.length >= 2) {
      same.qty = Math.min(CONSUMABLES[ITEMS[d.item].consumable!].maxStack, same.qty + d.qty);
      break;
    }
    if (same) {
      const other = pickWeighted(CHEST_LOOT.consumable.filter((e) => e.v !== d.item), rand);
      out.push({ item: other, qty: qtyOf(other, rand) });
      continue;
    }
    out.push(d);
  }
  return out;
}

const hasWeapon = (c: LootDrop[]) => c.some((d) => ITEMS[d.item].kind === 'weapon');
const RARITY_RANK: Record<string, number> = { common: 0, uncommon: 1, rare: 2, epic: 3 };
/** The rank of a chest's rarest item (common 0 … epic 3). */
const bestRarity = (c: LootDrop[]) => Math.max(...c.map((d) => RARITY_RANK[ITEMS[d.item].rarity] ?? 0));

/**
 * The whole match's chests from one seed, with the fairness rules: every starter chest (`starters[i]`) holds a weapon
 * (a basic one when it rolled none), at least `minWeaponShare` of the chests hold a weapon (spread through the chest
 * order, which the spawner already spreads over the planet) and at most `maxEpicPerMatch` epic items. A chest with
 * `advantage[i]` (a high spot: CHEST_REGIONS `vantage`) is rolled twice and keeps the roll whose best item is rarer.
 * Deterministic for (seed, count, starters, advantage).
 */
export function rollMatchLoot(seed: number, count: number, starters: readonly boolean[] = [], advantage: readonly boolean[] = []): LootDrop[][] {
  const rand = mulberry32(seed ^ 0x51ed270b);
  const chests = Array.from({ length: count }, (_, i) => {
    const a = rollChest(rand);
    if (!advantage[i]) return a;
    const b = rollChest(rand);
    return bestRarity(b) > bestRarity(a) ? b : a;
  });
  // Starter chests: a basic weapon (and its ammunition) when the roll gave none.
  chests.forEach((c, i) => {
    if (!starters[i] || hasWeapon(c)) return;
    const item = pickWeighted(CHEST_LOOT.starterWeapon, rand);
    c[0] = { item, qty: 1 };
    if (c.length >= 2) c[1] = rollOfKind('ammo', rand, c.slice(0, 1));
  });
  // Enough weapons: turn the first reward of evenly spaced weaponless chests into a weapon (+ its ammunition).
  const need = Math.ceil(count * CHEST_LOOT.minWeaponShare);
  const without = chests.map((c, i) => (hasWeapon(c) ? -1 : i)).filter((i) => i >= 0);
  for (let k = without.length - 1; k > 0; k--) {
    const j = Math.floor(rand() * (k + 1));
    [without[k], without[j]] = [without[j]!, without[k]!];
  }
  for (let have = count - without.length; have < need && without.length; have++) {
    const c = chests[without.pop()!]!;
    c[0] = rollOfKind('weapon', rand, []);
    if (c.length >= 2) c[1] = rollOfKind('ammo', rand, c.slice(0, 1));
  }
  // Not too many epics: later ones are rerolled among the others.
  let epics = 0;
  for (const c of chests) {
    for (let k = 0; k < c.length; k++) {
      if (ITEMS[c[k]!.item].rarity !== 'epic') continue;
      if (++epics <= CHEST_LOOT.maxEpicPerMatch) continue;
      const list = CHEST_LOOT.weapon.filter((e) => ITEMS[e.v].rarity !== 'epic' && !c.some((d) => d.item === e.v));
      const item = pickWeighted(list, rand);
      c[k] = { item, qty: 1 };
      // Its ammunition follows the new weapon.
      const ammo = c.findIndex((d) => ITEMS[d.item].kind === 'ammo');
      if (ammo > k) c[ammo] = { item: AMMO_ITEM[WEAPONS[ITEMS[item].weapon!].ammo], qty: qtyOf(AMMO_ITEM[WEAPONS[ITEMS[item].weapon!].ammo], rand) };
    }
  }
  return chests;
}

// ------------------------------------------------------------------------------------------------ inventory

export interface WeaponSlot {
  id: WeaponId;
  /** Rounds in the magazine. */
  ammo: number;
}

/** GRAInventory: what one player carries. Only the server's copy is real; the client mirrors it from SELF. */
export interface Inventory {
  slots: (WeaponSlot | null)[];
  reserve: Record<AmmoType, number>;
  consumables: Record<ConsumableId, number>;
  /** Bots: reloads never consume the reserve. */
  infinite: boolean;
}

export interface Kit {
  weapons: (WeaponId | null)[];
  reserve: Record<AmmoType, number>;
  consumables: Record<ConsumableId, number>;
}

export function newInventory(kit: Kit, infinite = false): Inventory {
  const slots: (WeaponSlot | null)[] = [];
  for (let i = 0; i < WEAPON_SLOT_COUNT; i++) {
    const id = kit.weapons[i] ?? null;
    slots.push(id ? { id, ammo: WEAPONS[id].magazine } : null);
  }
  return { slots, reserve: { ...kit.reserve }, consumables: { ...kit.consumables }, infinite };
}

/** Adds up to `n` rounds of `type` (never past the cap). Returns how many went in. */
export function addAmmo(inv: Inventory, type: AmmoType, n: number): number {
  const take = Math.max(0, Math.min(n, AMMO[type].max - inv.reserve[type]));
  inv.reserve[type] += take;
  return take;
}

/** Adds up to `n` of a consumable (never past the stack). Returns how many went in. */
export function addConsumable(inv: Inventory, id: ConsumableId, n: number): number {
  const take = Math.max(0, Math.min(n, CONSUMABLES[id].maxStack - inv.consumables[id]));
  inv.consumables[id] += take;
  return take;
}

/** First empty weapon slot, or -1. */
export const freeSlot = (inv: Inventory): number => inv.slots.findIndex((s) => !s);

/** Puts a weapon in `slot`, returning what was there (to drop on the ground) or null. */
export function putWeapon(inv: Inventory, slot: number, w: WeaponSlot): WeaponSlot | null {
  const old = inv.slots[slot] ?? null;
  inv.slots[slot] = { ...w };
  return old;
}

/** How many rounds a reload of `slot` moves into the magazine right now (0 = nothing to reload, or no reserve). */
export function reloadAmount(inv: Inventory, slot: number): number {
  const s = inv.slots[slot];
  if (!s) return 0;
  const room = WEAPONS[s.id].magazine - s.ammo;
  return inv.infinite ? room : Math.max(0, Math.min(room, inv.reserve[WEAPONS[s.id].ammo]));
}

/** Completes a reload of `slot`: rounds move from the reserve into the magazine. Returns how many moved. */
export function finishReload(inv: Inventory, slot: number): number {
  const n = reloadAmount(inv, slot);
  const s = inv.slots[slot];
  if (!s || n <= 0) return 0;
  s.ammo += n;
  if (!inv.infinite) inv.reserve[WEAPONS[s.id].ammo] -= n;
  return n;
}

/**
 * Everything a player drops when eliminated, as ground items (weapons keep their magazine; ammunition is capped per
 * type by LOOT_RULES.deathAmmoCap). The inventory is emptied: what is dropped is no longer carried.
 */
export function takeAll(inv: Inventory): { item: ItemId; qty: number; ammo?: number }[] {
  const out: { item: ItemId; qty: number; ammo?: number }[] = [];
  for (let i = 0; i < inv.slots.length; i++) {
    const s = inv.slots[i];
    const item = s ? weaponItem(s.id) : null;
    if (s && item) out.push({ item, qty: 1, ammo: s.ammo });
    inv.slots[i] = null;
  }
  for (const t of AMMO_TYPES) {
    const n = inv.infinite ? 0 : Math.min(inv.reserve[t], LOOT_RULES.deathAmmoCap);
    if (n > 0) out.push({ item: AMMO_ITEM[t], qty: n });
    inv.reserve[t] = 0;
  }
  for (const c of CONSUMABLE_ORDER) {
    if (inv.consumables[c] > 0) out.push({ item: CONSUMABLE_ITEM[c], qty: inv.consumables[c] });
    inv.consumables[c] = 0;
  }
  return out;
}

export const itemIndex = (id: ItemId): number => ITEM_IDS.indexOf(id);
export const itemAt = (index: number): ItemId | undefined => ITEM_IDS[index];
export const rarityOf = (id: ItemId): Rarity => ITEMS[id].rarity;
