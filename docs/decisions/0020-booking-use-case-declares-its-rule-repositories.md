# ADR 0020 — A booking use case cannot be wired without the repositories its rules read

## Status

Accepted.

## Context

The clinic was asked a question about the booking form and answered it plainly: may
an appointment be booked with a dentist or a chair that is marked inactive? No.

The code disagreed with the answer, silently. `createAppointment` never read
`isActive`. The two read endpoints added for the booking form
(`GET /api/v1/dentists`, `GET /api/v1/chairs`) return it and enforce nothing, so the
only thing preventing a booking with a clinician who has left was a client that
happened to hide the row. That is a rule living in the browser, which is the one
place this project refuses to keep rules (ADR 0004, ADR 0018).

Writing the rule is the easy half. The half worth an ADR is how it is _wired_, because
there was a plausible way to add it that leaves the hole exactly as it was.

`AppointmentWriteDependencies` is one object holding everything the three write use
cases need. Adding the resource repositories to it has three shapes:

1. **Required on the shared interface.** Every write, including the status
   transition, is handed `dentists` and `chairs` and uses neither.
2. **Optional (`dentists?`).** The route passes them, and a route that forgot would
   compile. Inside the rule, `if (dentists)` quietly becomes "check the rule when
   someone remembered to wire the repository that answers it".
3. **Two interfaces** — the four every write needs, and a wider one for the use cases
   that name a resource.

Option 1 is honest but gives `transitionAppointmentStatus` two doors it never opens,
and a reader has to work out why. Option 2 is the one to avoid: it makes the
enforcement of a business rule depend on a call site nobody is thinking about, and
the failure mode is a clinic booking a departed clinician with no error anywhere.

There is a precedent for exactly this mistake, and it is in this repository. The
appointment port declared five methods in Milestone 1 that no table could satisfy and
no caller needed; they were deleted in session 13 rather than implemented. A port that
promises what nothing needs is a promise the first implementer has to keep or break
loudly. A dependency that is optional is the same failure with the volume turned down:
the code says the rule is possible, and nothing says it ran.

## Decision

**The use case that enforces a rule declares the repositories that rule reads, and
they are required.**

`AppointmentWriteDependencies` keeps the four repositories every write needs
(`appointments`, `clinics`, `newId`). `AppointmentBookingDependencies` extends it with
`dentists` and `chairs` and is the parameter type of `createAppointment` and
`rescheduleAppointment`. `transitionAppointmentStatus` takes the narrower one,
because a status transition names no clinician and no chair and therefore has nothing
to ask.

The consequences, which are the point:

- **Forgetting is a type error.** `registerAppointmentsRoutes` cannot be constructed
  without them, so the two integration harnesses that had to change were caught by
  `tsc` rather than by a production booking. That is what happened when this change
  was made: three type errors in three files, all of them the compiler asking the
  right question.
- **No test can silently opt out.** A test that builds the appointment routes has to
  name the repositories. A rule with no dependency has no way to run.
- **The rule has one place to live.** `bookable-resources.ts` names
  `BookableResourceReader`, so the rule reads two repositories and cannot acquire a
  third without the argument type changing.

## What this costs, stated plainly

- **One interface per use-case shape instead of one for the feature.** Six interfaces
  for three functions was the alternative; two is what the three functions actually
  need.
- **A domain error code per refusal, or the log lies.** `UNBOOKABLE_RESOURCE` joins
  `OUTSIDE_OPERATING_HOURS` and `SCHEDULING_CONFLICT` as a specific reason that the
  API folds into `DOMAIN_RULE_VIOLATION` on the wire. A log line saying `INVALID_INPUT`
  for a booking that named a real, existing, deactivated clinician sends whoever reads
  it looking for a malformed body.
- **A reschedule of an appointment whose clinician was deactivated afterwards is
  refused.** The names checked are the ones the booking will have _after_ the move.
  The alternative — "you may keep a name you already used, but not introduce a new
  one" — makes an inactive clinician permanently bookable to anyone who books once
  and then only drags, cannot be explained to a receptionist in one sentence, and
  needs the existing row in hand to evaluate at all. The clinic pays for this by
  reassigning the appointment, which is what it would have to do anyway.
- **A reference that does not exist is not answered here.** `findById` cannot tell an
  absent id from another clinic's, and must not (ADR 0014). So the rule stays silent
  for a name it cannot find and the tenant foreign keys answer as a 422. Two rules for
  one bad reference means two answers, and the second would be the wrong one.

## Alternatives considered

- **Enforce it in the route.** Rejected: the rule would hold for the web app and not
  for the desktop app, an import script or a `curl`. That is the browser rule again,
  one layer up.
- **Enforce it in the repository's `insert`.** Rejected: the repository answers "did
  this row write", not "is this booking allowed". A rule nobody reads in a persistence
  class is the definition of a hidden rule.
- **Enforce it only in the booking form, plus a comment.** Rejected: the comment is
  the only thing a second client gets.
- **Make `isActive` a database constraint** (a trigger, or a partial unique index). Not
  possible in general — the constraint would have to know that an appointment exists
  for that clinician, which is a cross-table rule and therefore a domain rule. The
  exclusion constraints stay for what they can enforce (ADR 0018); this is checked by
  the domain and cannot be deferred to the database.
