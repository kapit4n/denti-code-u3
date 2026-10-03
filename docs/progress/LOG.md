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

---

## Session 4 — Milestone 2, step 1: routing, query client, API client

**Goal.** Make the shared application a real routed app and reduce both shells to a
single call, so that no future feature has a reason to touch `apps/web` or
`apps/desktop`.

**Done**

- `packages/app/src/mount.tsx` — one entry point. Builds the query client, reads
  the API base URL, resolves capabilities and renders
  `StrictMode → QueryClientProvider → ApiClientProvider → RouterProvider`.
- `packages/app/src/router.tsx` — router factory. Chooses browser history for web
  and memory history for desktop; a Tauri window has no URL to restore.
- `packages/app/src/routes/__root.tsx` — real root route; the application frame
  renders here once, so no feature route repeats it.
- `packages/app/src/routes/index.tsx` — one proof route, rendered through the
  generated tree.
- `packages/app/src/query/api-client-provider.tsx` — `ApiClient` in context rather
  than a module singleton, so a test can inject a stubbed client and the desktop
  build can point at a different backend. Memoised, because an unmemoised client
  gets a new identity every render and invalidates every consumer.
- `apps/{web,desktop}/src/main.tsx` — reduced to `mountApp({ target })`.
- `@tanstack/router-plugin` added to both shell Vite configs and to the app's
  Vitest config, so the route tree is generated on dev start, test and build.

**Three defects the browser suite found that unit tests could not**

1. **The desktop app rendered `Web` in its runtime badge.** The shell passed
   `target: 'desktop'` and no capabilities; `mountApp` forwarded
   `{ capabilities: undefined }`; `createRouter` accepted that present-but-empty
   object; `AppRoot` fell back to the web defaults. Fixed at the single point that
   can decide — `createAppRouter` fills capabilities from the target, `mountApp`
   omits the context entirely when the shell supplies nothing, and
   `RootRouteContext.capabilities` is now required so no consumer needs a fallback.
   Also switched to `createRootRouteWithContext<RootRouteContext>()`, because the
   plain constructor made the generated tree infer the context as `{}` and the type
   system disagreed with the runtime.
2. **`VITE_API_URL` was silently `undefined`.** Vite resolves `.env` against its own
   root (`apps/web`), but the documented `.env` is at the monorepo root. The app
   threw on startup; every unit test passed because tests supply `apiBaseUrl`
   explicitly. Fixed with `envDir` in both shells.
3. **A fresh clone failed typecheck.** `routeTree.gen.ts` was gitignored, and
   `tsc` runs with no Vite plugin in the process. The file is now committed;
   generation is deterministic, so a stale copy shows up as a diff. It stays in
   `.prettierignore`.

Also corrected the API base URL contract: `.env` carries an origin
(`http://localhost:3010`), not a versioned path. The API has no `/api/v1` prefix
yet — `apps/api/src/app.ts` says so explicitly — so the comments promising one were
wrong.

**Tests added**

- `packages/app/src/mount.test.tsx` — the mount contract: supplied container,
  `#root` default, missing-mount-point error, exactly one frame, and the
  target-specific env lookup.
- `packages/app/src/query/api-client-provider.test.tsx` — injected client wins,
  identity is stable across re-renders, a new client only when the base URL
  changes, and a clear error outside a provider.
- `packages/app/src/router.test.tsx` — target-specific history, capability
  defaulting and injection.
- `e2e/web/smoke.spec.ts` — real browser: the route tree mounts, the frame renders
  once, design tokens resolve to hex values, and the console is clean.
- `packages/tsconfig/e2e.json` — `page.evaluate` bodies are compiled into strings
  and run in the browser, so e2e specs need DOM libs alongside node types.

Recorded in `docs/decisions/0013-shells-declare-a-target-the-app-owns-the-rest.md`.

**Verification**

