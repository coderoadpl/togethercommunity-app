ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "terms_url" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "privacy_url" text;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "consents" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text,
	"email" text,
	"source" text NOT NULL,
	"terms_url" text,
	"privacy_url" text,
	"accepted_at" text NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "consents" ADD CONSTRAINT "consents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consents_tenant_email_idx" ON "consents" ("tenant_id","email");
