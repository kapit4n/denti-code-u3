# ADR 0004 — A framework-independent domain layer

- **Status:** Accepted
- **Date:** 2026-09-30
- **Deciders:** Principal Architect
- **Affects:** `packages/domain`, `apps/api`, `packages/app`, ESLint, guard script

## Context

Dental clinic software accumulates business rules quickly: appointment status
transitions, chair-conflict detection, visit↔appointment bridging, invoice
maths, odontogram validity, treatment-plan progress. The temptation is to write
those rules wherever they are first needed — inside a React component, inside a
route handler, inside a SQL `WHERE` clause. That produces three things: rules
that cannot be tested without a browser or a database, rules that differ between
the web and desktop paths, and rules the API cannot reuse.

## Decision

Introduce an explicit **domain layer** (`packages/domain`) that is plain
TypeScript with **no framework dependencies**, and enforce the separation
mechanically.

**Allowed imports inside `packages/domain`:** `packages/domain` itself,
`packages/types` (pure shared types/enums), and Node/Web standards only. Nothing
else.

Explicitly forbidden in the domain:

- `react`, `react-dom`, any JSX
- browser APIs (`window`, `document`, `localStorage`)
- Tauri (`@tauri-apps/*`)
- PostgreSQL / `drizzle-orm` / `postgres` / SQL
- TanStack Query, Zustand, any UI or framework library
- `apps/api`, `apps/*`, any feature folder

**Rules the domain owns** (pure, synchronous, no I/O):

- appointment/visit status state machines
- appointment end-time computation and chair/dentist overlap detection
- invoice totals, patient balance, money-as-integer arithmetic
- odontogram tooth/dentition/condition validity (FDI notation)
- treatment-plan progress projection
- role → permission mapping
- clinic-day boundaries in the clinic's timezone

**Rules the domain does not own:** anything requiring I/O. To read rows, the
application layer calls a _port_ (`AppointmentRepository`) that the domain
declares and infrastructure implements. This is dependency inversion: the domain
declares `interface AppointmentRepository { findOverlapping(...): Promise<Appointment[]> }`
and never learns that Drizzle exists.

Ports that exist only because tests need determinism are kept deliberately
small: `Clock` (injected "now") and `IdGenerator`. They are not speculative —
they are what makes time-dependent rules unit-testable without mocking globals.

**No `Result` wrapper ceremony.** Functions return domain errors as thrown
typed errors (`DomainError` subclasses) or boolean predicates
(`canTransitionAppointment`), whichever is simpler to read. No generic
`Result<T, E>` type gymnastics.

## Rationale

- **Testability.** Domain rules are pure functions; tests run in milliseconds
  with no database, no HTTP, no DOM. This is the highest-value property of the
  whole architecture.
- **Portability.** The domain compiles and runs in a Node process, a browser
  bundle, or a future serverless worker without modification — which is exactly
  what makes future offline/local implementations possible.
- **Consistency across targets.** Web and desktop share the same bundle, so they
  necessarily share the same rules; the API shares the same rules with them.
- **Replaceable infrastructure.** Because the domain depends on interfaces, the
  ORM or the transport can be replaced without touching a single rule.

## Consequences

Positive:

- Rules are unit-tested in isolation; high confidence in scheduling and billing
  logic at near-zero cost.
- Boundary violations are caught by tooling (`pnpm run guard:boundaries`) and by
  ESLint `no-restricted-imports` rules, not by code review alone.
- The domain package is the most stable part of the system; UI and API churn
  around it.

Negative / accepted costs:

- **More indirection.** A read path is
  `component → query → use case → api-client → route → controller → use case →
repository`. This is deliberate; the mitigation is that each hop is one small
  named function.
- **Models must be mapped, not passed through.** API DTOs, database rows and
  domain objects are distinct types with explicit mappers. More code, but it
  prevents infrastructure types from leaking inward.
- **Discipline required.** The guard script must be part of CI, otherwise the
  boundary decays. `pnpm run guard:boundaries` is wired into `lint`.

## Alternatives rejected

- **Domain logic in route handlers / components:** fastest to write, impossible
  to unit test in isolation, duplicates rules across layers. Rejected.
- **Validation-only "domain"** (just Zod schemas): Zod belongs at the
  _boundary_; business rules such as status transitions and invoice maths are
  not schema concerns. Keeping both is the correct split
  (`packages/validation` vs `packages/domain`).
- **Full DDD / aggregates / domain events / repository-per-aggregate:**
  heavyweight ceremony with no payoff at this size. The domain is rich in
  _vocabulary_ and _rules_, not in event-sourced complexity. Rejected.

## Verification

- `pnpm run guard:boundaries` (scripts/check-boundaries.mjs) parses the import
  graph of `packages/domain`, `packages/ui`, `apps/web`, `apps/desktop` and
  fails on violations, cycles, or unexpected framework imports.
- ESLint flat config applies `no-restricted-imports` to `packages/domain`.
- `pnpm --filter @denti-code-u3/domain test` runs the domain unit tests with
  no infrastructure in scope.
