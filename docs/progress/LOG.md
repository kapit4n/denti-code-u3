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

---

## Session 14 — the agenda grid (Milestone 5, slice 2)

Started by `77c6355` (the agenda read side). Scope: the read-only calendar that
consumes it, plus the clinic-settings endpoint it needs. No write side.

### Delivered

| Area         | Change                                                                   |
| ------------ | ------------------------------------------------------------------------ |
| API          | `GET /api/v1/clinic`, `DrizzleClinicRepository`, app wiring              |
| Domain       | `ClinicRepository` trimmed: `updateOperatingHours` removed               |
| App          | `/agenda` route, `AgendaCalendar`, `useAgendaRange`, `useClinicSettings` |
| Adapters     | `to-calendar-event.ts`, `to-business-hours.ts`                           |
| Dependencies | `@fullcalendar/{core,react,daygrid,timegrid,luxon3}@6`, `luxon@3`        |
| Guard        | rule 5 in `scripts/check-boundaries.mjs`                                 |
| Tests        | 50 unit/component, 8 integration, 10 e2e                                 |
| Docs         | ADR 0011 brought in line with reality, roadmap status, STATE, log        |

### Design decisions

- **The timezone is data, not configuration.** It and the opening hours come from
  `GET /api/v1/clinic`. A `VITE_` constant cannot be right for the second clinic
  one API will serve, and FullCalendar's `timeZone: 'local'` is wrong for every
  clinic the moment a receptionist travels.
- **No clinic, no grid.** The route renders an error rather than a calendar in the
  browser's zone; an e2e test asserts no appointments request is made at all.
- **`datesSet` is the fetch window.** The grid knows what it is showing, including a
  month view's leading days. A second implementation of "which days are on screen"
  is the thing that drifts.
- **No `placeholderData`.** Yesterday's events must not appear under today's date.
- **Business hours are a third adapter.** The domain speaks ISO weekdays
  (`1 = Monday … 7 = Sunday`); FullCalendar speaks `Date.getDay()`. Passing the
  number through opens every clinic a day late and still looks plausible.
- **A row that cannot be placed is dropped, not widened.** A `businessHours` entry
  with no `daysOfWeek` means _every day_, so garbage hours would shade the whole
  week — the opposite of the comment above it, which is how it shipped in the first
  draft.
- **Statuses are styling, not domain.** Colour comes from the existing tokens;
  cancelled and no-show are struck through rather than hidden, so a deliberately
  empty slot does not look bookable.
- **Read-only on purpose.** `editable`, `selectable` and `eventClick` are unwired.
  Nothing that looks live and is not.

### Two defects the tests caught

1. The unmappable-weekday bug above: an empty spread read as "every day".
2. The e2e timezone spec asserted an event was _visible_, which its own docstring
   claimed proved the timezone and did not. It now reads the rendered hour;
   pointing the component at `America/New_York` fails it with
   `Received string: "10:00 - 11:00"`.

Also a third, mine: a missing `)` in the first draft of the weekday test, which
every parser in the toolchain rejected while the isolated snippet I was testing
passed — the file, not the snippet, was wrong.

### Still open

- Dentist and chair filters. The API accepts them; no UI sends them.
  `AgendaEntry` has carried `chairId`/`chairName` since session 13 — an earlier note
  here said otherwise. Room columns need a `roomId` the read model does not have.
- `apps/api/src/http/routes/dashboard.ts` still receives `db` for the non-appointment
  aggregates.
- Patient phone is still returned by the list endpoint while its column comment says
  it is encrypted and never returned. Needs a product decision.
- Dashboard `<h1>` is still a time-of-day greeting rather than the page name.
- No authentication, so `request.clinicId` still comes from `CLINIC_ID`.

### Verification

```
pnpm run typecheck        12/12 successful
pnpm run lint             12/12 successful + boundary guard OK
pnpm run format:check     clean
pnpm run build            5/5 successful
pnpm run test             315 unit/component (12/12 tasks)
pnpm run test:integration 93 integration (9 files, real PostgreSQL)
pnpm run test:e2e         56/56 passed
guard:boundaries          OK, and verified by leaking @fullcalendar/core into
                           a query and watching it fail
mutations                 5 adapter mutations, 5 caught
```

---

## Session 15 — Appointment write side

**Delivered** the three use cases and the three endpoints, and made two scheduling
guarantees the database's rather than the application's.

**Domain** (`packages/domain/src/appointment/`)

- `createAppointment`, `rescheduleAppointment`, `transitionAppointmentStatus`, each
  taking injected ports and answering with the `AgendaEntry` the row became.
- `clinicLocalMoment` / `parseLocalTimeMinutes` in `shared/time.ts`, and
  `assertWithinOperatingHours` in `organization/clinic.ts`: a booking must fit _inside_
  one clinic-local day's hours, not merely start on a day the clinic is open.
- `AppointmentWindow` split out of `AgendaWindow`, because the conflict checker must not
  filter by the resource it is about to collide with.
- `AppointmentRepository` gains `findById`, `findEntryById`, `findOverlapping` and
  extends the new `AppointmentWriteRepository` (`insert`, `replaceSchedule`,
  `changeStatus`) — the shape `PatientRepository` already had.

**Schema** — `0002_appointment_tenant_foreign_keys.sql`

- `appointments` now references its patient, dentist, chair and room by `(id,
clinic_id)`, with matching `UNIQUE` constraints on all four tables. A foreign key on
  the id alone proves a row exists and says nothing about whose it is.
- Hand-ordered: the constraints must be added before the keys that point at them, and
  Drizzle emits them the other way round.
- `ON DELETE SET NULL (column)` on the three nullable ones, so a dentist can still
  leave a clinic with appointments behind them.

**API** — three routes, `isExclusionViolation` (23P01) and a `23503` translated to a
422, plus `uuidSchema` on the path parameter.

**Three findings worth keeping**

1. The concurrent-write test is the reason the constraints exist: both requests pass the
   domain's conflict check, because each is right about what it can see. One 201, one
   409, one row.
2. The new tenant constraint refused a fixture in the _existing_ agenda integration
   test — a booking in the other clinic's book with that clinic's patient and chair but
   **this** clinic's dentist. A test fixture committing the exact leak the constraint
   closes is the best evidence the constraint is right.
3. `AgendaEntry` has carried `chairId`/`chairName` since session 13; two docs claimed
   otherwise and are corrected.
4. ADR 0018 claimed no `roomId` on the write side while the create schema accepted one
   and the repository wrote it — a booking could be given a room it could never be
   shown or moved from. Removed from the request; the column, the constraint and the
   entity's field stay, because the entity is a picture of the table. A chair still
   implies its room, so `room_no_overlap` is not dormant.

**Known gap, recorded not hidden:** a lunch break
(`clinic_operating_hours.break_starts_at` / `break_ends_at`) is not enforced. The
columns exist, the domain type does not carry them, nothing exposes them yet.

### Still open

- **The desktop app has a fallback but no coverage of its own.** `desktop:pin` /
  `desktop:run` (ADR 0019) means a broken tree never stops a test session. Nothing
  asserts the desktop app _works_, though: the CSP is guarded by a test, and the
  last silent failure of this shape went unnoticed for a whole milestone. A
  release build and the `deb`/`msi`/`app`/`dmg` bundles are also still unrun.
- **The UI for the write side.** The grid is still read-only. `from-calendar-event.ts`
  (ADR 0011), the booking form, the quick panel, drag-and-drop and the conflict-error
  surface all wait on it. The `api-client` has no write methods for the three endpoints.
- Dentist and chair filters: the API accepts them, no UI sends them. Room columns need
  a `roomId` the read model lacks, and `room_no_overlap` has no read side.
- `dashboard.ts` still receives `db` for the non-appointment aggregates.
- Patient phone is still returned by the list endpoint while its column comment says it
  is encrypted and never returned. Needs a product decision.
- Dashboard `<h1>` is still a time-of-day greeting rather than the page name.
- No authentication, so `request.clinicId` still comes from `CLINIC_ID`.
- `apps/api/src/http/routes/patients.ts` does not validate its path parameter, so a
  hand-typed id becomes PostgreSQL's `22P02` as a 500. The appointments routes do.

### Verification

```
pnpm run typecheck        12/12 successful
pnpm run lint             12/12 successful + boundary guard OK
pnpm run format:check     clean
pnpm run build            5/5 successful
pnpm run test             361 unit/component (12/12 tasks, 46 new)
pnpm run test:integration 118 integration (10 files, real PostgreSQL 17, 25 new)
pnpm run test:e2e         56/56 passed (no UI moved this session)
pnpm run db:migrate       0002 applied to the live development database
pnpm run db:seed          completes against the new constraints
by hand, on a live DB     cross-clinic patient refused, cross-clinic chair refused,
                          deleting a dentist nulls dentist_id and keeps clinic_id
```

---

## Session 16 — A desktop build that can always be run

**Asked for:** a way to run the last build that worked, so a broken working tree
never stops manual testing of the desktop app.

**Delivered** four commands in `scripts/desktop-pin.mjs` (ADR 0019):

