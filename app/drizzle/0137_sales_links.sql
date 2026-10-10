CREATE TABLE sales_links (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slug text NOT NULL,
  title text NOT NULL,
  heading text NOT NULL,
  description text NOT NULL,
  product_ids jsonb NOT NULL,
  active boolean NOT NULL,
  listed boolean NOT NULL,
  valid_from timestamptz,
  valid_to timestamptz,
  revision integer NOT NULL CONSTRAINT sales_links_revision_check CHECK (revision > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  CONSTRAINT sales_links_window_check CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_from < valid_to)
);
--> statement-breakpoint
CREATE UNIQUE INDEX sales_links_tenant_slug_uidx ON sales_links(tenant_id, slug) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE TABLE sales_link_events (
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sales_link_id text NOT NULL,
  revision integer NOT NULL,
  type text NOT NULL CONSTRAINT sales_link_events_type_check CHECK (type IN ('created', 'updated', 'deleted')),
  snapshot jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, sales_link_id, revision)
);
