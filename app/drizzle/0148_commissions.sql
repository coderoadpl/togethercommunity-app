CREATE TABLE commissions (
 id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 order_id text NOT NULL REFERENCES orders(id), order_line_id text NOT NULL,
 program_id text NOT NULL REFERENCES partner_programs(id), partner_id text NOT NULL REFERENCES partners(id),
 partner_code_id text NOT NULL REFERENCES partner_codes(id), base_cents integer NOT NULL CHECK (base_cents >= 0),
 pct integer NOT NULL CHECK (pct BETWEEN 0 AND 100), amount_cents integer NOT NULL CHECK (amount_cents >= 0),
 status text NOT NULL CHECK (status IN ('pending','payable','paid','voided')), payable_at timestamptz NOT NULL,
 voided_reason text, payout_id text, created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX commissions_order_line_uidx ON commissions(tenant_id, order_id, order_line_id);
ALTER TABLE orders ADD COLUMN partner_code_id text REFERENCES partner_codes(id);
