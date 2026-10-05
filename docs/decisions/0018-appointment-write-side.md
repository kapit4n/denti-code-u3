# ADR 0018 — The appointment write side: rules in the domain, the database as the guarantee

## Status

Accepted.

## Context

The read side of the clinic's book shipped as two slices: the `AgendaEntry` read
model behind `GET /api/v1/appointments` (ADR 0017), and the read-only grid that
consumes it (ADR 0011). The write side has been in the repository since Milestone 1
as code with no caller: `findSchedulingConflicts`, the `ALLOWED_TRANSITIONS` table
in `appointment-lifecycle.ts`, and three Zod schemas in `packages/validation`
(`createAppointmentSchema`, `rescheduleAppointmentSchema`,
`transitionAppointmentSchema`) that nothing parses.

The scheduling invariant itself is not ours to define. Migration
`0001_appointment_overlap_guard.sql` installs exclusion constraints
over `tstzrange(starts_at, appointment_ends_at(...), '[)')` for the dentist, the
chair and the room, and PostgreSQL refuses the second overlapping write no matter
which code path produced it. The application's job is to make that refusal rare
and legible, never to be the only thing standing between two receptionists and a
double-booked chair.

Three questions have to be answered before the first line of code, and none of
them is answered by "it is obvious".

**1. Where do the rules live?** A route handler is the obvious place, and it is
the wrong one: "an appointment may not overlap another for the same dentist" has
to hold identically for the web app, the desktop app, a future mobile client and
a seed script. ADR 0004 keeps the domain free of infrastructure; the rules are
business rules, so they are use cases in `packages/domain`, and the routes become
parsing and nothing else.

**2. Is the conflict check a guarantee or a courtesy?** It cannot be a
guarantee. A check-then-insert pair has a window between the two statements, and
the window is exactly when two receptionists both see a free 10:00 slot. The
guarantee is the exclusion constraint. The check exists to turn a constraint
violation into a message a receptionist can act on, and the repository must
therefore translate SQLSTATE `23P01` into the domain's `SCHEDULING_CONFLICT` — an
unrecognised error here would surface as a 500 for the one case the clinic is
most likely to hit.

**3. What does un-cancelling do?** `CANCELLED` releases the slot
(`reservesSchedulingSlot`), so a cancelled appointment produces no conflict.
Moving it back to `SCHEDULED` therefore **re-reserves** the dentist and the chair,
and two receptionists who cancel and restore can collide on a slot that was, ten
seconds earlier, free for both of them. A transition back into a
slot-reserving status goes through the same conflict check as a reschedule. This
is the least obvious rule in the slice and the one most likely to be skipped.

## Decision

**Three use cases in `packages/domain/src/appointment/`**, each taking injected
dependencies, each returning the `AgendaEntry` the write produced:

| Use case                      | Endpoint                                | Answers                         |
| ----------------------------- | --------------------------------------- | ------------------------------- |
| `createAppointment`           | `POST /api/v1/appointments`             | is this booking allowed at all? |
| `rescheduleAppointment`       | `PUT /api/v1/appointments/:id/schedule` | may the time move?              |
| `transitionAppointmentStatus` | `POST /api/v1/appointments/:id/status`  | is this state change legal?     |

**Two ports, as the patients port already does it.** `AppointmentWriteRepository`
is new and carries `insert`, `replaceSchedule` and `changeStatus`;
`AppointmentRepository` gains the three reads the use cases need — `findById`,
`findOverlapping` and `findEntryById` — and extends the write port, exactly as
`PatientRepository` extends `PatientWriteRepository` (ADR 0015). The split is not
about hiding mutations from readers; it is that the three write methods are where
the guarantees live (one statement, the clinic scope in the `WHERE`, the exclusion
constraint translated rather than swallowed), and those are worth stating on an
interface of their own rather than three paragraphs into one that also describes
paging.

**Rules, each in one place:**

- A new appointment is always `SCHEDULED`. There is no "create it as confirmed",
  because confirming means the patient agreed, and a form that can do that
  invents an agreement nobody had.
- The duration must be an integer within
  `[MINIMUM_APPOINTMENT_MINUTES, MAXIMUM_APPOINTMENT_MINUTES]`
  (`isValidAppointmentDuration`).
- The appointment must fit **inside** the clinic's opening hours for that
  clinic-local day, not merely start on a day the clinic is open. A 17:30
  one-hour appointment at a clinic that closes at 17:00 is rejected
  (`OUTSIDE_OPERATING_HOURS`). This needs a wall-clock reading in the clinic's
  zone, which lives in the domain (`clinicLocalMoment`) rather than in the
  application layer that already has one for reporting: a business rule that
  cannot be tested without the API is a business rule in the wrong place.
- No overlap with a slot-reserving appointment for the same dentist or chair
  (`findSchedulingConflicts`, ADR 0017).
- The schedule may only change while the appointment is `SCHEDULED` or
  `CONFIRMED` (`isScheduleEditable`). After the patient has arrived the booked
  time is history, and a clinician correcting a time retroactively is falsifying
  the record.
- A status change must be in `ALLOWED_TRANSITIONS` (`assertAppointmentTransition`).
  Re-entering a slot-reserving status re-checks conflicts.

