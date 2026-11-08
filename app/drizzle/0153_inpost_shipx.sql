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
  "operation_started_at" timestamp with time zone,
  "bought_at" timestamp with time zone,
  "label_fetched_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "order_shipments_tenant_order_uidx" ON "order_shipments" ("tenant_id", "order_id");
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
