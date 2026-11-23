CREATE TABLE "order_staff_refunds" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "order_id" text NOT NULL,
  "payment_intent_id" text NOT NULL,
  "amount_cents" integer NOT NULL CONSTRAINT "order_staff_refunds_amount_check" CHECK ("amount_cents" > 0),
  "currency" text NOT NULL,
  "kind" text NOT NULL CONSTRAINT "order_staff_refunds_kind_check" CHECK ("kind" IN ('remainder', 'amount')),
  "request_key" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL CONSTRAINT "order_staff_refunds_status_check" CHECK ("status" IN ('pending', 'running', 'submitted', 'succeeded', 'failed', 'blocked_permission', 'skipped_refunded', 'resolved_externally', 'unconfirmed')),
  "attempts" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone,
  "locked_at" timestamp with time zone,
  "last_error" text,
  "provider_refund_id" text,
  "provider_refund_status" text,
  "submitted_at" timestamp with time zone,
  "status_checks" integer DEFAULT 0 NOT NULL,
  "key_generation" integer DEFAULT 0 NOT NULL,
  "permission_blocked_at" timestamp with time zone,
  "transient_failure_streak" integer DEFAULT 0 NOT NULL,
  "requested_by_user_id" text NOT NULL,
  "requested_by_email" text NOT NULL,
  "note" text CONSTRAINT "order_staff_refunds_note_check" CHECK (char_length("note") <= 500),
  "restocked" boolean DEFAULT false NOT NULL,
  "removed_from_packing_list" boolean DEFAULT false NOT NULL,
  "committed_sibling_ids" text[] DEFAULT '{}' NOT NULL,
  "buyer_notified_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "order_staff_refunds_tenant_order_fk" FOREIGN KEY ("tenant_id", "order_id") REFERENCES "orders"("tenant_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX "order_staff_refunds_tenant_request_key_uidx" ON "order_staff_refunds" ("tenant_id", "request_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "order_staff_refunds_tenant_order_waiting_uidx" ON "order_staff_refunds" ("tenant_id", "order_id") WHERE "status" IN ('pending', 'running', 'blocked_permission');
--> statement-breakpoint
CREATE UNIQUE INDEX "order_staff_refunds_idempotency_key_uidx" ON "order_staff_refunds" ("idempotency_key");
--> statement-breakpoint
CREATE INDEX "order_staff_refunds_due_idx" ON "order_staff_refunds" ("status", "next_attempt_at");
--> statement-breakpoint
CREATE INDEX "order_staff_refunds_tenant_order_idx" ON "order_staff_refunds" ("tenant_id", "order_id", "created_at");
--> statement-breakpoint
CREATE TRIGGER order_staff_refunds_record_insert AFTER INSERT ON order_staff_refunds FOR EACH ROW EXECUTE FUNCTION record_refund_job_order_change();
--> statement-breakpoint
CREATE TRIGGER order_staff_refunds_record_status AFTER UPDATE OF status ON order_staff_refunds FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION record_refund_job_order_change();
