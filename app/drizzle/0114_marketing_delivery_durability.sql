CREATE TABLE "marketing_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"campaign_send_id" text NOT NULL,
	"payload" jsonb,
	"payload_purged_at" timestamp with time zone,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"locked_by" text,
	"locked_until" timestamp with time zone,
	"claim_version" integer DEFAULT 0 NOT NULL,
	"ses_message_id" text,
	"last_error" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_sns_inbox" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"topic_arn" text NOT NULL,
	"sns_message_id" text NOT NULL,
	"message_type" text NOT NULL,
	"raw_body" text,
	"body_sha256" text NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"locked_by" text,
	"locked_until" timestamp with time zone,
	"claim_version" integer DEFAULT 0 NOT NULL,
	"processed_at" timestamp with time zone,
	"last_error" text,
	"ignore_reason" text
);
--> statement-breakpoint
CREATE TABLE "marketing_sns_inbox_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"inbox_id" text NOT NULL,
	"type" text NOT NULL,
	"actor" text,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "body_text" text;
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "reply_to" text;
--> statement-breakpoint
ALTER TABLE "tenant_ses_settings" ADD COLUMN "reply_to" text;
--> statement-breakpoint
ALTER TABLE "marketing_outbox" ADD CONSTRAINT "marketing_outbox_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "marketing_outbox" ADD CONSTRAINT "marketing_outbox_campaign_send_id_campaign_sends_id_fk" FOREIGN KEY ("campaign_send_id") REFERENCES "public"."campaign_sends"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "marketing_sns_inbox" ADD CONSTRAINT "marketing_sns_inbox_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "marketing_sns_inbox_events" ADD CONSTRAINT "marketing_sns_inbox_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "marketing_sns_inbox_events" ADD CONSTRAINT "marketing_sns_inbox_events_inbox_id_marketing_sns_inbox_id_fk" FOREIGN KEY ("inbox_id") REFERENCES "public"."marketing_sns_inbox"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_outbox_send_uidx" ON "marketing_outbox" USING btree ("tenant_id","campaign_send_id");
--> statement-breakpoint
CREATE INDEX "marketing_outbox_worker_idx" ON "marketing_outbox" USING btree ("tenant_id","status","next_attempt_at","locked_until");
--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_sns_inbox_receipt_uidx" ON "marketing_sns_inbox" USING btree ("tenant_id","topic_arn","sns_message_id");
--> statement-breakpoint
CREATE INDEX "marketing_sns_inbox_worker_idx" ON "marketing_sns_inbox" USING btree ("tenant_id","status","next_attempt_at","locked_until");
--> statement-breakpoint
CREATE INDEX "marketing_sns_inbox_events_tenant_idx" ON "marketing_sns_inbox_events" USING btree ("tenant_id","inbox_id");
