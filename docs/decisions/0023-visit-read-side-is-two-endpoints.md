# ADR 0023 — The visit read side is two endpoints, and the timeline is not capped

- Status: accepted
- Date: 2026-10-05
- Decides: what `GET /api/v1/visits` is allowed to be, whether the clinical timeline is
  bounded, and why the patient profile's existing visit query is not folded in here.
- Related: [0022](0022-completing-a-visit-is-its-own-act.md) (the write side),
  [0021](0021-starting-a-visit-writes-two-rows.md) (the bridge that starts a visit),
  [0014](0014-clinic-scoping-is-explicit.md) (a visit another clinic holds does not
  exist), [0017](0017-agenda-overlap-and-clipped-capacity.md) (why appointments needed a
  window and visits do not).

## Context

Sessions 23 and 24 built the visit write side: a visit can be started, completed and
re-opened. Three routes exist and **every one is a `POST`**. There is no way to read a
visit.

That is not a cosmetic gap, and it is not only about a missing screen. The state a write
produces is unreadable, which means:

- `VisitRepository.findById`, `findOpenForPatient` and `findForPatient` exist, are
  written, and have **no caller**. `findById` is used only by the two closing use cases
  to check a transition before they write it.
- The patient profile lists visits — but it borrows them through **its own inline
  `select` on the `visits` table inside `DrizzlePatientRepository.findProfile`**
  (`patient-repository.ts:365`), not through the visit repository. So the one place a
  visit list reaches a browser today is a query written in the patient repository,
  projecting seven columns the visit domain does not use.
- A visit closed by the API cannot be seen closed anywhere except by the dashboard's
  independent count, which reads the `appointments` table and not `visits`.

## Decision 1 — Two endpoints: one visit, and one patient's timeline

`GET /api/v1/visits/:visitId` and `GET /api/v1/patients/:patientId/visits`.

Not a collection endpoint. `GET /api/v1/visits` with `from`/`to`/`dentistIds`/`chairIds`
was considered and declined, for one reason: **there is no question about visits that is
answered by a window and a set of filters.** The appointments list is a scheduling
question — who is in which chair at what time — and it earns every filter it has. A
visit is a clinical record with no schedule; the questions are "this visit" and "this
patient's history". Adding a filterable collection now would mean inventing the filters
without a caller to ask for them, which is the premature-abstraction rule in
`AGENTS.md` wearing a costume.

The timeline is nested under the patient rather than a query parameter on a collection
because a patient's history has no other sensible address: `/patients/:id/visits` says
whose history it is without a second field, and it is the same shape the patient profile
route already has.

## Decision 2 — Most recent first, and no limit

`findForPatient` orders by `started_at` descending and returns everything.

Ordering is not a detail here. The profile's own query orders by
`coalesce(started_at, created_at)` because a visit row can exist with no start — a
walk-in recorded after the fact. A **visit-only** endpoint keeps `started_at` alone: a
timeline that mixes "when treatment began" with "when the row was created" is two
orderings pretending to be one, and the domain says a visit without a start is not a
finished visit anyway.

The cap is declined deliberately, and this is the part worth arguing. A patient with
thirty years of history is a few hundred rows — small for a query that hits an index on
`(clinic_id, patient_id)`. A cap would need an explicit truncation signal or a total
count, because **a silently truncated clinical timeline is worse than a long one**: a
clinician reading "these are this patient's visits" must be able to trust that it is
all of them. The patient profile's existing query caps at 10, and that is defensible
there precisely because it is a _preview_ — the full list is what this endpoint is for.

If this becomes a measured problem, pagination is the answer, and it should arrive with
the count that makes it honest. Not before.

## Decision 3 — The patient profile's query is left alone

`findProfile` keeps its inline `select` on `visits`.

It could be replaced by `VisitRepository.findForPatient`, and the argument for doing it
is real: one place knows how to read a visit. It is declined **for this slice** on two
grounds, and the second is the one that decides it.

1. It projects a different set of columns — `reason`, `summary`, `created_at` — chosen
   for one screen's card layout, not as the visit entity. Routing it through
   `findForPatient` means either widening the entity with fields no use case reads, or
   changing a working screen. Both are real work, and neither is this slice.
2. `findProfile` issues five queries **together** and renders in one network round trip.
   Calling out to a second repository does not make it slower on its own, but it does
   move the visits query out from under the comment that explains why all five are
   issued at once — and that comment is load-bearing documentation about a page a
   clinician opens before every appointment.

Consolidation is therefore recorded as **open work**, not as a rejected idea. When it
happens, the deciding question is what the profile card actually needs: a read model, or
the entity.

## Decision 4 — The clinic is read from the request scope, and the id is a uuid

The same rule as the write side, for the same reason (ADR 0014): a visit belonging to
another clinic is `404`, identical to one that does not exist. The `uuidSchema` guard
runs before any query, so a hand-typed id is `422` rather than PostgreSQL's `22P02`
arriving as a `500`.

The write side learned this the hard way in session 24: `readVisitId` defaulted its
clinic to `''`, which turned every completion into a `500`. The read helper takes the
clinic as a **required** parameter.

## Consequences

- The visit workspace (roadmap Milestone 6) has something to read.
- Three repository methods stop being dead code.
- `findOpenForPatient` still has no caller. It is the read side of "is this patient
  currently being treated?", which is a question the visit workspace asks; it is left in
  place rather than deleted on the grounds that deleting a port before its caller exists
  would be optimising for a codebase nobody has yet.
- Nothing here is a UI. The e2e count does not move.
