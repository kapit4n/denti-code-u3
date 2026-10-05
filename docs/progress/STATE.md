# CURRENT STATE — Denti-Code U3

> Last updated: session 16 (the desktop app can always be tested:
> `pnpm run desktop:pin` keeps a build that worked and `pnpm run desktop:run`
> launches it without the working tree — plus the CSP fix that made the desktop
> app unable to reach its own API)
> This file is the resume point. Read `AGENTS.md` first, then this file.

## Phase

**PHASE 4 — CLINICAL WORKFLOWS** (Milestone 5 of `docs/roadmap.md`)

**Status: Milestone 4 complete; Milestone 5 in progress.** Session 13 delivered
the agenda's read side — the `AgendaEntry` read model, `AppointmentRepository`,
the Drizzle implementation, `GET /api/v1/appointments`, and the dashboard reading
today's book through the same repository. Session 14 delivered the grid that
consumes it: `/agenda` with day, week and month views, FullCalendar confined to
two adapters and one component by an enforced guard, the clinic's timezone and
opening hours read from the API rather than assumed, and 10 e2e tests that pin
the timezone down. Session 15 delivered the **write side** the grid was waiting
for: `createAppointment`, `rescheduleAppointment` and `transitionAppointmentStatus`
as domain use cases, the three endpoints, and the tenant foreign keys that make
"an appointment's patient belongs to its clinic" a database guarantee rather than
a check somebody can forget (ADR 0018). The grid is still read-only — nothing
calls the endpoints yet — but the server can now refuse a write, which is what a
drag needs before it is allowed to exist.

## Task origin

Single source of truth for the original brief: `docs/progress/BRIEF.md`
(condensed, immutable copy of the 41-section architecture prompt).

## Definition of done for this phase (Milestone 1)

- [x] `docs/architecture.md`, `domain.md`, `frontend.md`, `backend.md`,
      `database.md`, `desktop.md`, `testing.md`, `roadmap.md`, `security.md`,
      `open-questions.md`
- [x] ADRs: 0001 monorepo + pnpm + Turborepo, 0002 Tauri 2 for desktop,
      0003 PostgreSQL only for now, 0004 framework-independent domain,
      0005 REST + Fastify, 0006 feature-oriented frontend,
      0007 TanStack Query vs Zustand, 0008 one React app package with thin
      shells, 0009 platform abstraction, 0010 Tailwind v4 + shadcn design
      system, 0011 FullCalendar as a view adapter, 0012 appointment end time is
      computed and never stored, 0013 shells declare a target and the shared app
      owns everything else, 0014 clinic scoping is explicit and never inferred
      from ambient state, 0015 patient record numbers are allocated by the server,
      per clinic and atomically, 0016 patient name search folds accents, 0017 the
      agenda filters by overlap and counts only minutes inside the day, 0018 the
      appointment write side, 0019 keep the last desktop build that worked
- [x] pnpm + Turborepo workspace that installs cleanly
- [x] TypeScript strict everywhere (base + per-package configs)
- [x] ESLint (flat config, ESLint 9) + Prettier + boundary guard wired into
      `pnpm run lint`
- [x] `packages/ui`, `domain`, `api-client`, `types`, `validation`, `config`,
      `app`, `tsconfig`
- [x] `apps/api` boots, validates env with Zod, structured logs, `/health`
- [x] `apps/web` builds and serves the shared React app
- [x] `apps/desktop` is a Tauri 2 shell over the same React app
      (frontend build verified; **native Rust build still unverified**)
- [x] PostgreSQL (docker compose) + Drizzle schema + migrations applied, plus
      the appointment overlap exclusion constraints
- [x] `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`,
      `pnpm build` all pass
- [x] Vitest + RTL + Playwright foundations present
- [x] `docs/progress/REPORT.md` with the 13-section final report

## Verification log (last run, session 18)

| Command                     | Result                                              |
| --------------------------- | --------------------------------------------------- |
| `pnpm run typecheck`        | 12/12 tasks pass                                    |
| `pnpm run lint`             | 12/12 tasks pass, `BOUNDARY GUARD OK`               |
| `pnpm run format`           | applied; `pnpm run format:check` clean              |
| `pnpm run test`             | 12/12 tasks pass — 442 tests (9 new)                |
| `pnpm run test:integration` | 11 files, 136 tests pass against real PostgreSQL 17 |
| `pnpm run build`            | 5/5 tasks pass                                      |
| `pnpm run test:e2e`         | 60 passed (no UI moved this session)                |
| `pnpm run guard:boundaries` | OK                                                  |
| `pnpm run db:migrate`       | no migration needed — this session adds no column   |

Per-package unit/component tests: domain 154, validation 50, api-client 15, api 58
(integration skipped here, run separately), app 162, desktop 3.

**Two assertions in the new integration test were wrong before the code was, and the
defect check caught them.** The first version named the clinicians `Dr. Álvaro` and
`Dra. Ñuñez` and asserted a folded order — which passes with _or_ without folding,
because the shared `Dr.`/`Dra.` prefix decides the comparison before the accent is
reached. Rewritten without a common prefix (`Álvaro Núñez` sorts before
`Beatriz Ñaupari` only when the `Á` is folded), it then failed as it should when the
folding was removed. The lesson is the same one the e2e specs learned: an assertion
that cannot fail is not an assertion.

**Two of this session's own tests were wrong before the code was.** The first
version of the drag spec asserted that the drop sent `17:00Z` — the _end_ of the
dropped range, read off the fixture instead of the intent — and expected two
requests where the invalidation correctly makes three. Both failures were in the
assertion, not in the write: the third request is the range being re-read, which is
the behaviour item 6 claims. The stub could not see the request method, so a write
and the read it triggers were answered by the same fixture; `renderCalendar` now
passes the request to the reply, which is what let the test tell them apart.

**A silent failure found by the need for this session's feature, not by a test.**
The desktop app could not reach its own API. `API_PORT` moved from 3000 to 3010 in
session 8 and `API_PORT`, `VITE_API_URL` and the Zod defaults all moved with it —
but the CSP in `apps/desktop/src-tauri/tauri.conf.json` did not, and nothing reads
that file. The webview therefore blocked every request the desktop app made: a
shell that rendered correctly over an empty agenda, with nothing in any log and no
error to follow. No web test could have found it, because the browser deployment
has no such gate; and the failure looks identical to a bug in the app rather than
in its host configuration.

`apps/desktop/test/tauri-config.test.ts` now asserts the CSP's `connect-src`
allows the origin `.env.example` names, and refuses `*` or `unsafe-eval`. The
assertion was verified the way this project verifies guards: by putting port 3000
back and watching it fail.

**Three things this session proved rather than assumed.**

1. **The race the domain cannot see.** Two `POST /api/v1/appointments` for the same
   slot are launched at once in
   `apps/api/test/appointment-write-route.integration.test.ts`. Each asks the
   repository what is in the window, each is told "nothing", and each proceeds —
   both are correct. The exclusion constraint is the only thing that sees both, and
   the test asserts the result is one 201, one 409 `SCHEDULING_CONFLICT` and one row.
   Without the `23P01` translation the loser would have been a 500, which is what
   `isExclusionViolation`'s unit test exists to prevent.
2. **Tenant isolation is now a database fact.** `0002_appointment_tenant_foreign_keys`
   makes the patient, dentist, chair and room references composite over
   `(id, clinic_id)`. Proven by hand against the running database: an insert naming
   clinic B's patient from clinic A's book is refused by
   `appointments_patient_same_clinic_fk`, and so is clinic B's chair. The API's
   clinic scoping (ADR 0014) could not have caught this — it is a rule about which
   rows may be combined, and the combination happens in a table.
