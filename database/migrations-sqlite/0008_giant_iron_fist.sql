CREATE TABLE `appointment_status_events` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (abs(random()) % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`appointment_id` text NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`recorded_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	`reason` text,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "appointment_status_events_from_status_in_values" CHECK("from_status" in ('SCHEDULED', 'CONFIRMED', 'ARRIVED', 'IN_TREATMENT', 'COMPLETED', 'CANCELLED', 'NO_SHOW')),
	CONSTRAINT "appointment_status_events_to_status_in_values" CHECK("to_status" in ('SCHEDULED', 'CONFIRMED', 'ARRIVED', 'IN_TREATMENT', 'COMPLETED', 'CANCELLED', 'NO_SHOW'))
);
--> statement-breakpoint
CREATE INDEX `appointment_status_events_appointment_occurred_at_idx` ON `appointment_status_events` (`appointment_id`,`occurred_at`);