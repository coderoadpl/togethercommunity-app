ALTER TABLE checkout_snapshots ADD COLUMN mode text CHECK (mode IN ('live', 'test'));
ALTER TABLE checkout_snapshots ADD COLUMN provider_session_id text;
CREATE UNIQUE INDEX checkout_snapshots_provider_session_idx ON checkout_snapshots (tenant_id, provider_session_id) WHERE provider_session_id IS NOT NULL;
ALTER TABLE orders ADD COLUMN customer_details jsonb;
