/**
 * Dev server for repeatable GPU/CPU benchmarks (see docs/performance/BUDGETS.md): the client's own Vite config without
 * HMR, so edits saved by other work never reload the page in the middle of a measurement. Reload by hand to pick
 * changes up. Launch config `graao-client-bench` in .claude/launch.json.
 */
import base from '../../apps/client/vite.config.ts';

export default {
  ...base,
  server: { ...base.server, port: 5176, strictPort: false, hmr: false },
};
