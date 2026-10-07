CREATE TABLE `chairs` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (abs(random()) % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`clinic_id` text NOT NULL,
	`room_id` text,
	`name` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chairs_id_clinic_uq` ON `chairs` (`id`,`clinic_id`);--> statement-breakpoint
CREATE TABLE `clinic_operating_hours` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (abs(random()) % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`clinic_id` text NOT NULL,
	`day_of_week` integer NOT NULL,
	`opens_at` text,
	`closes_at` text,
	`break_starts_at` text,
	`break_ends_at` text,
	FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clinic_operating_hours_clinic_day_uq` ON `clinic_operating_hours` (`clinic_id`,`day_of_week`);--> statement-breakpoint
CREATE TABLE `clinics` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (abs(random()) % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`name` text NOT NULL,
	`legal_name` text,
	`tax_id` text,
	`address` text,
	`phone` text,
	`email` text,
	`time_zone` text DEFAULT 'America/Lima' NOT NULL,
	`currency_code` text DEFAULT 'USD' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dentists` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (abs(random()) % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`clinic_id` text NOT NULL,
	`user_id` text,
	`full_name` text NOT NULL,
	`licence_number` text,
	`speciality` text,
	`color` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `dentists_clinic_active_idx` ON `dentists` (`clinic_id`,`is_active`);--> statement-breakpoint
CREATE UNIQUE INDEX `dentists_id_clinic_uq` ON `dentists` (`id`,`clinic_id`);--> statement-breakpoint
CREATE TABLE `role_permissions` (
	`role` text NOT NULL,
	`permission` text NOT NULL,
	PRIMARY KEY(`role`, `permission`)
);
--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (abs(random()) % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`clinic_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rooms_id_clinic_uq` ON `rooms` (`id`,`clinic_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (abs(random()) % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`clinic_id` text NOT NULL,
	`email` text NOT NULL,
	`password_hash` text,
	`full_name` text NOT NULL,
	`role` text DEFAULT 'RECEPTIONIST' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`last_login_at` integer,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "users_role_in_values" CHECK("role" in ('ADMINISTRATOR', 'DENTIST', 'ASSISTANT', 'RECEPTIONIST'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_clinic_email_uq` ON `users` (`clinic_id`,`email`);--> statement-breakpoint
CREATE INDEX `users_clinic_role_idx` ON `users` (`clinic_id`,`role`);--> statement-breakpoint
CREATE TABLE `patients` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (abs(random()) % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`clinic_id` text NOT NULL,
	`record_number` text,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`preferred_name` text,
	`identification_number` text,
	`phone` text,
	`email` text,
	`birth_date` text,
	`address` text,
	`additional_data` text DEFAULT '{}',
	`allergies` text,
	`is_active` integer DEFAULT true NOT NULL,
	`anonymized_at` integer,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `patients_clinic_last_name_idx` ON `patients` (`clinic_id`,`last_name`);--> statement-breakpoint
CREATE INDEX `patients_clinic_active_idx` ON `patients` (`clinic_id`,`is_active`);--> statement-breakpoint
CREATE UNIQUE INDEX `patients_clinic_record_number_uq` ON `patients` (`clinic_id`,`record_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `patients_id_clinic_uq` ON `patients` (`id`,`clinic_id`);--> statement-breakpoint
CREATE TABLE `appointments` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (abs(random()) % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`clinic_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`dentist_id` text,
	`room_id` text,
	`chair_id` text,
	`starts_at` integer NOT NULL,
	`duration_minutes` integer NOT NULL,
	`status` text DEFAULT 'SCHEDULED' NOT NULL,
	`visit_id` text,
	`notes` text,
	`cancelled_reason` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`visit_id`) REFERENCES `visits`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`patient_id`,`clinic_id`) REFERENCES `patients`(`id`,`clinic_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`dentist_id`,`clinic_id`) REFERENCES `dentists`(`id`,`clinic_id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`room_id`,`clinic_id`) REFERENCES `rooms`(`id`,`clinic_id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`chair_id`,`clinic_id`) REFERENCES `chairs`(`id`,`clinic_id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "appointments_duration_positive" CHECK("appointments"."duration_minutes" > 0),
	CONSTRAINT "appointments_status_in_values" CHECK("status" in ('SCHEDULED', 'CONFIRMED', 'ARRIVED', 'IN_TREATMENT', 'COMPLETED', 'CANCELLED', 'NO_SHOW'))
);
--> statement-breakpoint
CREATE INDEX `appointments_clinic_starts_at_idx` ON `appointments` (`clinic_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `appointments_dentist_starts_at_idx` ON `appointments` (`dentist_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `appointments_patient_starts_at_idx` ON `appointments` (`patient_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `appointments_chair_starts_at_idx` ON `appointments` (`chair_id`,`starts_at`);--> statement-breakpoint
CREATE TABLE `clinical_notes` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (abs(random()) % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`visit_id` text NOT NULL,
	`author_id` text,
	`body` text NOT NULL,
	`metadata` text DEFAULT '{}',
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	FOREIGN KEY (`visit_id`) REFERENCES `visits`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `clinical_notes_visit_idx` ON `clinical_notes` (`visit_id`);--> statement-breakpoint
CREATE TABLE `odontogram_entries` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (abs(random()) % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`patient_id` text NOT NULL,
	`visit_id` text,
	`dentition` text NOT NULL,
	`tooth` text NOT NULL,
	`surfaces` text DEFAULT '[]' NOT NULL,
	`condition` text NOT NULL,
	`notes` text,
	`recorded_by` text,
	`recorded_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`visit_id`) REFERENCES `visits`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "odontogram_entries_dentition_in_values" CHECK("dentition" in ('PERMANENT', 'PRIMARY', 'MIXED')),
	CONSTRAINT "odontogram_entries_condition_in_values" CHECK("condition" in ('HEALTHY', 'CARIES', 'FILLED', 'MISSING', 'CROWN', 'IMPLANT', 'ROOT_CANAL', 'EXTRACTION_INDICATED', 'EXTRACTED', 'SEALANT', 'VENEER', 'FRACTURE', 'MOBILITY', 'PROSTHESIS'))
);
--> statement-breakpoint
CREATE INDEX `odontogram_patient_tooth_idx` ON `odontogram_entries` (`patient_id`,`tooth`);--> statement-breakpoint
CREATE INDEX `odontogram_visit_idx` ON `odontogram_entries` (`visit_id`);--> statement-breakpoint
CREATE TABLE `prescriptions` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (abs(random()) % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`visit_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`dentist_id` text,
	`medication` text NOT NULL,
	`dosage` text NOT NULL,
	`route` text NOT NULL,
	`frequency` text NOT NULL,
	`duration_days` integer NOT NULL,
	`instructions` text,
	`issued_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	FOREIGN KEY (`visit_id`) REFERENCES `visits`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`dentist_id`) REFERENCES `dentists`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "prescriptions_duration_positive" CHECK("prescriptions"."duration_days" > 0),
	CONSTRAINT "prescriptions_route_in_values" CHECK("route" in ('ORAL', 'TOPICAL', 'INHALATION', 'INJECTION', 'RECTAL', 'OTHER'))
);
--> statement-breakpoint
CREATE INDEX `prescriptions_visit_idx` ON `prescriptions` (`visit_id`);--> statement-breakpoint
CREATE TABLE `visits` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (abs(random()) % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`clinic_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`dentist_id` text,
	`chair_id` text,
	`appointment_id` text,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`started_at` integer,
	`ended_at` integer,
	`reason` text,
	`summary` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`patient_id`,`clinic_id`) REFERENCES `patients`(`id`,`clinic_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`dentist_id`,`clinic_id`) REFERENCES `dentists`(`id`,`clinic_id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`chair_id`,`clinic_id`) REFERENCES `chairs`(`id`,`clinic_id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "visits_status_in_values" CHECK("status" in ('OPEN', 'COMPLETED', 'CANCELLED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `visits_appointment_uq` ON `visits` (`appointment_id`);--> statement-breakpoint
CREATE INDEX `visits_patient_started_at_idx` ON `visits` (`patient_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `visits_clinic_status_idx` ON `visits` (`clinic_id`,`status`);--> statement-breakpoint
CREATE TABLE `treatment_plan_items` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (abs(random()) % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`treatment_plan_id` text NOT NULL,
	`treatment_id` text,
	`tooth` text,
	`surfaces` text DEFAULT '[]' NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`estimated_price_minor` integer DEFAULT 0 NOT NULL,
	`is_completed` integer DEFAULT false NOT NULL,
	`completed_at` integer,
	`notes` text,
	FOREIGN KEY (`treatment_plan_id`) REFERENCES `treatment_plans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`treatment_id`) REFERENCES `treatments`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `treatment_plan_items_plan_idx` ON `treatment_plan_items` (`treatment_plan_id`);--> statement-breakpoint
CREATE TABLE `treatment_plans` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (abs(random()) % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`clinic_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`dentist_id` text,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`title` text,
	`notes` text,
	`presented_at` integer,
	`accepted_at` integer,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`dentist_id`) REFERENCES `dentists`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "treatment_plans_status_in_values" CHECK("status" in ('DRAFT', 'PROPOSED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'))
);
--> statement-breakpoint
CREATE INDEX `treatment_plans_patient_status_idx` ON `treatment_plans` (`patient_id`,`status`);--> statement-breakpoint
CREATE TABLE `treatments` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (abs(random()) % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`clinic_id` text NOT NULL,
	`code` text,
	`name` text NOT NULL,
	`description` text,
	`default_price_minor` integer DEFAULT 0 NOT NULL,
	`default_duration_minutes` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `treatments_clinic_active_idx` ON `treatments` (`clinic_id`,`is_active`);--> statement-breakpoint
CREATE UNIQUE INDEX `treatments_clinic_code_uq` ON `treatments` (`clinic_id`,`code`);--> statement-breakpoint
CREATE TABLE `visit_treatment_executions` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (abs(random()) % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`visit_id` text NOT NULL,
	`treatment_id` text NOT NULL,
	`treatment_plan_item_id` text,
	`tooth` text,
	`notes` text,
	`performed_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	FOREIGN KEY (`visit_id`) REFERENCES `visits`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`treatment_id`) REFERENCES `treatments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`treatment_plan_item_id`) REFERENCES `treatment_plan_items`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `visit_treatment_executions_visit_idx` ON `visit_treatment_executions` (`visit_id`);--> statement-breakpoint
CREATE TABLE `charges` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (abs(random()) % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`clinic_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`visit_id` text,
	`treatment_id` text,
	`description` text NOT NULL,
	`quantity` numeric DEFAULT '1' NOT NULL,
	`unit_price_minor` integer NOT NULL,
	`discount_minor` integer DEFAULT 0 NOT NULL,
	`tax_rate_percent` numeric DEFAULT '0' NOT NULL,
	`currency` text NOT NULL,
	`invoice_id` text,
	`invoiced_at` integer,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`visit_id`) REFERENCES `visits`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`treatment_id`) REFERENCES `treatments`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "charges_discount_not_negative" CHECK("charges"."discount_minor" >= 0)
);
--> statement-breakpoint
CREATE INDEX `charges_patient_idx` ON `charges` (`patient_id`);--> statement-breakpoint
CREATE INDEX `charges_invoice_idx` ON `charges` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `charges_clinic_created_at_idx` ON `charges` (`clinic_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (abs(random()) % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`number` text,
	`clinic_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`currency` text NOT NULL,
	`discount_minor` integer DEFAULT 0 NOT NULL,
	`tax_rate_percent` numeric DEFAULT '0' NOT NULL,
	`subtotal_minor` integer DEFAULT 0 NOT NULL,
	`total_minor` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`issued_at` integer,
	`due_at` integer,
	`created_by` text,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "invoices_status_in_values" CHECK("status" in ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID'))
);
--> statement-breakpoint
CREATE INDEX `invoices_patient_status_idx` ON `invoices` (`patient_id`,`status`);--> statement-breakpoint
CREATE INDEX `invoices_clinic_issued_at_idx` ON `invoices` (`clinic_id`,`issued_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_clinic_number_uq` ON `invoices` (`clinic_id`,`number`);--> statement-breakpoint
CREATE TABLE `payment_allocations` (
	`payment_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	PRIMARY KEY(`payment_id`, `invoice_id`),
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "payment_allocations_positive" CHECK("payment_allocations"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (abs(random()) % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`number` text,
	`clinic_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`method` text NOT NULL,
	`currency` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`reference` text,
	`received_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	`received_by` text,
	FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`received_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "payments_amount_positive" CHECK("payments"."amount_minor" > 0),
	CONSTRAINT "payments_method_in_values" CHECK("method" in ('CASH', 'CARD', 'TRANSFER', 'YAPE', 'PLIN', 'OTHER'))
);
--> statement-breakpoint
CREATE INDEX `payments_patient_received_at_idx` ON `payments` (`patient_id`,`received_at`);--> statement-breakpoint
CREATE INDEX `payments_clinic_received_at_idx` ON `payments` (`clinic_id`,`received_at`);--> statement-breakpoint
CREATE TABLE `inventory_items` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (abs(random()) % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`clinic_id` text NOT NULL,
	`name` text NOT NULL,
	`sku` text,
	`description` text,
	`unit` text DEFAULT 'unit' NOT NULL,
	`stock` integer DEFAULT 0 NOT NULL,
	`min_stock` integer DEFAULT 0 NOT NULL,
	`cost_minor` integer DEFAULT 0 NOT NULL,
	`currency` text,
	`expires_at` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `inventory_items_clinic_active_idx` ON `inventory_items` (`clinic_id`,`is_active`);--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_items_clinic_sku_uq` ON `inventory_items` (`clinic_id`,`sku`);--> statement-breakpoint
CREATE TABLE `stock_movements` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (abs(random()) % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`item_id` text NOT NULL,
	`type` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_cost_minor` integer,
	`reference` text,
	`notes` text,
	`performed_by` text,
	`performed_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`performed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "stock_movements_quantity_positive" CHECK("stock_movements"."quantity" > 0),
	CONSTRAINT "stock_movements_type_in_values" CHECK("type" in ('PURCHASE', 'USAGE', 'ADJUSTMENT', 'RETURN', 'EXPIRED'))
);
--> statement-breakpoint
CREATE INDEX `stock_movements_item_performed_at_idx` ON `stock_movements` (`item_id`,`performed_at`);