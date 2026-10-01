# BRIEF — Denti-Code U3 (condensed, authoritative)

> Condensed copy of the original 41-section architecture prompt. If this file
> and the chat ever disagree, the chat (the latest instruction) wins; otherwise
> this file is the contract. Do not edit the intent here — edit the code and docs
> to match this brief.

## Product

DENTI-CODE U3 = modern dental clinic management system for **Web** and
**Desktop**. **New product — not a migration.** First responsibility: clean,
scalable architecture and repository foundation. Do NOT immediately build the
whole product and do NOT generate large amounts of business-feature code.

Eventual modules: Dashboard, Agenda/Calendar, Patients, Visits, Clinical records,
Odontogram, Treatments, Treatment plans, Prescriptions, Payments, Billing,
Inventory, Reports, Settings, multiple dentists, staff, rooms, chairs,
appointments, patient history.

Initial priority order: **1. Application Shell → 2. Dashboard → 3. Patients → 4. Agenda/Calendar → 5. Visits.**

A Denti-Code U3 dashboard mockup is the primary _visual/UX_ reference. Use its
visual language; do **not** blindly reproduce it, and do **not** hard-code
mockup values into the architecture. Build a reusable design system.

Desired feeling: modern, professional, clean, clinical, premium, calm, fast,
information-dense without being cluttered.

## Core principle

**ONE REACT APPLICATION · ONE DOMAIN · TWO DEPLOYMENT TARGETS · ONE DATABASE
STRATEGY (for now)**

```
WEB (browser) ┐
              ├─> React App -> Application Layer -> Domain Layer -> API Client -> REST API -> PostgreSQL -> Drizzle
DESKTOP (Tauri2)┘
```

Web and desktop share the React application architecture and the same backend.
**No SQLite, no offline sync, no local desktop database, no two persistence
systems now.** Leave room for future offline, but do not implement it.

## Stack (change only with a documented strong reason)

- Frontend: React 19, TypeScript, Vite, Tailwind CSS, shadcn/ui, TanStack Router,
  TanStack Query, Zustand, React Hook Form, Zod, TanStack Table, FullCalendar,
  Recharts, Lucide React.
- Desktop: Tauri 2.
- Backend: Node.js, TypeScript, REST API (lightweight, TypeScript-first; exact
  framework chosen during architecture setup).
- DB: PostgreSQL only. ORM: Drizzle ORM. pnpm + Turborepo.
- Tests: Vitest, React Testing Library, Playwright, Tauri-compatible E2E strategy.
- Quality: TypeScript strict, ESLint, Prettier.
- Forbidden without a documented architectural reason: Redux, GraphQL,
  microservices, another frontend framework, another ORM.

## Layers & dependency direction

Presentation → Application → Domain; Infrastructure implements the interfaces
required by application/domain.

**Domain MUST NOT depend on:** React, browser APIs, Tauri, PostgreSQL, Drizzle,
TanStack Query, Zustand, UI components. Keep it portable.

Flow through an API request:
`HTTP route -> controller -> application use case -> domain -> repository
interface -> repository implementation -> Drizzle -> PostgreSQL`.
No business logic inside route handlers.

## Domain model (initial vocabulary)

Clinic, User, Dentist, Staff, Patient, Appointment, Visit, Treatment,
TreatmentPlan, Odontogram, Prescription, ClinicalNote, Payment, Invoice, Room,
Chair, InventoryItem.

Conceptual tree:

```
Clinic
 ├─ Dentists, Staff, Patients, Rooms, Chairs
 └─ Appointments ─ patient, dentist, room/chair, treatment, status
      └─ Visit ─ clinical notes, odontogram, treatments, prescriptions, charges, payments
```

**Appointment statuses are domain data:** Scheduled, Confirmed, Arrived,
In Treatment, Completed, Cancelled, No-show. Do not make colors the source of
truth; UI colors are derived from semantic status.

**Visit workflow:** Patient -> Appointment -> Visit -> Clinical Record ->
Treatment -> Payment. Define boundaries and interfaces now; do not implement the
workflow during the architecture phase.

