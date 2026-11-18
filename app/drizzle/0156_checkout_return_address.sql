ALTER TABLE tenants ADD COLUMN checkout_return_origins jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE checkout_snapshots ADD COLUMN return_url text;
