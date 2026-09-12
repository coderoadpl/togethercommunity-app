ALTER TABLE product_prices
  ADD COLUMN provider_price_id text,
  ADD COLUMN imported boolean NOT NULL DEFAULT false,
  ADD COLUMN interval_count integer NOT NULL DEFAULT 1,
  ADD CONSTRAINT product_prices_imported_inactive CHECK (NOT imported OR NOT active),
  ADD CONSTRAINT product_prices_interval_count_positive CHECK (interval_count > 0);
