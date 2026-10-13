CREATE TABLE partner_checkout_reservations (
 id text PRIMARY KEY REFERENCES checkout_snapshots(id),
 tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 partner_code_id text NOT NULL REFERENCES partner_codes(id),
 status text NOT NULL CHECK (status IN ('reserved', 'consumed', 'released')),
 order_id text REFERENCES orders(id), created_at timestamptz NOT NULL
);
CREATE INDEX partner_checkout_reservations_code_idx ON partner_checkout_reservations(tenant_id, partner_code_id);
