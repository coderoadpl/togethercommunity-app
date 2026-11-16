ALTER TABLE "order_refund_jobs" ADD COLUMN "submitted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "order_refund_jobs" ADD COLUMN "status_checks" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "order_refund_jobs" ADD COLUMN "key_generation" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "order_refund_jobs" ADD COLUMN "permission_blocked_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "order_refund_jobs" ADD COLUMN "transient_failure_streak" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "order_refund_jobs" DROP CONSTRAINT "order_refund_jobs_status_check";
--> statement-breakpoint
ALTER TABLE "order_refund_jobs" ADD CONSTRAINT "order_refund_jobs_status_check" CHECK ("status" IN ('pending', 'running', 'submitted', 'succeeded', 'failed', 'blocked_permission', 'skipped_refunded', 'resolved_externally', 'unconfirmed'));
