INSERT INTO "tenant_secrets" ("id", "tenant_id", "key", "ciphertext", "iv", "auth_tag", "masked_preview", "updated_at")
SELECT
  gen_random_uuid()::text,
  "tenant_secrets"."tenant_id",
  'shipx.' || "tenants"."shipx_environment" || CASE "tenant_secrets"."key" WHEN 'shipx.organizationId' THEN '.organizationId' ELSE '.token' END,
  "tenant_secrets"."ciphertext",
  "tenant_secrets"."iv",
  "tenant_secrets"."auth_tag",
  "tenant_secrets"."masked_preview",
  "tenant_secrets"."updated_at"
FROM "tenant_secrets"
JOIN "tenants" ON "tenants"."id" = "tenant_secrets"."tenant_id"
WHERE "tenant_secrets"."key" IN ('shipx.organizationId', 'shipx.token')
ON CONFLICT ("tenant_id", "key") DO NOTHING;
