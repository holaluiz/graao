/// <reference lib="dom" />
/* eslint-disable @typescript-eslint/no-explicit-any -- probes the live app object inside the page */
/**
 * A second, fully independent browser player (own Chromium process, own profile and storage) for two-session tests.
 * It opens the real client, joins a room by code and reports what that player sees, once per second, as JSON lines.
 *
 *   pnpm exec tsx tools/networking/browser-player.ts --url "http://localhost:5177/?server=ws://localhost:2570" --code GR-XXXX
 *     --name Beto        display name
 *     --ready            press "Estou pronto" in the lobby (and stay ready)
 *     --offline-at 8     cut the network at 8 s for --offline-for seconds (default 5): a real dropped connection
 *     --duration 60      seconds to stay (default 60)
 *     --headed           show the window
 */
import { chromium } from '@playwright/test';

const arg = (k: string, d?: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const has = (k: string) => process.argv.includes(`--${k}`);
const url = arg('url', 'http://localhost:5173/')!;
const code = arg('code');
const name = arg('name', 'Beto')!;
const duration = Number(arg('duration', '60'));
const offlineAt = arg('offline-at') ? Number(arg('offline-at')) : -1;
const offlineFor = Number(arg('offline-for', '5'));
if (!code) throw new Error('--code GR-XXXX is required');

const out = (o: Record<string, unknown>) => console.log(JSON.stringify({ t: Math.round((Date.now() - t0) / 100) / 10, ...o }));
const t0 = Date.now();
const browser = await chromium.launch({ headless: !has('headed'), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await context.newPage();
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') out({ console: m.type(), text: m.text().slice(0, 200) });
});
page.on('pageerror', (e) => out({ pageerror: String(e).slice(0, 300) }));
await page.goto(url);
await page.locator('#boot button:not([hidden])').first().click({ timeout: 90000 });
await page.waitForSelector('.menu:not([hidden])', { timeout: 60000 });
const fields = page.locator('.menu input.field');
await fields.nth(0).fill(name);
await fields.nth(1).fill(code);
await page.getByRole('button', { name: 'Entrar', exact: true }).click();
out({ joining: code, server: await page.locator('.server-status').textContent() });

let readySent = false;
let offline = false;
while ((Date.now() - t0) / 1000 < duration) {
  const s = await page.evaluate(() => {
    const app = (window as unknown as { __graao: any }).__graao;
    const net = app.net;
    return {
      phase: app.phase,
      match: app.combat?.phase,
      code: net?.code ?? null,
      me: net?.myIndex ?? -1,
      remotes: net ? [...net.remotePlayers].map((r: any) => ({ name: r.name, pos: [r.pos.x, r.pos.y, r.pos.z].map((v: number) => Math.round(v * 10) / 10) })) : [],
      status: (document.querySelector('.hud') as HTMLElement | null)?.innerText.split('\n').slice(0, 4).join(' | ') ?? '',
      lobby: (document.querySelector('.lobby') as HTMLElement | null)?.innerText.replace(/\n+/g, ' | ').slice(0, 160) ?? '',
      results: app.results?.visible ? (document.querySelector('.results-screen') as HTMLElement | null)?.innerText.split('\n')[0] : null,
      note: (document.querySelector('.menu .note') as HTMLElement | null)?.innerText ?? '',
    };
  });
  out(s);
  const elapsed = (Date.now() - t0) / 1000;
  if (has('ready') && !readySent && s.code) {
    readySent = true;
    await page.evaluate(() => (window as unknown as { __graao: any }).__graao.combat.setReady(true));
    out({ action: 'ready' });
  }
  if (offlineAt >= 0 && !offline && elapsed >= offlineAt) {
    offline = true;
    await context.setOffline(true);
    out({ action: 'offline' });
    setTimeout(() => void context.setOffline(false).then(() => out({ action: 'online' })), offlineFor * 1000);
  }
  await page.waitForTimeout(1000);
}
await browser.close();
