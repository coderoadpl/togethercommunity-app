CREATE TABLE order_changes (
  id bigserial PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id text NOT NULL,
  xact_id xid8 NOT NULL DEFAULT pg_current_xact_id(),
  changed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_changes_tenant_order_fk FOREIGN KEY (tenant_id, order_id) REFERENCES orders(tenant_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX order_changes_tenant_cursor_idx ON order_changes (tenant_id, xact_id, id);
--> statement-breakpoint
CREATE INDEX order_changes_tenant_order_idx ON order_changes (tenant_id, order_id);
--> statement-breakpoint
CREATE FUNCTION record_order_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO order_changes (tenant_id, order_id) VALUES (NEW.tenant_id, NEW.id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER orders_record_insert AFTER INSERT ON orders FOR EACH ROW EXECUTE FUNCTION record_order_change();
--> statement-breakpoint
CREATE TRIGGER orders_record_update AFTER UPDATE ON orders FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*) EXECUTE FUNCTION record_order_change();
--> statement-breakpoint
CREATE FUNCTION record_invoice_order_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO order_changes (tenant_id, order_id) VALUES (NEW.tenant_id, NEW.order_id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER invoices_record_insert AFTER INSERT ON invoices FOR EACH ROW EXECUTE FUNCTION record_invoice_order_change();
--> statement-breakpoint
CREATE TRIGGER invoices_record_update AFTER UPDATE ON invoices FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*) EXECUTE FUNCTION record_invoice_order_change();
--> statement-breakpoint
CREATE TABLE order_feed_epoch (
  singleton boolean PRIMARY KEY DEFAULT true CONSTRAINT order_feed_epoch_singleton_check CHECK (singleton),
  epoch text NOT NULL CONSTRAINT order_feed_epoch_epoch_check CHECK (epoch ~ '^[0-9a-f]{32}$'),
  rotated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
INSERT INTO order_feed_epoch (epoch) VALUES (replace(gen_random_uuid()::text, '-', ''));
