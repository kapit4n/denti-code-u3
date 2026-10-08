CREATE TABLE "visit_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visit_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text,
	"size_bytes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visit_attachments_size_nonnegative" CHECK ("visit_attachments"."size_bytes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "visit_attachments" ADD CONSTRAINT "visit_attachments_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "visit_attachments_visit_idx" ON "visit_attachments" USING btree ("visit_id");