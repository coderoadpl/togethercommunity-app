import { and, asc, count, desc, eq } from 'drizzle-orm';

import {
  organizationAuditEventSchema,
  organizationMemberAccountSchema,
  organizationMemberSchema,
  organizationSchema,
  organizationWorkspaceSchema,
  type OrganizationWorkspace,
} from '#core/domain/index.js';
import type {
  OrganizationAuditRepository,
  OrganizationMemberRepository,
  OrganizationRepository,
  OrganizationWorkspaceRepository,
} from '#core/server/index.js';

import { user } from './auth-schema.js';
import type { Db } from './client.js';
import { tenantAdmins, tenantAuditEvents, tenants } from './app-schema.js';
import { organizationAuditEvents, organizationMembers, organizations } from './organization-schema.js';

export const createOrganizationRepository = (db: Db): OrganizationRepository => ({
  createWithOwner: async ({ organization, owner, audit }) => db.transaction(async (tx) => {
    const verifiedOwner = await tx.select({ id: user.id }).from(user)
      .where(and(eq(user.id, owner.userId), eq(user.emailVerified, true))).for('share');
    if (verifiedOwner.length !== 1) return { status: 'owner_unverified' } as const;
    const inserted = await tx.insert(organizations).values(organization)
      .onConflictDoNothing({ target: organizations.slug }).returning();
    if (inserted[0] !== undefined) {
      await tx.insert(organizationMembers).values({ ...owner, organizationId: organization.id });
      if (audit.length > 0) {
        await tx.insert(organizationAuditEvents).values(audit.map((event) => ({ ...event, organizationId: organization.id })));
      }
      return { status: 'created', organization: organizationSchema.parse(inserted[0]) } as const;
    }
    const existing = await tx.select().from(organizations).where(eq(organizations.slug, organization.slug)).limit(1);
    if (existing[0] === undefined) return { status: 'conflict' } as const;
    const ownerRows = await tx.select({ id: organizationMembers.id }).from(organizationMembers).where(and(
      eq(organizationMembers.organizationId, existing[0].id),
      eq(organizationMembers.userId, owner.userId),
      eq(organizationMembers.role, 'owner'),
    )).limit(1);
    return ownerRows.length === 1
      ? { status: 'existing', organization: organizationSchema.parse(existing[0]) } as const
      : { status: 'conflict' } as const;
  }),
  findById: async (organizationId) => {
    const rows = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
    return rows[0] === undefined ? null : organizationSchema.parse(rows[0]);
  },
  setMaxWorkspaces: async (organizationId, { maxWorkspaces, updatedAt, audit }) => db.transaction(async (tx) => {
    const rows = await tx.update(organizations).set({ maxWorkspaces, updatedAt })
      .where(eq(organizations.id, organizationId)).returning();
    if (rows[0] === undefined) return null;
    await tx.insert(organizationAuditEvents).values({ ...audit, organizationId });
    return organizationSchema.parse(rows[0]);
  }),
});

export const createOrganizationMemberRepository = (db: Db): OrganizationMemberRepository => ({
  find: async (organizationId, userId) => {
    const rows = await db.select().from(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, userId)))
      .limit(1);
    return rows[0] === undefined ? null : organizationMemberSchema.parse(rows[0]);
  },
  listAccounts: async (organizationId) => (await db.select({
    userId: organizationMembers.userId,
    email: user.email,
    role: organizationMembers.role,
    createdAt: organizationMembers.createdAt,
  }).from(organizationMembers)
    .innerJoin(user, eq(user.id, organizationMembers.userId))
    .where(eq(organizationMembers.organizationId, organizationId))
    .orderBy(asc(organizationMembers.createdAt), asc(organizationMembers.id)))
    .map((row) => organizationMemberAccountSchema.parse(row)),
  listForUser: async (userId) => (await db.select().from(organizationMembers)
    .where(eq(organizationMembers.userId, userId))
    .orderBy(asc(organizationMembers.organizationId)))
    .map((row) => organizationMemberSchema.parse(row)),
});

export const createOrganizationAuditRepository = (db: Db): OrganizationAuditRepository => ({
  list: async (organizationId, query) => (await db.select().from(organizationAuditEvents)
    .where(eq(organizationAuditEvents.organizationId, organizationId))
    .orderBy(desc(organizationAuditEvents.at), desc(organizationAuditEvents.id))
    .limit(query.limit))
    .map((row) => organizationAuditEventSchema.parse(row)),
});

