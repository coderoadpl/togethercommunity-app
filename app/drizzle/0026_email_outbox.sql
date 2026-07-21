CREATE TABLE "email_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"kind" text NOT NULL,
	"to" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "email_outbox_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "email_outbox_status_check" CHECK ("status" IN ('queued', 'sending', 'sent', 'failed'))
);
--> statement-breakpoint
CREATE INDEX "email_outbox_dispatch_idx" ON "email_outbox" USING btree ("status","next_attempt_at");