- `desktop:pin` — `tauri build --debug --no-bundle`, then keep the binary in
  `.desktop-known-good/<timestamp>/` with a `pin.json` recording the commit, the
  branch, whether the tree was dirty, the API URL it was compiled against and its
  size. Newest three kept.
- `desktop:run [n]` — execute a kept binary. Never compiles, never reads the
  source tree, and never refuses to start because the tree is broken (it reports
  the drift instead).
- `desktop:pins` — what is kept, newest first, with the commit each came from.
- `desktop:forget` — delete them.

The debug profile is a decision, not a shortcut: the frontend inside is still a
production build, so what is tested is what a user would load, and pinning stays
cheap enough to do often. `tauri dev` is not pinnable at all — `devUrl` serves the
assets from the working tree, so a copy would break exactly when it is needed.

**A real bug fell out of needing it.** The desktop app could not reach its own
API. `API_PORT` moved from 3000 to 3010 in session 8 and `API_PORT`,
`VITE_API_URL` and the Zod defaults moved with it; the CSP in `tauri.conf.json`
did not, and nothing reads that file. The webview refused every request — a shell
that rendered over an empty agenda, with nothing in any log, indistinguishable
from an app bug. The browser deployment has no such gate, so no web test could
have caught it. `apps/desktop/test/tauri-config.test.ts` now asserts the CSP
allows the origin `.env.example` names, and refuses `*`/`unsafe-eval`; verified by
reverting the port and watching it fail.

**Documentation corrected rather than added to.** `docs/desktop.md` §6 listed
`build:desktop` and `tauri:build`, which have never existed. §8 still described
the native build as unverified; it completes here in 38 s incrementally, so §8 now
says what is actually unverified (the release profile and the installers) instead.

**Environment note.** The native build failed first with `No space left on
device` — 117 GB at 115 MB free. With the user's approval: Docker build cache
(12.26 GB, 0 entries in use), Playwright browsers (1.3 GB) and the Chrome cache
(1.8 GB) were cleared. Both containers were left running, and Playwright chromium
was reinstalled straight after, so `test:e2e` is green.

**Then a `.sh` entry point for it.** `scripts/run-desktop.sh`, the counterpart to
`dev-desktop.sh`: run the newest kept build, or a numbered one, with no pnpm and no
inherited PATH required. It adds a default argument and nothing else — the logic is
the same `desktop-pin.mjs` the npm command runs, so the two cannot drift. Written
because the useful moment for a fallback is the moment everything else is broken,
and a command you have to reconstruct is not one you will reach for then.

**How far verification actually went.** The window was captured with `xwd` and
converted to PNG: a rendered app, not a blank one — 1 649 distinct colours, the
design system's background over 55% of pixels, the dark sidebar over 10%, 16% dark
pixels consistent with text. **Not** verified: that the window's API calls succeed
at runtime. The API's stdout is a pipe belonging to another terminal, `ss` cannot
see connections that live for 2 ms (proved with a `curl` control), and the
WebKitGTK inspector server here speaks no HTTP. The CSP is provably correct for
port 3010 and the frontend bundle carries the right URL; the first `desktop:run`
will show the rest.

### Still open

- Desktop coverage, as above: nothing asserts the desktop app works.
- Release profile / installers unverified.
- The UI for the appointment write side (unchanged, still the main M5 item).
- `pnpm run lint:root` fails on `.pnpmfile.cjs` (`'module' is not defined`) on a
  clean tree — pre-existing, and not part of `pnpm run lint`.

### Verification

```
pnpm run typecheck        12/12 successful
pnpm run lint             12/12 successful + boundary guard OK
pnpm run format:check     clean
pnpm run build            5/5 successful
pnpm run test             364 unit/component (12/12 tasks, 3 new)
pnpm run test:integration 118 integration (10 files, real PostgreSQL 17)
pnpm run test:e2e         56/56 passed
desktop:pin               two pins, 200 MB each, manifests correct
desktop:run               window "Denti-Code U3" 1394x834, app rendered
desktop:run 2             older pin, says it is not the newest
desktop:run 9 / abc       refuse with a count of what is kept
tauri-config.test.ts      fails when the CSP is reverted to port 3000
```

---

## Session 17 — Appointment write UI: reschedule and status

**Started from:** `a12db3d`. The three appointment write endpoints existed and
were covered by 25 integration tests; the grid could not use them.

**What was added**

- `packages/app/src/features/agenda/adapters/from-calendar-event.ts` — a drag
  becomes `{ startsAt }` and nothing else; a resize becomes `{ startsAt,
durationMinutes }` when the rounded length really changed; an unmoved gesture
  becomes `undefined`. Instants cross as UTC.
- Per-event `eventStartEditable` / `eventDurationEditable` from the domain's
  `isScheduleEditable`, so a confirmed past appointment does not offer a drag.
- `mutations/use-reschedule-appointment.ts` (`PUT …/schedule`),
  `mutations/use-transition-appointment-status.ts` (`POST …/status`) and
  `mutations/invalidate-schedule-queries.ts` (agenda range + dashboard + the
  affected patient profile). No optimistic write: the grid redraws from the API.
- `describe-appointment-failure.ts` + `scheduleConflictSchema` in
  `packages/validation` — one voice for a conflict and a rule refusal, with a
  conflict stated as the hour that is taken.
- `components/appointment-quick-panel.tsx` — a clicked appointment, its
  clinic-time span, and only the transitions the domain allows; cancelling asks
  for a reason; the panel stays open on a refusal.
- `features/clinic/format-clinic-time.ts` — the clinic's zone is an input.
- `packages/domain`: `requiresTransitionReason`, now the single statement of
  which transitions need a reason (the API already enforced it).

**Decisions worth recording**

- The gesture adapter declares FullCalendar's drop/resize shape structurally and
  imports no FullCalendar package, so **rule 5 of the boundary guard needed no
  change**. That is the first real test of ADR 0011's confinement, and the guard
  confirmed the boundary was already right.
- Writes invalidate rather than patch the cache, and a refused gesture calls
  FullCalendar's `revert()`. ADR 0007's argument, applied to a drag.
- The e2e spec **does not drag.** A headless pointer drag across a time grid
  asserts pixel offsets; the intent a gesture produces is pinned by unit and
  component tests where a gesture is a function call.

**Two tests I wrote were wrong before the code was.** The drag spec first
asserted the drop sent `17:00Z` (the end of the dropped range) and expected two
requests where the invalidation correctly makes three. Both were assertion bugs —
and the third request is exactly the redraw item 6 claims, so the suite now
asserts it: drop → `PUT` → re-read of the range. Fixing them also forced
`renderCalendar` to pass the request to its reply, so a write and the read it
triggers can be answered differently.

**Still open**

- **The booking form is blocked, not deferred.** `createAppointmentSchema`
  requires `dentistId`; no endpoint lists dentists or chairs, so the form would
  have to ask for a UUID. That read endpoint is the next task, and `selectable`
  stays unwired until a form exists to open.
- Lunch enforcement (T7), after-hours policy, desktop behaviour coverage, release
  profile and installers: unchanged.
- `pnpm run lint:root` still fails on `.pnpmfile.cjs` — pre-existing, not part of
  `pnpm run lint`.

**Verification**

```
pnpm run typecheck        12/12 successful
pnpm run lint             12/12 successful + BOUNDARY GUARD OK (no edit to it)
pnpm run format:check     clean (10 files formatted)
pnpm run build            5/5 successful
pnpm run test             422 unit/component (12/12 tasks, 58 new)
pnpm run test:integration 118 integration (10 files, real PostgreSQL 17)
pnpm run test:e2e         60/60 passed (5 new, 1 replaced)
```

---

## Session 18 — the two lists a booking is made against

**Started from:** `da72df6`. `POST /api/v1/appointments` requires a `dentistId` and
accepts a `chairId`, and nothing could name either — the booking form was blocked on
a missing read side.

**What was added**

- `DrizzleDentistRepository` and `DrizzleChairRepository`, implementing the two ports
  that had been declared since session 8 with no caller, plus
  `GET /api/v1/dentists` and `GET /api/v1/chairs` and the `onlyActive` query schemas.
- `dentistListQuerySchema` / `chairListQuerySchema` in `packages/validation/src/clinic`.
- 12 integration tests, two rooms and 4 chairs in the seed, and the appointments
  seated in them.

**Decisions worth recording**

- **The ports described tables that do not exist.** `DentistSummary` promised
  `specialties: string[]` and `defaultChairId`; `ChairSummary` promised `kind`. None
  is fillable from a column. They were corrected in writing rather than satisfied by
  three invented migrations — the same argument as the appointment port losing its
  speculative methods in session 13. `licenceNumber` is deliberately not returned: a
  list of bookable clinicians has no use for it.
- **Sorting is folded, and the folding moved.** The database runs `--locale=C`, so
  `Álvaro Núñez` sorts after `Beatriz Ñaupari` on byte value. Rather than copy the
  accent table into a second repository, the SQL/JS twins moved to
  `apps/api/src/infrastructure/persistence/postgres/fold-accents.ts` — and the
  comment there promised an `unaccentedAlphabet()` guard that had never been
  written, so it is now `fold-accents.test.ts`.
- **`roomName` comes from a LEFT JOIN.** `chairs.room_id` is nullable, so an inner
  join would hide every unassigned chair from the list of bookable chairs.
