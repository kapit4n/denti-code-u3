-- Denti-Code U3 — tenant keys complete their `ON DELETE SET NULL` (SQLite).
--
-- The twin of the three column-list actions in
-- `database/migrations/0002_appointment_tenant_foreign_keys.sql` and
-- `database/migrations/0003_visit_links_and_tenant_keys.sql`. Read those first;
-- they state why the reference is composite over `(id, clinic_id)` and why a
-- nullable one is `ON DELETE SET NULL` rather than `RESTRICT`. This file only
-- explains why SQLite needs triggers to do what PostgreSQL does in the key.
--
-- THE GAP
--
-- PostgreSQL 15 added a column list to the action:
--
--     ON DELETE SET NULL (dentist_id)
--
-- which says "when the dentist goes, null `dentist_id` and nothing else".
-- SQLite has no such syntax: `ON DELETE SET NULL` on a composite key nulls
-- **every** column in the key. So deleting a dentist would null `dentist_id`
-- *and* `clinic_id` in each appointment behind it, and the row would be refused
-- by its own `NOT NULL` — a clinician could never leave a clinic that has
-- appointments behind them. The action is worse than useless here; it is an
-- accidental hard block on a routine operation.
--
-- THE FIX
--
-- A `BEFORE DELETE` trigger on the *referenced* table clears only the
-- referencing column, before the row goes away. By the time SQLite evaluates
-- the foreign key, nothing points at the row any more, so the key's own action
-- has nothing to do — which is exactly right, and means the key and the trigger
-- cannot fight. The `ON DELETE SET NULL` stays in the DDL as documentation of
-- intent, and as the behaviour for any future single-column reference, which
-- SQLite handles natively without help.
--
-- Only the five **composite** nullable references need this:
--
--     dentists -> appointments.dentist_id, visits.dentist_id
--     chairs   -> appointments.chair_id,   visits.chair_id
--     rooms    -> appointments.room_id
--
-- Every other nullable reference in the schema (`treatment_plans.dentist_id`,
-- `prescriptions.dentist_id`, `chairs.room_id`, `dentists.user_id`,
-- `invoices.created_by`, `payments.received_by`,
-- `stock_movements.performed_by`, `charges.visit_id`, …) is a single column and
-- needs no help. `patients` is `RESTRICT` on both engines — a visit and an
-- appointment are clinical facts and are not erased with the person record,
-- which is anonymised instead — so there is nothing to null there.
--
-- WHY `BEFORE` AND NOT `AFTER`
--
-- `AFTER` would run after SQLite has already evaluated the key, so the delete
-- would fail before the trigger ever got its turn. `BEFORE` runs first, clears
-- the references, and leaves the key a trivial no-op.
--
-- Two behaviours worth knowing about, neither of which is a hazard:
--
--   * Setting `dentist_id = NULL` fires the appointment overlap triggers from
--     migration 0001. They are `WHEN NEW.dentist_id IS NOT NULL`, so they do
--     nothing — an appointment with no dentist cannot overlap on a dentist, and
--     clearing the reference is not a scheduling change.
--
--   * `updated_at` is deliberately not bumped. This is the database restoring a
--     reference, not somebody editing the appointment, and the PostgreSQL side
--     does not bump it either: a foreign key action is not a write by a user.

CREATE TRIGGER dentists_delete_releases_appointments
BEFORE DELETE ON dentists
FOR EACH ROW
BEGIN
  UPDATE appointments SET dentist_id = NULL WHERE dentist_id = OLD.id;
  UPDATE visits SET dentist_id = NULL WHERE dentist_id = OLD.id;
END;
--> statement-breakpoint

CREATE TRIGGER chairs_delete_releases_appointments
BEFORE DELETE ON chairs
FOR EACH ROW
BEGIN
  UPDATE appointments SET chair_id = NULL WHERE chair_id = OLD.id;
  UPDATE visits SET chair_id = NULL WHERE chair_id = OLD.id;
END;
--> statement-breakpoint

CREATE TRIGGER rooms_delete_releases_appointments
BEFORE DELETE ON rooms
FOR EACH ROW
BEGIN
  UPDATE appointments SET room_id = NULL WHERE room_id = OLD.id;
END;
