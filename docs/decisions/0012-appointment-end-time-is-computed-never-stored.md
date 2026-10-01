# ADR 0012 — The appointment end time is computed, never stored

- Status: Accepted
- Date: 2026-10-01
- Decides: how the database enforces "one dentist, one chair, one room, one place at a time"

## Context

An appointment occupies a half-open time range `[starts_at, starts_at + duration)`.
Nothing in the domain ever needs a stored end time: it is always derived. But
something has to compute that range inside PostgreSQL for a database constraint to
compare it, and that turns out to be the whole problem.

The obvious formulation is a generated column:

```sql
alter table appointments
  add column ends_at timestamptz
  generated always as (starts_at + duration_minutes * interval '1 minute') stored;
```

It fails. PostgreSQL requires a generated column's expression to be `IMMUTABLE`,
and `timestamptz + interval` is `STABLE`, because a days or months component is
resolved against the session time zone. PostgreSQL will not weaken that check for
you.

The second formulation is a physical column maintained by a trigger:

```sql
create function appointments_set_ends_at() returns trigger as $$
begin
  new.ends_at := new.starts_at + (new.duration_minutes * interval '1 minute');
  return new;
end;
$$ language plpgsql;
```

This works, and it was shipped and integration-tested. It was also wrong in a way
that only shows up later: the Drizzle schema could not honestly declare the column.

Drizzle's only way to declare "this column exists but is not written by the
application" is `generatedAlwaysAs`, and that makes Drizzle Kit emit a
`GENERATED ALWAYS AS` clause — which PostgreSQL rejects here for exactly the
original reason. So the column had to stay invisible to the schema, and an
invisible column is not a fact anyone can rely on. `drizzle-kit push` reads the
live table, finds a column no schema file declares, and offers to drop it. The
mechanism protecting the clinic's schedule would have been the thing removed.

## Decision

Keep the range derived and store nothing. Make the expression immutable explicitly
and call it from the constraint:

```sql
create function appointment_ends_at(starts_at timestamptz, duration_minutes int)
returns timestamptz language sql immutable as
$$ select starts_at + (duration_minutes * interval '1 minute') $$;

alter table appointments
  add constraint appointments_dentist_no_overlap
  exclude using gist (
    dentist_id with =,
    tstzrange(starts_at, appointment_ends_at(starts_at, duration_minutes), '[)') with &&
  )
  where (dentist_id is not null and status not in ('CANCELLED', 'NO_SHOW'));
```

The same function is used for the chair and room constraints. `btree_gist` is
required so a plain `uuid` can be compared inside a GiST index.

`IMMUTABLE` is an honest promise here and only here: adding a number of minutes to
a `timestamptz` is absolute arithmetic that never consults the session time zone.
A day, month or year component would be time-zone dependent, which is exactly why
`appointment_ends_at` takes `duration_minutes` and nothing else. That constraint is
stated in a `comment on function` where the next reader will find it.

## Consequences

- The Drizzle schema is now the complete physical picture of the database. Nothing
  in a migration is undeclared, and `drizzle-kit push` has nothing to remove.
  Verified: `drizzle-kit generate` reports "No schema changes, nothing to migrate"
  against a freshly migrated database.
- There is no stored end time, so there is nothing that can go stale. A reschedule
  that changes `starts_at` or `duration_minutes` is re-checked by the constraint on
  the same statement, which is proven by a test that tries to move an appointment
  into an occupied slot and asserts the update is rejected.
- Queries that want the end time call the function. `appointmentEndsAtSql` in
  `database/schema/appointment.ts` exports that call so no query hand-rolls the
  arithmetic and drifts from the constraint.
- The function must exist before any query or constraint uses it, so it is created
  in the same migration that adds the constraints. It is not optional infrastructure.
- If a future PostgreSQL inlines `language sql` functions into index expressions,
  this migration fails loudly at DDL time with an immutability error rather than
  degrading silently. That is the failure mode we want.

## Alternatives considered

- **Keep the trigger and the column.** Rejected: requires an undeclared column, and
  the first `push` against a developer's database threatens to drop it.
- **Store `ends_at` and let the application write it, with a CHECK constraint
  enforcing `ends_at = starts_at + duration`.** Rejected: honest schema, but it
  gives two authorities for the same value, and every writer — including a future
  bulk import — has to supply it. A CHECK constraint rejects wrong values but cannot
  compute them, so a `psql` insert without the column fails on `NOT NULL` instead of
  working.
- **Enforce overlap in application code only, or with advisory locks.** Rejected:
  both leave a window between the check and the write. The rule protects a real
  clinic schedule; it belongs where two simultaneous writers cannot both win.
