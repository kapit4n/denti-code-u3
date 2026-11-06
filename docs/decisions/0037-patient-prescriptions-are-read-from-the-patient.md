# ADR 0037 — Patient prescriptions are read from the patient, not visit by visit

- **Status:** Accepted
- **Date:** 2026-11-04
- **Deciders:** Principal Architect, Product Owner
- **Affects:** `packages/domain`, `apps/api`, `packages/app`, `e2e`
- **Relates to:** [ADR 0014](./0014-clinic-scoping-repository-pattern.md), [ADR 0025](./0025-two-engines-sqlite-runs-postgresql-kept.md), [ADR 0036](./0036-treatment-plan-items-are-the-cross-visit-unit.md)

## Context

A prescription is written on the visit where the course was handed over, and the visit
workspace already reads it through `GET /api/v1/visits/:visitId/prescriptions`. The
patient profile needs a different question answered: what has this patient been given?
Before this change the only way to answer it was to open visits one at a time until the
course was found.

The profile already reads the patient's treatment plans and invoices through
patient-scoped endpoints. Prescriptions are the missing clinical history beside them.

## Decision

### 1. Prescriptions remain visit-owned rows

No column, table or ownership rule changes. A prescription still carries its visit and
patient, and the visit workspace keeps its existing read and write paths. The profile
read changes the subject, not the record.

### 2. The profile gets a patient-scoped read

`GET /api/v1/patients/:patientId/prescriptions` answers
`{ prescriptions }`, newest first by issue time, then by id. It uses the existing
`visits:read` permission.

`PrescriptionRepository.findForPatient(clinicId, patientId)` resolves the patient first.
`undefined` means this clinic holds no such non-anonymised patient and the route answers
404; a real patient with no prescriptions answers an empty list. The prescription rows
are scoped by joining the visit, because prescriptions have no clinic column of their own.

### 3. The profile card links back to the source visit

The card draws medication, dosage, route, frequency, duration, instructions and the issue
time in the clinic's clock. Each row links to its visit rather than inventing a second
prescription detail page. The read is a separate query on the profile, so a failed
prescription read is an error sentence in that card, not a failed profile.

Creating a prescription invalidates both the visit read and the patient read.

## Consequences

- A clinician can check what the patient was sent home with without opening each visit.
- The profile and visit screens read the same rows with the same domain entity; neither
  stores a second copy or derives one from the other.
- Both database engines implement the same patient-first 404 rule and newest-first order.
- The profile answer does not grow: prescriptions are a separate request, like plans and
  invoices.
- A patient with a very long prescription history sends the whole list with no pagination.
  Pagination is a later decision if the history becomes large.
- No schema change or migration is required.

## Alternatives rejected

- **A visit-by-visit profile read.** It would make the profile fetch an unbounded number of
  visits just to find the prescriptions, and it would show a different failure mode per
  visit.
- **Adding a `clinic_id` to prescriptions.** The visit already owns the tenancy, and the
  join is the same rule the visit read uses. A second column would be another value to
  keep consistent.
- **Folding prescriptions into the profile response.** It would couple a growing clinical
  list to the profile query and make one failed prescription read fail the whole record.
- **A prescription detail page.** The visit is the record the prescription belongs to, and
  the existing visit workspace already shows it in context.
