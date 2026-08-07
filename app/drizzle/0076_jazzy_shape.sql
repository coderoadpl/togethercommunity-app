CREATE TABLE "auto_invoice_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"webhook_event_id" text NOT NULL,
	"order_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"locked_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "auto_invoice_jobs_status_check" CHECK ("auto_invoice_jobs"."status" IN ('queued', 'running', 'completed'))
);
--> statement-breakpoint
ALTER TABLE "auto_invoice_jobs" ADD CONSTRAINT "auto_invoice_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_invoice_jobs" ADD CONSTRAINT "auto_invoice_jobs_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auto_invoice_jobs_webhook_event_uidx" ON "auto_invoice_jobs" USING btree ("webhook_event_id");--> statement-breakpoint
CREATE INDEX "auto_invoice_jobs_dispatch_idx" ON "auto_invoice_jobs" USING btree ("status","next_attempt_at");