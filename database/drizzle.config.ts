import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit configuration.
 *
 * Lives in `database/` because that is where the schema and the migrations do:
 * `database/schema` is a workspace package, so the API and the migration tooling
 * read exactly the same tables. `DATABASE_URL` comes from the environment and is
 * never committed.
 */
export default defineConfig({
  schema: './schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  verbose: true,
  strict: true,
});
