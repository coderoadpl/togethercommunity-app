CREATE TABLE "marketing_throttle_buckets" (
	"tenant_id" text PRIMARY KEY NOT NULL,
	"tokens" double precision NOT NULL,
	"last_refill_at" timestamp with time zone NOT NULL,
	"quota_snapshot_at" timestamp with time zone NOT NULL,
	"reserved_since_snapshot" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_ses_settings" ADD COLUMN "quota_sent_last_24_hours" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "marketing_throttle_buckets" ADD CONSTRAINT "marketing_throttle_buckets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;