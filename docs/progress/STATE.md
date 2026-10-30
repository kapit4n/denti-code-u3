# CURRENT STATE — Denti-Code U3

> Last updated: session 64 (Spanish treatment catalogue)
> This file is the resume point. Read `AGENTS.md` first, then this file.

> **Milestone 12 is in progress.** Session 48 delivered the **authentication slice** (ADR 0028): users, sessions, scrypt password hashing, opaque bearer tokens, a fail-closed auth plugin, a domain role/permission matrix enforced on routes, login/logout/me endpoints, and a login screen with a session gate in `packages/app`. Session 49 added **login throttling** (ADR 0029): failed attempts are counted per email and client address in process and answer `429 RATE_LIMITED` with `Retry-After`. Session 50 added a **development-only sign-in chooser** (ADR 0030): the login screen lists the clinic's active users and starts a real session as one, while the two routes are not registered when `NODE_ENV=production`. The remaining Milestone 12 bullets (error monitoring / log shipping, performance tuning, PostgreSQL backup/restore, a security review, data-handling review) are still to do.

> **Session 56** added the typed English/Spanish UI catalogue (ADR 0032). Spanish is the
> default, the header switches language and persists the choice, and the shell, dashboard
> and patient pages are translated. **Session 57** translated the agenda and calendar,
> including FullCalendar's own controls, the booking dialog and the quick panel. **Session
> 58** translated the visit directory and workspace. **Session 59** added the read-only
> clinic-wide payment ledger at `/payments` (ADR 0033) and translated it in both
> languages. **Session 60** closed the catalogue: treatments, inventory, reports,
> odontogram, login, the 404 and error fallbacks, the theme toggle and the runtime badge
> now read from `t()`. Every user-facing screen is translated; only the product name and
> domain data remain literal.

> **Session 62** gave `/settings` its first real screen: the clinic profile (name, legal
> name, tax id, address, phone, email), timezone and currency, and the seven-day opening
> hours are editable through `PUT /api/v1/clinic` (`clinic:manage`, administrator only).
> The domain use case validates and normalizes the record; both engines replace the whole
> week atomically, absent days are deleted and the break columns are preserved. The page
> is translated in English and Spanish. No migration was needed.

> **Session 63** translated the development seed's clinic, clinical and billing data to
> Spanish: specialties, allergies, treatments, visit reasons/summaries, odontogram notes,
> plan titles, treatment notes, clinical notes, prescriptions, attachment names and charges
> now read in Spanish on both engines. The seed run also exposed a room collision on day +3
> between the fixed bookings and `WEEK_AHEAD_SLOTS`; the generated rooms were swapped, and a
> clean SQLite database now seeds successfully with all 46 appointments.

> **Session 64** finished the Spanish treatment catalogue. The four seed codes are now
> `RESINA-ANTERIOR`, `RESINA-POSTERIOR`, `ENDO` and `PROFILAXIS`; names use `resina
compuesta` and descriptions read as aesthetic fillings. Remaining seeded composite
> references (visits, odontogram, charges) and the Spanish UI placeholders are localized
> too. The existing development SQLite rows were updated in place, so the running app no
> longer needs a database reset to show Spanish.

## Phase

**PHASE 4 — CLINICAL WORKFLOWS** (Milestone 5 of `docs/roadmap.md`)

**Milestone 9 — PAYMENTS / BILLING is complete (sessions 40–45).** The first slice issued an
invoice and read it back: a visit's un-invoiced charges are raised as one numbered
`ISSUED` document (`POST /api/v1/visits/:visitId/invoices`, bodyless, 201), and the
ledger is read through `GET /api/v1/patients/:patientId/invoices` (newest-first) and
`GET /api/v1/invoices/:invoiceId`. Numbering is per clinic, `F001-00001` — PostgreSQL
serializes the read-then-write under `pg_advisory_xact_lock(hashtext(clinic_id))`, SQLite
relies on its single synchronous writer. The patient profile gained a read-only
**Invoices** card. Issuing is deliberately independent of payment; settlement (session 32) now routes through the same `issueInvoice`. The session also finished the slice's
browser spec, which had been committed against the intended card rather than the card
that exists — see the LOG. Session 43 added the **balance**, session 44 the
**invoice-scoped follow-up payments** plus the visit workspace's invoice controls, and
session 45 the **statement**. Every bullet is closed.

**Session 40's slice was completed as a follow-up (committed `61bde80`).** Its invoices
browser spec had been committed against the _intended_ card
(`patient-invoice-row-<id>`, `$12.00`, "No invoices yet") rather than the card that
exists, and failed **3/3**; it was realigned (`data-testid="patient-invoice"`,
`formatMinorUnits` + currency, "No invoices for this patient yet.") and its setup now
answers the profile's sibling sections so their absence is not a 501. The `anaInvoices`
fixture was flipped to newest-first, the order the repository produces. The new
`visit-invoices.ts` had **no domain tests**; 10 were added in `visit-invoices.test.ts`
(series start/highest-plus-one/foreign-number ignored/overflow; issue folds only
un-invoiced charges, inherits patient + clinic currency + clock + id, `INVALID_INPUT` with
nothing written when nothing to invoice, `NOT_FOUND` for a foreign visit). Domain 308 →
318, e2e 121 → 124.

**Session 41** then did a tooling fix and saved the next task. `scripts/dev-desktop.sh`
now starts **the backend** (`pnpm run dev:api`, waits for port 3010 via bash `/dev/tcp`,
cleanup trap on exit) — the desktop window previously opened against no API and drew "The
patient list could not be loaded". The dashboard task prompt was saved to
`docs/progress/NEXT_TASK.md` (see the NEXT TASK banner above).

**Session 42** delivered the **dashboard UI/UX redesign** — presentation only, no
logic changed. The metrics are the same eight figures from the same three query hooks
and the same API read model; every number still comes from
`packages/app/src/features/dashboard/hooks/use-dashboard-stats.ts` and the client
still does no arithmetic. What changed, in `packages/app`: the `@theme` tokens in
`globals.css` (cooler surfaces and a lighter navy sidebar, a six-hue `metric-*`
accent palette with `-soft` chip tints for light _and_ dark, a
`shadow-card`/`shadow-card-hover` elevation pair), `StatCard` gaining an `accent`
prop that paints a soft icon chip through a **literal** class map (a computed
`bg-metric-${accent}-soft` would be invisible to Tailwind's scanner and render
uncoloured), a new **Quick Actions** panel (`/agenda`, `/patients`, `/treatments`),
the subtitle naming the **clinic** rather than inventing a user (there is no
authentication, so there is no person whose name the page has a right to claim),
per-panel initials/date chips and empty states that offer a next step, and a sidebar
with a brand mark, `Settings` on the right icon (it was `Clock`), an active pill and a
separating rule. The header dropped two dead controls — a bell and an avatar with no
implementation behind either — and the shell gained modest padding. **Calendar Preview
deliberately stays a 14-day booking-density chart, not a month grid**: the Agenda owns
the editable month calendar, and a second one on the dashboard would be two calendars
that can disagree about what is booked, which is worse than one honest sparkline.

**The two things that bit, and the rules they restate.**

1. The dashboard spec locates a card by taking the _heading's grandparent_, on the
   assumption `CardTitle` is a direct child of `CardHeader`. Wrapping the title and
   its description in a layout `<div>` moved that grandparent up a level to the
   header, so `cardTitled` no longer contained the rows and `lists today's
appointments` failed while 123 other specs passed. The fix keeps `CardTitle` a
   direct child and puts the header action beside it as an absolutely positioned
   sibling — as the **first** child, so the default `space-y-1.5` does not add a
   margin to an out-of-flow element. The same shape was applied to Recent Patients.
2. A stale harness can look like a real failure: `e2e` runs `vite preview` (a
   **production build**) with `reuseExistingServer`, so an e2e run after a component
   edit rebuilds nothing and keeps serving the previous bundle. `pnpm run build` must
   be run before `pnpm run test:e2e` when the tree has changed.

No new unit tests were added: the dashboard has no component tests to extend, and
the redesign is constrained by the browser suite (`e2e/web/dashboard.spec.ts`).

**Session 43** delivered Milestone 9's **second slice — the patient balance**, the
read that closes open question T6. Nothing new was stored: the balance is derived
over the ports the first slice already had, because a number written down twice is a
number that drifts, and the invoices already carry everything needed to add one up.

- **The rule** (`packages/domain/src/billing/invoice.ts`). `calculatePatientBalance`
  now takes the patient's **raw money received** and subtracts the allocations itself,
  rather than being handed a pre-subtracted figure. `DRAFT` and `VOID` documents and
  their allocations are excluded, so the balance collapses to `billed − received` —
  which is the point: how the money was allocated is bookkeeping, and a payment must
  not change the answer by which document it was pointed at. Each figure is the
  document's own **stored** total, tax included as printed, never a re-derivation from
  charges; that is T6, and it is why `charges.tax_rate_percent` staying `0` is
  harmless. `unallocatedPaymentsMinor` is **signed, not clamped**: money received with
  nothing to spend it on is a credit, and a patient in credit is a fact, not a zero.
  (`Allocation` became dead once the arithmetic moved into the domain, and was removed
  rather than left as an export nothing reads.)
- **The use case** (`packages/domain/src/billing/patient-balance.ts`).
  `getPatientBalance` decides the patient first — a foreign id throws `NOT_FOUND`
  before the clinic or the payments are read, so a stranger's id cannot buy a lookup,
  and "nothing owed" and "not our patient" cannot look the same on a statement. The
  **currency is the clinic's**, read the way `issueVisitInvoice` reads it: a patient
  with no documents at all still has a currency to be shown in.
- **Ports.** `PaymentRepository.findForPatient` on both engines (ADR 0025), and
  deliberately **not** an existence check — `[]` is a real answer, and the invoice
  read decides whether the patient is here, so querying the patient twice would buy
  no second answer.
