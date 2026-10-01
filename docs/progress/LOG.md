# SESSION LOG — Denti-Code U3

Newest last. One entry per work session. Keep entries short and factual:
what changed, what was verified, what is still broken.

---

## Session 1 — Architecture kickoff

**Started from:** empty repo (only a stub `package-lock.json` with no deps).

**Environment findings**

- Node v22.23.2, npm 10.9.8, git 2.40.1, cargo 1.97.1, Docker 29.8.0 running.
- `pnpm` was not installed; installed `pnpm@10` with
  `npm i -g pnpm@10 --prefix "$HOME/.local"` and added `$HOME/.local/bin` to PATH.
- `psql` client is NOT installed locally — DB access happens through Docker /
  the Drizzle driver, not the CLI.
- An unrelated container `denti-rabbitmq` is running. Do not touch it.

**Work performed**

- Created `AGENTS.md` (durable working agreement) and `docs/progress/` state
  files so a future session can resume without re-reading the whole prompt.
- Created `docs/progress/BRIEF.md` (condensed copy of the original brief).

**Verification** — see `docs/progress/LOG.md` end-of-session summary.

---

## Session 2 — Milestone 1 implemented and verified

**Environment findings**

- Port `3000` is occupied by an unrelated local Next.js app
  (`Denti-Code Assistant`). Denti-Code U3 therefore uses API port `3010`;
  `.env`, `.env.example`, the Zod defaults and `VITE_API_URL` were changed
  together.
- PostgreSQL 17 started via `docker compose` as `denti-code-u3-postgres` on host
  port `5433` (dev database `denti_code_u3` and test database `denti_code_u3_test`).
  The unrelated `denti-rabbitmq` container was left untouched.
- `psql` is still not installed; all DB work went through the Drizzle driver and
  `docker exec`.

**Work performed**

- Workspace: `pnpm-lock.yaml`, `turbo.json`, ESLint flat config, Prettier,
  `.env.example`, `docker-compose.yml`, shared `packages/config` entry points and
  `packages/tsconfig` presets.
- `packages/types`, `packages/domain` (81 tests), `packages/validation` (28 tests).
- `packages/api-client`: `ApiClient` over injected `fetch`, error envelope
  handling, Zod response validation, query serialisation, timeouts/aborts —
  14 tests.
- `packages/app`: `AppRoot`, `PlatformProvider` + platform capability contract,
  TanStack Router generation against a shared routes directory, Tailwind v4
  `@theme` design tokens.
- `packages/ui`: `cn`, `StatusTone`/`toneForStatus`.
- `apps/api`: validated env config, redacting structured logger, CORS plugin,
  global error handler with a single problem envelope, `/health` and `/ready`,
  `onClose` database drain, injected clock and id generator, 12 tests.
- `database`: 23-table Drizzle schema across the clinical, scheduling, treatment,
  billing and inventory areas; migration + seed tooling; generated base migration
  `0000_panoramic_lord_tyger.sql`; custom migration
  `0001_appointment_overlap_guard.sql` adding `btree_gist`, a trigger that
  maintains `appointments.ends_at`, and GiST exclusion constraints for dentist,
  chair and room.
- Rewrote `scripts/check-boundaries.mjs` to walk the real import graph and also
  reject database drivers outside the API and route files inside deployment
  shells; wired it into `pnpm run lint`.

**Problems found and fixed during verification**

- `Cannot find name 'URL'` in `packages/validation/src/env/index.ts`: the package
  has no DOM or Node globals in its TS lib, so `new URL()` was replaced with an
  explicit scheme regex (also strips trailing slashes consistently).
- `eslint-plugin-react@7.37.5` crashed on ESLint 10. Pinned ESLint to `9.39.1`,
  which removes both the crash and the peer-dependency warning.
- `DentiApiServer` was declared as `interface extends FastifyInstance` with an
  extra `shutdown` method; that widened type did not survive assignment because
  Fastify's instance type is already thenable. Removed the redundant method —
  the `onClose` hook drains the pool, so `server.close()` is the whole shutdown.
- `no-unused-vars` in `apps/api/test/config.test.ts`: replaced the destructured
  `omit` with an explicit `undefined` value so the intent is still visible.

**Verification**

