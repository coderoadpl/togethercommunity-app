ALTER TABLE "tenant_domains" ADD COLUMN "provider" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_domains" ADD COLUMN "verification" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_domains" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_domains" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenant_domains" ADD COLUMN "last_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenant_domains" ADD COLUMN "last_error" text;--> statement-breakpoint
UPDATE "tenant_domains" SET "verified_at" = now() WHERE "verified" = true;--> statement-breakpoint
CREATE INDEX "tenant_domains_pending_idx" ON "tenant_domains" USING btree ("kind","verified","last_checked_at");--> statement-breakpoint
CREATE TABLE "tenant_domain_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"domain" text NOT NULL,
	"kind" text NOT NULL,
	"actor_user_id" text,
	"detail" text,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_domain_events" ADD CONSTRAINT "tenant_domain_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tenant_domain_events_tenant_at_idx" ON "tenant_domain_events" USING btree ("tenant_id","at","id");
