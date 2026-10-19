/**
 * Region captures and render measurements (docs/world/screenshots, docs/world/WORLD_PERFORMANCE.md).
 *
 * Opens a dev build of the client in Chromium (Playwright, the real GPU through ANGLE), plays solo, turns off the
 * camera-obstruction dissolve and the HUD, then for every view of tools/world/views.ts points the camera, waits for the
 * frame to settle and saves a JPEG. With --perf it also measures each view the way tools/profiling/village-bench.js
 * does: the animation loop stopped, frames driven by hand at a fixed step, CPU time of `app.frame` and CPU+GPU time
 * (a 1-pixel readPixels waits for the GPU), plus draw calls, triangles, geometries, textures and JS heap.
 *
 *   pnpm --filter @graao/client exec vite --config ../../tools/profiling/vite.bench.config.mjs --port 5183   (or the
 *   `graao-client-world` launch config), then:
 *   pnpm exec tsx tools/world/capture-regions.ts [--url http://localhost:5183] [--perf] [--only vila-largo,lago-ilha]
 *     [--out docs/world/screenshots] [--json docs/world/perf/after.json] [--size 1280x720] [--headed]
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { VIEWS, type View } from './views';

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const url = arg('url', 'http://localhost:5183')!;
const out = resolve(arg('out', 'docs/world/screenshots')!);
const perf = process.argv.includes('--perf');
const only = arg('only')?.split(',');
const json = arg('json');
const [W, H] = arg('size', '1280x720')!.split('x').map(Number) as [number, number];
const views = only ? VIEWS.filter((v) => only.includes(v.name)) : VIEWS;

/**
 * The Chromium to drive: `--chrome <exe>`, else Playwright's own, else the newest one already installed under
 * ms-playwright (a Playwright upgrade without `playwright install` leaves the older builds in place).
 */
