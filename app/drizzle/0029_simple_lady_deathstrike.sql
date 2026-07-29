ALTER TABLE "dev_emails" ADD COLUMN "headers" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "dev_emails" ADD COLUMN "message_id" text;