ALTER TABLE "members" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "marketing_consents" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "external_customer_ids" jsonb DEFAULT '{}'::jsonb NOT NULL;