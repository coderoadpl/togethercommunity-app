CREATE TABLE "notification_fanout_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"kind" text NOT NULL,
	"source_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"cursor_user_id" text,
	"next_attempt_at" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "source_key" text;--> statement-breakpoint
ALTER TABLE "notification_fanout_jobs" ADD CONSTRAINT "notification_fanout_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_fanout_jobs_tenant_source_uidx" ON "notification_fanout_jobs" USING btree ("tenant_id","source_key");--> statement-breakpoint
CREATE INDEX "notification_fanout_jobs_due_idx" ON "notification_fanout_jobs" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_tenant_recipient_source_uidx" ON "notifications" USING btree ("tenant_id","recipient_user_id","source_key") WHERE "notifications"."source_key" is not null;