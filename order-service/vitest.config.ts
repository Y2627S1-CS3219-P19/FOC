// AI-assisted: Claude Code (Opus 5.5), 2026-10-08. Scope: test runner config. Reviewed by <name>.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
