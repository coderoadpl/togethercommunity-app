ALTER TABLE orders ADD COLUMN sales_link_id text;
--> statement-breakpoint
ALTER TABLE orders ADD COLUMN lines jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE orders ADD COLUMN verification_token text NOT NULL DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
--> statement-breakpoint
CREATE UNIQUE INDEX orders_verification_token_uidx ON orders (verification_token);
--> statement-breakpoint
CREATE INDEX orders_tenant_sales_link_idx ON orders (tenant_id, sales_link_id);
--> statement-breakpoint
CREATE FUNCTION order_single_product_line(order_tenant_id text, order_product_id text, gross_cents integer) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_array(jsonb_build_object(
    'productId', p.id, 'name', p.title, 'productType', p.type,
    'grossCents', gross_cents,
    'netCents', CASE WHEN vat.rate IN ('5'::jsonb, '8'::jsonb, '23'::jsonb) THEN round(gross_cents::numeric * 100 / (100 + (vat.rate::text)::integer)) ELSE gross_cents END,
    'vatRate', vat.rate,
    'vatCents', CASE WHEN vat.rate IN ('5'::jsonb, '8'::jsonb, '23'::jsonb) THEN gross_cents - round(gross_cents::numeric * 100 / (100 + (vat.rate::text)::integer)) ELSE 0 END,
    'vatExemptionBasis', CASE WHEN vat.rate = '"exempt"'::jsonb THEN coalesce(p.vat_exemption_basis, t.invoice_exemption_basis) ELSE NULL END,
    'vatExemptionBasisKind', CASE WHEN vat.rate = '"exempt"'::jsonb THEN CASE WHEN p.vat_exemption_basis IS NULL OR p.vat_exemption_basis = t.invoice_exemption_basis THEN t.invoice_exemption_basis_kind ELSE 'other' END ELSE NULL END,
    'issuedCount', CASE WHEN p.type = 'physical' THEN 0 ELSE NULL END
  )) FROM products p JOIN tenants t ON t.id = p.tenant_id
  CROSS JOIN LATERAL (SELECT p.vat_rate AS rate) vat
  WHERE p.id = order_product_id AND p.tenant_id = order_tenant_id;
$$;
--> statement-breakpoint
UPDATE orders SET lines = order_single_product_line(tenant_id, product_id, amount_cents + discount_cents);
--> statement-breakpoint
CREATE FUNCTION capture_single_order_line() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.lines = '[]'::jsonb THEN
    NEW.lines := order_single_product_line(NEW.tenant_id, NEW.product_id, NEW.amount_cents + NEW.discount_cents);
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER orders_capture_single_line BEFORE INSERT ON orders FOR EACH ROW EXECUTE FUNCTION capture_single_order_line();
--> statement-breakpoint
CREATE TABLE checkout_snapshots (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sales_link_id text,
  lines jsonb NOT NULL,
  currency text NOT NULL,
  created_at text NOT NULL
);
