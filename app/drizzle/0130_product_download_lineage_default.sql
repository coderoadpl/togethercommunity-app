CREATE FUNCTION product_download_assets_default_lineage() RETURNS trigger AS $$
BEGIN
  NEW.lineage_id := COALESCE(NEW.lineage_id, NEW.id);
  NEW.version_number := COALESCE(NEW.version_number, 1);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER product_download_assets_default_lineage
BEFORE INSERT ON product_download_assets
FOR EACH ROW EXECUTE FUNCTION product_download_assets_default_lineage();
