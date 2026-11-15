import { and, asc, desc, eq } from 'drizzle-orm';

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
  create: async (organization) => {
    const rows = await db.insert(organizations).values(organization)
      .onConflictDoNothing({ target: organizations.slug }).returning();
    return rows[0] === undefined ? null : organizationSchema.parse(rows[0]);
  },
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
  findBySlug: async (slug) => {
    const rows = await db.select().from(organizations).where(eq(organizations.slug, slug)).limit(1);
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

const memberAccountColumns = {
  userId: organizationMembers.userId,
  email: user.email,
  role: organizationMembers.role,
  createdAt: organizationMembers.createdAt,
};

const lockedMemberWrite = async (tx: Db, organizationId: string, actorUserId: string) => {
  // NO KEY UPDATE serializes member writes per organization yet lets foreign-key checks against the row through.
  const organization = await tx.select({ id: organizations.id }).from(organizations)
    .where(eq(organizations.id, organizationId)).for('no key update');
  if (organization.length !== 1) return { allowed: false, owners: 0 } as const;
  const owners = await tx.select({ userId: organizationMembers.userId }).from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.role, 'owner')));
  return { allowed: owners.some((owner) => owner.userId === actorUserId), owners: owners.length } as const;
};

const memberRow = (organizationId: string, userId: string) =>
  and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, userId));

const findMemberAccount = async (tx: Db, organizationId: string, userId: string) => {
  const rows = await tx.select(memberAccountColumns).from(organizationMembers)
    .innerJoin(user, eq(user.id, organizationMembers.userId))
    .where(memberRow(organizationId, userId))
    .limit(1);
  return rows[0] === undefined ? null : organizationMemberAccountSchema.parse(rows[0]);
};

export const createOrganizationMemberRepository = (db: Db): OrganizationMemberRepository => ({
  add: async (organizationId, member) => {
    const rows = await db.insert(organizationMembers).values({ ...member, organizationId })
      .onConflictDoNothing({ target: [organizationMembers.organizationId, organizationMembers.userId] })
      .returning({ id: organizationMembers.id });
    return rows.length > 0;
  },
  find: async (organizationId, userId) => {
    const rows = await db.select().from(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, userId)))
      .limit(1);
    return rows[0] === undefined ? null : organizationMemberSchema.parse(rows[0]);
  },
  list: async (organizationId) => (await db.select().from(organizationMembers)
    .where(eq(organizationMembers.organizationId, organizationId))
    .orderBy(asc(organizationMembers.createdAt), asc(organizationMembers.id)))
    .map((row) => organizationMemberSchema.parse(row)),
  listAccounts: async (organizationId) => (await db.select(memberAccountColumns).from(organizationMembers)
    .innerJoin(user, eq(user.id, organizationMembers.userId))
    .where(eq(organizationMembers.organizationId, organizationId))
    .orderBy(asc(organizationMembers.createdAt), asc(organizationMembers.id)))
    .map((row) => organizationMemberAccountSchema.parse(row)),
  listForUser: async (userId) => (await db.select().from(organizationMembers)
    .where(eq(organizationMembers.userId, userId))
    .orderBy(asc(organizationMembers.organizationId)))
    .map((row) => organizationMemberSchema.parse(row)),
  addAccount: async (organizationId, { actorUserId, member, audit }) => db.transaction(async (tx) => {
    const lock = await lockedMemberWrite(tx, organizationId, actorUserId);
    if (!lock.allowed) return { status: 'organization_owner_required' } as const;
    const verified = await tx.select({ email: user.email }).from(user)
      .where(and(eq(user.id, member.userId), eq(user.emailVerified, true))).for('share');
    if (verified[0] === undefined) return { status: 'account_unverified' } as const;
    const existing = await findMemberAccount(tx, organizationId, member.userId);
    if (existing !== null) return { status: 'already_member', member: existing } as const;
    await tx.insert(organizationMembers).values({ ...member, organizationId });
    await tx.insert(organizationAuditEvents).values({ ...audit, organizationId, data: { role: member.role } });
    const added = organizationMemberAccountSchema.parse({
      userId: member.userId, email: verified[0].email, role: member.role, createdAt: member.createdAt,
    });
    return { status: 'added', member: added } as const;
  }),
  changeRole: async (organizationId, { actorUserId, userId, role, audit }) => db.transaction(async (tx) => {
    const lock = await lockedMemberWrite(tx, organizationId, actorUserId);
    if (!lock.allowed) return { status: 'organization_owner_required' } as const;
    const current = await findMemberAccount(tx, organizationId, userId);
    if (current === null) return { status: 'not_member' } as const;
    if (current.role === role) return { status: 'unchanged', member: current } as const;
    if (current.role === 'owner' && lock.owners <= 1) return { status: 'last_owner' } as const;
    await tx.update(organizationMembers).set({ role }).where(memberRow(organizationId, userId));
    await tx.insert(organizationAuditEvents).values({ ...audit, organizationId, data: { from: current.role, to: role } });
    return { status: 'changed', member: { ...current, role } } as const;
  }),
  remove: async (organizationId, { actorUserId, userId, audit }) => db.transaction(async (tx) => {
    const lock = await lockedMemberWrite(tx, organizationId, actorUserId);
    if (!lock.allowed) return { status: 'organization_owner_required' } as const;
    const current = await findMemberAccount(tx, organizationId, userId);
    if (current === null) return { status: 'not_member' } as const;
    if (current.role === 'owner' && lock.owners <= 1) return { status: 'last_owner' } as const;
    await tx.delete(organizationMembers).where(memberRow(organizationId, userId));
    await tx.insert(organizationAuditEvents).values({ ...audit, organizationId, data: { role: current.role } });
    return { status: 'removed', member: current } as const;
  }),
});

export const createOrganizationAuditRepository = (db: Db): OrganizationAuditRepository => ({
  record: async (organizationId, event) => {
    await db.insert(organizationAuditEvents).values({ ...event, organizationId });
  },
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
