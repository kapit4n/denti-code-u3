# FINAL REPORT — PHASE 1: ARCHITECTURE / FOUNDATION

> End-of-phase report for Milestone 1 of `docs/roadmap.md`.
> Every claim here was verified by running the command shown; see
> `docs/progress/LOG.md` for the raw session log.

---

## 1. Architecture overview

Denti-Code U3 is a single dental domain delivered through two deployment
targets — Web and Desktop — on one React codebase and one API.

```
apps/web      apps/desktop        deployment shells: HTML, Vite entry, env
     \           /
      packages/app                routes, providers, shell wiring
        /      |     \
   ui     api-client  domain      presentation + transport + pure logic
              \         /
             validation  types     every boundary is validated here
                            \
                         apps/api                     Fastify, owns all SQL
                            |
                         database                    Drizzle + PostgreSQL 17
```

The dependency direction is inward only. Presentation knows the application; the
application knows the domain; the domain knows nothing. Infrastructure (the API
and the database) sits outside that chain and is replaceable.

The one rule that makes this hold in practice is that `packages/domain` is plain
TypeScript. No React, no Drizzle, no `process`, no HTTP. If it ever needs one of
those, that is a signal the logic is in the wrong place, not that the domain
needs an exception.

## 2. Repository structure

```
AGENTS.md                      durable working agreement (read first)
apps/
  api/                         Fastify REST API — the only place SQL exists
  web/                         browser shell
  desktop/                     Tauri 2 shell
packages/
  app/                         THE React application
  ui/                          design system primitives
  domain/                      pure dental domain
  api-client/                  typed REST client
  types/                       shared enums and structural types
  validation/                  Zod schemas for every boundary
  config/                      shared tooling entry points
  tsconfig/                    TypeScript presets
database/
  schema/                      Drizzle schema, one file per bounded area
  migrations/                  generated SQL + journal
  seeds/                       development seed data
e2e/                           Playwright specs
docs/                          architecture, domain, ADRs, roadmap, progress
scripts/check-boundaries.mjs   automated architecture guard
```

`database/` is intentionally _not_ a workspace package: it is Drizzle tooling and
SQL generation, imported only by `apps/api` and by the DB scripts. Making it a
published package would let application code import it, which is exactly what the
boundary rules forbid.

## 3. Package dependency graph

```
types      → tsconfig
domain     → types
validation → types
api-client → types, validation
ui         → tsconfig
app        → api-client, domain, types, ui, validation
web        → app, ui
desktop    → app, ui
api        → api-client, database, domain, types, validation
config     → tsconfig
```

Two properties are worth calling out:

- `ui` depends on nothing but TypeScript. A design system that can reach into
  the domain or the API is already not a design system.
- `app` may use `domain` and `api-client`, and `apps/*` may use `app`. Nothing
  points back. There is no cycle in this graph, and `pnpm run lint` fails if a
  future edit creates one.

## 4. Domain boundaries

Bounded areas modelled in `packages/domain`:

| Area         | Owns                                                                    |
| ------------ | ----------------------------------------------------------------------- |
| patient      | identity, contact data, allergies, medical history, consent, next visit |
| scheduling   | appointments, duration rules, overlap detection, availability           |
| visit        | visits, odontogram entries, clinical notes, prescriptions               |
| treatment    | catalog, treatment plans, plan items, clinical execution                |
| billing      | invoices, charges, payments, allocations                                |
| inventory    | items, stock movements, minimum stock thresholds                        |
| organization | clinics, rooms, chairs, dentists, users, roles, operating hours         |

Rules that exist because the _domain_ decided them, not because a database
column exists:

- Appointment end time is derived from start + duration. It is never stored —
  not in the domain, and not in the database. A PostgreSQL function computes it
  inside the overlap constraints (ADR 0012).
- An appointment may not overlap another for the same dentist, chair or room.
- A schedule conflict is a domain-level error, not an HTTP 409 by coincidence.
  `apps/api` maps it to 409 in one place.
- Money is stored as integer minor units (cents). No floats, anywhere.
- Payment must be fully allocated or the invoice stays partially paid.

The scheduling rules are exercised against a real PostgreSQL instance, because
overlap enforcement uses a GiST exclusion constraint and a trigger — behaviour a
mocked repository cannot prove.

## 5. Web/Desktop strategy

One React application (`packages/app`), two shells:

- `apps/web` — Vite + `index.html` + `main.tsx`, loads `/api/v1` from
  `VITE_API_URL`.
- `apps/desktop` — same Vite build, wrapped by Tauri 2, same API URL.

Both shells are deliberately near-empty: an HTML document, an entry point that
calls `mountApp()`, and a Vite config. All routes and providers live in
`packages/app`, so a feature cannot be implemented on one target only — there is
nowhere to put it.

Platform-specific capabilities go through a narrow interface instead of
`isDesktop` branching scattered through features:

