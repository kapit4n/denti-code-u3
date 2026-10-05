-- Denti-Code U3 — a visit is linked to its appointment, and belongs to its clinic.
--
-- Three declarations in the Milestone 1 schema turned out to be promises the code was
-- not keeping, and starting a visit is what made them matter (ADR 0021).
--
-- `visits.appointment_id` carried a unique index and no foreign key. The index is
-- there to say "an appointment becomes a visit exactly once", and it was enforcing
-- that against a column free to name an appointment that does not exist. The two
-- references now point at each other: this one at `appointments.id`, and
-- `appointments.visit_id` at `visits.id`. The pair is circular, which PostgreSQL
-- allows and which the insertion order respects — the visit is written first, so the
-- appointment never names a row that has not been created.
--
-- Both are `ON DELETE RESTRICT`. The friendly alternative, `set null`, produces exactly
-- the two states this schema exists to prevent: an appointment marked `IN_TREATMENT`
-- whose visit has gone, and a treated visit that now reads as a walk-in because its
-- booking was deleted. An appointment with a visit is cancelled, not deleted; a visit
-- is reopened, not deleted.
--
-- The other three references were by id alone, where `appointments` was given
-- composite `(id, clinic_id)` keys in migration 0002. A key on the id proves the row
-- exists and says nothing about *whose* it is, so a visit could hold another clinic's
-- patient — a real patient id, so the constraint was satisfied — and the visit
-- workspace would show one clinic's treatment in another's chart. ADR 0014's answer
-- applies unchanged: the rule is one the database can enforce, so it is enforced here.
--
-- `patient_id` keeps `ON DELETE RESTRICT` — a visit is a clinical fact and is not
-- erased by removing a patient record, which is anonymised instead. The dentist and
-- the chair need `ON DELETE SET NULL (column)` for the reason migration 0002 sets out:
-- without the column list, deleting a dentist would try to null `clinic_id` too and the
-- row would be refused by its own NOT NULL, so a clinician could never leave a clinic
-- that has treated patients behind them. That form is PostgreSQL 15+;
-- docker-compose.yml pins 17.
--
-- The single-column keys being replaced are dropped in the same transaction that adds
-- their replacements, so the table is never left without tenant isolation. The
-- statements are ordered to do that: three DROPs, then the two new visit links, then
-- the three tenant keys.
--
-- Three hand-edits to the generated statements, all mechanical and all described in
-- migration 0002:
--
--   * the file was renamed from Drizzle Kit's random name to describe the change;
--   * the two nullable references were rewritten to the column-list form of
--     `ON DELETE SET NULL`;
--   * this header replaced Drizzle's.

ALTER TABLE "visits" DROP CONSTRAINT "visits_patient_id_patients_id_fk";--> statement-breakpoint
ALTER TABLE "visits" DROP CONSTRAINT "visits_dentist_id_dentists_id_fk";--> statement-breakpoint
ALTER TABLE "visits" DROP CONSTRAINT "visits_chair_id_chairs_id_fk";--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_patient_same_clinic_fk" FOREIGN KEY ("patient_id","clinic_id") REFERENCES "public"."patients"("id","clinic_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_dentist_same_clinic_fk" FOREIGN KEY ("dentist_id","clinic_id") REFERENCES "public"."dentists"("id","clinic_id") ON DELETE set null (dentist_id) ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_chair_same_clinic_fk" FOREIGN KEY ("chair_id","clinic_id") REFERENCES "public"."chairs"("id","clinic_id") ON DELETE set null (chair_id) ON UPDATE no action;