## Frontend architecture

Feature-oriented: `features/{dashboard,agenda,patients,visits,odontogram,
treatments,payments,inventory,reports,settings}`. Each may hold components,
hooks, queries, mutations, schemas, types, routes, tests. No giant global
components directory. Shared visual primitives → `packages/ui`; business rules →
`packages/domain`; API communication → `packages/api-client`.

**Agenda:** day/week/month views, multi-dentist, dentist/room/chair filtering,
create/edit/reschedule, duration, patient/dentist/treatment/status, cancel and
no-show, quick appointment panel. FullCalendar is a **view adapter only** — it
must not become the domain model:

```
Domain Appointment -> Application Query -> API -> TanStack Query -> Calendar Adapter -> FullCalendar
```

Clicking an appointment opens a quick panel/modal instead of navigating away.

**Patients:** global search from anywhere (name, phone, identification, other
identifiers). Patient profile = central clinical workspace (overview, visits,
odontogram, treatments, payments, clinical summary, allergies, medical history,
current treatments, upcoming appointment, recent visits, financial balance).

**Visit workspace:** patient/visit header, left section nav (summary, notes,
odontogram, treatment, files, payments), right workspace (clinical notes,
treatment plan). Dentist stays inside the visit context.

## Application shell (first UI milestone)

Sidebar, top header, global search, command/search interface, user menu, main
content area, responsive layout, theme support, navigation, platform abstraction.
Primary nav: Dashboard, Agenda, Patients, Clinical (expands to Visits,
Odontogram, Treatments, Prescriptions), Payments, Inventory, Reports, Settings.
Compact and modern.

## Dashboard

Answers **"What is happening today?"** Eventually: greeting, new-visit action,
today's appointment stats, today's appointments, calendar preview, quick actions,
recent patients, upcoming visits, clinic statistics. Mockup concepts
(Appointments, Completed, Pending, Cancelled, Total Patients, Revenue, Pending
Treatments, Occupancy Rate) are product concepts — build reusable widgets driven
by application/query data.

## State management

- TanStack Query = server state (fetching, mutations, caching, invalidation,
  loading state, synchronization) for patients, appointments, visits, …
- Zustand = local client state only (sidebar, UI preferences, selected filters,
  temporary UI, app preferences).
- **No** API data in Zustand, **no** giant global store.

## Validation

Zod at system boundaries: API inputs, forms, DTOs, configuration, request and
relevant response validation. Avoid duplicated rules.

## Routing (TanStack Router)

`/dashboard`, `/agenda`, `/patients`, `/patients/$patientId`, `/visits`,
`/visits/$visitId`, `/clinical/odontogram`, `/treatments`, `/payments`,
`/inventory`, `/reports`, `/settings`. Do not create fully implemented routes
for features that do not exist yet.

## Design system

shadcn/ui foundation. Mockup language: light interface, blue primary actions,
subtle borders, rounded cards, soft shadows, compact typography, semantic badges,
clear hierarchy, generous whitespace, white/light surfaces, subtle blue accents.
Cover typography, colors, spacing, radius, shadows, buttons, inputs, selects,
cards, badges, dialogs, dropdowns, tables, tabs, command/search, navigation,
tooltips, loading/empty/error states. Never hard-code these per component.

## Responsive

Works on desktop monitors, laptops, smaller browser widths. Graceful degradation
to small viewports. Desktop productivity is the priority; no separate mobile app.

## AuthN / AuthZ

Architect the boundaries, do not overbuild. Eventually: User, Session, Role,
Permission, Clinic membership. Initial roles: Administrator, Dentist, Assistant,
Receptionist. No authorization logic inside UI components.

## Database conventions

Sensible conventions for IDs, timestamps, createdAt/updatedAt, soft deletion,
audit fields, clinic/patient/appointment/visit relationships, financial records.
Do not build multi-tenancy yet, but keep Clinic a first-class concept so future
multi-clinic expansion is not blocked.

## API resources