| Check                       | Result                                                             |
| --------------------------- | ------------------------------------------------------------------ |
| `pnpm run typecheck`        | 12/12                                                              |
| `pnpm run lint`             | 12/12, `BOUNDARY GUARD OK`                                         |
| `pnpm run test`             | 165 pass (domain 81, validation 28, api-client 14, api 12, app 30) |
| `pnpm run test:integration` | 5/5 against PostgreSQL 17                                          |
| `pnpm run build`            | 5/5                                                                |
| `pnpm run format:check`     | clean                                                              |
| `pnpm run test:e2e`         | 5/5 in headless Chromium                                           |
| Web dev server `:5173`      | route mounts, badge `Web`, console clean                           |
| Desktop Vite `:5174`        | route mounts, badge `Desktop`, console clean                       |

**Still open**

- Native Tauri build not run (needs WebKitGTK system libraries on Linux).
- `design-mockup/dashboard-design.png` still not analysed — now the top item, since
  every feature inherits the tokens it defines.
- The desktop shell declares `hasNativeShell: true` but has no native
  implementations; `saveFile` rejects. Nothing consumes it yet.

---

## Sessions 7–8 — Dashboard (M3) and patients (M4)

**What changed**

- Dashboard read model and endpoints: today's appointments with patient names,
  status grouping, revenue from `payments.amount_minor`, active patients, pending
  treatment items, occupancy derived from real operating hours × active dentists,
  and a calendar aggregation. `appointments` has no `total` column, so revenue
  cannot come from the agenda.
- Dashboard widgets in the shared app: stat cards, today's appointments, calendar
  preview, recent patients, upcoming visits, quick actions.
- Patient read side: searchable paginated list, global search, and a
  single-request profile (allergies, next appointment, recent visits, outstanding
  treatments, balance), plus the odontogram endpoint.
- `pnpm run db:seed` now creates a clinic at a fixed UUID matching `CLINIC_ID`,
  with operating hours, dentists, patients, appointments, a visit, an accepted
  treatment plan, charges and a partial payment.
- `CLINIC_ID` is required and validated as a UUID; the API refuses to boot
  without it rather than serving an arbitrary clinic.
- New: `apps/api/src/application/clinic-time-window.ts` (clinic-local day, month
  and weekday boundaries) and `formatMinorUnits` in the domain.

**Defects found by running the app** — all six produced plausible output rather
than an error, which is why review missed them:

1. Outstanding treatments were filtered by clinic but **not by patient**, so a
   profile showed the whole clinic's plans. Data-privacy bug.
2. `const [[row], [rows]] = await Promise.all([...])` binds a collection to its
   _first row_, and an empty result destructures to `undefined` rather than `[]`.
   `recentVisits`/`outstandingTreatments` arrived as single objects, then
   vanished entirely when empty, crashing the client on `.length`.
3. The dashboard drew "today" at UTC midnight — wrong day for six hours a day for
   any clinic not on UTC.
4. `VITE_API_URL` omitted `/api/v1`; `ApiClient` concatenates paths verbatim, so
   every API call 404ed while the shell still rendered.
5. `/patients/:id` rendered the patient list, because `patients.tsx` had no
   `<Outlet />`. The profile is now a flat sibling route.
6. The header search box was dead UI on local state; the working
   `GlobalPatientSearch` was never mounted.

**Verification**

| Check                       | Result                                                           |
| --------------------------- | ---------------------------------------------------------------- |
| `pnpm run typecheck`        | 12/12                                                            |
| `pnpm run lint`             | 12/12, `BOUNDARY GUARD OK`                                       |
| `pnpm run format:check`     | clean                                                            |
| `pnpm run test`             | 12/12 (domain 90, validation 28, api-client 14, api 23, app 30)  |
| `pnpm run test:integration` | 10/10 against PostgreSQL 17                                      |
| `pnpm run db:seed`          | idempotent; clinic id matches `.env.example`                     |
| API boot                    | all 5 dashboard + 3 patient routes return 200                    |
| Browser (`:5173`)           | dashboard, list, both profiles, global search; no console errors |
| `pnpm run build`            | **not run** — deferred at the user's request                     |
| `pnpm run test:e2e`         | **not run** — pages verified by hand instead                     |

