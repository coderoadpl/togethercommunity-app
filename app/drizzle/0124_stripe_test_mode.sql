ALTER TABLE "orders" ADD COLUMN "mode" text DEFAULT 'live' NOT NULL CHECK ("mode" IN ('live', 'test'));
--> statement-breakpoint
ALTER TABLE "member_subscriptions" ADD COLUMN "mode" text DEFAULT 'live' NOT NULL CHECK ("mode" IN ('live', 'test'));
--> statement-breakpoint
ALTER TABLE "product_grants" ADD COLUMN "mode" text DEFAULT 'live' NOT NULL CHECK ("mode" IN ('live', 'test'));
--> statement-breakpoint
CREATE UNIQUE INDEX "product_grants_tenant_member_product_mode_uidx" ON "product_grants" ("tenant_id", "member_id", "product_id", "mode");
--> statement-breakpoint
DROP INDEX "product_grants_tenant_member_product_uidx";
