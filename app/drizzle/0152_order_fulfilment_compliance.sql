ALTER TABLE "orders" ADD COLUMN "shipment" jsonb;
--> statement-breakpoint
CREATE TABLE "order_fulfilment_events" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "order_id" text NOT NULL,
  "type" text NOT NULL CONSTRAINT "order_fulfilment_events_type_check" CHECK ("type" IN ('shipped')),
  "payload" jsonb NOT NULL,
  "actor_user_id" text NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "order_fulfilment_events_tenant_order_type_uidx" ON "order_fulfilment_events" ("tenant_id", "order_id", "type");
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "compliance" jsonb;
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "variant_group" text;
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "variant_label" text;
--> statement-breakpoint
CREATE INDEX "products_tenant_variant_group_idx" ON "products" USING btree ("tenant_id","variant_group");
