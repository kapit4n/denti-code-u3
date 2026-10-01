import { defineConfig } from 'vitest/config';

/**
 * Integration tests talk to a real PostgreSQL instance.
 *
 * They are separate from the unit suite because they need `TEST_DATABASE_URL`
 * and a migrated database; `pnpm run test` must stay runnable with no database
 * at all. See docs/testing.md.
 */
export default defineConfig({
  test: {
    name: 'api-integration',
    environment: 'node',
    include: ['test/**/*.integration.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    // Integration tests share one database; running them in parallel would let
    // one test's inserts invalidate another's expectations.
    fileParallelism: false,
    // Creates TEST_DATABASE_URL if it is missing, so a wiped Docker volume is a
    // one-command recovery instead of a "database does not exist" failure.
    globalSetup: ['test/global-setup.ts'],
  },
});
