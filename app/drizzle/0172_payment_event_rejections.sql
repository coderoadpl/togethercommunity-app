CREATE TABLE "payment_event_rejections" (
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "event_id" text NOT NULL,
  "event_type" text NOT NULL,
  "checkout_session_id" text,
  "reason_code" text NOT NULL,
  "reason_message" text NOT NULL,
  "first_seen_at" timestamp with time zone NOT NULL,
  "last_seen_at" timestamp with time zone NOT NULL,
  "attempts" integer DEFAULT 1 NOT NULL CONSTRAINT "payment_event_rejections_attempts_check" CHECK ("attempts" > 0),
  "resolved_at" timestamp with time zone,
  CONSTRAINT "payment_event_rejections_tenant_id_event_id_pk" PRIMARY KEY ("tenant_id", "event_id")
);
--> statement-breakpoint
CREATE INDEX "payment_event_rejections_unresolved_idx" ON "payment_event_rejections" ("tenant_id", "last_seen_at") WHERE "resolved_at" IS NULL;
