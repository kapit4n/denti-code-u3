# Denti-Code U3 — Roadmap

Twelve milestones. **Phase 1 (Milestone 1: Foundation) is the current phase.**
Each milestone ends with a working, verifiable increment — never a pile of
half-features.

---

## Milestone 1 — FOUNDATION ✅ _(in progress)_

Architecture documentation, ADRs, monorepo, tooling, minimal runnable
web/desktop/API, database foundation, test foundation.

**Done when**

- [ ] Architecture, domain, frontend, backend, database, desktop, testing docs
- [ ] ADRs covering monorepo, Tauri, PostgreSQL-only, domain boundaries, REST,
      feature-oriented frontend, TanStack Query vs Zustand, shared app package,
      platform abstraction, design system, calendar adapter
- [ ] pnpm + Turborepo workspace installing and building cleanly
- [ ] TypeScript strict across every package; ESLint flat config; Prettier
- [ ] Boundary guard (`pnpm run guard:boundaries`) passing
- [ ] `packages/{tsconfig,types,config,validation,domain,api-client,ui,app}`
- [ ] `apps/api` boots, validates env with Zod, structured logs, `/health`
- [ ] `apps/web` builds and serves the shared application
- [ ] `apps/desktop` Tauri 2 shell over the same application
- [ ] PostgreSQL via Docker; Drizzle schema; migrations applied; seeds
- [ ] Vitest + RTL + Playwright foundations; domain tests passing
- [ ] `typecheck`, `lint`, `format:check`, `test`, `build` all green

**Explicitly excluded:** business features, auth implementation, offline.

---

## Milestone 2 — APPLICATION SHELL

The application shell is the first UI milestone and the foundation of every
screen.

- Sidebar (compact, primary navigation)
- Top header + breadcrumb
- Global patient search (search by name, phone, identification)
- Command palette / search interface
- User menu (clinic, role, preferences, sign-out placeholder)
- Main content area + responsive layout
- Theme support (light default, dark prepared at token level)
- Navigation state and active-route indication
- Platform abstraction wiring (`usePlatform`)
- Shared UI primitives polish: buttons, inputs, selects, cards, badges, dialogs,
  dropdowns, tables, tabs, command, tooltips, loading/empty/error states

**Exit criteria:** every navigation entry renders its (possibly empty) route
frame; layout adapts from wide desktop to small browser widths; global search is
wired to the API (or a clearly typed "not yet implemented" state).

---

## Milestone 3 — DASHBOARD

Answers **"What is happening today?"** Built on the supplied mockup's visual
language, driven by reusable widgets and real query data.

- Greeting + "New Visit" action
- Today's appointment statistics (Appointments / Completed / Pending / Cancelled)
- Today's appointments list
- Calendar preview
- Quick actions
- Recent patients
- Upcoming visits
- Clinic statistics (Total patients, Revenue, Pending treatments, Occupancy rate)

**Exit criteria:** every metric is a query against the API, computed by the API
from the domain; no hard-coded mockup values; widgets are reusable primitives.

**Status: complete.** Every metric is API-computed, and 9 committed e2e specs
assert them against a fixture-backed API — including that a genuinely unknown
figure renders as unknown rather than as `0%`. `pnpm run build` and
`pnpm run test:e2e` are green. "New Visit" now opens the booking dialog (session
21); "New Patient" has been a working link since registration shipped. See
`docs/progress/STATE.md`.

---

## Milestone 4 — PATIENTS

- Patient list (searchable, paginated)
- Global patient search integration
- Patient profile: overview, clinical summary, allergies, medical history,
  upcoming appointment, recent visits, current treatments, financial balance
- Patient history
- Quick actions (new appointment, new visit)

**Exit criteria:** patient search works from anywhere in the app; the profile is
the central clinical context.

**Status: the read side is complete, and registration (create) ships. Patient
_editing_ is the remaining write-side gap.** The searchable paginated list, global
search in the header, and a single-request profile (allergies, next appointment,
recent visits, outstanding treatments, balance) are done and verified in a
browser, as is registration: a `registerPatient` use case, `POST /api/v1/patients`,
and a React Hook Form + Zod form at `/patients/new` reached from both "New
Patient" actions. Record numbers are assigned by the server, sequential per
clinic, atomically — a client cannot choose one. The appointment and visit forms
the dashboard quick actions point at are still not implemented; they are the
natural output of Milestone 5. See `docs/progress/STATE.md`.