3. **The constraint caught a real fixture.** The agenda integration test had been
   inserting a booking in the other clinic's book, with that clinic's patient and
   that clinic's chair, but with _this_ clinic's dentist — permitted by the old
   single-column foreign key, and the exact leak the new one closes. It now passes
   `dentist: null` with a comment saying so.

**Three corrections to earlier claims in this file.** `AgendaEntry` has carried
`chairId` and `chairName` since session 13; the pending item below said otherwise.
A booking that consumes no identifier is now true only for the two rules decided
before the id is allocated (duration, opening hours) — a conflict check needs the
candidate's own id to exclude itself, and the use case says so. And ADR 0018 was
written claiming no `roomId` on the write side while the create schema accepted one
and the repository wrote it: a booking could be given a room it could then never be
shown and never moved from, which is the "answered with silence" fault the same ADR
removes `treatmentId` for. The input is gone, the column and the constraint stay, and
the chair is the resource the write side accepts because it is the one the read model
reports.

**One known gap, recorded rather than hidden.** A lunch break
(`clinic_operating_hours.break_starts_at` / `break_ends_at`) is not enforced: the
columns exist, the domain's `ClinicOperatingHours` does not carry them, and nothing
in the product exposes them yet. A booking may span a configured break.

**Also fixed in passing.** `apps/api/src/http/routes/appointments.ts` validates its
path parameter with `uuidSchema`; a hand-typed id in the URL is a 422 rather than
PostgreSQL's `22P02` arriving as a 500. The patients route still does not, which
is a small pre-existing gap and was left alone rather than widened into.

**The emergency-booking question is now written down** as #16 in
`docs/open-questions.md`, with the lunch break as T7, because ADR 0018 points at
both and neither existed yet.

## Decisions made this session (not yet in ADRs)

- **The booking rule's wiring is ADR 0020, and the reason it needed one is the
  second-order part.** Adding `dentists` and `chairs` to
  `AppointmentWriteDependencies` had three possible shapes, and the obvious one —
  make them optional so the status transition is not handed repositories it does
  not use — deletes the guarantee quietly: `if (dentists)` becomes "run the rule
  if somebody remembered to wire it". Instead the dependencies split into
  `AppointmentWriteDependencies` (four, every write) and
  `AppointmentBookingDependencies` (adds the two, required, for create and
  reschedule). The compiler then caught three files that were constructing the
  appointment routes without them, including two test harnesses that would
  otherwise have tested a booking path with no rule in it.
- **A reschedule of an appointment whose clinician was deactivated afterwards is
  refused.** The clinic was told this and accepted it. The alternative — "you may
  keep a name you already used, but not introduce a new one" — makes an inactive
  clinician permanently bookable to anyone who books once and then only drags,
  needs the existing row in hand to evaluate at all, and cannot be explained to a
  receptionist in one sentence. So moving an appointment whose clinician has left
  fails with the clinician's name in the message, and the way forward is
  reassigning it.
- **A name the rule cannot find is left to the foreign keys.** `findById` cannot
  distinguish an absent id from another clinic's and must not (ADR 0014), so the
  rule stays silent and the tenant FK answers 422 as it always did. Two answers
  for one bad reference means one of them is wrong; this keeps the existing one.
- **`UNBOOKABLE_RESOURCE` is its own domain code.** `INVALID_INPUT` for a booking
  that named a real, existing, deactivated clinician sends whoever reads the log
  looking for a malformed body. Same reasoning as `OUTSIDE_OPERATING_HOURS`: the
  domain names the reason precisely and the API folds it into one wire code.
- **Two endpoints, not one "booking options" endpoint.** Dentists and chairs are
  two resources with two independent lifetimes, and the form's dentist dropdown has
  no reason to be invalidated when a chair is renamed. A single endpoint would make
  each of them wait on the other, and would be a shape named after a screen.
- **The ports were corrected against the schema, not implemented as written.**
  `DentistSummary.specialties`, `defaultChairId` and `ChairSummary.kind` cannot be
  filled from any column. Implementing them would have meant inventing three
  migrations to satisfy a type written before anyone looked at the tables; dropping
  them costs nothing and records the truth. This is the same argument as the
  `AppointmentRepository` port losing its five speculative methods in session 13.
- **No client query hooks were added.** `useDentists`/`useChairs` would have no
  caller until the booking form exists, and this project's rule is that a hook with
  no caller is a promise the first consumer has to keep or break loudly.
- **The seed was extended rather than the endpoint designed around the seed.** An
  endpoint returning an empty list in the only database anyone will open is not a
  working feature, so the seed gained 2 rooms and 4 chairs and the appointments are
  now seated in them.
- **A `.sh` entry point for the fallback, not a second implementation of it.**
  `scripts/run-desktop.sh` runs the newest kept build (or a numbered one) and
  delegates to `scripts/desktop-pin.mjs`, so the shell script and
  `pnpm run desktop:run` cannot drift. It calls `node` directly rather than
  `pnpm`, and resolves the repository from its own location, because the useful
  moment for a fallback is the moment the toolchain is not cooperating.
- **The native build is a kept artifact, not a rebuild (ADR 0019).** `desktop:pin`
  runs `tauri build --debug --no-bundle` and keeps the binary in a gitignored
  directory with a manifest; `desktop:run` executes that file and never compiles.
  The debug profile is deliberate: the frontend inside is still a production
  build, and a command that takes minutes is a command nobody runs often enough to
  keep a fallback current. `tauri dev` cannot be kept at all — it serves the assets
  from the working tree, so the copy would break exactly when it was needed.
  Pinning is manual because a build that compiles is not a build that works.

- **A booking is always created `SCHEDULED`, and confirming is a separate call.**
  A create form that could confirm would be recording an agreement the patient
  never made. Same reasoning as the server-allocated record number (ADR 0015): the
  fact belongs to the only party that knows it.
- **`Appointment.dentistId` is `DentistId | null`, and `Appointment.clinicId` is
  `ClinicId`.** The column is `on delete set null`, so a booking outlives its
  dentist; a reader that had to invent an id would put a fiction in the middle of a
  calculation, and a null dentist holds no dentist resource. `clinicId` moves the
  other way so an appointment cannot be written for a clinic nobody named.
  `startVisitFromAppointment` now refuses an appointment with no dentist rather than
  attributing a visit to nobody.
- **The tenant foreign keys are composite, and the migration is hand-ordered.**
  Drizzle emits the foreign keys before the `UNIQUE` constraints they point at, and
  PostgreSQL validates a key's target when adding it, so the statements were
  reordered. The three nullable references use `ON DELETE SET NULL (column)` rather
  than plain `SET NULL`: without the column list, deleting a dentist would try to
  null `clinic_id` too and the row would be refused by its own `NOT NULL`, so a
  dentist could never leave a clinic with appointments behind them. That form needs
  PostgreSQL 15+; `docker-compose.yml` pins 17. Verified on a live database both
  ways.
- **The write endpoints answer with the `AgendaEntry` the row became**, not with the
  values that were sent, so a client splices the server's row into its cache instead
  of reconstructing one. Same reasoning as ADR 0011's server answer for the read.
