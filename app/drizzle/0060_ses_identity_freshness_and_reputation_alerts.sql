ALTER TABLE "tenant_ses_settings" ADD COLUMN "identity_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenant_ses_settings" ADD COLUMN "identity_check_error" text;--> statement-breakpoint
ALTER TABLE "tenant_ses_settings" ADD COLUMN "reputation_alert_status" text;--> statement-breakpoint
ALTER TABLE "tenant_ses_settings" ADD COLUMN "reputation_alerted_at" timestamp with time zone;
