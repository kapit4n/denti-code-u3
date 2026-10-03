# ADR 0016 — Patient name search folds accents explicitly

- Status: Accepted
- Date: 2026-10-03
- Decides: how a patient's name is matched and sorted, given a `C`-collated database

## Context

Patients are found by typing a name. The local database is created with
`POSTGRES_INITDB_ARGS: '--locale=C --encoding=UTF8'` so that a developer's container
and a production server sort and compare identically regardless of the host's
locale — a deliberate choice, because a clinic whose patient list reorders itself
depending on whose machine ran the query is not acceptable.

`C` collation has two consequences that are unacceptable for a Spanish-speaking
clinic:

- `lower()` folds only ASCII, so `lower('ÑUÑEZ')` is still `ÑUÑEZ`. A search for
  `Ñuñez` matched nothing at all.
- `ORDER BY last_name` sorts by byte value, so `Ñuñez` was listed _after_
  `Patient`. A receptionist scanning for a N-name patient would not find one.

The obvious fix is to give the database a real locale (`es_ES.UTF-8`,
`en_US.UTF-8`). That was rejected: `lc_collate` is fixed when the cluster is
initialised, so it cannot be changed on an existing database, and it makes the
sort order depend on the server rather than on the application.

## Decision

**Fold both sides of every name comparison in SQL, and do not rely on the server
locale.**

1. Stored columns are compared as `lower(translate(column, <accented>, <plain>))`.
2. A search term is folded the same way in JavaScript, using `NFD` normalisation
   plus diacritic removal, before it is sent.
3. Sorting uses the same folded expression, so search order and list order agree.

Both sides must be folded. Folding only the term is how `Ñuñez` stops matching
`nunez`; folding only the column is how `ÑUÑEZ` stops matching `ñuñez`.

`translate()` is preferred over PostgreSQL's `unaccent()` because it is
`IMMUTABLE` (so the predicate can later become an index expression), needs no
`CREATE EXTENSION` (no deployment privilege or extension-version coupling), and is
one line of SQL. The cost is a fixed character list, which is checked against a
Spanish-language test case rather than assumed.

## Consequences

- Name search works the same on every deployment, whatever the server locale.
- The accent list in `patient-repository.ts` is duplicated in SQL and in
  `foldAccents()`. They must stay in step, and a new accented character is a
  one-line change plus a test.
- Searching `n` does not match `ñ`; searching `ñ` does match `n`. That asymmetry is
  deliberate — the unaccented form is what people type.

## Alternatives rejected

- **Locale-aware database cluster.** Correct, but not changeable after
  initialisation, and it makes results depend on server configuration.
- **`unaccent()`.** Requires `CREATE EXTENSION`, is `STABLE` rather than
  `IMMUTABLE`, and couples the deployment to extension availability.
- **Case-insensitive search only, accents left exact.** Fails the common case: a
  user typing without an accent finds nothing, and reads as "the patient is not in
  our system" rather than as "the search was too strict".
