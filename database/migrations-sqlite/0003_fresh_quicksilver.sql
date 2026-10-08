CREATE TABLE `visit_attachments` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', (abs(random()) % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`visit_id` text NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text,
	`size_bytes` integer,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	FOREIGN KEY (`visit_id`) REFERENCES `visits`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "visit_attachments_size_nonnegative" CHECK("visit_attachments"."size_bytes" >= 0)
);
--> statement-breakpoint
CREATE INDEX `visit_attachments_visit_idx` ON `visit_attachments` (`visit_id`);