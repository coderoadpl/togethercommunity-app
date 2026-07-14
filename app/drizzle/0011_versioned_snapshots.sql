CREATE TABLE "entity_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"entity_kind" text NOT NULL,
	"entity_id" text NOT NULL,
	"schema_version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" text NOT NULL,
	"created_by" text
);
--> statement-breakpoint
ALTER TABLE "entity_versions" ADD CONSTRAINT "entity_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entity_versions_tenant_entity_created_idx" ON "entity_versions" USING btree ("tenant_id","entity_kind","entity_id","created_at" DESC);