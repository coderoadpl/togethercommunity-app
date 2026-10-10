ALTER TABLE "tenants" ADD COLUMN "ksef_submission_mode" text DEFAULT 'automatic' NOT NULL;
--> statement-breakpoint
ALTER TABLE "ksef_number_allocations" ADD COLUMN "environment" text DEFAULT 'production' NOT NULL;
--> statement-breakpoint
ALTER TABLE "ksef_number_sequences" ADD COLUMN "environment" text DEFAULT 'production' NOT NULL;
--> statement-breakpoint
DROP INDEX "ksef_number_allocations_tenant_type_sequence_uidx";
--> statement-breakpoint
DROP INDEX "ksef_number_allocations_tenant_type_p2_uidx";
--> statement-breakpoint
DROP INDEX "ksef_number_allocations_tenant_order_uidx";
--> statement-breakpoint
DROP INDEX "ksef_number_sequences_tenant_type_year_uidx";
--> statement-breakpoint
UPDATE "ksef_number_allocations" allocation
SET "environment" = 'test'
WHERE EXISTS (
  SELECT 1 FROM "invoices" invoice
  WHERE invoice.tenant_id = allocation.tenant_id
    AND invoice.order_id = allocation.order_id
    AND invoice.ksef->>'environment' = 'test'
    AND invoice.ksef->>'p2' = allocation.p2
);
--> statement-breakpoint
UPDATE "ksef_number_sequences" counter
SET "next_value" = COALESCE((
  SELECT max(allocation.sequence) + 1
  FROM "ksef_number_allocations" allocation
  WHERE allocation.tenant_id = counter.tenant_id
    AND allocation.invoice_type = counter.invoice_type
    AND allocation.year = counter.year
    AND allocation.environment = 'production'
), 1)
WHERE EXISTS (
  SELECT 1 FROM "ksef_number_allocations" allocation
  WHERE allocation.tenant_id = counter.tenant_id
    AND allocation.invoice_type = counter.invoice_type
    AND allocation.year = counter.year
    AND allocation.environment = 'test'
);
--> statement-breakpoint
INSERT INTO "ksef_number_sequences" ("id", "tenant_id", "environment", "invoice_type", "year", "next_value", "updated_at")
SELECT tenant_id || ':test:' || invoice_type || ':' || year::text,
       tenant_id, 'test', invoice_type, year, max(sequence) + 1, max(allocated_at)
FROM "ksef_number_allocations"
WHERE "environment" = 'test'
GROUP BY tenant_id, invoice_type, year;
--> statement-breakpoint
CREATE UNIQUE INDEX "ksef_number_allocations_tenant_type_sequence_uidx" ON "ksef_number_allocations" ("tenant_id", "environment", "invoice_type", "year", "sequence");
--> statement-breakpoint
CREATE UNIQUE INDEX "ksef_number_allocations_tenant_type_p2_uidx" ON "ksef_number_allocations" ("tenant_id", "environment", "invoice_type", "p2");
--> statement-breakpoint
CREATE UNIQUE INDEX "ksef_number_allocations_tenant_order_uidx" ON "ksef_number_allocations" ("tenant_id", "environment", "order_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "ksef_number_sequences_tenant_type_year_uidx" ON "ksef_number_sequences" ("tenant_id", "environment", "invoice_type", "year");
