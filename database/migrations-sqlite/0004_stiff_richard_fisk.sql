DROP INDEX `odontogram_patient_tooth_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `odontogram_patient_tooth_unique` ON `odontogram_entries` (`patient_id`,`tooth`);