The regression test for defect 1 was confirmed to fail when the fix is reverted,
and it drives the real route through Fastify `inject`: an earlier version
re-implemented the query in SQL and would have kept passing while the route
leaked data. `pnpm run build` and `pnpm run test:e2e` were deferred during the
work at the user's request and run at the end of the session; both are green.

**Still open**

- Patient registration (create/edit) does not exist; "New Patient" is disabled.
- Dashboard quick actions navigate nowhere — they need the M5 forms.

---

## Session 9 — Committed e2e specs for the dashboard and patients

**Goal:** close the last open Milestone 3 item — the browser verification was a
throwaway script, and the shell-only e2e suite is precisely why six defects
reached production while every other check stayed green.

**Added**

- `e2e/web/dashboard.spec.ts` — 9 specs. Metrics match the payload verbatim;
  `occupancyRate: null` renders as an em dash and is never shown as `0%`; a
  failed metric shows no number at all; unknown endpoints, empty panels and
  console errors are covered.
- `e2e/web/patients.spec.ts` — 10 specs. List rows, inactive marker, debounced
  search reaching the server with no `q=` on first load, list error and empty
  states, the full profile, empty collections, credit labelling, 404, and header
  search navigation.
- `e2e/web/fixtures/api-responses.ts` — fixtures frozen from real responses, with
  values deliberately unlike the seed data (3 appointments, 2 active patients,
  65.00 USD) so an assertion cannot pass by coincidence.
- `e2e/web/fixtures/mock-api.ts` — one handler for all of `/api`, dispatching on
  exact pathname and answering 501 for anything unrecognised.

**Two production changes, both small and both earned**

- `StatCard`'s error branch had no `data-testid`, so the error state was
  unreachable by any locator. Added `stat-card-error-<title>` alongside the
  existing value and skeleton ids.
- `CardTitle` rendered a `<div>`, so none of the eleven card titles in the app
  were headings — a screen reader heard a dashboard of unlabelled regions whose
  only heading was the "Good morning" greeting. Now an `<h3>`. Found because a
  spec could not address a panel by name, which is the same problem a
  screen-reader user has.

**Three mistakes worth recording, because all three produced a green run**

1. A per-endpoint glob (`**/api/v1/patients`) does not match the same path with a
   query string, so the mock missed every real request — and the specs still
   passed, because a dev API was running on port 3010 and answered them. A spec
   that quietly talks to a live database is not a spec. Fixed by dispatching on
   `url.pathname` in a single handler.
2. `Fixture` had `body?: unknown`, so _any_ object satisfied it. Passing a bare
   payload where a fixture belongs typechecked and then served `{}`, which
   surfaced as an error-boundary crash 15 minutes away from the cause. `body` is
   now required, and Playwright not typechecking is the reason that matters.
3. `expect(page.getByText('Ana García'))` resolved to two elements — the
   appointments panel and Recent Patients — so the panel assertion passed with
   the panel empty. Panels are now scoped to their own card.

**Verification**

| Command                     | Result                   |
| --------------------------- | ------------------------ |
| `pnpm run typecheck`        | 12/12                    |
| `pnpm run lint`             | 12/12, boundary guard OK |
| `pnpm run format:check`     | clean                    |
| `pnpm run test`             | 12/12                    |
| `pnpm run test:integration` | 10/10                    |
| `pnpm run build`            | 5/5                      |
| `pnpm run test:e2e`         | 24/24 (5 shell + 19 new) |

