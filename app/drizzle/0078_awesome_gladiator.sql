CREATE TABLE "api_key_rate_limit_buckets" (
	"api_key_id" text NOT NULL,
	"period" text NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "api_key_rate_limit_buckets_api_key_id_period_pk" PRIMARY KEY("api_key_id","period")
);
--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "source_app" text;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "tenant_transport_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "marketing_idempotency_keys" ADD COLUMN "resource_id" text;--> statement-breakpoint
ALTER TABLE "tenant_api_keys" ADD COLUMN "scopes" jsonb;--> statement-breakpoint
ALTER TABLE "api_key_rate_limit_buckets" ADD CONSTRAINT "api_key_rate_limit_buckets_api_key_id_tenant_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."tenant_api_keys"("id") ON DELETE cascade ON UPDATE no action;