ALTER TABLE checkout_snapshots ADD COLUMN client_reference text;
--> statement-breakpoint
ALTER TABLE orders ADD COLUMN client_reference text;
