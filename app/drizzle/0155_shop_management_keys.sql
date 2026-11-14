ALTER TABLE tenant_api_keys
  ADD COLUMN kind text NOT NULL DEFAULT 'legacy',
  ADD COLUMN issued_by_user_id text;
--> statement-breakpoint
ALTER TABLE tenant_api_keys
  ADD CONSTRAINT tenant_api_keys_kind_check CHECK (kind IN ('legacy', 'shop_management')),
  ADD CONSTRAINT tenant_api_keys_shop_management_issuer_expiry_check CHECK (kind <> 'shop_management' OR (issued_by_user_id IS NOT NULL AND expires_at IS NOT NULL));