Every new spec was checked by reintroducing the defect it guards: dropping
`/api/v1` from the base URL fails 7 of 9 dashboard specs; removing an empty
collection's key fails the crash spec with the original
`Cannot read properties of undefined (reading 'length')`; unmounting the header
search fails both search specs; removing the "Credit" label fails the balance
spec. A spec nobody has seen fail is a guess.

**Still open**

- Patient registration (create/edit) does not exist; "New Patient" is disabled.
- Dashboard quick actions navigate nowhere — they need the M5 forms.
- The dashboard's `<h1>` is a time-of-day greeting rather than the page name.
  Not fixed: it is a product copy decision, and the specs no longer depend on it.
- The dashboard has no page-level landmark or heading for its title, and the
  appointment times are labelled "this device's timezone" while the API decides
  "today" in the clinic's timezone. Worth a decision at Milestone 5.

---

## Session 10 — patient registration

Started with the record number rather than the form, because that is the part
with a correctness requirement rather than a layout.

**Record numbers.** Per clinic, sequential, zero-padded to six digits:
`P-000001`, `P-000002`, … A client never chooses one. The first shape of the port
was `save(patient, { recordNumber })` plus `nextRecordNumber(clinicId)`, and it
was wrong: a caller can drive those two calls separately, and no lock spans them.
Reduced to one `register(patient)` method that owns the transaction, with a
transaction-scoped advisory lock keyed on the clinic, so registrations for
different clinics never block each other and PostgreSQL releases the lock even if
the request dies.

It is also narrower than `PatientRepository` on purpose. The read endpoints predate
the repository layer and still query Drizzle in their handlers; implementing
`search` and `findById` now would have added two methods nothing calls — dead code
pretending to be structure. Reads move across when they are next touched.

**Defects found by testing rather than by reading**

1. The concurrency test passed against code with no lock in it. The connection
   pool was `max: 1`, so the driver serialised the transactions and the race could
   not happen. Widened the pool; now removing the lock fails 3 of 5 simultaneous
   registrations. A test that cannot fail is worse than no test, because it is
   taken as evidence.
2. The collision fallback was dead code. `(error as { code }).code` is `undefined`
   for every real database failure: Drizzle rethrows driver errors wrapped in its
   own `DrizzleQueryError` with the original moved to `cause`. A duplicate would
   have surfaced as a 500. Now unwraps the cause chain, with a unit test built
   from the _wrapped_ shape — the obvious implementation passes a test written
   against a bare `{ code }` and fails in production.
3. An untouched optional input submits `''`, and `''` is not a valid
   `preferredName`: it fails the same `min(1)` that stops a blank name being
   stored. A patient who gave only a name could not have been registered at all.
   Fixed with `createPatientFormSchema`, derived from `createPatientSchema.shape`
   rather than restating the fields, so the form accepts exactly what the API
   accepts; a test asserts the two schemas keep the same keys. `z.preprocess` was
   the first attempt and made the schema's input type `unknown`, which React Hook
   Form cannot infer field values from — hence `z.union`.
4. Zod's default message for a blank name is "Too small: expected string to have
   > =1 characters". That was going to be what a receptionist read. Messages are
   > now written out in the schema.
5. E2E fixtures were keyed by pathname alone, so `GET /patients` and `POST
/patients` collided and a registration spec's POST was answered with the list
   fixture. Fixtures are now keyed by `'/path'` or `'POST /path'`, and requests are
   recorded with their bodies.
6. Enabling the buttons changed their role. `Button asChild` + `Link` renders an
   anchor, so `getByRole('button', …)` found nothing — a correct-looking
   component test would have missed it.

**Deliberate decisions**

- The record number is not shown by redirecting to the chart. It is displayed
  first, with a link to the chart, because the front desk reads the number out and
  writes it on the paper file, and it has to survive long enough to be copied.
- No toast on success. `useToast` in `packages/ui` is still a stub that discards
  everything, and building a second success channel around a stub would be worse
  than the inline confirmation.
