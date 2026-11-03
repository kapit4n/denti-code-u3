PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_clinics` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (abs(random()) % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`name` text NOT NULL,
	`legal_name` text,
	`tax_id` text,
	`address` text,
	`phone` text,
	`email` text,
	`time_zone` text DEFAULT 'America/Lima' NOT NULL,
	`currency_code` text DEFAULT 'BOB' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_clinics`("id", "name", "legal_name", "tax_id", "address", "phone", "email", "time_zone", "currency_code", "is_active", "created_at", "updated_at") SELECT "id", "name", "legal_name", "tax_id", "address", "phone", "email", "time_zone", "currency_code", "is_active", "created_at", "updated_at" FROM `clinics`;--> statement-breakpoint
DROP TABLE `clinics`;--> statement-breakpoint
ALTER TABLE `__new_clinics` RENAME TO `clinics`;--> statement-breakpoint
PRAGMA foreign_keys=ON;