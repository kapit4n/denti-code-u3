-- Denti-Code U3 — appointment overlap guard (SQLite).
--
-- The twin of `database/migrations/0001_appointment_overlap_guard.sql`. The
-- rule is the same one and it is just as absolute: a dentist cannot be in two
-- places at once, and the database — not the request that happens to be running
-- — is what refuses the second write. Read that file first; this one only
-- explains the substitution.
--
-- PostgreSQL expresses the rule with `EXCLUDE USING gist`. SQLite has no
-- exclusion constraints at all, so the same three guards become `BEFORE INSERT`
-- and `BEFORE UPDATE` triggers on `appointments`. Three of them — one dentist,
-- one chair, one room — because those are the three resources the exclusion
-- constraints name, and no more, because a guard that checks something the
-- PostgreSQL side does not check is not parity, it is a second rule waiting to
-- be forgotten.
--
-- WHY THE END TIME IS `starts_at + duration_minutes * 60000`
--
-- This is the same decision that produced ADR 0012 on PostgreSQL, reached more
-- easily here. There the end could not be a generated column because
-- `timestamptz + interval` is STABLE and PostgreSQL demands IMMUTABLE; here
-- `integer + integer * 60000` is plainly immutable, and SQLite does not ask.
-- But we do not need it to be a column either: it is arithmetic on the row that
-- is already being checked, written inline in the predicate. There is nothing
-- to keep in sync, no generated column to declare, and no schema file that
-- disagrees with what the guard enforces.
--
-- Integer milliseconds also make the comparison exact. There is no rounding, no
-- time zone, and no `STABLE`-versus-`IMMUTABLE` question to answer — which is
-- precisely why the PostgreSQL file had to introduce a SQL function and this one
-- does not.
--
-- HALF-OPEN INTERVALS, CANCELLED SLOTS, AND SELF-EXCLUSION
--
--   * The comparison is `a_start < b_end AND a_end > b_start`, which is the
--     half-open `[)` interval the PostgreSQL constraints express with
--     `tstzrange(..., '[)')`. A 09:00–09:30 and a 09:30–10:00 appointment may
--     touch; they may not overlap.
--
--   * `status NOT IN ('CANCELLED', 'NO_SHOW')` is evaluated on **both** sides,
--     because the PostgreSQL constraint uses a `WHERE` clause that makes it a
--     *partial* index: cancelled appointments are simply not in the structure
--     the conflict is searched in. Here they are filtered by the sub-query for
--     the same reason — a cancelled slot does not hold the slot.
--
--   * The INSERT trigger needs no self-exclusion: the row it is checking does
--     not exist yet, so it cannot be found by the sub-query. The UPDATE trigger
--     does need it (`id <> NEW.id`), because the row being updated is still
--     there with its old values. Writing `id <> NEW.id` on the INSERT side as
--     well would be a real bug rather than harmless: if the id comes from the
--     column default, a BEFORE INSERT trigger may not see it yet, and the
--     comparison would be `x <> NULL`, which is NULL, which filters every row
--     and silently disables the guard. So the two triggers are written
--     differently on purpose.
--
-- HOW A VIOLATION IS REPORTED
--
-- `RAISE(ABORT, ...)` fails the statement and rolls back only that statement's
-- changes, leaving the surrounding transaction alive — the same scope as a
-- PostgreSQL exclusion violation, and what lets the API answer 409 instead of
-- losing the transaction. The message text is matched by the API's constraint
-- translator; keep it in sync with the other engine's error mapping.

CREATE TRIGGER appointments_dentist_no_overlap_insert
BEFORE INSERT ON appointments
FOR EACH ROW
WHEN (
  NEW.dentist_id IS NOT NULL
  AND NEW.status NOT IN ('CANCELLED', 'NO_SHOW')
  AND EXISTS (
    SELECT 1 FROM appointments
    WHERE dentist_id = NEW.dentist_id
      AND status NOT IN ('CANCELLED', 'NO_SHOW')
      AND starts_at < (NEW.starts_at + NEW.duration_minutes * 60000)
      AND (starts_at + duration_minutes * 60000) > NEW.starts_at
  )
)
BEGIN
  SELECT RAISE(ABORT, 'appointment overlaps another appointment for this dentist');
END;
--> statement-breakpoint

