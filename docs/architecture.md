# Denti-Code U3 — System Architecture

Status: **accepted for the foundation phase** · Last updated: Phase 1

This document is the map of the system. Domain vocabulary lives in
[`domain.md`](./domain.md); frontend detail in [`frontend.md`](./frontend.md);
API detail in [`backend.md`](./backend.md); persistence in
[`database.md`](./database.md); desktop in [`desktop.md`](./desktop.md);
testing in [`testing.md`](./testing.md). Decisions with long-term consequences
live in [`decisions/`](./decisions/) as ADRs.

---

## 1. Guiding principle

```
ONE REACT APPLICATION · ONE DOMAIN · TWO DEPLOYMENT TARGETS · ONE DATABASE STRATEGY (for now)
```

Two delivery targets (browser, desktop) share one application and one backend:

```
                    DENTI-CODE U3
                          │
             ┌────────────┴────────────┐
             │                         │
           WEB                     DESKTOP
        (Vite, browser)         (Tauri 2 shell)
             │                         │
             └────────────┬────────────┘
                          │
                  packages/app  (THE React application)
                          │
                    Application Layer
              (use cases, queries, orchestration)
                          │
                    Domain Layer
       (packages/domain — pure TypeScript business rules)
                          │
                   API Client
             (packages/api-client, typed REST)
                          │
                       REST API
                (apps/api, Fastify + Node + TS)
                          │
         Repository interfaces ──▶ Repository implementations (Drizzle)
                          │
                     PostgreSQL
```

Consequences of the principle:

- There is exactly **one** place where clinical business rules live
  (`packages/domain`). Web and desktop cannot diverge.
- There is exactly **one** persistence strategy (server-side PostgreSQL). No
  SQLite, no offline, no sync engine (see [ADR 0003](./decisions/0003-postgresql-only-for-now.md)).
- Adding a third target later (mobile) means writing a new shell, not a new app.

## 2. Layers and responsibilities

| Layer              | Lives in                                                                      | May depend on                                                  | Must never                                                                          |
| ------------------ | ----------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **Presentation**   | `packages/app`, `packages/ui`, `apps/web`, `apps/desktop`                     | Application, Domain, `packages/ui`, `api-client`, `validation` | contain business rules or database access                                           |
| **Application**    | use cases + queries co-located with features in `packages/app/src/features/*` | Domain, `api-client`, `validation`, `types`                    | contain SQL, framework or UI concerns                                               |
| **Domain**         | `packages/domain`                                                             | nothing but itself (+ `packages/types` for pure types)         | import React, browser APIs, Tauri, PostgreSQL, Drizzle, TanStack Query, Zustand, UI |
| **Infrastructure** | `apps/api`, `database/*`, Drizzle repositories, REST transport                | Domain ports                                                   | leak infrastructure types into the domain                                           |

Presentation _depends on_ Application; Application _depends on_ Domain;
Infrastructure _implements_ the ports the Application/Domain declare.
Nothing depends outward.

### What "Application layer" means concretely here

There is no separate `packages/application`. Application logic lives **with the
feature that owns it** (`packages/app/src/features/patients/…`), and it is only
React-free at the edges:

```
features/patients/
├── api/            use cases: searchPatients(), getPatientProfile()  ← calls api-client
├── queries/        TanStack Query options + query keys             ← calls api/
├── components/     presentation only
├── routes/         TanStack Router route definitions
└── *.schema.ts     Zod form schemas (boundary validation)
```

The layering rule we actually enforce:

- Business rules → `packages/domain` (pure functions, no I/O).
- Orchestration (which API call, in what order, with what cache keys) → feature
  `api/` + `queries/` folders.
- Rendering and interaction → `components/` + `routes/`.
- Transport and SQL → `apps/api` and `database/`.

## 3. Dependency direction (enforced)

```
apps/web ─┐
apps/desktop ─┼─▶ packages/app ─▶ packages/domain ─▶ packages/types
packages/ui ─┘         │
                        └─▶ packages/api-client ─▶ packages/validation
packages/app ─▶ packages/ui

apps/api ─▶ domain ports ─▶ packages/domain, packages/validation, packages/types
apps/api ─▶ database/*   (Drizzle, only place allowed to import Drizzle)
```