- **`treatmentId` and `roomId` are not accepted on a booking.** `appointments` has no
  `treatment_id` column, and the read model does not report a room. A field the API
  stores but never returns is a form answered with silence, which is worse than a
  form without the field — so the booking request declines both, the schema drops
  them, and the columns stay as the table has them. The chair is the test: the write
  side accepts exactly the resources `AgendaEntry` reports.
- **The API port is 3010, not 3000.** Port 3000 is occupied on this machine by an
  unrelated local Next.js app. `API_PORT`, `VITE_API_URL` and the Zod defaults
  were all changed together so nothing silently points at the wrong service.
- **The appointment end time is computed by an IMMUTABLE SQL function, not
  stored** (ADR 0012). A generated column is impossible (`timestamptz + interval`
  is `STABLE`, not `IMMUTABLE`) and a trigger-maintained column had to stay invisible
  to the Drizzle schema, which made `drizzle-kit push` a threat to the constraint
  protecting the schedule. The exclusion constraints now call
  `appointment_ends_at(starts_at, duration_minutes)`, so there is no stored end
  time to go stale and the schema is the complete physical picture again.
- **ESLint is pinned to 9.39.1.** `eslint-plugin-react@7.37.5` declares a peer of
  ESLint `^9.7` and crashes on ESLint 10 (`contextOrFilename.getFilename is not a
function`). ESLint 10 buys nothing here.
- **The integration database is created by the test run, not by hand.** A wiped
  Docker volume used to mean `test:integration` failed with "database does not
  exist". Vitest `globalSetup` now creates `TEST_DATABASE_URL` if it is missing.
- **The boundary guard reads the import graph, not just manifests.** A manifest
  cannot prove where an import happens, and the previous version silently allowed
  a `@denti-code-u3/tsconfig` dependency. It now scans every source file and
  fails on a forbidden import, a database driver outside the API, or a route file
  inside a deployment shell.

### Decisions from session 8 (M3 + M4)

- **Clinic day boundaries are resolved in the API, from the clinic's own
  timezone.** Reporting windows are application-layer calendar arithmetic
  (`apps/api/src/application/clinic-time-window.ts`), not SQL and not client-side
  formatting. The clinic row is authoritative; `CLINIC_TIMEZONE` is only a
  fallback for when it cannot be read. Two clinics served by one process must not
  share a clock.
- **The patient profile is one request, not five.** The endpoint returns the
  record plus allergies, next appointment, recent visits, outstanding treatments
  and balance together. A profile assembled from five calls renders half-empty in
  practice, and it makes the clinic-scoping guarantee auditable in one place.
- **Patient list state is component state, not router search params.** The
  installed `@tanstack/router-plugin` (1.167.x) generates a route tree without the
  `Register` augmentation `@tanstack/router-core` 1.171 reads, and the generated
  file carries `@ts-nocheck` — so search-param typing degrades to `any`
  _silently_. Rather than paper over it with casts, list state is local and
  explicitly typed. Revisit when the plugin is upgraded. See `docs/open-questions.md`.
- **`patients.tsx` and `patients_.$patientId.tsx` are flat siblings, not nested.**
  The underscore opts out of nesting, so the profile does not have to render
  inside the list via an `<Outlet />`.
- **`pnpm run db:seed` creates the clinic at a fixed UUID** that matches
  `CLINIC_ID` in `.env.example`. A generated id would have to be copied into
  `.env` by hand, and a stale `.env` silently scopes the whole API to a clinic
  that does not exist.
- **`VITE_API_URL` must include `/api/v1`.** `ApiClient` concatenates paths onto
  the base URL verbatim, so the version prefix is part of the configured value.
  Documented in `.env.example`, because getting it wrong 404s every request while
  the shell still renders.

### Decisions from session 12 (patient read side)

- **The patient read side goes through `PatientRepository`, like the write side.**
  `search`, `findProfile` and `findOdontogram` were Drizzle queries written inside
  the route handlers, and each one had to remember the clinic filter and the
  withdrawn-record filter for itself. The odontogram's existence check had in fact
  been written without `anonymized_at is null`, so a withdrawn patient's chart was
  reachable at a URL whose profile had already stopped answering. A filter that only
  exists because someone remembered it is a filter that will be forgotten. The port
  cannot express a query without a `ClinicId`, so the class of mistake is now a
  compile error rather than a review item.
- **Read responses name their fields instead of spreading a database row.** The
  profile used to be `{ ...patient, ... }`, which published `anonymizedAt` on every
  load and would have published any column added to `patients` later. `PatientProfile`
  lists what it returns, so a new column is invisible until someone adds it on
  purpose.
- **`undefined` and `{ entries: [] }` mean different things.** A missing patient and
  a real patient with an uncharted odontogram are not the same answer — one is a
  404, the other is an empty chart. A bare array could not express the difference,
  which is why `PatientOdontogram` is an object.
- **Name search folds accents explicitly, on both sides (ADR 0016).** The database
  is `C`-collated on purpose, so `lower()` does not fold `Ñ` and sorting puts `Ñuñez`
  after `Patient`. For a clinic that finds patients by typing, searching for `nunez`
  and finding nothing reads as "this patient is not in our system".
- **Response shapes live in the domain, not in Zod.** The frontend had hand-copied
  nine interfaces from the API; `usePatientOdontogram` had drifted to expect `items`
  where the API returns `entries` and nothing caught it, because no screen calls
  that hook yet. The `packages/validation` response schemas were worse: unused, and
  describing `{ data, meta }` and a `fullName` no endpoint has ever sent. Deleted
  rather than corrected — a second declaration of a response shape is a second
  thing to keep in sync. Zod is for requests, which is what it is now used for.

## Open questions

See `docs/open-questions.md`. The Phase 1 question about the hidden `ends_at`
column is **closed** by ADR 0012. Still open:

- **A release build and the installers are unverified.** A native _debug_ build
  completes and runs on this machine (session 16: ADR 0019), and the webview
  bundle's output is byte-identical to the web build. `tauri build` in the release
  profile, and the `deb`/`msi`/`app`/`dmg` bundles, have not been run. Nothing in
  manual testing depends on them; signing and packaging do.
- **The desktop app can always be launched, but nothing asserts that it works.**
  `pnpm run desktop:pin` / `desktop:run` (ADR 0019) means a broken tree never
  stops a test session. What is missing is coverage of the desktop app's own
  behaviour: the CSP is guarded by a test, and the next silent failure of that
  shape would be as invisible as the last one.
- **`design-mockup/dashboard-design.png` has not been analysed.** The provisional
  brand palette in `packages/app/src/styles/globals.css` needs to be confirmed
  against the supplied reference before any feature work begins.
- **A repository still cannot _structurally_ forget the scope, and the
  integration tests prove the profile route does not leak across patients or
  clinics — but scope comes from ambient configuration until auth lands. **This is
  a single-clinic assumption, not multi-tenancy.**
- **Patient phone is returned by the list endpoint while its column comment says
  it is encrypted and never returned by list endpoints** (`database/schema/patient.ts`).
  The column is plain `text`; the comment describes an intent the code does not
  implement. Nothing reads phone for authorisation, so nothing leaks today, but the
  two disagree and one of them has to change before any external access exists.
- **The desktop shell has no native capability implementations yet.** It reports
  `hasNativeShell: true` from its declared target, but `saveFile` and OS-level
  `openExternal` still reject with `PlatformUnsupportedError`. Nothing consumes
  them yet; the seam is `mountApp({ capabilities })` when a feature needs one.

## Remaining work

**Milestone 3 — DASHBOARD.** Functionally complete, API-driven, and now covered
by committed e2e specs. Remaining:

