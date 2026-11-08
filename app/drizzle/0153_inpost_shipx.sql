CREATE TABLE "order_shipments" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "order_id" text NOT NULL,
  "provider" text NOT NULL CONSTRAINT "order_shipments_provider_check" CHECK ("provider" IN ('inpost_shipx')),
  "environment" text NOT NULL CONSTRAINT "order_shipments_environment_check" CHECK ("environment" IN ('sandbox', 'production')),
  "organization_id" text NOT NULL,
  "provider_shipment_id" text,
  "status" text NOT NULL,
  "tracking_number" text,
  "create_attempted_at" timestamp with time zone,
  "operation_token" text,
  "operation_started_at" timestamp with time zone,
  "bought_at" timestamp with time zone,
  "label_fetched_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "order_shipments_tenant_order_uidx" ON "order_shipments" ("tenant_id", "order_id");
--> statement-breakpoint
CREATE TABLE "order_shipment_events" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
  "sequence" bigserial NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "order_id" text NOT NULL,
  "provider" text NOT NULL CONSTRAINT "order_shipment_events_provider_check" CHECK ("provider" IN ('inpost_shipx')),
  "provider_shipment_id" text,
  "type" text NOT NULL CONSTRAINT "order_shipment_events_type_check" CHECK ("type" IN ('attempt_claimed', 'attempt_marked', 'shipment_adopted', 'shipment_created', 'offer_bought', 'payment_failed', 'attempt_released', 'attempt_discarded', 'lease_taken_over', 'label_fetched')),
  "actor_user_id" text,
  "operation_token" text,
  "details" jsonb,
  "created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "order_shipment_events_tenant_order_created_idx" ON "order_shipment_events" ("tenant_id", "order_id", "created_at");
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "parcel_template" text DEFAULT 'medium' NOT NULL;
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_parcel_template_check" CHECK ("products"."parcel_template" in ('small', 'medium', 'large'));
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "shipx_environment" text DEFAULT 'sandbox' NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_shipx_environment_check" CHECK ("tenants"."shipx_environment" IN ('sandbox', 'production'));
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "shipx_sender" jsonb;
