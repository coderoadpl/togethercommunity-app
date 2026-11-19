ALTER TABLE "products" ADD COLUMN "sales_channel" text DEFAULT 'any' NOT NULL;
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_sales_channel_check" CHECK ("sales_channel" IN ('any', 'sales_links_only'));