- **Two endpoints, not one "booking options" endpoint**, and no client query hooks:
  a hook with no caller is a promise the first consumer has to keep or break.
- **No rule about booking an inactive dentist.** `createAppointment` does not check
  `isActive`, so a client that hides inactive rows is currently the only thing
  preventing it — a rule in the browser. Recorded as product question 17 rather than
  decided here.

**A test that could not fail**

The first ordering assertion used `Dr. Álvaro` and `Dra. Ñuñez`. It passed with the
folding _removed_, because the shared title prefix decides the comparison before the
accent is reached. Rewritten without a prefix it fails when the folding goes, and the
chair's `LEFT JOIN` fails three tests when it becomes an inner join. Both checked by
reintroducing the defect.

**The development database was reset** (`db:reset` then `db:migrate`, `db:seed`) so
the new chairs are visible on the agenda: the seed is idempotent by id, so the four
existing appointments kept `chair_id = null` and the feature would have looked
unfinished. The database held nothing but seed rows (3 patients, 2 dentists, 4
appointments, 1 visit, 1 plan, 2 charges, 2 payments), so nothing was lost.

**Surfaced, not fixed**

- `appointments_room_no_overlap` treats a **room** as exclusive, so two chairs in one
  room cannot both be working at the same time — the constraint answers a different
  question from the one a room with two chairs poses. Recorded as T8.
- Whether an inactive dentist or chair may still be booked: product question 17.

**Verification**

```
pnpm run typecheck        12/12 successful
pnpm run lint             12/12 successful + BOUNDARY GUARD OK
pnpm run format:check     clean
pnpm run build            5/5 successful
pnpm run test             429 unit/component (12/12 tasks, 7 new)
pnpm run test:integration 130 integration (11 files, 12 new, real PostgreSQL 17)
pnpm run test:e2e         60/60 passed (no UI moved)
pnpm run db:migrate       no migration needed — no column added
pnpm run db:seed          2 rooms, 4 chairs; agenda now names a chair per block
live API                  /dentists, /chairs, ?onlyActive=true, 422 on ?onlyActive=yes
defect checks             folding removed -> 1 failure; leftJoin -> innerJoin -> 3
```

---

## Session 19 — the booking rule, asked instead of assumed

**Started from:** `5efe567`. Product question 17 was open: may an appointment be
booked with a dentist or chair that is not active? The code's answer was "yes", and
the reason it was yes is worth recording — `createAppointment` never read `isActive`,
the two list endpoints returned it and enforced nothing, and the only thing in the way
was a client that happened to hide the row.

The clinic was asked. Answer: **no**, refused server-side, for both.

**What was added**

- `packages/domain/src/appointment/bookable-resources.ts` — the rule, with no
  dependency but the two repositories it reads.
- `UNBOOKABLE_RESOURCE` as a domain error code, mapped to 409 and folded into
  `DOMAIN_RULE_VIOLATION` on the wire.
- `AppointmentBookingDependencies extends AppointmentWriteDependencies`, required by
  `createAppointment` and `rescheduleAppointment`.
- `ChairRepository.findById`, and the check wired into both use cases.

**Decisions worth recording**

- **The dependency split is the decision, not the `if`.** Adding the two repositories
  as optional would have been the tidier diff — the status transition would not be
  handed a chair repository it never uses — and it deletes the guarantee silently:
  `if (dentists)` becomes "run the rule when somebody remembered to wire it". Making
  them required in a wider type means the appointment routes **cannot be constructed**
  without them, and `tsc` immediately found three files that were: `app.ts` and two
  integration harnesses that would otherwise have tested a booking path with no rule
  in it. ADR 0020.
- **A reschedule checks the names the booking will have after the move**, so moving
  an appointment whose clinician was deactivated afterwards is refused until it is
  reassigned. The alternative — "you may keep a name you already used" — makes an
  inactive clinician permanently bookable to anyone who books once and then only
  drags, cannot be explained in one sentence, and needs the existing row to evaluate.
  The clinic was told and accepted it.
- **A name the rule cannot find is left to the foreign keys.** `findById` cannot tell
  an absent id from another clinic's and must not (ADR 0014), so the rule stays silent
  and the tenant FK answers 422 as before. Two answers for one bad reference means one
  is wrong.
- **`UNBOOKABLE_RESOURCE` rather than `INVALID_INPUT`**, for the same reason
  `OUTSIDE_OPERATING_HOURS` exists: a log line saying `INVALID_INPUT` for a booking
  that named a real, existing, deactivated clinician sends the reader looking for a
  malformed body.
- **`onlyActive` still defaults to no filter.** The rule is not a reason to hide rows
  from the list: a clinician who has left still appears on the appointments they
  worked.

**Verification**

Both call sites were checked by deleting them, and they do not overlap: removing the
create check fails three create tests, removing the reschedule check fails three
different ones. The compiler was the other check — three type errors in three files is
the argument for the dependency shape.

```
pnpm run typecheck        12/12 successful
pnpm run lint             12/12 successful + BOUNDARY GUARD OK
pnpm run format:check     clean
pnpm run build            5/5 successful
pnpm run test             442 unit/component (12/12 tasks, 9 new)
pnpm run test:integration 136 integration (11 files, 6 new, real PostgreSQL 17)
pnpm run test:e2e         60/60 passed (no UI moved)
pnpm run db:migrate       no migration needed — no column added
```

**Not done, and deliberately:** the booking form. This is the rule it inherits, and it
is the server-side half of the answer to question 17 — the browser no longer has to
decide who may be booked, so it can filter for convenience without being the policy.

---

## Session 20 — the booking form: a slot, and who is coming to it

The empty-slot gesture the grid has been missing since it could draw. Clicking a free
slot opens a dialog; the dialog asks who, for how long and in which chair, and posts to
`POST /api/v1/appointments`. Nothing else about the grid changed: a click on a block
still opens the quick panel, and a drag is still a drag.

**Decisions worth stating**

- **The grid is the time picker.** `dateClick` gives a `Date`; that instant is the
  `startsAt` that is sent. There is deliberately no time input in the dialog: a second
  control for the same decision is a second opinion about it, and the grid already
  answers it by direct manipulation. To move a booking later, drag it; to book a
  different hour, close the dialog and click that one.
- **The dialog judges nothing.** No opening-hours check, no overlap check, no
  "inactive" check beyond what the two lists already asked for. Every click opens the
  dialog, including a slot at 03:00, and the domain's refusal is what is displayed.
  This is the same argument that keeps the overlap rules out of `agenda-calendar.tsx`:
  a second implementation of a rule answers differently from the first the day they
  drift, and the browser is the one that is wrong.
- **`createAppointmentFormSchema` reuses the API's field schemas**
  (`createAppointmentSchema.shape.startsAt`, `.shape.durationMinutes`, …) instead of
  restating them. A field cannot be accepted by the dialog and refused by the endpoint,
  and the shared strings cannot drift apart.
- **Required messages say what to do, not what is wrong.** Zod's default for a bad uuid
  is "Invalid uuid", which is not something a receptionist can act on; the two pickers
  say `Choose a patient` and `Choose a clinician`.
- **Durations are a short list, filtered by the domain's own bounds.** "How long" is a
  clinic convention rather than a number each receptionist invents, and a free field
  would produce blocks of whatever height the person typed.
- **The chair dropdown maps "no chair" to the form's empty string.** Radix reserves `''`
  for "nothing chosen", so an explicit sentinel is needed to go _back_ to no chair — and
  the sentinel is mapped at the dropdown boundary, because the schema that validates
  this form is also the schema the API validates with and must not learn about a word
  that exists only because of a component library.
- **`PatientPicker` is a combobox over the existing `usePatientList`.** Two characters
  before querying, eight results, and the highlight moves with `aria-activedescendant`
  rather than by moving focus — focus would leave the input and lose the text that
  narrowed the list. The picker is controlled (`{id, label}`), because the form needs
  the id and the box needs the name.
- **The write is not optimistic.** The dialog closes when the API agrees and the day is
  re-read, so the block on the grid is the server's answer rather than a splice of the
  form's values (ADR 0007).

**What the tests caught**

- **A field with nowhere to report an error.** A chair id Zod's `uuid` refused — right
  shape, wrong variant nibble — made the submit button do nothing at all, silently,
  because `chairId` and `notes` had no message. Every field now renders its own. The
  test that found it was asserting the _body_ of a successful booking; the id in its
  fixture was one the mock had invented and Zod checked it. Zod's `uuid` validates the
  version **and** the variant nibble, which is worth knowing before writing fixtures.
- **A stale test asserting the gap.** `agenda-calendar.test.tsx` had
  "offers no way to create an appointment from an empty slot yet", written on purpose
  while the read endpoints did not exist. It is now three tests of the behaviour.
- **Playwright's `getByLabel('Patient')` matched both the dialog's picker and the
  header's search.** The failure pointed at the submission, not at the mis-scoped
  locator; the e2e helpers are now scoped to the dialog.
- **Radix leaves `body { pointer-events: none }` behind in jsdom**, so user-event
  refuses every later click. The check is turned off in this file with a comment
  explaining why, rather than scrubbing the attribute between steps.

**Verification**

