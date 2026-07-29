CREATE TABLE "spaces" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"visibility" text NOT NULL,
	"product_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_reactions" (
	"tenant_id" text NOT NULL,
	"post_id" text NOT NULL,
	"user_id" text NOT NULL,
	"emoji" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "space_subscriptions" (
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"space_id" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_reactions" ADD CONSTRAINT "post_reactions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_reactions" ADD CONSTRAINT "post_reactions_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_subscriptions" ADD CONSTRAINT "space_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_subscriptions" ADD CONSTRAINT "space_subscriptions_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "spaces_tenantId_idx" ON "spaces" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "spaces_tenant_slug_uidx" ON "spaces" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE INDEX "post_reactions_tenant_post_idx" ON "post_reactions" USING btree ("tenant_id","post_id");--> statement-breakpoint
CREATE UNIQUE INDEX "post_reactions_post_user_emoji_uidx" ON "post_reactions" USING btree ("post_id","user_id","emoji");--> statement-breakpoint
CREATE INDEX "space_subscriptions_tenant_space_idx" ON "space_subscriptions" USING btree ("tenant_id","space_id");--> statement-breakpoint
CREATE UNIQUE INDEX "space_subscriptions_tenant_user_space_uidx" ON "space_subscriptions" USING btree ("tenant_id","user_id","space_id");
