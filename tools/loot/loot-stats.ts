/**
 * Loot statistics over many simulated matches (the server's own spawner and table, no network):
 * `pnpm tsx tools/loot/loot-stats.ts [--matches 1000]`
 *
 * Reports per match: chests, rewards, weapons and their rarities, ammunition, consumables; how many chests a player
 * opens before the first weapon (in the order they are spread over the planet, and in random order); and how the
 * weapons spread over the regions. Use it after any change to CHEST_LOOT / CHEST_SPOTS / LOOT_RULES.
 */
import { createGameWorld, mulberry32, pickChestSpots, resolveChestSpots, rollMatchLoot } from '@graao/game-core';
import { CHEST_REGIONS, ITEMS, LOOT_RULES, RARITY_ORDER, type ItemId } from '@graao/game-data';

const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
};
const matches = arg('matches', 1000);
const world = await createGameWorld({ includeVisual: false });
const spots = resolveChestSpots(world);

const itemCount = new Map<ItemId, number>();
const rarityCount = new Map<string, number>();
const perMatch = { rewards: [] as number[], weapons: [] as number[], weaponChests: [] as number[], epics: [] as number[] };
const firstWeaponRandom: number[] = [];
const regionWeapons = new Map<string, number>();
const regionChests = new Map<string, number>();
const t0 = performance.now();
for (let m = 0; m < matches; m++) {
  const seed = (Math.imul(m + 1, 2654435761) ^ 0x9e3779b9) >>> 0;
  const chosen = pickChestSpots(spots, LOOT_RULES.chestsPerMatch, mulberry32(seed));
  const chests = rollMatchLoot(seed, chosen.length);
  let rewards = 0;
  let weapons = 0;
  let epics = 0;
  chests.forEach((c, i) => {
    const region = CHEST_REGIONS[chosen[i]!.region]!.name;
    regionChests.set(region, (regionChests.get(region) ?? 0) + 1);
    for (const d of c) {
      rewards++;
      itemCount.set(d.item, (itemCount.get(d.item) ?? 0) + 1);
      const def = ITEMS[d.item];
      if (def.kind === 'weapon') {
        weapons++;
        rarityCount.set(def.rarity, (rarityCount.get(def.rarity) ?? 0) + 1);
        regionWeapons.set(region, (regionWeapons.get(region) ?? 0) + 1);
      }
      if (def.rarity === 'epic') epics++;
    }
  });
  perMatch.rewards.push(rewards);
  perMatch.weapons.push(weapons);
  perMatch.epics.push(epics);
  perMatch.weaponChests.push(chests.filter((c) => c.some((d) => ITEMS[d.item].kind === 'weapon')).length);
  // A player opening chests in a random order: how many until the first weapon?
  const order = chests.map((_, i) => i).sort(() => Math.random() - 0.5);
  firstWeaponRandom.push(order.findIndex((i) => chests[i]!.some((d) => ITEMS[d.item].kind === 'weapon')) + 1);
}
const ms = performance.now() - t0;

const stat = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return `mín ${s[0]} · média ${(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2)} · máx ${s[s.length - 1]}`;
};
const pct = (n: number, total: number) => `${((n / total) * 100).toFixed(1)}%`;
const totalRewards = perMatch.rewards.reduce((a, b) => a + b, 0);

console.log(`${matches} partidas simuladas em ${ms.toFixed(0)} ms · ${LOOT_RULES.chestsPerMatch} baús por partida\n`);
console.log(`recompensas/partida   ${stat(perMatch.rewards)}`);
console.log(`armas/partida         ${stat(perMatch.weapons)}`);
console.log(`baús com arma         ${stat(perMatch.weaponChests)}`);
console.log(`épicos/partida        ${stat(perMatch.epics)}`);
console.log(`baús até a 1ª arma    ${stat(firstWeaponRandom)} (ordem aleatória)`);
for (const k of [1, 2, 3]) console.log(`  achou arma em ≤ ${k} baú(s): ${pct(firstWeaponRandom.filter((n) => n <= k).length, matches)}`);
console.log('\nraridade das armas');
const totalWeapons = [...rarityCount.values()].reduce((a, b) => a + b, 0);
for (const r of RARITY_ORDER) console.log(`  ${r.padEnd(9)} ${pct(rarityCount.get(r) ?? 0, totalWeapons)}`);
console.log('\nitens (fração de todas as recompensas)');
for (const [id, n] of [...itemCount].sort((a, b) => b[1] - a[1])) console.log(`  ${ITEMS[id].name.padEnd(22)} ${pct(n, totalRewards).padStart(6)}  (${ITEMS[id].rarity})`);
console.log('\narmas por região (por baú da região)');
for (const [region, n] of regionChests) console.log(`  ${region.padEnd(20)} ${((regionWeapons.get(region) ?? 0) / n).toFixed(2)} armas/baú · ${(n / matches).toFixed(2)} baús/partida`);
world.physics.dispose();
