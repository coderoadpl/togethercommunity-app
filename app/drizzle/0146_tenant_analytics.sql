ALTER TABLE "tenants"
  ADD COLUMN "analytics_tag_id" text,
  ADD COLUMN "analytics_consent_cookie_name" text,
  ADD COLUMN "analytics_consent_cookie_value" text,
  ADD COLUMN "analytics_consent_event" text,
  ADD COLUMN "analytics_load_without_consent" boolean NOT NULL DEFAULT false;
