# ADR 0007 — TanStack Query for server state, Zustand only for local state

- **Status:** Accepted
- **Date:** 2026-09-30
- **Deciders:** Principal Architect
- **Affects:** `packages/app`, every feature's `queries/` and `stores/`

## Context

The application has two fundamentally different kinds of state:

1. **Server state** — data that lives in PostgreSQL and is owned by the API:
   patients, appointments, visits, invoices, dashboard aggregates. It is shared
   across screens, needs caching, staleness control, background refetching and
   mutation-driven invalidation.
2. **Client state** — ephemeral, per-device, per-user: sidebar collapsed, the
   selected dentist filter in the agenda, the theme, the currently open dialog.

A single client store for both (the "one global store" pattern) is the most
common way a React application becomes unmaintainable: duplicated server data,
manual cache invalidation, race conditions, and components that read from three
places.

## Decision

Assign exactly one tool to each category.

**TanStack Query owns all server state.**

- Every read goes through a query with a namespaced query key, defined in the
  feature's `queries/` folder (`patientKeys`, `appointmentKeys`, …).
- Every write goes through a mutation that awaits the use case and then
  **invalidates by query key**. No manual cache writes; no optimistic updates
  for clinical or financial data (they are validated server-side and a wrong
  optimistic update misleads a clinician about a patient's mouth).
- Loading / error / empty states are driven by the query state, not by local
  booleans.
- Mutations return the server's authoritative representation, and the query
  cache is updated from it (never invented on the client).

**Zustand owns only local client state.**

- One small store per concern, colocated with the feature that owns it
  (`features/agenda/stores/agenda-filters-store.ts`).
- No API data is ever written into a Zustand store.
- No store holds more than one screen's worth of UI state; there is no
  application-wide mega-store.
- Persisted preferences (theme, density, sidebar) go through the platform
  abstraction's storage port, not ad-hoc `localStorage` calls in components.

**Business logic never lives in a component, a query option or a store.**
Components compose; the domain decides.

## Rationale

- **Correct cache semantics by default.** Query keys, staleness, refetch
  windows, retries and invalidation are solved problems; re-implementing them in
  a hand-rolled store is strictly worse.
- **One source of truth.** If a patient's phone number is in both the query
  cache and a Zustand store, they will diverge. Removing that class of bug is
  worth the extra indirection.
- **Server-side validation is respected.** Since we do not optimistically update
  clinical/financial records, the UI never shows a state the server has not
  accepted.
- **Zustand stays what it is good at**: tiny, fast, framework-agnostic local
  state with no ceremony — and impossible to overuse because it cannot hold
  server data by policy.
- **Testability.** Query options are plain objects that can be asserted in
  isolation; stores are pure state machines that are trivial to unit test.

## Consequences

Positive:

- Dashboard widgets, agenda, patient profile and visit workspace all read from
  one cache, so a status change made in the agenda is visible on the dashboard
  without custom wiring.
- Refetch/staleness behaviour is configurable per screen rather than global.
- Testing a component means mocking a query, not a store.

Negative / accepted costs:

- **Indirection.** A value goes component → query hook → use case →
  api-client → HTTP. Accepted; each hop is one named function.
- **Query-key discipline is essential.** A sloppy key factory causes
  over- or under-invalidation. Mitigation: every feature owns a
  `*-keys.ts` factory, and invalidation uses those factories, never string
  literals.
- **No offline cache guarantees.** TanStack Query can persist a cache, but we
  deliberately do not configure it in this phase (ADR 0003): no offline mode.
- Slightly larger bundle than Zustand alone; irrelevant at this app size.

## Alternatives rejected

- **Zustand for everything (including API data):** the pattern the brief
  explicitly forbids; produces duplicated, manually synchronised state.
- **Redux Toolkit:** forbidden by the brief, and redundant with Query for server
  state.
- **Context + `useEffect` fetching:** boilerplate, no caching, race conditions,
  and duplicated logic in every component.
- **Apollo/urql:** GraphQL is forbidden; the REST client in `packages/api-client`
  is sufficient.
- **Zustand + manual fetch in stores:** re-implements TanStack Query badly.
- **Persisting the Query cache for offline now:** premature; conflicts with
  ADR 0003's "one source of truth, no offline".

## Verification

- `pnpm run guard:boundaries` fails if `packages/domain` imports
  `@tanstack/react-query` or `zustand`.
- ESLint rule flags `useQuery`/`useMutation` usage outside a feature's
  `queries/`, `mutations/` or `hooks/` folder (composition only).
- Code review checklist: "does this component write server data into Zustand?"
  → must be no.
