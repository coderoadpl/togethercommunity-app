ALTER TABLE sales_links ADD COLUMN allows_codes boolean NOT NULL DEFAULT false;
ALTER TABLE checkout_snapshots ADD COLUMN partner_code_id text;
ALTER TABLE checkout_snapshots ADD COLUMN discount_cents integer NOT NULL DEFAULT 0;
ALTER TABLE checkout_snapshots ADD COLUMN partner_terms jsonb;
