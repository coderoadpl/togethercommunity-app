CREATE TABLE "post_report_events" (
	"id" text PRIMARY KEY NOT NULL,
	"sequence" bigserial NOT NULL,
	"tenant_id" text NOT NULL,
	"report_id" text NOT NULL,
	"post_id" text NOT NULL,
	"type" text NOT NULL,
	"occurred_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"post_id" text NOT NULL,
	"reporter_user_id" text,
	"reporter_display" text,
	"source" text NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"signals" jsonb,
	"status" text NOT NULL,
	"created_at" text NOT NULL,
	"resolved_at" text,
	"resolved_by_user_id" text
);
--> statement-breakpoint
ALTER TABLE "post_report_events" ADD CONSTRAINT "post_report_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_report_events" ADD CONSTRAINT "post_report_events_report_id_post_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."post_reports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_reports" ADD CONSTRAINT "post_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_reports" ADD CONSTRAINT "post_reports_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "post_report_events_tenant_report_occurred_idx" ON "post_report_events" USING btree ("tenant_id","report_id","occurred_at","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "post_reports_tenant_post_reporter_uidx" ON "post_reports" USING btree ("tenant_id","post_id","reporter_user_id") WHERE "post_reports"."reporter_user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "post_reports_tenant_post_heuristic_uidx" ON "post_reports" USING btree ("tenant_id","post_id") WHERE "post_reports"."source" = 'heuristic';--> statement-breakpoint
CREATE INDEX "post_reports_tenant_status_created_idx" ON "post_reports" USING btree ("tenant_id","status","created_at" DESC NULLS LAST,"id");