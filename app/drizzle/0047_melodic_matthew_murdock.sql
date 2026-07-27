CREATE TABLE "coupon_events" (
	"id" text PRIMARY KEY NOT NULL,
	"sequence" bigserial NOT NULL,
	"tenant_id" text NOT NULL,
	"coupon_id" text NOT NULL,
	"type" text NOT NULL,
	"occurred_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coupon_redemption_events" (
	"id" text PRIMARY KEY NOT NULL,
	"sequence" bigserial NOT NULL,
	"tenant_id" text NOT NULL,
	"redemption_id" text NOT NULL,
	"coupon_id" text NOT NULL,
	"order_id" text NOT NULL,
	"type" text NOT NULL,
	"occurred_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "coupon_events" ADD CONSTRAINT "coupon_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_events" ADD CONSTRAINT "coupon_events_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemption_events" ADD CONSTRAINT "coupon_redemption_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemption_events" ADD CONSTRAINT "coupon_redemption_events_redemption_id_coupon_redemptions_id_fk" FOREIGN KEY ("redemption_id") REFERENCES "public"."coupon_redemptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemption_events" ADD CONSTRAINT "coupon_redemption_events_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemption_events" ADD CONSTRAINT "coupon_redemption_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coupon_events_tenant_coupon_occurred_idx" ON "coupon_events" USING btree ("tenant_id","coupon_id","occurred_at","sequence");--> statement-breakpoint
CREATE INDEX "coupon_redemption_events_tenant_redemption_occurred_idx" ON "coupon_redemption_events" USING btree ("tenant_id","redemption_id","occurred_at","sequence");