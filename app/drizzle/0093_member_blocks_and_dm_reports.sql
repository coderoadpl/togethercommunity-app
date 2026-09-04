CREATE TABLE "dm_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"reporter_user_id" text NOT NULL,
	"reporter_display" text NOT NULL,
	"reported_user_id" text NOT NULL,
	"reported_display" text NOT NULL,
	"reason" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"status" text NOT NULL,
	"created_at" text NOT NULL,
	"resolved_at" text,
	"resolved_by_user_id" text
);
--> statement-breakpoint
CREATE TABLE "member_blocks" (
	"tenant_id" text NOT NULL,
	"blocker_user_id" text NOT NULL,
	"blocked_user_id" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "direct_messages_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "dm_reports" ADD CONSTRAINT "dm_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dm_reports" ADD CONSTRAINT "dm_reports_conversation_id_dm_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."dm_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_blocks" ADD CONSTRAINT "member_blocks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dm_reports_tenant_conversation_reporter_open_uidx" ON "dm_reports" USING btree ("tenant_id","conversation_id","reporter_user_id") WHERE "dm_reports"."status" = 'open';--> statement-breakpoint
CREATE INDEX "dm_reports_tenant_status_created_idx" ON "dm_reports" USING btree ("tenant_id","status","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "member_blocks_tenant_blocker_blocked_uidx" ON "member_blocks" USING btree ("tenant_id","blocker_user_id","blocked_user_id");--> statement-breakpoint
CREATE INDEX "member_blocks_tenant_blocked_idx" ON "member_blocks" USING btree ("tenant_id","blocked_user_id");