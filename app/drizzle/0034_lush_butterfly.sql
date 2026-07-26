CREATE TABLE "scheduler_run_tenants" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"campaigns_touched" integer NOT NULL,
	"batch_size" integer NOT NULL,
	"sent" integer NOT NULL,
	"failed" integer NOT NULL,
	"skipped" integer NOT NULL,
	"budget_computed" integer NOT NULL,
	"budget_used" integer NOT NULL,
	"errors" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduler_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"trigger" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"status" text NOT NULL,
	"error" text,
	"totals" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_sends" ADD COLUMN "run_id" text;--> statement-breakpoint
ALTER TABLE "scheduler_run_tenants" ADD CONSTRAINT "scheduler_run_tenants_run_id_scheduler_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."scheduler_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduler_run_tenants" ADD CONSTRAINT "scheduler_run_tenants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scheduler_run_tenants_run_tenant_uidx" ON "scheduler_run_tenants" USING btree ("run_id","tenant_id");--> statement-breakpoint
CREATE INDEX "scheduler_run_tenants_tenant_run_idx" ON "scheduler_run_tenants" USING btree ("tenant_id","run_id");--> statement-breakpoint
CREATE INDEX "scheduler_runs_started_id_idx" ON "scheduler_runs" USING btree ("started_at","id");--> statement-breakpoint
CREATE INDEX "scheduler_runs_status_started_idx" ON "scheduler_runs" USING btree ("status","started_at");--> statement-breakpoint
ALTER TABLE "campaign_sends" ADD CONSTRAINT "campaign_sends_run_id_scheduler_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."scheduler_runs"("id") ON DELETE set null ON UPDATE no action;