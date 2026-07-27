CREATE TABLE "checkout_consent_captures" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"capture" jsonb NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "erased_member_imports" (
	"member_id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"legacy_id" text,
	"email_hmac" text NOT NULL,
	"erased_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "checkout_consent_captures" ADD CONSTRAINT "checkout_consent_captures_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erased_member_imports" ADD CONSTRAINT "erased_member_imports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checkout_consent_captures_tenant_created_idx" ON "checkout_consent_captures" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "erased_member_imports_tenant_email_hmac_idx" ON "erased_member_imports" USING btree ("tenant_id","email_hmac");--> statement-breakpoint
CREATE UNIQUE INDEX "erased_member_imports_tenant_legacy_uidx" ON "erased_member_imports" USING btree ("tenant_id","legacy_id") WHERE "erased_member_imports"."legacy_id" is not null;