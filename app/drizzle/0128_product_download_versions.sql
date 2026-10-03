ALTER TABLE product_download_assets ADD COLUMN lineage_id text;
--> statement-breakpoint
ALTER TABLE product_download_assets ADD COLUMN version_number integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE product_download_assets ADD COLUMN version_note text;
--> statement-breakpoint
ALTER TABLE product_download_assets ADD COLUMN superseded_at text;
--> statement-breakpoint
ALTER TABLE product_download_assets ADD COLUMN replaces_asset_id text;
--> statement-breakpoint
UPDATE product_download_assets SET lineage_id = id;
--> statement-breakpoint
ALTER TABLE product_download_assets ALTER COLUMN lineage_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE product_download_assets ADD CONSTRAINT product_download_assets_version_positive CHECK (version_number > 0);
--> statement-breakpoint
CREATE UNIQUE INDEX product_download_assets_lineage_version_uidx ON product_download_assets (tenant_id, lineage_id, version_number);
