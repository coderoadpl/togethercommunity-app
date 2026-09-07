ALTER TABLE "tenant_domains" ADD COLUMN "records" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_domains" ADD COLUMN "provider_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "tenant_domains"
SET "records" = (
  SELECT coalesce(jsonb_agg(record || '{"purpose":"ownership"}'::jsonb), '[]'::jsonb)
  FROM jsonb_array_elements("verification") AS record
)
WHERE "kind" = 'custom';