- A rejected registration keeps the typed values. Clearing the form would mean
  retyping everything to fix one field.

**Verification**

| Command                     | Result                                                              |
| --------------------------- | ------------------------------------------------------------------- |
| `pnpm run typecheck`        | 12/12                                                               |
| `pnpm run lint`             | 12/12, boundary guard OK                                            |
| `pnpm run format`           | clean                                                               |
| `pnpm run test`             | 233 unit (domain 106, app 43, validation 35, api 35, api-client 14) |
| `pnpm run test:integration` | 22/22                                                               |
| `pnpm run build`            | 5/5                                                                 |
| `pnpm run test:e2e`         | 37/37 (24 + 13 registration)                                        |

New tests: 16 for `registerPatient` and the number sequence, 6 for the form schema
(including the drift guard), 10 for the `isUniqueViolation` cause chain, 11 for the
form through the real providers, 12 integration against PostgreSQL, 13 e2e.
Mutation-checked: removing the advisory lock, unwrapping the wrong error object,
rejecting blank optional fields again, and changing the fixture key back to the
pathname alone.

## Session 11 — patient editing

Completed the write side of Milestone 4. `updatePatient` use case, `PUT
/api/v1/patients/:id`, and the form at `/patients/$patientId/edit`, reached from an
"Edit details" action on the profile.

| Check                       | Result                                                              |
| --------------------------- | ------------------------------------------------------------------- |
| `pnpm run typecheck`        | 12/12                                                               |
| `pnpm run lint`             | 12/12 and `BOUNDARY GUARD OK`                                       |
| `pnpm run format`           | clean                                                               |
| `pnpm run test`             | 260 unit (domain 115, app 57, validation 38, api 35, api-client 15) |
| `pnpm run test:integration` | 35/35                                                               |
| `pnpm run build`            | 5/5                                                                 |
| `pnpm run test:e2e`         | 46/46 (37 + 9 editing)                                              |

New tests: 9 for `updatePatient`, 5 for the edit schema semantics, 13 integration
against PostgreSQL, 14 component, 9 e2e, 1 for `ApiClient.put`.

Mutation-checked, each reverted after confirming the failure:

| Mutation                                          | Caught by           |
| ------------------------------------------------- | ------------------- |
| Drop `clinicId`/`anonymizedAt` from the `WHERE`   | 2 integration tests |
| Make the edit renumber the chart (`P-999999`)     | 3 integration tests |
| Send the edit as `PATCH` instead of `PUT`         | 3 component tests   |
| Skip `editablePatientDetailsFrom` in the use case | 6 domain tests      |

The first attempt at the third one — writing a client-supplied `recordNumber` into
the `SET` list — passed, because the value is stripped before it ever reaches the
repository and so arrives `undefined`. It proved the schema's stripping, not the
guarantee. Renumbering unconditionally is the mutation that actually tests the
claim.

The endpoint is a **PUT carrying the complete editable set**, not a PATCH of the
changed fields. A merge cannot express the case that matters most here — an email
recorded in error — because it can only leave the old value in place. An absent
optional field means "no longer recorded", which is also why `updatePatientSchema`
is the create schema rather than the partial it started as.

Three things worth remembering from this session:

- **Zod strips unknown keys; it does not reject them.** So "an edit must not change
  `isActive` or `recordNumber`" cannot be enforced in the schema. The guarantee
  lives in the write: `EditablePatientDetails` omits them so there is nowhere to
  bind, and the Drizzle `SET` list does not name those columns. Both asserted
  against PostgreSQL.
- **Clinic scope and `anonymized_at` are in the `WHERE` clause**, not in a lookup
  the caller performed first. Another clinic's patient and an anonymised record
  both answer 404, so an id cannot be probed for existence.
- **`??` does not catch an empty string.** `describePatientFailure` used
  `message ?? fallback`, so a server fault with a blank message rendered an empty
  red alert. Now `||`, with a test.

