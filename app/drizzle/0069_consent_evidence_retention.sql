DROP INDEX IF EXISTS "consents_retention_started_tenant_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "marketing_consents_retention_started_tenant_idx";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consents_tenant_retention_started_idx" ON "consents" USING btree ("tenant_id","retention_started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketing_consents_tenant_retention_started_idx" ON "marketing_consents" USING btree ("tenant_id","retention_started_at");