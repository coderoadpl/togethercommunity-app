ALTER TABLE "order_refund_jobs" ADD COLUMN "submitted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "order_refund_jobs" ADD COLUMN "status_checks" integer DEFAULT 0 NOT NULL;