```
pnpm run typecheck        12/12 successful
pnpm run lint             12/12 successful + BOUNDARY GUARD OK
pnpm run format:check     clean
pnpm run build            5/5 successful
pnpm run test             465 unit/component (12/12 tasks, 23 new)
pnpm run test:integration 136 integration (11 files, real PostgreSQL 17)
pnpm run test:e2e         69/69 passed (9 new, all booking)
pnpm run db:migrate       no migration needed — no column added
```

No server code changed: the validation package gained a schema and nothing else, so the
API's behaviour is untouched by this session.

**Not done, and deliberately:** the "New Visit" and next-appointment actions on the
patient profile. They open the same dialog from a different screen and are the next
thing on this milestone.

---

## Session 21 — booking without a grid

**What was done**

- `packages/app/src/features/clinic/zoned-wall-clock.ts` (new, with tests): the
  inverse of `format-clinic-time.ts` and the only place the app turns a wall clock into
  an instant. Luxon rather than `Intl`, because `Intl` reads a zone's offset at some
  moment and guesses about the boundary, and because FullCalendar's timezone plugin
  already brings Luxon here.
- `createAppointmentFormSchema`: `startsAt` is replaced by `localStartsAt`, a
  `YYYY-MM-DDTHH:mm` wall clock validated as a shape and as a calendar date. The
  instant is assembled at submit from `clinic.timeZone` and is no longer a form field.
- `AppointmentBookingDialog`: `startsAt` and `patient` are both optional. With a slot
  the time field is `readOnly`; without one it is the person's to fill and the zone is
  named under it. A wall clock the zone skipped is refused with a sentence naming the
  zone. The body is written field by field so nothing rides along.
- `packages/app/src/features/clinic/format-clinic-time.ts`: added `formatClinicDay`,
  for the moments a clinic records rather than schedules.
- The patient profile gains **Book appointment** (that patient already chosen) and
  draws every time it shows in the clinic's zone. The dashboard's **New Visit** is a
  live action that opens the same dialog.
- e2e: `web/booking-without-a-slot.spec.ts` (8 new), and `clinicFixture()` for the
  five existing specs whose pages now ask `GET /api/v1/clinic`.

**What the tests caught**

- **A validator that threw instead of failing.** `z.string().regex(...).refine(...)` —
  Zod 4 runs the refine even when the regex has already failed, so an empty time field
  reached `value.split('T')[1].split(':')` and threw. A validator that throws takes the
  form down; it has to answer. Now one `superRefine` that reports one message for the
  one problem.
- **`Date.parse` cannot check that a date exists.** `Date.parse('2026-02-30T09:00:00Z')`
  returns a number — it reads the 30th of February as the 2nd of March without
  complaint. The check is now a `Date.UTC` round trip against the parts, where a claim
  that comes back different is not a date.
- **Luxon resolves a daylight-saving gap without a murmur**, turning `02:30` on a
  spring-forward Sunday into `03:30`. The converter round-trips the parsed value and
  refuses what does not survive the trip; the dialog then says which zone refused it.
- **A date with a curly apostrophe in a test name** (`the grid's slot`) parsed as a
  string ending early. Worth one line here because the file that caught it is the
  converter's own test file.
- **Five e2e specs failed** the moment the profile and the dashboard began asking
  `GET /api/v1/clinic`. The mock's 501 is the behaviour the `sessions 17–18` log
  describes; the fix was fixtures.

**Two things that were wrong before the code was.** The first version of the profile
spec asserted a whole formatted date, which is the browser's locale and says nothing
about a timezone — the browser here is `America/New_York`, so en-US gave
`Tue, Oct 6, 08:00` and the spec failed on the month. It now asserts the hour inside
the paragraph, which is the one thing being claimed. The second was clicking
`booking-dentist` where `booking-chair` was meant, which opened the clinician list and
then waited for a chair in it forever.

**Verification**

```
pnpm run typecheck        12/12 successful
pnpm run lint             12/12 successful + BOUNDARY GUARD OK
pnpm run format:check     clean
pnpm run build            5/5 successful
pnpm run test             488 unit/component (12/12 tasks, 23 new)
pnpm run test:integration 136 integration (11 files, real PostgreSQL 17)
pnpm run test:e2e         77/77 passed (8 new)
pnpm run db:migrate       no migration needed — no column added
```

No server code changed. The validation package's _form_ schema moved; the API's request
schema and the endpoint did not, so `POST /api/v1/appointments` answers exactly what it
answered before.

**Not done, and deliberately:** dentist and chair filters above the agenda grid. The
booking path itself is complete from all three doors.

---

## Session 22 — the agenda's filters

**What was done**

- `AgendaFilterBar` (new, with tests): dentist and chair chips above the grid, a "clear"
  escape, and the two lists fetched per endpoint. The bar asks
  `GET /api/v1/dentists?onlyActive=false` and the same for chairs; the booking dialog
  keeps `onlyActive=true`. `onlyActive` became a **required** argument rather than a
  defaulted one, and it is part of both query keys, so the two answers cannot overwrite
  each other in the cache.
- `agenda-range-query.ts`: `AgendaFilters`, `NO_AGENDA_FILTERS`, `hasAgendaFilters`, and
  ids in the key **sorted** — a filter is a set, and clicking two chips in either order
  asks for one answer. An explicit empty selection produces the same key as passing
  nothing, or the grid and any second caller would each fetch the unfiltered day.
- `AgendaCalendar` owns the filter state beside the range, so it survives navigating to
  next week, and the empty state now distinguishes "nothing in this range" from
  "nothing matches these filters in this range".
- `dentistChipColor` (new, with tests): `#rgb`/`#rrggbb` or nothing. `dentists.color` is
  an unvalidated `text` column, and a chip is either the colour the clinic chose or has
  no swatch.
- Tests: repaired `agenda-filter-bar.test.tsx`, `agenda-calendar.test.tsx` and
  `agenda-range-query.test.tsx`; added `e2e/web/agenda-filters.spec.ts` (8) and a
  second validation pair for the blank-dropping filter transform.

**Two assertions that disagreed with the system rather than with the code**

- `?dentistIds=` is **not** "a filter that matched nothing" — the comment in `toQuery`
  claimed that. Against the running API it returns the whole day, because
  `uuidListSchema` drops the blank and the repository skips a zero-length filter. The
  comment now says that, and records that the client's own `length` check changes no
  response and stays only because two incidental server-side guards are not a contract.
- Releasing a chip does not produce a third request: `mount.tsx` sets `staleTime: 30_000`
  app-wide, so returning to a narrowing fetched moments ago is served from cache. The
  spec now documents the reuse instead of contradicting it.

**A gap found by checking by hand rather than by reading**

`?dentistIds=` is parsed by a transform that was untested: the repository's "ignores an
empty filter rather than returning nothing" was asserted against real rows, and nothing
pinned the step above it that turns `''` into `[]` instead of a 422 — and nothing in the
app sends an empty filter today, so the branch is reachable only by the next client that
does. Two tests now pin it, verified by replacing `.filter(Boolean)` and watching both
fail.

**Five defects the tests caught, four of them in the tests**

1. The calendar spec counted _every_ request and meant "the range"; mounting the filter
   bar added two, so six assertions started failing in the harness. `rangeCalls()` and
   `writes()` now, and the tests that indexed `mock.calls[1]`/`[2]` positionally select
   by what a request is.
2. `expect(style).toContain('0ea5e9')` could never pass — jsdom serialises colours as
   `rgb(14, 165, 233)`.
3. `getByRole('button', { name: /Sillón/ })` threw on ambiguity. A loose pattern is not a
   weaker name, it is a different question, and it has no answer once there are two
   chairs.
4. The colour-injection test passed **because of jsdom**, not the validator: the hostile
   fixture `#0ea5e9; background-image: url(...)` is refused by the CSS parser, so
   deleting the validator left it green. `chartreuse` is a perfectly valid
   `background-color`, and that fixture fails the moment the check goes.
5. The e2e mock's `find` on `/dentists` returns the **earliest** match, which after this
   session is the filter bar's — so `booking.spec.ts` was reporting "the dialog asked
   for every clinician in the clinic" as a pass. It now asserts both requests, per
   endpoint, in opposite directions.

**Mutations verified (each reintroduced, each failing)**

| Mutation                                     | Caught by                           |
| -------------------------------------------- | ----------------------------------- |
| `useAgendaRange(range, filters)` → `(range)` | 5 e2e specs + component test        |
| filter bar → `onlyActive: true`              | filter-bar test + `booking.spec.ts` |
| drop `.sort()` from the key ids              | "same key however clicked"          |
| drop the ids from `agendaRangeKey`           | 3 tests across both files           |
| drop `hasAgendaFilters`                      | filtered-empty-state assertions     |
| drop the `#rgb`-only validation              | `dentist-chip-color.test.ts`        |
| `.filter(Boolean)` → `.filter(() => true)`   | the 2 new validation tests          |

Note: an e2e run needs `pnpm run build --force` first — the specs test the built
bundle, and the first attempt at the first mutation passed 8/8 against stale output.

**Verified against the running API** (port 3010, seeded day): `/health` OK;
`?onlyActive=false` returns the seeded clinicians; a day returns 4 appointments
unfiltered and 2 narrowed to one dentist **and** one chair; `?dentistIds=` returns 4, as
above.

