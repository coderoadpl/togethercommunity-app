CREATE TABLE partner_codes (
 id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 program_id text NOT NULL REFERENCES partner_programs(id), partner_id text NOT NULL REFERENCES partners(id),
 code text NOT NULL CHECK (code ~ '^[A-Z0-9-]{2,40}$'), discount_pct integer NOT NULL CHECK (discount_pct BETWEEN 0 AND 100),
 sales_link_ids jsonb NOT NULL CHECK (jsonb_typeof(sales_link_ids) = 'array' AND jsonb_array_length(sales_link_ids) > 0),
 valid_from timestamptz, valid_to timestamptz, max_redemptions integer CHECK (max_redemptions > 0),
 status text NOT NULL CHECK (status IN ('active','archived')), stripe_coupon_id text, stripe_promotion_code_id text,
 created_at timestamptz NOT NULL, revision integer NOT NULL CHECK (revision > 0),
 CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_from < valid_to)
);
CREATE UNIQUE INDEX partner_codes_tenant_code_uidx ON partner_codes(tenant_id, lower(code));
