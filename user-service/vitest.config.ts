import { defineConfig } from 'vitest/config';

// Integration tests: need the docker compose stack running (Keycloak on :8080, users-db on :5433).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