**Verification**

```
pnpm run typecheck        12/12 successful
pnpm run lint             12/12 successful + BOUNDARY GUARD OK
pnpm run format:check     clean
pnpm run build            5/5 successful
pnpm run test             516 unit/component (12/12 tasks, 28 new)
pnpm run test:integration 136 integration (11 files, real PostgreSQL 17)
pnpm run test:e2e         85/85 passed (8 new)
pnpm run db:migrate       no migration needed — no column added
```

**Not done, and deliberately.** Room columns. They need a `roomId` in `AgendaEntry`,
which the read model does not have because the write side declined a room it could not
report (ADR 0018) — so this reopens a decision rather than extending the filters, and
`room_no_overlap` has no read side for the same reason. Written up in `docs/roadmap.md`
under M5 rather than left as a checkbox.

---

## Session 23 — Starting a visit (the appointment bridge)

**Delivered.** `startVisit` (a domain use case over one `UnitOfWork`), `POST
/api/v1/visits`, `DrizzleVisitRepository`, `DrizzleUnitOfWork`, `startVisitSchema`, and
migration `0003_visit_links_and_tenant_keys`. ADR 0021 argues the transaction, the
one-field body, the narrowed `Repositories` set, the nullable dentist, and why the
walk-in case is a separate request rather than an optional field.

`visits.appointment_id → appointments.id` and `appointments.visit_id → visits.id`, both
`on delete restrict`, plus composite `(id, clinic_id)` foreign keys on the visit's
patient, dentist and chair — the same tenant guarantee the appointments table has had
since `0002`.

**The find.** `startVisitFromAppointment` refuses an appointment that already has a
visit. It had been written in session 15 and tested ever since against a hand-built
entity, and it had never once run against a real row: the repository's `ENTITY_COLUMNS`
projection never selected `visit_id`. Every sequential duplicate was being caught by the
unique index on `visits.appointment_id` instead — same `DUPLICATED_RECORD`, same 409,
same one row. No symptom existed. The new integration test asserts on what `findById`
returns before and after a visit is started; removing the column again fails that test
and leaves the duplicate test passing, which is the proof that the two assertions are
about different things.

**Other things worth recording.** The `restrict` constraints refused the integration
fixture on the first run: with both links restricting, there is no order in which a visit
and its appointment can simply be deleted, so the fixture clears both links first — which
is what the domain does through status transitions. Two fixture bugs were the database
being right (a mixed-clinic booking, and a `countVisits(undefined)` that could never match
a row which does not exist). Two route assertions were wrong about the API rather than the
code: `toApiErrorCode` collapses every rule refusal to `DOMAIN_RULE_VIOLATION`, so
`DUPLICATED_RECORD` and `ILLEGAL_TRANSITION` both reach the client as one 409 code.

**Verification**

```
pnpm run typecheck        12/12 successful
pnpm run lint             12/12 successful + BOUNDARY GUARD OK
pnpm run format:check     clean
pnpm run build            5/5 successful
pnpm run test             533 unit/component (12/12 tasks, 17 new)
pnpm run test:integration 158 integration (13 files, real PostgreSQL 17)
pnpm run test:e2e         85/85 passed (unchanged — no UI moved)
pnpm run db:migrate       0003 applied; db:generate reports no drift
```

Mutations checked: the `visit_id` projection (caught), the write order in `startVisit`
(caught, 6 of 12 domain tests), and both `restrict` links (caught by the teardown and by
the delete tests).

**Not done, and deliberately.** Walk-ins, the visit read side, closing and reopening a
visit, the visit workspace UI, notes, treatments, charges and payments. No UI exists for
this slice, so the e2e count is unchanged — the endpoint is reachable but nothing calls
it yet.

---

## Session 24 — Completing and reopening a visit

**Done.** `completeVisitRecord` and `reopenVisitRecord`; `POST /api/v1/visits/:visitId/complete`
and `POST /api/v1/visits/:visitId/reopen`, both bodyless; `CompletedVisit`, so a finished
visit cannot be represented without an end time; `VisitRepository.updateStatus` taking the
end time as a parameter instead of reading the wall clock; `reopenVisit` losing a timestamp
parameter it accepted and discarded; ADR 0022; 9 unit tests and 14 integration tests.

**Decided.** The linked appointment is not completed alongside the visit, and reopening
does not re-open a completed booking. Completing it would need a `COMPLETED → IN_TREATMENT`
edge and would put a button on every completed appointment in the clinic. The stated
price — the booking reads `IN_TREATMENT` until the front desk completes it through
`POST /api/v1/appointments/:id/status` — is asserted by three tests against the table
rather than left in a comment.

```
pnpm run typecheck        12/12 successful
pnpm run lint             12/12 successful + BOUNDARY GUARD OK (one pre-existing warning)
pnpm run format:check     clean
pnpm run build            5/5 successful
pnpm run test             542 unit/component (9 new)
pnpm run test:integration 172 integration (13 files, 14 new, real PostgreSQL 17)
pnpm run test:e2e         85/85 passed (unchanged — no UI exists for this slice)
pnpm run db:generate      no schema changes, nothing to migrate
```

Mutations checked: the repository stamping its own `new Date()` (caught by 4 tests), the
transition table widened so completion and reopening became idempotent (caught by 3 unit
and 3 integration tests), and the route helper's empty-string clinic default (caught by 6).
The appointment-independence assertions could not be mutated today, because
`AppointmentRepository` has no status-change method for the domain to couple to.

**Defects found and fixed while testing.** The route helper defaulted its clinic to
`''`, which turned every completion into a `22P02` reported as a 500 — the failure the
`uuidSchema` guard beside it exists to prevent. Two fixtures repeated the shape of that
mistake: an `undefined` meaning both "no such visit" and "the default visit", and two
bookings spaced by a minute that a 45-minute duration made overlap.

**Not done, and deliberately.** The audit trail on reopening (question 18 — there is no
authenticated actor to record, and the requirements arrive in Milestone 12), walk-ins,
the visit read side, the visit workspace UI, notes, treatments, charges and payments.
No UI calls either endpoint, so the e2e count is unchanged.

---

## Session 25 — The visit read side

**Done.** `getVisit` and `listVisitsForPatient` (`packages/domain/src/visit/visit-read.ts`);
`GET /api/v1/visits/:visitId` and `GET /api/v1/patients/:patientId/visits`; ADR 0023;
7 unit tests and 17 integration tests. Three repository methods that had no caller now
have one — a visit closed by the API can be seen closed.

**Decided.** No filterable collection: no question about visits is answered by a window
and filters, so building one would be inventing filters without a caller to ask. The
timeline answers `200 []` for an untreated patient, where `GET /patients/:id` answers
`404` — different questions, and a list that 404s every untreated patient is a bug in
rule's clothing. Another clinic's patient also answers `[]`, and is indistinguishable
from the untreated case on purpose: a list endpoint cannot refuse "does this patient
exist here" without leaking "does this patient exist somewhere". Uncapped, because a
silently truncated clinical history is worse than a long one.

**Deferred, recorded as open work.** Replacing the patient profile's inline `visits`
query with `VisitRepository.findForPatient`. It projects different columns for one
screen's card layout, and it sits inside a five-query block issued together for a
documented reason.

```
pnpm run typecheck        12/12 successful
pnpm run lint             12/12 successful + BOUNDARY GUARD OK (one pre-existing warning)
pnpm run format:check     clean
pnpm run build            5/5 successful
pnpm run test             549 unit/component (7 new)
pnpm run test:integration 189 integration (13 files, 17 new, real PostgreSQL 17)
pnpm run test:e2e         85/85 passed (unchanged — no UI calls these endpoints)
pnpm run db:generate      no schema changes, nothing to migrate
```

Mutations checked: `orderBy` removed from `findForPatient` (caught by 2), the clinic
filter dropped from `findForPatient` (caught by 1), the clinic filter dropped from
`findById` (caught by 4), and `NOT_FOUND` replaced with a fabricated visit (caught by 3).

**Fixture leaks found and fixed while testing.** Two patients added for the timeline
tests without adding them to the route suite's teardown, which surfaced as an unrelated
`patients_clinic_id_clinics_id_fk` violation in a later statement — the database refusing
to delete a clinic a forgotten fixture still belonged to. And a test that deletes a dentist
on purpose, permanently, broke the four tests after it until the fixture was restored in
`afterEach`.

**Not done, and deliberately.** Walk-ins, the visit workspace UI, clinical notes,
treatment records, prescriptions, charges, files and payments. Consolidating the patient
profile's visit query. No UI calls these endpoints, so the e2e count is unchanged.

## Session 26 — The walk-in

**Done.** `startWalkInVisit` (`packages/domain/src/visit/walk-in-visit.ts`),
`startWalkInVisitSchema` (`packages/validation/src/visits/index.ts`), and
`POST /api/v1/visits/walk-in` (ADR 0024). 7 domain unit tests, 5 validation tests, and
12 integration tests. The second creation door ADR 0021 held back now exists.

