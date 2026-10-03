CREATE TABLE download_copies (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  copy_identifier text NOT NULL,
  member_id text NOT NULL,
  order_id text,
  product_id text NOT NULL,
  asset_id text NOT NULL,
  lineage_id text NOT NULL,
  version_number integer NOT NULL,
  file_name text NOT NULL,
  personalised boolean NOT NULL,
  content_hash text,
  bytes integer,
  created_at text NOT NULL,
  CONSTRAINT download_copies_version_positive CHECK (version_number > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX download_copies_tenant_identifier_uidx ON download_copies (tenant_id, copy_identifier);
--> statement-breakpoint
CREATE INDEX download_copies_tenant_member_idx ON download_copies (tenant_id, member_id);
--> statement-breakpoint
CREATE INDEX download_copies_tenant_order_idx ON download_copies (tenant_id, order_id);
--> statement-breakpoint
CREATE INDEX download_copies_tenant_product_idx ON download_copies (tenant_id, product_id);
