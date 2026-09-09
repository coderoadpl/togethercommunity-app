ALTER TABLE "products" ADD COLUMN "visibility" text DEFAULT 'listed' NOT NULL;
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_visibility_check" CHECK ("visibility" IN ('listed', 'unlisted'));