Rules, each machine-checked by `pnpm run guard:boundaries`
(`scripts/check-boundaries.mjs`):

1. `packages/domain` may import only `packages/domain` and `packages/types`.
2. No React/TSX, no `react-dom`, no Tauri, no Drizzle, no `drizzle-orm`,
   no `postgres`, no `@tanstack/react-query`, no `zustand` inside
   `packages/domain`.
3. Only `apps/api` and `database/` may import `drizzle-orm` / `postgres`.
4. Only `apps/desktop/src-tauri` and the platform adapter
   (`packages/app/src/platform`) may reference Tauri APIs.
5. `packages/ui` may not import from `packages/app`, `packages/domain`, or any
   feature — it is the base of the visual dependency chain.
6. `apps/web` and `apps/desktop` are shells: they may not define features,
   routes, or domain logic; they only mount the shared application.
7. No package imports a feature from another feature except through a feature's
   public entry point.
8. No circular workspace dependencies (`pnpm -r list` is checked in the guard).

## 4. Web architecture

```
apps/web
├── index.html            Vite entry document
├── vite.config.ts        dev server + build; port 5173
├── src/main.tsx          mounts <AppRoot/> from @denti-code-u3/app
└── src/vite-env.d.ts
```

- Pure deployment shell: it owns the HTML document, the dev server, and the
  browser URL. No routes, no components, no business code.
- All application code is imported from `packages/app`.

## 5. Desktop architecture

```
apps/desktop
├── index.html            same shell shape as web
├── vite.config.ts        fixed port 5174 + Tauri-friendly HMR settings
├── src/main.tsx          same as web (identical 3 lines)
└── src-tauri/            Rust crate, no SQL, no React, no domain logic
    ├── tauri.conf.json
    ├── Cargo.toml
    └── src/{main.rs,lib.rs}
```

- Tauri loads the same built React application. There is **one** React
  application; the desktop target is a different _host_ for it.
- Platform capabilities (filesystem, printing, notifications, settings,
  window control) are accessed **only** through
  `packages/app/src/platform/` — see [ADR 0009](./decisions/0009-platform-abstraction.md).
- Tauri never talks to PostgreSQL. `dental` rules 3 and 4 forbid it.

## 6. API architecture

```
HTTP route (apps/api/src/http/routes/*)
    ↓  parse+validate with Zod (packages/validation)
Controller (apps/api/src/http/controllers/*)
    ↓  translate HTTP ↔ use case, map errors to status codes
Application use case (apps/api/src/application/*)
    ↓  orchestration + transaction boundary
Domain port (packages/domain/src/ports/*)   ← interface only
    ↓  dependency inversion
Repository implementation (apps/api/src/infrastructure/persistence/*)
    ↓  Drizzle query builder (parameterized)
PostgreSQL
```

- Framework: **Fastify 5** ([ADR 0005](./decisions/0005-rest-and-fastify.md)) —
  TypeScript-first, lightweight, built-in structured logging (pino).
- Route handlers never contain business logic; they only map transport to use
  cases. `pnpm lint` includes a rule set discouraging fat handlers.
- Structured errors: a single `ApiError` shape
  (`{ error: { code, message, details?, requestId } }`) produced by
  `apps/api/src/http/problem.ts` and consumed by the api-client.
- Request ID (or generated UUID) is attached to every log line and to every
  error response, so a user-reported error is traceable.

## 7. Database architecture

- **PostgreSQL only** ([ADR 0003](./decisions/0003-postgresql-only-for-now.md)).
- **Drizzle ORM** is the only data-access technology, used exclusively in
  `apps/api` and `database/`.
- Schema files are split by bounded area under `database/schema/`.
- SQL migrations are generated into `database/migrations/` and applied with a
  small custom runner (`database/migrate.ts`) driven by the Drizzle journal —
  no global mutable state, no framework-specific migration runner.
- `Clinic` is the tenant root on every table from day one (single-clinic data
  for now, multi-clinic support later without a migration of every table).
