CREATE TABLE "member_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"member_id" text NOT NULL,
	"product_id" text NOT NULL,
	"price_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_subscription_id" text,
	"status" text NOT NULL,
	"current_period_end" text NOT NULL,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"member_id" text NOT NULL,
	"product_id" text NOT NULL,
	"price_id" text,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"provider" text NOT NULL,
	"provider_object_ids" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_prices" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"product_id" text NOT NULL,
	"kind" text NOT NULL,
	"interval" text,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member_subscriptions" ADD CONSTRAINT "member_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_subscriptions" ADD CONSTRAINT "member_subscriptions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_subscriptions" ADD CONSTRAINT "member_subscriptions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_subscriptions" ADD CONSTRAINT "member_subscriptions_price_id_product_prices_id_fk" FOREIGN KEY ("price_id") REFERENCES "public"."product_prices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_price_id_product_prices_id_fk" FOREIGN KEY ("price_id") REFERENCES "public"."product_prices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_subscriptions_tenantId_idx" ON "member_subscriptions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "member_subscriptions_tenant_member_idx" ON "member_subscriptions" USING btree ("tenant_id","member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_subscriptions_provider_sub_uidx" ON "member_subscriptions" USING btree ("tenant_id","provider_subscription_id") WHERE "member_subscriptions"."provider_subscription_id" is not null;--> statement-breakpoint
CREATE INDEX "orders_tenant_created_idx" ON "orders" USING btree ("tenant_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "orders_tenant_member_idx" ON "orders" USING btree ("tenant_id","member_id");--> statement-breakpoint
CREATE INDEX "orders_tenant_product_idx" ON "orders" USING btree ("tenant_id","product_id");--> statement-breakpoint
CREATE INDEX "product_prices_tenantId_idx" ON "product_prices" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "product_prices_tenant_product_idx" ON "product_prices" USING btree ("tenant_id","product_id");--> statement-breakpoint
INSERT INTO "product_prices" ("id", "tenant_id", "product_id", "kind", "interval", "amount_cents", "currency", "active", "created_at")
SELECT 'price-' || "id", "tenant_id", "id", 'one_time', NULL, "price_cents", "currency", true, "created_at"
FROM "products"
ON CONFLICT ("id") DO NOTHING;