**Decided.** A walk-in is its own endpoint, not `POST /api/v1/visits` with a sparse
body — the bridge takes one field and reads the names off the booking, a walk-in has
no booking, and folding them together would give the schema a rule for every mix it
can express. The clinician is required (attributing a treatment to nobody is not a
record), the chair optional, `startedAt` is the clock and never the request, and there
is no `appointmentId` key at all. The walk-in runs the same bookable-resource rule as
a booking (inactive clinician/chair → 409 `UNBOOKABLE_RESOURCE`); the bridge does not,
because a booking already ran it at booking time.

**Decided.** The walk-in does not read the patient first — the composite tenant foreign
keys answer for it, and `DrizzleVisitRepository.save` now translates `23503` into
`INVALID_INPUT` ("That patient, dentist or chair is not in this clinic", 422). Detection
is one helper, `isForeignKeyViolation`, shared with the appointment repository's private
rethrow. A walk-in writes one row and creates no appointment — it is not on the agenda
and not in the dashboard's `inTreatment` count; it lives on the clinical timeline with
no booking link.

**Refused to decide.** No second-open-visit rule: it applies to _both_ doors, the
appointment door shipped without it, and adding it here alone would make the two doors
disagree. Product question 19; `findOpenForPatient` is waiting for the rule or its
caller.

```
pnpm run typecheck        12/12 successful
pnpm run lint             12/12 successful + BOUNDARY GUARD OK (one pre-existing warning)
pnpm run format:check     clean (fixed via pnpm run format)
pnpm run build            5/5 successful
pnpm run test             561 unit/component (12 new)
pnpm run test:integration 201 integration (13 files, 12 new, real PostgreSQL 17)
pnpm run test:e2e         not re-run — no web/app/ui file changed in this slice (API + domain only)
pnpm run db:generate      no schema changes, nothing to migrate
```

