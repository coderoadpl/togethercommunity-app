CREATE TABLE "checkout_consent_jobs" (
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "checkout_session_id" text NOT NULL,
  "webhook_event_id" text NOT NULL,
  "capture_id" text NOT NULL,
  "email" text NOT NULL,
  "order_id" text NOT NULL REFERENCES "orders"("id") ON DELETE RESTRICT,
  "product_id" text NOT NULL,
  "reason" text NOT NULL,
  "created_at" text NOT NULL,
  "completed_at" text,
  PRIMARY KEY ("tenant_id", "checkout_session_id")
);
