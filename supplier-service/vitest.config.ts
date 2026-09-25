import { defineConfig } from 'vitest/config';

// Integration tests: need the docker compose stack running (Keycloak :8080, user-service :3001, suppliers-db :5434).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
