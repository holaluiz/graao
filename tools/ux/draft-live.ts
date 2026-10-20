/**
 * A real Ability Draft played through the screen against the authoritative server (Gate C evidence): a room with nine
 * bots, the host starts the Draft and, in each of the four rounds, picks a card on the board with the mouse. Rounds
 * 1, 2 and 4 are confirmed with the button; round 3 is left as an unconfirmed preview so the client's last-moment
 * confirmation (and the server deadline) has to finish it. Checks that every seat ends with a valid build (three
 * different basics + one Ultimate, at most one passive), that the screen's choices became the server's loadout, and
 * that the Draft hands over to the next phase. Captures the live board.
 *
 *   pnpm --filter @graao/server exec tsx src/index.ts --port 2591        (no apps/server/.env: Supabase off)
 *   pnpm --filter @graao/client exec vite --config ../../tools/profiling/vite.bench.config.mjs --port 5191 --strictPort
 *   pnpm exec tsx tools/ux/draft-live.ts [--url http://localhost:5191] [--server ws://localhost:2591] [--size 1366x768]
 *     [--out docs/UX/screenshots] [--json docs/UX/draft-live-check.json] [--headed]
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { validateLoadout } from '@graao/game-core';
import { ABILITIES, isAbilityId } from '@graao/game-data';

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const url = arg('url', 'http://localhost:5191')!;
const server = arg('server', 'ws://localhost:2591')!;
const out = resolve(arg('out', 'docs/UX/screenshots')!);
const json = resolve(arg('json', 'docs/UX/draft-live-check.json')!);
const [W, H] = arg('size', '1366x768')!.split('x').map(Number) as [number, number];
const UNCONFIRMED_ROUND = 2;
mkdirSync(out, { recursive: true });

function chromePath(): string | undefined {
  const dir = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
  if (!existsSync(dir)) return undefined;
  const dirs = readdirSync(dir).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const d of dirs) {
    const exe = join(dir, d, 'chrome-win64', 'chrome.exe');
    if (existsSync(exe)) return exe;
  }
  return undefined;
}
const launchArgs = { headless: !process.argv.includes('--headed'), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] };
const browser = await chromium.launch(launchArgs).catch(() => chromium.launch({ ...launchArgs, executablePath: chromePath() }));
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.addInitScript('window.__name = (f) => f;');
page.on('pageerror', (e) => console.log(`erro na página: ${e.message.slice(0, 200)}`));

type DraftView = { round: number; stage: string; kind: string; mine: string | null; reveal: { index: number; a: string; auto: boolean }[]; seats: { index: number; picks: string[] }[] };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const draft = () => page.evaluate(() => {
  const ui = (window as Any).__graao.draftUi;
  return { visible: !ui.el.hidden, state: ui.state as DraftView | null, me: ui.me as number, phase: (window as Any).__graao.phase as string };
});

const t0 = Date.now();
const since = () => Math.round((Date.now() - t0) / 100) / 10;
await page.goto(`${url}/?auto&server=${encodeURIComponent(server)}`);
await page.waitForFunction(() => !!(window as Any).__graao?.draftUi && !document.getElementById('boot'), undefined, { timeout: 180000 });
await page.evaluate(() => (window as Any).__graao.online('create', '', 'Jogador', 9, { visibility: 'private' }));
// Bots are planned seats in the lobby; they become players when the Draft starts.
await page.waitForFunction(() => (window as Any).__graao.phase === 'ROOM_LOBBY' && !!(window as Any).__graao.roomState, undefined, { timeout: 60000 });
console.log(`${since()} s: lobby (${await page.evaluate(() => (window as Any).__graao.roomState.players.length)} jogador na sala, 9 bots previstos)`);
const ready = page.getByRole('button', { name: 'Estou pronto' });
if (await ready.isVisible().catch(() => false)) await ready.click();
const start = page.getByRole('button', { name: 'Iniciar Draft →' });
await start.waitFor({ state: 'visible', timeout: 30000 });
await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent?.includes('Iniciar Draft') && !b.disabled), undefined, { timeout: 30000 });
await start.click();
await page.waitForFunction(() => !(window as Any).__graao.draftUi.el.hidden, undefined, { timeout: 30000 });
console.log(`${since()} s: Draft aberto`);

const rounds: Record<string, unknown>[] = [];
for (let round = 0; round < 4; round++) {
  await page.waitForFunction((r) => {
    const s = (window as Any).__graao.draftUi.state;
    return s && s.round === r && s.stage === 'pick';
  }, round, { timeout: 60000 });
  const opened = Date.now();
  const kind = round === 3 ? 'ultimate' : 'basic';
  // Round 1 takes a passive (the board must then refuse the other seven); later rounds the first card offered.
  const pick = await page.evaluate(([k, r]) => {
    const cards = [...document.querySelectorAll<HTMLButtonElement>(`.draft-grid.${k} .draft-card[aria-disabled="false"]`)];
    const choice = (r === 0 ? cards.find((c) => c.dataset.kind === 'passive') : undefined) ?? cards[r * 3 % cards.length]!;
    return { id: choice.dataset.id!, offered: cards.length };
  }, [kind, round] as const);
  await page.locator(`.draft-card[data-id="${pick.id}"]`).click();
  const blockedPassives = await page.locator('.draft-card.passive-limit').count();
  if (round === 0 || round === 3) await page.screenshot({ path: join(out, `draft-v3-live-${W}-round${round + 1}.jpg`), type: 'jpeg', quality: 88 });
  if (round !== UNCONFIRMED_ROUND) await page.locator('.draft-confirm').click();
  await page.waitForFunction((r) => {
    const s = (window as Any).__graao.draftUi.state;
    return s && ((s.round === r && s.stage === 'reveal') || s.round > r || s.stage === 'done');
  }, round, { timeout: 70000 });
  const view = (await draft()).state!;
  const mine = view.reveal.find((x) => x.index === 0) ?? null;
  if (round === 1) await page.screenshot({ path: join(out, `draft-v3-live-${W}-reveal.jpg`), type: 'jpeg', quality: 88 });
  rounds.push({
    round: round + 1, kind, offered: pick.offered, chose: pick.id, confirmed: round === UNCONFIRMED_ROUND ? 'automático (prévia ao fim do tempo)' : 'botão',
    resolvedAfterS: Math.round((Date.now() - opened) / 100) / 10, revealedMine: mine?.a ?? null, serverAuto: mine?.auto ?? null,
    passiveCardsBlocked: blockedPassives, seatsWithPick: view.seats.filter((s) => s.picks.length === round + 1).length,
  });
  console.log(`${since()} s: rodada ${round + 1}`, JSON.stringify(rounds[round]));
}

await page.waitForFunction(() => (window as Any).__graao.phase !== 'ABILITY_DRAFT', undefined, { timeout: 30000 });
const after = await page.evaluate(() => ({ phase: (window as Any).__graao.phase as string, players: ((window as Any).__graao.roomState.players as { index: number; name: string; bot?: boolean; loadout: string[] }[]).map((p) => ({ index: p.index, name: p.name, bot: !!p.bot, loadout: p.loadout })) }));
const loadouts = after.players.map((p) => ({
  ...p,
  valid: validateLoadout(p.loadout) !== null,
  passives: p.loadout.filter((id) => isAbilityId(id) && ABILITIES[id].kind === 'passive').length,
}));
const mineLoadout = loadouts.find((p) => p.index === 0)!.loadout;
const result = {
  date: new Date().toISOString().slice(0, 10),
  viewport: `${W}×${H}`,
  server,
  phaseAfterDraft: after.phase,
  rounds,
  myLoadoutMatchesScreen: JSON.stringify(mineLoadout) === JSON.stringify(rounds.map((r) => r.chose)),
  everySeatValid: loadouts.every((p) => p.valid && p.passives <= 1),
  loadouts,
  totalS: since(),
};
writeFileSync(json, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ phaseAfterDraft: result.phaseAfterDraft, myLoadoutMatchesScreen: result.myLoadoutMatchesScreen, everySeatValid: result.everySeatValid, totalS: result.totalS }));
await browser.close();
if (!result.myLoadoutMatchesScreen || !result.everySeatValid) process.exit(1);