**Still open**

- `PatientRepository.search` / `findById` are still unimplemented on the read side,
  which still query Drizzle in their route handlers.
- Dashboard `<h1>` is a time-of-day greeting rather than the page name.
- No authentication, so `request.clinicId` still comes from `CLINIC_ID`.

---

## Session 12 — the patient read side, behind the repository

**Started from:** `3fbc54d`, patient editing complete on both sides. The three
patient reads were still Drizzle queries written inside the route handlers.

**What changed**

- `PatientSearchCriteria` (speculative, unused) replaced by `PatientSearchQuery`,
  and `PatientRepository` extended with `search`, `findProfile` and
  `findOdontogram`. `patient-write-repository.ts` became `patient-repository.ts`,
  `DrizzlePatientWriteRepository` became `DrizzlePatientRepository`.
- `apps/api/src/http/routes/patients.ts`: 482 → 283 lines, and it no longer
  imports `drizzle-orm`, the schema tables, or the connection handle. Its
  dependencies are `{ patients, ids, clock }` — no `db`.
- **The bug this found.** The odontogram's existence check, written in the handler,
  omitted `anonymized_at is null`. A withdrawn patient's odontogram was served at
  `GET /api/v1/patients/:id/odontogram` while `GET /api/v1/patients/:id` correctly
  answered 404. Tooth-level clinical history for a record the product has withdrawn.
  Fixed by making the check a repository method that every read goes through.
- The profile response was `{ ...patient }`, a spread of the raw row: it published
  `anonymizedAt` and would have published any column added to `patients` later. It
  now returns the named `PatientProfile`.
- `sendProblem` gained an optional operation label for the server log only; the
  client still receives the generic message and a request id.
- Name search folds accents on both sides (ADR 0016). See below.
- Frontend: nine hand-copied response interfaces deleted from
  `use-patients.ts`, replaced by imports from `@denti-code-u3/domain`. This caught a
  live drift — `usePatientOdontogram` expected `{ items }` where the endpoint has
  always returned `{ entries }`, undetected because no screen calls that hook.
- `packages/validation`: deleted `patientSchema`, `patientSummarySchema`,
  `patientProfileSchema`, `patientBalanceSchema`, `paginatedPatientSchema`,
  `paginatedResponseSchema` and four DTO types. All unused, and describing
  `{ data, meta }` + a `fullName` + an `ageInYears` that no endpoint has ever sent.
  Deleted rather than corrected: a second declaration of a response shape is a
  second thing to keep in sync. Zod is now for requests only.

**The collation finding**

The cluster is `POSTGRES_INITDB_ARGS: '--locale=C'`, chosen so a developer's
container and a production server sort identically. `C` sorts by byte value and
`lower()` folds only ASCII, so:

- `ORDER BY last_name` put `Ñuñez` after `Patient` — a N-name was unfindable by
  scrolling;
- a search for `nunez` or `Ñuñez` returned **nothing**.

Both are unacceptable for a clinic that finds patients by typing; the second reads
to a receptionist as "this patient is not in our system". Rejected: making the
cluster locale-aware (fixed at initdb, and moves results into server config) and
`unaccent()` (needs `CREATE EXTENSION`, is `STABLE` not `IMMUTABLE`, so not
indexable). Chosen: `lower(translate(col, <accented>, <plain>))` in SQL and
`NFD` + diacritic stripping in JS, on both sides. ADR 0016.

**Verified**

- `pnpm run typecheck` 12/12, `pnpm run lint` 12/12 + `BOUNDARY GUARD OK`,
  `pnpm run format:check` clean, `pnpm run build` 5/5.
- Unit/component 258 passing (36 validation, 115 domain, 15 api-client, 35 api,
  57 app). Integration 35 → **55** (20 new). E2E 46/46.

**Mutation checks — every one caught**

Each mutation was applied, the suite run, and the file restored byte-identical
(diff confirmed against a pre-mutation copy).

