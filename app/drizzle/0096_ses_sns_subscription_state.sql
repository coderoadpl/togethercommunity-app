CREATE TABLE "sns_webhook_deliveries" (
	"tenant_id" text PRIMARY KEY NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"message_type" text NOT NULL,
	"outcome" text NOT NULL,
	"error_message" text,
	"source_ip" text,
	"user_agent" text
);
--> statement-breakpoint
ALTER TABLE "tenant_ses_settings" ADD COLUMN "sns_subscription_endpoint" text;--> statement-breakpoint
ALTER TABLE "tenant_ses_settings" ADD COLUMN "sns_subscription_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sns_webhook_deliveries" ADD CONSTRAINT "sns_webhook_deliveries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;