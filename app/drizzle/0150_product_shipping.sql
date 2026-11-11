ALTER TABLE "products" ADD COLUMN "delivery_method" text DEFAULT 'pickup' NOT NULL;
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_delivery_method_check" CHECK ("products"."delivery_method" in ('pickup', 'shipping'));
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "shipping_rates" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "inpost_geowidget_token" text;
--> statement-breakpoint
ALTER TABLE "checkout_snapshots" ADD COLUMN "shipping" jsonb;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "shipping" jsonb;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "fulfilment_status" text;
--> statement-breakpoint
CREATE INDEX "orders_tenant_fulfilment_created_idx" ON "orders" USING btree ("tenant_id","fulfilment_status","created_at" DESC NULLS LAST) WHERE "orders"."fulfilment_status" is not null;
