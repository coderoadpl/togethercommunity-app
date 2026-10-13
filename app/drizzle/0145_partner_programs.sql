CREATE TABLE partner_programs (
 id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120), commission_pct integer NOT NULL CHECK (commission_pct BETWEEN 1 AND 100),
 grace_days integer NOT NULL DEFAULT 14 CHECK (grace_days BETWEEN 0 AND 365), status text NOT NULL CHECK (status IN ('active','archived')),
 notes text NOT NULL CHECK (length(notes) <= 2000), created_at timestamptz NOT NULL, revision integer NOT NULL CHECK (revision > 0)
);
CREATE TABLE partner_events (
 id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, entity_id text NOT NULL,
 entity_type text NOT NULL, type text NOT NULL, snapshot jsonb NOT NULL, occurred_at timestamptz NOT NULL
);
