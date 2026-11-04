CREATE TABLE `visit_treatment_supplies` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (abs(random()) % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`treatment_record_id` text NOT NULL,
	`item_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`recorded_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	FOREIGN KEY (`treatment_record_id`) REFERENCES `visit_treatment_executions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "visit_treatment_supplies_quantity_positive" CHECK("visit_treatment_supplies"."quantity" > 0)
);
--> statement-breakpoint
CREATE INDEX `visit_treatment_supplies_record_idx` ON `visit_treatment_supplies` (`treatment_record_id`);--> statement-breakpoint
CREATE INDEX `visit_treatment_supplies_item_idx` ON `visit_treatment_supplies` (`item_id`);--> statement-breakpoint
ALTER TABLE `visit_treatment_executions` ADD `ended_at` integer;--> statement-breakpoint
UPDATE `visit_treatment_executions` SET `ended_at` = `performed_at` WHERE `ended_at` IS NULL;