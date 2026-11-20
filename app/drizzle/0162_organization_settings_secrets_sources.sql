ALTER TABLE organizations
  ADD COLUMN legal_name text,
  ADD COLUMN legal_address text,
  ADD COLUMN invoicing_provider text CHECK (invoicing_provider IN ('ifirma', 'ksef')),
  ADD COLUMN ksef_submission_mode text NOT NULL DEFAULT 'automatic' CHECK (ksef_submission_mode IN ('automatic', 'manual')),
  ADD COLUMN shipx_environment text NOT NULL DEFAULT 'sandbox' CHECK (shipx_environment IN ('sandbox', 'production')),
  ADD COLUMN shipx_sender jsonb;
--> statement-breakpoint
CREATE TABLE organization_secrets (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key text NOT NULL,
  ciphertext text NOT NULL,
  iv text NOT NULL,
  auth_tag text NOT NULL,
  masked_preview text NOT NULL,
  updated_at text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX organization_secrets_org_key_uidx ON organization_secrets (organization_id, key);
--> statement-breakpoint
CREATE TABLE tenant_config_sources (
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  config_group text NOT NULL CHECK (config_group IN
    ('payments_live', 'payments_test', 'invoicing', 'email_transport', 'telemetry', 'shipping_carrier')),
  source text NOT NULL CHECK (source = 'organization'),
  updated_at text NOT NULL,
  updated_by_user_id text NOT NULL,
  PRIMARY KEY (tenant_id, config_group)
);
