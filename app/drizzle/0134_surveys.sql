CREATE TABLE surveys (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title text NOT NULL,
  question text NOT NULL,
  type text NOT NULL CONSTRAINT surveys_type_check CHECK (type IN ('nps', 'stars')),
  slug text NOT NULL,
  comment_enabled boolean NOT NULL,
  comment_prompt text NOT NULL,
  active boolean NOT NULL,
  endings jsonb NOT NULL,
  token text NOT NULL,
  revision integer NOT NULL CONSTRAINT surveys_revision_check CHECK (revision > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX surveys_tenant_slug_uidx ON surveys(tenant_id, slug);
--> statement-breakpoint
CREATE UNIQUE INDEX surveys_tenant_id_uidx ON surveys(tenant_id, id);
--> statement-breakpoint
CREATE TABLE survey_events (
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  survey_id text NOT NULL,
  revision integer NOT NULL CONSTRAINT survey_events_revision_check CHECK (revision > 0),
  type text NOT NULL CONSTRAINT survey_events_type_check CHECK (type IN ('created', 'updated')),
  snapshot jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, survey_id, revision),
  CONSTRAINT survey_events_survey_fk FOREIGN KEY (tenant_id, survey_id) REFERENCES surveys(tenant_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE survey_responses (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  survey_id text NOT NULL,
  member_id text,
  score integer NOT NULL CONSTRAINT survey_responses_score_check CHECK (score BETWEEN 0 AND 10),
  comment text NOT NULL CONSTRAINT survey_responses_comment_check CHECK (length(comment) <= 2000),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT survey_responses_survey_fk FOREIGN KEY (tenant_id, survey_id) REFERENCES surveys(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT survey_responses_member_fk FOREIGN KEY (tenant_id, member_id) REFERENCES members(tenant_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX survey_responses_member_uidx ON survey_responses(tenant_id, survey_id, member_id);
--> statement-breakpoint
CREATE INDEX survey_responses_page_idx ON survey_responses(tenant_id, survey_id, updated_at, id);
