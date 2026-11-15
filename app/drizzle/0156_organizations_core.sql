CREATE TABLE organizations (
  id text PRIMARY KEY,
  slug text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  max_workspaces integer NOT NULL DEFAULT 0 CHECK (max_workspaces >= 0),
  created_at text NOT NULL,
  updated_at text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX organizations_slug_uidx ON organizations (slug);
--> statement-breakpoint
CREATE TABLE organization_members (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'admin')),
  created_at text NOT NULL,
  created_by_user_id text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX organization_members_org_user_uidx ON organization_members (organization_id, user_id);
--> statement-breakpoint
CREATE INDEX organization_members_user_idx ON organization_members (user_id);
--> statement-breakpoint
ALTER TABLE tenants ADD COLUMN organization_id text REFERENCES organizations(id) ON DELETE RESTRICT;
--> statement-breakpoint
CREATE INDEX tenants_organization_idx ON tenants (organization_id);
--> statement-breakpoint
CREATE TABLE organization_audit_events (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind text NOT NULL,
  actor_user_id text NOT NULL,
  actor_email text NOT NULL,
  actor_key_id text,
  subject_tenant_id text,
  subject_user_id text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  at text NOT NULL
);
--> statement-breakpoint
CREATE INDEX organization_audit_events_org_at_idx ON organization_audit_events (organization_id, at);
