ALTER TABLE "tenants" ADD COLUMN "ksef_submission_mode" text DEFAULT 'automatic' NOT NULL;
--> statement-breakpoint
INSERT INTO "ksef_number_sequences" ("id", "tenant_id", "invoice_type", "year", "next_value", "updated_at")
SELECT allocation.tenant_id || ':VAT_TEST:' || allocation.year,
       allocation.tenant_id, 'VAT_TEST', allocation.year,
       max(allocation.sequence) + 1, max(allocation.allocated_at)
FROM "ksef_number_allocations" AS allocation
WHERE allocation.invoice_type = 'VAT'
  AND (
    EXISTS (
      SELECT 1 FROM "invoices" AS invoice
      WHERE invoice.tenant_id = allocation.tenant_id
        AND invoice.order_id = allocation.order_id
        AND invoice.ksef->>'p2' = allocation.p2
        AND invoice.ksef->>'environment' = 'test'
    )
    OR NOT EXISTS (
      SELECT 1 FROM "invoices" AS invoice
      WHERE invoice.tenant_id = allocation.tenant_id
        AND invoice.order_id = allocation.order_id
        AND invoice.ksef->>'p2' = allocation.p2
    )
  )
GROUP BY allocation.tenant_id, allocation.year;
