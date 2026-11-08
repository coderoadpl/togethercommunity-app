ALTER TABLE tenants
  ADD COLUMN analytics_meta_capi_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN analytics_meta_capi_test_event_code text,
  ADD COLUMN analytics_meta_capi_consent_heading text,
  ADD COLUMN analytics_meta_capi_consent_body text,
  ADD COLUMN analytics_meta_capi_consent_accept_label text,
  ADD COLUMN analytics_meta_capi_consent_decline_label text;
--> statement-breakpoint
ALTER TABLE orders
  ADD COLUMN meta_capi_consent text NOT NULL DEFAULT 'undecided' CHECK (meta_capi_consent IN ('undecided', 'granted', 'denied')),
  ADD COLUMN meta_capi_consent_at text,
  ADD COLUMN meta_capi_consent_text_version text,
  ADD COLUMN meta_capi_consent_source text,
  ADD COLUMN meta_capi_consent_withdrawn_at text;
--> statement-breakpoint
CREATE UNIQUE INDEX orders_tenant_id_uidx ON orders (tenant_id, id);
--> statement-breakpoint
CREATE TABLE meta_capi_events (
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  transaction_id text PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  order_id text NOT NULL,
  consent_at text,
  event_time text,
  sent_at text,
  recorded_at text NOT NULL,
  status text NOT NULL CHECK (status IN ('sent', 'blocked', 'expired', 'failed')),
  fbtrace_id text,
  error text,
  fields_sent jsonb NOT NULL,
  CONSTRAINT meta_capi_events_tenant_order_fk FOREIGN KEY (tenant_id, order_id) REFERENCES orders(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX meta_capi_events_tenant_recorded_idx ON meta_capi_events (tenant_id, recorded_at);
--> statement-breakpoint
CREATE TABLE meta_capi_outbox (
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id text PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  attempts integer NOT NULL DEFAULT 0,
  available_at text NOT NULL,
  ip text,
  user_agent text,
  fbp text,
  text_version text NOT NULL,
  text_snapshot text NOT NULL,
  consent_at text NOT NULL,
  CONSTRAINT meta_capi_outbox_tenant_order_fk FOREIGN KEY (tenant_id, order_id) REFERENCES orders(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX meta_capi_outbox_due_idx ON meta_capi_outbox (tenant_id, available_at);
--> statement-breakpoint
CREATE TABLE meta_capi_consent_evidence (
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id text NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('granted', 'denied', 'withdrawn')),
  occurred_at text NOT NULL,
  text_version text NOT NULL,
  text_snapshot text NOT NULL,
  source text NOT NULL,
  PRIMARY KEY (tenant_id, order_id, decision),
  CONSTRAINT meta_capi_consent_tenant_order_fk FOREIGN KEY (tenant_id, order_id) REFERENCES orders(tenant_id, id) ON DELETE CASCADE
);
