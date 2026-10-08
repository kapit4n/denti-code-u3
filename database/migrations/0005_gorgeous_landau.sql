DROP INDEX "odontogram_patient_tooth_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "odontogram_patient_tooth_unique" ON "odontogram_entries" USING btree ("patient_id","tooth");