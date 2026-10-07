/**
 * SQLite has no enum type, so the value list a PostgreSQL `pgEnum` would carry
 * has to live somewhere — otherwise `status = 'WHO_KNOWS'` is a legal row on
 * one engine and a rejected one on the other, and the two engines are supposed
 * to disagree only about how they store a value, never about what is a value
 * (ADR 0025).
 *
 * The answer is the same one PostgreSQL itself gives: a `CHECK` on the column.
 * The list is not repeated here — it comes from `@denti-code-u3/domain`, so the
 * type in TypeScript and the constraint in the database are the same list read
 * from the same place, and adding a status in one pull request adds it in both.
 *
 * The predicate is built with `sql.raw` rather than as a parameter. A bound
 * parameter in a `CHECK` would have to be bound when `CREATE TABLE` runs and
 * stored as a literal anyway, and SQLite is not obliged to agree to that; the
 * value list is a fixed, quoted literal in the DDL, exactly as `pgEnum` writes
 * it.
 */

import { sql } from 'drizzle-orm';
import type { CheckBuilder } from 'drizzle-orm/sqlite-core';
import { check } from 'drizzle-orm/sqlite-core';

export function enumCheck(
  /** Snake-case name, e.g. `appointments_status_in_values`. */
  name: string,
  /** Database column name — unqualified, because a CHECK is scoped to one table. */
  column: string,
  values: readonly string[],
): CheckBuilder {
  const list = values.map((value) => `'${value.replace(/'/g, "''")}'`).join(', ');
  return check(name, sql.raw(`"${column}" in (${list})`));
}