---

## Milestone 5 — AGENDA / CALENDAR

- Day, week, month views (FullCalendar behind an adapter — ADR 0011)
- Multiple dentists; dentist filtering; room/chair filtering
- Appointment creation and editing
- Rescheduling (drag/drop + keyboard)
- Duration handling
- Statuses: Scheduled, Confirmed, Arrived, In Treatment, Completed, Cancelled,
  No-show
- Quick appointment panel/modal on click (no navigation away)
- Cancellation and no-show flows

**Exit criteria:** conflicts are detected by the domain/API; the calendar never
owns business rules; the clinic timezone is respected.

**Status: the grid, the server's write side, and every write the agenda offers are
done — including creating one — and the grid can now be narrowed.** `/agenda` draws day, week and month views of
`GET /api/v1/appointments` through FullCalendar behind two adapters (ADR 0011), in the
timezone and opening hours the API reports for the clinic. The grid fetches exactly
the window it is showing and re-fetches on every navigation. Cancelled and no-show
appointments are already drawn (struck through) rather than hidden, so a slot that is
deliberately empty does not look bookable.

The API can book, move and close appointments
(`POST /api/v1/appointments`, `PUT …/schedule`, `POST …/status`), with the rules in
the domain and the guarantee in PostgreSQL — the exclusion constraints decide a race
the domain cannot see, and the tenant foreign keys make a booking's patient belong to
its own clinic (ADR 0018).

The grid now uses them: a drag or a resize becomes a domain intent and a write, a
click opens a quick panel offering only the transitions the domain allows, and every
write is non-optimistic — the grid redraws from the API's answer and a refused gesture
is reverted. Conflicts are reported as the hour that is taken, in the clinic's timezone
rather than the visitor's.

Creating an appointment starts on the grid. **The grid is the time picker**: the click
on an empty slot is the decision of when, and the dialog opens with that time already
in the field — seeded by the click and still the person's to change, because a month
view can only ever name a day and a mistyped lane is corrected in place rather than by
closing the dialog. The other two doors
into the same dialog — the profile's "Book appointment" and the dashboard's "New
Visit" — have no grid behind them, so there the field starts empty and what they fill
is the **clinic's** wall clock converted with the zone on the clinic
record. Who, for how long and in which chair is asked in all three: patient by search
(or already known, from the profile), clinician and chair from
`GET /api/v1/dentists?onlyActive=true` and `GET /api/v1/chairs?onlyActive=true`, with
the API still enforcing the rule behind them (ADR 0020). The dialog decides nothing
about whether the booking is allowed: every slot opens it, and a refusal from the
domain is what is displayed.

The grid can now be narrowed. Chips above the grid choose clinicians and chairs, and
the narrowing is **the server's**: a chip changes the request rather than hiding blocks
already fetched, because a client-side filter renders an identical grid today and is
wrong the first time the API learns a rule the client has not heard of. The bar reads
the _full_ lists — `?onlyActive=false` — while the booking dialog reads the active-only
ones, and the two callers cannot share a cached answer because they are asking different
questions: "what did their day look like" against "who can this be booked against". A
clinician who has left is still filterable, and still marked as such on the chip.

Room _columns_ remain not started. They need a `roomId` in `AgendaEntry`, which the read
model does not have and which ADR 0018 deliberately left out because the write side
declined a room it could not report; adding it reopens that decision rather than
extending this one. The `room_no_overlap` exclusion constraint has no read side for the
same reason — nothing can put an appointment in a room yet.

---

## Milestone 6 — VISITS

- Visit creation from an appointment (and walk-in)
  - **Done (session 23): from an appointment.** `POST /api/v1/visits`, one field in the
    body, one transaction writing two rows, both links `on delete restrict` (ADR 0021).
  - **Done (session 26): walk-in.** `POST /api/v1/visits/walk-in` names a patient, a
    clinician (required) and an optional chair instead of an appointment; it writes one
    row with no `appointment_id`, refuses inactive clinicians/chairs with the same 409
    as a booking, and lets the tenant foreign keys answer a reference this clinic does
    not hold as a 422 rather than a 500 (ADR 0024). Open product question:
    whether the _same_ patient may hold two open visits at once (Q19).
