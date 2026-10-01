# Denti-Code U3 — Backend (API) Architecture

Companion to [`architecture.md`](./architecture.md). Framework choice and
rationale: [ADR 0005](./decisions/0005-rest-and-fastify.md).

---

## 1. Shape

`apps/api` is a **modular monolith**: one deployable process, internally split
into modules that follow the domain's bounded contexts. No microservices, no
message bus, no service-to-service calls. One PostgreSQL, one process.

```
apps/api/src/
├── main.ts                  process entry: load config → build app → listen → graceful shutdown
├── app.ts                   Fastify instance assembly (plugins, error handler, routes)
├── config/
│   ├── env.ts               Zod-validated environment (the ONLY process.env reader)
│   └── logger.ts            pino options, redaction
├── http/
│   ├── routes/              one file per resource area — transport only
│   ├── controllers/         HTTP ↔ use case translation, status codes
│   ├── plugins/             fastify-plugin registrations (db, auth, request context)
│   └── problem.ts           the single error → HTTP mapping
├── application/             use cases (one file per use case), transaction boundaries
├── infrastructure/
│   ├── persistence/
│   │   ├── postgres/        postgres.js client + drizzle instance
│   │   └── repositories/    Drizzle implementations of domain ports
│   ├── clock/               system clock implementation of the Clock port
│   └── id/                  uuid generator implementation
├── modules/                 resource modules wiring routes → use cases → repositories
└── container.ts             composition root (wires everything, testable)
```

**Route handler budget:** a route declares method/path, validation schema, and
calls exactly one use case. If a route handler grows domain logic, that logic
moved to the wrong place — this is the main review check.

## 2. Request pipeline

```
1. Fastify receives the request
2. request-id plugin: read x-request-id or generate uuid  → request.id
3. logger: structured JSON line (method, path, status, durationMs, requestId)
4. validation: Zod schemas per route (body/query/params) → typed handler input
5. controller: authn/authz checks + HTTP ↔ use case mapping
6. use case (application/): orchestration, transaction via UnitOfWork, domain calls
7. domain: pure rules and invariants (no I/O)
8. repository: domain port implementation (Drizzle, parameterized queries)
9. PostgreSQL
10. error handler: any thrown error → problem+json (single envelope)
```

## 3. API conventions

- Base path: `/api/v1` (`/health` and `/api/v1/system/info` sit outside the
  versioned resources for probes).
- Resources: `/patients`, `/appointments`, `/visits`, `/treatments`,
  `/treatment-plans`, `/odontograms`, `/prescriptions`, `/payments`, `/invoices`,
  `/dentists`, `/clinics`, `/rooms`, `/chairs`, `/inventory`.
- JSON in, JSON out. `snake_case` on the wire (matches SQL and the Drizzle
  schema); domain models are `camelCase`; mappers translate. This is a deliberate
  choice so the wire format matches the database without leaking Postgres
  naming into the domain.
- Dates: ISO 8601 UTC strings (`2026-09-30T14:00:00.000Z`). Money: integer minor
  units + ISO currency.
- Lists: `{ data: T[], meta: { page, pageSize, total } }`.
- Errors: `{ error: { code, message, details?, requestId } }` (RFC 9457-inspired
  but simplified; see `http/problem.ts`).

## 4. Configuration

`config/env.ts` validates **all** environment variables once at startup with Zod
and exports a typed, frozen config object. Nothing else reads `process.env`.
Missing/invalid configuration fails fast at boot, not on first request.

| Variable                     | Purpose                                             | Required |
| ---------------------------- | --------------------------------------------------- | -------- |
| `NODE_ENV`                   | development/test/production                         | yes      |
| `API_PORT`                   | listen port                                         | yes      |
| `API_HOST`                   | bind address                                        | yes      |
| `DATABASE_URL`               | PostgreSQL connection string                        | yes      |
| `LOG_LEVEL`                  | pino level                                          | yes      |
| `CORS_ORIGINS`               | comma-separated allowed origins (web dev server)    | yes      |
| `VITE_API_URL` (web/desktop) | base URL of the API                                 | yes      |
| `CLINIC_TIMEZONE`            | default clinic timezone for the single-clinic setup | yes      |

`.env.example` documents all of them; `.env` is git-ignored.

## 5. Logging

Structured JSON via pino (Fastify built-in).

- **Request lines:** method, path (route template, not raw URL with query
  strings), status, durationMs, requestId. No bodies.
- **Errors:** code, message, stack (server-side only), requestId.
- **Application events:** explicit `log.info({ event, ...ids })` for meaningful
  domain events (appointment rescheduled, visit completed). Event names are
  finite strings, not free text.
- **Privacy:** redaction configured; clinical content, patient names, notes and
  payment references are never logged. Only ids, statuses and durations.
- In development, pino-pretty renders the same logs readably.

## 6. Errors

| Situation                                           | HTTP    | Error code                                          |
| --------------------------------------------------- | ------- | --------------------------------------------------- |
| Schema validation failed                            | 400     | `VALIDATION_ERROR`                                  |
| Auth missing/invalid                                | 401     | `UNAUTHENTICATED`                                   |
| Permission denied                                   | 403     | `FORBIDDEN`                                         |
| Not found                                           | 404     | `NOT_FOUND`                                         |
| Domain rule violated (illegal transition, conflict) | 409/422 | `DOMAIN_RULE_VIOLATION`                             |
| Unexpected                                          | 500     | `INTERNAL_ERROR` (generic message + requestId only) |

Database/driver errors are **never** forwarded: the error handler maps them to a
generic 500 and logs the detail server-side with the request id. Stack traces and
SQL never reach a client.

## 7. Transactions

A `UnitOfWork` port wraps Drizzle transactions. Use cases that must write
several rows atomically (creating a visit from an appointment, issuing an
invoice from charges, recording a payment with allocations) run inside one
transaction. Read-only paths never open a transaction.

## 8. Repository implementations

- One repository per domain port, in `infrastructure/persistence/repositories/`.
- All SQL is built with Drizzle's query builder → parameterized by construction.
  No string interpolation of values, ever.
- Row → domain mappers live next to the repository (explicit, no reflection).
- Repositories return domain types; Drizzle types never leak past the
  repository boundary.
- Queries for the agenda use range predicates on `(clinic_id, starts_at)` with a
  matching index.

## 9. Security baseline

- Input validated with Zod at every route before any use case runs.
- Authorization is enforced here (API), never in UI components; the UI only
  hides affordances the user cannot use.
- Identifiers are UUIDs supplied/generated server-side; the database uses
  parameterization, so SQL injection surface is limited to Drizzle's
  parameter binding.
- Response bodies for patient resources deliberately omit fields not needed by
  the current screen (no accidental over-fetching of clinical content).
- Secrets live in environment variables, never in the repository.

## 10. Testing

- Use cases are tested with in-memory repository fakes (no database).
- Repositories and migrations are tested against a real PostgreSQL
  (`docker compose`) — the schema is the contract.
- Route validation and the error envelope are tested at the HTTP boundary with
  Fastify's `inject()` (no port binding).

See [`testing.md`](./testing.md).