CREATE TRIGGER appointments_dentist_no_overlap_update
BEFORE UPDATE ON appointments
FOR EACH ROW
WHEN (
  NEW.dentist_id IS NOT NULL
  AND NEW.status NOT IN ('CANCELLED', 'NO_SHOW')
  AND EXISTS (
    SELECT 1 FROM appointments
    WHERE id <> NEW.id
      AND dentist_id = NEW.dentist_id
      AND status NOT IN ('CANCELLED', 'NO_SHOW')
      AND starts_at < (NEW.starts_at + NEW.duration_minutes * 60000)
      AND (starts_at + duration_minutes * 60000) > NEW.starts_at
  )
)
BEGIN
  SELECT RAISE(ABORT, 'appointment overlaps another appointment for this dentist');
END;
--> statement-breakpoint

CREATE TRIGGER appointments_chair_no_overlap_insert
BEFORE INSERT ON appointments
FOR EACH ROW
WHEN (
  NEW.chair_id IS NOT NULL
  AND NEW.status NOT IN ('CANCELLED', 'NO_SHOW')
  AND EXISTS (
    SELECT 1 FROM appointments
    WHERE chair_id = NEW.chair_id
      AND status NOT IN ('CANCELLED', 'NO_SHOW')
      AND starts_at < (NEW.starts_at + NEW.duration_minutes * 60000)
      AND (starts_at + duration_minutes * 60000) > NEW.starts_at
  )
)
BEGIN
  SELECT RAISE(ABORT, 'appointment overlaps another appointment for this chair');
END;
--> statement-breakpoint

CREATE TRIGGER appointments_chair_no_overlap_update
BEFORE UPDATE ON appointments
FOR EACH ROW
WHEN (
  NEW.chair_id IS NOT NULL
  AND NEW.status NOT IN ('CANCELLED', 'NO_SHOW')
  AND EXISTS (
    SELECT 1 FROM appointments
    WHERE id <> NEW.id
      AND chair_id = NEW.chair_id
      AND status NOT IN ('CANCELLED', 'NO_SHOW')
      AND starts_at < (NEW.starts_at + NEW.duration_minutes * 60000)
      AND (starts_at + duration_minutes * 60000) > NEW.starts_at
  )
)
BEGIN
  SELECT RAISE(ABORT, 'appointment overlaps another appointment for this chair');
END;
--> statement-breakpoint

CREATE TRIGGER appointments_room_no_overlap_insert
BEFORE INSERT ON appointments
FOR EACH ROW
WHEN (
  NEW.room_id IS NOT NULL
  AND NEW.status NOT IN ('CANCELLED', 'NO_SHOW')
  AND EXISTS (
    SELECT 1 FROM appointments
    WHERE room_id = NEW.room_id
      AND status NOT IN ('CANCELLED', 'NO_SHOW')
      AND starts_at < (NEW.starts_at + NEW.duration_minutes * 60000)
      AND (starts_at + duration_minutes * 60000) > NEW.starts_at
  )
)
BEGIN
  SELECT RAISE(ABORT, 'appointment overlaps another appointment for this room');
END;
--> statement-breakpoint

CREATE TRIGGER appointments_room_no_overlap_update
BEFORE UPDATE ON appointments
FOR EACH ROW
WHEN (
  NEW.room_id IS NOT NULL
  AND NEW.status NOT IN ('CANCELLED', 'NO_SHOW')
  AND EXISTS (
    SELECT 1 FROM appointments
    WHERE id <> NEW.id
      AND room_id = NEW.room_id
      AND status NOT IN ('CANCELLED', 'NO_SHOW')
      AND starts_at < (NEW.starts_at + NEW.duration_minutes * 60000)
      AND (starts_at + duration_minutes * 60000) > NEW.starts_at
  )
)
BEGIN
  SELECT RAISE(ABORT, 'appointment overlaps another appointment for this room');
END;
--> statement-breakpoint

-- The agenda reads one dentist's day. Carried over from the PostgreSQL
-- migration unchanged — SQLite supports partial indexes, and this one is not a
-- guard but a read-path index, independent of the triggers above.
CREATE INDEX appointments_dentist_starts_at_status_idx
  ON appointments (clinic_id, dentist_id, starts_at)
  WHERE status NOT IN ('CANCELLED', 'NO_SHOW');
