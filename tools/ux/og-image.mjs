// Link preview image (Open Graph, 1200×630) for WhatsApp, Discord, X…: renders tools/ux/og-image.html over a real
// in-game capture and writes apps/client/public/og-image.jpg. Run again after a rebranding or a new key art:
//   node tools/ux/og-image.mjs [background.jpg]
// Uses the installed Edge (`channel: 'msedge'`) because the Chromium build pinned by Playwright may not be downloaded.
import { readFileSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const background = resolve(process.argv[2] ?? join(repo, 'docs/world/screenshots/vila-ladeira.jpg'));
const out = join(repo, 'apps/client/public/og-image.jpg');

const page = join(here, '.og-image.rendered.html');
writeFileSync(page, readFileSync(join(here, 'og-image.html'), 'utf8').replaceAll('BG_URL', pathToFileURL(background).href));
const browser = await chromium.launch({ channel: 'msedge' });
try {
  const tab = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await tab.goto(pathToFileURL(page).href);
  await tab.waitForLoadState('networkidle');
  await tab.evaluate('document.fonts.ready');
  // A missing background would still render (cream page): refuse it instead of writing a bare card.
  if (!(await tab.evaluate("document.querySelector('.shot').naturalWidth"))) throw new Error(`background did not load: ${background}`);
  // WhatsApp drops previews whose image is too heavy (≈ 300 KB): JPEG at 86 stays near 100 KB.
  await tab.screenshot({ path: out, type: 'jpeg', quality: 86 });
} finally {
  await browser.close();
  rmSync(page, { force: true });
}
console.log(`${out} (${Math.round(statSync(out).size / 1024)} KB)`);
