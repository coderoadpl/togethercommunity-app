CREATE TABLE "dev_magic_links" (
	"email" text PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"token" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"member_id" text NOT NULL,
	"product_id" text NOT NULL,
	"source" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_grants" ADD CONSTRAINT "product_grants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_grants" ADD CONSTRAINT "product_grants_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_grants" ADD CONSTRAINT "product_grants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_grants_tenantId_idx" ON "product_grants" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "product_grants_memberId_idx" ON "product_grants" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_grants_tenant_member_product_uidx" ON "product_grants" USING btree ("tenant_id","member_id","product_id");