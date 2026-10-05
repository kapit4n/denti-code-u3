# ADR 0021 — Starting a visit writes two rows, and what makes that atomic

## Status

Accepted.

## Context

`packages/domain/src/visit/` has held the whole visit lifecycle since Milestone 1:
`VisitStatus`, the allowed transitions, `completeVisit`, `reopenVisit`, and
`startVisitFromAppointment` — "the single legal bridge from scheduling to clinical",
as its own comment puts it. The `VisitRepository` port is declared too. What does not
exist is anything that _uses_ them: there is no `VisitRepository` implementation, no
use case, no endpoint, and the bridge's comment says its own function is "pure: it
returns the new state rather than persisting it, **so the use case controls the
transaction**".

That sentence is the whole problem. Starting a visit writes two rows:

1. the `visits` row, and
2. its `appointments` row — status `IN_TREATMENT`, `visit_id` set.

They are one event. The agenda must not show a booking as still waiting while a
clinical record exists for it, and there is no correct reading of a visit whose
appointment does not know about it. So the write is atomic, and the question this ADR
answers is how that atomicity is expressed without inventing a second transaction
mechanism beside the one the domain already declares.

Three further gaps in `visits` make this the moment to settle them, because they are
the same kind of question and were left as Milestone 1 declarations:

- `visits.appointment_id` has a unique index and **no foreign key**. An appointment id
  can name a row that does not exist, and the index that is supposed to enforce "an
  appointment becomes a visit exactly once" enforces it against nothing.
- `appointments.visit_id` has **no foreign key in either direction**, so the reverse
  link can point at a visit that was never created.
- `visits.patient_id`, `dentist_id` and `chair_id` reference by id alone, where
  `appointments` was given composite `(id, clinic_id)` keys in migration 0002. So a
  visit can hold another clinic's patient — the exact hole ADR 0014 and ADR 0018 closed
  for the book, left open for the clinical record.

And one type lie: `Visit.dentistId` is non-optional, but the column is nullable with
`on delete set null`. Deleting a dentist after a visit has been treated would produce
a row the type cannot describe.

## Decision

### 1. One transaction seam: `UnitOfWork`, narrowed to what exists

`UnitOfWork` was declared in Milestone 1 with a `transaction<T>(work: (repositories:
Repositories) => Promise<T>)` signature and had never been implemented. This ADR uses
it rather than adding an operation-shaped port such as
`createFromAppointment(visit, appointment)` on a visit repository, because two
transaction mechanisms in one codebase is a thing that rots: the second one gets used
where the first would have done, and the "was this atomic?" question has two answers.

The alternative was rejected on its merits rather than its novelty. An
operation-shaped port is smaller, and it puts the transaction inside a persistence
class, which is where transactions usually live. But it also means a use case cannot
compose: the billing work in Milestone 6 will want to write a visit's treatments,
charges and payment in one transaction with the same `UnitOfWork`, and an
operation-shaped port has no answer for that.

`Repositories` listed nine repositories. Three of them — `TreatmentRepository`,
`PrescriptionRepository`, `PaymentRepository` — have no implementation, because the
features they serve have not been built. Handing a transaction a set that includes
three repositories nobody can construct is how a seam starts lying, so the interface is
narrowed to the six that exist. **It grows as the implementations do**, which is the
same reason the appointment port's five unsatisfiable methods were deleted rather than
implemented in session 13 (ADR 0020).

### 2. The rules stay in the domain; the transaction is infrastructure

`startVisit` is a domain use case that takes `{ unitOfWork, ids, clock }`, reads the
appointment, calls the existing pure `startVisitFromAppointment`, and hands both
finished entities to one `unitOfWork.transaction(...)`. The repository persists what
it is given and decides nothing: the refusal of a completed appointment, of an
appointment that already has a visit, and of an appointment whose dentist has left the
clinic all happen in the pure function, exactly where they already were tested.

### 3. Both links become real foreign keys, and neither is deletable

- `visits.appointment_id` → `appointments.id`, **`on delete restrict`**.
- `appointments.visit_id` → `visits.id`, **`on delete restrict`**.

