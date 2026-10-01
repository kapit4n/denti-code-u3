CREATE TYPE "public"."appointment_status" AS ENUM('SCHEDULED', 'CONFIRMED', 'ARRIVED', 'IN_TREATMENT', 'COMPLETED', 'CANCELLED', 'NO_SHOW');--> statement-breakpoint
CREATE TYPE "public"."clinic_role" AS ENUM('ADMINISTRATOR', 'DENTIST', 'ASSISTANT', 'RECEPTIONIST');--> statement-breakpoint
CREATE TYPE "public"."dentition" AS ENUM('PERMANENT', 'PRIMARY', 'MIXED');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID');--> statement-breakpoint
CREATE TYPE "public"."medication_route" AS ENUM('ORAL', 'TOPICAL', 'INHALATION', 'INJECTION', 'RECTAL', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."odontogram_condition" AS ENUM('HEALTHY', 'CARIES', 'FILLED', 'MISSING', 'CROWN', 'IMPLANT', 'ROOT_CANAL', 'EXTRACTION_INDICATED', 'EXTRACTED', 'SEALANT', 'VENEER', 'FRACTURE', 'MOBILITY', 'PROSTHESIS');--> statement-breakpoint
CREATE TYPE "public"."odontogram_surface" AS ENUM('MESIAL', 'DISTAL', 'BUCCAL', 'LINGUAL', 'OCCLUSAL', 'INCISAL');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('CASH', 'CARD', 'TRANSFER', 'YAPE', 'PLIN', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."stock_movement_type" AS ENUM('PURCHASE', 'USAGE', 'ADJUSTMENT', 'RETURN', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."treatment_plan_status" AS ENUM('DRAFT', 'PROPOSED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."visit_status" AS ENUM('OPEN', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "chairs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"room_id" uuid,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clinic_operating_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"day_of_week" integer NOT NULL,
	"opens_at" time,
	"closes_at" time,
	"break_starts_at" time,
	"break_ends_at" time
);
--> statement-breakpoint
CREATE TABLE "clinics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"tax_id" text,
	"address" text,
	"phone" text,
	"email" text,
	"time_zone" text DEFAULT 'America/Lima' NOT NULL,
	"currency_code" text DEFAULT 'USD' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dentists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"user_id" uuid,
	"full_name" text NOT NULL,
	"licence_number" text,
	"speciality" text,
	"color" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role" "clinic_role" NOT NULL,
	"permission" text NOT NULL,
	CONSTRAINT "role_permissions_role_permission_pk" PRIMARY KEY("role","permission")
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"full_name" text NOT NULL,
	"role" "clinic_role" DEFAULT 'RECEPTIONIST' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"record_number" text,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"preferred_name" text,
	"identification_number" text,
	"phone" text,
	"email" text,
	"birth_date" date,
	"address" text,
	"additional_data" jsonb DEFAULT '{}'::jsonb,
	"allergies" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"anonymized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"dentist_id" uuid,
	"room_id" uuid,
	"chair_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer NOT NULL,
	"status" "appointment_status" DEFAULT 'SCHEDULED' NOT NULL,
	"visit_id" uuid,
	"notes" text,
	"cancelled_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_duration_positive" CHECK ("appointments"."duration_minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "clinical_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visit_id" uuid NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "odontogram_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"visit_id" uuid,
	"dentition" "dentition" NOT NULL,
	"tooth" text NOT NULL,
	"surfaces" "odontogram_surface"[] DEFAULT '{}' NOT NULL,
	"condition" "odontogram_condition" NOT NULL,
	"notes" text,
	"recorded_by" uuid,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prescriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visit_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"dentist_id" uuid,
	"medication" text NOT NULL,
	"dosage" text NOT NULL,
	"route" "medication_route" NOT NULL,
	"frequency" text NOT NULL,
	"duration_days" integer NOT NULL,
	"instructions" text,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prescriptions_duration_positive" CHECK ("prescriptions"."duration_days" > 0)
);
--> statement-breakpoint
CREATE TABLE "visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"dentist_id" uuid,
	"chair_id" uuid,
	"appointment_id" uuid,
	"status" "visit_status" DEFAULT 'OPEN' NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"reason" text,
	"summary" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "treatment_plan_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"treatment_plan_id" uuid NOT NULL,
	"treatment_id" uuid,
	"tooth" text,
	"surfaces" text[] DEFAULT '{}' NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"estimated_price_minor" integer DEFAULT 0 NOT NULL,
	"is_completed" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "treatment_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"dentist_id" uuid,
	"status" "treatment_plan_status" DEFAULT 'DRAFT' NOT NULL,
	"title" text,
	"notes" text,
	"presented_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "treatments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"description" text,
	"default_price_minor" integer DEFAULT 0 NOT NULL,
	"default_duration_minutes" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visit_treatment_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visit_id" uuid NOT NULL,
	"treatment_id" uuid NOT NULL,
	"treatment_plan_item_id" uuid,
	"tooth" text,
	"notes" text,
	"performed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"visit_id" uuid,
	"treatment_id" uuid,
	"description" text NOT NULL,
	"quantity" numeric(10, 2) DEFAULT '1' NOT NULL,
	"unit_price_minor" integer NOT NULL,
	"discount_minor" integer DEFAULT 0 NOT NULL,
	"tax_rate_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"currency" text NOT NULL,
	"invoice_id" uuid,
	"invoiced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "charges_discount_not_negative" CHECK ("charges"."discount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text,
	"clinic_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"status" "invoice_status" DEFAULT 'DRAFT' NOT NULL,
	"currency" text NOT NULL,
	"discount_minor" integer DEFAULT 0 NOT NULL,
	"tax_rate_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"subtotal_minor" integer DEFAULT 0 NOT NULL,
	"total_minor" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"issued_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_allocations" (
	"payment_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount_minor" integer NOT NULL,
	CONSTRAINT "payment_allocations_payment_id_invoice_id_pk" PRIMARY KEY("payment_id","invoice_id"),
	CONSTRAINT "payment_allocations_positive" CHECK ("payment_allocations"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text,
	"clinic_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"method" "payment_method" NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"reference" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_by" uuid,
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sku" text,
	"description" text,
	"unit" text DEFAULT 'unit' NOT NULL,
	"stock" integer DEFAULT 0 NOT NULL,
	"min_stock" integer DEFAULT 0 NOT NULL,
	"cost_minor" integer DEFAULT 0 NOT NULL,
	"currency" text,
	"expires_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"type" "stock_movement_type" NOT NULL,
	"quantity" integer NOT NULL,
	"unit_cost_minor" integer,
	"reference" text,
	"notes" text,
	"performed_by" uuid,
	"performed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movements_quantity_positive" CHECK ("stock_movements"."quantity" > 0)
);
--> statement-breakpoint
ALTER TABLE "chairs" ADD CONSTRAINT "chairs_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chairs" ADD CONSTRAINT "chairs_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_operating_hours" ADD CONSTRAINT "clinic_operating_hours_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dentists" ADD CONSTRAINT "dentists_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dentists" ADD CONSTRAINT "dentists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_dentist_id_dentists_id_fk" FOREIGN KEY ("dentist_id") REFERENCES "public"."dentists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_chair_id_chairs_id_fk" FOREIGN KEY ("chair_id") REFERENCES "public"."chairs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "odontogram_entries" ADD CONSTRAINT "odontogram_entries_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "odontogram_entries" ADD CONSTRAINT "odontogram_entries_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_dentist_id_dentists_id_fk" FOREIGN KEY ("dentist_id") REFERENCES "public"."dentists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_dentist_id_dentists_id_fk" FOREIGN KEY ("dentist_id") REFERENCES "public"."dentists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_chair_id_chairs_id_fk" FOREIGN KEY ("chair_id") REFERENCES "public"."chairs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan_items" ADD CONSTRAINT "treatment_plan_items_treatment_plan_id_treatment_plans_id_fk" FOREIGN KEY ("treatment_plan_id") REFERENCES "public"."treatment_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan_items" ADD CONSTRAINT "treatment_plan_items_treatment_id_treatments_id_fk" FOREIGN KEY ("treatment_id") REFERENCES "public"."treatments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_dentist_id_dentists_id_fk" FOREIGN KEY ("dentist_id") REFERENCES "public"."dentists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatments" ADD CONSTRAINT "treatments_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_treatment_executions" ADD CONSTRAINT "visit_treatment_executions_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_treatment_executions" ADD CONSTRAINT "visit_treatment_executions_treatment_id_treatments_id_fk" FOREIGN KEY ("treatment_id") REFERENCES "public"."treatments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_treatment_executions" ADD CONSTRAINT "visit_treatment_executions_treatment_plan_item_id_treatment_plan_items_id_fk" FOREIGN KEY ("treatment_plan_item_id") REFERENCES "public"."treatment_plan_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_treatment_id_treatments_id_fk" FOREIGN KEY ("treatment_id") REFERENCES "public"."treatments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_performed_by_users_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clinic_operating_hours_clinic_day_uq" ON "clinic_operating_hours" USING btree ("clinic_id","day_of_week");--> statement-breakpoint
CREATE INDEX "dentists_clinic_active_idx" ON "dentists" USING btree ("clinic_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "users_clinic_email_uq" ON "users" USING btree ("clinic_id","email");--> statement-breakpoint
CREATE INDEX "users_clinic_role_idx" ON "users" USING btree ("clinic_id","role");--> statement-breakpoint
CREATE INDEX "patients_clinic_last_name_idx" ON "patients" USING btree ("clinic_id","last_name");--> statement-breakpoint
CREATE INDEX "patients_clinic_active_idx" ON "patients" USING btree ("clinic_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "patients_clinic_record_number_uq" ON "patients" USING btree ("clinic_id","record_number");--> statement-breakpoint
CREATE INDEX "appointments_clinic_starts_at_idx" ON "appointments" USING btree ("clinic_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_dentist_starts_at_idx" ON "appointments" USING btree ("dentist_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_patient_starts_at_idx" ON "appointments" USING btree ("patient_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_chair_starts_at_idx" ON "appointments" USING btree ("chair_id","starts_at");--> statement-breakpoint
CREATE INDEX "clinical_notes_visit_idx" ON "clinical_notes" USING btree ("visit_id");--> statement-breakpoint
CREATE INDEX "odontogram_patient_tooth_idx" ON "odontogram_entries" USING btree ("patient_id","tooth");--> statement-breakpoint
CREATE INDEX "odontogram_visit_idx" ON "odontogram_entries" USING btree ("visit_id");--> statement-breakpoint
CREATE INDEX "prescriptions_visit_idx" ON "prescriptions" USING btree ("visit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "visits_appointment_uq" ON "visits" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "visits_patient_started_at_idx" ON "visits" USING btree ("patient_id","started_at");--> statement-breakpoint
CREATE INDEX "visits_clinic_status_idx" ON "visits" USING btree ("clinic_id","status");--> statement-breakpoint
CREATE INDEX "treatment_plan_items_plan_idx" ON "treatment_plan_items" USING btree ("treatment_plan_id");--> statement-breakpoint
CREATE INDEX "treatment_plans_patient_status_idx" ON "treatment_plans" USING btree ("patient_id","status");--> statement-breakpoint
CREATE INDEX "treatments_clinic_active_idx" ON "treatments" USING btree ("clinic_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "treatments_clinic_code_uq" ON "treatments" USING btree ("clinic_id","code");--> statement-breakpoint
CREATE INDEX "visit_treatment_executions_visit_idx" ON "visit_treatment_executions" USING btree ("visit_id");--> statement-breakpoint
CREATE INDEX "charges_patient_idx" ON "charges" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "charges_invoice_idx" ON "charges" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "charges_clinic_created_at_idx" ON "charges" USING btree ("clinic_id","created_at");--> statement-breakpoint
CREATE INDEX "invoices_patient_status_idx" ON "invoices" USING btree ("patient_id","status");--> statement-breakpoint
CREATE INDEX "invoices_clinic_issued_at_idx" ON "invoices" USING btree ("clinic_id","issued_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_clinic_number_uq" ON "invoices" USING btree ("clinic_id","number");--> statement-breakpoint
CREATE INDEX "payments_patient_received_at_idx" ON "payments" USING btree ("patient_id","received_at");--> statement-breakpoint
CREATE INDEX "payments_clinic_received_at_idx" ON "payments" USING btree ("clinic_id","received_at");--> statement-breakpoint
CREATE INDEX "inventory_items_clinic_active_idx" ON "inventory_items" USING btree ("clinic_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_items_clinic_sku_uq" ON "inventory_items" USING btree ("clinic_id","sku");--> statement-breakpoint
CREATE INDEX "stock_movements_item_performed_at_idx" ON "stock_movements" USING btree ("item_id","performed_at");