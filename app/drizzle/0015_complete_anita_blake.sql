CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"recipient_user_id" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"read_at" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"context_kind" text NOT NULL,
	"context_id" text NOT NULL,
	"parent_post_id" text,
	"root_post_id" text NOT NULL,
	"author_user_id" text NOT NULL,
	"author_display" text NOT NULL,
	"body" text NOT NULL,
	"created_at" text NOT NULL,
	"edited_at" text,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "thread_subscriptions" (
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"root_post_id" text NOT NULL,
	"created_at" text NOT NULL,
	"muted_at" text
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_parent_post_id_posts_id_fk" FOREIGN KEY ("parent_post_id") REFERENCES "public"."posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_root_post_id_posts_id_fk" FOREIGN KEY ("root_post_id") REFERENCES "public"."posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_subscriptions" ADD CONSTRAINT "thread_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "body_tsvector" tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce("body", ''))) STORED;--> statement-breakpoint
CREATE INDEX "notifications_tenant_recipient_read_created_idx" ON "notifications" USING btree ("tenant_id","recipient_user_id","read_at","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "posts_body_tsvector_gin_idx" ON "posts" USING gin ("body_tsvector");--> statement-breakpoint
CREATE INDEX "posts_tenant_context_created_idx" ON "posts" USING btree ("tenant_id","context_kind","context_id","created_at");--> statement-breakpoint
CREATE INDEX "posts_tenant_root_idx" ON "posts" USING btree ("tenant_id","root_post_id");--> statement-breakpoint
CREATE INDEX "thread_subscriptions_tenant_root_idx" ON "thread_subscriptions" USING btree ("tenant_id","root_post_id");--> statement-breakpoint
CREATE UNIQUE INDEX "thread_subscriptions_tenant_user_root_uidx" ON "thread_subscriptions" USING btree ("tenant_id","user_id","root_post_id");
