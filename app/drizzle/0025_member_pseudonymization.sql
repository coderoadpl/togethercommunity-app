ALTER TABLE "members" ADD COLUMN "deleted_at" text;--> statement-breakpoint
ALTER TABLE "member_subscriptions" DROP CONSTRAINT "member_subscriptions_member_id_members_id_fk";
--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_member_id_members_id_fk";
--> statement-breakpoint
ALTER TABLE "product_grants" DROP CONSTRAINT "product_grants_member_id_members_id_fk";
--> statement-breakpoint
ALTER TABLE "member_subscriptions" ADD CONSTRAINT "member_subscriptions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_grants" ADD CONSTRAINT "product_grants_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;
