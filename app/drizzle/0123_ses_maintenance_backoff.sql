ALTER TABLE "tenant_ses_settings" ADD COLUMN "maintenance_attempts" integer DEFAULT 0 NOT NULL;
ALTER TABLE "tenant_ses_settings" ADD COLUMN "maintenance_retry_at" timestamp with time zone;
