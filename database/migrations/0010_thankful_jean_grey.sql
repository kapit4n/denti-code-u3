CREATE TABLE "visit_treatment_supplies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"treatment_record_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visit_treatment_supplies_quantity_positive" CHECK ("visit_treatment_supplies"."quantity" > 0)
);
--> statement-breakpoint
ALTER TABLE "visit_treatment_executions" ADD COLUMN "ended_at" timestamp with time zone;--> statement-breakpoint
UPDATE "visit_treatment_executions" SET "ended_at" = "performed_at" WHERE "ended_at" IS NULL;--> statement-breakpoint
ALTER TABLE "visit_treatment_supplies" ADD CONSTRAINT "visit_treatment_supplies_treatment_record_id_visit_treatment_executions_id_fk" FOREIGN KEY ("treatment_record_id") REFERENCES "public"."visit_treatment_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_treatment_supplies" ADD CONSTRAINT "visit_treatment_supplies_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "visit_treatment_supplies_record_idx" ON "visit_treatment_supplies" USING btree ("treatment_record_id");--> statement-breakpoint
CREATE INDEX "visit_treatment_supplies_item_idx" ON "visit_treatment_supplies" USING btree ("item_id");