`restrict` on both, deliberately, and it is worth stating why twice. These rows are a
clinical record and a booking, and the operations that normally happen to them are
cancellations, not deletions: a no-show is a status, and a wrong visit is reopened.
`set null` would be the "friendly" choice and it produces the two states this schema
exists to prevent — an appointment marked `IN_TREATMENT` whose visit is gone, or a
visit that silently becomes a walk-in because its booking was deleted. Refusing the
delete is the honest answer, and there is no endpoint that would hit it.

This makes the two references circular, which PostgreSQL allows and Drizzle declares
happily; the insertion order is visit first, then the appointment update, so neither
row is ever referenced before it exists.

### 4. The visit's references are clinic-scoped like the book's

`visits` gets the same composite `(id, clinic_id)` foreign keys migration 0002 gave
`appointments`: `restrict` for the patient (a clinical fact is not erased by removing a
patient record, which is anonymised instead), and `set null (column)` for the dentist
and the chair, which requires the PostgreSQL 15+ column-list form for the same reason
the appointments migration explains — plain `set null` would try to null `clinic_id`
too and the row would be refused by its own `NOT NULL`.

### 5. A visit requires a dentist to start and tolerates one going away

`Visit.dentistId` becomes `DentistId | null`. This is the same answer `Appointment`
already gave for the same column: refusing to _create_ a record nobody can attribute is
right, and a type that insists the attribute is still there after the clinician has
left the clinic is a lie the read mapper would have to invent data to keep.

The invariant is therefore split rather than removed — creation requires a dentist
(`startVisitFromAppointment` refuses without one, and says so), and reading a visit
whose dentist has since departed is allowed. ADR 0020's reasoning applies to the
first half: the rule must not depend on a call site remembering to check it, so the
refusal is in the use case and the column is only nullable because the database's
delete semantics require it.

### 6. One creation door in this slice

`POST /api/v1/visits` takes an `appointmentId` and nothing else about the
appointment: the patient, the clinician and the chair are read from the booking, so
there is no way to start a visit that disagrees with the appointment it came from.

Walk-in visits — a patient who arrives without a booking — are a real requirement
(the schema allows a null `appointment_id` for exactly this) and are **not** in this
slice. They are a second creation path with their own questions: whether a walk-in
needs a clinician at all, whether it needs a chair, and what a `visits` row looks like
with no appointment behind it. Building both at once would mean shipping a door whose
rules had never been argued. The domain function for the appointment bridge already
exists and is tested; the walk-in needs its own pure function and its own ADR clause,
and it gets them as the next slice.

## Consequences

- An appointment and its visit can no longer disagree: the link is atomic, and both
  directions of the link are database-enforced.
- A visit can no longer name another clinic's patient, dentist or chair.
- `startVisit` is the only way a visit comes into being, and it is testable without a
  database — a fake `UnitOfWork` is a function.
- The cost is one migration and a narrowed `Repositories` interface. The narrowing is a
  deletion, which is unusual in an ADR, and it is the third such deletion in this
  repository (the appointment port's five methods in session 13, the hidden `ends_at`
  column in session 3). The pattern is consistent: a declared seam that nothing can
  satisfy is not a safety net, it is a promise the code has stopped keeping.

## Alternatives considered

- **An operation-shaped port on `VisitRepository`** (`createFromAppointment`). Rejected:
  smaller, and puts the transaction in a persistence class — but it cannot be composed.
  Milestone 6 billing needs to write a visit, its charges and its payment in one
  transaction, and an operation-shaped port has no answer for that.
- **Two writes, no transaction, with the unique index repairing the failure.** Rejected:
  it leaves the exact state this ADR exists to prevent — a visit with an appointment
  that has not noticed — and the repair is a `409` on retry, which is a worse answer
  than never being in that state.
- **A database trigger that moves the appointment.** Rejected: a rule in the database
  that the domain cannot read, which is the mirror image of the browser rule this
  project keeps refusing. The rules are in the domain; the guarantees are PostgreSQL's;
  the transaction is the seam between them.
- **Leave the three schema gaps for a separate session.** Rejected: the FKs are what the
  write side writes. Adding `appointment_id` and `visit_id` in one transaction while the
  links remain conventions would be building the guarantee and not installing it.
