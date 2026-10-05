/**
 * Folding accents, identically in SQL and in JavaScript.
 *
 * One module for both halves, because the two halves are useless apart and
 * dangerous separated: a query that folds a stored name but not the term typed
 * against it stops matching, and a sort that folds the search but not the column
 * produces an order nobody asked for. The pair lived inside the patient repository
 * when only the patient list needed it; the dentist and chair lists sort by name in
 * the same way, and a second copy of the accent table is a second thing to forget to
 * update.
 *
 * **Why folding is needed at all.** The database is created with `--locale=C`, so
 * PostgreSQL sorts by byte value and compares bytes: `Ñuñez` sorts *after*
 * `Patient`, and `lower()` folds only ASCII, so `lower('ÑUÑEZ')` is still `ÑUÑEZ`
 * and a search for `Ñuñez` matches nothing. Both are unacceptable for a clinic that
 * looks its records up by name, so both sides are folded explicitly rather than
 * trusting the server.
 *
 * The alternative is `unaccent()`, which needs `CREATE EXTENSION` — a privilege and
 * a deployment step — for the same result, and is `STABLE` rather than `IMMUTABLE`,
 * so it cannot be used in an index expression. `translate()` is immutable, built in,
 * and one line.
 */

import { sql, type Column, type SQL } from 'drizzle-orm';

/**
 * The Spanish/Portuguese/French/German accented letters this clinic actually sees,
 * and their unaccented equivalents.
 *
 * The two strings are the *same length by necessity*: `translate()` raises
 * `arguments to translate must be equal length` otherwise, so a mistyped pair fails
 * loudly — but only when a query runs, which in practice means in production.
 * `fold-accents.test.ts` is the guard that fails at `pnpm run test` instead.
 */
const ACCENTED = 'áàäâãéèëêíìïîóòöôõúùüûñçýÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇÝ';
const UNACCENTED = 'aaaaaeeeeiiiiooooouuuuncyAAAAAEEEEIIIIOOOOOUUUUNCY';

/**
 * `lower(translate(column, ...))` — the SQL twin of `foldAccents`.
 *
 * Takes a column or an expression, so it can fold a bare column in an `ORDER BY`
 * or a computed one inside a `WHERE`.
 */
export function foldable(column: SQL | Column): SQL {
  return sql`lower(translate(${column}, ${ACCENTED}, ${UNACCENTED}))`;
}

/**
 * The same folding in JavaScript, for a term typed on a keyboard.
 *
 * `NFD` splits `ñ` into `n` + a combining tilde and `á` into `a` + a combining
 * accent, so removing the marks folds precomposed and decomposed input alike. The
 * lowercase comes after the fold, not before, because the uppercase accented letters
 * are in `ACCENTED` and lowercasing first would leave some of them untouched.
 */
export function foldAccents(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}
