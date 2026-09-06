ALTER TABLE "tenant_redirects" ADD COLUMN "origin" text DEFAULT 'import' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_redirects" ADD COLUMN "created_by" text;
