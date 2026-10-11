ALTER TABLE "product_price_history" DROP CONSTRAINT "product_price_history_tenant_product_fk";
--> statement-breakpoint
ALTER TABLE "product_price_history" DROP CONSTRAINT "product_price_history_price_id_product_prices_id_fk";
