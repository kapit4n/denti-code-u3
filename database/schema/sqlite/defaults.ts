/**
 * Column defaults the SQLite tree shares.
 *
 * SQLite has neither `gen_random_uuid()` nor `now()`, so both are written as
 * SQL expressions here rather than repeated in every table file. They exist for
 * the same reason the PostgreSQL defaults do: a row inserted by a migration, a
 * fixture or a future repository that forgets an id must still get one, and a
 * NULL `created_at` is a row nobody can order.
 *
 * The UUID is v4-shaped — version nibble `4`, variant nibble in `89ab` — because
 * the PostgreSQL column emits a real v4 and anything that later parses both
 * engines' ids should not have to care which one produced it.
 */

import { sql } from 'drizzle-orm';

/** A v4-shaped UUID built from `randomblob`; SQLite has no `gen_random_uuid()`. */
export const uuidDefault = sql`(lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (abs(random()) % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))))`;

/** The current UTC instant in epoch milliseconds — SQLite has no `now()`.
 *
 * The parentheses are not decoration: SQLite's `DEFAULT` grammar accepts a
 * literal, a signed number, a `CURRENT_*` keyword, or **a parenthesised
 * expression** — an unparenthesised function call is a syntax error at
 * `CREATE TABLE` time. Drizzle writes the expression exactly as given here, so
 * `DEFAULT cast(...)` would never parse; `DEFAULT (cast(...))` does.
 */
export const nowDefault = sql`(cast((julianday('now') - 2440587.5) * 86400000 as integer))`;