1. [x] `pnpm run build` and `pnpm run test:e2e`, run at the end of the session
       after implementation (both green).
2. [x] Promote the throwaway browser script into committed e2e specs:
       `web/dashboard.spec.ts` (9) and `web/patients.spec.ts` (10), against a
       fixture-backed mock API. Each spec was verified by reintroducing the
       defect it guards and confirming it fails — see the verification log.
3. [ ] Extend the e2e layer when Milestone 5 lands: appointment lifecycle, visit
       workspace, agenda views.

**Milestone 4 — PATIENTS.** Functionally complete on both sides: searchable
paginated list, global search, profile with allergies / next appointment / visits /
outstanding treatments / balance, the odontogram endpoint, registration and
editing. Both sides now go through `PatientRepository`. Remaining:

1. [x] **Patient registration** (create). `registerPatient` use case,
       `PatientWriteRepository` port, Drizzle implementation with an
       atomic per-clinic record number, `POST /api/v1/patients`, the
       `createPatientFormSchema` + React Hook Form form at `/patients/new`, and
       both "New Patient" actions enabled. Record numbers are server-assigned and
       sequential per clinic: `P-000001`, `P-000002`, … Never sent by a client.
2. [x] **Patient editing.** `updatePatient` use case, `PUT /api/v1/patients/:id`,
       and the form at `/patients/$patientId/edit`, reached from an "Edit details"
       action on the profile. The write is a **PUT, not a PATCH**: the body carries
       every editable field, so clearing a field clears it. `recordNumber`,
       `isActive`, `createdAt` and `anonymizedAt` cannot be touched — absent from
       the body type, absent from the Drizzle `SET` list, and asserted in the
       integration tests. Anonymised records and other clinics' patients answer 404.
3. [x] **Read side behind the repository.** `search`, `findProfile` and
       `findOdontogram` moved out of the route handlers into `DrizzlePatientRepository`,
       which `apps/api/src/http/routes/patients.ts` now calls with nothing but a
       clinic id. That file no longer imports a database driver, and a withdrawn
       patient's chart — which used to be reachable, because the existence check
       written in the handler omitted `anonymized_at` — now answers 404.
4. [ ] **Quick actions** on the dashboard: "New Patient" is live; "New Visit"
       stays disabled until the agenda forms arrive with Milestone 5.
5. [ ] Appointments list/creation, visit capture and the clinical timeline, which
       the roadmap lists under M4 but which are the natural output of M5.

