ALTER TABLE tenant_api_keys
  ADD COLUMN kind text NOT NULL DEFAULT 'legacy',
  ADD COLUMN issued_by_user_id text;
--> statement-breakpoint
ALTER TABLE tenant_api_keys
  ADD CONSTRAINT tenant_api_keys_kind_check CHECK (kind IN ('legacy', 'shop_management')),
  ADD CONSTRAINT tenant_api_keys_shop_management_issuer_expiry_check CHECK (kind <> 'shop_management' OR (issued_by_user_id IS NOT NULL AND expires_at IS NOT NULL)),
  ADD CONSTRAINT tenant_api_keys_shop_management_scopes_check CHECK (kind <> 'shop_management' OR (scopes IS NOT NULL AND jsonb_typeof(scopes) = 'array' AND scopes <> '[]'::jsonb));
--> statement-breakpoint
CREATE TABLE "shop_management_key_events" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "api_key_id" text NOT NULL,
  "kind" text NOT NULL CONSTRAINT "shop_management_key_events_kind_check" CHECK ("kind" IN ('created', 'revoked', 'purged', 'request')),
  "actor_user_id" text,
  "method" text CONSTRAINT "shop_management_key_events_method_check" CHECK ("method" IN ('POST', 'PUT', 'PATCH', 'DELETE')),
  "route" text,
  "resource_id" text CONSTRAINT "shop_management_key_events_resource_id_length_check" CHECK (char_length("resource_id") <= 200),
  "status" integer CONSTRAINT "shop_management_key_events_status_check" CHECK ("status" BETWEEN 100 AND 599),
  "outcome" text NOT NULL CONSTRAINT "shop_management_key_events_outcome_check" CHECK ("outcome" IN ('succeeded', 'refused', 'failed')),
  "at" text NOT NULL,
  CONSTRAINT "shop_management_key_events_shape_check" CHECK (
    ("kind" = 'request' AND "method" IS NOT NULL AND "route" IS NOT NULL AND "status" IS NOT NULL)
    OR ("kind" <> 'request' AND "actor_user_id" IS NOT NULL AND "method" IS NULL AND "route" IS NULL AND "resource_id" IS NULL AND "status" IS NULL AND "outcome" = 'succeeded')
  )
);
--> statement-breakpoint
CREATE INDEX "shop_management_key_events_tenant_at_idx" ON "shop_management_key_events" ("tenant_id", "at");
--> statement-breakpoint
CREATE INDEX "shop_management_key_events_tenant_key_at_idx" ON "shop_management_key_events" ("tenant_id", "api_key_id", "at");
