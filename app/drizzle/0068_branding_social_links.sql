UPDATE "tenants" SET "name" = LEFT("name", 100) WHERE char_length("name") > 100;
ALTER TABLE "tenants" ADD COLUMN "social_links" jsonb DEFAULT '[]'::jsonb NOT NULL;