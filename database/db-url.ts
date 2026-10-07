/**
 * Reading a `DATABASE_URL` as either engine (ADR 0025).
 *
 * Everything in the monorepo that opens a database reads the engine from the
 * URL scheme: `postgres:` / `postgresql:` is the retained PostgreSQL engine,
 * `sqlite:` / `file:` is the default SQLite engine. This module is where the
 * two dispatching helpers live so `database/migrate.ts`, `database/seed.ts`
 * and `apps/api` agree about what a URL *means* — a path disagreement between
 * "the place migrations were applied" and "the file the API opened" is a bug
 * that shows up as foreign-key failures that do not make a load of sense.
 *
 * **Paths are resolved against the repository root, not the process cwd.** The
 * API, the migrator and the seeder each start in a different directory (their
 * own pnpm workspace), so a relative path resolved against `process.cwd()`
 * would hand each of them a different file. This module lives in `database/`,
 * one directory below the root, so the root is a fixed reference both sides
 * can derive: `database/db-url.ts` resolves `sqlite:./data/denti.db` to the
 * same file whether it is called from `apps/api` or from `pnpm run db:migrate`.
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** `database/` is one directory below the repository root. */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** `true` for the SQLite engine's URL forms; `false` for PostgreSQL. */
export function isSqliteUrl(databaseUrl: string): boolean {
  return /^(sqlite|file):/.test(databaseUrl);
}

/**
 * The file path a `sqlite:`/`file:` URL names.
 *
 * Never called for a `postgres:` URL — callers dispatch on `isSqliteUrl` first.
 *
 * - `:memory:` and `sqlite::memory:` are the in-memory database.
 * - A `file:` URL is always absolute (the URL parser normalises relative
 *   `file:` URLs against the filesystem root), so its `pathname` is the path.
 * - A `sqlite:` URL keeps a relative `pathname` (`sqlite:./data/denti.db`),
 *   which is resolved against the repository root rather than the cwd — see
 *   the module comment above.
 */
export function sqliteDatabasePath(databaseUrl: string): string {
  if (databaseUrl === ':memory:' || databaseUrl === 'sqlite::memory:') {
    return ':memory:';
  }

  const { pathname } = new URL(databaseUrl);
  const decoded = decodeURIComponent(pathname);

  if (decoded === ':memory:') {
    return ':memory:';
  }

  return path.isAbsolute(decoded) ? decoded : path.resolve(repoRoot, decoded);
}
