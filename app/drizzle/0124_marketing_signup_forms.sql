CREATE TABLE marketing_signup_forms (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL,
  consent_version jsonb NOT NULL,
  consent_definition_id text NOT NULL,
  list_id text,
  tags jsonb NOT NULL,
  collect_name boolean NOT NULL,
  success_text jsonb NOT NULL,
  redirect_url text,
  allowed_origins jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'archived')),
  token text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  created_at text NOT NULL,
  updated_at text NOT NULL,
  CONSTRAINT marketing_signup_form_list_fk FOREIGN KEY (tenant_id, list_id) REFERENCES marketing_lists(tenant_id, id)
);
CREATE UNIQUE INDEX marketing_signup_forms_tenant_slug_uidx ON marketing_signup_forms(tenant_id, slug);
CREATE UNIQUE INDEX marketing_signup_forms_tenant_id_uidx ON marketing_signup_forms(tenant_id, id);
CREATE UNIQUE INDEX marketing_signup_forms_tenant_token_uidx ON marketing_signup_forms(tenant_id, token);
ALTER TABLE marketing_signup_forms ADD CONSTRAINT marketing_signup_form_definition_fk FOREIGN KEY (tenant_id, consent_definition_id) REFERENCES consent_definitions(tenant_id, id) ON DELETE RESTRICT;
CREATE TABLE marketing_signup_submissions (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  form_id text NOT NULL,
  consent_id text REFERENCES marketing_consents(id) ON DELETE SET NULL,
  confirmed_at text,
  double_opt_in boolean NOT NULL,
  occurred_at text NOT NULL,
  CONSTRAINT marketing_signup_submission_form_fk FOREIGN KEY (tenant_id, form_id) REFERENCES marketing_signup_forms(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX marketing_signup_submissions_counts_idx ON marketing_signup_submissions(tenant_id, form_id, occurred_at);

CREATE FUNCTION project_marketing_signup_confirmation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE marketing_signup_submissions
  SET confirmed_at = NEW.occurred_at
  WHERE tenant_id = NEW.tenant_id AND consent_id = NEW.previous_id AND confirmed_at IS NULL;
  RETURN NEW;
END;
$$;
CREATE TRIGGER marketing_signup_confirmation_projection
AFTER INSERT ON marketing_consents
FOR EACH ROW WHEN (NEW.status = 'confirmed')
EXECUTE FUNCTION project_marketing_signup_confirmation();