| #   | Mutation                                                      | Result                                                      |
| --- | ------------------------------------------------------------- | ----------------------------------------------------------- |
| 1   | `findOdontogram` existence check drops `isNull(anonymizedAt)` | 1 failed — "does not serve the chart of a withdrawn record" |
| 2   | `findProfile` drops the `clinicId` filter                     | 2 failed                                                    |
| 3   | `search` drops the `clinicId` filter                          | 2 failed                                                    |
| 4   | `search` drops `isNull(anonymizedAt)`                         | 1 failed                                                    |
| 5   | `escapeLikePattern` returns the term unchanged                | 2 failed                                                    |
| 6   | `foldable` folds only via `lower()`, no `translate()`         | 2 failed                                                    |
| 7   | count query counts the clinic instead of the filtered set     | 1 failed                                                    |
| 8   | `onlyActive` ignored                                          | 1 failed                                                    |

Mutation 1 is the one that matters: it is the defect that was actually shipped in
`3fbc54d`, and before this session nothing would have failed.

**Still open**

- `apps/api/src/http/routes/dashboard.ts` still receives `db` directly — the last
  route handing a connection to a handler. Next milestone's job.
- Patient phone is returned by the list endpoint while its column comment says it
  is encrypted and never returned by list endpoints. The two disagree; needs a
  product decision before any external access exists.
- Dashboard `<h1>` is a time-of-day greeting rather than the page name.
- No authentication, so `request.clinicId` still comes from `CLINIC_ID`.

## Session 13 — the agenda read side (Milestone 5, slice 1)

Started by `bff8ff7` (patient read side behind the repository). Scope: the read side
of the clinic's book, and nothing else. The calendar UI and the write side are
deliberately not in it.

### Delivered

| Area           | Change                                                                       |
| -------------- | ---------------------------------------------------------------------------- |
| Domain         | `AgendaEntry`, `AgendaWindow`; `appointmentEndsAt`; `findAgenda` port        |
| Validation     | `agendaRangeQuerySchema` in use; ambiguous `date` alias removed              |
| Infrastructure | `DrizzleAppointmentRepository` (explicit `implements AppointmentRepository`) |
| Transport      | `GET /api/v1/appointments`, 366-day ceiling, problem envelope                |
| Dashboard      | today's book, upcoming visits now read through the repository                |
| Application    | `minutesBookedWithin`, next to `resolveClinicTimeWindow`                     |
| Docs           | ADR 0017, STATE, this log                                                    |

`AppointmentRepository` went from five speculative methods to the one that is
called. Scheduling, overlap and status-transition methods return with the write
slice, where they have a caller.

### Design decisions

- **Overlap, not `starts_at`.** `[starts_at, appointment_ends_at(...))` against
  `[from, to)`, the same half-open interval the exclusion constraints enforce
  (ADR 0017). An appointment in progress at midnight is on today's agenda.
- **Booked minutes are clipped** to the window. Summing `duration_minutes` would let
  an overnight booking report a day as more than fully booked.
- **Cancelled and no-show are returned.** Whether a status _reserves_ a slot is
  `reservesSchedulingSlot`'s question, not the listing's.
- **The dashboard's response shapes are unchanged.** The UI reads `firstName` /
  `lastName`; the agenda returns split names, and the mapping is a deliberate,
  tested boundary rather than a rewrite.
- **`AgendaWindow` lost `patientId`.** No caller — the same speculative surface this
  session removed elsewhere.
- **Dropped `date` from the query schema.** It duplicated `from`/`to` with different
  semantics and had no reader.
- **Deleted `agendaAppointmentSchema` and `AgendaAppointmentDto`.** Unused, and they
  contradicted the endpoint that now exists: a required `dentistName` when the column
  is nullable, and a joined `patientName` the API does not send. `appointmentSchema`
  stays — it is the entity's validation rules, and the write slice is its next reader.