| Command                     | Result                                                     |
| --------------------------- | ---------------------------------------------------------- |
| `pnpm run typecheck`        | 12/12 tasks pass                                           |
| `pnpm run lint`             | 12/12 tasks pass, `BOUNDARY GUARD OK`                      |
| `pnpm run format:check`     | clean                                                      |
| `pnpm run test`             | 142 tests pass (integration tests skipped, run separately) |
| `pnpm run test:integration` | 4/4 pass against PostgreSQL                                |
| `pnpm run build`            | 5/5 tasks pass (web + desktop + libs)                      |
| API boot                    | `/health` ok, `/ready` ok, 404 returns the error envelope  |
| `pnpm run db:migrate`       | 2 migrations applied                                       |

**Still open**

- Native Tauri build not run (needs WebKitGTK system libraries on Linux).
- `design-mockup/dashboard-design.png` not analysed; the provisional palette in
  `packages/app/src/styles/globals.css` needs confirmation.
- `AppRoot` is not yet mounted through the generated route tree; TanStack Router,
  Query and the shadcn/ui primitives belong to Milestone 2.

---

## Session 3 — The scheduling invariant, reconciled with the schema

**Starting point** — Milestone 1 was verified green, but the report carried one
open question: migration `0001` added a physical `appointments.ends_at` column
that no schema file declared. That was not cosmetic. `drizzle-kit push` reads the
live table, finds an undeclared column, and offers to drop it.

**Work performed**

- Probed Drizzle's API for a way to declare the column without making the
  application write it. The only mechanism is `generatedAlwaysAs`, and Drizzle Kit
  then emits `GENERATED ALWAYS AS`, which PostgreSQL rejects here for the original
  reason. So the column could not be honestly declared.
- Tested the alternative against the running database: an `IMMUTABLE`
  `language sql` function called from the exclusion constraints' index
  expression. Verified with `pg_get_expr` that PostgreSQL stores a _call_ rather
  than inlining the STABLE `+` operator, so the DDL is accepted and the constraint
  still rejects overlaps.
- Replaced the trigger and the column with `appointment_ends_at(timestamptz, int)`.
  Three exclusion constraints (dentist, chair, room) now derive the range from the
  row's own columns. ADR 0012 records the decision and why each alternative fails.
- Exported `appointmentEndsAtSql` from `database/schema/appointment.ts` so queries
  cannot hand-roll the arithmetic and drift from the constraint.
- Regenerated the migration chain as a clean baseline:
  `0000_baseline.sql` plus one custom `0001_appointment_overlap_guard.sql`.
- Added a test proving a reschedule is re-checked: moving an appointment into an
  occupied slot is rejected and the row does not move.
- Added Vitest `globalSetup` that creates `TEST_DATABASE_URL` when missing.

**Problems found and fixed during verification**

- `ALTER TABLE appointments DROP TRIGGER IF EXISTS` is a syntax error:
  PostgreSQL has no `IF EXISTS` form for the `ALTER TABLE` variant of
  `DROP TRIGGER`. Only the standalone `DROP TRIGGER ... ON table` accepts it.
  Found by the database, not by reading.
- The first version of the reschedule test moved an appointment into _empty_
  time, so it passed for the wrong reason once written properly. It now creates a
  real collision.
- `references(..., { name })` is ignored by Drizzle Kit — it always derives the
  name from table and column. The explicit name was removed because keeping it
  would claim a fix the tool never applied. The resulting 63-character truncation
  of one FK name is left alone: nothing reads it, and Drizzle's diff ignores
  constraint names.
- `docker compose down -v` destroyed the integration database, turning a missing
  setup step into a "database does not exist" failure. Fixed by `globalSetup`.

**Verification**

| Check                       | Result                                             |
| --------------------------- | -------------------------------------------------- |
| `pnpm run db:migrate`       | 2 migrations from scratch, no errors               |
| `drizzle-kit generate`      | "No schema changes, nothing to migrate" — no drift |
| `pnpm run test:integration` | 5/5, database auto-created after the volume wipe   |
| `pnpm run typecheck`        | 12/12                                              |
| `pnpm run lint`             | 12/12, `BOUNDARY GUARD OK`                         |
| `pnpm run test`             | 142 pass                                           |
| `pnpm run build`            | 5/5                                                |
| `pnpm run format:check`     | clean                                              |

**Still open**

- Native Tauri build not run (needs WebKitGTK system libraries on Linux).
- `design-mockup/dashboard-design.png` still not analysed.
- Repository shape for enforcing `clinic_id` is a Milestone 2 decision.