- Visit read side
  - **Done (session 25).** `GET /api/v1/visits/:visitId` and
    `GET /api/v1/patients/:patientId/visits` (ADR 0023). The timeline is uncapped on
    purpose — a silently truncated clinical history is worse than a long one.
  - **Done (session 53): the directory.** `GET /api/v1/visits?page=&limit=` returns a
    page of the caller's visits with an exact total (ADR 0031, amending 0023's rejection
    of a collection). A clinician sees their own; the manager and the front desk see the
    clinic's. `RECEPTIONIST`/`ASSISTANT` scope is an open question. `/visits` renders a
    table with patient, clinician, clinic-time start and status.
  - **Not done:** consolidating the patient profile's inline `visits` query, which is
    recorded in ADR 0023 as open work rather than a rejection.
- Visit workspace: patient/visit header, left section nav, right workspace
  - **Done (session 28).** `/visits/$visitId` — the header (patient name, record
    number, status chip, source, "Back to patient"), the section nav (data-driven
    with one row, `summary`, until an endpoint gives another section something to
    show), the summary and clinical-summary cards in clinic time with the clinician
    and chair resolved from their lists, and **Complete / Reopen** as buttons. The
    buttons are `allowedVisitTransitions(status)` narrowed to what has an endpoint,
    and the mutations are deliberately non-optimistic: the chip changes on the
    refetch, so the screen never disagrees with the row the server holds. Entered
    from the patient profile's "Recent visits" card; a `GET` 404 renders a message
    and a way back rather than an empty shell.
  - **Not done:** the doors into a visit (the agenda's "start visit" and the
    walk-in form) still have no UI — see session 28's note in `STATE.md`. The
    sidebar's `/visits` link now opens the directory (session 53).
- Clinical notes
  - **Done (session 29).** `listClinicalNotes` / `addClinicalNote` over a
    `ClinicalNoteRepository` whose scoping comes through `visits`, because
    `clinical_notes` has no `clinic_id`: both verbs answer 404 for a visit this clinic
    does not hold, and `[]` only for one it does. Two endpoints,
    `GET`/`POST /api/v1/visits/:visitId/notes`, one `save` statement and no
    transaction, plus the workspace's **Notes** section — the nav's first new row —
    which keeps the clinician's draft when the API refuses it.
  - **Not done:** an author (`authorId` is null; there is no user model — ADR 0022's
    question 18) and any edit or delete of a filed note.
- Treatment records per visit
  - **Done (session 30).** `recordVisitTreatment` / `listTreatmentRecords` over two new
    ports (`treatments`, `treatmentRecords`). Scope comes through the visit (a foreign
    visit is a 404) and the treatment through the catalogue (one this clinic does not
    hold is a 422); `performedAt` is the clinic's clock, `treatmentPlanItemId` is
    deliberately absent (a Milestone 8 concern) and recording on a closed visit is
    allowed, like a note. The catalogue's read side shipped early: `GET /api/v1/