### Test counts

Unit/component **258 → 265** (api 35 → 42; 7 new `minutesBookedWithin` cases).
Integration **55 → 85** (30 new): `agenda.integration.test.ts` (17, repository and
interval semantics against PostgreSQL), `agenda-route.integration.test.ts` (8, the
request: window parsing, clinic scoping, the 366-day ceiling, one instance over
HTTP), `dashboard-book.integration.test.ts` (5, the two dashboard behaviours that
changed). E2E 46/46, unchanged — no UI consumes the new endpoint yet.

### Mutation checks — 15 applied, 15 caught

| #   | Mutation                                                  | Caught by                                       |
| --- | --------------------------------------------------------- | ----------------------------------------------- |
| 1   | repository drops `clinicId`                               | never shows another clinic's booking            |
| 2   | repository drops `isNull(anonymizedAt)`                   | never shows a withdrawn patient                 |
| 3   | overlap → `starts_at` comparison                          | includes an appointment running into the window |
| 4   | half-open → closed window                                 | appointment starting at `to` is excluded        |
| 5   | hides `CANCELLED`                                         | cancelled bookings stay visible                 |
| 6   | left → inner join on dentists                             | booking kept when the dentist has left          |
| 7   | forgets to compute `endsAt`                               | agrees with the database                        |
| 8   | drops the dentist filter                                  | filters by dentist                              |
| 9   | drops the chair filter                                    | filters by chair                                |
| 10  | reads the wrong patient name field                        | names the patient and the dentist               |
| 11  | `appointmentEndsAt` ignores duration                      | computes the end from start and duration        |
| 12  | route accepts an unbounded window                         | rejects a window of more than a year            |
| 13  | route ignores the parsed window                           | returns one entry, not the clinic's whole book  |
| 14  | dashboard charges an overnight booking its whole duration | counts only the minutes inside today            |
| 15  | dashboard offers cancelled work as upcoming               | does not offer a cancelled appointment          |

The harness was wrong before the mutations were: it reported "caught" when the tests
_passed_. Three mutations survived once it was fixed — #9 (every fixture booking was in
the same chair, so the assertion was vacuous), #14 and #15 (nothing covered the
dashboard's two changed behaviours). Each gap is closed above.

### Defects the database found

Two, both in the fixtures rather than the code: a teardown window narrower than the
fixtures left an overnight row behind for the next run to collide with, and the other
clinic's booking referenced this clinic's chair, which the exclusion constraints
reject because a chair belongs to one clinic.

### Still open

- FullCalendar is not installed. `GET /api/v1/appointments` has no consumer until the
  day and week views exist.
- Appointment write side: `CreateAppointment`, `RescheduleAppointment`,
  `TransitionAppointment`, conflict errors to the UI, and the forms that un-disable
  "New Visit" and the profile's next-appointment action.
- `apps/api/src/http/routes/dashboard.ts` still receives `db` for patient counts,
  revenue, treatment-plan items and the calendar preview's per-day aggregate. Only the
  appointment queries moved; those aggregates have no port yet.
- `AgendaEntry` has no `roomId`/`roomName`, though the table and the old DTO both have
  it. Decide before the calendar needs room columns.
- Patient phone is still returned by the list endpoint while its column comment says
  it is encrypted and never returned. Needs a product decision.
- Dashboard `<h1>` is a time-of-day greeting rather than the page name.
- No authentication, so `request.clinicId` still comes from `CLINIC_ID`.

### Verification

```
pnpm run typecheck        12/12 successful
pnpm run lint             12/12 successful + boundary guard OK
                           (1 pre-existing warning: editable-patient-details.ts)
pnpm run format:check     clean
pnpm run build            5/5 successful
pnpm run test             265 unit/component (12/12 tasks)
pnpm run test:integration 85 integration (8 files)
pnpm run test:e2e         46/46 passed
```
