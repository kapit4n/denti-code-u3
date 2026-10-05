# ADR 0022 — Completing a visit is its own act, and reopening is not audited yet

- Status: accepted
- Date: 2026-10-05
- Decides: the shape of `POST /api/v1/visits/:id/complete` and `…/reopen`, whether
  either touches the appointment, and why the roadmap's word "audited" is not met by
  this slice.
- Related: [0021](0021-starting-a-visit-writes-two-rows.md) (the bridge that starts a
  visit), [0018](0018-appointment-write-side.md) (the appointment's own write rules),
  [0014](0014-clinic-scoping-is-explicit.md).

## Context

Session 23 made a visit startable: `POST /api/v1/visits` writes the visit and moves its
appointment to `IN_TREATMENT` in one transaction. Nothing can finish one.
`completeVisit` and `reopenVisit` have existed in `packages/domain/src/visit/visit-lifecycle.ts`
since session 8 as pure functions with unit tests and **no caller**, so every visit
started stays `OPEN` forever. That is not a cosmetic gap: `acceptsClinicalRecords` refuses
a record on anything that is not open, and the patient profile lists visits by
`coalesce(started_at, created_at)` with a status beside each one — so a clinic would
accumulate a growing pile of permanently open encounters.

The domain half already existed. Three things had to be decided, and one of them is a
product question this slice does not answer.

## Decision 1 — Two endpoints, not one `POST /visits/:id/status`

`POST /api/v1/visits/:id/complete` and `POST /api/v1/visits/:id/reopen`, both with no
body.

The appointment write side has one status endpoint, so consistency argues for the same
shape here. It is still wrong, for a reason specific to visits: the visit transition table
also allows `OPEN → CANCELLED`, and **no rule, use case or repository method exists for
cancelling a visit**. A single status endpoint would accept that value and route it to
`updateStatus`, which would write a cancelled visit with no end time, no reason and no
opinion — a door to a rule nobody wrote. Two named endpoints cannot express it, because
there is no `…/cancel` to hang on the wall.

Completing and reopening are also not two values of one field. Completing **sets**
`endedAt`; reopening **clears** it. That asymmetry is the whole difference between them,
and a `status` body would leave the caller to know which one it was doing.

## Decision 2 — Neither endpoint touches the appointment

The obvious symmetry says otherwise: the bridge moved the appointment to `IN_TREATMENT`
when the visit started, so the visit finishing should move it to `COMPLETED`. That is
refused, and the reason is in the appointment's own transition table:

```
COMPLETED: [],          // packages/domain/src/appointment/appointment-lifecycle.ts
```

An appointment is **terminal** once completed. So a visit that also completed its
appointment could never be reopened — unless `COMPLETED → IN_TREATMENT` were added, and
that is a product decision nobody has been asked about, with a visible cost:
`appointment-quick-panel.tsx` builds its buttons from
`allowedAppointmentTransitions(entry.status)` at render time, so a new edge out of
`COMPLETED` appears as a button on **every completed appointment in the clinic**, moving
the booking without touching the visit and re-creating exactly the disagreement this
architecture exists to prevent.

So the booking is completed through the door that already exists —
`POST /api/v1/appointments/:id/status`, with the quick panel's "Complete" button. The two
lifecycles have different authors: the visit's completion is the clinician's clinical
statement, and the booking's completion is the front desk's record that the slot was used.

**The cost is real and is pinned by a test.** Between a visit being completed and the
booking being completed, the agenda still reads `IN_TREATMENT` and the dashboard still
counts the patient in its `inTreatment` total
(`byStatus(['ARRIVED', 'IN_TREATMENT'])` in `apps/api/src/http/routes/dashboard.ts`). A
test asserts the appointment is untouched, with this paragraph beside it, so the next
person to read it as a bug learns that it is a decision with a price rather than an
oversight.

## Decision 3 — Reopening is not audited, and the roadmap's word is deferred

`docs/roadmap.md` lists this bullet as "Visit completion / reopening **(audited)**", and
the comment on `reopenVisit` has claimed "is auditable" since session 8. Neither is true
today, and this slice does not make them true.

An audit trail records **who**. There is no user model: `visits.created_by` is a nullable
uuid with no foreign key, `clinical_notes.author_id` is the same shape, and auth has not
been built. A table recording _what_ and _when_ that no screen and no clinician can read
is the "answered with silence" fault ADR 0018 removed `treatmentId` for — a field stored
and never returned is worse than no field, because the schema then claims a guarantee
nobody is keeping. So no audit table is added, and the claim in the source comment is
removed rather than left standing next to code that does not do it.

What is left is honest and thin: the row's `updated_at` moves, and that is the whole
trace. **The `reopenedAt` parameter of `reopenVisit` is removed**, because it was accepted
and discarded — `reopenVisit(visit, reopenedAt)` returned a new entity that never
mentioned it. A signature that takes a timestamp and throws it away is a lie about what
the system records, and the unit test that passed it a literal timestamp was asserting
that the lie was still there.

Recorded as an open question: what a reopening has to say — who, when, and why — and
whether it needs a reason the way a cancellation does (`requiresTransitionReason`). Both
belong with the first person to log in.

## Decision 4 — No transaction for either, and `updateStatus` takes the end time

`startVisit` is given a `UnitOfWork` because it writes two rows. Completing or reopening
a visit writes **one**, and its read exists only to evaluate a transition rule, so both
use cases take a plain `VisitRepository` — the same shape `transitionAppointmentStatus`
uses. There is no interleaving that corrupts state: the status and its end time always
travel in one statement, so a concurrent complete and reopen can only overwrite each
other's intent, never leave a completed visit with no end time.

That last sentence was not true of the code as found. `DrizzleVisitRepository.updateStatus`
stamped `endedAt: new Date()` itself, ignoring the `endedAt` the domain had computed from
the injected `Clock`. Two consequences: the endpoint's answer carried the clock's time
while the row carried wall-clock time — two truths about the same row, differing by
however long the request took — and a test with a fixed clock would pass against the use
case and fail against the table, which is the shape of a test that has stopped testing
the thing that matters. The signature now takes the end time the domain decided:

```ts
updateStatus(clinicId, visitId, status, endedAt: IsoDateTime | null): Promise<void>
```

`null` rather than `undefined`, because "this visit has no end time" is a fact to be
written, not an omission to be inferred.

## Consequences

- A visit can be closed and re-opened, and `endedAt` follows the status in both
  directions.
- Neither endpoint can move an appointment, and a cancelled visit remains unreachable.
- Nothing records that a visit was ever closed. That is a known gap with an owner (the
  open question), not a claim this ADR makes.
- `updated_at` is the only trace of a reopening.