treatments` names it so the workspace's third row can resolve a record's name
    client-side. Charges shipped next, in session 32.
- Prescriptions per visit
  - **Done (session 31).** `addVisitPrescription` / `listVisitPrescriptions` over a
    `PrescriptionRepository`. Scope comes through the visit (both verbs read it first;
    a foreign visit is a 404, both engines translating the FK violation back to
    `NOT_FOUND`); `dentistId` is nullable and inherited from the visit, never accepted
    from the body, and `issuedAt` is the clinic's clock. One `save` statement, no
    transaction. Validation lives in the endpoint schema (trim first, `min(1).max(200)`
    on the course fields, whole days 1–365) and is mirrored by the domain's inline
    course validation, so both sides refuse the same shapes. The workspace's
    **Prescriptions** section — the nav's fourth row — lists what was written (route
    labelled through one presentation file) and writes a course with a route picker,
    keeping the clinician's draft on a refusal.
  - **Not done:** editing or deleting a prescription. Every member of `Repositories`
    has both engines (the session 23 policy); session 32 then grew the set to eleven
    with `charges`.
- Charges per visit
  - **Done (session 32).** `listVisitCharges` / `addVisitCharge` over an eleventh
    port, `ChargeRepository` — the first visit book that owns a `clinic_id`, so its
    scoping reads the charge's own column rather than joining `visits` (both verbs
    still read the visit first; a foreign visit is a 404 before any row moves). Two
    endpoints, `GET`/`POST /api/v1/visits/:visitId/charges`, one `INSERT` and no
    transaction, `createdAt` from the clinic's clock, `taxRatePercent` landed as `0`
    (no tax field in the product yet — see `docs/open-questions.md`). The workspace's
    **Charges** section — the nav's fifth row — draws line totals through the domain's
    own `calculateChargeTotal`, parses major-unit boxes to integer minor units in one
    place, and keeps the front desk's draft when the API refuses a charge. The seed's
    third charge sits on Luis's open visit.
  - **Not done:** editing or deleting a charge, and any notion of an invoice — that is
    Milestone 9. `Repositories` is eleven now, every member with both engines (the
    session 23 policy, four sessions running).
- Files/attachments (platform capability)
  - **Done (session 33): the record.** `listVisitAttachments` / `addVisitAttachment`
    over a fifteenth port, `VisitAttachmentRepository`. Like `clinical_notes`,
    `visit_attachments` has no `clinic_id` — tenancy comes through `visits` (both verbs
    read the visit first; a foreign visit is a 404) and the FK is `ON DELETE CASCADE`.
    `GET`/`POST /api/v1/visits/:visitId/attachments` store a _reference only_ — the
    name (trimmed, 1–255), the type (normalized, blank → null), the integer size
    (guarded by the schema, the use case and a column CHECK), and the clinic's clock.
    The workspace's **Files** section — the nav's seventh row — lists a file's name,
    type and size in clinic time and writes a new one, keeping the front desk's draft
    on a refusal.
  - **Not done:** the bytes. Uploading the actual file (multipart, a Tauri local path,
    a store) is a transport this slice deliberately defers; the reference, its register
    and its tenancy are the part Milestone 6 has to prove, and the table is the shelf
    the transport will hang on. Editing or deleting an attachment is also still absent.
- Payments recorded against the visit's charges
  - **Done (session 32).** `payVisitCharges` settles a visit's charges with a
    payment: `POST /api/v1/visits/:visitId/payments` records the money and folds
    **every un-invoiced charge into one invoice** in the same transaction
    (partial payments are allowed; overpayment is refused). `listVisitPayments`
    answers via `GET /api/v1/visits/:visitId/payments`, and the workspace's
    **Payments** section — the nav's sixth row — draws billed/paid/outstanding
    beside a register in the clinic's clock and offers a record form only while a
    settlement would accept one (the door closes once the bill is invoiced).
    Three new repositories (`invoice`, `payment`, `paymentAllocation`) took
    `Repositories` from eleven to fourteen, every member with both engines.
    A follow-up payment after a settlement is refused until Milestone 9's
    invoice-ledger — the boundary is told to the desk with words
    (open question 20) rather than answered as a 422.
  - **Not done:** editing or deleting a payment; allocation across a bill that
    spans invoices; partial invoice settlement; invoice numbering and statements.
    That is Milestone 9, where the receipt becomes a balance.
- Visit completion / reopening
  - **Done (session 24), minus the audit.** `POST /api/v1/visits/:visitId/complete` and
    `.../reopen`, both bodyless, both scoped to the request's clinic. The end time is the
    clock the domain was given, and reopening clears it (ADR 0022). The linked
    appointment is deliberately left alone — see the ADR for why coupling it would cost a
    `COMPLETED → IN_TREATMENT` edge and a button on every completed appointment.
  - **Not done: the audit trail.** There is no authenticated user to attribute a reopening
    to, so nothing records _that_ it happened beyond `updated_at`. Question 18.

**Exit criteria: met (session 28).** Completing and reopening now happen _from_ the
visit context — `/visits/$visitId` owns both endpoints' buttons, so the action lives
where the record lives. What is still missing around them is the audit (question 18)
and the doors that _start_ a visit, neither of which this criterion asked for.

---

## Milestone 7 — ODONTOGRAM

- Interactive odontogram component (dedicated, clinical-grade)
- FDI notation, permanent/primary/mixed dentition
- Surfaces, conditions, notes, history per tooth
- Treatment recommendation from an odontogram finding

**Delivered (session 34):** `GET`/`POST /api/v1/patients/:patientId/odontogram(.entries)`
backed by the domain's own validity rules (FDI regex, dentition derived from the
tooth number, sites must name a surface, surfaces must apply to the tooth), with
the profile's **Odontogram** card drawing the FDI arches and exporting its rows in
the clinic's clock. Charting is a per-tooth **upsert**: one current state per tooth,
re-charting edits rather than duplicates. Tenancy comes through the patient (a
foreign or missing patient is a 404 on both verbs). History per tooth (the read is
current-state-only by design) and the **treatment recommendation** bullet remain:
the recommendation needs the treatment plan's write and its link to planned items,
which are Milestone 8.

**Dedicated page (session 54):** the sidebar's `/odontogram` link now opens a
patient-gated page. The shared `PatientPicker` chooses the record, then the same
`PatientOdontogramSection` the profile draws (same `OdontogramChart`, same upsert form,
same rows) charts and reads it — a second chart would be a second answer to "what does
this tooth look like". The selection is component state, not a search param, because the
installed router cannot type the latter (T2); switching patients remounts the section so
a selected tooth and draft do not cross records. No new endpoint and no schema change.

**Exit criteria:** the odontogram is a reusable component backed by domain
validity rules, not a drawing hack.

---

## Milestone 8 — TREATMENTS

- Treatment catalogue (codes, categories, durations, prices)
  - **Read side delivered early (session 30):** `GET /api/v1/treatments` names the
    catalogue and drives the workspace's Treatments section. Categories remain
    unmodelled — the `treatments` table has no category column, and
    `TreatmentCatalogueItem` reflects that honestly (nullable `code`,
    `description`, `duration`). Prices and the write side land with this milestone.
  - **Write side + catalogue page (session 36):** `POST /api/v1/treatments`,
    validated at the boundary by `createTreatmentSchema`, and the sidebar's
    dangling Treatments link now draws a page: an add form whose price is the one
    place a human types money (parsed to integer cents before the request is
    made), and the catalogue drawn with prices as the clinic's money. Nothing is
    listed from the form's own values — the new row is the refetch's to produce.
- Treatment plans with ordered items
  - **Read side (session 36):** `GET /api/v1/patients/:patientId/treatment-plans`
    on both engines, the progress computed by `describeTreatmentPlanProgress`
    (over the stored table's `isCompleted`, which is all a row can say) and drawn
    on the patient's profile as its own section.
  - **Write side (session 37):** `POST /api/v1/patients/:patientId/treatment-plans`
    proposes a plan (opened `DRAFT`, items written whole),
    `PATCH /api/v1/patients/:patientId/treatment-plans/:planId` moves its status
    through the domain enum's values, and
    `POST …/:planId/items/:itemId/complete` marks one line done (bodyless,
    idempotent). The plan save is one transaction; the profile section proposes a
    plan and marks a line done, both non-optimistically. A plan's own ordered-edit UI
    remains; billing a planned line is delivered under the link bullet below.
- Progress tracking (pending treatments) — progress is projected from the stored
  rows (never stored) and redrawn after each item is completed.
- Link plan items → visits → charges — the item carries a nullable
  `treatment_plan_item_id` link from both the execution and the charge side, each a
  provenance-only record that never completes the line.
  - **Plan item → visit (session 38):** `recordVisitTreatment` accepts an optional
    `treatmentPlanItemId`, resolved on the patient's own plan and required to name the
    same treatment (else 422); the record carries the link as **provenance only** — it
    never completes the plan item — and both engines write the column. The visit
    workspace offers the open items for the chosen treatment.
  - **Plan item → charge (session 39):** `POST /api/v1/visits/:visitId/charges` accepts
    an optional `treatmentPlanItemId`, resolved on the visit's patient's own plan (else 422) and folding that item's catalogue treatment into the charge's `treatmentId`;
    the `charges` table gained the same nullable `on delete set null` column in both
    engines. The link is **provenance only** — billing a planned line does not complete
    it — and the charges section offers the patient's open lines beside the price. The
    roadmap's M8 bullet is now closed.

---

## Milestone 9 — PAYMENTS / BILLING

**Complete (session 45).** Every bullet is closed: charges → invoices (session 40),
numbering and status (session 40, refined session 44), payments/methods/allocation
(sessions 31–32, invoice-scoped follow-up in session 44), patient balances (session 43) and statements (session 45), and the visit workspace's invoice controls (session
44). See `docs/progress/LOG.md`.

**Session 59** closed the sidebar's dangling **Payments** link with `/payments`: a
read-only clinic-wide ledger over the stored payments, filtered by clinic-local period
and method, paged, with a server-side total. Recording stays on the visit settlement flow
(ADR 0033); a clinic-wide "record payment" door is open question 22, not an omission.

- Charges → invoices
- Invoice numbering and status
- Payments, methods, allocation
- Patient balances, statements
- Integration with the visit workspace

---

## Milestone 10 — INVENTORY ✅ (session 46)

- Items, units, stock levels, minimums
- Stock movements on usage
- Low-stock visibility

Complete: append-only movement ledger with a cached level (ADR 0026), opening stock as
an adjustment, usage that refuses to overdraw, `/inventory` with low-stock visibility,
and both engines behind one port. See `docs/progress/LOG.md`.

---

## Milestone 11 — REPORTS

- Appointments, production, collections, occupancy, dentist performance
- Date/clinic/dentist filters; export

**Status: complete.** `GET /api/v1/reports/summary` assembles a clinic-local period
from the rows the clinic already keeps — appointments, net charge value, payments,
open invoice balance and recorded opening hours — through a `ReportsReadStore`
implemented once per engine. `/reports` draws the figures, the clinician table and a
CSV export (`PlatformCapabilities.saveFile`, a download in both shells). ADR 0027
records the definitions and the attribution rule: payments carry no clinician, so
collections are clinic-wide, and work with no visit is shown as "Unassigned". See
`docs/progress/STATE.md`.

---

## Milestone 12 — PRODUCTION HARDENING

- Authentication implementation (sessions, roles, permissions, clinic
  membership) — **done, session 48** (ADR 0028): scrypt password hashing,
  opaque bearer sessions (SHA-256 at rest, 12h default), fail-closed request
  auth, a domain role/permission matrix enforced on every route, and a login
  screen with a session gate in `packages/app`. Per-clinician clinic membership
  is one clinic by construction (a session's clinic must equal the configured
  clinic); multi-clinic membership is a future milestone. A development-only
  sign-in chooser (`/auth/dev-users`, `/auth/dev-login`) makes role testing fast
  and is absent when `NODE_ENV=production` (ADR 0030, session 50).
- Login rate limiting — **done, session 49** (ADR 0029): failed attempts counted
  per email and client address in process (5 per 15 minutes by default),
  `429 RATE_LIMITED` with `Retry-After`, cleared by a successful login. Per
  instance only; a multi-instance deployment needs shared storage or a proxy.
- Error monitoring, structured log shipping
- Performance: query tuning, agenda query optimisation
- Backup/restore procedures for PostgreSQL
- Security review of the API boundary (note: the bearer token is held in
  `localStorage` — recorded as a follow-up)
- Compliance-relevant data-handling decisions (only if actually implemented and
  verified — no claims without evidence)

---

## Possible future milestones (not committed)

- **Offline mode**: local SQLite + sync engine behind the existing repository
  ports. Requires its own ADRs (conflict resolution for appointments and
  payments).
- **Multi-clinic**: Clinic already modelled; adds enforcement, permissions and
  scoping.
- **Mobile**: a third deployment shell over `packages/app`.
- **Patient portal**, **insurance**, **lab integrations**.

## Working cadence

Each milestone follows: inspect → design → document (ADR if needed) → implement
the smallest complete slice → verify (typecheck/lint/test/build) → report →
update `docs/progress/STATE.md`.
