# Denti-Code U3 — Security Foundation

> **Scope of this document.** This describes the security _boundaries and
> baseline controls_ established during the architecture phase.
> **No compliance claim is made.** Nothing in this repository has been audited,
> certified or assessed against any regulation (HIPAA, GDPR, local dental
> record laws, …). Any statement that the product "is compliant" would be false
> until an assessment actually exists and is documented here.

---

## 1. Boundaries

| Boundary              | Where                              | Rule                                                                |
| --------------------- | ---------------------------------- | ------------------------------------------------------------------- |
| Browser/Desktop → API | `packages/api-client` → `apps/api` | all traffic over the API; no direct database access from any client |
| API → Database        | `apps/api` → `database/*`          | only the API holds database credentials                             |
| UI → Domain           | `packages/app` → `packages/domain` | rules are pure and cannot perform I/O                               |
| UI → OS               | `packages/app/src/platform`        | the only path to desktop capabilities                               |
| Process → Config      | `apps/api/src/config/env.ts`       | validated once at boot; no scattered env access                     |

## 2. Baseline controls established in Phase 1

- **Input validation at every boundary.** Zod schemas validate all API inputs
  (body/query/params) before any use case runs. Shared schemas in
  `packages/validation` keep client and server validation in agreement.
- **SQL injection.** All SQL is built by Drizzle's query builder with bound
  parameters. There is no string-built SQL anywhere; the boundary guard forbids
  database imports outside `apps/api`/`database/`.
- **Safe error responses.** A single error envelope (`{ error: { code, message,
details?, requestId } }`); unknown errors become a generic 500. Database driver
  text, SQL and stack traces never reach a client.
- **Least data exposure.** Responses include only fields the screen needs;
  clinical content is not fetched "just in case".
- **Authorization boundary.** Roles and permissions are modelled in the domain
  (`ROLE_PERMISSIONS`, `hasPermission`) and enforced in the API. UI only hides
  affordances; it never enforces access.
- **Authentication boundary (designed, not implemented).** `users` table with
  `password_hash` (never a password), clinic membership, and a session concept
  is reserved. Implementation is Milestone 12.
- **Desktop capability restriction.** Tauri's capability grants are minimal; no
  shell plugin, no filesystem-wide access, no remote code loading; CSP restricts
  script sources in release builds.
- **Privacy-preserving logging.** Structured logs contain ids, statuses and
  durations — never clinical content, names, notes or payment references.
  Redaction is configured at the logger level.
- **Configuration hygiene.** Secrets live in environment variables; `.env` is
  git-ignored; `.env.example` documents every variable without real values.
- **Type safety as a security control.** Strict TypeScript plus shared contracts
  makes it harder to pass unvalidated shapes into domain logic.

## 3. Known gaps (intentional for Phase 1)

- No authentication implementation (any endpoint is currently open).
- No session management, token rotation, CSRF/refresh strategy.
- No rate limiting or abuse protection.
- No encryption-at-rest policy, key management, or backup/retention procedures.
- No audit log (only `created_at`/`updated_at`/actor columns).
- No security headers/CSP middleware for the API (only the desktop webview CSP).
- No dependency scanning or SBOM in CI yet.
- No penetration test or independent review.

## 4. Before any real patient data is used

1. Implement authentication + session handling with the roles in
   `docs/open-questions.md` #1 resolved.
2. Enable TLS everywhere (API + database) and document key handling.
3. Define retention/anonymisation policy with the clinic and legal counsel
   (`docs/open-questions.md` #7).
4. Add structured security event logging (auth failures, permission denials,
   record access on clinical data).
5. Run dependency scanning and an independent security review.
6. Only then make any compliance statement, and document exactly what was
   assessed and by whom.

## 5. Clinical-safety notes

- Appointment status transitions, chair conflicts and billing arithmetic are
  correctness-critical; they are implemented as pure domain rules with unit
  tests rather than left to UI logic.
- A dental record is patient data. Defaults are conservative: soft delete rather
  than hard delete for patient-facing records, and minimal logging.
- The product shows patient information on shared clinic screens; screen-lock
  behaviour and re-authentication for sensitive views are product questions, not
  technical afterthoughts (tracked for Milestone 12).
