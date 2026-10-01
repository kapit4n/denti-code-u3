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

---

## Milestone 6 — VISITS

- Visit creation from an appointment (and walk-in)
- Visit workspace: patient/visit header, left section nav, right workspace
- Clinical notes
- Treatment records per visit
- Prescriptions per visit
- Charges per visit
- Files/attachments (platform capability)
- Payments recorded against the visit's charges
- Visit completion / reopening (audited)

**Exit criteria:** a clinician can complete a visit without leaving the visit
context.

---

## Milestone 7 — ODONTOGRAM

- Interactive odontogram component (dedicated, clinical-grade)
- FDI notation, permanent/primary/mixed dentition
- Surfaces, conditions, notes, history per tooth
- Treatment recommendation from an odontogram finding

**Exit criteria:** the odontogram is a reusable component backed by domain
validity rules, not a drawing hack.

---

## Milestone 8 — TREATMENTS

- Treatment catalogue (codes, categories, durations, prices)
- Treatment plans with ordered items
- Progress tracking (pending treatments)
- Link plan items → visits → charges

---

## Milestone 9 — PAYMENTS / BILLING

- Charges → invoices
- Invoice numbering and status
- Payments, methods, allocation
- Patient balances, statements
- Integration with the visit workspace

---

## Milestone 10 — INVENTORY

- Items, units, stock levels, minimums
- Stock movements on usage
- Low-stock visibility

---

## Milestone 11 — REPORTS

- Appointments, production, collections, occupancy, dentist performance
- Date/clinic/dentist filters; export

---

## Milestone 12 — PRODUCTION HARDENING

- Authentication implementation (sessions, roles, permissions, clinic
  membership)
- Error monitoring, structured log shipping
- Performance: query tuning, agenda query optimisation
- Backup/restore procedures for PostgreSQL
- Security review of the API boundary
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
