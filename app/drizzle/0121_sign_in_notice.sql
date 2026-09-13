ALTER TABLE "tenants" ADD COLUMN "sign_in_notice" jsonb DEFAULT '{"enabled":false,"text":""}'::jsonb NOT NULL;