`/patients /appointments /visits /treatments /odontograms /payments /invoices
/dentists /clinics /rooms /chairs /inventory`.

## Desktop strategy

Tauri 2 → React → API client → REST → PostgreSQL. No SQLite, no local DB, no
sync engine, no offline-first, no local persistence. Keep platform-specific
functionality isolated behind a platform abstraction (filesystem, printing,
notifications, app settings, window behavior, desktop-only APIs). React must not
depend directly on Tauri APIs.

## Testing architecture

- Unit: domain rules, value objects, application use cases, validation.
- Component: important UI interactions, reusable components.
- Integration: API, repositories, PostgreSQL.
- E2E: app startup, patient search, appointment create/modify, dashboard
  navigation, visit workflow.
- Do not test every pixel initially.

## Code organization & naming

Never `data`, `stuff`, `helpers`, `misc`, `common2`, `manager`, `service2` when a
domain name exists. Prefer `PatientRepository`, `AppointmentRepository`,
`CreateAppointment`, `SearchPatients`, `GetPatient`, `CreateVisit`.

## Error handling

Structured API errors; frontend loading/empty/error states and retry; friendly
messages; never expose raw database errors.

## Configuration & logging

Centralize config; env vars (API URL, DATABASE URL, environment, app config)
validated with Zod; no scattered `process.env` access. Structured API logging
distinguishing request info, errors, and important application events. Do not log
sensitive patient information unnecessarily.

## Security foundation

Establish boundaries: authn, authz, input validation, SQL-injection protection
through ORM/parameterized queries, secure API design, safe error responses,
sensitive data handling, auditability. Do not claim regulatory compliance that
was not implemented and verified. Do not invent compliance requirements.

## Documentation & roadmap

`docs/{architecture,domain,frontend,backend,database,desktop,testing,roadmap}.md`
and ADRs in `docs/decisions/`. Minimum ADRs: monorepo, Tauri, PostgreSQL-only,
domain/application separation, feature-oriented frontend, REST, TanStack Query,
Zustand limited to local state.

Roadmap milestones:

1. Foundation → 2. Application Shell → 3. Dashboard → 4. Patients →
2. Agenda → 6. Visits → 7. Odontogram → 8. Treatments → 9. Payments/Billing →
3. Inventory → 11. Reports → 12. Production hardening.

## Architecture-phase steps

Inspect repo → document (architecture, domain, roadmap) → ADRs → monorepo →
web bootstrap → desktop bootstrap → API bootstrap → DB/Drizzle/migrations →
shared packages → tooling → verify (web starts, desktop starts, API starts, PG
connection, migrations, package resolution, tsc, lint, format, tests).

## Explicitly NOT to implement in this phase

Complete patient CRUD, complete appointment CRUD, complete dashboard, complete
calendar, complete odontogram, complete billing, complete inventory, complete
reports, complete authentication, offline mode, SQLite, synchronization,
microservices.

## Future offline possibility (do NOT implement now)

`React -> Application -> RepositoryInterface -> ServerRepository (PostgreSQL) /
LocalRepository (future SQLite) -> future sync engine`. Only establish boundaries
that are already useful for the current PostgreSQL architecture. No speculative
interfaces, no sync code.

## Definition of done

Documented architecture/domain/roadmap, ADRs, working monorepo, working web app,
working desktop app, working API, PostgreSQL connection, Drizzle config,
migration foundation, shared packages, TS config, ESLint, Prettier, Vitest, RTL,
Playwright foundation, Turborepo, pnpm workspace, clear dependency and feature
boundaries. A strong technical foundation — not a complete product.

## Working style

Inspect → Understand → Constraints → Design → Document decisions → Implement the
smallest necessary foundation → Verify → Report. Never silently make a major
architectural decision (write an ADR). When ambiguous: make the simplest
reasonable assumption, document it, mark **OPEN QUESTION** if product input may
be needed. Do not invent requirements, do not over-engineer, do not prematurely
optimize. Priorities: maintainability > clear boundaries > DX > testability >
consistent UI architecture > web/desktop reuse > future extensibility.
