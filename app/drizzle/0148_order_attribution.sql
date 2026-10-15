ALTER TABLE "orders" ADD COLUMN "attribution" jsonb;
--> statement-breakpoint
ALTER TABLE "checkout_snapshots" ADD COLUMN "attribution" jsonb;