function chromePath(): string | undefined {
  const given = arg('chrome');
  if (given) return given;
  const root = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
  if (!existsSync(root)) return undefined;
  const dirs = readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const d of dirs) {
    const exe = join(root, d, 'chrome-win64', 'chrome.exe');
    if (existsSync(exe)) return exe;
  }
  return undefined;
}
const launchArgs = { headless: !process.argv.includes('--headed'), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader=false'] };
const browser = await chromium.launch(arg('chrome') ? { ...launchArgs, executablePath: chromePath() } : launchArgs).catch(() => {
  const exe = chromePath();
  if (!exe) throw new Error('nenhum Chromium do Playwright instalado: use --chrome <caminho do chrome.exe>');
  console.log(`usando ${exe}`);
  return chromium.launch({ ...launchArgs, executablePath: exe });
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
// tsx keeps function names with an `__name` helper that the page does not have: give it one.
await page.addInitScript('window.__name = (f) => f;');
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[página]', m.text().slice(0, 200));
});
await page.goto(`${url}/?auto&nodrop`);
await page.waitForFunction(() => !!(window as unknown as { __graao?: unknown }).__graao && !document.getElementById('boot'), undefined, { timeout: 180000 });

const gpu = await page.evaluate(() => {
  const gl = (window as unknown as { __graao: { r: { renderer: { getContext(): WebGL2RenderingContext } } } }).__graao.r.renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'desconhecida';
});
console.log(`GPU: ${gpu}`);

// The in-page helpers: solo play, no dissolve, no HUD, a camera placed from a view, a hand-driven frame loop.
await page.evaluate(() => {
  type App = any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const w = window as unknown as { __graao: App; __shot: (v: View) => void; __frames: (n: number) => Promise<void>; __measure: (n: number) => Promise<unknown> };
  const app = w.__graao;
  app.playSolo();
  app.obstruction.reset();
  app.obstruction.update = () => {};
  app.camera.update = () => {};
  (document.getElementById('ui') as HTMLElement).style.visibility = 'hidden';
  let clock = performance.now();
  const yieldTask = () => new Promise<void>((r) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => r();
    ch.port2.postMessage(0);
  });
  w.__shot = (v) => {
    const rad = Math.PI / 180;
    const up = { x: Math.cos(v.lat * rad) * Math.sin(v.lon * rad), y: Math.sin(v.lat * rad), z: Math.cos(v.lat * rad) * Math.cos(v.lon * rad) };
    const P = app.world.terrain.surfaceAt(up);
    const n0 = { x: -up.x * up.y, y: 1 - up.y * up.y, z: -up.z * up.y };
    const nl = Math.hypot(n0.x, n0.y, n0.z);
    const north = { x: n0.x / nl, y: n0.y / nl, z: n0.z / nl };
    const east = { x: Math.cos(v.lon * rad), y: 0, z: -Math.sin(v.lon * rad) };
    const c = Math.cos(v.yaw * rad);
    const s = Math.sin(v.yaw * rad);
    const f = { x: north.x * c + east.x * s, y: north.y * c + east.y * s, z: north.z * c + east.z * s };
    // The character stands a few metres in front of the camera, on the way to the subject (scale and life).
    app.local.teleport({ x: P.x + up.x * 0.3 - f.x * 3, y: P.y + up.y * 0.3 - f.y * 3, z: P.z + up.z * 0.3 - f.z * 3 }, f);
    const cam = app.r.camera;
    cam.fov = v.fov;
    cam.updateProjectionMatrix();
    cam.position.set(P.x - f.x * v.dist + up.x * v.height, P.y - f.y * v.dist + up.y * v.height, P.z - f.z * v.dist + up.z * v.height);
    cam.up.set(up.x, up.y, up.z);
    cam.lookAt(P.x + up.x * v.look, P.y + up.y * v.look, P.z + up.z * v.look);
  };
  /** Drives `n` frames by hand at 60 Hz (the animation loop is stopped meanwhile). */
  w.__frames = async (n) => {
    app.r.renderer.setAnimationLoop(null);
    for (let i = 0; i < n; i++) {
      clock += 1000 / 60;
      app.frame(clock);
      if (i % 5 === 0) await yieldTask();
    }
  };
  w.__measure = async (n) => {
    const r = app.r.renderer;
    const gl = r.getContext();
    const px = new Uint8Array(4);
    r.setAnimationLoop(null);
    const cpu: number[] = [];
    const tot: number[] = [];
    let calls = 0;
    let tris = 0;
    for (let i = 0; i < n + 20; i++) {
      clock += 1000 / 60;
      r.info.reset();
      const t0 = performance.now();
      app.frame(clock);
      const t1 = performance.now();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const t2 = performance.now();
      if (i >= 20) {
        cpu.push(t1 - t0);
        tot.push(t2 - t0);
        calls = Math.max(calls, r.info.render.calls);
        tris = Math.max(tris, r.info.render.triangles);
      }
      if (i % 10 === 0) await yieldTask();
    }
    const q = (a: number[], p: number) => +[...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))]!.toFixed(2);
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return {
      cpuMs: { p50: q(cpu, 0.5), p95: q(cpu, 0.95) },
      cpuGpuMs: { p50: q(tot, 0.5), p95: q(tot, 0.95) },
      drawCalls: calls,
      triangles: tris,
      geometries: r.info.memory.geometries,
      textures: r.info.memory.textures,
      jsHeapMB: mem ? +(mem.usedJSHeapSize / 1048576).toFixed(1) : null,
    };
  };
});

mkdirSync(out, { recursive: true });
const results: Record<string, unknown> = {};
for (const v of views) {
  await page.evaluate((view) => (window as unknown as { __shot: (v: unknown) => void }).__shot(view), v);
  await page.evaluate(() => (window as unknown as { __frames: (n: number) => Promise<void> }).__frames(40));
  const file = resolve(out, `${v.name}.jpg`);
  await page.screenshot({ path: file, type: 'jpeg', quality: 86 });
  console.log(`capturado ${v.name}`);
  if (perf) {
    const m = await page.evaluate(() => (window as unknown as { __measure: (n: number) => Promise<unknown> }).__measure(120));
    results[v.name] = m;
    console.log(`  ${JSON.stringify(m)}`);
  }
}
if (perf) {
  const report = { date: new Date().toISOString(), url, gpu, size: `${W}x${H}`, views: results };
  const target = resolve(json ?? 'docs/world/perf/after.json');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(report, null, 2) + '\n');
  console.log(`medições em ${target}`);
}
await browser.close();
