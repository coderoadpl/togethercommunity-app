CREATE TABLE "processed_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"type" text NOT NULL,
	"object_id" text NOT NULL,
	"processed_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "processed_events" ADD CONSTRAINT "processed_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "processed_events_tenantId_idx" ON "processed_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "processed_events_object_type_uidx" ON "processed_events" USING btree ("object_id","type");