```ts
interface PlatformCapabilities {
  readonly name: 'web' | 'desktop';
  readonly locale: string;
  readonly timeZone: string;
  openExternal(url: string): Promise<void>;
  saveFile(name: string, contents: string): Promise<string | null>;
}
```

The browser implementation is the default. The Tauri implementation does not
exist yet — it belongs to the milestone that needs a real native call. The point
is that the seam is now visible and typed, so adding it will not touch features.

## 6. API architecture

- **Transport:** REST over HTTP, JSON, `/api/v1` prefix.
- **Framework:** Fastify 5.
- **Config:** every environment variable is validated by Zod at startup
  (`apps/api/src/config/env.ts`). The process refuses to boot on a missing or
  malformed value instead of failing later at the first request. Defaults are
  development-only and loudly wrong in production (`SECRET` placeholders).
- **Errors:** one envelope for everything — `ValidationError` (400),
  `NotFoundError` (404), `SchedulingConflictError` (409),
  `AuthenticationError` (401), `AuthorizationError` (403),
  `ConfigurationError` (never leaves the process). Each response carries a
  `requestId` and the server logger redacts `req.headers.authorization`,
  `req.headers.cookie` and `req.body`.
- **Health:** `/health` (liveness) and `/ready` (dependency check, reports
  `database: ok`). A deployment can therefore distinguish "process is up" from
  "process can serve traffic".
- **Injectable edges:** the clock and the id generator are constructor
  parameters, so tests can assert on deterministic timestamps and UUIDs.
- **Shutdown:** the database pool is drained in an `onClose` hook, so
  `SIGTERM` does not drop in-flight queries.

Endpoints currently exposed are deliberately only `/health`, `/ready` and the
root descriptor. Endpoint-per-feature comes with the features.

## 7. PostgreSQL architecture

- PostgreSQL 17 in Docker (`docker compose up -d`), reachable on host port
  `5433`.
- Drizzle ORM, schema split by bounded area, migrations generated with
  `drizzle-kit`.
- **23 tables** across organization, patient, scheduling, visit, treatment,
  billing and inventory, plus **10 enums**.
- Multi-tenancy: every clinical row carries `clinic_id`. Clinics are not
  separate databases; they are rows. Isolation is enforced with indexes and will
  be enforced in repository queries.
- Timestamps are `timestamptz` and stored in UTC. The clinic's timezone is
  presentation-only, resolved at the edge.
- **Scheduling integrity lives in the database.** Custom migration
  `0001_appointment_overlap_guard.sql` installs `btree_gist` and three GiST
  exclusion constraints — one per dentist, chair and room — that reject
  overlapping non-cancelled appointments. Two writers, including a future import
  script or a `psql` session, cannot double book a chair.

  The range is `[starts_at, appointment_ends_at(starts_at, duration_minutes))`,
  where `appointment_ends_at` is an `IMMUTABLE` SQL function. Nothing is stored.

  This took three attempts, and the reason is worth recording because it is
  counter-intuitive: the natural `GENERATED ALWAYS AS` column is rejected by
  PostgreSQL, since `timestamptz + interval` is `STABLE` rather than `IMMUTABLE`.
  A trigger-maintained column works, but it has to be absent from the Drizzle
  schema (Drizzle's only way to declare a non-written column emits
  `GENERATED ALWAYS AS`, which fails the same way) — and an undeclared column
  means `drizzle-kit push` would offer to drop the constraint that protects the
  schedule. Declaring the expression immutable instead of storing its result
  removes the problem rather than hiding it. See ADR 0012.

  The payoff is verifiable: `drizzle-kit generate` against a freshly migrated
  database reports "No schema changes, nothing to migrate".

- Money columns are `bigint` minor units. Invoice/payment allocation is a real
  join table (`payment_allocations`), not a denormalised flag.

## 8. State-management strategy

| Data                                               | Owner                                           |
| -------------------------------------------------- | ----------------------------------------------- |
| Anything the API returns                           | TanStack Query — never copied into a store      |
| UI-only state (open panels, filters, draft values) | local `useState` / `useReducer`                 |
| Cross-feature client state (session, preferences)  | Zustand, split by concern — no single app store |

No Zustand store exists yet because there is no cross-feature client state yet,
and a store created before its first consumer is a guess. The rule this phase
established: server data is never mirrored into a global store. The API client
is the only way out, which means caching, retries and invalidation are one
library's problem instead of five features'.

## 9. Testing strategy

| Layer                | Tool                                     | Count |
| -------------------- | ---------------------------------------- | ----- |
| Domain (pure logic)  | Vitest                                   | 81    |
| Validation schemas   | Vitest                                   | 28    |
| API client contract  | Vitest + injected `fetch`                | 14    |
| API unit             | Vitest                                   | 12    |
| React components     | Vitest + Testing Library                 | 7     |
| Database integration | Vitest against real PostgreSQL           | 4     |
| E2E (web + desktop)  | Playwright (specs written, not executed) | 0     |