- **API** — `GET /api/v1/patients/:patientId/balance` in `routes/invoices.ts` (the
  ledger's read side), wired through `app.ts` with `invoices`, `payments` and
  `clinics` on the same doors the settlement writes through.
- **App** — `usePatientBalance` (a separate query from the document list: the five
  figures are added across every document and every payment, so a section that
  totalled the page it had would be a second, quieter answer) and a
  **Balance** card mounted **above** the invoices card, drawing all five figures and
  naming the three states a column of digits cannot tell apart — outstanding, nothing
  owed, credit on account.
- **Tests.** 9 new domain tests (including one that pins "the answer does not move
  when a payment is repointed between documents"); a SQLite smoke block that settles
  a visit, reads the five numbers, and 404s a foreign and an unknown patient; a
  component test for the three states plus the error and in-flight cases; a new
  `e2e/web/patient-balance.spec.ts`. The profile's other browser specs each gained the
  balance fixture, because an unregistered path is a 501 and several of them assert
  an empty console-error list.
- **Counts.** Domain 318 → 327, app 313 → 318, API smoke 24 → 25, e2e 124 → 128.
  Typecheck 12/12, lint 12/12 + `BOUNDARY GUARD OK`, format clean, build 5/5.

**Session 45 — the statement (Milestone 9's last bullet).**

- **The use case** (`packages/domain/src/billing/patient-statement.ts`).
  `getPatientStatement` merges the documents and payments already readable through
  existing ports — **no new repository methods** — into one oldest-first ledger with
  a running balance. `DRAFT` and `VOID` documents are not lines (they were never
  owed), but their payments still count, so a stray credit cannot vanish. Ties break
  `INVOICE` before `PAYMENT` then by id, so the order is stable across reads. The
  running balance is signed, not clamped: a prepayment reads negative. Closing
  `balanceMinor` equals billed − paid and therefore equals the Balance card's own
  server figure.
- **API** — `GET /api/v1/patients/:patientId/statement` in `routes/invoices.ts`,
  through the same ledger repositories. The patient is decided first, so a foreign id
  is `NOT_FOUND` before any read, exactly like `/balance`.
- **App** — `usePatientStatement` is gated behind an on-demand **Statement** card
  ("Show statement"): the report costs no request until asked for, which also keeps
  every existing profile browser spec from needing another fixture. The card draws
  the API's order and balances, the clinic's days, and its own error/empty states.
- **Tests.** 7 new domain tests (ordering/running balance, DRAFT/VOID exclusion,
  shared-instant tie-break, negative prepayment, `NOT_FOUND`-first read order, clinic
  currency on an empty history, missing clinic); SQLite smoke and PG integration
  assertions (the PG ones require `TEST_DATABASE_URL`); 4 component tests; a new
  `e2e/web/patient-statement.spec.ts` (3 tests) including "no request before open".
  Session 44's change left one stale browser assertion in `visit-workspace.spec.ts`
  (it still expected "fully settled" after a 55/85 payment); it was realigned to the
  follow-up door staying open for the 30.00 remainder.
- **Counts.** Domain 331 → 338, app 318 → 322, API SQLite smoke 25 (unchanged total,
  new assertions), e2e 128 → 131. Typecheck 12/12, lint 12/12 + `BOUNDARY GUARD OK`,
  format clean, build 5/5, e2e 131/131.

**Session 46 — inventory (Milestone 10, all three bullets).**

- **The model** (`packages/domain/src/inventory/inventory.ts`, ADR 0026). An
  `InventoryItem` carries its unit, cached stock, minimum and unit cost. A
  `StockMovement` is one append-only ledger row. Quantity is always positive and the
  type names the direction: `USAGE`/`EXPIRED` take stock out, `PURCHASE`/`RETURN`/
  `ADJUSTMENT` put it in. `isLowStock` is `stock <= minStock`; an outflow larger than
  the shelf raises `INSUFFICIENT_STOCK` rather than clamping.
- **The use cases.** `addInventoryItem` validates and trims the item, defaults its
  unit, and writes opening stock as an `ADJUSTMENT` ("Opening stock") in the same
  transaction as the item; zero opening stock writes nothing. `recordStockMovement`
  reads the item inside the transaction, applies the direction, and writes the
  movement and the new cached level together. Both write through `UnitOfWork`.
- **Ports and persistence.** A new `InventoryRepository` (`listByClinic`, `findById`,
  `add`, `updateStock`, `addMovement`, `listMovements`) on `Repositories`, implemented
  on PostgreSQL and SQLite (ADR 0025). Movements have no clinic column, so their read
  joins the item; duplicate SKUs come back through the `(clinic_id, sku)` unique index
  as `DUPLICATED_RECORD` on both engines.
- **API** — `GET/POST /api/v1/inventory/items` and `GET/POST
/api/v1/inventory/items/:itemId/movements` in `routes/inventory.ts`, wired with
  `inventory`, `unitOfWork`, `ids` and `clock`. The movement write answers the updated
  item beside the movement, so the page never guesses the new level; a foreign item is
  a 404 before anything is written.
- **Validation.** `createInventoryItemSchema` and `recordStockMovementSchema` mirror
  the movement vocabulary (the validation package does not depend on the domain),
  cap quantities at the integer column's range, and keep costs in minor units.
- **App** — `/inventory` (the sidebar's link had pointed at a 404 since the shell was
  built): a low-stock card, the catalogue with per-unit stock/minimum/cost, an add form
  that converts the typed cost to minor units once, and a movement form with the
  selected item's history in the clinic's clock. Failures quote the server and keep the
  draft; every list is a refetch, never an optimistic patch.
- **Tests.** 12 domain tests, 6 validation tests, and 5 component tests; API SQLite
  smoke (26 total) covering opening stock, usage, shortage rollback, duplicate SKU,
  foreign/unknown 404s and boundary 422s; a PG integration spec for the same route
  (typechecks, skips without `TEST_DATABASE_URL`); 4 new browser specs including the
  shortage draft. ADR 0026 records the ledger semantics.
- **Counts.** Domain 338 → 350, validation 142 → 148, app 322 → 327, API SQLite smoke
  25 → 26, e2e 131 → 135. Typecheck 12/12, lint 12/12 + `BOUNDARY GUARD OK`, format
  clean, build 5/5, e2e 135/135.

**Session 47 — reports (Milestone 11, both bullets).**

- **Definitions (ADR 0027).** A report is a read model over the rows the clinic already
  keeps; there is no aggregate table and no second source of truth for money. The route
  owns the calendar and the meaning of each figure, and `ReportsReadStore` owns every
  table access, implemented once per engine (ADR 0025).
- **The period.** `resolveClinicDateRange` (`apps/api/src/application/clinic-time-window.ts`)
  turns an inclusive pair of clinic-local dates into a half-open UTC window
  (`[from 00:00, day-after-to 00:00)`), so `to` is inclusive the way a person reads a
  date filter and a 23:59 appointment is still inside the period. The route caps a
  period at 366 days. `report-capacity.ts` counts each local day's open minutes less its
  break, times the clinician count, and returns `null` for empty or fully-closed periods
  so occupancy can render an em dash rather than a confident `0%`.
- **The figures.** Appointments begin-in-window with the whole duration counted;
  production is net charge value (`unit price × quantity − discount`, pre-tax); collections
  are payments received in the window; outstanding is the clinic's open invoice balance
  **now**, independent of the window; occupancy is booked over recorded capacity; the
  clinician table repeats appointments and production per row.
- **Attribution.** Appointments and production carry a clinician because the rows do.
  **Payments do not, so collections are clinic-wide and are never split by dentist**, even
  under a filter — the page's copy says so. A charge with no visit is reported as
  `dentistId: null` and labelled "Unassigned", sorted last.
- **Persistence.** `PostgresReportsReadStore` and `SQLiteReportsReadStore`, wired onto
  `DatabaseConnection` beside `DashboardReadStore`. Outstanding is two sums — billed
  minus allocated over non-`VOID` invoices — never one join that would multiply an
  invoice's total by its number of payments.
- **API** — `GET /api/v1/reports/summary?from=YYYY-MM-DD&to=YYYY-MM-DD[&dentistId=…]`
  in `routes/reports.ts`, wired in `app.ts` with the connection's report store, the
  dentist repository and the clock.
- **Validation** — `reportRangeQuerySchema` (two `iso.date`s + optional dentist uuid; a
  reversed range is refused at the boundary).
- **App** — `/reports` (a dangling sidebar link since the shell was built): period and
  clinician filters defaulting to the clinic's current month **in the clinic's calendar**
  (derived, not seeded in an effect — the effect version wrote state on the tick the
  clinic arrived and lit React's cascading-render rule), the eight summary cards, the
  clinician table, and a CSV export. `PlatformCapabilities.saveFile` now downloads a
  Blob in both shells instead of rejecting on web, so export works in the desktop
  webview with no Tauri change (rule 5 still holds: no Tauri import in the app). A
  platform with no DOM still rejects with `PlatformUnsupportedError`.
- **Tests.** 5 validation tests; 9 API application tests (date-range resolution + capacity);
  an API SQLite smoke block; a PostgreSQL route spec (typechecks, skips without
  `TEST_DATABASE_URL`); 6 app tests (clinic-period defaults, CSV, page behaviour,
  `saveFile`); 4 new browser specs (`e2e/web/reports.spec.ts`).
- **Counts.** Validation 148 → 153, app 327 → 337, API SQLite smoke 26 → 96 (the file's
  own total, plus the new reports block), e2e 135 → 139. Typecheck 12/12, lint 12/12 +
  `BOUNDARY GUARD OK` (one pre-existing warning), format clean, build 5/5, e2e 139/139.

**Status: Milestones 5–11 complete; Milestone 12 in progress (authentication,
login throttling and the development sign-in chooser delivered, sessions 48–50).
(`docs/roadmap.md`).
dashboard UI/UX redesign delivered (session 42, presentation only).
Milestone 8 (treatments) now has its catalogue, its
treatment-plan read _and_ write sides, and both halves of the plan-item link — the
plan-item → visit link (session 38) and the plan-item → charge link (session 39) — so
the roadmap's "Link plan items → visits → charges" bullet is closed.** Sessions 13–21
delivered the agenda end to end: the `AgendaEntry` read model and `AppointmentRepository`,
`GET /api/v1/appointments`, the grid with day/week/month views confined to two adapters
by an enforced guard, the three write endpoints with the tenant foreign keys that make
"an appointment's patient belongs to its clinic" a database guarantee (ADR 0018), the
drag/resize/status UI, the bookable-resources endpoints, the rule that an inactive
clinician or chair cannot be booked (ADR 0020), and a booking dialog reachable from all
three doors a receptionist starts from.

Session 34 delivered the **odontogram** — the per-tooth clinical map (Task 2 of the
session's plan), the moment Milestone 7's "reusable component backed by domain
validity rules" left the roadmap. The chart is the **patient's**, not the visit's:
`listPatientOdontogram` and `recordOdontogramEntry` sit over the
`OdontogramEntryRepository` (taking `Repositories` from fifteen to sixteen),
`GET`/`POST /api/v1/patients/:patientId/odontogram(.entries)` read and write what
the chart holds, and the profile's **Odontogram** card draws the FDI arches and
exports its rows in the clinic's clock. Like the visit books, the entry carries no
`clinic_id` — tenancy comes through the patient (both verbs read the patient first;
a patient this clinic does not hold is a 404 in both engines via the FK
translation). The write is a **per-tooth upsert**: the unique index is
`(patient_id, tooth)` in both engines and `save` replaces the tooth's state, so the
chart holds exactly one current state per tooth — charting twice edits, never
duplicates. The body is only the finding; the tooth number tells its own dentition,
`condition`/`surfaces` follow the domain's own validity rules (a site finding must
name a surface, a surface must apply to the tooth), and both `id` and `recordedAt`
are the server's (ADR 0014) — the same line the e2e asserts. The network read model
spells `condition`/`dentition` as strings the database enum guard keeps truthful.
The seed carries 2 charted teeth on Luis (both engines).

Session 35 delivered the **catalogue write and the patient's treatment-plan read** —
Task 3 of the session's plan, the moment Milestone 8 stopped being only a footnote in
other people's write paths. `addTreatment` sits over a `TreatmentRepository` that
gained the missing verb, `listPatientTreatmentPlans` over a new
`treatmentPlanRepository` (taking `Repositories` from sixteen to seventeen), every
member written twice, once per engine. `POST /api/v1/treatments` takes the catalogue
entry itself — `{ code, name, description?, duration?, priceMinor? }` — and nothing
that names the clinic or the clock: tenancy comes from the header and the columns
default their own timestamps, the same bargain `registerPatient` makes. A second
`add` of a code this clinic already offers is a 409 translated from the
`(clinic_id, code)` unique index to the domain's `DUPLICATED_RECORD`, which the wire
still folds into `DOMAIN_RULE_VIOLATION` — a variant nothing can produce would be a
variant that lies. `GET /api/v1/patients/:patientId/treatment-plans` answers
`{ items }`, scoped through the patient the way the odontogram is (a patient another
clinic holds is a 404, never an empty list), plans newest-first, items in `id` order,
each carrying its own `progress` projected by the pure
`describeTreatmentPlanProgress` — nothing stores the arithmetic, so two engines
cannot disagree about it.

The session's second half fixed the defect the user reported from the agenda: **the
booking dialog would not let the hour be chosen.** The clicked slot used to render the
field `readOnly`, and that was wrong twice over — the month view can only ever name a
day (FullCalendar hands over 00:00), and a mistyped lane meant closing the dialog and
hunting for another empty one. The slot now _seeds_ the field rather than locking it,
there is still no `readOnly` flag on the prop, and the clinic's zone stays named under
the box exactly because that is the moment the hour is the person's to change. Both
the replacement unit test and a new browser spec fail when the lock is put back —
reintroduced as a defect and checked, per the house rule.

Session 36 finished Task 3's **App UI** — the half session 35 left open, and the
moment Milestone 8's two read-and-write surfaces stopped being API-shaped only.
`/treatments` now draws the catalogue the sidebar's link had been dangling at: an add
form whose one hard field is the name, whose price is the one place a human types
money (`parseMajorUnitsToMinor` turns `450.00` into the integer cents every price in
this system is stored as, and an unparseable price is refused in the box rather than
sent), and the catalogue itself with each price as money and not as cents. Nothing is
listed from the form's own values — the new row is the refetch's to produce, the same
line every visit workspace section holds. `useTreatments` moved from the visits
feature to `features/treatments/queries/catalogue-query.ts`, keeping the same
`['treatments']` key so the workspace's catalogue is still one shared cache entry.
On the profile, `PatientTreatmentPlansSection` sits between the care cards and the
odontogram and draws what the clinic has proposed — the plan, the server's own
`progress`, each item's status, and the presentation and acceptance days in the
clinic's clock. It is read-only by design; a plan's write is Milestone 8's remaining
half. Both surfaces carry browser specs, each verified by reintroducing the defect.

The session also found a **pre-existing flake** in the e2e layer, reproduced at HEAD
before any of this work was in the tree: six specs installed the POST's answer by
calling `installApi` _after_ clicking the button that sends the POST, which races the
response — a slow swap lets the refetch read the answer the page had already drawn,
and one test fails. The swap now happens before the write in all six places (the
section's own read has already been awaited, so nothing on screen changes), and the
suite ran 116/116 three times in a row.

Session 37 delivered **Milestone 8's treatment-plan write side**, end to end. The
`TreatmentPlanRepository` port grew the two write verbs and the bounded reads they need —
`listForPatient`, `getForPatient(clinicId, patientId, id)` (scoping the plan through the
patient in the statement) and `save(model)` — with the write models `TreatmentPlanWriteModel`
and `TreatmentPlanItemWriteModel`; `save` is one transaction that upserts the plan row and
each item **by id**, never clobbering `created_at`, never writing the tenancy columns in the
conflict set, and **never deleting an item** (the execution table's
`treatment_plan_item_id` FK is `on delete set null`, so a removal would strand a performed
record). Every member is written twice — once per engine. Three use cases sit over the port:
`createTreatmentPlan` opens a `DRAFT`, folds the catalogue's code/name into each item, and
returns the same `TreatmentPlanSummary` the read produces (including
`describeTreatmentPlanProgress`); `updateTreatmentPlan` sets the status/title/notes and
stamps `presentedAt`/`acceptedAt` on `PROPOSED`/`ACCEPTED` without ever overwriting an
existing stamp and without inventing a transition graph; `completeTreatmentPlanItem` is a
bodyless, **idempotent** POST that keeps the first completion stamp on a second call.
Routes `POST /api/v1/patients/:patientId/treatment-plans` (201 `{ plan }`),
`PATCH …/:planId` (204) and `POST …/:planId/items/:itemId/complete` (204) are wired in
`app.ts`; the request body never names the patient, the id or the clock (ADR 0014), and a
foreign-key refusal on save is translated to a `NOT_FOUND` naming the patient, the
odontogram's rule. On the profile, the plans section stopped being read-only: an inline form
proposes a plan (a treatment picker, FDI tooth, quantity, a money box parsed to integer
minor units, and a note per line) and each open line offers **Mark done**; both writes are
non-optimistic and invalidate only `['patients','treatment-plans',patientId]`. Presenting and
accepting a plan are deliberately **not** drawn — no status buttons — because the legal moves
are not decided yet.

Session 38 delivered **the plan-item → visit link**, the execution half of Milestone 8's
remaining bullet. `recordVisitTreatment` in the domain gained one optional field and the
rule that makes it mean something: when the caller names a `treatmentPlanItemId`, the
item must be **on the patient's own plan in this clinic** and its `treatmentId` must equal
the record's `treatmentId`, or the call is refused `INVALID_INPUT` ("That treatment plan
item is not on this patient's plan" / "…is for a different treatment"). The lookup reuses
`TreatmentPlanRepository.listForPatient(clinicId, visit.patientId)` — no new port verb —
and the read is recorded like every other dependency read the use case makes. The new
column follows the session-37 decision it was built for: `treatment_plan_item_id` is a
nullable FK with `on delete set null`, so nothing an execution does can strand a performed
record, and both engines write it in `save` (PostgreSQL and SQLite, twice as always).
**The link is provenance only**: recording a linked treatment does **not** complete the
plan item — completion stays `completeTreatmentPlanItem`'s own, explicit act — so the
record mutation still invalidates only `['visits','treatments',visitId]` and deliberately
**not** the plan read. On the visit workspace, once a treatment is chosen the recorder
offers the open items for that treatment on that patient (a `Not linked to a plan item`
default, each option spelling its tooth), the choice is dropped whenever the treatment
changes, and the POST carries `treatmentPlanItemId` only when one was picked. The
field was already on `recordVisitTreatmentSchema`; this session made it real end to end.

Session 39 delivered **the plan-item → charge link**, the second half of Milestone 8's
remaining bullet and the moment the roadmap's "Link plan items → visits → charges" line
closed. The `charges` table gained a nullable `treatment_plan_item_id` FK with
`on delete set null` — the execution link's own column and rule, so nothing a bill does
can strand a performed record — landing in `database/schema` _and_
`database/schema/sqlite` with a generated migration per engine (ADR 0025). `Charge`
grew `treatmentPlanItemId`, and `addVisitCharge` gained the optional field that makes it
mean something: when the caller names a plan item, the use case reads
`treatmentPlans.listForPatient(clinicId, visit.patientId)` — the same read the record
link reuses, no new port verb — and walks the patient's own plans; an item it cannot
find is `INVALID_INPUT` ("That treatment plan item is not on this patient's plan"), and
the item's own catalogue treatment is **folded into the charge's `treatmentId`**, so a
bill raised from a planned line names what was done without joining the plan back. A
blank or absent id is `null` and reads no plans. Like the record link, it is
**provenance only**: billing a planned line does **not** complete it — completion stays
`completeTreatmentPlanItem`'s own act — so the charge mutation still invalidates only
`['visits','charges',visitId]` and deliberately **not** the plan read. Both engines write
the column and map it back (`CHARGE_COLUMNS` and `save`, twice as always); the wire is
`createChargeSchema`'s new `treatmentPlanItemId: uuidSchema.optional().nullable()`, and
the route passes `treatmentPlans` (already a `VisitsDependencies` member) and spreads the
field only when the body carried it. On the visit workspace the charges section gained
the patient's plans read and an optional **Planned item** picker beside the price: once
the patient's plan has open lines, each is offered named by its plan, treatment and
tooth (a charge has no treatment select of its own, so the line's own treatment name is
what tells one from another), the choice resets with the form, and the POST carries
`treatmentPlanItemId` only when one was picked. It is not read back into the boxes — the
description stays the desk's own words.

Session 33 delivered **files** — the seventh workspace section and the seventh "per
visit" book (Task 1 of the session's plan), the moment Milestone 6's "Files/attachments
(platform capability)" became a record. `listVisitAttachments` and `addVisitAttachment`
sit over a real `VisitAttachmentRepository` (taking `Repositories` from fourteen to
fifteen), `GET`/`POST /api/v1/visits/:visitId/attachments` list and file what the
visit's folder holds, and a **Files** section in the workspace draws a file's name,
type and size in the clinic's clock and writes a new one whose body is exactly
`{ fileName, contentType?, sizeBytes? }`. Like `clinical_notes`, the table carries no
`clinic_id` of its own — tenancy comes through `visits` (both verbs read the visit
first; a foreign visit is a 404 in both engines via the FK translation) — and the FK
is `ON DELETE CASCADE`: a visit's folder dies with the visit. The file name is trimmed
on the way out and must not be blank, `contentType` is normalized lower-cased (blank →
null), a negative `sizeBytes` is refused by the domain _and_ by a column CHECK, and
the app keeps the front desk's draft when the API refuses it, as every other section
does. It is a **reference only** — name, type, size, the clinic's clock, no bytes; the
upload transport is a deferred Milestone 6 concern, recorded in the roadmap. The seed
carries 2 attachments on Luis's open visit (both engines).

Session 32 delivered **payments** — the sixth workspace section and the sixth "per
visit" book, the settlement that turns a bill into a receipt (Task 2 of the
session's plan). `payVisitCharges` records the money and folds **every un-invoiced
charge into one invoice** in one transaction (partial payments allowed, overpayment
refused); `listVisitPayments` answers through the same endpoints pair,
`GET`/`POST /api/v1/visits/:visitId/payments`. Three new repositories (`invoice`,
`payment`, `paymentAllocation`) took `Repositories` from eleven to fourteen, every
member with both engines. The workspace's **Payments** section — the nav's sixth
row — draws billed/paid/outstanding in the clinic's clock and offers the record
form only while a settlement would accept one: the door closes the moment the bill
is invoiced, and what cannot be recorded yet is said out loud — "The remaining
35.00 is held on this visit's invoice; collecting it lands with the invoice
ledger" — a Milestone 9, open question 20 boundary told to the desk instead of
answered as a 422.

Session 32 delivered **charges** — the fifth workspace section and the fourth "per
visit" book (Task 1 of the session's plan). `listVisitCharges` and `addVisitCharge`
sit over a real `ChargeRepository` (taking `Repositories` from ten to eleven), `GET`/
`POST /api/v1/visits/:visitId/charges` list and raise what the visit was priced at,
and a **Charges** section draws the line total through the domain's own
`calculateChargeTotal` and writes a new charge from major-unit boxes parsed to integer
minor units. Unlike the other four books, **a charge carries its own `clinic_id`**, so
`findForVisit(clinicId, visitId)` scopes on the charge's own column rather than
joining — and both verbs still read the visit first (a foreign visit is a 404,
ADR 0014). `patientId` and `visitId` are inherited from the visit, `currency` from the
clinic, `taxRatePercent` is `0` (no tax field in the body yet — the open question in
`docs/open-questions.md`), and `createdAt` is the clinic's clock. The seed's third
charge sits on Luis's open visit.

Session 31 delivered **prescriptions** — the fourth workspace section and the third
"per visit" book. `listVisitPrescriptions` and `addVisitPrescription` sit over a real
`PrescriptionRepository` (taking `Repositories` from nine to ten), `GET`/`POST
/api/v1/visits/:visitId/prescriptions` list and file what the patient was sent home
with, and a **Prescriptions** section in the workspace draws a course's route through
one presentation file and writes a new one with a route picker. The prescription carries
no clinic of its own: scope comes through the visit (both verbs read it first, a foreign
visit is a 404 in both engines via the FK translation), `patientId` and `dentistId` are
inherited from the visit — never accepted from the body — and `issuedAt` is the clinic's
clock. `dentistId` is nullable (`on delete set null`) exactly as `Visit.dentistId` is.
The worksheet course validates in the endpoint schema (trim first, 1–200 chars, whole
days 1–365) and again inline in the domain use case, so the two sides refuse the same
shapes; the app keeps the clinician's draft when the API refuses it, as notes and
treatments do.

Session 30 delivered **treatment records** — the third workspace section and the first
slice that reads and writes a second book beside the visit itself. `recordVisitTreatment`
and `listTreatmentRecords` sit over two new ports (`treatments` and `treatmentRecords`,
taking `Repositories` from seven to nine), `GET /api/v1/treatments` names the catalogue,
`GET`/`POST /api/v1/visits/:visitId/treatments` record what was actually done, and a
**Treatments** section in the workspace draws a record's name through the live catalogue,
its tooth and its notes, in the clinic's clock. The record's tenancy comes through the
visit (a foreign visit is a 404); the treatment it names comes through the catalogue (one
this clinic does not hold is a 422); both engines share the two repositories, and the seed
now carries 4 catalogue rows and one booked execution. The write is deliberately not
linked to the treatment plan (a Milestone 8 concern), written on a closed visit exactly as
a note can be, and stored with the clinic's clock.

Session 22 delivered the one thing item 5 of the plan below had been waiting for: the
agenda's filters. `AgendaFilterBar` chooses clinicians and chairs, and the narrowing is
**the request's**, not the browser's. Room _columns_ remain, and are blocked rather than
deferred — they need a `roomId` in the read model, which ADR 0018 deliberately left out.

Session 29 delivered **clinical notes** — the first row the workspace's section nav
gained, and the promise session 28's data-driven nav made. `listClinicalNotes` and
`addClinicalNote` sit over a `ClinicalNoteRepository` whose scoping works by reading the
visit first: both verbs answer 404 for a visit this clinic does not hold, `[]` only for
one it does. `GET`/`POST /api/v1/visits/:visitId/notes` are two endpoints, one `save`
statement and no transaction, and the **Notes** section keeps what the clinician typed
when the API refuses it. `Repositories` grew from six to seven — the first addition
since it was narrowed, and the proof of the policy written beside it.

Session 28 delivered the **visit workspace**, Milestone 6's exit criterion: the place
where closing a visit happens. `/visits/$visitId` carries the header (patient, record
number, status chip, source), a data-driven section nav whose first row is `summary`,
the summary and clinical-summary cards in the clinic's clock with the clinician and
chair resolved from their lists, and **Complete / Reopen** as buttons. The buttons are
`allowedVisitTransitions(status)` narrowed to what has an endpoint — the domain's
`OPEN → CANCELLED` has none, so it is not offered — and the mutations are deliberately
non-optimistic: the chip changes on the refetch, so the screen can never show a state
the server does not hold. The patient profile's "Recent visits" card links in.

Session 25 delivered the **third slice**, and the smallest yet: reading one. Until now
every visit route was a `POST`, so a visit closed by the API could not be seen closed
anywhere. `GET /api/v1/visits/:visitId` and `GET /api/v1/patients/:patientId/visits`
(ADR 0023) give the three dormant repository methods callers at last.

Session 26 delivered the **walk-in**: the second creation door ADR 0021 held back.
`POST /api/v1/visits/walk-in` names a patient, a clinician (required) and an optional
chair instead of an appointment; it writes one row with no `appointment_id` and
refuses an inactive clinician or chair with the same `UNBOOKABLE_RESOURCE` 409 as a
booking. The tenant foreign keys answer for it — `DrizzleVisitRepository.save`
translates `23503` into `INVALID_INPUT`, so a patient from another clinic is a 422,
not a 500 (ADR 0024). Product question 19: may the same patient hold two open visits
at once?

Session 24 delivered the **second slice**: closing one. `POST /api/v1/visits/:visitId/complete`
and `.../reopen` are bodyless, and the decision worth its weight is what they _do not_ do
— they leave the appointment alone (ADR 0022). Reopening is also not audited, because
nothing here knows who is logged in; that is question 18, not an oversight.

Session 23 delivered the **first slice of Milestone 6**: starting a visit from an
appointment. `POST /api/v1/visits` takes one field, reads the patient, clinician and chair
off the booking, and writes the visit and the appointment's move in one transaction
(ADR 0021). The links became real foreign keys, both `on delete restrict`. A walk-in is
deliberately not here, and no visit UI exists yet.

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

## Verification log (last run, session 45 — Milestone 9, patient statement)

| Command                     | Result                                                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `pnpm run typecheck`        | 12/12 tasks pass                                                                                                  |
| `pnpm run lint`             | 12/12 tasks pass, `BOUNDARY GUARD OK` (one pre-existing warning)                                                  |
| `pnpm run format:check`     | clean                                                                                                             |
| `pnpm run test`             | 12/12 tasks pass — domain 338, validation 142, app 322, api-client 15, database 6, desktop 3; API SQLite smoke 25 |
| `pnpm run test:integration` | **not run — no Docker/PostgreSQL in this environment**                                                            |
| `pnpm run build`            | 5/5 tasks pass                                                                                                    |
| `pnpm run guard:boundaries` | OK                                                                                                                |
| `pnpm run test:e2e`         | 131/131 pass (+3 — the new `e2e/web/patient-statement.spec.ts`)                                                   |

The e2e total also includes the repaired assertion in `visit-workspace.spec.ts`: its
55/85 payment test still expected "fully settled" after session 44 opened the
follow-up door, so it now expects the form to stay for the 30.00 remainder. The
full suite was red until that was realigned, which is why session 44 could not have
run it green.

**`scripts/dev-desktop.sh` is shell, so it is not covered by the pnpm suites.** It was
verified by `bash -n` (syntax), by a closed-port/open-port probe test of the `/dev/tcp`
readiness check, and by booting the API for real: `pnpm run dev:api` was listening on
port 3010 in ~4.5s and answered `GET /health` → 200 and `GET /api/v1/patients` → 200, so
the 30-second probe window is ample. The desktop window itself was not launched (it opens
a Tauri window and takes minutes to compile).

**The PostgreSQL integration suite still could not be executed this session: Docker and
every PostgreSQL client are absent from this environment** (no `docker`, no `podman`, no
`psql`, no `/var/run/docker.sock`). Session 40's new PG coverage was added to
`apps/api/test/visits-route.integration.test.ts` (issue + read, per-clinic numbering and
newest-first listing, a 422 that writes nothing, foreign/missing 404s) and it typechecks,
but it **skips** here for the reason above; the always-on SQLite smoke suite — which
gained the same "raises a visit's bill as a numbered document, and reads the ledger back"
block — still runs. Where the slice's domain logic lives, `packages/domain`'s own tests
cover the numbering and the "nothing left to invoice" refusal.

**What session 43's work is verified by.** 9 new domain tests: 7 in the
`calculatePatientBalance` block of `invoice.test.ts` (the document's **stored** total is
what bills, never a recompute of its charges; a settled document is nothing outstanding
rather than a debt; **the answer does not move when a payment is repointed** between
documents; draft and void documents **and the allocations pointed at them** are ignored;
a patient with no documents is zero **in the given currency**) and 5 in the new
`patient-balance.test.ts` (the patient is decided **first** — a foreign id throws before
the clinic or the payments are read, asserted by the read log; the currency comes from the
clinic even with nothing owed; a missing clinic names itself; credit is the money that
never reached a document). The always-on SQLite smoke block settles a visit and reads all
five figures back, then 404s a foreign and an unknown patient; the mirrored PostgreSQL
block typechecks and skips. 1 new component test file, `patient-balance-section.test.tsx`
(owed/named with the five figures, "Nothing owed" for a zero with no credit row, "Credit
on account" with the unapplied row, the error box rather than a zero, and no zero claim
while in flight), and 4 new browser specs in `e2e/web/patient-balance.spec.ts`. The
profile's **five other** browser specs each gained the balance fixture, because the card
is now mounted on every profile and an unregistered path is a 501 that several of them
assert never appears. The one defect this slice had — subtracting a **voided** document's
allocation too, answering −50_000 credit — was caught by the fixture and is now pinned by
a named test.

**What session 40's work is verified by.** 10 domain tests in the new
`packages/domain/src/billing/visit-invoices.test.ts` (the series starts at `F001-00001`
and is the highest-plus-one rather than the count-plus-one, so a gap is never refilled; a
number outside the series — a hand-entered or foreign one — is ignored rather than parsed
as zero; the width survives the digits overflowing; issuing folds only the **un-invoiced**
charges into one numbered `ISSUED` document, naming the visit's patient and the **clinic's**
currency and stamping exactly those charge ids invoiced with the clock's instant and the
generator's id; a charge already on a document is left alone so issuing twice cannot
double-bill; a visit with nothing left to invoice — whether emptied or never billed — is
`INVALID_INPUT` with **nothing written**; and a visit this clinic does not hold is
`NOT_FOUND` before any row is), the always-on SQLite smoke block above, 2 new API route blocks
(SQLite runs, PG skips), 5 component tests in
`packages/app/src/features/patients/components/patient-invoices-section.test.tsx` (the
stored totals and balances are the server's numbers, the issued day is the clinic's clock,
an empty list and a failed read are different sentences, and the card does not claim "no
invoices" while the read is in flight), and 3 browser specs in
`e2e/web/patient-invoices.spec.ts` (newest-first with the stored money and the Lima day,
the empty sentence, and the error box). The browser spec was committed against the
_intended_ card (`patient-invoice-row-<id>`, `$12.00`, "No invoices yet") and failed 3/3;
it was realigned to the card that exists — `data-testid="patient-invoice"`,
`formatMinorUnits` + currency, "No invoices for this patient yet." — the fixture's
`anaInvoices` was flipped to the newest-first order the repository produces, and the
spec's setup now answers the profile's sibling sections (odontogram, treatment-plans) so
their absence is not a 501 the console-error assertion trips on.

**What session 39's work is verified by.** 5 new domain tests in the `the plan-item
link` block of `visit-charges.test.ts` (the item id it was given is written, resolved on
the patient's own plan and the plan read recorded, and the item's **own treatment folded
into the charge's** `treatmentId` so a bill raised from a line names what was done; an
item that is **not on the patient's plan** is refused `INVALID_INPUT` with nothing
written; an item with a **null treatment** keeps the charge's own treatment; a patient
with **no plans at all** is refused the same way; a blank id drops to `null` **without
reading the patient's plans** — and, in every case, the plan is read, never written: the
provenance-only decision), 1 new validation test (the `createChargeSchema` field accepts
a uuid or null, refuses a non-uuid), 1 new component test in `visit-workspace.test.tsx`
("lets a charge bill an open planned line, and only that" — the section offers the
patient's **open** lines across plans, a completed line is absent, the POST body carries
the picked `treatmentPlanItemId`, and the picker resets with the form), 1 new always-on
SQLite-smoke block, and 1 new browser spec ("bills the open planned line a charge names,
without completing it" — the picker is drawn from the plan read, the POST body is
asserted, and exactly one plans read is made). The two write-path assertions were checked
by reintroducing the defect (the SQLite `save` not writing the column → the smoke test
fails; the domain not folding the item's `treatmentId` → the fold test fails) and
reverting each. Session 38's read model and record link were left untouched, so those
tests are unchanged.

**What session 38's work is verified by.** 6 new domain tests in the
`recordVisitTreatment — the plan link` block of `visit-treatment-records.test.ts` (the
item id it was given is written, resolved on the patient's own plan and the plan read
recorded; an item that is **not on the patient's plan** is refused `INVALID_INPUT` with
nothing written; a patient with **no plans at all** is refused the same way; an item
**planned for a different treatment** is refused; a blank id drops to `null` **without
reading the patient's plans**; and a linked record **does not complete** its item — the
plan is read, never written, the provenance-only decision), 2 new validation tests (the
field accepts a uuid; a blank/absent one is dropped), 1 new component test in
`visit-workspace.test.tsx` ("lets a recorded treatment name the open planned item it
fulfils, and only that" — once a treatment is chosen the recorder offers only the **open**
items for **that** treatment, and sends the picked `treatmentPlanItemId`), 1 new always-on
SQLite-smoke block, and 1 new browser spec ("records a treatment against the open planned
item it fulfils"). Session 37's read model was left untouched, so the read-side tests are
unchanged.

**What session 37's work is verified by.** 39 domain tests in
`treatment-plan-writes.test.ts` (a plan is opened `DRAFT` with the clock and the
catalogue's labels folded into the answer; a foreign patient or treatment is a
`NOT_FOUND` with nothing written; a blank title/notes becomes null; sites are
deduplicated into canonical order and blank tooth → null; `PROPOSED`/`ACCEPTED` stamp
their instant and never overwrite an existing one; a refusal never reaches `save`;
completing an item is idempotent and keeps the first stamp; a missing plan or item is a
`NOT_FOUND`), 17 validation tests appended to `treatments.test.ts` (the status enum
including `PROPOSED`, the one-item minimum, the surface enum reused from the
odontogram, the item caps, the `update` schema's three fields), the component tests (the
section proposes a plan and sends the composed body — a blank quantity dropped, the
`"120.50"` box sent as `12050` — the new plan appears only after the refetch and the
form closes only then; a refused plan keeps the draft in the open form; a line is marked
done through a bodyless POST and the refetched list drops the control; a 404 on the
write is a sentence about the item, not the network), and 3 new browser specs: a plan
proposed and drawn only once the server has stored it (the POST's whole body asserted),
a 422 that keeps the draft and does not refetch a list it did not change, and a line
marked done and redrawn from the refetched plan. The seed's plan-item surfaces were
corrected to the odontogram's own enum (`['MO']` → `['MESIAL','OCCLUSAL']`) in both
engines; `db:migrate` + `db:seed` re-verified against the SQLite file.

**What session 36's work is verified by.** 5 `treatment-catalogue` component tests
(the catalogue draws rows with prices as money; an empty catalogue says so; a
boundary-invalid form posts nothing; a file lists the row only after the gated
refetch, the POST's whole body spelled out as the integer cents it was parsed to; a
refusal keeps every box the front desk filled) and 5 `patient-treatment-plans-section`
tests (the plan, the server's own progress and its items; a patient with no plans
says so rather than failing quietly; a failed read says so instead of drawing an empty
list; the presentation and acceptance days are the clinic's clock, told through
`formatClinicDay` rather than a hard-coded date), plus the 7 browser specs: the
catalogue drawn with its prices, a treatment filed and listed only after the
refetch, a nameless treatment refused at the boundary without a request, a refusal
kept in the API's own words with the whole draft intact, a duplicate code mapped to
a sentence about its code, and the two plan sections on the profile. Every one of the
six write-path assertions was checked by reintroducing the defect (raw cents on the
row, a row listed from the form's own values, the draft cleared on a refusal, the
section not mounted) and reverting it.

**What the e2e flake fix is verified by.** The suite was run three times in a row at
116/116 after the swaps moved; the failure it removes was reproduced at HEAD before
any of this session's work was in the tree (`git stash -u`, rebuild, run), so it is
not this session's doing.

**What session 35's work is verified by.** 9 `addTreatment` tests (the name is the one
non-negotiable and is trimmed; a blank code or description is stored `null`, a missing
price `0`, a missing `isActive` true; the price cannot be negative, the duration cannot
be zero or fractional; the returned row is the stored row, id included; the id comes
from the generator and nothing consults a clock) and 4 progress tests (empty items are
0/0/0; one open item is 0% and a completed one is 100%; `percentComplete` is the
rounded share and never a stored counter), 10 `createTreatmentSchema` tests (the caps,
the integer price, the blank-name refusal), the three `patient-profile-scope` tests
above, two SQLite-smoke blocks, and — for the booking-dialog change — one unit test
and one e2e spec, each verified by reintroducing `readOnly`.

**What session 34 Task 2's work is verified by.** 8 domain use-case tests (permanent/
primary dentition derived from the tooth number; a tooth outside the dentition, a
surface that cannot apply, and a site finding without a surface are refused before
any write; a patient this clinic does not hold is a `NOT_FOUND`; charting the same
tooth twice is a second `save` — the upsert, never a second row; sites are
deduplicated into canonical order; a blank note is stored null), 12 validation tests
(the FDI regex for both dentitions, the 2000-char note cap, the surface refusals, the
condition/surface enums), 6 workspace component tests (the section renders on the
profile, the chart pins each row's own `condition` in `data-condition` and renders an
uncharted tooth selectable, an exported row carries the clinic's hour, a written
finding appears only after the refetch, a refusal keeps the draft with nothing
written optimistically), 6 `describe-odontogram-failure` tests, one always-on
SQLite-smoke block (normalized POST with the derived dentition, both verbs scoped
through the patient, a re-chart replacing a tooth's state so the GET still returns
one row), the `patient-profile-scope.integration.test.ts` odontogram suite (charts a
tooth with the derived dentition, a re-chart replaces state, another clinic's patient
is a 404, an empty chart is `[]` — written, typechecked, skipped here for the reason
above), and 3 e2e specs: one that the chart is asked for when the profile opens and
**once only**, draws each tooth's own `condition` (a charted 16 is `CARIES`, an
uncharted 36 is `UNCHARTED`) and exports its rows in the clinic's zone; one that a
charted crown arrives only via the refetch (the mock's GET is swapped for the second
fetch, the row carries the server's `id` and 09:00 hour, the POST body is exactly
`{ tooth, condition, surfaces }` with the blank note and the patient id left off the
wire, and the chart is read twice while the profile is read once); and one that a 422
keeps the tooth, condition and notes in the form and does not refetch a chart it did
not change. `db:migrate` + `db:seed` re-verified against the SQLite file, including
the 2 odontogram rows and `seedSummary`'s "2 odontogram entries". The chart's
row-title swap ("Upper permanent" drawing the primary-lower arch, the real upper arch
untitled) was caught because the e2e renders the map no unit test did; fixed, and the
four rows now read Primary upper / Primary lower / Upper permanent / Lower permanent.

**What session 33 Task 1's work is verified by.** 7 domain use-case tests (the visit is
read before any write; a foreign visit is a 404 for both verbs and nothing is ever
written; a blank name and a negative size never reach `save`; contentType is normalized
with blank and absent both stored as null; the writes carry the clock's instant and the
generator's id; an empty folder is `[]`, listed with a recorded read), 5 validation tests
(trim before the minimum counts, the 255 cap, negative size refused with 0 allowed), 4
workspace component tests (the section asks for its files only when opened, an empty
folder is "No files attached yet.", an attached file appears only after the refetch —
the invalidation refetches the register and not the visit — and clears the form, a 422
keeps the draft), 6 `describe-attachment-failure` tests, a SQLite-smoke block, and 3 e2e
specs: one asserting no attachment requests happen before the section opens and that a
file's row draws name/type/size in the clinic's zone; one that attaches a file whose
POST body is exactly `{ fileName, contentType, sizeBytes }` (trimmed on the way out,
ids in the URL not on the wire), whose row can only have come from the refetch (the
mock's read fixture is swapped for the section's second fetch), was read twice and the
visit once; and one that a 422 keeps the draft. `db:migrate` + `db:seed` re-verified
against the SQLite file, including the new `visit_attachments` rows and
`seedSummary`'s "2 attachments".

**What session 32 Task 2's work is verified by.** The domain's payment tests (the subject
is read and the bill computed before any write; a refusal never reaches the repositories;
integer-only money and the `PAYMENT_METHODS` enum; the outstanding balance is the
honest `max(0, billed − paid)`; every un-invoiced charge is folded into one invoice with
the clock's invoice number and id; `PAID`/`PARTIALLY_PAID` derivation; six validation
refusals incl. overpayment, negative and non-integer amounts, blank and over-long
reference; the listing joins each payment to its invoice and the charges it settles,
newest first — all asserted in both the domain and, where the shape is the two
engines', against both), 6 new validation tests for the request schema, 4 workspace
component tests (the section asks only when opened, an empty register is "No payments
recorded yet", a recorded payment appears only after the refetch and invalidates the
charges register too — the bill redraws with every charge invoiced and the door closes —
without refetching the visit, and a 422 keeps the amount, method and reference), a
SQLite-smoke settlement block, and 3 e2e specs: one asserting no payments are requested
before the section opens, that a settled register draws billed/paid/outstanding and the
row carries the server's own `receivedAt` in the clinic's zone; one that writes a
partial payment whose POST body is exactly `{method, amountMinor}` (minor units,
reference dropped when blank), whose row can only have come from the refetch (the read
fixtures are swapped between the section's first fetch and the write), whose register
was read twice and the visit once, whom the settlement moved to "held on this visit's
invoice" and closed the record form; and one that a 422 keeps the draft.

**Task 1's story carries over unchanged** — a charge's seed row and `seedSummary` (now
"3 charges, 2 payments") are untouched by payments; the settlement writes rows, the
seed does not need to show a settlement for the workspace's register to have one,
because the workspace's own e2e covers a payment flowing from empty register to
invoiced bill. `db:migrate` + `db:seed` verified against the SQLite file.

**Session 31's verification (prescriptions)** — 15 domain tests — a prescription is only ever
written under its visit's patient and dentist; the course fields are trimmed and capped
(blank medication never reaches `save`), the course is whole days 1–365, a blank
instruction becomes `null`, a foreign visit is a 404 for both verbs and nothing is written;
`issuedAt` comes from the clock; an existing needle-times test asserts the ordering — plus
6 validation tests (the route enum, and a schema whose trim happens before the minimum
counts, mirroring the domain's refusals), 4 workspace component tests (the section asks
for its prescriptions only when opened, an empty list is "No prescriptions written yet",
a filed prescription appears only after the refetch and the form clears, a 422 leaves the
draft and the route in place), 1 always-on SQLite smoke block, and 2 e2e specs: one that
asserts no prescriptions are requested before the section opens, that the row that appears
after the POST carries the server's `issuedAt` in the clinic's zone, that the POST body is
exactly the course trimmed, and that the prescriptions were read twice — once by the
section, once by the invalidation; and one that a 422 leaves the whole draft in the boxes.
A live run against the seeded dev database then exercised the real API: the seeded
prescription served back, a POST inherited `patientId`/`dentistId` and put the clock on
`issuedAt` while storing a blank instruction as null, a foreign visit answered 404, and a
blank medication answered 422.

**The seed and the second visit.** Session 31 kept the session 30 pattern: the seed gained
a `prescriptions` row on Luis's open visit (both engines, `seedSummary` now names "1
prescription"), and the dev database also carries a live-verification write from this
session's API probe, exactly as a treatment-record probe row sits on Ana's visit from
session 30 — the dev DB is a scratch space, and the seed remains idempotent.

**What session 29's work is verified by.** 29 new passing tests across five files: the
domain use cases (7 — the subject is read before the write, a foreign visit is a 404
for both verbs, a blank body never reaches `save`), the validation schema (5 — trim
happens before the minimum is counted, and the cap matches the appointment's own
`notes`), the workspace component (4 — the section asks for its notes when opened, a
filed note appears only after the refetch and is then gone from the draft, the refusal
alert keeps the text, and the invalidation touches nothing but the notes key), and the
failure sentences (6). Plus 1 always-on SQLite smoke test and 2 e2e specs: one that
asserts no notes are requested before the section is opened, that the row that appears
after the POST carries the server's `createdAt` in the clinic's zone, that the POST body
is exactly what was typed, and that the notes were read twice — once by the section,
once by the invalidation; and one that a 422 leaves the paragraph in the box.

**Then the app was booted for real, and the first thing it showed was a defect this
session had introduced nothing to prevent.** The desktop shell opened on "The patient
list could not be loaded": no API was running, and `pnpm run db:migrate` itself crashed
with `Cannot open database because the directory does not exist`, because `data/` is
gitignored and had been cleaned off the machine. `ensureSqliteDatabaseDirectory` in
`database/db-url.ts` now creates the directory a file URL names, and all three places
that open the file — migrator, seeder, API connection — call it before they do (6 tests,
including the no-op `:memory:` case). Migrate, seed and the API then ran against a real
file, and `/health` plus `/api/v1/patients` answered 200.

**The 14 failures session 28's first full run showed were date drift in the harness,
and they were proved not ours before anything was changed.** The e2e layer's fixtures
are captures of Monday 2026-10-05 (`agendaEntries`, `bookingFixtures`' `TEN_AM_LIMA`),
but the agenda opens on _today_; a failing spec's own error context read "October 7,
2026" over an empty grid, and every failure sat in `agenda`, `agenda-filters` or
`booking` — the events two days behind the page, the clicked 10:00 lane an instant the
fixture's expected value did not share. `git stash -u` on clean `a0d9361`, same
command: the identical 14 failed / 25 passed. The visit workspace's 5 new specs passed
then, and so did the other 76.

**The fix freezes the page's clock rather than unfreezing the fixtures.**
`e2e/web/fixtures/frozen-clock.ts` exports the suite's `test`, whose `page` fixture
calls `page.clock.setFixedTime('2026-10-05T13:00:00.000Z')` before the first
navigation — Monday 08:00 in the clinic, the day every fixture describes and early
enough that the 10:00 lane the booking specs click is still ahead of it, and the same
wall-clock moment in every zone a run can land in. All ten spec files import
`test`/`expect` from it instead of `@playwright/test`, and that import is the entire
mechanism. Only `Date` is fixed — timers, debounces and query retries are untouched —
so what changes is what the page believes today is. The alternative, computing every
fixture instant from `new Date()`, would make the layer drift with the calendar and
assert nothing about itself; the fixtures were frozen captures on purpose. Result:
**90/90 e2e.**

**What session 28's work was verified by.** 20 new unit/component tests across three
files: the workspace itself (9 — header, status chip, the buttons derived from the
transition set, the section nav, the 404 branch, the unavailable-patient heading), the
status presentation and closure labels, and the failure sentences (which quote
`ApiClientError`'s message and no other error's). Plus 5 new e2e specs: the clinic's
clock against the browser's own zone, the bodyless POST and the refetch that follows
it, a 409 refusal reaching the screen, a 404 visit, and the profile's link into the
completed visit its own card describes. The component tests had to be mounted in a real
router — a `<Link>` with no router context renders nothing — and the mock is keyed by
`url.pathname` rather than the origin-prefixed `BASE_URL`, which is why the first run of
the new suite failed for a reason that had nothing to do with the workspace.

## Decisions made this session (not yet in ADRs)

### Decisions from session 39 (the plan-item → charge link)

- **The link is provenance only; billing a planned line never completes the item.**
  Naming a plan item when a charge is raised says _which proposed line this bill is for_;
  it does not mark that line done. Completion stays `completeTreatmentPlanItem`'s own,
  explicit act — the same decision session 38 made for the execution link. The charge
  mutation therefore still invalidates only `['visits','charges',visitId]` and **not** the
  plan read; the smoke test asserts the linked item still reads open after the write.
- **Naming an item folds that item's own treatment into the charge.** A charge has no
  treatment select of its own (it carries an optional `treatmentId`), so the item is the
  one place the intended treatment can come from: when `addVisitCharge` resolves the plan
  item it uses `planItem.treatmentId` as the charge's `treatmentId`, overriding a
  caller-supplied one. An item whose treatment is `null` leaves the charge's own
  `treatmentId` as the caller gave it. This is why the workspace picker names each line by
  its treatment — it is the only label that distinguishes two lines.
- **The named item must be on the visit's patient's own plan; no treatment match is
  required (unlike the record link).** `addVisitCharge` reads
  `treatmentPlans.listForPatient(clinicId, visit.patientId)` (the same read the record
  link reuses, no new port verb) and walks the patient's plans; an item it cannot find is
  `INVALID_INPUT` ("That treatment plan item is not on this patient's plan"). Because the
  item's treatment is folded _in_, there is no second treatment to disagree with, so the
  record link's "different treatment" refusal has no analogue here. A blank or absent id
  is `null` and **no plan read happens**.
- **The FK column and its `on delete set null` rule are copied from the execution link,
  not shared.** `charges.treatment_plan_item_id` is a second nullable FK to
  `treatment_plan_items(id)` with the identical `on delete set null` rule, declared in
  `database/schema` and `database/schema/sqlite` and migrated per engine. Two engines,
  one column each — the dual-engine rule (ADR 0025), not an abstraction over the two. The
  same "no API path deletes a plan item, so the foreign-key-translation race is
  unreachable" note from session 38 applies.
- **The picker lives beside the price, offers the patient's open lines across all plans,
  and resets with the form.** The charges section already reads the patient for its own
  reasons, so it gained `usePatientTreatmentPlans` and a `Planned item` `<Select>` (a
  `Not linked to a plan item` sentinel). Options are every **open** (`!isCompleted`) line
  across the patient's plans — not filtered to a treatment, since a charge names none —
  each spelled "plan: treatment — tooth". The choice is dropped when the form is cleared,
  and the POST carries `treatmentPlanItemId` only when one was picked; it is **not** read
  back into the description, which stays the desk's own words.

### Decisions from session 38 (the plan-item → visit link)

- **The link is provenance only; recording an execution never completes the item.**
  Naming a plan item when a treatment is recorded says _which proposed line this
  fulfils_; it does not mark that line done. Completion stays `completeTreatmentPlanItem`'s
  own, explicit act. This keeps the two writes independent and means the record mutation
  invalidates only `['visits','treatments',visitId]` and **not** the plan read — a test
  asserts the linked item still reads incomplete after the write.
- **The named item must be on the patient's own plan, and for the same treatment.**
  `recordVisitTreatment` reads `listForPatient(clinicId, visit.patientId)` (no new port
  verb) and walks the plans' items: an item it cannot find is `INVALID_INPUT` ("That
  treatment plan item is not on this patient's plan"), and an item whose `treatmentId`
  differs from the record's is `INVALID_INPUT` ("…is for a different treatment"). A blank
  or absent id is `null` and **no plan read happens** — the dependency is only paid for
  when the caller actually names an item.
- **The FK is `on delete set null` and the API cannot reach the race it implies.** The
  column's `on delete set null` means a deleted plan item would null a performed record's
  link rather than strand it (session 37's decision), but no API path deletes a plan item,
  so the foreign-key-translation race (where a stale id would surface as a misleading
  "different treatment" sentence) is unreachable through the API. Documented, not
  disambiguated with extra machinery.
- **The recorder's picker only offers items for the chosen treatment, and drops the
  choice when the treatment changes.** On the workspace, the plan-item Select appears
  beside the treatment Select (a `Not linked to a plan item` default); its options are the
  open (`!isCompleted`) items for the **currently selected** treatment, each spelling its
  tooth, and switching the treatment resets the link — a link to an item for a treatment
  the record no longer names would be refused by the domain, so the UI never lets it be
  composed.

- **`save` upserts by id and never deletes an item.** A plan's items are written
  whole when it is proposed; the same `save` re-upserts each item on the write
  model's own id inside one transaction, and it deliberately has no delete arm —
  `visit_treatment_executions.treatment_plan_item_id` is `on delete set null`, so
  removing one would be the only way to write a row the domain cannot describe.
  Item _removal_ is therefore not a use case yet, and that is stated rather than
  implied.
- **A foreign-key refusal on save is a `NOT_FOUND` naming the patient, not an
  `INVALID_INPUT`.** The plan is written under the patient the path named; a
  patient this clinic cannot see is the same 404 the read answers, so both engines
  translate `23503` / `SQLITE_CONSTRAINT_FOREIGNKEY` to `NOT_FOUND` — the
  odontogram's rule, applied to the plan.
- **`updateTreatmentPlan` stamps and does not invent a transition graph.** The
  boundary accepts the domain enum's values (`PROPOSED` among them); setting
  `PROPOSED` fills `presentedAt` if it is null and `ACCEPTED` fills `acceptedAt` if
  it is null, and an existing stamp is never overwritten. Which moves are _legal_
  is not decided (no rule table), so there are deliberately **no status buttons**
  in the UI — a control for a move the API has no rule for would lie about what the
  clinic may do.
- **`completeTreatmentPlanItem` is bodyless and idempotent.** The item is the path;
  a second POST after the line is already done does not save again and keeps the
  first stamp, so the endpoint is safe to retry. An unknown plan or item is a 404.
- **The status on the write model is typed, not cast.** `TreatmentPlanWriteModel.status`
  is `TreatmentPlanStatus`, so the two engines that read the column's text cannot
  disagree about which values exist; the update schema mirrors the same enum in
  `packages/validation` (which must not import `domain`), pinned by its own test.
- **The tooth rule is duplicated, on purpose, like the odontogram's FDI regex.**
  The item schema in `packages/validation` carries its own
  `/^([1-4][1-8]|[5-8][1-5])$/` and the use case its own `assertFdiTooth`, because
  the boundary package cannot depend on `domain`; both copies are pinned by tests
  (blank → null, a non-FDI string refused).
- **The inline plan form is controlled state, not React Hook Form.** It is the same
  shape as its two siblings on the profile and in the workspace — the odontogram's
  finding form and the visit's treatment recorder — and both are `useState`. A
  money box parsed by `parseMajorUnitsToMinor` (the charge line's own parser,
  imported from `features/visits/charge-presentation.ts`) blocks the submit when it
  cannot parse, rather than silently sending an unpriceable line.
- **Both writes invalidate only the one list they change.** Proposing a plan and
  marking a line done each invalidate `['patients','treatment-plans',patientId]`
  and nothing else — not `['patients']`, not a visit, not any other patient. The
  mutation is non-optimistic, so the row on screen is always the refetch's.

### Decisions from session 36 (the App UI for Task 3)

- **The price is typed once, as money, and crosses the wire as cents.** The add form
  takes `450.00` — the only place in the system a human types a price — and
  `parseMajorUnitsToMinor` (the same parser the charge line uses, imported from
  `features/visits/charge-presentation.ts`) turns it into the integer minor units
  every stored money value is. An unparseable price is refused in the box with
  `Enter a price like 450.00` and never sent; the browser spec asserts the POST's
  whole body, cents included, so a raw `Number(price)` cannot slip through.
- **The catalogue page is the visits feature's catalogue, not a second one.**
  `useTreatments` moved from `features/visits/queries/treatments-query.ts` to
  `features/treatments/queries/catalogue-query.ts`, keeping the identical
  `['treatments']` key and `staleTime` — the workspace's Treatments section and the
  new page share one cache entry and one request.
- **The plans card is read-only and deliberately not a profile card.**
  `PatientTreatmentPlansSection` sits between the care cards and the odontogram
  rather than inside one of them: a plan is a series of decisions, not a fact about
  the person. It draws the server's own `progress` (never recomputed in the browser,
  so two engines cannot disagree) and the presentation/acceptance days through
  `formatClinicDay`, so the test never hard-codes a date the machine's locale would
  spell differently.
- **The e2e "install the POST's answer" pattern installs it before the click.**
  Six specs (complete visit, note, treatment, prescription, file, odontogram entry)
  used to call `installApi` _after_ the click that sends the POST — a race, since
  the refetch can beat a slow swap and read the answer the page had already drawn.
  Each now swaps before the write, after the section's own read has been awaited, so
  the property the tests assert (the row is the refetch's to produce, carrying the
  server's own `id`) is unchanged and no longer timing-dependent. The failure was
  reproduced at HEAD with this session's work stashed, so it was not ours.

### Decisions from session 35 (Task 3, and the booking hour that was locked)

- **The clicked slot seeds the booking field; it no longer locks it.**
  `AppointmentBookingDialog` used to render `readOnly` when the agenda opened it, on
  the argument that the click had already answered "when". Two cases made that wrong:
  the **month view** can only ever name a _day_ (FullCalendar hands over 00:00), and a
  mistyped lane is corrected in place rather than by closing the dialog and hunting for
  another empty one. The field is now always editable, the zone under it is always
  stated (it matters most exactly when the hour is the person's to change), and there
  is still no `readOnly` _flag_ on the prop — `startsAt` seeds, its absence leaves the
  field empty, and a caller cannot pass one that contradicts the other.
- **The catalogue write spends no clock.** `addTreatment` takes `{ treatments, newId }`
  and nothing else: the id is the server's and `created_at`/`updated_at` are the
  table's defaults, the same bargain `registerPatient` makes. A catalogue row is not a
  clinical fact, so a domain clock would buy nothing.
- **The plan read model is what the table says, not what the entity type hoped.**
  `treatment_plans` has nullable `dentist_id`/`title`/`notes`/`presented_at`/
  `accepted_at` and no sequence column on its items, so `TreatmentPlanSummary` carries
  those as nullable, `status` travels as a string, plans order by `created_at desc, id
desc` and items by `id asc` — session 30's rule, applied again: a read model is
  realigned to the table rather than the table stretched to the aspiration.
- **Progress is projected, never stored.** `describeTreatmentPlanProgress` is a pure
  domain function over `{ isCompleted }[]` (in-progress is always 0 today, because
  nothing marks an item in progress), so both engines return the same numbers without
  a second implementation of the arithmetic.
- **A duplicate catalogue code is a 409 whose wire code is still
  `DOMAIN_RULE_VIOLATION`.** The `(clinic_id, code)` unique index is translated to the
  domain's `DUPLICATED_RECORD` in both repositories (so the server log and every other
  consumer of the domain see the precise reason), and the wire keeps folding it into
  `DOMAIN_RULE_VIOLATION` as it already did for a second visit start — the status is
  what a client acts on, and changing the code would break callers that branch on it
  today. The first draft added a `DUPLICATED_RECORD` wire code and reverted it: an
  `ApiErrorCode` nothing can produce is a variant that lies about the contract.

### Decisions from session 34 (odontogram)

- **The chart is the patient's, not the visit's, and the write is a per-tooth
  upsert.** `odontogram_entries` carries `patient_id` and a unique index on
  `(patient_id, tooth)` in both engines; `recordOdontogramEntry` is a single
  `INSERT … ON CONFLICT (patient_id, tooth) DO UPDATE` (SQLite: the equivalent
  `.run` with `OR REPLACE`), so the chart holds exactly **one current state per
  tooth** — charting the same tooth twice edits its state, never adds a row. That
  is also what makes the client honest: a second charting is not an error on the
  wire, the server replaces (the e2e asserts it: re-charting a tooth leaves the GET
  with one row).
- **No `clinic_id` — tenancy comes through the patient, the visit books' rule
  applied to the patient.** Both verbs read the patient first (`findOdontogram`
  scopes by clinic and ignores anonymized patients): a patient this clinic does not
  hold answers **404 to both verbs** and nothing is ever read or written. `save`
  takes no clinic id, and the foreign-key violation (`23503` /
  `SQLITE_CONSTRAINT_FOREIGNKEY`) is translated to `NOT_FOUND`, so a raw statement
  can never chart a tooth for a patient the clinic cannot see.
- **The body is only the finding.** The endpoint schema and the use case accept
  `tooth`, `condition`, `surfaces[]` and an optional `notes`: the patient is the
  path, the dentition is a fact about the tooth number, and both `id` and
  `recordedAt` are the server's (ADR 0014). The domain refuses with its own
  sentences (`assertValidOdontogramEntry`: a site finding without a surface, a
  tooth outside the dentition, a surface that cannot apply to the tooth) and the
  endpoint schema mirrors it — the FDI regex `/^([1-4][1-8]|[5-8][1-5])$/` is
  duplicated in `packages/validation` because that package must not depend on
  `domain`, and both copies are pinned by their own tests. `notes` is trimmed and
  blank → null; the client drops a blank note from the POST body but always sends
  `surfaces` (even `[]`), because only the server decides whether a finding needed a
  surface.
- **`Repositories` grew from fifteen to sixteen, again only with both engines.**
  `odontogramEntries` entered the set only once the PostgreSQL and SQLite
  implementations existed — the session 23 policy's seventh growth.
- **The app draws rows the API returned, reservations included.**
  `PatientOdontogramEntry.condition`/`dentition` are strings the database enum
  guard keeps truthful, so the chart indexes its `CONDITION_CELL` map through an
  `as OdontogramCondition` cast at exactly the point the write path types them; an
  uncharted tooth renders a neutral cell with `data-condition="UNCHARTED"` and is
  just as selectable, because charting starts with a tooth that has no state. The
  mutation is non-optimistic, invalidates only `['patients','odontogram',patientId]`
  (a charted tooth does not touch the profile row, a visit, or any other patient),
  reads only when the profile does, and keeps the whole draft on a refusal — with
  its own sentence file (`describe-odontogram-failure`), the same discipline as
  every visit book.
- **The e2e caught a presentation bug the unit suite could not.** The chart's
  second arch was titled "Upper permanent" while drawing the primary-lower teeth,
  and the actual upper permanent arch had no title — both labels were straight from
  the component's arrays, visible to no test that did not render the map. The rows
  are now Primary upper / Primary lower / Upper permanent / Lower permanent, and
  every tooth cell carries `data-condition` so a spec can pin the row's own state.

### Decisions from session 33 (files/attachments)

- **A file is a reference, not bytes.** The endpoint stores the name, the type, the
  size and the clinic's clock — `sizeBytes` is an integer, `contentType` nullable —
  and nothing else. Uploading the actual bytes (multipart, a Tauri local-file path, a
  store, a signed object URL) is a transport decision the roadmap defers: the record,
  the register and the tenancy are the part Milestone 6 must prove, and the workspace
  already has a book to hang the bytes on when the transport lands.
- **`visit_attachments` carries no `clinic_id` — tenancy comes through `visits`, like
  `clinical_notes`, and the FK is `ON DELETE CASCADE`.** A folder belongs to its visit
  exactly as a note does (ADR 0014), so `findForVisit(clinicId, visitId)` inner-joins
  `visits`, both use cases read the visit first, and a visit this clinic does not hold
  answers **404 to both verbs**. The visit's folder dies with the visit — the same
  cascade the charge/clinical-note store expects — and both repositories translate the
  FK violation into `NOT_FOUND` so a raw statement can never write an orphan row.
  `ORDER BY created_at, id` is the order a folder grew in, ids breaking the tie.
- **`Repositories` grew from fourteen to fifteen, again only with both engines.**
  `attachments` entered the set only once the PostgreSQL and SQLite implementations
  existed — the session 23 policy's sixth growth.
- **The size is guarded at three levels, and the name is trimmed exactly once.** The
  request schema takes an integer `≥ 0`; the use case re-refuses a negative size with
  its own sentence ("A file size cannot be negative") because a schema is a boundary
  and the column is a backstop — and the column literally is one: a CHECK on
  `size_bytes`. The file name is trimmed by the schema and by the use case, so what is
  stored is what the box's edges did not add; `contentType` is trimmed and lower-cased
  with blank and absent both stored as `null`.
- **The write is one statement, no transaction, non-optimistic, and invalidates only
  its own key.** Attaching a file does not change the visit row, so the mutation
  invalidates `['visits','attachments',visitId]` and nothing else; the row arrives by
  refetch with the server's `id` and `createdAt`. Absent optional fields are dropped
  from the POST body rather than sent; the raw name is trimmed on the way out. The
  form clears on success and only there — a refused file is still the front desk's
  draft, and `describe-attachment-failure` has its own sentence file, the same
  discipline as every book before it.

### Decisions from session 32 (charges)

- **A charge is the first visit book with a `clinic_id` of its own.** The other four
  (notes, treatments, records, prescriptions) have no clinic column and scope through
  `visits`; `charges` does have one, so `findForVisit(clinicId, visitId)` filters on the
  charge's own column and returns `ORDER BY created_at, id` — the order a bill grew in,
  with the id as the deterministic tiebreak for charges raised in the same instant.
  Both verbs still read the visit first: a foreign visit is a `NOT_FOUND` before any
  row is read or written (ADR 0014). `save(charge)` takes no clinic id because the row
  carries its own; the visit-FK violation (`23503` /
  `SQLITE_CONSTRAINT_FOREIGNKEY`) is still translated to `NOT_FOUND`, since a stray
  statement could name a visit the tenant FK refuses.
- **The write is one statement, no transaction, non-optimistic, and invalidates only
  its own key.** `addVisitCharge` takes a single `INSERT`: the visit was just read, the
  tenant FK patrols the boundary, and a charge does not change the visit row. The
  mutation invalidates only `['visits','charges',visitId]` — never `['visits']`, never
  the patient's profile — and the raised row arrives by refetch with the server's `id`
  and `createdAt`, the discipline notes/treatments/prescriptions established. The form
  clears on success and only there: a refused charge is still the front desk's draft.
- **Money leaves the form as integer minor units, parsed in exactly one place.** The
  boxes take major units ("120.50"); `parseMajorUnitsToMinor` in
  `charge-presentation.ts` splits digits with integer arithmetic and never multiplies
  a decimal by 100, so a cent cannot be gained or lost in a screen. The list draws
  `calculateChargeTotal` — quantity × unit price, minus discount, plus tax — and never
  re-derives a total a second way. The line total and the "Total so far" row are the
  domain's own arithmetic in the charge's own currency.
- **A zero discount is dropped, and a blank `quantity` is no quantity at all.**
  `discountMinor > 0` is only sent when present, so a charge without a discount is not
  stored with one, and the domain defaults both fields (`quantity = 1`,
  `discountMinor = 0`) rather than the body restating what is already true.
  `taxRatePercent` is deliberately absent from the body and lands as `0` — no tax field
  in the product's forms yet; the open question is recorded in
  `docs/open-questions.md`.
- **`Repositories` grew from ten to eleven, again only with both engines.** `charges`
  entered the set only once the PostgreSQL and SQLite implementations existed — the
  session 23 policy's fourth growth in as many sessions.
- **The refusal has its own sentence file.** `describe-charge-failure` quotes
  `ApiClientError`'s message (`VALIDATION_ERROR`/`DOMAIN_RULE_VIOLATION` → the API's
  sentence, `NOT_FOUND` → "This visit no longer exists in the current clinic.",
  `NETWORK_ERROR` → "Could not reach the server. The charge was not raised."), separate
  from the prescription's for the same reason the note's is: different write, different
  subject in the sentence, and each one keeps its own file so they cannot drift.
- **The e2e mock's read fixture is swapped between the section's first fetch and the
  write.** The mock answers reads statically, so without the swap the refetch after the
  POST would keep returning the empty list and "the row on screen came from the
  refetch" would be unobservable. Swapping `GET …/charges` from `[]` to the raised row
  after the section's own fetch — before the write — is what makes the invalidation the
  only possible source of the row. The comment in the spec records the trick, because
  the first read has to happen before the swap or the swap proves nothing.

### Decisions from session 32 (payments)

- **A settlement is a transaction, and the transaction is the decision.** `payVisitCharges`
  takes `{ unitOfWork, clock, newInvoiceId, newPaymentId }` and runs fully inside
  `unitOfWork.transaction(body)`: it writes the payment, folds **every un-invoiced
  charge** into one invoice for the patient and visit, allocates the whole payment
  against it, stamps each charge `invoiceId`/`invoicedAt` via the new `markInvoiced`,
  and derives the invoice status from `deriveInvoiceStatus` over `ISSUED` — `PAID`
  when the payment covered the whole bill, `PARTIALLY_PAID` otherwise. "The charges you
  settle are the charges that were un-invoiced" is decided by the use case, not by the
  body: the request names a method and an amount, never an invoice or a charge id. The
  joining read (`listVisitPayments`) walks payments → allocations → invoices → charges
  so a receipt is drawn beside exactly what it settled.
- **A partial payment is allowed; an overpayment is not; a follow-up after settlement
  is refused.** `amountMinor ≤ outstanding` is the one money rule, refused with
  `INVALID_INPUT`; a second `payVisitCharges` after the bill is invoiced also answers
  `INVALID_INPUT` — "There is nothing left to pay on this visit", a 422 `VALIDATION_ERROR`.
  The instalment-shaped hole this leaves is **open question 20** — a real instalment needs
  Milestone 9's invoice ledger, and until then the refusal is the boundary that keeps
  "what has this patient paid" answerable, because the patient balance (T6) is one
  invoice and one allocation away from the truth.
- **`Repositories` grew from eleven to fourteen, three at once, all with both engines.**
  `invoice`, `payment`, `paymentAllocation` entered the set only when their PostgreSQL
  and SQLite implementations existed — the session 23 policy's fifth growth.
  `clearFixtures` deletes them before charges, because the settlement's rows now hold a
  clinic's invoices in place.
- **The register is drawn in the clinic's clock and the bill beside it.** The section
  renders only once **both** registers (payments and charges) have answered, computes
  `billed`/`paid`/`stillToPay` from the two lists in the shared currency, and closes the
  record form unless an un-invoiced charge exists — `canSettle` is never derived from
  what the front desk typed. The three closed-door stories are told in words: nothing
  charged, "The remaining X is held on this visit's invoice; collecting it lands with
  the invoice ledger", and "fully settled". Success clears the boxes; a refusal never
  does.
- **The POST invalidates two keys and never `['visits']`.** A settlement stamps the
  bill invoiced, so `useCreatePayment` invalidates `['visits','payments',visitId]`
  **and** `['visits','charges',visitId]` — the register and the bill it redraws — while
  the visit row itself is untouched. The e2e asserts both were read twice and the visit
  once. A blank reference is dropped on the way out rather than sent (the server stores
  null), and money leaves the box as integer minor units through
  `parseMajorUnitsToMinor`, the same single parser charges use.
- **The refusal has its own sentence file.** `describe-payment-failure` mirrors the
  charge's: the API's message for `VALIDATION_ERROR`/`DOMAIN_RULE_VIOLATION`,
  "This visit no longer exists in the current clinic." for `NOT_FOUND`, and a
  "The payment was not recorded." `NETWORK_ERROR` fallback — separate files so the
  sentences about different writes cannot drift into one shared helper.

### Decisions from session 31 (prescriptions)

- **A prescription has no clinic of its own — tenancy comes through the visit.** The
  table carries no `clinic_id` (it was in both baseline migrations exactly as found, so
  no migration was written), so `findForVisit(clinicId, visitId)` inner-joins `visits`
  and both use cases read the visit first: a visit this clinic does not hold answers
  404 to **both** verbs, and only a visit that exists answers `[]` or accepts a write.
  Both repositories translate the foreign-key violation (`23503` /
  `SQLITE_CONSTRAINT_FOREIGNKEY`) into the same `NOT_FOUND` the visit repositories use,
  so a raw statement can never silently write a prescription against a foreign visit.
- **`patientId` and `dentistId` are inherited from the visit, never accepted from the
  body.** The endpoint schema takes the course and nothing else — medication, dosage,
  route, frequency, duration and instructions. The row's patient is the visit's patient
  and the dentist is the visit's dentist, read from the row the use case just loaded, so
  a request cannot attribute a course to anybody the visit is not about. `dentistId` is
  nullable (`on delete set null`, the same column rule `Visit.dentistId` has) and a
  prescription written on a dentist-less visit is simply a prescription with no dentist,
  which is why the route exists for it at all.
- **The domain validates the course, and the API schema refuses the same shapes — a
  deliberate mirror, not a handoff.** The use case re-checks the course fields inline
  (trimmed and non-blank, capped at 200; whole days 1–365; a blank instruction becomes
  `null`) even though the endpoint's `createPrescriptionSchema` already guards them,
  because the use case is the seam other callers could reach and the constraint on the
  column is a backstop, not an interface. `assertValidPrescription` from the old
  scaffold was **deleted** rather than kept: a second, drifting copy of the rules would
  be where the two sides start to disagree.
- **`Repositories` grew from nine to ten, again only with both engines.** `prescriptions`
  entered the set only once the PostgreSQL and SQLite implementations existed — the
  session 23 policy's third growth in as many sessions, and the outer
  `repositoriesFor`/`repositories` wiring now named "ten" in the comments that used to
  count them.
- **The write is one statement, no transaction, non-optimistic, and invalidates only
  its own key, because a prescription does not change the visit.** `addVisitPrescription`
  takes a single `INSERT`; the visit was just read and the tenancy FK patrols the
  boundary. The mutation invalidates only `['visits','prescriptions',visitId]` — never
  `['visits']`, never the patient's profile — and the issued row arrives by refetch with
  the server's `id` and `issuedAt`, exactly the discipline the notes and treatments
  slices established.
- **The clinic's clock stamps `issuedAt`; the route is one presentation file.** The use
  case takes the instant from the `Clock`, because only the clinic's zone has the
  authority to say when a course was written. `MEDICATION_ROUTE_OPTIONS` and
  `medicationRouteLabel` in `prescription-presentation.ts` are the exhaustive
  `Record<MedicationRoute, string>` over the domain enum — the same discipline as the
  status tone tables — so the picker and the list can never spell a route differently
  from each other, and a route added to the domain fails to compile here rather than
  rendering a fallback.
- **The refusal keeps the whole draft, route included.** `describe-prescription-failure`
  quotes `ApiClientError`'s message (`VALIDATION_ERROR`/`DOMAIN_RULE_VIOLATION` → the
  API's sentence, `NOT_FOUND` → "This visit no longer exists in the current clinic.")
  and the form clears only on success, so a refused course is still the clinician's to
  correct — the note panel's rule, applied to a wider form than the treatments one.

### Decisions from session 30 (treatment records)

- **The record is locked to neither the plan nor the status, on purpose.** There is
  deliberately **no `treatmentPlanItemId`** — linking execution to a planned item is a
  Milestone 8 concern, and the field was left out rather than scaffolded as a null.
  There is **no status gate**: a clinician may record a treatment on a closed visit
  exactly as they write a note, so the completed visit stays a live record. And
  `isActive` is **not enforced** on the catalogue lookup, because in this clinic rows
  are hidden by retiring them, and treating an already-submitted treatment as a 422
  would make history harder to write than to read.
- **Tenancy is inherited, not restated.** The record references the local `visits` PK,
  and `treatment_records` carry their own `clinic_id` only because the FK is composite
  `(visit_id, clinic_id)` — the same pattern as the other visit-scoped tables. The use
  case reads the visit first and answers 404 for a foreign visit; it reads the treatment
  second and answers `INVALID_INPUT` ("not part of the current clinic's treatment
  catalogue") for a foreign or retired treatment. Both repositories translate the
  foreign-key violation (`23503` / `SQLITE_CONSTRAINT_FOREIGNKEY`) into the same
  `NOT_FOUND` the visit repositories already use, so a raw statement can never silently
  write a cross-clinic record.
- **`Repositories` grew from seven to nine, and every new member is a real
  implementation.** The policy written beside the set in session 23 worked in both
  directions: `treatments` and `treatmentRecords` entered the set only once both the
  PostgreSQL and the SQLite implementations existed, the same rule that once removed
  three unconstructible repositories.
- **`TreatmentCatalogueItem` was realigned to what the table says.** The `category`
  field was dropped (there is no such column), and `code`, `description` and `duration`
  are nullable, mirroring `treatments`; `code` is a varchar so COMPO-ANT probes and
  numeric plan-bound codes can coexist. `isActive` stayed. The UI labels a
  null-or-blank `code` as `id · no code`, keeping the client honest about the shape.
- **The write is one statement, no transaction, non-optimistic, and invalidates only
  its own key.** `recordTreatment` takes a single `INSERT`; there is no `UnitOfWork`
  around it, because the visit and treatment were both just read and the composite FK
  patrols the boundary. The mutation waits for the server's row (with its server-owned
  `id` and `performedAt`) and invalidates only `['visits','treatments',visitId]` —
  never `['visits']`, never the patient's profile key, because a treatment record does
  not change the visit row or the patient.
- **The clinic's clock stamps the record, and a blank is a null.** The schema requires
  `performed_at`; the use case takes it from the `Clock` because only the clinic's zone
  has the authority to say when a treatment was done (the same `READING_THE_CLINIC_CLOCK`
  rule the visits already use). Blank-string `tooth` and `notes` are trimmed on the way
  out and dropped from the POST body; Zod 4 does the same before its own `min(1)`
  guards.
- **The client draws a record only through the catalogue.** Names are resolved
  client-side from `['treatments']` (with a 60-second `staleTime`), never trusted from
  the record row; a pending catalogue shows `…`, and a code the catalogue has since
  retired renders as "A treatment no longer in the catalogue" instead of inventing a
  name. The section's query is mounted only while the section is open — "fetch what you
  draw" — so not opening the Treatments row issues zero requests, which one e2e asserts.
- **The refusals keep the form.** `describe-treatment-failure` quotes `ApiClientError`'s
  message (`VALIDATION_ERROR`/`DOMAIN_RULE_VIOLATION` → the API's sentence, `NOT_FOUND`
  → "This visit no longer exists in the current clinic.", `NETWORK_ERROR` →
  "Could not reach the server. The treatment was not recorded."), and the tooth, notes
  and catalogue choice stay in the controls when the POST is refused — the note panel's
  rule, applied to a wider form.

### Decisions from session 29 (clinical notes)

- **The read is scoped by reading the visit first, because a note has no clinic of its
  own.** `clinical_notes` carries no `clinic_id` — the table was in both baseline
  migrations exactly as found, so no migration was written — and tenancy can therefore
  only come through `visits`: `findForVisit(clinicId, visitId)` inner-joins it, and the
  use case reads the visit before it lists or writes. A visit this clinic does not hold
  answers 404 to **both** verbs; only a visit that exists answers `[]`. The test that
  files a refused attempt against a foreign visit and then counts the table to make sure
  it is still empty is the one that proves scoping is not a filter applied after the
  fact.
- **`save` takes no clinic id, and there is no `UnitOfWork`.** One row, one statement.
  The write path cannot be handed a note whose visit has not just been read, so a stray
  insert is a foreign-key violation, and both repositories translate it into
  `DomainError('NOT_FOUND', 'Visit … was not found')` — the same convention the visit
  repositories already use for `23503`. A transaction wrapper around a single statement
  would be ceremony.
- **`Repositories` grew from six to seven — the policy's first test in the other
  direction.** The set holds what can be built: `clinicalNotes` was added when its two
  implementations existed, not before, exactly the rule that removed three
  unconstructible repositories in session 23.
- **`authorId` is always null.** There is no user model, so a note's author is a column
  waiting for authentication rather than a field someone would have to guess.
  Storing `null` is the honest answer (ADR 0022's open question stands).
- **The body is 2,000 characters, matching the appointment's own `notes`.** Zod 4
  applies `.trim()` before `.min(1)` counts, so whitespace alone is refused with "A note
  needs a body" and what is stored is trimmed — asserted in a test, not assumed.
- **The section's query is mounted, not enabled, and invalidates nothing else.**
  `useVisitNotes` fetches when its component mounts — no `enabled` flag, because the
  list is not asked for until someone opens the section — and the mutation invalidates
  only `['visits','notes',visitId]`: a note does not change the visit row, so also
  invalidating `['visits']` would be the client implying that it did. Non-optimistic
  like the closure mutations: the row arrives with the server's `id` and `createdAt`,
  and the e2e asserts those instead of the text it just typed.
- **The refusal has its own sentence file because it fails differently.**
  `describe-note-failure` quotes `ApiClientError`'s message the way
  `describe-visit-failure` does, and the draft survives the failure — a request that ate
  the paragraph would be the most destructive thing the panel could do.

### Decisions from session 28 (the visit workspace)

- **The section nav is data with one row in it.** `visitSections` holds `summary` and
  nothing else, and a row is added when an endpoint gives that section something to
  show — clinical notes next. A link to a section that renders "not implemented" is a
  promise the nav would be making on someone else's behalf; a nav that grows with the
  sections is not. The chosen section is component state, deliberately not route
  search params: file-based routes type search params as `any`, so a typed route param
  would be a guarantee the framework does not actually give (the same reason as T2's
  record).
- **The buttons are the domain's transition set narrowed to what has an endpoint.**
  `allowedVisitTransitions(status)` ∩ `['OPEN', 'COMPLETED']`. The domain also allows
  `OPEN → CANCELLED`, no endpoint implements it, and a button that 404s is worse than
  no button — so it is not drawn. Deriving from the domain means a new transition
  appears as a button only when someone writes the endpoint's path beside it, and the
  component test asserts the derivation rather than a hand-written list.
- **The mutations are non-optimistic on purpose.** Nothing is simulated: the chip flips
  on the refetch the invalidation triggers (`['visits']` and
  `['patients','profile',patientId]`), so the screen can only ever show a row the
  server has answered. What is deliberately _not_ invalidated is the agenda and the
  dashboard — a closure does not move the appointment (ADR 0022), and re-fetching them
  would be the client implying that it did. The e2e proves the claim the unit test
  cannot: the visit is read a second time before the chip changes.
- **Times are the clinic's, everywhere, and the rule needed a shared home.**
  `READING_THE_CLINIC_CLOCK` moved from the patients route into `format-clinic-time.ts`
  because the workspace needs the same sentence. `startedAt` is an instant; every
  screen that shows one owes the clinic its zone rather than the visitor's.
- **The patient's name is a second query, not a field on the visit.** The visit read
  model returns ids (ADR 0023's shape), so the header reads `usePatient(visitId)`'s
  sibling by id; when that 404s the heading says the record is unavailable instead of
  inventing a name or rendering "undefined".
- **Two visit fixtures, and the profile is the source of the second's shape.**
  `VISIT_ID` is the open visit a spec completes; `COMPLETED_VISIT_ID` is the row the
  profile's "Recent visits" card already reports, times and summary included — a spec
  that followed the link into an _open_ visit would be asserting a fixture the profile
  had just contradicted. And the specs that deliberately provoke a 409 and a 404 assert
  the console-error list minus the browser's own "Failed to load resource" lines:
  Chromium logs a failing response before the application can react, so the raw list
  would be about the browser rather than about the app.

- **The filters are the server's, and that is the whole design.** `AgendaFilterBar`
  changes the request; it never hides blocks that have already been fetched. A
  browser-side filter renders an identical grid today and is wrong the first time the
  API learns a rule the client has not heard of — and nothing in a component test could
  catch it, because the two are the same pixels. The e2e specs assert on request URLs
  for this reason, and one of them asserts nothing about the screen at all.
- **`onlyActive` became a required argument rather than a defaulted one.** The booking
  dialog wants `true` and the filter bar wants `false`, and they are asking different
  questions. A defaulted parameter would have handed one of them the other's list the
  first time a caller forgot to say which — and `onlyActive` is now part of both query
  keys, so the two answers cannot overwrite each other in the cache. This is the same
  argument as ADR 0020's split of `AppointmentWriteDependencies`: make the difference
  impossible to forget rather than merely discouraged.
- **The bar reads the full list, the dialog reads the active one, and that asymmetry is
  the feature.** A clinician who has left is still filterable because "what did their
  day look like" is a question the clinic asks; hiding them makes it unanswerable while
  the grid still draws their appointments, which is why the chips read the full list and
  why a departed clinician is labelled `(inactive)` rather than hidden. The chip's label
  is the reason: a quiet day that has no explanation is a mystery.
- **A chip's colour is a validated hex triplet or nothing.** `dentists.color` is an
  unvalidated `text` column arriving from what is effectively an admin screen, and the
  tempting thing to do with a string like that is hand it to `style`. `dentistChipColor`
  accepts `#rgb`/`#rrggbb` and answers `undefined` for everything else, so a chip is
  either the colour the clinic chose or has no swatch. Written down because the guard's
  real value turned out to be narrower than the reason first given for it: a keyword
  like `chartreuse` is a _valid_ CSS colour the browser would happily apply, so only the
  validator refuses it.
- **The filter state lives in the calendar, beside the range.** Both are statements
  about what the grid is drawing, so both belong to the component that draws it. A
  filter on the route would be passed down to be handed straight back; a filter in a
  store would outlive the screen. It also survives navigating to next week, which is
  tested — asking for "Dr Rivera's day, next week" should not require choosing her
  again.
- **`agendaRangeKey` sorts the ids, and an explicit empty selection is not a separate
  key.** A filter is a set: clicking two chips in either order asks for one day with two
  names on it, and without the sort the cache holds two copies and the second is
  fetched. `NO_AGENDA_FILTERS` must produce the same key as passing nothing at all, or
  the grid (which always passes filters) and any second caller (which passes none)
  would each fetch the unfiltered day.
- **An empty narrowed range says so differently.** "No appointments in this range" and
  "no appointments match these filters in this range" are different facts, and reading
  the second as the first sends someone looking for a cancellation that never happened.
- **The redundant guard stayed, with an honest comment.** `toQuery`'s `length` check and
  `buildQueryString`'s dropping of empty values both prevent `?dentistIds=` from being
  sent, so neither is load-bearing alone and the first version of the test could not
  fail. The branch stays because the server's tolerance is two incidental guards rather
  than a contract, and because the alternative line reads like a bug someone would
  "fix". The comment now says all of that instead of asserting a hazard that a live
  request disproved.
- **The e2e mock serves one list per path, and that is recorded as a limit.** It keys on
  method and pathname and never on the query string, so the bar and the dialog cannot
  be given different lists in one spec. It does not matter here because the two callers
  differ in what they _ask_ and the specs assert the query string, but it does mean a
  departed clinician cannot appear in a booking spec's fixtures. Recorded in
  `api-responses.ts` rather than left to be rediscovered.

### Decisions from session 20 (the booking form)

- **The grid is the time picker, and the click is the decision of when.** The dialog
  shows the clicked time read-only rather than offering a second control for a decision
  already made — and session 21 relaxed that for the two doors with no grid behind them.
- **The form reuses the API's field schemas** rather than restating them, so a form can
  never accept something the endpoint refuses.

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
  no caller is a promise the first consumer has to keep or break loudly. (Session 20
  added both, in `agenda/queries/bookable-resources-query.ts` — the caller arrived.)
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
3. [x] Extend the e2e layer when Milestone 5 lands: appointment lifecycle, visit
       workspace, agenda views. Appointment lifecycle and agenda views came with
       sessions 13–22's specs (`agenda`, `agenda-filters`, `booking`); the visit
       workspace's 5 specs came in session 28, which also froze the suite's clock
       (`fixtures/frozen-clock.ts`) after 14 agenda/booking specs drifted off the
       fixtures' day. The suite is green: 90/90.

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

5. [~] **Filters.** Dentist and chair filters are **done in session 22**:
   `AgendaFilterBar` above the grid, narrowing **the request** rather than the
   drawing, with the state held beside the range so it survives navigating to
   next week. Both lists are fetched per endpoint and per caller's question — the
   bar asks `?onlyActive=false` (a departed clinician is still filterable, and
   labelled `(inactive)`; the grid still draws their appointments) while the
   booking dialog keeps `?onlyActive=true`, and `onlyActive` is part of both cache
   keys so the answers cannot overwrite each other. 10 new e2e specs assert the
   query string; five of them assert nothing about the screen at all.

       **Room columns remain, and are blocked rather than deferred.** They need a
       `roomId` in `AgendaEntry`, which the read model does not have: the write side
       declined a room precisely because it could not report one (ADR 0018), so
       adding it reopens a decision instead of extending the filters. The
       `room_no_overlap` constraint has no read side for the same reason. This is now
       written up in `docs/roadmap.md` under M5 rather than left as a checkbox.

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

   - **The booking form exists (session 20).** Clicking an empty slot opens
     `AppointmentBookingDialog`; the grid is the time picker, so the dialog shows
     the clicked time read-only and asks who, for how long and in which chair.
     Patient (searchable), clinician, chair, duration and notes, all validated by
     `createAppointmentFormSchema` — which reuses the API's own field schemas
     rather than restating them. The click's `Date` is the instant that is sent.

   - **Booking no longer needs a grid (session 21).** The same dialog is opened from
     the patient profile ("Book appointment", with that patient already chosen) and
     from the dashboard ("New Visit", which is no longer a disabled placeholder).
     With no slot behind either screen the time field is editable, and what it holds
     is the **clinic's wall clock**: `zonedWallClockSchema` replaces the form's
     `startsAt` with `localStartsAt`, and `zoned-wall-clock.ts` converts it with
     `clinic.timeZone`. A time the zone skipped over — the daylight-saving gap — is
     refused with a sentence naming the zone rather than shifted forward an hour.
     The instant is now assembled at submit and is not a form field at all, so there
     is nothing the user cannot see for the schema to validate on their behalf.
     The profile's own times moved to `formatClinicDayTime`/`formatClinicDay`; they
     were `toLocaleString()` calls, which answer with the **visitor's** zone and so
     were right only on a receptionist's machine.

   - **The hour is the desk's again (session 35).** The agenda's own door used to
     render the time field `readOnly`, on the argument that the click had already
     answered "when" — which the month view disproves (FullCalendar can only hand
     over 00:00) and which a mistyped lane made expensive. `startsAt` now **seeds**
     the wall-clock box and leaves it editable, there is no `readOnly` prop at all,
     and the zone under the box is named in both cases. See the session-35
     decisions for the reasoning and for the two tests that fail when the lock is
     reintroduced.

   **Still to do:** nothing in the booking path. The next milestone's work is visits.

7. [~] **Visits — the clinical timeline, treatments, payments, inventory, reports.**
   **Slice 1 done in session 23: starting a visit from an appointment** (ADR 0021).

   - **`startVisit` is a domain use case over one `UnitOfWork`.** It reads the
     appointment, takes the time from the `Clock`, calls the pure
     `startVisitFromAppointment`, and hands both finished entities to one
     transaction. The visit is written first; the appointment's move second, because
     its foreign key names the row the previous statement created.
   - **The bridge is now two foreign keys, neither deletable.**
     `visits.appointment_id → appointments.id` and
     `appointments.visit_id → visits.id`, both `on delete restrict`. Migration
     `0003_visit_links_and_tenant_keys` also makes the visit's patient, dentist and
     chair references composite over `(id, clinic_id)`, matching the appointments
     table, so a visit cannot name another clinic's resources.
   - **`Repositories` was narrowed from nine to six.** `TreatmentRepository`,
     `PrescriptionRepository` and `PaymentRepository` have no implementation, and
     handing a transaction a set containing three unconstructible repositories is how
     a seam starts lying. It grows as the implementations do.
   - **`AppointmentRepository` gained one operation:** `becomeVisit`. It is a
     read-modify-write the appointment read port has no name for, and the alternative
     — an operation-shaped port with its own transaction — would make this use case
     unable to compose with Milestone 6's billing work.
   - **`Visit.dentistId` is nullable now.** Creation requires a clinician, because
     attributing a treatment to nobody is not a record; but the column is
     `on delete set null (dentist_id)` so a historical visit survives a clinician
     leaving. The split is deliberate and tested both ways.
   - **The body is one field wide:** `{ appointmentId }`. No patient, dentist, chair,
     time, status or clinic. A request that could restate them is a request that could
     restate them wrongly, and the clinical record would then be evidence of something
     that did not happen.

   **Still to do, in order:** all seven per-visit books are in (notes, treatments,
   prescriptions, charges, payments, files — sessions 29–33 — plus the walk-in of
   session 26), along with the read side, closing, reopening and the workspace UI.
   Milestone 7's odontogram landed in session 34. What remains of this spread is
   inventory and reports.

**Milestone 8 — TREATMENTS, CATALOGUE AND PLANS.** Sessions 36–39 closed the App UI,
the plan's own write side, and both halves of the plan-item link (the → visit link and
the → charge link). **Milestone 8 is complete**; status transitions are Milestone 9's
commissioning, not this one.

1. [x] **Catalogue write.** `addTreatment` over `TreatmentRepository.add`, both
       engines, `POST /api/v1/treatments`, `createTreatmentSchema`. No clinic id and
       no timestamps in the body; a duplicate `(clinic_id, code)` is a 409 whose
       wire code is `DOMAIN_RULE_VIOLATION`.
2. [x] **Patient treatment-plan read.** `listPatientTreatmentPlans` over a new
       `treatmentPlanRepository` (both engines), `GET
 /api/v1/patients/:patientId/treatment-plans`, scoped through the patient
       (a foreign patient is a 404), with `progress` projected client-side by the
       pure `describeTreatmentPlanProgress` rather than stored.
3. [x] **App UI.** A `/treatments` catalogue page (the sidebar's dangling link)
       with the add form, and a treatment-plans section on the patient
       profile beside the odontogram — plus the browser specs for both.
4. [x] **Plan write side (session 37).** `createTreatmentPlan`,
       `updateTreatmentPlan`, idempotent `completeTreatmentPlanItem` over
       `TreatmentPlanRepository.save`; the profile section proposes a plan and marks
       a line done, both non-optimistically.
5. [x] **Plan-item → visit link (session 38).** `recordVisitTreatment` accepts an
       optional `treatmentPlanItemId` resolved on the patient's own plan and required
       to name the same treatment; the link is **provenance only** (never completes
       the item), written by both engines, offered by the visit workspace.
6. [x] **Plan-item → charge link (session 39).** `addVisitCharge` accepts an optional
       `treatmentPlanItemId` resolved on the visit's patient's own plan and folds the
       item's own catalogue treatment into the charge; the link is **provenance only**
       (never completes the item), a nullable `on delete set null` column written by both
       engines, offered by the visit workspace's charges section. Status transitions are
       Milestone 9's commissioning, not this one.

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

Session 21: booking stopped needing a grid. The session 20 dialog could only be opened
by clicking an empty slot, which made the grid the app's only way to book anything —
so the profile and the dashboard, which are where a receptionist actually starts, could
only offer a link to the agenda. Both now open the same dialog. That part was the
obvious half.

The other half was the time, and it changed the form's shape. The dialog used to take
`startsAt` as a prop and pass it straight through as a hidden form field, validated by
the resolver so that "the whole request is checked by one schema" was true. That only
worked because the grid had already decided the hour and the user could not see the
field. Opened from a profile there is no grid, so the time has to become something the
person states — and what they state is not an instant. Nobody books an appointment at
`2026-10-06T16:30:00.000Z`; they book it at half past eleven, and which instant that is
depends on the clinic, not on the machine the receptionist is sitting at.

So `createAppointmentFormSchema` now carries `localStartsAt` — a wall clock,
`YYYY-MM-DDTHH:mm`, checked as a shape and as a real calendar date — and the instant is
assembled at submit from `clinic.timeZone`. The consequence worth recording is that
**the instant is no longer a field at all**, hidden or otherwise. The reason session 20
gave for validating it in the resolver was to check a value the user cannot see; with
every field visible, that argument is gone, and keeping a derived value in the form
anyway would be the shape that lets a default and a typed value disagree about what was
asked for. `useCreateAppointment` now takes `CreateAppointmentInput` — the request's own
type — instead of the form's, so the thing on the wire is typed as the request rather
than as a form that is nearly the same thing.

**Luxon, and not `Intl`, for the conversion.** Reading a zone's offset with `Intl`
means reading it at some moment and guessing whether it changes across the boundary;
`DateTime.fromISO(value, { zone })` asks the zone database. It is also already a direct
dependency of the app for FullCalendar's timezone plugin, so this is the same library
doing the same job as the grid, not a new one.

Three cases in there were decisions rather than defaults, and all three are now named in
the code where they live. A wall clock the zone **skipped** — the spring-forward gap,
where `02:30` never happens — is refused, and the dialog says which zone refused it,
because the alternative is Luxon's silent `03:30`: a booking an hour later than anyone
chose, mentioned nowhere. A wall clock the zone **repeated** takes the earlier of the
two, so the booking is never an hour later than the person asked for; the clinic can
move it, and the API is the one that finally gets to object. And an unparseable instant
makes `instantToZonedWallClock` return `undefined` rather than Luxon's
`"Invalid DateTime"`, which is not a time and would otherwise be typed into a form as
one.

The profile's own times were a bug this session found on the way past: `toLocaleDateString()`
and `toLocaleString()` with no `timeZone`, which answer with the **visitor's** zone. On
every receptionist's machine in Peru that is right, which is why it survived; the day
someone books from abroad it is an appointment at the wrong hour. Both now go through
`formatClinicDayTime` / `formatClinicDay` with the clinic's zone, and where the zone is
still loading the page says "Reading the clinic's clock…" rather than falling back to
the browser's — a fallback would put "Nothing booked" and "Tonight" in the same slot
and one of them is a lie.

**The e2e specs that failed are the interesting part of this session.** Four profile
specs and the dashboard's console-error spec broke the moment the two pages started
asking `GET /api/v1/clinic`, because the mock answers an unmocked endpoint with a 501
and logs it. That is the mock doing its job — it is why a spec cannot quietly pass
against a live database — and the fix was fixtures, not code. `clinicFixture()` now
exists so the next omission is a missing import rather than a failure three files from
the change.

**Verification:** typecheck 12/12 · lint 12/12 + boundary guard · format · build 5/5 ·
488 unit/component (23 new) · 136 integration (unchanged, real PostgreSQL) · 77/77 e2e
(8 new). No migration and no server code: the validation package's form schema moved,
the API's own request schema did not, and the endpoint answers exactly what it answered
before.

Session 23: the first slice of Milestone 6 — starting a visit from an appointment.
`startVisit`, `POST /api/v1/visits`, `DrizzleVisitRepository`, a `DrizzleUnitOfWork`, and
migration `0003_visit_links_and_tenant_keys` making the bridge two real foreign keys,
neither deletable. ADR 0021 argues the transaction, the one-field body, the narrow
`Repositories` set, the nullable dentist and the deferral of walk-ins.

The find of the session was a rule that had never once run. `startVisitFromAppointment`
refuses an appointment that already has a visit — session 15, and tested ever since
against a hand-built entity — while the repository's projection never selected
`visit_id`, so no appointment the API read had carried one. The rule was dead code and
every sequential duplicate was being caught by the unique index instead, which answers
identically: same code, same 409, same single row. Nothing observable was wrong, which is
exactly why it survived. The test that now pins it asserts on what `findById` returns
before and after a visit is started, and it was checked by removing the column again —
which fails that one test and leaves the duplicate test passing, so the two really are
answering about different things.

The other thing worth recording is that the `restrict` constraints immediately refused
the integration fixture. Deleting the visits and then the appointments is impossible in
either order when both links restrict, and the fixture now does what the domain does
through status transitions: clear both links, then delete. Two fixture bugs were the
database being right as well — a booking in the other clinic that still named this
clinic's patient, and a `countVisits(undefined)` assertion that could never match a row
which does not exist.

**Verification:** typecheck 12/12 · lint 12/12 + boundary guard (one pre-existing
warning) · format · build 5/5 · 533 unit/component (17 new) · 158 integration (22 new,
real PostgreSQL 17) · 85/85 e2e unchanged, no UI moved · migration applied to a live
database and `db:generate` reporting no drift · three mutations checked: the `visit_id`
projection, the write order, and both links' restrict behaviour.

Session 24: closing a visit. `completeVisitRecord` and `reopenVisitRecord`,
`POST /api/v1/visits/:visitId/complete` and `.../reopen`, and ADR 0022. Both endpoints
take no body, both read the clinic from the request scope, and both write one row through
the repository rather than a unit of work — there is nothing to make atomic.

The rule the session argued rather than discovered: the linked appointment is **not**
completed alongside the visit. It sounds like a join the other way round, and it is the
one that would have cost a `COMPLETED → IN_TREATMENT` edge on a table where `COMPLETED`
is terminal — an edge that would surface as a button on every completed appointment in
the clinic. The price is stated rather than hidden: the booking keeps reading
`IN_TREATMENT`, so the agenda still draws the appointment and the dashboard still counts
the patient in its `inTreatment` total until the front desk completes the booking through
the appointment's own endpoint. Three tests assert exactly that, against the table.

The second is that `VisitRepository.updateStatus` now takes the end time. It used to
decide one itself — `status === 'COMPLETED' ? new Date() : null` — which meant the
endpoint's answer and the row it wrote held two different end times, differing by however
long the request took. Nothing noticed, because nothing read the row. A test that checks
`ended_at` against a fixed clock rather than against the entity kills that, and killing it
is what proved the test was worth having: it failed four times before the repository
agreed.

The bug worth recording is that the new route helper defaulted its clinic to an empty
string, so every completion looked for a visit in the empty clinic, `clinic_id = ''` was
not a uuid, and the `22P02` arrived as a **500** — the exact failure the `uuidSchema`
guard in the same function exists to prevent, written by the guard's own author. A
brand that means "a clinic somebody named" and a default of `''` is a hole with a lid on
it; the parameter is required now and the comment says why. The same mistake appeared in
two test fixtures of my own, which is how it is worth writing down: an `undefined` that
means both "no such visit" and "the default visit", and two bookings a minute apart that
the 45-minute duration made overlap.

Reopening clears `ended_at` rather than leaving it, and takes no timestamp: a visit
claiming to be open while still holding the end of a closing that no longer stands would
give the patient profile two stories about one row. What a reopening leaves behind is
nothing — `updated_at` moves and no actor is recorded, so an amendment and an ordinary
edit look identical. That is question 18, deferred to the audit-log requirements in
Milestone 12 rather than faked with a column nothing would read.

**Verification:** typecheck 12/12 · lint 12/12 + boundary guard (one pre-existing
warning) · format · build 5/5 · 542 unit/component (9 new) · 172 integration (14 new,
real PostgreSQL 17) · 85/85 e2e unchanged, no UI moved · no migration · three mutations
checked: the repository's own clock, the transition table widened into idempotence, and
the empty-clinic default. The appointment-independence assertions could not be mutated
today — `AppointmentRepository` has no status-change method yet, so there is nothing for
the domain to couple to; they are tripwires for whoever adds it.

Session 25: the visit read side. `getVisit` and `listVisitsForPatient`,
`GET /api/v1/visits/:visitId` and `GET /api/v1/patients/:patientId/visits`, ADR 0023.
Fourteen integration tests, seven unit tests, and no UI.

Two use cases that are almost nothing, and the argument is about what they are _allowed_
to be. There is no filterable collection, because no question about visits is answered by
a window and a set of filters — the appointments list is a scheduling question and earns
every filter it has, while a visit is a clinical record with no schedule. Inventing
filters now would mean inventing them without a caller to ask, which is
premature abstraction in a costume.

The decision worth writing down is that the timeline answers **`200 []` for a patient who
has never been treated**, where `GET /patients/:id` answers `404` for a patient this
clinic does not hold. They are not the same question and copying the reflex would produce
a timeline that 404s every untreated patient. The deeper half: another clinic's patient
**also** answers `[]`, and the two are indistinguishable on purpose — a list endpoint
cannot refuse to answer "does this patient exist here" without leaking "does this patient
exist somewhere". It answers exactly one question, which is which visits you may read.
Both tests assert the pair side by side, because that is the only way to check
indistinguishability.

The timeline is uncapped. A patient with thirty years of history is a few hundred rows,
and the cost of a bare `.limit()` is a silently truncated clinical history, which is worse
than a long one — a clinician reading "these are this patient's visits" has to be able to
trust that it is all of them. The patient profile's own copy caps at ten, which is
defensible there because it is a preview and this is the real thing.

Consolidating the patient profile's inline `visits` query was declined for this slice and
recorded as **open work**, not a rejection: it projects different columns for one screen,
and it sits inside a five-query block whose comment explains why they are issued together.

The session's best material was a fixture that would not stop leaking. Adding two patients
for the timeline tests without adding them to the teardown left rows behind, and the
symptom was not a failed assertion but an unrelated `patients_clinic_id_clinics_id_fk`
violation three statements later in a different suite — the database refusing to delete a
clinic that a forgotten fixture still belonged to. The integration suite grew the same
way: a test that deletes a dentist on purpose, permanently, leaving four later tests to
fail on a missing clinician.

**Verification:** typecheck 12/12 · lint 12/12 + boundary guard (one pre-existing
warning) · format · build 5/5 · 549 unit/component (7 new) · 189 integration (17 new,
real PostgreSQL 17) · 85/85 e2e unchanged, no UI calls either endpoint · no migration ·
four mutations checked: `orderBy` removed, the clinic filter dropped from each of the two
reads, and `NOT_FOUND` replaced with a fabricated visit.

Session 26: the walk-in. `startWalkInVisit`, `startWalkInVisitSchema`, and
`POST /api/v1/visits/walk-in`, ADR 0024. Nine integration tests and twelve unit tests,
and the boundary between the two doors is the argument, not the route.

The design decision was that a walk-in is **not** `POST /api/v1/visits` with a sparse
body. The bridge takes one field and reads the patient, clinician and chair off the
booking; a walk-in has no booking, so the caller names all three. Folding the walk-in
into the bridge union would have given the schema a rule for every mix it can express —
appointment _and_ patient, walk-in with and without a chair — each one a second answer
for a question the domain has one answer for. Two doors, and each schema says what its
request is.

The second decision was **who may be named**. The clinician is required, by the same
argument that refuses a visit for an appointment whose dentist left: a visit records
treatment, treatment is attributable to a clinician, and attributing a treatment to
nobody is not a record. The column stays nullable for the _future_ fact of a departure,
not as an invitation to create a visit without a name. The chair is optional, like a
booking. And the walk-in runs the same bookable-resource rule as the booking — an
inactive clinician or chair answers the same 409 — while the bridge deliberately does
not, because a booking already ran that rule at booking time. The asymmetry is the
point, two doors, two code paths, one rule.

The third was **how a walk-in learns it named a reference this clinic does not hold.**
It does not read the patient first, exactly as a booking does not (ADR 0014); the
composite tenant foreign keys are the answer, and this session's real work was the
translation. `DrizzleVisitRepository.save` now turns `23503` into `INVALID_INPUT` —
"That patient, dentist or chair is not in this clinic" — so the walk-in's most common
mistake, a patient id from the wrong clinic, is a 422, not the 500 it would otherwise
arrive as. Detection lives once, in `isForeignKeyViolation`, and the appointment
repository's private rethrow used it too.

A walk-in writes **one row**, and deliberately **no appointment**: it does not appear
on the agenda and is not counted by the dashboard's `inTreatment` total, because both
read the book and a walk-in is not in it. The clinical timeline is where it lives, as a
first-class visit with no `appointmentId`.

The rule this session refused to invent is the one that seems obvious: a patient cannot
be in two chairs, so refuse a second open visit for the same patient. It applies to
_both_ doors, the appointment door shipped without it, and adding the rule here would
make the two doors disagree. It is product question 19, and `findOpenForPatient` is
waiting for whichever door needs it first.

**Verification:** typecheck 12/12 · lint 12/12 + boundary guard (one pre-existing
warning) · format · build 5/5 · 561 unit/component (12 new) · 201 integration (12 new,
real PostgreSQL 17) · 85/85 e2e unchanged, no UI calls the endpoint · no migration ·
the FK translation is proven by direct integration tests (a foreign patient and a
foreign clinician, each refused twice at the boundary), a follow-up session's
mutation-hour can pick `save` apart the way session 24 dissected the repository.

Session 27: the engine. Denti-Code U3 no longer needs PostgreSQL to boot — **SQLite
runs everything by default**, and PostgreSQL stays a supported second engine behind
the same ports. ADR 0025 records the rule: no abstraction over the two engines;
a schema change lands in `database/schema` _and_ `database/schema/sqlite`, and a
repository method is written twice.

- **The schema and the migrations are per engine.** `database/schema/sqlite` (23
  tables, snake_case, the same `CHECK` enums) with `database/migrations-sqlite`
  (`0000_baseline`, `0001` the overlap guards, `0002` the tenant foreign keys).
  SQLite has no exclusion constraints, so the overlap guard is three pairs of
  `BEFORE INSERT` / `BEFORE UPDATE` triggers over `start + duration*60000`; the
  UPDATE triggers carry `id <> NEW.id` because the row being moved is still there,
  and the INSERT side omits it intentionally (a BEFORE trigger may not see the
  defaulted id). Tenant isolation is composite `(id, clinic_id)` foreign keys,
  the same columns ADR 0014 demands on PostgreSQL. `db:migrate` and the browser
  `db:seed` are dual-engine; `sqliteDatabasePath` resolves a `sqlite:` URL against
  the repository root, and the relative-path rule is the same resolver the API
  uses, so migrator, seeder and server always mean the same file.
- **The API persistence layer split, and the seam is the URL scheme.** One
  `DatabaseConnection` port (`persistence/connection.ts`, ADR 0025's only
  dispatch point) names `{ engine, repositories, unitOfWork, dashboard,
isReachable, close }`, and `openDatabaseConnection` hands a `sqlite:`/`file:`
  URL the SQLite stack (`persistence/sqlite/*`) and a `postgres://` the existing
  one. Every route now imports a port; `app.ts` no longer knows what database it
  is on. The dashboard read model became `DashboardReadStore`, with one
  implementation per engine. Routes moved their queries behind it; only
  `/dashboard/stats` and the calendar preview go through the store directly.
- **The hand-written SQLite `UnitOfWork` is a real design fact.** better-sqlite3's
  `.transaction()` refuses to wrap an async callback ("Transaction function
  cannot return a promise"), so `SQLiteUnitOfWork` owns `BEGIN`/`COMMIT`/`ROLLBACK`
  by `exec()` around the async `work(repos)`, safe on one synchronous connection.
- **The smoke test proved a silent data-loss bug before it fixed anything else.**
  The first full run answered 201s while `SELECT * FROM patients` returned `[]`:
  two fire-and-forget inserts (`patient-repository.register`, `visit-repository.save`)
  built drizzle statements that **nothing executed** until `.run()` was added.
  A register that quietly truncs history to a status line was exactly the failure
  the always-on SQLite smoke suite was written to catch, and it was the first it
  caught.
- **This machine's bundled SQLite has no `translate()`**, so the accent fold's SQL
  side is per engine: PostgreSQL keeps `lower(translate(...))`, and SQLite calls a
  `fold_accents()` scalar — the same JS `foldAccents`, registered `deterministic`
  on every SQLite connection so it may be indexed — via `sqliteFoldable`.
- **Three of my expectations were wrong about the wire, not about the code.**
  `INVALID_INPUT` reaches the client as `VALIDATION_ERROR`, and the second visit
  in a row fails the domain's `DUPLICATED_RECORD` guard before any row is written,
  which the wire folds to `DOMAIN_RULE_VIOLATION` — the same answers the
  PostgreSQL route suite already pins. And moving an appointment onto its _own_
  slot is not a conflict: the UPDATE trigger's `id <> NEW.id` self-exclusion is
  why, so the trigger test needed a second booking to collide with.
- **The default stack came down to a file.** `.env.example` now points
  `DATABASE_URL=sqlite:./data/denti-code-u3.db` (one `db:migrate` + `db:seed`
  to create it); the `postgres://` line remains as the way back to the second
  engine, and the containerized instance is untouched.
- **Desktop dev was unblocked on this machine.** `pnpm run dev:desktop` failed
  because no Rust toolchain existed (`cargo` not found by tauri) and esbuild's
  postinstall was pnpm-blocked. Fixed: rustup stable 1.99.0 installed to
  `~/.cargo` (PATH appended to `~/.bashrc`), Tauri system deps via apt
  (`build-essential libwebkit2gtk-4.1-dev libgtk-3-dev libssl-dev
libayatana-appindicator3-dev librsvg2-dev`), and `esbuild` added to
  `onlyBuiltDependencies`. `pnpm run dev:desktop` now compiles (422 crates,
  ~3 min, tauri 2.12.1) and launches the window on `DISPLAY=:0`.

**Verification:** typecheck 12/12 · lint 12/12 + boundary guard (one pre-existing
warning) · format · build 5/5 · api: 7 passed / 13 skipped (PG opt-in) / 70 tests,
of which 12 are the always-on SQLite smoke · migration + seed verified on a real
SQLite file before the API ever opened it.

Session 28: the visit workspace — Milestone 6's exit criterion. `/visits/$visitId` is
the first screen a visit lives on, and the two endpoints session 24 wrote now have the
buttons that call them. `features/visits/` holds the presentation (status tone and
label, closure labels), one query (`useVisit`), one mutation (`useVisitClosure` over
the two bodyless POSTs), the failure sentences, and `visit-workspace.tsx`; the route
file renders it and does nothing else.

- **Everything on the screen is derived rather than declared.** The buttons are
  `allowedVisitTransitions(status)` ∩ `['OPEN','COMPLETED']` — the domain's
  `OPEN → CANCELLED` has no endpoint, so it is not drawn. The section nav is a data
  array with one row (`summary`) until an endpoint gives another section something to
  show, and the chosen section is component state, not search params (file routes type
  those `any`). Times come from `formatClinicDayTime` in the clinic's zone, with
  `READING_THE_CLINIC_CLOCK` moved into `format-clinic-time.ts` for the second screen
  that needs it; the clinician and chair are resolved from `useDentists`/`useChairs`
  with `onlyActive: false`, because a clinician who has left still has their history.
- **The mutation is non-optimistic, and the e2e exists to say so.** The chip flips on
  the refetch the invalidation triggers (`['visits']` + the patient's profile key);
  the agenda and dashboard are deliberately not invalidated, because a closure does not
  move the appointment (ADR 0022). The spec asserts the second read _and_ the chip, so
  a future optimisation that skips the refetch fails it.
- **The record is the door.** The patient profile's "Recent visits" rows are links now,
  and a `GET` 404 renders "This visit does not exist in the current clinic." with an
  "All patients" link rather than an empty shell.
- **Deliberately not built:** the doors that _start_ a visit — the agenda's start-visit
  action and the walk-in form — still have no UI (they are not on this phase's ordered
  list), and the sidebar's `/visits` link is a 404 with no visits list, which ADR
  0023's "no filterable collection" makes its own decision rather than an omission.
- **Two harness lessons worth keeping.** A component with `<Link>` cannot be tested
  without a router context, so the workspace tests mount a minimal three-route router
  with memory history; and the mock compares `url.pathname` to `/api/v1/...`, never to
  the origin-prefixed `BASE_URL`, which is why the first run failed for reasons that
  had nothing to do with the workspace.
- **The e2e layer's date drift was found here and fixed here.** Fourteen specs in
  `agenda`, `agenda-filters` and `booking` failed because their fixtures are pinned to
  2026-10-05 while the grid opens on today — a failing error context read "October 7,
  2026" over an empty grid — and the same fourteen reproduced on clean `a0d9361` with
  `git stash -u` before anything was touched. Fixed by freezing the page's clock at
  the fixtures' day (`e2e/web/fixtures/frozen-clock.ts`, which every spec now imports
  its `test` from) rather than making fixtures chase the calendar. 90/90.

**Verification:** typecheck 12/12 · lint 12/12 + boundary guard (one pre-existing
warning) · format · build 5/5 · 593 unit/component (20 new, three files under
`features/visits`) · 201 integration not run (no API, domain or schema file changed) ·
e2e: **90/90** — 5 new visit-workspace specs, plus the harness-clock fix that cleared
the 14 date-drift failures · Playwright chromium reinstalled
(`pnpm exec playwright install chromium`) after it had been cleared from the machine's
cache.

Session 32 (Task 2): payments — the sixth workspace section, and the settlement that
turns a bill into a receipt. `visit-payments.ts` holds `payVisitCharges` and
`listVisitPayments`; a settlement writes the payment, folds **every un-invoiced charge
into one invoice** (`markInvoiced` on both charge repositories, status derived `PAID`/
`PARTIALLY_PAID`), and allocates the whole payment against it — all inside the
`unitOfWork` transaction, with the payment's `id`, `receivedAt` and the invoice's
`number`/`issuedAt` from the clock. `amountMinor ≤ outstanding` is the money rule
(partial allowed, overpayment refused, follow-up after settlement refused — open
question 20); a payment is a `PAYMENT_METHODS` enum plus an optional reference. Three
new ports — `invoice`, `payment`, `paymentAllocation` — took `Repositories` from
eleven to fourteen, both engines, and `clearFixtures` deletes them before charges. The
API gained `GET`/`POST /api/v1/visits/:visitId/payments` (POST passes `reference`
only when present). The workspace's sixth row gates on both registers, draws
billed/paid/still-to-pay, closes the record form when no charge is un-invoiced, and
tells the closure story in words; the mutation invalidates payments + charges keys,
never `['visits']`. 12 settled-use-case domain tests (bad amount never written,
every un-invoiced charge folded, statuses derived both ways, follow-up refused,
list order), 6 validation, 4 component, a SQLite-smoke settlement
block and 3 e2e specs — the write spec swaps both read fixtures between the section's
first fetch and the write, so the row's server-owned `receivedAt` can have come from
nothing but the refetch. Verified 102/102 e2e after rebuilding `apps/web`.

Session 32 (Task 1): charges — the fifth workspace section, and the fourth "per visit" book.
`Charge` sits with the invoice machinery in `billing/invoice.ts` (`calculateChargeTotal`
already belonged there), and `visit-charges.ts` holds `listVisitCharges` and
`addVisitCharge` over an eleventh port. A charge is **the first of the five books to
carry its own `clinic_id`**, so `findForVisit(clinicId, visitId)` scopes on the charge's
own column while `save(charge)` takes no clinic id — the row carries it — and both verbs
still read the visit first (a foreign visit is 404 before any row moves, the FK
translation kept for a stray statement). The write inherits `patientId`/`visitId` from
the visit and `currency` from the clinic, stamps `createdAt` from the clock, defaults
`quantity = 1`/`discountMinor = 0`/`taxRatePercent = 0` (no tax field in the body yet —
open question recorded), refuses blank descriptions and non-positive or negative money
inline, and needs no `UnitOfWork`: one insert. `GET`/`POST
/api/v1/visits/:visitId/charges` sit beside the other three per-visit pairs, with
`DrizzleChargeRepository` + `SQLiteChargeRepository` behind them. The workspace's fifth
row draws line totals from `calculateChargeTotal` and parses major-unit boxes to integer
minor units in one place (`parseMajorUnitsToMinor`), keeps the front desk's draft on a
refusal, and invalidates only `['visits','charges',visitId]`. The seed's third charge
sits on Luis's open visit; `seedSummary` reads "3 charges, 2 payments". Domain,
validation, component, SQLite-smoke and route tests written (PG skips here); 3 e2e specs
— one swaps the mock's static charges read from `[]` to the raised row between the
section's first fetch and the write, so the post-POST refetch is the only possible
source of the row on screen. Verified 99/99 e2e after rebuilding `apps/web`.

Session 31: prescriptions — the fourth workspace section, and the third "per visit"
book after notes and treatments. `prescription.ts` was rewritten around the
`PrescriptionRepository` (one port, `Repositories` ten): `prescription.ts` keeps the
entity, `MEDICATION_ROUTES` and the `MedicationRoute` type, and `visit-prescriptions.ts`
holds `addVisitPrescription` and `listVisitPrescriptions`. Scope comes through the visit
(a foreign visit answers 404 to both verbs, in both engines via the FK translation —
`23503`/`SQLITE_CONSTRAINT_FOREIGNKEY` → `NOT_FOUND`), `patientId`/`dentistId` are
inherited from the visit and never accepted from the body, `issuedAt` is the clinic's
clock, and a blank instruction stores null. The old `assertValidPrescription` was deleted
as a second copy of the rules; the use case validates the course inline while the
endpoint's `createPrescriptionSchema` refuses the same shapes. `GET`/`POST
/api/v1/visits/:visitId/prescriptions` sit beside the treatments endpoints, and
`VisitPrescriptionsSection` is the fourth nav row: it lists course, route label, frequency
and days in the clinic's clock, files with a route picker over `MEDICATION_ROUTE_OPTIONS`,
trims on the way out, and keeps the whole draft when the API refuses it. 15 domain tests,
6 validation tests, 4 component tests, a SQLite smoke block, and 2 e2e specs (96/96);
a live probe against the seeded dev DB confirmed the seeded row serves, inheritance,
the clock, blank→null, and the 404/422 refusals. The seed gained a prescription on Luis's
open visit and `seedSummary` says so.

Session 30: treatment records — what was actually done, named through the catalogue.
`recordVisitTreatment` and `listTreatmentRecords` (`visit-treatment-records.ts`) read the
visit first (404 for a foreign visit) and the treatment second (422 for a foreign or
retired one), and `TreatmentRecord` is a `TreatmentRecordOutcome` striped with `tooth`,
`notes` and `performedAt` from the clinic's clock. Two ports, `treatments` and
`treatmentRecords`, grew `Repositories` from seven to nine once both engines existed.
The catalogue got `GET /api/v1/treatments`; the workspace's third row got `GET`/`POST
/api/v1/visits/:visitId/treatments`. `VisitTreatmentsSection` resolves names through a
60-second-cached catalogue, keeps the whole form when the POST refuses it, and never
writes optimistically — the row arrives with the server's `id`. The realigned
`TreatmentCatalogueItem` dropped `category` and made `code`/`description`/`duration`
nullable, and the seed now carries four treatments plus one recorded execution.
Two repos per engine, `Repositories` nine, no treatmentPlanItemId (Milestone 8), no
status gate, no `UnitOfWork`. 21 new tests + 2 e2e; verification green (below).

Session 29: clinical notes — the first row the workspace's section nav gained, and the
promise session 28's data-driven nav made. `clinical-notes.ts` holds `listClinicalNotes`
and `addClinicalNote` over a new `ClinicalNoteRepository` port; two endpoints,
`GET`/`POST /api/v1/visits/:visitId/notes`, sit behind the existing `readVisitId` guard;
and `VisitNotesSection` is the second row in `visitSections`.

- **Scoping comes through `visits`, because a note has no clinic of its own.**
  `clinical_notes` has no `clinic_id` — the table was already in both baseline
  migrations, so no migration was written — and `findForVisit(clinicId, visitId)`
  inner-joins it while the use case reads the visit first. A visit this clinic does not
  hold is a 404 for both verbs, `[]` only for one it does, and `save` takes no clinic id:
  one row, one statement, no `UnitOfWork`, with the foreign-key violation translated to
  `NOT_FOUND` the way the visit repositories translate `23503`.
- **`Repositories` grew from six to seven, which is the rule's first use in the other
  direction.** The set holds what can be built: `clinicalNotes` was added when both
  implementations existed, not before — the same policy that removed three
  unconstructible repositories in session 23.
- **The client does less than it could.** The notes query is mounted rather than
  `enabled` (nothing is asked for until the section is opened), the mutation invalidates
  only `['visits','notes',visitId]` (a note does not change the visit row, so also
  re-reading the visit would be the client implying it did), and nothing is optimistic:
  the row arrives carrying the server's `id` and `createdAt`, which is exactly what the
  e2e asserts — the part no browser could have produced — alongside the POST's own body
  and a second notes read.
- **The refusal keeps the paragraph.** `describe-note-failure` quotes `ApiClientError`'s
  message like its visit sibling, and the draft stays in the textarea: a request that
  ate the text would be the most destructive thing the panel could do.
- **Not attributable, not editable.** `authorId` is null (no user model — ADR 0022's
  question 18) and there is no edit or delete: an append-only record was the simplest
  honest rule until revising history becomes a product decision.
- **Booting the app found a defect in the ground under it.** The desktop shell opened
  on "The patient list could not be loaded": no API was running, and `db:migrate`
  itself crashed with `Cannot open database because the directory does not exist`,
  because `data/` is gitignored and had been cleaned off the machine.
  `ensureSqliteDatabaseDirectory` (`database/db-url.ts`) now creates the directory a
  file URL names, called by all three openers — migrator, seeder, API connection —
  before `new Database(path)` (6 tests). Migrate, seed and the API then ran against a
  real file; `/health` and `/api/v1/patients` answered 200.

**Verification:** typecheck 12/12 · lint 12/12 + boundary guard (one pre-existing
warning) · format · guard:boundaries OK · build 5/5 · 622 unit/component (29 new:
domain, validation, `features/visits`, and the SQLite path helper) · 207 integration
skipped — **Docker and every PostgreSQL client are absent from this environment, so the
six new route tests were written and typechecked but not executed**, with the always-on
SQLite smoke test covering the same path · e2e: **92/92** — 2 new notes specs.

Session 36: the App UI for Task 3 — the half session 35 left open. `/treatments`
now draws the catalogue the sidebar's link had been dangling at (add form with the
price parsed to integer cents, catalogue rows drawn as money, nothing listed from the
form's own values), and the patient profile gained a read-only plans section between
the care cards and the odontogram. `useTreatments` moved to
`features/treatments/queries/catalogue-query.ts`, keeping the `['treatments']` key so
the workspace and the page share one request. Seven browser specs (four catalogue,
three plans), each verified by reintroducing the defect. The session also found and
fixed a **pre-existing e2e flake**: six specs installed the POST's answer _after_
clicking, which races the response; each swap now happens before the write, and the
suite ran 116/116 three times in a row. Milestone 8's remaining half is a plan's own
write and the states of its items.

**Verification:** typecheck 12/12 · lint 12/12 + boundary guard (one pre-existing
warning) · format · guard:boundaries OK · build 5/5 · 755 unit/component (app 302,
29 new this session) · 252 PG integration skipped (**no Docker or PostgreSQL client
in this environment**) · e2e: **116/116** — 7 new specs, run three times in a row.

Session 37: Milestone 8's treatment-plan write side, end to end. The
`TreatmentPlanRepository` port gained `listForPatient`, `getForPatient` and a
transactional `save` (write models `TreatmentPlanWriteModel`/`TreatmentPlanItemWriteModel`),
upserting by id and **never deleting an item** (the execution FK is `on delete set null`).
Three use cases — `createTreatmentPlan` (opens `DRAFT`, folds catalogue labels, returns
the same summary the read produces), `updateTreatmentPlan` (stamps `presentedAt`/`acceptedAt`
without overwriting or inventing a transition graph) and idempotent, bodyless
`completeTreatmentPlanItem` — sit over the port. Routes `POST …/treatment-plans`,
`PATCH …/:planId` and `POST …/:planId/items/:itemId/complete` are wired in `app.ts`, with a
foreign-key refusal translated to `NOT_FOUND` naming the patient. The profile's plans
section stopped being read-only (inline propose form, per-line Mark done), both writes
non-optimistic and invalidating only `['patients','treatment-plans',patientId]`;
presenting/accepting are deliberately not drawn — no status buttons.

**Verification:** typecheck 12/12 · lint 12/12 + boundary guard (one pre-existing
warning) · format · guard:boundaries OK · build 5/5 · domain 297, validation 139,
app 306, API 80 passed / 254 skipped (the PG plan-write block typechecks but **skips —
no Docker or PostgreSQL client in this environment**; the SQLite smoke suite covers the
same path) · e2e: **119/119** — 3 new plan specs.

Session 38: the plan-item → visit link — the execution half of Milestone 8's remaining
bullet, and a **provenance-only** link by decision. `recordVisitTreatment` gained an
optional `treatmentPlanItemId` and the rule that makes it meaningful: when named, the
item must be on the patient's own plan in this clinic and its `treatmentId` must equal
the record's, else `INVALID_INPUT`; the lookup reuses `listForPatient` (no new port verb)
and the read is recorded. Both engines write the `treatment_plan_item_id` column in
`save`. Recording a linked treatment does **not** complete the item — completion stays
`completeTreatmentPlanItem`'s explicit act — so the record mutation still invalidates only
`['visits','treatments',visitId]`, never the plan read. On the visit workspace the
recorder offers the open items for the chosen treatment (a `Not linked to a plan item`
default, each option spelling its tooth), dropping the choice when the treatment changes.

**Verification:** typecheck 12/12 · lint 12/12 + boundary guard (one pre-existing
warning) · format · guard:boundaries OK · build 5/5 · domain 303, validation 141, app 307,
API 81 passed / 256 skipped (the PG link block typechecks but **skips — no Docker or
PostgreSQL client in this environment**; the SQLite smoke suite covers the same path) ·
e2e: **120/120** — 1 new link spec.

Session 39: the plan-item → charge link — the second half of Milestone 8's remaining
bullet, closing the roadmap's "Link plan items → visits → charges" line. `Charge` gained
`treatmentPlanItemId` and `addVisitCharge` the optional field: when a plan item is named,
the use case reads `treatmentPlans.listForPatient(clinicId, visit.patientId)` (the same
read the record link reuses), refuses an item not on the patient's own plan with
`INVALID_INPUT`, and **folds the item's own catalogue treatment into the charge's
`treatmentId`**; a blank/absent id is `null` and reads no plans. Like the execution link
it is **provenance only** — billing a planned line never completes it — so the charge
mutation still invalidates only `['visits','charges',visitId]`, never the plan read. The
`charges` table gained a nullable `treatment_plan_item_id` FK with `on delete set null` in
`database/schema` _and_ `database/schema/sqlite`, migrated per engine (ADR 0025); both
repositories write and map the column. The wire is `createChargeSchema`'s new optional
nullable uuid; the route spreads it and passes `treatmentPlans`. The visit workspace's
charges section now offers the patient's open lines in a `Planned item` picker beside the
price, resetting with the form.

**Verification:** typecheck 12/12 · lint 12/12 + boundary guard (one pre-existing
warning) · format · guard:boundaries OK · build 5/5 · domain 308, validation 142, app 308,
API 82 passed / 258 skipped (the PG link block typechecks but **skips — no Docker or
PostgreSQL client in this environment**; the SQLite smoke suite covers the same path; two
write-path assertions checked by reintroducing the defect) · db:migrate + db:seed
re-verified against the SQLite file · e2e: **121/121** — 1 new billing spec.

Session 43: Milestone 9 slice 2 — the **patient balance**, closing open question T6.
Nothing is stored new; the balance is derived over the ports slice 1 already had.
`calculatePatientBalance` now takes the patient's **raw money received** and
subtracts the allocations itself, excluding `DRAFT`/`VOID` **and their allocations**,
so it collapses to `billed − received` — a payment must not change the answer by
which document it was pointed at. Each figure is the document's stored total, tax
included as printed. `getPatientBalance` decides the patient first (`NOT_FOUND`
before the clinic or payments are read) and takes the currency from the clinic, so a
patient with nothing still has one. `PaymentRepository.findForPatient` landed on both
engines and is deliberately not an existence check. The wire is
`GET /api/v1/patients/:patientId/balance`; the profile gained a Balance card above
the invoices card that names the three states a column of digits cannot tell apart.
`Allocation` was left dead by the rework and was removed. 9 new domain tests, a
SQLite smoke block, a component test and 4 new e2e specs; the profile's other
browser specs each gained the balance fixture (an unregistered path is a 501 and
several assert an empty console-error list). The first implementation subtracted a
voided document's allocation too and answered −50_000 credit; caught by a fixture,
fixed by filtering the voids in the domain.

**Verification:** typecheck 12/12 · lint 12/12 + boundary guard (one pre-existing
warning) · format clean · build 5/5 · domain 327, validation 142, app 318,
api-client 15, database 6, desktop 3; API SQLite smoke 25 (PG suite typechecks but
**skips — no Docker or PostgreSQL client in this environment**) · e2e: **128/128**.

Session 48: Milestone 12's **authentication slice** (ADR 0028) — the API no longer
trusts a configured `CLINIC_ID` as the caller. The schema gained a `sessions` table on
both engines (ADR 0025), and `users` is now real data: the seed creates four development
users (`admin@`, `recepcion@`, `elena.vargas@`, `marco.salas@denti-code.test`, password
`denti-code-dev`) and links the two dentists to theirs. Passwords are hashed with
`node:crypto` scrypt (`scrypt$N$r$p$salt$hash`, `timingSafeEqual`); `bcrypt`/`argon2`
were rejected as native addons. Login returns an opaque 32-byte bearer token; the API
stores only its **SHA-256** digest (the token is high-entropy, so a per-request KDF buys
nothing). Sessions last 12 hours by default (`SESSION_TTL_HOURS`, 1–720). Login refusals
are identical for an unknown email, a wrong password, a deactivated user and a missing
hash, so there is no account enumeration; email lookup is case-insensitive.

The auth plugin (`apps/api/src/http/plugins/auth.ts`) runs on `onRequest` and **fails
closed**: only `/`, `/health`, `/ready` and `POST /auth/login` are public. It replaces
the deleted `clinic-scope.ts`, sets `request.principal` and `request.clinicId`, and
enforces a role/permission matrix that lives in the domain
(`packages/domain/src/organization/roles.ts`). Every API route now declares
`config: { permission: … }`, so a caller whose role lacks it gets **403** (distinct from
the **401** that means "log in"). The matrix is pinned by a new domain test.

The client owns the session in one place (`packages/app/src/features/auth`): storage
with a validate-on-read, `SessionProvider` that pushes the bearer header into the shared
`ApiClient`, a login screen gated by the root route, and a header that shows the
signed-in user and a Sign out button. A 401 from any query dispatches
`denti-code:unauthorized`; the provider clears the session and the query cache, so an
expired or revoked token becomes a login screen instead of a page of failed requests.

**Verification:** typecheck 12/12 · lint 12/12 + boundary guard (one pre-existing
warning) · format clean · build 5/5 · domain **368**, validation 153, app **344**,
api-client 15, database 6, desktop 3 · API integration: **38 passed / 273 skipped**
(the PG specs still typecheck and skip without `TEST_DATABASE_URL`; the SQLite smoke
suite logs in and now sends a bearer token on every request, and a new
`auth.integration.test.ts` covers 401/403/200/login/logout/me) · db:migrate + db:seed
re-verified · e2e **143/143** (a new `login.spec.ts`; the shared fixture seeds a session
so every other spec still starts inside the shell). The reports spec's request poll was
tightened to wait for `dentistId` — it could read the pre-selection request.

---

Session 49: Milestone 12's **login rate limiting** (ADR 0029). ADR 0028 shipped
authentication with one recorded gap — an attacker could try passwords indefinitely,
because every failure was an identical, cheap 401. This slice closes it without adding
infrastructure.

**What was built.** `LoginRateLimiter` (apps/api/src/infrastructure/security) is a
bounded, in-memory fixed-window counter keyed by **normalised email + `request.ip`**.
Email-only keys would let an attacker lock a known member of staff out; address-only
keys would let one shared clinic terminal throttle everyone. Only
`UNAUTHENTICATED` results from `login()` are counted — a validation error, a database
outage or a bug must not punish a correct password — and a successful sign-in deletes
the key. The check runs after body validation and **before** the credential check, so an
exhausted window refuses even the right password (otherwise the password would leak
through the limiter) and no hash is computed for a refused attempt. Defaults are five
failures per fifteen minutes (`AUTH_LOGIN_MAX_ATTEMPTS` /
`AUTH_LOGIN_WINDOW_MINUTES`, both validated in the env schema), and the map is capped at
10 000 keys with expired-entry pruning and oldest-key eviction as a memory safety valve.

**The answer.** `429 RATE_LIMITED` with `Retry-After: <seconds>` and the standard
problem envelope. `RATE_LIMITED` was added to `ApiErrorCode` and the client's
`API_ERROR_CODES`, and `LoginPage` now distinguishes it: a throttled operator sees
"Too many sign-in attempts. Try again later." instead of being told a correct password
is wrong. Refusals log the request id and address, never the email.

**Why in process.** The deployment is one API process; a counter table would add two
repository methods on both engines and a write on the unauthenticated login path for
state that expires in fifteen minutes, and Redis is infrastructure this project does not
have. The cost is honest and documented: counters are per instance, reset on restart, and
a multi-instance deployment needs shared storage or proxy-level limiting. With
`trustProxy: false`, a proxied deployment must trust the forwarded address per deployment
or let the proxy own the limiter, otherwise every client shares the proxy's address.

**Tests.** 8 unit tests for the limiter (limit, check-is-not-a-failure, success reset,
window expiry, key independence, rounded `Retry-After`, pruning/eviction, bad
configuration), 2 new integration tests (throttling from one account does not block a
different account from the same address; a success clears the count so the next two
failures are 401, not 429), a login-page component test for the 429 message, and a
browser spec for the same status. The integration suite's server is built with
`AUTH_LOGIN_MAX_ATTEMPTS=2` and two new throwaway users so the throttle is cheap to
reach.

**Verification:** limiter unit 8/8 · API unit **122** · API integration **40 passed /
273 skipped** (SQLite auth + smoke) · app **345** · typecheck 12/12 · lint 12/12 + guard ·
format clean · root test 12/12 tasks · build 5/5 · e2e **144/144** · db:migrate + db:seed
re-verified (the development logins are unchanged).
Docs: ADR 0029 (and ADR 0028's "not rate-limited" bullet updated), `security.md`,
`roadmap.md`, `.env.example`.

---

Session 50: a **development-only "sign in as" chooser** (ADR 0030). Testing a
permission matrix by retyping the seeded password is friction, and a suite that only
ever runs as the administrator never sees the differences. The login screen now lists
the clinic's active users and starts a session as one, with no password.

**The gate is route existence.** `buildServer` registers `registerDevAuthRoutes` only
when `NODE_ENV !== 'production'`; there is no env flag to leave on and no handler to
forget. Both routes are public because they exist to be reached before a session.
`GET /api/v1/auth/dev-users` returns the safe `AuthenticatedUser` projection (no hash,
active only); `POST /api/v1/auth/dev-login` takes `{ userId }` and returns the normal
login body. The domain's `startSessionForUser` refuses unknown/inactive users and then
calls the same private `issueSession` as the password login, so storage, hashing, TTL
and `last_login_at` have one implementation. A dev session is a real session: it is
revocable, expires and is permission-checked like any other. Every use logs a warning
with the request id and user id.

**One side fix.** The auth hook now returns early when no route matched
(`routeOptions.url === undefined`), so an absent development route answers **404**, not 401. Answering 401 meant the production login page would dispatch
`denti-code:unauthorized` for a route that simply does not exist; "no such route" is not
an authentication failure.

**Client.** `useDevUsers` (retry disabled: one expected 404 in production) feeds a
Development panel under the form. Selecting a user calls `SessionProvider.signInAs`,
which stores the session through the same `acceptSession` path as the password form.

**Tests.** +3 domain (`startSessionForUser`: active issues and records, inactive refused
without a session, unknown refused), +1 app component (chooser lists and signs in; the
refused-login test now asserts the chooser is hidden), +3 API integration (list without
credentials, sign in as a chosen user and use its token, inactive/malformed refused) and
+a production-server assertion that both routes answer 404 under
`NODE_ENV=production`, +1 e2e (chooser signs in).

**Verification:** domain **371** · app **346** · API unit **122** · API integration
**44 passed / 273 skipped** · typecheck 12/12 · lint 12/12 + guard · format clean · root
test 12/12 tasks · build 5/5 · e2e **145/145** · db unchanged (no migration).
Docs: ADR 0030, `security.md`, `roadmap.md`.

---

Session 51: the desktop shell opens **maximized**. `apps/desktop/src-tauri/tauri.conf.json`
sets `maximized: true` on the main window, keeping the 1024×720 minimum so a manual
un-maximize still lands on a usable size. The agenda and visit workspace are built for a
wide screen; starting at 1366×768 left a larger clinic monitor unused. `tauri-config.test.ts`
pins the flag and the minimum size alongside the CSP assertions. Desktop tests **4/4**.

---

Session 52: `/` now **redirects to `/dashboard`** (replace, not push) instead of rendering the
old "Foundation is mounted" placeholder. A fresh launch — web or desktop, signed in or signed
out — therefore lands where a clinic expects: the dashboard behind the login screen, then the
dashboard after sign-in. `router.test.tsx` and `mount.test.tsx` assert the redirect and anchor
on the `Clinic statistics` region; e2e smoke/login now install the dashboard fixtures and
assert the landing URL; the patient-search spec filters its "no request" check to the patient
list, since the dashboard's own reads are expected. App tests **346/346**, desktop **4/4**,
e2e **145/145**.
---

Session 53: the sidebar's **Visits** link now has a screen (ADR 0031, amending ADR 0023).
`GET /api/v1/visits?page=&limit=` returns a page of the caller's visits with an exact total
(default 20, max 100, newest first by `coalesce(started_at, created_at)` with `id` as the
tiebreak). The domain's `listVisitsForActor` decides the scope from the principal, never from
a query parameter or the browser: a `DENTIST` is resolved through `dentists.user_id` and sees
only their own visits (no clinician row → an empty page); `ADMINISTRATOR` sees the clinic's;
`RECEPTIONIST`/`ASSISTANT` see the clinic's too, recorded as open question 21. This is a
default view, not a read barrier — `GET /visits/:visitId` stays clinic-scoped by permission.
`VisitListEntry` carries patient and clinician names joined on `(id, clinic_id)`, so the
directory is one request rather than an N+1. Both engines implement the query.

**UI.** `/visits` (`visits.tsx`, sibling of `visits_.$visitId.tsx`) renders a table of
patient, clinician, clinic-time start and status, with paging and an empty state. The
clinician column is always shown: a manager needs it, and a clinician's rows repeat the same
name rather than the screen quietly differing by role. `visit-query.ts`'s "no list" comment
and the workspace route's note are updated.

**Tests.** +5 domain (`listVisitsForActor`: three roles unfiltered, dentist narrowed with the
page forwarded, unlinked dentist empty), +3 app component (clinic clock, page-2 request on the
wire, empty record), +2 SQLite API integration (dentist vs manager rows and names, paging and
the 100-row cap in `auth.integration.test.ts`), +4 e2e (`visits.spec.ts`). API unit rose to
128 as the suite's own fixtures grew. Domain **376** · app **349** · desktop **4** · API unit
**128** · API integration **46 passed / 273 skipped** · typecheck 12/12 · lint 12/12 + guard ·
format clean · root test 12/12 tasks · build 5/5 · e2e **149/149** · db unchanged (no
migration). Docs: ADR 0031, ADR 0023 amended, `roadmap.md`, `open-questions.md`.
---

Session 54: the sidebar's **Odontogram** link now has a page. `/odontogram` gates the chart
behind the shared `PatientPicker` — no patient means no request, because there is no chart
that would belong to anyone — and then mounts the same `PatientOdontogramSection` the patient
profile draws. One chart, one upsert form, one row list, one clinic-clock formatter: a second
chart would answer "what does this tooth look like" twice and drift on the first new
condition. Switching patients remounts the section (`key`), so a selected tooth, condition,
surfaces and notes never cross records. The selection is component state rather than a search
param for the documented T2 reason; a reload asks again, which is acceptable for a working
screen whose unit is a tooth rather than a shared link. No endpoint, domain or schema change.

**Tests.** +2 app component (`odontogram-page.test.tsx`: no request before a patient, then
the chosen patient's chart on the clinic's clock) and +2 e2e (`odontogram-page.spec.ts`: the
gate, and Ana → Luis replacing the chart rather than leaving tooth 16 on screen). App **351** ·
e2e **151**. Existing domain **376**, desktop **4**, API unit **128**, API integration **46
passed / 273 skipped** unchanged. Typecheck 12/12 · lint 12/12 + guard · format clean · root
test 12/12 tasks · build 5/5 · db unchanged. Docs: `roadmap.md`, `frontend.md`.

---

Session 55: the shell's content cap rose from `max-w-[1600px]` to `max-w-[1920px]`, so the
agenda, the dashboards and the visit workspace use a large clinic monitor instead of
letter-boxing at 1600. `max-w-7xl` on the auth/loading frame is unchanged: those are forms,
not working surfaces.

The development seed now carries a page of data for the screens this phase demos: **10
patients** (+7), **10 appointments** (+6, six of them today across two rooms), **10 visits**
(+8 completed/cancelled history rows, still eight completed, one open, one cancelled) and
**10 odontogram entries** (+8 findings across the seeded charts, one current state per tooth).
Every row keeps the seed's fixed ids and `onConflictDoNothing`, both engines receive the same
values, and `seedSummary()` names the new counts. The local SQLite file was rebuilt from
`db:migrate` + `db:seed`, because old relative timestamps would otherwise leave only three
appointments in _today_.

**Verification.** `typecheck` 12/12 · `lint` 12/12 + guard · `test` 12/12 tasks (domain 376,
app 351, desktop 4) · `build` 5/5 · seed span twice, counts stable (10/10/10/10, six today).
No migration or schema change.

---

Session 56: the application now has a **typed English/Spanish catalogue**, with Spanish as
the product default (ADR 0032). `packages/app/src/i18n` holds the locale contract, the
translator, an `I18nProvider` mounted once in the root route, the `enumLabel` door for domain
values and three feature catalogues (`common`, `dashboard`, `patients`). The English
catalogue defines `TranslationKey`; the Spanish catalogue is checked with
`satisfies Record<TranslationKey, string>`, so a missing sibling fails typecheck. There is no
i18n dependency: interpolation is only `{name}`, plurals are explicit `.one`/`.other` keys,
and the provider's fallback is English so isolated component tests keep their assertions.

The header gained a language switch. The choice persists under `denti-code-locale`, opens in
Spanish when nothing is stored, and updates `<html lang>`. Translated in this slice: the app
frame, header/sidebar/global search, the dashboard and all its widgets, the patient list,
registration, profile, edit form, picker, treatment plans, balance, invoices, statement and
odontogram. Failure describers accept optional translated messages while keeping their
English defaults.

The existing browser suite was written in English, so its shared fixture pins the locale;
`i18n.spec.ts` overrides it for the Spanish flow (dashboard + switch back, patient list,
profile sections). Two first-run e2e failures were selector drift rather than product bugs
(`Pacientes` matched both the nav link and a dashboard quick action; `Saldo` matched the
profile card and balance card), and one was a real copy regression: `patients.profile.tooth`
and `.quantity` had lost their leading space when moved into the catalogue, so an outstanding
treatment rendered `Restorative plan· tooth 26` instead of `Restorative plan · tooth 26`.
Both catalogues now keep the separator.

**Verification.** Typecheck 12/12 · lint 12/12 + boundary guard (one pre-existing React
Compiler warning) · format clean · build 5/5 · domain 376, app **355**, desktop 4, API unit
128, API integration **46 passed / 273 skipped** (PG skips without `TEST_DATABASE_URL`) ·
e2e **154/154**. Docs: ADR 0032, `frontend.md` §14, open question #9.

---

Session 57: the agenda and calendar now speak Spanish. The agenda catalogue covers the
route shell, filter chips, event fallbacks, quick panel, booking dialog, appointment status
labels and transitions, the failure sentences the client builds, and the calendar's own
loading/empty/error copy. FullCalendar gets its bundled `es` locale, with our view/today
buttons translated over it, so month/day names and the toolbar both follow the app rather
than the browser. The agenda adapter now takes the translated "Unassigned" label; English
remains the default for isolated tests.

**Tests.** +4 app unit/component tests (Spanish calendar controls, quick panel, booking
dialog and failure sentence) and +1 e2e Spanish agenda flow (grid controls, filters, quick
panel). App **359** · e2e **155**. Existing domain **376**, desktop **4**, API unit **128**,
API integration **46 passed / 273 skipped** unchanged. Typecheck 12/12 · lint 12/12 + guard ·
format clean · root test 12/12 tasks · build 5/5. Docs: ADR 0032, `frontend.md` §14,
`open-questions.md` #9.

---

Session 58: the **visit directory and workspace** joined the Spanish catalogue. A new
`visits` catalogue carries the list headings and record count, the status and closure
vocabulary, the seven section names, every summary/note/file/treatment/prescription/charge/
payment label and empty state, the medication and payment vocabularies, and the failure
sentences the client builds. Status, closure, payment-method and medication-route labels now
come from explicit typed key maps in their presentation modules; the option lists are
functions of the translator rather than exported English constants. The seven failure
describers accept optional translated `notFound`/network messages and keep their English
defaults, so isolated tests stay stable while the workspace passes the Spanish sentences.

Both the directory and the workspace are translated end to end, including the resolved
clinician/chair/treatment names, the clinic-clock placeholder (`common.readingClinicClock`),
section navigation, save state, loading and error states.
`visit-list.test.tsx` and `visit-workspace.test.tsx` gained an optional `locale` option and
Spanish assertions; `visit-status-presentation.test.ts` asserts the Spanish statuses and
closure actions. The new browser flow covers the Spanish directory and workspace up to the
empty notes section.

A first full run was 155/156: the Spanish list test asked for heading `Visitas`, which also
matches `Visitas recientes`; the list heading assertion is now exact, and the suite is green.

**Verification.** Typecheck 12/12 · lint 12/12 + boundary guard (one pre-existing React
Compiler warning) · format clean · build 5/5 · domain 376, app **362**, desktop 4, API unit
128, API integration **46 passed / 273 skipped** (PG skips without `TEST_DATABASE_URL`) ·
e2e **156/156**. Docs: ADR 0032, `frontend.md` §14, `open-questions.md` #9.

---

Session 59: the sidebar's **Payments** link now has a screen: `/payments` is a
**read-only clinic-wide payment ledger** (ADR 0033). `GET /api/v1/payments` takes
inclusive clinic-local `from`/`to` dates plus an optional method and pages
(20 default, 100 max); the route resolves the dates into a half-open UTC window, caps
the period at 366 days, answers `422 VALIDATION_ERROR` for a reversed range, unknown
method or wider period, and keeps `totalAmountMinor` over every row matching the
period and method rather than the current page. `PaymentRepository.listForClinic` joins
the patient name and is implemented twice under ADR 0025. Reading money requires
`billing:read` (administrator, dentist, receptionist; not assistant); the UI hiding the
link is convenience, not the barrier. Recording money stays on the visit settlement
flow, where the payment, allocation and invoice are written atomically — the ledger
deliberately has no record button (open question 22).

The page defaults to month-to-date on the clinic clock, filters by method, pages the
rows, links each to its patient and draws the server total. It is translated in both
catalogues. The shared `clinic-period` helper now serves both `/payments` and `/reports`.

**Tests.** +3 app component (`payments-page.test.tsx`: rendered ledger, method filter on
the wire, empty period), +1 SQLite API integration (ledger rows, method filter, reversed
range 422), +4 PostgreSQL repository tests (skipped without `TEST_DATABASE_URL`: window,
clinic scope, filter with page total, preferred-name preference), +4 e2e (three ledger
flows and the Spanish ledger in `i18n.spec.ts`). App **365** · domain 376 · desktop 4 ·
API unit **129** · API integration **46 passed / 277 skipped** · typecheck 12/12 · lint
12/12 + guard · format clean · root test 12/12 tasks · build 5/5 · e2e **160/160** · db
unchanged (no migration). Docs: ADR 0033, `roadmap.md`, `open-questions.md` #22.

---

Session 60: the remaining UI joined the Spanish catalogue. New `treatments`, `inventory`,
`reports`, `odontogram` and `auth` modules cover the treatment catalogue, the inventory
page and its failure sentences, the reports filters/stat cards/performance table, the
odontogram shell, and the login screen including role labels. `common` gained the runtime,
theme, error and not-found keys. The hardcoded dashboard empty state was fixed to use the
key that already existed.

The error boundary now renders a functional fallback through `useTranslation`, so
`I18nProvider` had to move outside `ErrorBoundary` in `RootLayout`; the 404 component gets
its own provider because TanStack replaces the root component when it renders. English
strings were kept byte-for-byte where tests pin them, and the existing 365 app tests pass
unchanged.

**Verification.** Typecheck 12/12 · lint 12/12 + boundary guard (one pre-existing React
Compiler warning) · format clean · build 5/5 · app **365** tests · e2e **160/160**.

---

Session 61: the development seed now fills the agenda a week out. `WEEK_AHEAD_SLOTS`
generates 36 more appointments for today through day +7, in addition to the ten fixed
bookings, so the day and week calendars have rows on every column. Room 1 always pairs
dentist 1 with chair 1 and room 2 pairs dentist 2 with chair 3; rooms are exclusive, so
that pairing keeps generated rows clear of each other. Today and tomorrow avoid the
existing slots, including the two bookings already seeded three days out.

The seed is still idempotent: generated ids start after the fixed ten, and SQLite still
pre-filters ids before insert so its overlap trigger never sees a re-insertion. The
summary prints 46 appointments. The development SQLite database was re-seeded and now
holds 6 appointments today, 8 tomorrow and 4 on each following day through Nov 6.

**Verification.** Database typecheck and lint pass · format clean · seed run twice without
error · live database totals 46 appointments (6 today, 8 tomorrow, 4/day through day +7).

---

Session 63: the development seed now carries Spanish clinical data. Its clinic name,
dentist specialties and patient allergies are localized, along with the four treatment
catalogue entries and their descriptions; visit reasons and summaries, odontogram notes,
the restorative plan title, treatment-execution notes, the clinical note, the ibuprofen
prescription, attachment file names and charge descriptions all read in Spanish. Codes,
enum values, logins and the `US` dollar currency stay literal.

Seeding a clean SQLite database then failed on the overlap trigger: the generated day +3
09:00 booking in room 1 collided with fixed appointment 4, and its 10:00 booking in room 2
collided with fixed appointment 10. The two generated slots swapped rooms, leaving both
rooms free at those hours. A fresh migrated database now seeds all 46 appointments, and the
four treatment names, two specialties, prescription and charges were read back in Spanish.

**Verification.** Format clean · database typecheck/lint · root tests 12/12 tasks · clean
SQLite migrate + seed · full typecheck/lint + boundary guard earlier in the session.
