-- Denti-Code U3 — appointments may only reference their own clinic.
--
-- `appointments` referenced its patient, dentist, room and chair by id alone. A
-- foreign key on the id proves the row exists; it says nothing about *whose* it
-- is. So clinic A's book could hold an appointment for clinic B's patient — a real
-- patient id, so the constraint was satisfied — and the agenda's join would put
-- another clinic's patient name on clinic A's screen. The API's clinic scoping
-- (ADR 0014) cannot close this: it is a rule about which rows may be combined,
-- and the combination happens in a table.
--
-- Each reference becomes a composite foreign key over `(id, clinic_id)`, and each
-- referenced table gets the matching UNIQUE constraint to point at. The rule is
-- now "an appointment's patient, dentist, chair and room belong to its own
-- clinic", enforced by PostgreSQL on every write from every code path, rather
-- than by a check that the next contributor has to remember.
--
-- The three nullable references need `ON DELETE SET NULL (column)` rather than
-- plain `ON DELETE SET NULL`. Without the column list, deleting a dentist would
-- try to null `clinic_id` as well, and the row would be refused by its own NOT
-- NULL — a dentist could never leave a clinic that has appointments behind them.
-- The column-list form is PostgreSQL 15+; docker-compose.yml pins 17.
--
-- `patient_id` keeps `ON DELETE RESTRICT`: an appointment is a clinical fact and
-- is not erased by removing a patient record, which is anonymised instead.
--
-- Three hand-edits to the generated statements, all of them mechanical:
--
--   * the file was renamed from Drizzle Kit's random name to describe the change;
--   * the statements were reordered so the four UNIQUE constraints come first.
--     PostgreSQL validates a foreign key's target when the key is added, so the
--     columns it points at must already be unique — and Drizzle emits the keys
--     before the constraints they reference;
--   * the three nullable references were rewritten to the column-list form of
--     `ON DELETE SET NULL`, explained above.

ALTER TABLE "patients" ADD CONSTRAINT "patients_id_clinic_uq" UNIQUE("id","clinic_id");--> statement-breakpoint
ALTER TABLE "dentists" ADD CONSTRAINT "dentists_id_clinic_uq" UNIQUE("id","clinic_id");--> statement-breakpoint
ALTER TABLE "chairs" ADD CONSTRAINT "chairs_id_clinic_uq" UNIQUE("id","clinic_id");--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_id_clinic_uq" UNIQUE("id","clinic_id");--> statement-breakpoint
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_patient_id_patients_id_fk";--> statement-breakpoint
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_dentist_id_dentists_id_fk";--> statement-breakpoint
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_room_id_rooms_id_fk";--> statement-breakpoint
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_chair_id_chairs_id_fk";--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_same_clinic_fk" FOREIGN KEY ("patient_id","clinic_id") REFERENCES "public"."patients"("id","clinic_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_dentist_same_clinic_fk" FOREIGN KEY ("dentist_id","clinic_id") REFERENCES "public"."dentists"("id","clinic_id") ON DELETE set null (dentist_id) ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_room_same_clinic_fk" FOREIGN KEY ("room_id","clinic_id") REFERENCES "public"."rooms"("id","clinic_id") ON DELETE set null (room_id) ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_chair_same_clinic_fk" FOREIGN KEY ("chair_id","clinic_id") REFERENCES "public"."chairs"("id","clinic_id") ON DELETE set null (chair_id) ON UPDATE no action;
