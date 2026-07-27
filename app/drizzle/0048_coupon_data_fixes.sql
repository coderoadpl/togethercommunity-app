CREATE OR REPLACE FUNCTION append_product_base_price_history() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO product_price_history (tenant_id, product_id, price_id, amount_cents, effective_from)
    VALUES (NEW.tenant_id, NEW.id, NULL, NEW.price_cents, NEW.created_at);
  ELSIF NEW.price_cents IS DISTINCT FROM OLD.price_cents THEN
    INSERT INTO product_price_history (tenant_id, product_id, price_id, amount_cents, effective_from)
    VALUES (
      NEW.tenant_id,
      NEW.id,
      NULL,
      NEW.price_cents,
      to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION append_product_price_history() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO product_price_history (tenant_id, product_id, price_id, amount_cents, effective_from)
    VALUES (NEW.tenant_id, NEW.product_id, NEW.id, NEW.amount_cents, NEW.created_at);
  ELSIF NEW.amount_cents IS DISTINCT FROM OLD.amount_cents THEN
    INSERT INTO product_price_history (tenant_id, product_id, price_id, amount_cents, effective_from)
    VALUES (
      NEW.tenant_id,
      NEW.product_id,
      NEW.id,
      NEW.amount_cents,
      to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
