# ADR 0011 — FullCalendar is a view adapter, never the domain model

- **Status:** Accepted
- **Date:** 2026-09-30
- **Deciders:** Principal Architect
- **Affects:** `features/agenda`, `packages/domain/appointment`, `packages/api-client`

## Context

The agenda is one of the most important screens in the product and must support
day, week and month views, multiple dentists, room/chair filtering, creation,
editing, rescheduling, statuses, cancellation and no-show. FullCalendar is the
obvious UI library for this and is in the mandated stack.

FullCalendar is, however, a large third-party object model: `EventObject`,
`EventInput`, `DateEnv`, `EventSource`, its own view types, its own drag/resize
semantics, its own locale/timezone handling. The risk is that the application
ends up _being_ FullCalendar: repository queries return `EventInput[]`, the
agenda's data shape leaks into other features, and business decisions (what
"Completed" means, how duration is validated, whether an appointment may
overlap) are made with FullCalendar helper functions. That would put a UI
library inside the domain and make the domain untestable without a DOM.

## Decision

**The domain owns the appointment. FullCalendar only displays it.**

Mandatory flow:

```
packages/domain/appointment        Domain Appointment (status, startsAt,
                                   durationMinutes, patientId, dentistId, chairId)
        ↓  application query / use case
packages/api-client                AgendaRange fetch (REST, ISO dates)
        ↓  TanStack Query
packages/app/features/agenda/
   ├── queries/agenda-range-query.ts
   ├── adapters/to-calendar-event.ts      ← the ONLY place EventInput is created
   └── adapters/from-calendar-event.ts    ← the ONLY place a drop/resize is read
                                              back into domain input
```

Rules:

- No `EventObject`/`EventInput` type crosses a module boundary outside the two
  adapter files. Queries return domain-shaped appointments.
- Date/time handling in the domain is UTC `Date`/`ISO string`; the calendar
  adapter is the only place that converts to FullCalendar's local-time shape and
  applies the clinic's IANA timezone.
- Business rules (legal status transitions, duration validity, conflict
  detection, operating hours) come from `packages/domain` and the API — never
  from FullCalendar helpers. Calendar plugins may _offer_ a UI affordance, but
  the API is the authority.
- Drag/resize produces a domain intent (`rescheduleAppointment`), which is sent
  to the API; the query is invalidated and the calendar re-renders from the
  server's answer. The calendar never mutates its own state as the source of
  truth.
- If FullCalendar were ever to be replaced (or a bespoke grid built), only the
  two adapter files and the calendar component change; queries, domain and API
  are untouched.

## Rationale

- **Keeps the domain framework-independent** (architecture rule: domain must not
  depend on UI libraries).
- **Keeps the agenda replaceable** — FullCalendar is the single heaviest UI
  dependency in the app and also the most likely to be replaced or upgraded
  incompatibly.
- **One authority for business rules.** Server-side validation plus pure domain
  predicates give the same answers in the agenda, the quick panel and the
  patient profile.
- **Correct data flow.** Server-confirmed reschedules mean the agenda cannot
  drift into a state the database never accepted.

## Consequences

Positive:

- Domain and agenda logic are unit-testable without a DOM or a calendar library.
- Server remains the single source of truth for schedule conflicts.
- Swapping or upgrading the calendar is a contained change.

Negative / accepted costs:

- Two adapter files of mapping code must be maintained.
- Some FullCalendar niceties (optimistic drag feedback) must be reimplemented or
  skipped, because we do not mutate client state optimistically for clinical
  data (see ADR 0007).
- FullCalendar's own timezone handling must be deliberately overridden to match
  the clinic timezone — a known source of bugs that the adapter now owns
  explicitly.

## Alternatives rejected

- **Store FullCalendar `EventObject`s as the app's appointment model:** makes the
  domain dependent on the UI library and blocks any second view. Rejected.
- **Custom agenda grid instead of FullCalendar:** more control, but re-inventing
  drag/resize, view switching and accessibility; not worth it now. Could be
  revisited later behind the same adapter boundary.
- **Store appointments as UTC-only and let the browser convert:** ignores the
  clinic's timezone; incorrect for clinics whose operating hours are defined in
  clinic-local time.

## Verification

- ESLint/guard: `EventInput`/`EventObject` may only be imported in
  `features/agenda/adapters/*` and the calendar component.
- Unit tests cover `toCalendarEvent` / `fromCalendarEvent` mapping without
  rendering a calendar.
