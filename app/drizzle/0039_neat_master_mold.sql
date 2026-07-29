CREATE TABLE "tenant_transactional_email_pools" (
	"tenant_id" text PRIMARY KEY NOT NULL,
	"sent" integer DEFAULT 0 NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "transport" text;--> statement-breakpoint
ALTER TABLE "tenant_transactional_email_pools" ADD CONSTRAINT "tenant_transactional_email_pools_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;