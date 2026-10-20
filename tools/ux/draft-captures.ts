/**
 * Ability Draft captures and layout checks (docs/UX/ABILITY_DRAFT.md, Gate C in docs/qa/RELEASE_GATES.md).
 *
 * Opens a dev build of the client in Chromium (Playwright), injects Draft states with ten participants into the real
 * `DraftScreen` (no room needed), saves screenshots and measures what the gate asks for: ten participants on screen,
 * the forty spells reachable without tabs or pages (all visible at once on desktop, a scrolling grid on phones), the
 * build and the confirm action always visible, touch targets, no horizontal overflow. It also drives the screen with
 * real clicks/taps: select a card, confirm, and checks that exactly one DRAFT_PICK would be sent.
 *
 *   pnpm --filter @graao/client exec vite --config ../../tools/profiling/vite.bench.config.mjs --port 5191 --strictPort
 *   pnpm exec tsx tools/ux/draft-captures.ts [--url http://localhost:5191] [--out docs/UX/screenshots]
 *     [--json docs/UX/draft-visual-checks.json] [--only desktop-1366] [--headed]
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from '@playwright/test';

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const url = arg('url', 'http://localhost:5191')!;
const out = resolve(arg('out', 'docs/UX/screenshots')!);
const json = resolve(arg('json', 'docs/UX/draft-visual-checks.json')!);
const only = arg('only')?.split(',');
mkdirSync(out, { recursive: true });

interface Viewport { name: string; width: number; height: number; mobile?: boolean }
const VIEWPORTS: Viewport[] = [
  { name: 'desktop-1366', width: 1366, height: 768 },
  { name: 'desktop-1920', width: 1920, height: 1080 },
  { name: 'mobile-844', width: 844, height: 390, mobile: true },
  { name: 'mobile-740', width: 740, height: 360, mobile: true },
];

/** Same lookup as tools/world/capture-regions.ts: Playwright's Chromium, else the newest one installed. */
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
const browser = await chromium.launch(launchArgs).catch(() => {
  const exe = chromePath();
  if (!exe) throw new Error('nenhum Chromium do Playwright instalado');
  return chromium.launch({ ...launchArgs, executablePath: exe });
});

/** Installs `window.__draftDemo(scenario)`: a ten-seat Draft state handed to the real screen. */
async function installDemo(page: Page): Promise<void> {
  const gameData = `/@fs/${root.replace(/\\/g, '/')}/packages/game-data/src/index.ts`;
  await page.evaluate(async (path) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const GD: any = await import(/* @vite-ignore */ path);
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const looks = Array.from({ length: 10 }, () => GD.randomAppearance(rand));
    const names = ['Jogador', 'Ana', 'Bot 2', 'Bot 3', 'Caio', 'Bot 5', 'Bot 6', 'Bot 7', 'Bot 8', 'Bot 9'];
    const plan = [
      ['wind_foot', 'sun_orb', 'paper_wall', 'chalk_shortcut'],
      ['gust_ring', 'pollen_burst', 'steady_hand', 'sun_meteor'],
      ['thorn_seed', 'slide', 'leaf_shell', 'ink_tide'],
      ['sap_snare', 'vine_lasso', 'footstep_echo', 'kite_flight'],
      ['clothesline', 'hollow_bell', 'new_bark', 'winter_garden'],
      ['sun_orb', 'magic_umbrella', 'quick_swap', 'paper_city'],
      ['kite_jump', 'backyard_eye', 'bloom', 'firefly_beacon'],
      ['chalk_cloud', 'rain_bath', 'soft_step', 'confetti_wheel'],
      ['paper_wings', 'ricochet', 'anti_glue', 'petal_cyclone'],
      ['firefly_scout', 'wind_step', 'kite_breath', 'dawn_lance'],
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    w.__picks = [];
    w.__draftDemo = (sc: { round: number; stage?: string; select?: string; inspect?: string; mine?: string; left?: number; locked?: number[] }) => {
      const ui = w.__graao.draftUi;
      ui.actions.pick = (round: number, id: string) => w.__picks.push([round, id]);
      ui.actions.sound = () => {};
      const stage = sc.stage ?? 'pick';
      const kind = sc.round === 3 ? 'ultimate' : 'basic';
      const locked = new Set(sc.locked ?? [1, 2, 3, 5, 6, 7, 8]);
      const seats = plan.map((p, i) => ({ index: i, picks: p.slice(0, stage === 'reveal' ? sc.round + 1 : sc.round), picking: stage === 'pick', locked: stage === 'pick' && locked.has(i) }));
      const state = {
        round: sc.round, rounds: 4, kind, stage, endsAt: Date.now() + (sc.left ?? 32) * 1000, priority: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
        pool: [...(kind === 'basic' ? GD.BASIC_ABILITIES : GD.ULTIMATE_ABILITIES)], unique: false,
        owners: seats.flatMap((s) => s.picks.map((a: string) => [a, s.index])), seats, mine: sc.mine ?? null, repick: false, lostTo: null,
        reveal: stage === 'reveal' ? plan.map((p, i) => ({ index: i, a: p[sc.round], auto: i === 9, contested: false })) : [],
      };
      ui.show(false);
      ui.show(true);
      ui.setState(state, 0, (i: number) => names[i], (i: number) => looks[i]);
      if (sc.select) ui.choose(sc.select);
      if (sc.inspect) ui.inspect(sc.inspect);
      // Finite entrance animations end now so the capture shows the settled layout (loops keep running).
      for (const a of document.getAnimations()) try { a.finish(); } catch { /* infinite loop */ }
    };
  }, gameData);
}

