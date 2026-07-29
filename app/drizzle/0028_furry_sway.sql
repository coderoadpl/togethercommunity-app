CREATE TABLE "email_layouts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"body_html" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
DROP INDEX "campaign_sends_tenant_campaign_email_uidx";--> statement-breakpoint
ALTER TABLE "email_layouts" ADD CONSTRAINT "email_layouts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_layouts_tenant_name_uidx" ON "email_layouts" USING btree ("tenant_id","name");--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_layout_id_email_layouts_id_fk" FOREIGN KEY ("layout_id") REFERENCES "public"."email_layouts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_sends_tenant_campaign_email_uidx" ON "campaign_sends" USING btree ("tenant_id","campaign_id","email") WHERE "campaign_sends"."campaign_id" is not null and "campaign_sends"."source" = 'broadcast';