- Invariants that must hold under concurrency are enforced by the database:
  appointment overlaps are rejected by GiST exclusion constraints over computed
  time ranges ([ADR 0012](./decisions/0012-appointment-end-time-is-computed-never-stored.md)).
  The Drizzle schema is the complete physical picture — no column is maintained
  by a migration alone.
- Details, conventions and the ER overview: [`database.md`](./database.md).

## 8. State management strategy

Two kinds of state, one tool each:

| State                                                               | Tool               | Examples                                                            |
| ------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------- |
| **Server state** (anything that lives in PostgreSQL)                | **TanStack Query** | patients, appointments, visits, dashboard aggregates                |
| **Client state** (ephemeral, per-user, never persisted server-side) | **Zustand**        | sidebar collapsed, active agenda filters, theme, density preference |

Non-negotiables ([ADR 0007](./decisions/0007-server-state-tanstack-query-client-state-zustand.md)):

- No API data in Zustand. Query cache is the single source of truth for server
  data; mutations invalidate by query key, never by manual store writes.
- No single global store. Zustand stores are small, single-concern, and
  colocated with the feature that owns them (`features/agenda/stores/`).
- No business logic in components: components read query data and call use
  cases; they do not compute clinical or scheduling rules.

## 9. Platform abstraction

```
packages/app/src/platform/
├── types.ts          PlatformCapabilities, PlatformStorage, PlatformNotifications…
├── web.ts            browser implementation (localStorage, window, Web Notifications)
├── desktop.ts        Tauri-backed implementation (thin, feature-detected)
└── index.ts          createPlatform() → picks desktop if __TAURI_INTERNALS__ exists
```

React code imports `usePlatform()` / `getPlatform()` and never `@tauri-apps/*`.
This is what makes web and desktop the same application rather than two
codebases with `if (isDesktop)` sprinkled around.

## 10. Error handling at a glance

| Layer                    | Mechanism                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Domain                   | typed `DomainError` subclasses / `Result`-style domain errors, no I/O                                                                            |
| Application (api-client) | `ApiClientError` carrying `code`, `status`, `details`, `requestId`                                                                               |
| API transport            | `problem.ts` maps domain/application errors → HTTP status + problem JSON; unknown errors become a generic 500 with a request id (no SQL leakage) |
| React                    | `QueryErrorResetBoundary` + feature-level `<QueryState>` wrappers render loading / empty / error with retry                                      |

## 11. Configuration

- Every runtime validates its environment once, at startup, with Zod
  (`apps/api/src/config/env.ts`, `packages/config`).
- No `process.env` reads scattered in feature code; config is imported from one
  typed module.
- `.env.example` documents every variable. `.env` is git-ignored.

## 12. Security foundation

- Authentication/authorization **boundaries only** in this phase: an
  `AuthContext` port, a `ClinicMembership` concept in the domain, and role
  enums. Real login is Milestone 12+.
- All input crossing a network or process boundary is parsed with Zod before it
  reaches a use case.
- All SQL goes through Drizzle's parameterized query builder — no string SQL
  interpolation anywhere (guard rule 3 + ESLint rule).
- Errors returned to clients never contain stack traces, SQL, or driver text.
- Clinical data logging is limited to ids and operation names, never clinical
  content (see [`testing.md`](./testing.md) § logging tests).
- Compliance claims: none. Nothing in this repository has been audited or
  certified; see [`security.md`](./security.md).

## 13. Architectural quality rules

The 25 rules in `AGENTS.md` §3 are the contract. Rules 1–8 (dependency
direction), 9–10 (state), 11 (no cycles), 13–17 (forbidden technologies) are
machine-enforced by `pnpm run guard:boundaries` and ESLint.

## 14. Deliberate exclusions (this phase)

No authentication implementation, no offline mode, no SQLite, no sync engine,
no multi-tenant enforcement (Clinic is modelled but not enforced as a
boundary), no GraphQL, no microservices, no Redux. Each is either explicitly
out of scope for Phase 1 or scheduled for a later milestone in
[`roadmap.md`](./roadmap.md).
