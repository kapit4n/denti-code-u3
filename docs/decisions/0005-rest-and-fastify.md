# ADR 0005 — REST over HTTP, served by Fastify 5

- **Status:** Accepted
- **Date:** 2026-09-30
- **Deciders:** Principal Architect
- **Affects:** `apps/api`, `packages/api-client`, `packages/validation`

## Context

The brief mandates a Node.js + TypeScript REST API that stays lightweight and
does not become a source of backend complexity. The frontend needs a typed
client. Requirements:

- JSON over HTTP, resource-oriented URLs (`/patients`, `/appointments`).
- TypeScript-first with excellent inference and no code generation step that can
  drift.
- Structured logging out of the box (required by the brief: request info,
  errors, application events — without logging patient data).
- Input validation with the same Zod schemas the frontend uses.
- Fast startup and low overhead for local development.

Options considered:

1. **Express 5** — ubiquitous, but hand-rolled logging/validation, weaker TS
   story, unmaintained momentum relative to alternatives.
2. **Fastify 5** — schema-first HTTP server, built-in pino JSON logging,
   plugin encapsulation, excellent TS types, serialization/deserialization via
   JSON-schema validators.
3. **Hono** — very fast, tiny, excellent TS inference, works on any runtime.
4. **NestJS** — structured, DI-based, decorator-heavy; a framework the brief
   explicitly does not need.
5. **tRPC** — end-to-end types, but it is not REST and couples the client shape
   to the server code; the brief asks for REST resources.

## Decision

Use **Fastify 5** serving a **REST** JSON API, with:

- **Zod schemas from `packages/validation`** as the single source of validation
  truth at every boundary (body, query, params). Fastify is registered with
  Zod-type provider so validation happens in the same place as transport.
- **pino** (Fastify's built-in logger) for structured JSON logs: request
  method/path/status/duration/requestId, errors with stack, and explicit
  application events. Redaction is configured so nothing resembling clinical
  content is logged by default.
- **Request id** on every request (from the `x-request-id` header or a
  generated UUID), echoed in the response and in every log line and error body.
- **One error envelope** (`{ error: { code, message, details?, requestId } }`)
  produced in one place, mapped from domain/application errors to HTTP status.
- **Encapsulated plugins** per resource so each area of the API is a module, not
  a central route file.

The frontend reaches it through `packages/api-client`, a thin typed fetch
wrapper with no framework dependencies (no React), so it is usable from the app,
from tests and, later, from other clients.

## Rationale

- **Lightweight and boring.** Fastify is a thin HTTP layer — no DI container, no
  decorators, no magic. The brief warns against unnecessary backend complexity.
- **TypeScript-first without codegen drift.** Types come from shared Zod schemas
  in `packages/validation`; the API and the client infer from the same objects,
  so a contract change breaks the build on both sides immediately.
- **Structured logging for free.** pino is JSON-first and Fastify wires request
  logging by default — exactly the "basic structured logging" the brief asks
  for, without building it.
- **Encapsulation maps onto bounded contexts.** Fastify plugins mirror the
  modular monolith that this system should be.
- **REST is the right transport here.** The API is consumed by two first-party
  clients (web, desktop) plus future integrations (imaging, payments). A stable,
  documented, cache-friendly HTTP contract is more valuable than end-to-end
  type magic between one server and one client.

## Consequences

Positive:

- One validation definition protects form, request and persistence boundaries.
- Logging and request correlation are correct by default, not by discipline.
- The API stays a thin transport shell; business logic lives in use cases and
  the domain.
- Swapping the transport later (e.g. to a queue or gRPC for integrations) is
  possible because controllers depend on use cases, not on Fastify types.

Negative / accepted costs:

- **Zod + Fastify type provider** adds a small amount of adapter code versus
  Fastify's native JSON-schema validation. Accepted: one validation language
  across the stack is worth more than avoiding an adapter.
- **No ORM-style relation loading.** Drizzle requires explicit `with`/`join`;
  a mis-sized relation produces a query error at runtime. Mitigated by
  centralised repository mappers and integration tests against real PostgreSQL.
- **REST verbosity.** Resource-oriented URLs and explicit status codes are more
  verbose than RPC; acceptable and explicit for financial/clinical operations.

## Alternatives rejected

- **NestJS:** far too much framework ceremony for the current scale; slow DX for
  a small team; the brief forbids unnecessary backend complexity.
- **Express 5:** acceptable, but weaker built-in logging and typing; Fastify
  gives the brief's logging requirement for free.
- **Hono:** attractive and fast; chosen against it only because Fastify's
  ecosystem and plugin story is more mature for a long-lived API and its
  `zod-type-provider` integrates cleanly. Hono remains a valid swap since all
  transport knowledge is confined to `apps/api/src/http`.
- **tRPC:** not REST; would couple client and server shapes and violate the
  brief's REST requirement.
- **GraphQL:** explicitly forbidden.

## Verification

`pnpm --filter @denti-code-u3/api dev` boots the API; `GET /health` and
`GET /api/v1/system/info` respond without a database; request/response
validation is exercised by tests in `apps/api/test`.
