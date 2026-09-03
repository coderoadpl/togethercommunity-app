CREATE TABLE "platform_audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_email" text NOT NULL,
	"environment" text NOT NULL,
	"status" text NOT NULL,
	"detail" text,
	"duration_ms" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "platform_audit_events_created_idx" ON "platform_audit_events" USING btree ("created_at","id");