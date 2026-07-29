CREATE TABLE "coupon_checkout_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"coupon_id" text NOT NULL,
	"provider_session_id" text,
	"member_email" text NOT NULL,
	"product_id" text NOT NULL,
	"price_id" text,
	"original_cents" integer NOT NULL,
	"discount_cents" integer NOT NULL,
	"final_cents" integer NOT NULL,
	"started_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coupon_redemptions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"coupon_id" text NOT NULL,
	"order_id" text NOT NULL,
	"member_id" text NOT NULL,
	"email" text NOT NULL,
	"discount_cents" integer NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"value" integer NOT NULL,
	"scope" jsonb NOT NULL,
	"applies_to" text NOT NULL,
	"recurring_duration" text DEFAULT 'first_invoice' NOT NULL,
	"starts_at" text,
	"ends_at" text,
	"max_redemptions" integer,
	"max_redemptions_per_member" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"partner_label" text,
	"stripe_coupon_id" text,
	"stripe_promotion_code_id" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_price_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"product_id" text NOT NULL,
	"price_id" text,
	"amount_cents" integer NOT NULL,
	"effective_from" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member_subscriptions" ADD COLUMN "coupon_id" text;--> statement-breakpoint
ALTER TABLE "member_subscriptions" ADD COLUMN "coupon_discount_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "member_subscriptions" ADD COLUMN "coupon_recurring_duration" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "coupon_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "discount_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "coupon_checkout_sessions" ADD CONSTRAINT "coupon_checkout_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_checkout_sessions" ADD CONSTRAINT "coupon_checkout_sessions_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_checkout_sessions" ADD CONSTRAINT "coupon_checkout_sessions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_checkout_sessions" ADD CONSTRAINT "coupon_checkout_sessions_price_id_product_prices_id_fk" FOREIGN KEY ("price_id") REFERENCES "public"."product_prices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_price_history" ADD CONSTRAINT "product_price_history_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_price_history" ADD CONSTRAINT "product_price_history_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_price_history" ADD CONSTRAINT "product_price_history_price_id_product_prices_id_fk" FOREIGN KEY ("price_id") REFERENCES "public"."product_prices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coupon_checkout_sessions_tenant_coupon_started_idx" ON "coupon_checkout_sessions" USING btree ("tenant_id","coupon_id","started_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE UNIQUE INDEX "coupon_redemptions_order_uidx" ON "coupon_redemptions" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "coupon_redemptions_tenant_coupon_created_idx" ON "coupon_redemptions" USING btree ("tenant_id","coupon_id","created_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "coupon_redemptions_tenant_coupon_member_idx" ON "coupon_redemptions" USING btree ("tenant_id","coupon_id","member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coupons_tenant_code_uidx" ON "coupons" USING btree ("tenant_id",upper("code"));--> statement-breakpoint
CREATE INDEX "coupons_tenant_partner_created_idx" ON "coupons" USING btree ("tenant_id","partner_label","created_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "product_price_history_lookup_idx" ON "product_price_history" USING btree ("tenant_id","product_id","price_id","effective_from" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "member_subscriptions" ADD CONSTRAINT "member_subscriptions_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_tenant_coupon_created_idx" ON "orders" USING btree ("tenant_id","coupon_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_value_check" CHECK ("value" >= 0 AND ("kind" <> 'percent' OR "value" <= 100));--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_validity_check" CHECK ("starts_at" IS NULL OR "ends_at" IS NULL OR "starts_at" < "ends_at");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_discount_check" CHECK ("discount_cents" >= 0 AND "discount_cents" + "amount_cents" >= "discount_cents");--> statement-breakpoint
INSERT INTO "product_price_history" ("tenant_id", "product_id", "price_id", "amount_cents", "effective_from")
SELECT "tenant_id", "id", NULL, "price_cents", "created_at" FROM "products";--> statement-breakpoint
INSERT INTO "product_price_history" ("tenant_id", "product_id", "price_id", "amount_cents", "effective_from")
SELECT "tenant_id", "product_id", "id", "amount_cents", "created_at" FROM "product_prices";--> statement-breakpoint
CREATE FUNCTION append_product_base_price_history() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.price_cents IS DISTINCT FROM OLD.price_cents THEN
    INSERT INTO product_price_history (tenant_id, product_id, price_id, amount_cents, effective_from)
    VALUES (NEW.tenant_id, NEW.id, NULL, NEW.price_cents, COALESCE(NEW.created_at, CURRENT_TIMESTAMP::text));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER products_price_history_after_write
AFTER INSERT OR UPDATE OF price_cents ON products
FOR EACH ROW EXECUTE FUNCTION append_product_base_price_history();--> statement-breakpoint
CREATE FUNCTION append_product_price_history() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents THEN
    INSERT INTO product_price_history (tenant_id, product_id, price_id, amount_cents, effective_from)
    VALUES (NEW.tenant_id, NEW.product_id, NEW.id, NEW.amount_cents, COALESCE(NEW.created_at, CURRENT_TIMESTAMP::text));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER product_prices_history_after_write
AFTER INSERT OR UPDATE OF amount_cents ON product_prices
FOR EACH ROW EXECUTE FUNCTION append_product_price_history();
