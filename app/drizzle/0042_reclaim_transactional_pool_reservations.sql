ALTER TABLE "tenant_transactional_email_pools" ADD COLUMN "reserved_at" timestamp with time zone;
UPDATE "tenant_transactional_email_pools" SET "reserved_at" = now() WHERE "reserved" > 0;
