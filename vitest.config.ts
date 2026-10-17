import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
    // The two-client integration suite measures real-time smoothness; parallel CPU-heavy files (world generation)
    // made its jitter thresholds flaky. Files run one after another; total time is dominated by that suite anyway.
    fileParallelism: false,
    testTimeout: 20000,
  },
});