/** What the gate asks of the layout, measured on the live DOM. */
async function measure(page: Page) {
  return page.evaluate(() => {
    const inView = (r: DOMRect) => r.width > 0 && r.height > 0 && r.left >= -0.5 && r.top >= -0.5 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5;
    const rects = (sel: string) => [...document.querySelectorAll(sel)].map((e) => e.getBoundingClientRect());
    const pools = document.querySelector('.draft-pools') as HTMLElement;
    const poolRect = pools.getBoundingClientRect();
    const cards = rects('.draft-card');
    const cardsOnScreen = cards.filter((r) => inView(r) && r.top >= poolRect.top - 0.5 && r.bottom <= poolRect.bottom + 0.5).length;
    const fonts = [...document.querySelectorAll('.draft-card *, .draft-seat *, .draft-bar *, .draft-details *')]
      .filter((e) => e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim()) && (e as HTMLElement).offsetParent !== null)
      .map((e) => parseFloat(getComputedStyle(e).fontSize));
    const confirm = (document.querySelector('.draft-confirm:not([hidden])') ?? document.querySelector('.draft-change:not([hidden])')) as HTMLElement | null;
    const confirmRect = confirm?.getBoundingClientRect();
    const body = document.querySelector('.draft-detail-body') as HTMLElement;
    return {
      seats: document.querySelectorAll('.draft-seat').length,
      seatsOnScreen: rects('.draft-seat').filter(inView).length,
      cards: cards.length,
      cardsOnScreen,
      gridScrolls: pools.scrollHeight > pools.clientHeight + 1,
      cardMinSize: [Math.round(Math.min(...cards.map((r) => r.width))), Math.round(Math.min(...cards.map((r) => r.height)))],
      buildSlotsOnScreen: rects('.db-slot').filter(inView).length,
      confirmOnScreen: !!confirmRect && inView(confirmRect),
      confirmHeight: confirmRect ? Math.round(confirmRect.height) : 0,
      tabsOrPages: document.querySelectorAll('.draft .draft-filters, .draft .draft-pagination, .draft [role="tab"], .draft [role="tablist"]').length,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      detailScrolls: body.scrollHeight > body.clientHeight + 1,
      smallestFontPx: Math.min(...fonts),
    };
  });
}

const report: Record<string, unknown> = {};
for (const vp of VIEWPORTS.filter((v) => !only || only.includes(v.name))) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, isMobile: !!vp.mobile, hasTouch: !!vp.mobile });
  const page = await context.newPage();
  await page.addInitScript('window.__name = (f) => f;');
  page.on('pageerror', (e) => console.log(`[${vp.name}] erro na página: ${e.message.slice(0, 200)}`));
  await page.goto(`${url}/?auto`);
  await page.waitForFunction(() => !!(window as unknown as { __graao?: { draftUi?: unknown } }).__graao?.draftUi && !document.getElementById('boot'), undefined, { timeout: 180000 });
  // Phones are asked to rotate in portrait; the Draft is laid out for landscape. Hide the hint layer if present.
  await page.addStyleTag({ content: '.rotate-hint { display: none !important; }' });
  await installDemo(page);
  const shots: Record<string, unknown> = {};
  const shoot = async (name: string, sc: Parameters<NonNullable<Window['__draftDemo']>>[0]) => {
    await page.evaluate((s) => window.__draftDemo!(s), sc);
    await page.waitForTimeout(250);
    const file = `draft-v3-${vp.name}-${name}.jpg`;
    await page.screenshot({ path: join(out, file), type: 'jpeg', quality: 88 });
    shots[name] = { file: `docs/UX/screenshots/${file}`, ...(await measure(page)) };
  };
  await shoot('round2', { round: 1, select: 'vine_lasso' });
  await shoot('round4', { round: 3, select: 'paper_city', locked: [1, 2, 4, 6, 7] });
  await shoot('reveal', { round: 1, stage: 'reveal', inspect: 'sun_orb' });
  if (vp.mobile) {
    // Touch a card low in the grid: scroll to it, tap, see the detail, tap confirm.
    await page.evaluate((s) => window.__draftDemo!(s), { round: 1 });
    const card = page.locator('.draft-card[data-id="backyard_eye"]');
    await card.scrollIntoViewIfNeeded();
    await card.tap();
    await page.waitForTimeout(150);
    const detail = await page.locator('.dd-name').textContent();
    await page.screenshot({ path: join(out, `draft-v3-${vp.name}-tap.jpg`), type: 'jpeg', quality: 88 });
    await page.locator('.draft-confirm').tap();
    const picks = await page.evaluate(() => (window as unknown as { __picks: unknown[] }).__picks);
    shots.tap = { file: `docs/UX/screenshots/draft-v3-${vp.name}-tap.jpg`, detailAfterTap: detail, picksSent: picks };
  } else {
    // Mouse: hover shows the detail, click selects, Enter confirms once.
    await page.evaluate((s) => window.__draftDemo!(s), { round: 1 });
    await page.locator('.draft-card[data-id="clothesline"]').hover();
    const hovered = await page.locator('.dd-name').textContent();
    await page.locator('.draft-card[data-id="clothesline"]').click();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    const picks = await page.evaluate(() => (window as unknown as { __picks: unknown[] }).__picks);
    shots.mouse = { detailOnHover: hovered, picksSent: picks };
  }
  report[vp.name] = { viewport: `${vp.width}×${vp.height}`, mobile: !!vp.mobile, ...shots };
  console.log(vp.name, JSON.stringify(shots, null, 1));
  await context.close();
}
await browser.close();
writeFileSync(json, `${JSON.stringify({ date: new Date().toISOString().slice(0, 10), url, report }, null, 2)}\n`);
console.log(`relatório: ${json}`);

declare global {
  interface Window { __draftDemo?: (s: { round: number; stage?: string; select?: string; inspect?: string; mine?: string; left?: number; locked?: number[] }) => void }
}
