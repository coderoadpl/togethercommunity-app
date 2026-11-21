CREATE TABLE "entitlement_keys" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "key_hash" text NOT NULL,
  "scopes" jsonb NOT NULL,
  "product_ids" jsonb,
  "match" text DEFAULT 'verified' NOT NULL CONSTRAINT "entitlement_keys_match_check" CHECK ("match" IN ('verified', 'purchase-email')),
  "issued_by_user_id" text NOT NULL,
  "created_at" text NOT NULL,
  "expires_at" text NOT NULL,
  "revoked_at" text,
  CONSTRAINT "entitlement_keys_scopes_check" CHECK (
    jsonb_typeof("scopes") = 'array'
    AND "scopes" ? 'entitlements:check'
    AND "scopes" <@ '["entitlements:check", "entitlements:members:read"]'::jsonb
  ),
  CONSTRAINT "entitlement_keys_product_ids_check" CHECK (
    "product_ids" IS NULL
    OR (jsonb_typeof("product_ids") = 'array' AND jsonb_array_length("product_ids") BETWEEN 1 AND 50)
  )
);
--> statement-breakpoint
CREATE INDEX "entitlement_keys_tenant_id_idx" ON "entitlement_keys" ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "entitlement_keys_key_hash_uidx" ON "entitlement_keys" ("key_hash");
--> statement-breakpoint
CREATE TABLE "entitlement_key_rate_limit_buckets" (
  "api_key_id" text NOT NULL REFERENCES "entitlement_keys"("id") ON DELETE CASCADE,
  "period" text NOT NULL CONSTRAINT "entitlement_key_rate_limit_buckets_period_check" CHECK ("period" IN ('minute', 'day')),
  "window_started_at" timestamp with time zone NOT NULL,
  "count" integer NOT NULL,
  CONSTRAINT "entitlement_key_rate_limit_buckets_api_key_id_period_pk" PRIMARY KEY ("api_key_id", "period")
);
