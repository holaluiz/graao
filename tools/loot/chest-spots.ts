/**
 * Chest spot diagnostics: resolves every authored spot against the real collision world and prints, per region, where
 * it ended up, how far it was nudged and why a refused one failed. Then picks a few matches' chests and reports their
 * spread. `pnpm tsx tools/loot/chest-spots.ts [--matches 200]`
 */
import { createGameWorld, dirToLatLon, mulberry32, pickChestSpots, resolveChestSpots } from '@graao/game-core';
import { CHEST_REGIONS, LOOT_RULES, PLANET } from '@graao/game-data';
import { v3angle, v3normalize } from '@graao/shared';

const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
};

const t0 = performance.now();
const world = await createGameWorld({ includeVisual: false });
const t1 = performance.now();
const spots = resolveChestSpots(world);
const t2 = performance.now();
console.log(`world ${(t1 - t0).toFixed(0)} ms · ${spots.length} spots resolved in ${(t2 - t1).toFixed(0)} ms\n`);

let bad = 0;
for (const [ri, r] of CHEST_REGIONS.entries()) {
  const list = spots.filter((s) => s.region === ri);
  console.log(`${r.name} (mín. ${r.min}): ${list.filter((s) => s.ok).length}/${list.length} válidos`);
  for (const s of list) {
    const ll = dirToLatLon(s.pos);
    const h = Math.hypot(s.pos.x, s.pos.y, s.pos.z) - PLANET.radius;
    const tilt = (v3angle(s.up, v3normalize(s.pos)) * 180) / Math.PI;
    if (!s.ok) bad++;
    console.log(
      `  ${s.ok ? 'OK ' : 'XX '} ${s.def.id.padEnd(20)} lat ${ll.lat.toFixed(1).padStart(6)} lon ${ll.lon.toFixed(1).padStart(7)} h ${h.toFixed(2).padStart(5)} m · inclinação ${tilt.toFixed(1).padStart(4)}° · movido ${s.moved.toFixed(1)} m${s.ok ? '' : ` · ${s.reason}`} · ${s.def.hint}`,
    );
  }
}

// Spread over many matches.
const matches = arg('matches', 200);
const perRegion = new Map<string, number>();
let minGap = Infinity;
let short = 0;
for (let m = 0; m < matches; m++) {
  const chosen = pickChestSpots(spots, LOOT_RULES.chestsPerMatch, mulberry32(m * 7919 + 13));
  if (chosen.length < LOOT_RULES.chestsPerMatch) short++;
  for (const c of chosen) perRegion.set(CHEST_REGIONS[c.region]!.name, (perRegion.get(CHEST_REGIONS[c.region]!.name) ?? 0) + 1);
  for (let i = 0; i < chosen.length; i++) for (let j = i + 1; j < chosen.length; j++) minGap = Math.min(minGap, v3angle(v3normalize(chosen[i]!.pos), v3normalize(chosen[j]!.pos)) * PLANET.radius);
}
console.log(`\n${matches} partidas · ${LOOT_RULES.chestsPerMatch} baús cada · menor distância entre dois baús ${minGap.toFixed(1)} m · partidas com menos baús: ${short}`);
for (const [name, n] of perRegion) console.log(`  ${name.padEnd(20)} ${(n / matches).toFixed(2)} baús/partida`);
world.physics.dispose();
if (bad) console.log(`\n${bad} ponto(s) inválido(s) — ajuste CHEST_SPOTS em packages/game-data/src/loot.ts`);
process.exitCode = 0;
