# ADR 0024 — A walk-in is its own door, and the tenant foreign keys answer for it

- Status: accepted
- Date: 2026-10-06
- Decides: whether a walk-in is `POST /api/v1/visits` with a sparse body or its own
  endpoint, what a walk-in may omit, how it behaves when it names a reference this
  clinic does not hold, and why it writes one row.
- Related: [0021](0021-starting-a-visit-writes-two-rows.md) (the door the walk-in is
  not), [0022](0022-completing-a-visit-is-its-own-act.md) (the one-row precedent),
  [0014](0014-clinic-scoping-is-explicit.md) (a reference another clinic holds does
  not exist).

## Context

Session 21 added the visit write side as a single door: `POST /api/v1/visits` reads an
appointment and takes the patient, the clinician and the chair from it. The walk-in —
a patient who arrives with no booking — was deliberately deferred there, because it is
**a different request**. `startVisit` has no body that can disagree with the booking it
came from; a walk-in has no appointment to read, so the patient, the clinician and the
chair are the caller's to say.

The next question was how the request should look, and the tempting answer was wrong in
a way worth writing down: `POST /api/v1/visits` with the three named fields optional
alongside the `appointmentId` one. The bridge would then need a rule for every mix the
body can express — appointment _and_ patient, appointment _and_ no patient, walk-in
with and without a chair — and every one of those rules would be a second answer for a
question the domain has one answer for.

## Decision 1 — A second endpoint, not a sparse union body

`POST /api/v1/visits/walk-in`, a sibling of `POST /api/v1/visits`.

Two doors, because two requests. The appointment door takes one field and reads the
rest from the booking; the walk-in door takes the three named fields itself. Each
schema says what its request is, and no schema has to state a rule about a combination
that cannot be expressed. This is the same argument ADR 0018 made for refusing to
accept a room the write side could not report: a request shape carries its meaning, and
the meaning shows in what the schema says rather than what it omits.

## Decision 2 — The clinician is required; the chair is optional

The same rule as the appointment door, decided the same way (ADR 0021 §5): a visit
exists to record treatment, treatment is attributable to a clinician, and attributing
a treatment to nobody is not a record. The column is nullable because a clinician may
_leave_ an existing visit — a fact about the future of a row, not an invitation to
create one without a name. A walk-in that could skip the clinician would give two
answers to "who treated this patient", decided by which button the receptionist
pressed.

The chair is optional for the same reason it is optional on a booking: a walk-in is
seated when a chair is free, and no chair means "has not been chosen yet", not "in a
chair that is out of service" — the latter is what the bookable-resource rule refuses
below.

The walk-in takes `startedAt` from the clock, never from the request: a client cannot
file a walk-in that started last Tuesday, and there is no booked time to fall back on —
for a walk-in, the present _is_ the start time.

## Decision 3 — The bookable-resource rule runs, unchanged from the booking

`assertResourcesAreBookable` — the same rule, the same message, the same
`UNBOOKABLE_RESOURCE` (409) — answers for the clinician the walk-in names. Product
question 17 applies to whoever is named for care about to happen, whichever door opened.

The appointment bridge does **not** run it, and the asymmetry is deliberate: the bridge
reads a booking, and a booking already named its clinician and chair through the same
rule at booking time. The walk-in has no booking to read, so it is where the rule runs.
Two doors, two code paths, one rule.

The rule runs **before** the id is allocated, so a walk-in refused for a clinician who
left consumes no number a real visit will need.

## Decision 4 — No patient read; the tenant foreign keys are the answer

The walk-in does not read the patient first — exactly as the bridge does not (ADR
0014). Whether the id names a real patient of this clinic is the composite tenant
foreign key's answer, and for a request scoped to one clinic the answer does not
distinguish "no such patient" from "a patient of another clinic".

The cost is that the refusal arrives at the database, and this repository now
translates it: a `23503` foreign-key violation becomes `INVALID_INPUT` with "That
patient, dentist or chair is not in this clinic", and the error handler turns that
into the same envelope the schema's own refusal uses (422). Without the translation
the walk-in's most common mistake — a patient id from the wrong clinic — would arrive
as a `500` with a request id, which is what ADR 0021's `DUPLICATED_RECORD` translation
was for a different mistake: a refusal the domain can see only once the two writers are
visible to each other. Detection is one helper (`isForeignKeyViolation` in
`postgres-error.ts`), shared with the two repositories that have tenant keys.

## Decision 5 — One row, so no `UnitOfWork`

A walk-in writes a visit and nothing else: no appointment, no moved status. `startVisit`
takes a transaction because it writes a visit _and_ moves an appointment (ADR 0021);
a seam given two repositories is one refactor from writing them separately. One row has
nothing to make atomic, so the walk-in is handed the repositories directly — the same
argument ADR 0022 made for the two closing use cases, arriving at the same place from
the other side.

A walk-in also creates **no appointment at all**, and the visible cost is stated rather
than hidden: it does not appear on the agenda and is not counted by the dashboard's
`inTreatment` total, because both read the book and a walk-in is not in it. The clinical
record is where it lives — the patient's timeline shows it as a first-class visit with no
`appointmentId`.

No `appointmentId` key at all, rather than `null`: the repository writes the column only
when the key is present, so "this visit has no booking behind it" is spelled exactly the
way the bridge's absence of one is.

## Decision 6 — No second-open-visit rule, for now

A patient cannot be in two chairs at once, and the rule "no two open visits for the same
patient" may well be right. It was **not** shipped here, on the boundary's own rule: it
applies to _both_ doors, the appointment door shipped without it (session 23), and adding
it to the walk-in alone would make the two doors disagree. Adding it is a product rule,
so it is product question 19. Until it is answered, two open visits are allowed.

## Consequences

- `packages/domain` has `startWalkInVisit`, a true second door: `WalkInVisitRequest`,
  one write, and no new rules except the shared one it already had to name.
- `DrizzleVisitRepository.save` now translates tenant foreign-key violations so both
  creation doors fail the same way the domain rules do.
- `VisitsDependencies` requires the dentist and chair repositories, and app wiring
  passes the same instances the agenda's filters and the booking rule use — one
  question, one implementation.
- The fixture lesson from session 25 was honoured: the inactive clinician and chair a
  route test inserts are in its teardown, and a colleague's suite three files over will
  not meet them.
- Nothing here is a UI; the e2e count does not move. `findOpenForPatient` remains
  without a caller, exactly as ADR 0023 left it.
