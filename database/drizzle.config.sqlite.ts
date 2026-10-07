import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit configuration — SQLite (ADR 0025).
 *
 * The twin of `drizzle.config.ts`, pointed at the second schema tree and a
 * second migration directory. The two are kept separate on purpose: a single
 * `out:` would mix two dialects in one journal, and the whole point of the two
 * trees is that each engine's DDL is generated and reviewed on its own.
 *
 * `generate` never opens a connection, so `dbCredentials` is only here for
 * `drizzle-kit studio`.
 */
export default defineConfig({
  schema: './schema/sqlite/index.ts',
  out: './migrations-sqlite',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? './local.db',
  },
  verbose: true,
  strict: true,
});
