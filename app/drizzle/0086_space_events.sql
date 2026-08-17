CREATE TABLE "space_event_rsvps" (
	"tenant_id" text NOT NULL,
	"event_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "space_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"space_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"starts_at" text NOT NULL,
	"ends_at" text NOT NULL,
	"location" text,
	"url" text,
	"live_embed_url" text,
	"replay_url" text,
	"discussion_root_post_id" text,
	"created_by_user_id" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text,
	"deleted_at" text
);
--> statement-breakpoint
ALTER TABLE "space_event_rsvps" ADD CONSTRAINT "space_event_rsvps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_event_rsvps" ADD CONSTRAINT "space_event_rsvps_event_id_space_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."space_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_events" ADD CONSTRAINT "space_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_events" ADD CONSTRAINT "space_events_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "space_event_rsvps_tenant_event_idx" ON "space_event_rsvps" USING btree ("tenant_id","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "space_event_rsvps_tenant_event_user_uidx" ON "space_event_rsvps" USING btree ("tenant_id","event_id","user_id");--> statement-breakpoint
CREATE INDEX "space_events_tenant_space_starts_idx" ON "space_events" USING btree ("tenant_id","space_id","starts_at");--> statement-breakpoint
CREATE INDEX "space_events_tenant_starts_idx" ON "space_events" USING btree ("tenant_id","starts_at");