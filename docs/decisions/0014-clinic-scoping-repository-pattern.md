# ADR 0014 — Clinic scoping in repository pattern

- Status: Accepted
- Date: 2026-10-02
- Decides: consistent approach to enforce clinic_id scoping at the repository boundary

## Context

Every clinical row in the database carries `clinic_id`. The open question notes nothing currently stops a repository from forgetting it when querying or writing data. This is a correctness and security concern (cross-clinic data leakage). Since the domain must remain framework-independent (ADR-0004) and infrastructure (API/DB) owns data access, enforcement belongs at the repository boundary, not in React components or domain entities.

The schema already models multi-clinic support with `clinic_id` on relevant entities. The simplest, explicit approach is to make clinic scope part of repository method signatures and/or context.

## Decision

1. **Repositories must be clinic-scoped by default.** All repository methods that read or write clinical data must accept `clinicId` as an explicit parameter (or accept a context object containing it). Never infer scope from global state.

2. **Domain stays pure.** Domain entities and use cases should not assume global clinic context. If a use case needs clinic scope, it receives it as input.

3. **Infrastructure enforces at query time.** Drizzle repository implementations must include `WHERE clinic_id = ${clinicId}` (or equivalent) on all multi-tenant queries. Writes must set `clinic_id` from the provided scope.

4. **Default single-clinic assumption remains.** The system can be configured for a single clinic, but the repository API still takes clinicId explicitly to prevent accidental leakage.

5. **No cross-clinic operations without explicit elevation.** Any operation that spans clinics requires an explicit permission check at the application/use-case layer, not implicit.

## Consequences

- Repositories become safer and more testable (scope is explicit).
- Domain remains framework- and auth-agnostic.
- Slightly more verbose method signatures, but prevents a class of critical bugs.
- Enforcement is visible in code review and can be validated by tests.

## Implementation note

This is documented as the pattern to follow in feature milestones (starting with Patients/Dashboard when they query clinical data). No code changes required now as this is a design decision; future repositories must adhere to it.
