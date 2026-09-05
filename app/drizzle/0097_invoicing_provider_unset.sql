ALTER TABLE "tenants" ALTER COLUMN "invoicing_provider" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "invoicing_provider" DROP NOT NULL;--> statement-breakpoint
UPDATE "tenants" SET "invoicing_provider" = NULL
WHERE "invoicing_provider" = 'ifirma'
  AND NOT EXISTS (
    SELECT 1 FROM "tenant_secrets"
    WHERE "tenant_secrets"."tenant_id" = "tenants"."id"
      AND "tenant_secrets"."key" = 'ifirma.invoiceApiKey'
  );
