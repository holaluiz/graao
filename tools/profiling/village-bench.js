/* global window, performance, MessageChannel, requestAnimationFrame */
/**
 * Lantern Village GPU/CPU benchmark (docs/performance/BUDGETS.md). Runs in the page of a dev build (`window.__graao`):
 *
 *   const perf = await import('/@fs/<repo>/tools/profiling/village-bench.js');
 *   perf.setup();               // solo spawn, camera facing the village well (lat 8, lon 0)
 *   await perf.bench();         // CPU (update + submit) and CPU+GPU (frame + gl.readPixels) medians / p95
 *   await perf.ab([...]);       // interleaved A/B rounds, robust to GPU clock drift
 *   await perf.gpuProfile();    // EXT_disjoint_timer_query per draw (main and shadow pass), when available
 *
 * Frames are driven by hand (the animation loop is stopped) at a fixed 144 Hz timestep; `gl.readPixels(0, 0, 1, 1)`
 * after each frame waits for the GPU, so "tot" is CPU + GPU serialized (an upper bound of the pipelined frame).
 */

const yieldTask = () =>
  new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => resolve();
    ch.port2.postMessage(0);
  });

let clock = performance.now();
const app = () => window.__graao;
const quantile = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2);
};

export function setup() {
  const a = app();
  a.r.renderer.setAnimationLoop(null);
  a.playSolo();
}

/** Resumes the normal animation loop (the page is playable again). */
export function resume() {
  const a = app();
  a.r.renderer.setAnimationLoop((t) => {
    if (a.limiter.shouldRender(t)) a.frame(t);
  });
}

async function run(n, warm, sink) {
  const a = app();
  const gl = a.r.renderer.getContext();
  const px = new Uint8Array(4);
  a.r.renderer.setAnimationLoop(null);
  for (let i = 0; i < warm + n; i++) {
    clock += 1000 / 144;
    const t0 = performance.now();
    a.frame(clock);
    const t1 = performance.now();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const t2 = performance.now();
    if (i >= warm) {
      sink.cpu.push(t1 - t0);
      sink.tot.push(t2 - t0);
    }
    if (i % 10 === 0) await yieldTask();
  }
  sink.calls = a.r.renderer.info.render.calls;
  sink.tris = a.r.renderer.info.render.triangles;
}

function summary(s) {
  return { cpuMed: quantile(s.cpu, 0.5), totMed: quantile(s.tot, 0.5), totP95: quantile(s.tot, 0.95), calls: s.calls, tris: s.tris };
}

export async function bench(n = 240, warm = 40) {
  const s = { cpu: [], tot: [] };
  await run(n, warm, s);
  return summary(s);
}

/** configs: [{ name, apply?, undo? }]; each round runs every config once, in order. */
export async function ab(configs, rounds = 6, n = 60, warm = 15) {
  const S = Object.fromEntries(configs.map((c) => [c.name, { cpu: [], tot: [] }]));
  for (let r = 0; r < rounds; r++) {
    for (const c of configs) {
      c.apply?.();
      await run(n, warm, S[c.name]);
      c.undo?.();
    }
  }
  return Object.fromEntries(Object.entries(S).map(([k, v]) => [k, summary(v)]));
}

function category(o) {
  const n = o.name || '';
  if (n.startsWith('terrain_')) return 'terrain';
  if (n.startsWith('grass')) return 'grass';
  if (n.startsWith('flowers')) return 'flowers';
  if (n.startsWith('props:')) return n.replace(/:\d+$/, '');
  if (n === 'water') return 'water';
  if (o.material?.name === 'GRASky') return 'sky';
  if (o.isSkinnedMesh) return 'character';
  return o.material?.name || o.type;
}

/** GPU ms per category and pass (per-draw queries add overhead; compare categories, not the sum). */
export async function gpuProfile(frames = 60) {
  const a = app();
  const gl = a.r.renderer.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (!ext) return 'EXT_disjoint_timer_query_webgl2 not available';
  a.r.renderer.setAnimationLoop(null);
  const pending = [];
  let open = null;
  const begin = (label) => {
    const q = gl.createQuery();
    gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    open = { q, label };
  };
  const end = () => {
    if (!open) return;
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    pending.push(open);
    open = null;
  };
  const objects = [];
  a.r.scene.traverse((o) => {
    if (o.isMesh || o.isPoints || o.isLine) objects.push(o);
  });
  const saved = objects.map((o) => [o, o.onBeforeRender, o.onAfterRender, o.onBeforeShadow, o.onAfterShadow]);
  for (const o of objects) {
    const c = category(o);
    o.onBeforeRender = () => begin(`main/${c}`);
    o.onAfterRender = end;
    o.onBeforeShadow = () => begin(`shadow/${c}`);
    o.onAfterShadow = end;
  }
  const sums = {};
  const draws = {};
  const px = new Uint8Array(4);
  const collect = () => {
    for (let k = pending.length - 1; k >= 0; k--) {
      const p = pending[k];
      if (!gl.getQueryParameter(p.q, gl.QUERY_RESULT_AVAILABLE)) continue;
      sums[p.label] = (sums[p.label] || 0) + gl.getQueryParameter(p.q, gl.QUERY_RESULT);
      draws[p.label] = (draws[p.label] || 0) + 1;
      gl.deleteQuery(p.q);
      pending.splice(k, 1);
    }
  };
  try {
    for (let i = 0; i < frames; i++) {
      clock += 1000 / 144;
      a.frame(clock);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      await yieldTask();
      await yieldTask();
      collect();
    }
  } finally {
    for (const [o, b, af, bs, as] of saved) Object.assign(o, { onBeforeRender: b, onAfterRender: af, onBeforeShadow: bs, onAfterShadow: as });
  }
  // Whole-frame GPU time without per-draw queries.
  const whole = [];
  const qs = [];
  for (let i = 0; i < frames; i++) {
    clock += 1000 / 144;
    const q = gl.createQuery();
    gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    a.frame(clock);
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    qs.push(q);
    await yieldTask();
  }
  await new Promise((r) => requestAnimationFrame(() => r()));
  await yieldTask();
  for (const q of qs) {
    if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) whole.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
    gl.deleteQuery(q);
  }
  const rows = Object.entries(sums)
    .map(([k, ns]) => [k, +(ns / 1e6 / frames).toFixed(3), Math.round(draws[k] / frames)])
    .sort((x, y) => y[1] - x[1]);
  return { gpuFrameMed: whole.length ? quantile(whole, 0.5) : null, gpuFrameP95: whole.length ? quantile(whole, 0.95) : null, rows };
}
