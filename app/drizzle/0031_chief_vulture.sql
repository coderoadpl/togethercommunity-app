CREATE TABLE "email_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"mail_kind" text NOT NULL,
	"ref_id" text NOT NULL,
	"type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "ses_message_id" text;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "delivery_status" text;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "delivery_occurred_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "email_events_tenant_ref_occurred_idx" ON "email_events" USING btree ("tenant_id","ref_id","occurred_at");--> statement-breakpoint
CREATE INDEX "email_events_tenant_occurred_idx" ON "email_events" USING btree ("tenant_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "email_outbox_ses_message_id_uidx" ON "email_outbox" USING btree ("ses_message_id") WHERE "email_outbox"."ses_message_id" is not null;