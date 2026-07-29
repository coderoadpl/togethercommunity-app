CREATE TABLE "tenant_api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"created_at" text NOT NULL,
	"revoked_at" text
);
--> statement-breakpoint
ALTER TABLE "tenant_api_keys" ADD CONSTRAINT "tenant_api_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tenant_api_keys_tenantId_idx" ON "tenant_api_keys" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_api_keys_key_hash_uidx" ON "tenant_api_keys" USING btree ("key_hash");