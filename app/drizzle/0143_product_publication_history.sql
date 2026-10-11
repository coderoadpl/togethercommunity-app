ALTER TABLE "products" ADD COLUMN "ever_published" boolean;
--> statement-breakpoint
UPDATE "products" SET "ever_published" = true WHERE "published" = true;
--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "ever_published" SET DEFAULT false;
--> statement-breakpoint
CREATE FUNCTION preserve_product_publication_history() RETURNS trigger AS $$
BEGIN
  IF NEW.published THEN
    NEW.ever_published := true;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.ever_published := OLD.ever_published;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER products_preserve_publication_history
BEFORE INSERT OR UPDATE ON products
FOR EACH ROW EXECUTE FUNCTION preserve_product_publication_history();