const workspaceColumns = { id: tenants.id, slug: tenants.slug, name: tenants.name, status: tenants.status };

type WorkspaceChangeCheck =
  | { status: 'workspace_owner_required' }
  | { status: 'organization_owner_required' }
  | { status: 'allowed'; organizationId: string | null; workspace: OrganizationWorkspace };

const checkWorkspaceChange = async (
  tx: Db,
  tenantId: string,
  input: { organizationId: string; actorUserId: string },
): Promise<WorkspaceChangeCheck> => {
  const rows = await tx.select({ ...workspaceColumns, organizationId: tenants.organizationId })
    .from(tenants).where(eq(tenants.id, tenantId)).for('update');
  const directOwner = await tx.select({ id: tenantAdmins.id }).from(tenantAdmins).where(and(
    eq(tenantAdmins.tenantId, tenantId),
    eq(tenantAdmins.userId, input.actorUserId),
    eq(tenantAdmins.role, 'owner'),
  )).for('share');
  const row = rows[0];
  if (row === undefined || directOwner.length !== 1) return { status: 'workspace_owner_required' };
  const organizationOwner = await tx.select({ id: organizationMembers.id }).from(organizationMembers).where(and(
    eq(organizationMembers.organizationId, input.organizationId),
    eq(organizationMembers.userId, input.actorUserId),
    eq(organizationMembers.role, 'owner'),
  )).for('share');
  if (organizationOwner.length !== 1) return { status: 'organization_owner_required' };
  const { organizationId, ...workspace } = row;
  return { status: 'allowed', organizationId, workspace: organizationWorkspaceSchema.parse(workspace) };
};

export const createOrganizationWorkspaceRepository = (db: Db): OrganizationWorkspaceRepository => ({
  link: async (tenantId, input) => db.transaction(async (tx) => {
    const checked = await checkWorkspaceChange(tx, tenantId, input);
    if (checked.status !== 'allowed') return checked;
    if (checked.organizationId === input.organizationId) return { status: 'already_linked', workspace: checked.workspace } as const;
    if (checked.organizationId !== null) return { status: 'linked_elsewhere' } as const;
    const [organization] = await tx.select({ maxWorkspaces: organizations.maxWorkspaces }).from(organizations)
      .where(eq(organizations.id, input.organizationId)).for('no key update');
    if (organization === undefined) return { status: 'organization_owner_required' } as const;
    const [linked] = await tx.select({ total: count() }).from(tenants).where(eq(tenants.organizationId, input.organizationId));
    if ((linked?.total ?? 0) >= organization.maxWorkspaces) return { status: 'workspace_quota_exceeded' } as const;
    await tx.update(tenants).set({ organizationId: input.organizationId }).where(eq(tenants.id, tenantId));
    await tx.insert(organizationAuditEvents).values({ ...input.organizationAudit, organizationId: input.organizationId });
    await tx.insert(tenantAuditEvents).values({ ...input.tenantAudit, tenantId });
    return { status: 'linked', workspace: checked.workspace } as const;
  }),
  unlink: async (tenantId, input) => db.transaction(async (tx) => {
    const checked = await checkWorkspaceChange(tx, tenantId, input);
    if (checked.status !== 'allowed') return checked;
    if (checked.organizationId === null) return { status: 'not_linked', workspace: checked.workspace } as const;
    if (checked.organizationId !== input.organizationId) return { status: 'linked_elsewhere' } as const;
    // TODO(O06): return config_sources_present while tenant_config_sources holds a row for this tenant (table arrives in O06).
    await tx.update(tenants).set({ organizationId: null }).where(eq(tenants.id, tenantId));
    await tx.insert(organizationAuditEvents).values({ ...input.organizationAudit, organizationId: input.organizationId });
    await tx.insert(tenantAuditEvents).values({ ...input.tenantAudit, tenantId });
    return { status: 'unlinked', workspace: checked.workspace } as const;
  }),
  list: async (organizationId) => (await db.select(workspaceColumns).from(tenants)
    .where(eq(tenants.organizationId, organizationId))
    .orderBy(asc(tenants.slug)))
    .map((row) => organizationWorkspaceSchema.parse(row)),
});
