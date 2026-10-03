CREATE TABLE telemetry_connections (
  tenant_id text PRIMARY KEY,
  settings jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE telemetry_accounting (
  tenant_id text PRIMARY KEY,
  pending_bytes integer NOT NULL DEFAULT 0,
  last_acknowledged_sequence bigint NOT NULL DEFAULT 0,
  last_acknowledged_at timestamptz,
  gap_count integer NOT NULL DEFAULT 0,
  gap_from timestamptz,
  gap_through timestamptz,
  CONSTRAINT telemetry_pending_bytes_nonnegative CHECK (pending_bytes >= 0)
);
--> statement-breakpoint
CREATE TABLE telemetry_outbox (
  sequence bigserial PRIMARY KEY,
  tenant_id text NOT NULL,
  event_id text NOT NULL,
  event jsonb NOT NULL,
  charged_bytes integer NOT NULL,
  created_at timestamptz NOT NULL,
  retry_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE UNIQUE INDEX telemetry_outbox_event_unique ON telemetry_outbox (tenant_id, event_id);
--> statement-breakpoint
CREATE INDEX telemetry_outbox_tenant_sequence ON telemetry_outbox (tenant_id, sequence);
