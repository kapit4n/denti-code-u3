-- Denti-Code U3 — appointment overlap guard.
--
-- The scheduling rule ("a dentist cannot be in two places at once") must hold no
-- matter which code path creates an appointment. Application checks in
-- `packages/domain` produce a friendly 409, but they cannot stop a race between
-- two simultaneous requests. These exclusion constraints are the real guard:
-- PostgreSQL itself refuses the second overlapping write.
--
-- The end of an appointment is **not stored**. `starts_at + duration_minutes` is
-- the single truth, so a reschedule can never leave a stale end time behind and
-- the agenda can never show two different answers for one appointment.
--
-- Storing it was tried first, as a generated column, and then as a column kept
-- in sync by a trigger. Both failed for the same underlying reason:
-- `timestamptz + interval` is STABLE, not IMMUTABLE, and PostgreSQL demands an
-- IMMUTABLE expression in a generated column *and* in an index expression. A
-- trigger can work around that, but it leaves the database holding a column no
-- schema file declares — so `drizzle-kit push` reads the live table, sees an
-- undeclared column, and offers to drop the very thing that protects the
-- clinic's schedule.
--
-- The fix is to make the expression immutable explicitly instead of storing its
-- result:
--
--   * `appointment_ends_at` is declared IMMUTABLE. That is an honest promise for
--     a minutes-only offset: adding 30 minutes to a timestamptz is absolute
--     arithmetic and never consults the session time zone. A days or months
--     component would NOT be immutable, and must never be passed here.
--
--   * The constraints call the function instead of reading a column, so the
--     range is derived from the row itself and there is nothing to keep in sync.
--
--   * `pg_get_expr` on the resulting index shows a call to the function rather
--     than the inlined body. If a future PostgreSQL ever does inline it, this
--     migration fails loudly at DDL time instead of degrading silently.

-- btree_gist gives GiST indexes the ability to compare uuid = uuid, which plain
-- GiST cannot do.
create extension if not exists btree_gist;

create function appointment_ends_at(starts_at timestamptz, duration_minutes int)
returns timestamptz language sql immutable as
$$ select starts_at + (duration_minutes * interval '1 minute') $$;

comment on function appointment_ends_at(timestamptz, int) is
  'End of an appointment. IMMUTABLE is valid only for the minutes component: a day or month offset depends on the session time zone and must never be used here.';

-- Half-open ranges '[)' so a 09:00-09:30 and a 09:30-10:00 appointment may
-- touch. Cancelled and no-show appointments release the slot.
alter table appointments
  add constraint appointments_dentist_no_overlap
  exclude using gist (
    dentist_id with =,
    tstzrange(starts_at, appointment_ends_at(starts_at, duration_minutes), '[)') with &&
  )
  where (dentist_id is not null and status not in ('CANCELLED', 'NO_SHOW'));

alter table appointments
  add constraint appointments_chair_no_overlap
  exclude using gist (
    chair_id with =,
    tstzrange(starts_at, appointment_ends_at(starts_at, duration_minutes), '[)') with &&
  )
  where (chair_id is not null and status not in ('CANCELLED', 'NO_SHOW'));

alter table appointments
  add constraint appointments_room_no_overlap
  exclude using gist (
    room_id with =,
    tstzrange(starts_at, appointment_ends_at(starts_at, duration_minutes), '[)') with &&
  )
  where (room_id is not null and status not in ('CANCELLED', 'NO_SHOW'));

-- The agenda reads one dentist's day; this partial index serves it directly and
-- is independent of the overlap guard.
create index appointments_dentist_starts_at_status_idx
  on appointments (clinic_id, dentist_id, starts_at)
  where status not in ('CANCELLED', 'NO_SHOW');