CREATE TABLE "tenant_secrets" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"key" text NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"masked_preview" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_secrets" ADD CONSTRAINT "tenant_secrets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tenant_secrets_tenantId_idx" ON "tenant_secrets" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_secrets_tenant_key_uidx" ON "tenant_secrets" USING btree ("tenant_id","key");