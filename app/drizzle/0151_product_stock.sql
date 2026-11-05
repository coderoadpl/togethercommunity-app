CREATE TABLE "product_stock" (
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "product_id" text NOT NULL,
  "on_hand" integer NOT NULL CONSTRAINT "product_stock_on_hand_check" CHECK ("on_hand" >= 0),
  "reserved" integer DEFAULT 0 NOT NULL CONSTRAINT "product_stock_reserved_check" CHECK ("reserved" >= 0),
  "low_stock_threshold" integer CONSTRAINT "product_stock_low_stock_threshold_check" CHECK ("low_stock_threshold" >= 0),
  "low_stock_notified_at" timestamp with time zone,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "product_stock_tenant_id_product_id_pk" PRIMARY KEY ("tenant_id", "product_id"),
  CONSTRAINT "product_stock_tenant_product_fk" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "products"("tenant_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE "stock_events" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "product_id" text NOT NULL,
  "type" text NOT NULL CONSTRAINT "stock_events_type_check" CHECK ("type" IN ('tracking_enabled', 'adjusted', 'reserved', 'released', 'committed', 'committed_late', 'oversold', 'returned')),
  "quantity" integer NOT NULL,
  "reference" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "actor_user_id" text,
  "occurred_at" timestamp with time zone NOT NULL,
  CONSTRAINT "stock_events_tenant_product_fk" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "products"("tenant_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "stock_events_tenant_product_idx" ON "stock_events" ("tenant_id", "product_id", "occurred_at");
--> statement-breakpoint
CREATE INDEX "stock_events_tenant_product_order_commit_idx" ON "stock_events" ("tenant_id", "product_id", ("reference" ->> 'orderId')) WHERE "type" IN ('committed', 'committed_late');
--> statement-breakpoint
CREATE TABLE "stock_reservations" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "product_id" text NOT NULL,
  "checkout_snapshot_id" text NOT NULL,
  "quantity" integer DEFAULT 1 NOT NULL CONSTRAINT "stock_reservations_quantity_check" CHECK ("quantity" > 0),
  "status" text NOT NULL CONSTRAINT "stock_reservations_status_check" CHECK ("status" IN ('active', 'committed', 'released')),
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "stock_reservations_tenant_product_fk" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "products"("tenant_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "stock_reservations_tenant_status_expires_idx" ON "stock_reservations" ("tenant_id", "status", "expires_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "stock_reservations_tenant_snapshot_product_uidx" ON "stock_reservations" ("tenant_id", "checkout_snapshot_id", "product_id");
--> statement-breakpoint
CREATE INDEX "stock_reservations_status_expires_idx" ON "stock_reservations" ("expires_at") WHERE "status" = 'active';
