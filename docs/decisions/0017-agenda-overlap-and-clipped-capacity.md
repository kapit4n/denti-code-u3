# ADR 0017 — The agenda filters by overlap, and capacity counts only minutes inside the day

- Status: Accepted
- Date: 2026-10-03
- Decides: which appointments a window contains, and whose minutes it counts
- Related: ADR 0001 (appointment overlap guard), ADR 0012 (end time is computed), ADR 0014 (clinic scoping)

## Context

The agenda needs one query: which appointments belong on screen for a window of
time. Before the agenda existed, the dashboard answered a version of that question
for itself with `starts_at >= from AND starts_at < to`, and no calendar read the
clinic's book at all.

Two interval questions have to be answered once, in one place, or the dashboard and
the calendar will disagree in front of a patient.

1. Does an appointment belong in a window?
2. How many of its minutes belong to that window?

The database already answers (1) for booking safety, using half-open ranges
`[starts_at, appointment_ends_at(starts_at, duration_minutes))` — so a 09:00–09:30
and a 09:30–10:00 appointment for one chair are legal (ADR 0001). An agenda that
used a different interval would show a slot the database then refuses to book.

## Decision

**An appointment is in the window when the two intervals overlap**, compared with
the same half-open interval the exclusion constraints use:

```sql
tstzrange(starts_at, appointment_ends_at(starts_at, duration_minutes), '[)')
  && tstzrange($from, $to, '[)')
```

**An appointment's minutes are counted against a window only where they fall
inside it**: `min(ends_at, to) - max(starts_at, from)`.

The dashboard's booked minutes and occupancy rate use that clipped figure. The
dashboard's appointment count uses the full entry list, so an appointment in
progress at midnight is counted as today's work.

## Consequences

**A booking that runs past midnight appears on both days' agendas.** It is correct
that it does — at 00:15 the dentist is still with the patient, and a calendar that
omits the block is lying about who is in the chair.

**The same booking is therefore counted as an appointment on two days.** Clinic-wide
totals summed across days would double-count it. This is accepted for now because
no such report exists yet, and the fix when one does is to count by `starts_at` for
that report specifically.

**Occupancy cannot exceed 100% because of a booking that began yesterday.** This is
the reason for clipping rather than summing `duration_minutes`. Summing durations
would have charged eight hours of yesterday's surgery against today's eight hours of
capacity and reported a day as 200% booked while the chairs were half empty.

**The dashboard's semantics changed, deliberately.** Before, an appointment in
progress at midnight was absent from today's book. That was a bug, not a contract:
`apps/api/test/dashboard-book.integration.test.ts` pins the new behaviour down, and
the response _shapes_ the UI reads (`firstName`/`lastName`, `durationMinutes`) were
left exactly as they were.

**Cancelled and no-show appointments are returned.** They were on the calendar, and
a receptionist needs to see that a slot is deliberately empty rather than free.
Whether a status _reserves_ a slot remains `reservesSchedulingSlot`'s question
(ADR 0001), not the listing's.

## Alternatives rejected

**Filter on `starts_at`, as the dashboard did.** Simpler, and matches how a day is
usually counted. Rejected because it hides work in progress at the start of the day,
and because it is not the interval the database enforces.

**Summing whole durations, the dashboard's previous behaviour.** Rejected because it
reports capacity that does not exist, and the error is invisible on any day without
a booking crossing midnight.

**Letting the dashboard keep its own query.** Rejected: two implementations of "today"
drift, and one of them would have been the one nobody looked at again.