**Responses are the server's answer.** Every write returns the `AgendaEntry` the
database now holds, read back through the same join the agenda uses. The client
splices that into its cache; it never reconstructs a row from the values it sent
(ADR 0011). Returning the entry rather than a bare id means a created
appointment can appear on the grid without a second round trip, and means a
client that optimistically guessed a patient name cannot introduce one.

**Clinic scope is a parameter of every statement, never a lookup the caller did
first** (ADR 0014), and a row that is not in this clinic is `NOT_FOUND` — the
same answer as a row that does not exist.

### Deliberately not in this slice

- No UI. The form, the quick panel and drag/drop arrive with `from-calendar-event.ts`
  (ADR 0011) once the server can refuse a write, because a drag that silently
  fails is worse than no drag.
- **The booking request does not accept a `roomId`.** The column and its exclusion
  constraint exist and the entity still carries it, because the entity is a
  picture of the table; what is declined is _asking_ for one at the boundary.
  `AgendaEntry` does not report the room, so a booking that named a room could
  never be shown it or moved to another one — the same "answered with silence"
  fault that removes `treatmentId` below. The chair is what the write side
  accepts, for the one reason that separates them: the read model reports the
  chair. Room comes with the grid's room columns, which need a `roomId` in
  `AgendaEntry` first. Note that a chair belongs to a room, so `room_no_overlap`
  is not dormant: a booking that takes a chair still collides with everything else
  in that room.
- No bulk or recurring appointments.
- A lunch break inside the day (`clinic_operating_hours.break_starts_at` /
  `break_ends_at`) is not enforced. The columns exist, the domain's
  `ClinicOperatingHours` does not carry them, and nothing in the product exposes
  them yet — so a booking may currently span a break the clinic has configured.
  That is a gap, not a decision: the rule belongs here once the clinic settings can
  express a break, and until then a booking across one is refused by nobody.
- `treatmentId` is not accepted on a booking. `appointments` has no
  `treatment_id` column, and a form that sends one and is answered with silence is
  worse than a form without the field. The column arrives with the treatment work,
  which has an opinion about whether a treatment links to one appointment or to
  many.

## Rationale

The alternative — writing the checks in `routes/appointments.ts` — is fewer files
and one more implementation of every rule per client. The second alternative,
skipping the application check and letting the constraint answer, is worse than
it sounds: the receptionist would get a 500 with a request id for the most common
mistake in a clinic's day.

`findOverlapping` exists only to feed the conflict check, and it takes a bare
`AppointmentWindow` — the agenda's half-open interval without its dentist and
chair filters. That is deliberate: a conflict check that filtered by the resource
it is about to collide with would find nothing and pass. The filters are the
screen's business; the checker must see every booking to be right.

Two nullability changes fall out of making the read port return entities, and both
are the schema's truth rather than a convenience. `appointments.dentist_id` is
`on delete set null`, so `Appointment.dentistId` is `DentistId | null`: a booking
outlives its dentist, and a reader that had to invent an id to satisfy the type
would put a fiction in the middle of a calculation. Such an appointment holds no
dentist resource, so it can only ever conflict on its chair. `clinicId` moves the
other way, from `string` to `ClinicId`, so an appointment cannot be written for a
clinic nobody named. `startVisitFromAppointment` then refuses an appointment with
no dentist rather than inventing one, because a visit is attributable to a
clinician.

Returning the entry rather than the entity is the smaller contract. The entity
has `createdAt`, `updatedAt` and `cancelledReason`, which the grid has no use for,
and a response shape that matches what the screen needs is one the agenda's own
query already defines.

## Consequences

- The exclusion constraint and the domain check are two implementations of one
  rule, across a language boundary, which is unavoidable. They are asserted
  against each other in `apps/api/test/appointment-overlap.integration.test.ts`
  and by the write-side integration tests, because a disagreement shows up as a
  free slot the database considers taken.
- `isExclusionViolation` must unwrap Drizzle's `cause` chain exactly as
  `isUniqueViolation` does, for the same documented reason: the code lives on the
  driver error, not on the wrapper.
- Emergency and after-hours bookings are **rejected** by the operating-hours
  rule. That is what `OUTSIDE_OPERATING_HOURS` was written for, and it is
  correct for a scheduled clinic; whether a real clinic needs an override is a
  product question recorded in `docs/open-questions.md`, not something this
  decision invents an answer for.
- Every write is a read-modify-write over two statements. That is acceptable
  because the constraint makes the loser's write fail; a serialisable
  transaction would hide a double-booking attempt rather than refuse it.

## Verification

- Domain unit tests per use case, including: a rejected booking consumes no id;
  a transition into a slot-reserving status re-checks conflicts; the schedule of
  an `ARRIVED` appointment is frozen; an appointment that overruns closing time
  is refused while one that ends exactly at closing is accepted.
- Integration tests against real PostgreSQL for the race that the domain cannot
  cover: two concurrent overlapping inserts, one of which comes back as
  `SCHEDULING_CONFLICT` and not a 500.
- A unit test for `isExclusionViolation` against the `DrizzleQueryError` shape,
  because the obvious implementation reads `error.code` and returns `undefined`
  for every real violation.
