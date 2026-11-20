ALTER TABLE "orders" ADD COLUMN "cancel_reason" text;
--> statement-breakpoint
CREATE TABLE "order_refund_jobs" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "order_id" text NOT NULL,
  "payment_intent_id" text,
  "amount_cents" integer NOT NULL CONSTRAINT "order_refund_jobs_amount_check" CHECK ("amount_cents" > 0),
  "currency" text NOT NULL,
  "reason" text NOT NULL CONSTRAINT "order_refund_jobs_reason_check" CHECK ("reason" IN ('out_of_stock')),
  "idempotency_key" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL CONSTRAINT "order_refund_jobs_status_check" CHECK ("status" IN ('pending', 'running', 'submitted', 'succeeded', 'failed', 'blocked_permission', 'skipped_refunded')),
  "attempts" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone,
  "locked_at" timestamp with time zone,
  "last_error" text,
  "provider_refund_id" text,
  "provider_refund_status" text,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "order_refund_jobs_tenant_order_fk" FOREIGN KEY ("tenant_id", "order_id") REFERENCES "orders"("tenant_id", "id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "order_refund_jobs_tenant_order_uidx" ON "order_refund_jobs" ("tenant_id", "order_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "order_refund_jobs_idempotency_key_uidx" ON "order_refund_jobs" ("idempotency_key");
--> statement-breakpoint
CREATE INDEX "order_refund_jobs_due_idx" ON "order_refund_jobs" ("status", "next_attempt_at");
