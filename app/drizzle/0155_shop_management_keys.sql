CREATE TABLE "shop_management_keys" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "key_hash" text NOT NULL,
  "scopes" jsonb NOT NULL,
  "issued_by_user_id" text NOT NULL,
  "created_at" text NOT NULL,
  "expires_at" text NOT NULL,
  "revoked_at" text,
  CONSTRAINT "shop_management_keys_scopes_check" CHECK (
    jsonb_typeof("scopes") = 'array'
    AND "scopes" <> '[]'::jsonb
    AND "scopes" <@ '["shop:catalog:read", "shop:catalog:write", "shop:orders:read", "shop:fulfilment:write", "shop:settings:read", "shop:settings:write", "shop:integrations:read", "shop:integrations:write"]'::jsonb
  )
);
--> statement-breakpoint
CREATE INDEX "shop_management_keys_tenant_id_idx" ON "shop_management_keys" ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "shop_management_keys_key_hash_uidx" ON "shop_management_keys" ("key_hash");
--> statement-breakpoint
CREATE TABLE "shop_management_key_rate_limit_buckets" (
  "api_key_id" text NOT NULL REFERENCES "shop_management_keys"("id") ON DELETE CASCADE,
  "period" text NOT NULL CONSTRAINT "shop_management_key_rate_limit_buckets_period_check" CHECK ("period" IN ('minute', 'day')),
  "window_started_at" timestamp with time zone NOT NULL,
  "count" integer NOT NULL,
  CONSTRAINT "shop_management_key_rate_limit_buckets_api_key_id_period_pk" PRIMARY KEY ("api_key_id", "period")
);
--> statement-breakpoint
CREATE TABLE "shop_management_key_events" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "api_key_id" text NOT NULL,
  "kind" text NOT NULL CONSTRAINT "shop_management_key_events_kind_check" CHECK ("kind" IN ('created', 'revoked', 'purged', 'request')),
  "actor_user_id" text NOT NULL,
  "method" text CONSTRAINT "shop_management_key_events_method_check" CHECK ("method" IN ('POST', 'PUT', 'PATCH', 'DELETE')),
  "route" text,
  "resource_id" text CONSTRAINT "shop_management_key_events_resource_id_length_check" CHECK (char_length("resource_id") <= 200)
    CONSTRAINT "shop_management_key_events_resource_id_pattern_check" CHECK ("resource_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'),
  "at" text NOT NULL,
  CONSTRAINT "shop_management_key_events_shape_check" CHECK (
    ("kind" = 'request' AND "method" IS NOT NULL AND "route" IS NOT NULL)
    OR ("kind" <> 'request' AND "method" IS NULL AND "route" IS NULL AND "resource_id" IS NULL)
  )
);
--> statement-breakpoint
CREATE INDEX "shop_management_key_events_tenant_at_idx" ON "shop_management_key_events" ("tenant_id", "at");
--> statement-breakpoint
CREATE INDEX "shop_management_key_events_tenant_key_at_idx" ON "shop_management_key_events" ("tenant_id", "api_key_id", "at");
