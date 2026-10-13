CREATE TABLE partners (
 id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 program_id text NOT NULL REFERENCES partner_programs(id), member_id text NOT NULL,
 status text NOT NULL CHECK (status IN ('active','archived')), created_at timestamptz NOT NULL,
 FOREIGN KEY (tenant_id, member_id) REFERENCES members(tenant_id, id)
);
CREATE UNIQUE INDEX partners_program_member_uidx ON partners(program_id, member_id);
