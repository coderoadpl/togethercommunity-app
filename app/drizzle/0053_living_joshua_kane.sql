CREATE TABLE "fiscal_artifacts" (
	"key" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"kind" text NOT NULL,
	"content" text NOT NULL,
	"sha256" text NOT NULL,
	"byte_size" integer NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ksef_number_allocations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"invoice_type" text NOT NULL,
	"year" integer NOT NULL,
	"sequence" integer NOT NULL,
	"p2" text NOT NULL,
	"order_id" text NOT NULL,
	"allocated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ksef_number_sequences" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"invoice_type" text NOT NULL,
	"year" integer NOT NULL,
	"next_value" integer NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ksef_submission_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" text NOT NULL,
	"locked_at" text,
	"last_error" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "ksef" jsonb;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "invoicing_provider" text DEFAULT 'ifirma' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "invoice_seller_name" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "invoice_seller_address" text;--> statement-breakpoint
ALTER TABLE "fiscal_artifacts" ADD CONSTRAINT "fiscal_artifacts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_artifacts" ADD CONSTRAINT "fiscal_artifacts_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ksef_number_allocations" ADD CONSTRAINT "ksef_number_allocations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ksef_number_allocations" ADD CONSTRAINT "ksef_number_allocations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ksef_number_sequences" ADD CONSTRAINT "ksef_number_sequences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ksef_submission_jobs" ADD CONSTRAINT "ksef_submission_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ksef_submission_jobs" ADD CONSTRAINT "ksef_submission_jobs_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_artifacts_tenant_invoice_kind_uidx" ON "fiscal_artifacts" USING btree ("tenant_id","invoice_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "ksef_number_allocations_tenant_type_sequence_uidx" ON "ksef_number_allocations" USING btree ("tenant_id","invoice_type","year","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "ksef_number_allocations_tenant_type_p2_uidx" ON "ksef_number_allocations" USING btree ("tenant_id","invoice_type","p2");--> statement-breakpoint
CREATE UNIQUE INDEX "ksef_number_allocations_tenant_order_uidx" ON "ksef_number_allocations" USING btree ("tenant_id","order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ksef_number_sequences_tenant_type_year_uidx" ON "ksef_number_sequences" USING btree ("tenant_id","invoice_type","year");--> statement-breakpoint
CREATE UNIQUE INDEX "ksef_submission_jobs_invoice_uidx" ON "ksef_submission_jobs" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "ksef_submission_jobs_dispatch_idx" ON "ksef_submission_jobs" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ksef_submission_jobs_one_running_per_tenant_uidx" ON "ksef_submission_jobs" USING btree ("tenant_id") WHERE "ksef_submission_jobs"."status" = 'running';