No mutation-hunt this session; the FK translation is proven directly (foreign patient
and foreign clinician refused at the boundary, plus the schema's own violations).
Fixture hygiene followed the session 25 lesson: the inactive clinician and chair a route
test inserts are added to the suite's teardown.

**Not done, and deliberately.** The visit workspace UI, clinical notes, treatment
records, prescriptions, charges, files and payments. Consolidating the patient profile's
visit query.

---

## Session 27 — two engines, SQLite runs everything by default (ADR 0025)

**Goal.** Drop the Docker layer from the default developer loop. SQLite becomes the
engine everything boots on; PostgreSQL is retained as a second engine behind the same
ports, and the two are never abstracted over — ADR 0025. Phase-1-flavoured groundwork
that touches the API, the database tooling and the shape of every future migration.

**Done.**

- `database/schema/sqlite/*` (mirror of the 23-table schema, snake_case) and
  `database/migrations-sqlite/{0000,0001,0002}`. The overlap guard that PostgreSQL
  expresses with exclusion constraints is three `BEFORE INSERT`/`BEFORE UPDATE`
  trigger pairs; tenant isolation is composite `(id, clinic_id)` FKs. `db:migrate`
  and the browser `db:seed` are dual-engine, and `sqliteDatabasePath` is the one
  place a relative `sqlite:` URL is resolved, shared by migrator, seeder and API.
- API persistence behind one seam: `DatabaseConnection` +
  `openDatabaseConnection` (URL scheme dispatches to `persistence/sqlite/*` or the
  PostgreSQL stack). Repos are forked per engine; the dashboard read model became a
  `DashboardReadStore` with one implementation per engine; routes import only ports.
- `SQLiteUnitOfWork`: better-sqlite3's `.transaction()` rejects async callbacks, so
  the unit of work manages `BEGIN`/`COMMIT`/`ROLLBACK` itself around the async
  work, on one synchronous connection.
- An always-on smoke suite (`apps/api/test/sqlite-smoke.integration.test.ts`):
  migrates and seeds its own SQLite file, then drives the real server — registration,
  folded search, booking, both overlap-trigger 409s, the tenant-FK 422, the visit
  bridge in a transaction, the second-visit refusal, and the dashboard read model.

**Defects found, in the order the suite found them.**

1. `new Database(sqlite:...)` gets a URL, not a path — the API opened nothing while
   the migrator wrote a real file. Now routes through the shared `sqliteDatabasePath`.
2. Fire-and-forget drizzle builders never executed: `register` and `visit.save`
   answered 201s while `SELECT * FROM patients` returned `[]`. Both now end in
   `.run()`.
3. This better-sqlite3's SQLite has **no `translate()`** — the accent fold for
   SQLite is a `fold_accents()` scalar (the same JS fold, registered deterministic
   per connection) via `sqliteFoldable`; PostgreSQL keeps `translate()`.
4. Three wrong expectations of mine, not code defects: `INVALID_INPUT` → the wire's
   `VALIDATION_ERROR`; the sequential second visit → `DOMAIN_RULE_VIOLATION`
   (the domain guard fires before the DB); and a move onto an appointment's _own_
   slot is correctly non-conflicting (UPDATE trigger self-exclusion) — the trigger
   test now uses a second booking.

**Also.** `.env.example` now defaults to `DATABASE_URL=sqlite:./data/denti-code-u3.db`;
the `postgres://` line is the way back, and the development container is untouched.

```
pnpm run typecheck        12/12 successful
pnpm run lint             12/12 successful + BOUNDARY GUARD OK (one pre-existing warning)
pnpm run format:check     clean (fixed via prettier --write)
pnpm run build            5/5 successful
pnpm run test             12/12 tasks — api 7 passed / 13 skipped (PG opt-in) / 70 tests,
                          of which 12 are the new always-on SQLite smoke
pnpm run test:integration not run this session (needs TEST_DATABASE_URL + container)
pnpm run db:migrate       verified on a real SQLite file (0000–0002 applied) + seed
pnpm run test:e2e         not re-run — no web/app/ui file changed
```

**NOT Done and deliberately.** No SQLite index on the SQL-side fold (the lists are
small; revisit when search performance means anything). The PostgreSQL integration
suites are untouched and still opt-in. `docs/decisions/0025`, `STATE.md` updated with
this log.

**Environment enablement after the session (commit `53930f7`).** `dev:desktop` was
dead on this machine: tauri could not find `cargo` (no Rust toolchain existed) and
pnpm blocked esbuild's postinstall. Fixed — rustup stable 1.99.0 to `~/.cargo`
(PATH appended to `~/.bashrc`), Tauri system deps via apt (`build-essential
libwebkit2gtk-4.1-dev libgtk-3-dev libssl-dev libayatana-appindicator3-dev
librsvg2-dev`), and `esbuild` added to `onlyBuiltDependencies` in
`pnpm-workspace.yaml`. Re-run of `pnpm run dev:desktop`: 422 crates compiled in
~3 min (tauri 2.12.1), `target/debug/denti-code-u3-desktop` launched on
`DISPLAY=:0`, no warnings or errors in the log. `AGENTS.md` environment notes
updated to match.

---

## Session 28 — the visit workspace (Milestone 6's exit criterion)

**Started from:** clean tree at `a0d9361` (session 27). Next roadmap item: "Visit
workspace: patient/visit header, left section nav, right workspace" — and the
milestone's exit criterion, which reads "a clinician can complete a visit, but not
_from_ the visit context".

**Work performed**

- New route `/visits/$visitId` and the `features/visits/` folder behind it:
  - `visit-status-presentation.ts` — status tone/label, `visitClosureTransitions`,
    `visitClosureLabel` (3 tests).
  - `queries/visit-query.ts` — `useVisit`, key `['visits','detail',visitId]`.
  - `mutations/use-visit-closure.ts` — one mutation over the two bodyless POSTs
    (`.../complete`, `.../reopen`) plus the shared invalidation helper.
  - `describe-visit-failure.ts` — quotes `ApiClientError`'s message and no other
    error's; 404 and network failure get their own sentences (5 tests).
  - `components/visit-workspace.tsx` — header (patient, record number, status chip,
    source, back link), the data-driven section nav, the summary and clinical-summary
    cards in clinic time with the clinician/chair resolved by id, and the
    Complete/Reopen buttons (9 tests).
- The patient profile's "Recent visits" rows are links into the workspace;
  `READING_THE_CLINIC_CLOCK` moved from that route into `format-clinic-time.ts`,
  because the workspace is the second screen that needs the same rule.
- e2e: `web/visit-workspace.spec.ts` (5 specs) and the fixtures behind it —
  `VISIT_ID` (the open visit a spec completes), `COMPLETED_VISIT_ID` (the row the
  profile's own card reports, so the link cannot land on a contradiction), `openVisit`,
  `completedVisit`, `visitWorkspaceFixtures(overrides)`.
- e2e harness: `web/fixtures/frozen-clock.ts` freezes the page's clock at the
  fixtures' day, and all ten spec files now import `test`/`expect` from it (the drift
  this fixed is defect 3 below).

**Decisions** (written up under "Decisions from session 28" in `STATE.md`)

- Buttons = `allowedVisitTransitions(status)` ∩ `['OPEN','COMPLETED']`: the domain's
  `OPEN → CANCELLED` has no endpoint and gets no button. Section nav = data with one
  row, added to when an endpoint gives a section something to show. Section choice is
  component state — file routes type search params `any`.
- The mutation is **non-optimistic**: the chip changes on the refetch, and the e2e
  asserts the second read before the chip, so skipping the refetch later fails the
  spec. The agenda and dashboard are not invalidated (ADR 0022: closures do not move
  the appointment).

**Defects and findings, in the order they appeared**

1. The workspace's component tests rendered nothing until they mounted a real router:
   a `<Link>` with no router context has no context to render into. The tests now build
   a three-route in-memory router, which is the harness any future screen with links
   will need.
2. The same tests then failed on the mock, not on the app: the fixtures are keyed by
   `url.pathname`, and the code passed the origin-prefixed `BASE_URL`.
3. **The e2e suite had 14 failures, and they were date drift in the harness.**
   `agendaEntries` and `bookingFixtures` are pinned to Monday 2026-10-05 while the grid
   opens on today — a failing spec's own error context read "October 7, 2026" over an
   empty grid. Proven not ours before touching anything: `git stash -u` on clean
   `a0d9361`, same command, identical 14 failed / 25 passed. **Fixed** by freezing the
   page's clock rather than chasing the calendar with the fixtures:
   `fixtures/frozen-clock.ts` exports the suite's `test`, whose `page` fixture calls
   `page.clock.setFixedTime('2026-10-05T13:00:00.000Z')` (Monday 08:00 in the clinic,
   before the first navigation), and all ten spec files import `test`/`expect` from it.
   Only `Date` is fixed — timers, debounces and retries untouched — so the fixtures
   stay the frozen captures they were written to be. 90/90 after the change.

**Verification**

```
pnpm run typecheck        12/12 successful
pnpm run lint             12/12 successful + BOUNDARY GUARD OK (one pre-existing warning)
pnpm run format           clean (prettier also reflowed two wrapped lines in AGENTS.md / STATE.md)
pnpm run build            5/5 successful (routeTree.gen.ts regenerated with /visits/$visitId)
pnpm run test             12/12 tasks — 593 tests, 20 new under features/visits
pnpm run test:integration not run — no API, domain, validation or schema file changed
pnpm run test:e2e         90 passed, 0 failed (after the frozen-clock fix; before it,
                          76 passed / 14 failed, reproduced on clean HEAD)
```

Playwright's browsers had been cleared from `~/.cache/ms-playwright`; reinstalled with
`pnpm exec playwright install chromium`, and the environment note is now in
`AGENTS.md`.

**NOT done and deliberately.** The doors that _start_ a visit (the agenda's action and
the walk-in form) have no UI — not on this phase's ordered list. The sidebar's
`/visits` link is a 404: ADR 0023 has no filterable visits collection, so a list is its
own decision. The clinical-notes section row waits for its endpoint. Integration tests
were skipped because nothing behind them changed.

---

## Session 29 — clinical notes (the section nav's first new row)

**Started from:** clean tree at `13781e0` (session 28). Next roadmap item: "Clinical
notes" — the first thing the workspace's data-driven section nav was designed to grow
for.

**Work performed**

- **Domain** (`packages/domain/src/visit/clinical-notes.ts`, 7 tests): `ClinicalNote`,
  `listClinicalNotes`, `addClinicalNote`. Both read the visit first, so an unknown or
  foreign visit is a 404 for both verbs and only a visit this clinic holds answers with
  `[]`; a blank body is `INVALID_INPUT` before any repository is touched, and what is
  stored is trimmed.
- **Ports**: `ClinicalNoteRepository` (`findForVisit(clinicId, visitId)` + `save(note)`)
  and `Repositories.clinicalNotes` — the set's first addition since session 23 narrowed
  it to six.
- **Types**: `ClinicalNoteId` brand, added to the `ClinicIdentifier` union.
- **Validation**: `createClinicalNoteSchema` — trimmed, min 1, max 2000 (the
  appointment's own `notes` limit), 5 tests.
- **API**: `DrizzleClinicalNoteRepository` and `SQLiteClinicalNoteRepository` (both
  translating the note's foreign-key violation into `NOT_FOUND`), wired into
  `repositoriesFor` and `sqliteRepositoriesFor`; `GET` and
  `POST /api/v1/visits/:visitId/notes` behind the existing `readVisitId` guard;
  `VisitsDependencies.clinicalNotes` passed from `app.ts`. **No migration**: the
  `clinical_notes` table was already in both baseline migrations exactly as needed.
- **App**: `queries/visit-notes-query.ts` (fetched when the section mounts, no
  `enabled` flag), `mutations/use-create-clinical-note.ts` (invalidates only the notes
  key), `describe-note-failure.ts` (+6 tests), and `VisitNotesSection` in
  `visit-workspace.tsx` — the nav's second row, with the draft preserved when the API
  refuses (4 tests).
- **Tests**: 6 route tests in `visits-route.integration.test.ts` (PostgreSQL), +1
  always-on SQLite smoke test that files a note through the endpoint and proves both
  verbs scope through the visit, and 2 e2e specs with the `visitNote` / `filedNote`
  fixtures.

**Decisions** (written up under "Decisions from session 29" in `STATE.md`)

- Scoping comes through `visits`, because `clinical_notes` has no `clinic_id`: the use
  case reads the visit before it lists or writes, and `save` takes no clinic id. One
  row, one statement — no `UnitOfWork`.
- `Repositories` grew to seven only when both implementations existed: the set holds
  what can be built, tested in the direction the rule had not yet been used.
- `authorId` is always `null` — there is no user model to attribute a note to.
- The mutation invalidates nothing but `['visits','notes',visitId]`: a note does not
  change the visit row, so re-reading the visit would be the client implying it did.
- The e2e asserts the server's `id` and `createdAt` in the clinic's zone rather than
  the text it typed, because that is the part no browser could have produced.

**Defect found after the report: the SQLite file had no directory to live in.**
Booting the app to look at it, the desktop shell showed "The patient list could not be
loaded" — no API was running, and `pnpm run db:migrate` then crashed with `Cannot open
database because the directory does not exist`, because `data/` is gitignored and had
been cleaned off the machine. better-sqlite3 refuses a missing directory instead of
creating it, and three places open that file.
`ensureSqliteDatabaseDirectory` (`database/db-url.ts`) now creates it, called by the
migrator, the seeder and the API connection before `new Database(path)`, with 6 tests
in the new `database/db-url.test.ts` (both files now in the package's lint script).
Migrate then seed created `data/denti-code-u3.db`, the API was started with
`pnpm run dev:api`, and `/health` plus `/api/v1/patients` answer 200.

**Environment finding.** Docker and every PostgreSQL client are absent from this
environment (no `docker`, `podman`, `psql`, or `/var/run/docker.sock`), so the
PostgreSQL integration suite — including the six new route tests — could not be
executed. They typecheck and are written for `TEST_DATABASE_URL`; the always-on SQLite
smoke test covers the same path here.

**Verification**

```
pnpm run typecheck        12/12 successful
pnpm run lint             12/12 successful + BOUNDARY GUARD OK (one pre-existing warning)
pnpm run format:check     clean
pnpm run guard:boundaries OK (one pre-existing warning)
pnpm run build            5/5 successful
pnpm run test             12/12 tasks — 622 passed (29 new), 207 integration skipped
pnpm run test:integration not run — no Docker/PostgreSQL in this environment
pnpm run test:e2e         92 passed, 0 failed (2 new notes specs)
```

**NOT done and deliberately.** Treatments, charges and payments come next, in the
order the roadmap holds them. A note's `authorId` stays null until there is an
authenticated user (ADR 0022's question 18). The notes section has no edit or delete:
an append-only clinical record was the simplest honest rule, and revising history is a
product decision, not a missing button.

## Session 30 — treatment records (the recordings that name the catalogue)

**Started from:** clean tree at session 29's end. Next roadmap item: "Treatments" — the
third row of the workspace's section nav, and the first slice that reads and writes a
second book beside the visit itself.

**Work performed**

- **Types** (`packages/types`): `VisitTreatmentExecutionId` brand; `TreatmentRecord` and
  `TreatmentRecordOutcome` moved into the shared types; `TreatmentCatalogueItem`
  **realigned** — `category` dropped (no such column), `code`/`description`/`duration`
  nullable, `isActive` kept.
- **Domain** (`packages/domain/src/treatment/visit-treatment-records.ts`, + tests):
  `listTreatmentRecords` and `recordVisitTreatment`. Both read the visit first (a foreign
  visit is `NOT_FOUND` for both verbs); the writer reads the treatment second and answers
  `INVALID_INPUT` ("not part of the current clinic's treatment catalogue") for a foreign
  or retired one. Optional `tooth` (FDI) and `notes` ≤2000, blank→null, `performedAt`
  taken from the `Clock` — **no** `treatmentPlanItemId` (Milestone 8), **no** status gate
  (recording on a closed visit is allowed, like notes), **no** `UnitOfWork` (one `save`).
- **Ports**: `TreatmentRepository` (`findActiveById` + `listActive`) and
  `TreatmentRecordRepository` (`findForVisit` + `save`); `Repositories` grew from seven
  to nine — both entries added only once the two implementations existed, per the
  session-23 policy.
- **Validation** (`packages/validation/src/visits/index.ts`, + tests):
  `recordVisitTreatmentSchema` — `treatmentId` required, tooth 1–2 digits,
  `notes` trimmed, ≤2000, blanks dropped.
- **API**: `Drizzle{Treatment,TreatmentRecord}Repository` and the SQLite twins, all
  translating the foreign-key violation (`23503` / `SQLITE_CONSTRAINT_FOREIGNKEY`) into
  `NOT_FOUND`; `GET /api/v1/treatments` (`{ items }`); `GET` and
  `POST /api/v1/visits/:visitId/treatments` (`{ treatments }`), the write failing with
  422 when the catalogue refuses and 404 when the visit is foreign. Route tests in
  `visits-route.integration.test.ts` (PostgreSQL, written and typechecked),
  +1 always-on SQLite smoke test that reads the catalogue, records a treatment through
  the endpoint and reads it back.
- **Seed** (`database/seed.ts`): four catalogue rows (COMPO-ANT with a code, three with
  `code`  null: PROPHYLAXIS, EXTRACTION, LOCAL-ANESTHESIA), one recorded execution row,
  and a SQLite appointment-overlap-trigger idempotency fix so re-seeding a live SQLite
  file does not crash.
- **App** (`packages/app/src/features/visits`):
  - `queries/treatments-query.ts` — `useTreatments` (`['treatments']`, `staleTime`
    60_000) and `useVisitTreatments` (`['visits','treatments',visitId]`).
  - `mutations/use-record-visit-treatment.ts` — non-optimistic; trims `tooth`/`notes`,
    drops blanks; invalidates **only** the records key.
  - `describe-treatment-failure.ts` — `NOT_FOUND` → "This visit no longer exists in the
    current clinic.", `VALIDATION_ERROR`/`DOMAIN_RULE_VIOLATION` → the API's message,
    `NETWORK_ERROR` → "Could not reach the server. The treatment was not recorded."
  - `visit-workspace.tsx` → `VisitTreatmentsSection`: a Radix Select fed by the
    catalogue (labels `code · name`, "no code" honoured), tooth input, notes textarea,
    failure alert, "No treatments recorded yet." / "This clinic has no treatments in its
    catalogue yet" states, `resolveTreatmentName` ("…" while pending; "A treatment no
    longer in the catalogue" when retired). 17 tests in the workspace suite (4 new).
- **E2E** (`e2e/web`): `treatmentsCatalogue`, `existingVisitTreatment`, `recordedTreatment`
  and `visitTreatments()` fixtures; two specs — one that records a treatment and shows it
  only once the server has stored it (asserting the POST body, the 08:00 clinic clock,
  the cleared form, and that the records were read exactly twice), one that the refusals
  keep the clinician's choices.

**Decisions** (written up under "Decisions from session 30" in `STATE.md`)

- The record is deliberately **not** linked to the treatment plan (`treatmentPlanItemId`
  left out, not scaffolded as null), **not** gated on visit status, and `isActive` is not
  enforced on the catalogue lookup: closed visits stay live clinical records, and history
  stays readable.
- Tenancy is inherited: the use case reads the visit first (404) and the treatment second
  (422); both repositories translate the FK violation into the same `NOT_FOUND` the visit
  repos use, so a raw statement cannot write a cross-clinic row.
- The clinic's clock stamps `performedAt`; blanks are trimmed away and never POSTed.
- The client names records only through the live catalogue and invalidates only the
  records key; nothing is optimistic, the section fetches only when open ("fetch what you
  draw").

**Harness lesson (do not repeat).** Playwright's `webServer` serves
`apps/web/dist` via `pnpm --filter @denti-code-u3/web preview` with
`reuseExistingServer: true`; after app code changes the bundle must be rebuilt
(`pnpm run build --filter @denti-code-u3/web`) or e2e runs a stale build. Symptom this
session: `visit-section-treatments` withheld, and one unrelated-looking "completes a
visit" failure was the same stale bundle. Rebuilding fixed all three.

**Verification**

```
pnpm run typecheck        12/12 successful
pnpm run lint             12/12 successful + BOUNDARY GUARD OK (one pre-existing warning)
pnpm run format:check     clean (2 e2e files prettier-fixed; full pnpm run format earlier)
pnpm run guard:boundaries OK (one pre-existing warning)
pnpm run build            5/5 successful
pnpm run test             12/12 tasks — 643 passed (21 new), 215 integration skipped
pnpm run test:integration not run — no Docker/PostgreSQL in this environment
pnpm run test:e2e         94 passed, 0 failed (2 new treatment specs)
```

**NOT done and deliberately.** `treatmentPlanItemId` (Milestone 8), a status gate,
recording by an authenticated clinician (no user model — ADR 0022), and the treatment
plan → execution → charges → payments chain that the roadmap holds next. Charges and
payments are the remaining "Still to do" under the visits milestone.

## Session 31 — prescriptions (the fourth workspace section)

**Started from:** clean tree at session 30's end. Next roadmap item: "Prescriptions — per
visit", the fourth row of the workspace's section nav and the third "per visit" book. The
`prescriptions` table had sat in both baseline migrations since Phase 1, untouched, with
only a scaffold entity and a port stub (removed in session 23 when it had no engines).

**What changed**

- **Domain.** `prescription.ts` holds the entity (nullable `dentistId`, `instructions:
string | null`), `MEDICATION_ROUTES` and the `MedicationRoute` type; the old
  `assertValidPrescription` was deleted as a second copy of the rules that would drift.
  `visit-prescriptions.ts` adds `addVisitPrescription` and `listVisitPrescriptions`:
  both read the visit first (404 for a foreign visit), write inherits `patientId` /
  `dentistId` from the visit, values the course inline (trim + cap, whole days 1–365,
  blank instruction → null), stamps `issuedAt` from the `Clock`, one `save`, no
  `UnitOfWork`. `Repositories` went seven→nine in session 30 and now grew to ten with
  `prescriptions`, once both engines existed.
- **Validation.** `medicationRouteSchema` (a literal enum mirroring the domain's, since
  the validation package may not import the domain) and `createPrescriptionSchema`
  (trim before `min(1)`, 1–200 on the course fields, whole days 1–365, instructions
  optional ≤2000). The registration schema comment is honest about the startup check it
  does not have — it does not repeat the appointments file's claim that a check exists.
- **API.** `DrizzlePrescriptionRepository` + `SQLitePrescriptionRepository`, both
  immutable-style twin implementations: `findForVisit(clinicId, visitId)` scopes through
  `visits`, `save` translates the FK violation (`23503` / `SQLITE_CONSTRAINT_FOREIGNKEY`)
  to `NOT_FOUND`, ordering `issued_at, id`. Wired into `app.ts`, the postgres
  `repositoriesFor` and the sqlite `repositories`; `GET`/`POST
/api/v1/visits/:visitId/prescriptions` added to `routes/visits.ts` beside the
  treatments endpoints.
- **App.** `prescriptions-query.ts` (`useVisitPrescriptions`, key
  `['visits','prescriptions',visitId]`), `use-create-prescription.ts` (non-optimistic;
  invalidates only its key; trims on the way out, blank instruction dropped),
  `describe-prescription-failure.ts`, and `VisitPrescriptionsSection` as the fourth row
  in the data-driven nav (`'prescriptions'`). Routes come from
  `prescription-presentation.ts` (exhaustive `Record<MedicationRoute, string>` over the
  domain enum), the list draws medication · dosage, route label, frequency, days and
  instructions in the clinic's clock, and a refused write keeps the whole draft — route
  included.
- **Seed.** A `prescriptions` row on Luis's open visit in both engines (fixed id,
  Ibuprofen 400 mg oral, 5 days), `seedSummary` now names "1 prescription".
- **Tests.** 15 domain (`visit-prescriptions.test.ts`), 6 validation, 4 workspace
  component tests (fetch-while-mounted; empty-list sentence; file + clear + no
  `['visits']` invalidate; 422 keeps the draft), a SQLite-smoke block, and the
  `visits-route.integration.test.ts` prescription suite (list, file, inheritance,
  ordering, refusals — skips here, no `TEST_DATABASE_URL`). 2 new e2e specs; the
  full-web rebuild got them green (a stale `apps/web/dist` reproduces the session 30
  lesson).

**Verification**

```
pnpm run typecheck        12/12 successful
pnpm run lint             12/12 successful + BOUNDARY GUARD OK (one pre-existing warning)
pnpm run format:check     clean
pnpm run guard:boundaries OK (one pre-existing warning)
pnpm run build            5/5 successful
pnpm run test             12/12 tasks — 672 passed (26 new), PG suite skipped
pnpm run test:integration not run — no Docker/PostgreSQL in this environment
pnpm run test:e2e         96 passed, 0 failed (2 new prescription specs)
```

A live probe against the seeded dev database then exercised the real API: the seeded
prescription served back (GET), a POST inherited `patientId`/`dentistId` and put the
clock on `issuedAt` while storing a blank instruction as null (201), a foreign visit
answered 404, and a blank medication answered 422.

**NOT done and deliberately.** Editing or deleting a prescription; recording a course
that changes the visit or the patient (a prescription does not — so invalidating
`['visits']` would refetch pixels that cannot differ); linking to the treatment plan
(Milestone 8); charges and payments remain the next "per visit" book under the visits
milestone.
