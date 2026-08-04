CREATE TABLE "import_audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"api_key_id" text NOT NULL,
	"kind" text NOT NULL,
	"import_key" text NOT NULL,
	"resource_id" text NOT NULL,
	"action" text NOT NULL,
	"payload_hash" text NOT NULL,
	"at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_api_keys" ADD COLUMN "expires_at" text;--> statement-breakpoint
ALTER TABLE "import_audit_events" ADD CONSTRAINT "import_audit_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_audit_events" ADD CONSTRAINT "import_audit_events_api_key_id_tenant_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."tenant_api_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_audit_events_tenant_api_key_at_idx" ON "import_audit_events" USING btree ("tenant_id","api_key_id","at");--> statement-breakpoint
CREATE INDEX "import_audit_events_tenant_kind_import_key_at_idx" ON "import_audit_events" USING btree ("tenant_id","kind","import_key","at");