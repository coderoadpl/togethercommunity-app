ALTER TABLE "tenants" ADD COLUMN "ksef_submission_mode" text DEFAULT 'automatic' NOT NULL;
--> statement-breakpoint
ALTER TABLE "ksef_number_allocations" ADD COLUMN "environment" text DEFAULT 'production' NOT NULL;
--> statement-breakpoint
ALTER TABLE "ksef_number_sequences" ADD COLUMN "environment" text DEFAULT 'production' NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "ksef_number_allocations_tenant_env_type_sequence_uidx" ON "ksef_number_allocations" ("tenant_id", "environment", "invoice_type", "year", "sequence");
--> statement-breakpoint
CREATE UNIQUE INDEX "ksef_number_allocations_tenant_env_type_p2_uidx" ON "ksef_number_allocations" ("tenant_id", "environment", "invoice_type", "p2");
--> statement-breakpoint
CREATE UNIQUE INDEX "ksef_number_allocations_tenant_env_order_uidx" ON "ksef_number_allocations" ("tenant_id", "environment", "order_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "ksef_number_sequences_tenant_env_type_year_uidx" ON "ksef_number_sequences" ("tenant_id", "environment", "invoice_type", "year");
