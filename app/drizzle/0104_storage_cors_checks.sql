CREATE TABLE "storage_cors_checks" (
	"tenant_id" text PRIMARY KEY NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"results" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "storage_cors_checks" ADD CONSTRAINT "storage_cors_checks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
