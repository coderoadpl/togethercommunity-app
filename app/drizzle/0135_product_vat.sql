ALTER TABLE products ADD COLUMN vat_rate jsonb;
ALTER TABLE products ADD COLUMN vat_exemption_basis text;
ALTER TABLE products ADD CONSTRAINT products_vat_rate_check CHECK (vat_rate IS NULL OR vat_rate IN ('5'::jsonb, '8'::jsonb, '23'::jsonb, '"exempt"'::jsonb));