142 tests pass in the default run; the 5 integration tests are excluded from it
and run with `pnpm run test:integration` against a throwaway database, because
they create and drop real rows and real constraints. That command creates the
database if it does not exist, so a wiped Docker volume is not a manual step.

Testing rules adopted:

- Business rules are tested in the domain with no mocks — they are pure.
- Contracts are tested at the boundary: the API client tests assert what the
  client sends and how it interprets what comes back.
- Anything enforced by the database is tested against the database. Overlap
  rejection, back-to-back appointments, cancellation freeing a slot, the computed
  end time, and a reschedule being re-checked by the constraint are all covered.
- The API uses an injected clock and id generator so assertions are exact.

## 10. What was actually implemented

- Monorepo workspace: pnpm + Turborepo, 9 workspace packages, 3 apps, shared
  TypeScript/ESLint/Vitest/Tailwind config packages.
- Full documentation set and 11 ADRs.
- `packages/types`: shared enums and structural types.
- `packages/domain`: patient, scheduling, visit, treatment, billing, inventory
  and organization rules, with branded IDs.
- `packages/validation`: Zod schemas for env, request bodies, query parameters
  and the API error envelope.
- `packages/api-client`: `ApiClient` with injected `fetch`, query serialisation,
  bearer-token hook, JSON body handling, `204` handling, Zod response
  validation, timeout/abort, and typed `ApiClientError` mapping of the server's
  error envelope.
- `packages/app`: `AppRoot`, `PlatformProvider` + `usePlatform`, route root,
  Tailwind v4 `@theme` design tokens with `@source` scanning for both packages.
- `packages/ui`: `cn` class helper and a status-tone vocabulary.
- `apps/api`: validated config, redacting structured logger, CORS, global error
  handler, `/health`, `/ready`, graceful shutdown, injectable clock and ids.
- `apps/web` and `apps/desktop`: thin shells over the shared app; both build and
  emit the shared design tokens.
- `database`: 23-table Drizzle schema, migration tooling, seed script, a generated
  `0000_baseline.sql` and one custom overlap-guard migration. Verified free of
  drift between schema and database.
- `scripts/check-boundaries.mjs`: an architecture guard that walks the real
  import graph. It fails on a forbidden import, on a database driver or Drizzle
  schema outside `apps/api`/`database`, on routes inside a deployment shell, and
  on a circular package dependency. It runs as part of `pnpm run lint`, so a
  violation fails the same command that fails a lint error.

## 11. What was intentionally NOT implemented

- No patient CRUD, appointment CRUD, dashboard, calendar, odontogram UI, billing
  or inventory UI. No endpoint implements them either.
- No authentication. No session, no JWT, no login screen. The token hook on the
  API client is the only seam.
- No offline mode, no SQLite, no sync engine, no local desktop database.
- No microservices, no GraphQL, no Redux, no ORM in the frontend.
- No seed rows. The seed script validates the connection and reports that seeding
  is not implemented yet, rather than inserting fake clinical data.
- No native Tauri command handlers. `PlatformCapabilities.saveFile` and
  `openExternal` are declared and unimplemented on desktop.
- The router is generated but `AppRoot` is not yet mounted through the generated
  route tree; TanStack Query and shadcn/ui primitives are Milestone 2.

## 12. Open architectural questions

1. **How are clinic-scoped queries enforced?** `clinic_id` is on every clinical
   table, but nothing yet prevents a repository from forgetting it. Candidate:
   a repository factory bound to a clinic id, so forgetting is not expressible.
   Deferred because it is a Milestone-2 shape decision, not a foundation one.
2. **Native Tauri build unverified.** `tauri build` has not been run; the Linux
   frontend half builds and the desktop CSS output is identical to the web build,
   but the Rust side needs WebKitGTK system libraries that are not confirmed
   present.
3. **Design tokens are provisional.** `design-mockup/dashboard-design.png` has
   not been analysed. The palette in `globals.css` is a placeholder and must be
   reconciled with the reference before feature UI work.
4. **Port 3000 conflict.** Not architectural, but load-bearing for local
   development: this project's API is on 3010 because an unrelated local app
   owns 3000.

## 13. Recommended next milestone

**Milestone 2 — APPLICATION SHELL.**

The foundation is deliberately featureless, so the next milestone makes the shell
real without adding a single clinical feature:

1. Mount TanStack Router in `packages/app` through the generated route tree, so
   routing is proven in the shared package before any feature depends on it.
2. Add TanStack Query and wire the `ApiClient` provider to `VITE_API_URL`, so the
   data path is proven before any feature needs it.
3. Confirm the design tokens against the reference mockup and generate the
   shadcn/ui primitives into `packages/ui`.
4. Build the shell: sidebar, header, global search, user menu, responsive
   layout, theme toggle.
5. Settle open question 1 (how to make a query unable to forget `clinic_id`)
   before the first feature repository is written.

The Dashboard (Milestone 3) comes only after the shell is in place.
