CREATE TABLE order_issue_events (
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id text NOT NULL,
  product_id text NOT NULL,
  issued_count integer NOT NULL,
  staff_user_id text NOT NULL,
  occurred_at timestamp with time zone NOT NULL,
  PRIMARY KEY (tenant_id, order_id, product_id, issued_count)
);