**Milestone 5 — AGENDA AND VISITS.** Slice 1 (the agenda's read side) is done:

1. [x] **Agenda read model and port.** `AgendaEntry` and `AgendaWindow` in
       `packages/domain/src/appointment/agenda-read-model.ts`;
       `AppointmentRepository.findAgenda(clinicId, window)` and nothing else.
       The port's five speculative methods are gone; the scheduling methods return
       with the write side.
2. [x] **`GET /api/v1/appointments`.** Half-open `[from, to)`, optional
       `dentistIds` / `chairIds`, 366-day ceiling, standard problem envelope. The
       window is interpreted as given: which days a user means is a calendar
       timezone question, answered in the UI.
3. [x] **Dashboard reads through the same repository.** One implementation of
       "today" instead of two. See ADR 0017 for why booked minutes are clipped to
       the window: counting an appointment that began yesterday evening against
       today's capacity would report a day as over 100% booked.
4. [x] **Calendar UI (read side).** `/agenda` renders `timeGridDay`,
       `timeGridWeek` and `dayGridMonth` of `GET /api/v1/appointments`.
       FullCalendar is confined to `adapters/to-calendar-event.ts`,
       `adapters/to-business-hours.ts`, `adapters/from-calendar-event.ts` and
       `components/agenda-calendar.tsx` by rule 5 of
       `scripts/check-boundaries.mjs`, which fails the build on any other
       `@fullcalendar/*` import in `packages/app/src`.

       - The **visible window is the fetch window**: FullCalendar's own
         `datesSet` reports the range, so a month grid asks for a month. There
         is no second opinion about which days are on screen.
       - **No `placeholderData`.** Navigating to tomorrow must not paint
         today's appointments under tomorrow's dates; an empty grid with a
         loading hint is the honest answer.
       - **The timezone and opening hours are inputs, not constants.** They
         come from `GET /api/v1/clinic` (added in session 15, with
         `DrizzleClinicRepository`), because one API serves several clinics.
         Without a clinic the route renders an error instead of a grid in the
         browser's own zone.
       - **ISO weekdays are translated.** The domain says `1 = Monday …
         7 = Sunday`; FullCalendar wants `0 = Sunday … 6 = Saturday`.
       - **Statuses are colour, cancelled and no-show included.** They are
         drawn struck through and muted, because a slot that is deliberately
         empty must not look bookable.
       - Read-only **as built in session 15**, deliberately: `editable` and
         `eventClick` were not wired, because a control that looks live and is
         not is worse than an absent one. The grid became writable in session
         17, once the API could answer a write (item 6). `selectable` —
         clicking an empty slot to book it — is still deliberately unwired, for
         the reason in item 6: there is no form to open yet.

5. [ ] **Filters.** Dentist and chair filters are in `AgendaWindow` and the API
       accepts them, but nothing in the UI sends them yet. (`AgendaEntry` has
       carried `chairId`/`chairName` since session 13 — an earlier note here said
       otherwise.) Room columns still need a `roomId` the read model does not have,
       and the `room_no_overlap` constraint has no read side at all.
6. [~] **Appointment write side.** API done in session 15: `createAppointment`,
   `rescheduleAppointment`, `transitionAppointmentStatus`, the three endpoints,
   the tenant foreign keys, and 25 integration tests including the concurrent-write
   race. **Reschedule and status UI done in session 17:**

   - **`adapters/from-calendar-event.ts`** — the only place a FullCalendar
     gesture becomes a domain intent. A drag sends **only** `startsAt`: a
     gesture has not restated the length, so the chair cannot be cleared on the
     way past. A resize sends `durationMinutes`, but only when the rounded
     length actually differs from the original. A gesture that changes nothing
     sends nothing. Instants cross as UTC. The file imports no FullCalendar
     package — the drop/resize shape is declared structurally — so
     `scripts/check-boundaries.mjs` needed **no** widening, which is the
     visible proof that ADR 0011's boundary holds.
   - **Per-event editability.** `eventStartEditable` / `eventDurationEditable`
     come from the domain's `isScheduleEditable`, so a confirmed past
     appointment does not offer a drag the API would refuse.
   - **`AppointmentQuickPanel`** — a clicked appointment, its clinic-time span,
     and only the transitions the domain allows from there, each labelled with
     that transition's own verb. Cancelling asks for a reason first: the reason
     is part of the write, and a cancellation is the one move that cannot be
     undone by re-booking the same slot. The panel closes only after the server
     agrees; on a refusal it stays open and says what went wrong.
   - **`describeAppointmentFailure.ts`** — one voice for a conflict and for a
     rule refusal, plus `scheduleConflictSchema` in `packages/validation` so the
     client's reading of the API's `details` is checked rather than assumed. A
     conflict is stated as the hour that is taken, in the clinic's zone: that is
     what the receptionist goes and looks at.
   - **Non-optimistic, and it redraws.** No write touches the cache; the
     mutation invalidates the agenda range, the dashboard and the affected
     patient profile, then the grid re-renders from the API's answer. A refused
     gesture calls FullCalendar's `revert()`, because the server is the only
     authority on what is in that chair. This is ADR 0007 applied to a gesture.
   - **`format-clinic-time.ts`** — the clinic's zone is an input, from
     `GET /api/v1/clinic`, so the panel's times are the clinic's and not the
     browser's. Verified where it bites: the e2e runs in `America/New_York` and
     asserts `09:00 – 10:00` for a `14:00Z` appointment in Lima.
   - **Tests: 58 new unit/component, 5 e2e.** The e2e deliberately **does not
     drag.** What a drag _means_ is pinned down by unit and component tests,
     where a gesture is a function call; a headless pointer drag across a time
     grid asserts pixel offsets, so a failure there would be about
     FullCalendar's layout rather than about this application.

   - **The booking form's blocker is gone** (session 18): `GET /api/v1/dentists`
     and `GET /api/v1/chairs` now name the two things a booking is made against.

   **The bookable resources, session 18.** `GET /api/v1/dentists` and
   `GET /api/v1/chairs`, with `DrizzleDentistRepository` and
   `DrizzleChairRepository` behind the ports that had been declared since
   session 8 with nobody calling them.

   - **The ports were wrong and were corrected rather than implemented as
     written.** `DentistSummary` promised `specialties: string[]` and
     `defaultChairId`, and `ChairSummary` promised `kind` — none of which any
     column can supply (`dentists.speciality` is one text value, and there is
     nowhere to store a default chair). A port describing a table that does not
     exist is not a design; it is a guess the first implementer has to either
     invent a migration for or quietly drop. It was dropped, in writing.
   - **`licenceNumber` is deliberately not returned.** A list of bookable
     clinicians has no use for it, and a shape that returns the whole row is a
     shape that eventually gets sent somewhere it should not be.
   - **`onlyActive` defaults to _no filter_,** the same default the patient list
     uses and for the same reason: a clinician who has left still appears on the
     appointments they worked, and hiding the row leaves those naming nobody. An
     unreadable flag is a 422 rather than being read as `false`.
   - **Names are sorted folded, and that is load-bearing.** The database runs
     `--locale=C`, so `Álvaro Núñez` sorts _after_ `Beatriz Ñaupari` on byte
     value. The accent folding moved out of the patient repository into
     `persistence/postgres/fold-accents.ts` rather than being copied — two copies
     of an accent table is one of them going stale. It came with a guard: the
     comment in the patient repository promised an `unaccentedAlphabet()` check
     that did not exist, and the two strings' equal length is now a test instead.
   - **`roomName` is joined, not left as a uuid.** "Sillón 3" identifies nothing
     in a clinic with three rooms. The join is a `LEFT JOIN`, because
     `chairs.room_id` is nullable and an inner join would hide every unassigned
     chair from the list of bookable chairs.
   - **12 integration tests,** each of the two load-bearing ones verified by
     reintroducing the defect: removing the folding fails the ordering test, and
     turning the left join into an inner join fails three.
   - **No rule about who may be booked.** `isActive` is returned as a fact and
     nothing enforces it, because `createAppointment` does not look at it — which
     means a client that hides the inactive ones is currently the only thing
     stopping it. That is a rule in the browser, and it is now recorded as
     product question 17 rather than decided here.

   - **Product question 17 is answered and the rule exists (session 19).** No: an
     inactive clinician or chair cannot be booked. `bookable-resources.ts` refuses
     with `UNBOOKABLE_RESOURCE`, which the API folds into `DOMAIN_RULE_VIOLATION`
     (409), and the message names the resource. `onlyActive` still defaults to _no
     filter_ on the two lists — a clinician who has left stays visible on the
     appointments they worked. See ADR 0020 for how it is wired, which is the
     part worth reading.

   **Still to do: the booking form** — not started, no longer blocked. The form,
   the empty-slot click (`selectable`), and the "New Visit" and next-appointment
   actions it un-disables follow from the two lists above. `api-client` write
   methods for the three endpoints are called directly by the mutations, as
   every other feature does.

7. [ ] Visits, the clinical timeline, treatments, payments, inventory, reports.

**Milestone 5 onward** — visits, odontogram, treatments, payments, inventory,
reports, auth: not started.

## Last session log

Session 1: started from an empty repository (only a stub `package-lock.json`).
Inspected the machine (Node 22, npm 10, no pnpm on PATH → installed pnpm 10 to
`~/.local`, Docker 29.8 available, cargo 1.97, no psql client). Began Phase 1.

Session 3: resolved the last Phase 1 correctness question. The appointment end
time is now computed by the IMMUTABLE function `appointment_ends_at` and the
hidden `ends_at` column plus its trigger are gone, so the Drizzle schema is again
the exact physical picture of the database — verified by `drizzle-kit generate`
reporting no changes. The migration chain was regenerated as a clean baseline
(`0000_baseline.sql`, `0001_appointment_overlap_guard.sql`). Added ADR 0012, a test
proving a reschedule is re-checked by the constraint, and a Vitest `globalSetup`
that creates the integration database so a wiped Docker volume is one command to
recover from.

Session 2: completed Milestone 1. Implemented the shared React app
(`AppRoot`, platform abstraction, design tokens), the typed API client with 14
tests, the full Drizzle schema (23 tables), the Fastify server with validated
config, redacting structured logs and a single error envelope, the migration and
seed tooling, and the appointment overlap guard as a real PostgreSQL exclusion
constraint proven by 4 integration tests. Rewrote the boundary guard to scan the
import graph. Whole-workspace typecheck, lint, format, tests and build are green.

Session 4: Milestone 2 step 1. Wired TanStack Router, TanStack Query and the
`ApiClient` into `packages/app` behind a single `mountApp` entry point, and reduced
both shells to `mountApp({ target })`. The browser suite then exposed three defects
that every unit test had passed straight through: the desktop app reported itself
as `Web` because a present-but-empty router context suppressed the default, the app
never saw `VITE_API_URL` because Vite resolves `.env` against the shell root rather
than the monorepo root, and the gitignored route tree made a fresh clone fail
typecheck. Fixed all three, recorded the reasoning in ADR 0013, and added 15 tests
covering the mount contract, the provider identity guarantees and capability
defaulting. Suite: 165 unit, 5 integration, 5 e2e, all green.

Session 5: Milestone 2 design foundation. Analysed `design-mockup/dashboard-design.png` and aligned the application palette to the dark navy sidebar (#0F1F3D) with light workspace (#F8FAFC) per the provisional spec. Extended `packages/app/src/styles/globals.css` with semantic tokens (primary/secondary/accent/destructive, sidebar, charts, status) and dark theme variants. Added core shadcn/ui primitives to `packages/ui`: Button, Input, Label, Dialog, Select, Table, Toast/Toaster/useToast with Radix dependencies. Primitives are exported from the package API, typecheck/lint pass, and all workspace checks (typecheck/lint/format/test/build) are green.

Session 6: Completed Milestone 2B — built shared application shell (sidebar, header with global search/user menu/theme toggle/notifications), added ThemeProvider with persisted preference, implemented not-found route and ErrorBoundary. Restructured to keep AppRoot frame compatible with existing tests. All 30 app tests pass; workspace typecheck/lint/format/test/build green.

Session 7: Milestone 3, the dashboard. Built the read model first — appointments
today with patient names, status grouping, revenue from `payments.amount_minor`
(the `appointments` table has no `total` column, so the first attempt at
"revenue today" was reading a column that does not exist), active patients,
pending treatment items, occupancy derived from real operating hours and active
dentists rather than a hard-coded capacity, and a calendar aggregation. Then the
shared-app widgets on top of it. `packages/app/src/routes/index.tsx` was restored
as the FoundationStatus page because existing tests assert that route.

Session 8: Milestone 4 plus a correctness pass on Milestone 3. Built the patient
read side: searchable paginated list, global search, and a single-request profile
carrying allergies, next appointment, recent visits, outstanding treatments and
balance; plus the odontogram endpoint. `pnpm run db:seed` now creates a clinic at
a fixed UUID with operating hours, dentists, patients, appointments, a visit, an
accepted treatment plan, charges and partial payments, so the dashboard and the
profile have real data instead of an empty database.

The session then turned into a defect hunt, because the code typechecked and
passed its own tests while returning confidently wrong answers. Six defects,
listed under "Verification log" above, each producing plausible output rather
than an error: treatments scoped by clinic but not by patient (a data-privacy
bug), collection queries destructured to their first row and then to `undefined`
when empty, "today" drawn at UTC midnight, `VITE_API_URL` missing `/api/v1` so
every request 404ed, `/patients/:id` rendering the list because the parent route
had no `<Outlet />`, and a header search box bound to local state while the
working search component sat unmounted. Each was found by running the app and
reading the rendered output, not by reading code. Fixed, and covered: 9 unit
tests for the clinic-time window maths (both DST directions), 5 integration tests
driving the real patient route through Fastify `inject` against PostgreSQL, and
config tests for the now-required `CLINIC_ID`. Verified by hand in a real browser:
dashboard, list, both profiles and the global search all render with a clean
console. `pnpm run build` and `pnpm run test:e2e` were deferred at the user's
request and remain owed.

(End of file - total ~260 lines)

Session 9: documentation and end-to-end coverage for Milestone 3 and the Milestone 4
read side. Promoted the throwaway browser script into committed Playwright specs
(9 dashboard, 10 patients) against a fixture-backed mock API, and fixed three
defects in the harness itself. The valuable one: the mock was registered per
endpoint, so a request carrying a query string matched nothing, the specs missed
every real request, and they still passed — because a dev API was answering on port 3010. A spec that quietly talks to a live database is not a spec.

Session 10: patient registration, the write side of Milestone 4. Started with the
record number rather than the form, because that is the part with a correctness
requirement: numbers are per clinic and sequential, so allocating one has to be
atomic. The first port was `save(patient, {recordNumber})` plus
`nextRecordNumber(clinicId)`, which cannot express the guarantee — a caller can
drive two calls and a lock cannot span them. Reduced it to one
`register(patient)` method that owns the transaction, with a transaction-scoped
advisory lock keyed on the clinic, so two receptionists registering at once cannot
collide and the unique index cannot reject one of them at the desk. Verified by
removing the lock: 3 of 5 simultaneous registrations then fail. That test needed a
connection pool wider than one, because with `max: 1` the driver serialises the
transactions and the race cannot happen at all — the first version of the test
passed against code with no lock in it, which is worse than no test.

Two more defects found by testing rather than by reading. The collision fallback
was dead code: reading `error.code` returns `undefined` for every real database
failure, because Drizzle rethrows driver errors wrapped with the original on
`cause`, so a conflict would have surfaced as a 500. And on the client, an
untouched optional input submits `''`, which the API rejects with the same `min(1)`
that stops a blank name being stored — so a patient who gave only a name could not
have been registered at all. Fixed by deriving `createPatientFormSchema` from
`createPatientSchema.shape` rather than restating the fields, so the form accepts
exactly what the API accepts; a test asserts the two schemas keep the same keys.
Zod's default message for a blank name ("Too small: expected string to have >=1
characters") was what the receptionist would have read, so the messages are now
written out.

Also fixed in the e2e harness: fixtures were keyed by pathname alone, so
`GET /patients` and `POST /patients` collided and a registration spec's POST was
answered with the list fixture. Fixtures are now keyed by `'/path'` or
`'POST /path'`, and requests are recorded with their bodies so a spec can assert
what was actually sent.

Session 11: patient editing, completing the write side of Milestone 4. Began by
extracting the editable field set out of registration, because the two forms must
not drift: `editablePatientDetailsFrom` now owns trimming, the required-name rule,
blank-optional normalisation and the birth-date check, and both use cases call it.
`registerPatient` and `updatePatient` are then the same operation over different
starting state.

The one real design decision was the verb. The obvious endpoint is
`PATCH /patients/:id` with the fields the user changed — and it cannot express the
case that matters most here: an email recorded in error, which a merge can only
leave in place. So it is a `PUT` carrying the complete editable set, where an
absent optional field means "no longer recorded". That made `updatePatientSchema`
the create schema rather than the partial it was, and `ApiClient` grew a `put()`
so the verb is stated at the call site instead of hidden in a `post()`.

Two decisions that cost correctness rather than elegance, both found by testing:

- Zod objects _strip_ unknown keys rather than rejecting them. So an edit cannot be
  forbidden from sending `isActive` or `recordNumber` at the schema — it is
  silently ignored. The real guarantee has to live in the write itself:
  `EditablePatientDetails` omits those fields from the type so there is nowhere for
  them to bind, and the Drizzle `SET` list does not name those columns, so a
  stripped value has nothing to reach. Both are asserted against PostgreSQL,
  because a schema test can only prove the parse, not the write.
- `describePatientFailure` used `apiError.message ?? fallback`. An empty string is
  nullish-adjacent but not nullish, so a server fault that arrived with a blank
  message rendered an empty red alert — which reads as "no error" while the save
  quietly failed. Now `||`, with a test for the empty message.

Also worth recording: TanStack Router's imperative `navigate()` types `to` as a
path _descendant_ of the current route, and the patient profile is a tree-sibling
because of the `_` flat-route prefix. `Link` accepts absolute paths, so every
click-driven navigation is unaffected; the one imperative call (returning to the
profile after a save) builds an `href` instead, with a comment saying so. Not worth
changing the route naming to avoid.

**Verification** (see `docs/progress/LOG.md` for the full table).

Session 12: the patient read side, moved behind the repository. The reads were the
last part of the feature still living in the route handlers, and moving them was
not a style change: the odontogram's existence check had been written without
`anonymized_at is null`, so a withdrawn patient's chart was reachable at a URL whose
profile had already stopped answering. Nothing tested for it, because the test for
"another patient's visits are not shown" is not the test for "a withdrawn patient's
chart is not shown", and only one of them had been written. `PatientRepository`
cannot express a read without a `ClinicId`, so that class of mistake is now a
compile error. `apps/api/src/http/routes/patients.ts` went from 482 to 283 lines
and no longer imports a database driver.

Two smaller things the move exposed. The profile used to be built by spreading a
database row, which published `anonymizedAt` on every load and would have
published any column added to `patients` afterwards; it now names its fields. And
the frontend had hand-copied nine response interfaces from the API, one of which had
already drifted — `usePatientOdontogram` expected `items` where the endpoint
returns `entries`, and nothing noticed because no screen calls that hook yet. The
copies are gone, and so are the unused Zod response schemas, which described an
envelope of `{ data, meta }` and a `fullName` that no endpoint has ever sent.

The unexpected part was the database's collation. The cluster is initialised with
`--locale=C` so that a developer's container and a production server behave
identically, and `C` sorts by byte value while `lower()` folds only ASCII. So
`Ñuñez` sorted after `Patient`, and a search for `nunez` returned nothing — for a
clinic that finds patients by typing, that reads as "this patient is not in our
system". ADR 0016 records folding both sides of the comparison explicitly with
immutable `translate()`, chosen over `unaccent()` because it needs no extension and
can still be indexed.

**Verification** (see `docs/progress/LOG.md` for the full table).

Session 13: the agenda's read side, the first slice of Milestone 5. The choice worth
recording is _which_ slice: the agenda needs one query — which appointments belong in
a window — and the dashboard had already written a worse version of that question for
itself, filtering on `starts_at`. Building the endpoint on top of that query instead
of beside it meant there is now one implementation of "today" rather than two, and it
is the one with tests.

Making the dashboard share it changed a number. An appointment running from 22:30 to
00:30 now appears on both days' agendas, which is right — at 00:15 the dentist is still
with the patient — but it also meant that summing `duration_minutes` would charge 120
minutes of yesterday's surgery against today's 480 minutes of capacity and report 25%
occupancy on a day with 90 minutes booked. Clipping to the window fixes it (ADR 0017).
Both halves of that are pinned by tests, because the defect only shows on days with a
booking that crosses midnight, which is exactly the kind of thing nobody reproduces
by hand.

Two fixture bugs were the database being right. A cleanup window narrower than the
fixtures left a row behind, and the next run collided with it; and the other clinic's
booking pointed at this clinic's chair, which the exclusion constraints refuse —
correctly, since a chair belongs to one clinic.

The mutation harness itself had an inverted condition and reported every mutation as
caught. Three of them genuinely survived: the chair filter was asserted against a
fixture where every booking was in the same chair, and nothing covered the dashboard's
clipped minutes or its cancelled-upcoming filter. All three now have real coverage,
and 15 mutations are caught.

**Verification:** typecheck 12/12 · lint 12/12 + boundary guard (one pre-existing
warning) · format · build 5/5 · 265 unit/component · 85 integration (30 new) ·
46/46 e2e.

---

Session 14: the agenda grid, and the first thing the app asks the server instead of
assuming.

The decision that shaped this slice was where the calendar's timezone comes from.
Every FullCalendar example passes `timeZone: 'local'` or nothing at all, and both are
wrong here: one API serves every clinic, so a browser-derived zone draws a Lima
clinic's morning in the afternoon for anyone travelling, and a `VITE_CLINIC_TIME_ZONE`
constant cannot be right for the second clinic that appears next year. So the clinic's
own record became an input: `GET /api/v1/clinic`, `DrizzleClinicRepository`, ISO
weekdays translated into the `Date.getDay()` numbers the library wants, and a route
that renders an error rather than a grid when the clinic cannot be loaded. The
alternative — a constant with a comment — is cheaper and would have been wrong the
first time the clinic changed its country.

ADR 0011 said FullCalendar would live behind two adapter files. That held up, with one
addition: opening hours are a translation too, and they became a third adapter beside
the event one, because a weekday number that passes through unchanged opens every
clinic a day late and still looks like a plausible calendar. The boundary is now
enforced rather than documented — rule 5 of `scripts/check-boundaries.mjs` fails when
anything outside an explicit allowlist imports `@fullcalendar/*`, verified by leaking
one into a query and watching the guard fail.

The range is not computed anywhere. FullCalendar's `datesSet` reports what the grid is
showing, and that is the fetch window, so a month view asks for a month and there is no
second implementation of "which days are on screen" to drift. Deliberately no
`placeholderData`: navigating to tomorrow must not paint today's appointments under
tomorrow's dates.

Two bugs were caught by writing the assertions honestly rather than conveniently. The
business-hours adapter spread an empty object for a weekday it could not translate,
which FullCalendar reads as _every day_ — the opposite of the comment above it; the
adapter now drops such a row and a test asserts nothing comes out without
`daysOfWeek`. And the e2e timezone spec asserted that an event was visible, which is
not the same as asserting it was drawn at the clinic's hour; it now reads the rendered
time, and pointing the component at the browser's zone fails it with
`Received string: "10:00 - 11:00"`.

**Verification:** typecheck 12/12 · lint 12/12 + boundary guard (one pre-existing
warning) · format · build 5/5 · 315 unit/component (50 new) · 93 integration
(8 new) · 56/56 e2e (10 new) · 5 adapter mutations all caught.

Session 15: the appointment write side. Three use cases in `packages/domain` —
`createAppointment`, `rescheduleAppointment`, `transitionAppointmentStatus` — behind
`POST /api/v1/appointments`, `PUT /api/v1/appointments/:id/schedule` and
`POST /api/v1/appointments/:id/status`. The rules that took the most thought: a booking
must fit _inside_ opening hours rather than merely start inside them; the schedule
freezes once the patient has arrived; and un-cancelling re-takes the chair, so a
transition back into a slot-reserving status goes through the same conflict check as a
reschedule. ADR 0018 records why each of those is a rule and not a convention.

The database did the two jobs the application cannot. `23P01` is translated into
`SCHEDULING_CONFLICT`, so the race between two receptionists pressing save on one slot
is a 409 rather than a 500 — asserted with two concurrent inserts, one 201 and one 409.
And `0002_appointment_tenant_foreign_keys` made the patient, dentist, chair and room
references composite over `(id, clinic_id)`, because a foreign key on the id alone
proves a row exists and says nothing about whose it is: clinic A's book could hold
clinic B's patient, and the agenda's join would show that patient's name on clinic A's
screen. Proven by hand against the running database, and the new constraint immediately
refused a fixture in the existing agenda test that had been committing exactly that
leak.

Two type changes fell out of it honestly rather than conveniently. `Appointment.dentistId`
is nullable because the column is `on delete set null` and a booking outlives its
dentist; `Appointment.clinicId` is branded because an appointment must be written for a
clinic somebody named. `startVisitFromAppointment` now refuses an appointment with no
dentist instead of attributing a visit to nobody.

**Verification:** typecheck 12/12 · lint 12/12 + boundary guard (one pre-existing
warning) · format · build 5/5 · 360 unit/component (45 new) · 118 integration (25
new) · 56/56 e2e (unchanged, no UI moved) · migration applied to a live database and
its two guarantees checked by hand.

Session 16: made the desktop app testable when the working tree is not. `pnpm run
desktop:pin` builds with `tauri build --debug --no-bundle` — a production frontend
with its assets embedded in the binary — and keeps the file in a gitignored
directory beside a manifest naming the commit it came from; `pnpm run desktop:run`
executes that file and never compiles, so a half-finished refactor can no longer
take the only way to open a native window away. ADR 0019 records why the obvious
alternative does not work: `tauri dev` serves its assets from the working tree, so
a snapshot of it breaks exactly when it is needed.

The need for the feature found a bug that had been sitting in plain sight.
`API_PORT` moved from 3000 to 3010 in session 8, and `API_PORT`, `VITE_API_URL` and
the Zod defaults all moved with it; the CSP in `tauri.conf.json` did not, and
nothing reads that file. The webview had been refusing every API call the desktop
app made — a shell that rendered correctly over an empty agenda, with no error in
any log. The browser deployment has no such gate, so no web test could ever have
found it. `apps/desktop/test/tauri-config.test.ts` now asserts the CSP's
`connect-src` allows the origin `.env.example` names, verified by putting the old
port back and watching it fail.

Two smaller corrections: `docs/desktop.md` §6 listed `build:desktop` and
`tauri:build`, neither of which has ever existed, and §8 still called the native
build unverified — it completes here, in 38 seconds incrementally. What remains
unverified is narrower and now says so: the release profile and the
`deb`/`msi`/`app`/`dmg` bundles.

Building the native app needed 12 GB that the disk did not have (117 GB, 115 MB
free), so Docker's build cache, the Playwright browsers and the Chrome cache were
cleared. Playwright chromium was reinstalled immediately and `pnpm run test:e2e`
is green again.

`scripts/run-desktop.sh` is the short way in — the counterpart to
`dev-desktop.sh`. It runs the newest kept build, or a numbered one, and does
nothing but supply a default argument: the logic is the same `desktop-pin.mjs` that
`pnpm run desktop:run` runs, so the two cannot drift. It calls `node` directly
rather than `pnpm` and resolves the repository from its own location, because the
moment a fallback is worth having is the moment the toolchain is not cooperating.

**Verification:** typecheck 12/12 · lint 12/12 + boundary guard · format · build
5/5 · 364 unit/component (3 new) · 118 integration · 56/56 e2e · `desktop:pin`
produces a runnable window, `desktop:run 2` and two error paths behave, and the
captured window is a rendered app rather than a blank one · `run-desktop.sh` opens
the same window from `/` under `env -i` (no pnpm, no inherited PATH) and reports
the kept build's commit against the tree's.

Session 17: the appointment write side's UI — reschedule and status. Everything
here was decided by the rule that the server is the only authority on what is in a
chair, so the client asks and redraws rather than deciding and reconciling.

`adapters/from-calendar-event.ts` is the whole translation layer, and it is the part
worth arguing for: a drag sends only `startsAt`, because a drag has not restated the
length and a client that restates it can clear a chair by accident; a resize sends
`durationMinutes` and only when the rounded length really differs, so snapping
noise does not become a write. The file imports no FullCalendar package, declaring
the drop/resize shape structurally instead — which meant `check-boundaries.mjs`
needed no new allowlist entry. ADR 0011 said FullCalendar would be confined to
adapters; this is the first time the confinement was actually tested by a second
adapter, and the guard's answer was that the boundary was already right.

The click panel offers only what the domain allows from the status the appointment
is in, each button carrying the transition's own verb, and a cancellation asks for
its reason before it will send one. A conflict is shown as the hour that is taken,
in the clinic's zone, and the panel stays open so the user is not thrown out of
what they were doing. The e2e proves the zone claim where it bites: the browser
under test is `America/New_York` and the assertion is `09:00 – 10:00` for a
`14:00Z` appointment in Lima.

The remaining part of item 6 is not scheduled, it is **blocked**, and the reason is
a missing endpoint rather than a missing hour: `createAppointmentSchema` demands a
`dentistId` and nothing lists dentists or chairs, so a booking form built today
would ask the receptionist to type a UUID. A slot that invites a click must open a
form that can complete, so `selectable` stays unwired on purpose and the read
endpoint is the next task.

**Verification:** typecheck 12/12 · lint 12/12 + boundary guard · format · build
5/5 · 422 unit/component (58 new) · 118 integration · 60/60 e2e (5 new, 1
replaced). No migration, no seed change, no API change: this session added no
server behaviour, only a client for behaviour that already existed.

Session 18: the two lists a booking is made against — `GET /api/v1/dentists` and
`GET /api/v1/chairs` — which is what the booking form was blocked on. The ports had
been declared since session 8 with nobody calling them, and reading them against the
schema showed they described tables that do not exist: `specialties`,
`defaultChairId` and `kind` have no columns. Correcting them was the first real work
of the session and cheaper than the three migrations that implementing them as
written would have required.

The part that turned out to matter most was not the endpoint but the **sort**. The
development database runs `--locale=C`, so `Álvaro Núñez` sorts after `Beatriz
Ñaupari` on byte value and every accented clinician sinks to the bottom of a
dropdown. The patient repository already solved this; the folding moved out of it
into `persistence/postgres/fold-accents.ts` rather than being copied, because two
copies of an accent table is one of them going stale — and because the comment there
promised an `unaccentedAlphabet()` guard that had never existed, which is now a
test.

My first version of the ordering assertion named the clinicians `Dr. Álvaro` and
`Dra. Ñuñez` and passed with the folding _removed_. A shared title prefix decides the
comparison before the accent is reached, so the test could not fail. Rewritten
without the prefix, it fails when the folding goes — and so does the chair's `LEFT
JOIN` when it is turned into an inner one. Both were checked by reintroducing the
defect, which is the only way to know an assertion is doing anything.

One thing was deliberately left undecided: whether an inactive dentist may still be
booked. `createAppointment` does not look at `isActive` and the new endpoints enforce
nothing, so today a client that hides the inactive rows is the only thing preventing
it — a rule in the browser, which this project refuses everywhere else. Rather than
add a write-path rule that nobody asked for, it is product question 17. The dev
database was reset so the seed's new chairs are visible on the agenda; it contained
nothing but seed rows, so nothing was lost.

**Verification:** typecheck 12/12 · lint 12/12 + boundary guard · format · build
5/5 · 429 unit/component (7 new) · 130 integration (12 new) · 60/60 e2e unchanged ·
both endpoints answered by a real API against the dev database, including the 422
for an unreadable `?onlyActive`. No migration: this session adds no column.

Session 19: the booking rule the clinic was asked about instead of assumed. Product
question 17 asked whether an appointment may name a dentist or chair that is marked
inactive, and the honest answer was that nothing stopped it — `createAppointment` never
read `isActive`, the two list endpoints returned it and enforced nothing, and the only
thing in the way was a client that happened to hide the row. The clinic answered: no.

The rule itself is short. `bookable-resources.ts` looks the named clinician and chair
up and refuses an inactive one with `UNBOOKABLE_RESOURCE`, which the API folds into
`DOMAIN_RULE_VIOLATION` at 409, and the message names the resource — "Dr Local is
marked inactive and cannot be booked" rather than a refusal with nobody in it.

The part worth the ADR is the wiring. `AppointmentWriteDependencies` could have taken
the two new repositories as optional, and that would have looked like a tidier diff:
the status transition would not be handed a chair repository it never uses. Instead
the dependency type split, `AppointmentWriteDependencies` for the four every write
needs and `AppointmentBookingDependencies` for create and reschedule, which **cannot
be constructed** without the two. The compiler then found three files that were
building the appointment routes without them — including two integration harnesses that
would otherwise have tested a booking path with no rule in it. That is the whole
argument for the shape: forgetting became a type error instead of a clinic booking a
clinician who left.

Two cases came out of it that had to be decided rather than defaulted. A **reschedule**
checks the names the booking will have _after_ the move, so moving an appointment whose
clinician was deactivated afterwards is refused until it is reassigned. The tempting
alternative — you may keep a name you already used — makes an inactive clinician
permanently bookable to anyone who books once and then only drags, and needs the
existing row in hand to evaluate at all. And a name the rule **cannot find** is left
alone entirely: `findById` cannot tell an absent id from another clinic's and must not,
so the tenant foreign keys answer that one as a 422, exactly as they did before. Two
answers for one bad reference means one of them is wrong.

Both call sites were verified by deleting them: removing the create check fails three
create tests, removing the reschedule check fails three different ones, and neither
overlaps the other.

**Verification:** typecheck 12/12 · lint 12/12 + boundary guard · format · build 5/5 ·
442 unit/component (9 new) · 136 integration (6 new, real PostgreSQL) · 60/60 e2e
unchanged. No migration, no UI change: this is the rule the booking form inherits, and
ADR 0020 records why it is wired this way.
