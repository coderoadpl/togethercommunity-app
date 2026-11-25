ALTER TABLE "shop_management_keys" ADD COLUMN "purpose" text;
--> statement-breakpoint
ALTER TABLE "shop_management_keys" ADD COLUMN "purpose_expires_at" text;
--> statement-breakpoint
ALTER TABLE "shop_management_keys" ADD CONSTRAINT "shop_management_keys_purchase_smoke_check" CHECK (
  ("purpose" IS NULL AND "purpose_expires_at" IS NULL) OR
  ("purpose" = 'purchase-smoke' AND "purpose_expires_at" IS NOT NULL AND
   "tenant_id" = 'tenant-acme' AND "mode" = 'direct' AND
   "scopes" = '["shop:catalog:read"]'::jsonb AND "expires_at" = '1970-01-01T00:00:00.000Z')
);
--> statement-breakpoint
CREATE TABLE "purchase_smoke_checkouts" (
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "reference" text PRIMARY KEY,
  "api_key_id" text NOT NULL,
  "run_id" text NOT NULL,
  "scenario" text NOT NULL,
  "session_id" text NOT NULL,
  "url" text NOT NULL,
  "created_at" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_smoke_checkouts_run_uidx" ON "purchase_smoke_checkouts" ("tenant_id", "api_key_id", "run_id", "scenario");
--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_smoke_checkouts_session_uidx" ON "purchase_smoke_checkouts" ("tenant_id", "session_id");
--> statement-breakpoint
CREATE INDEX "purchase_smoke_checkouts_created_idx" ON "purchase_smoke_checkouts" ("tenant_id", "created_at");
--> statement-breakpoint
CREATE TABLE "purchase_smoke_receipts" (
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "reference" text NOT NULL REFERENCES "purchase_smoke_checkouts"("reference") ON DELETE CASCADE,
  "event_id" text NOT NULL,
  "receipt" jsonb NOT NULL,
  PRIMARY KEY ("tenant_id", "reference", "event_id")
);
