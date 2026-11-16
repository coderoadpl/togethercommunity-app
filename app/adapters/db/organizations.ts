import { and, asc, count, desc, eq } from 'drizzle-orm';

import {
  ORGANIZATION_SECRET_GROUP,
  organizationAuditEventSchema,
  organizationMemberAccountSchema,
  organizationMemberSchema,
  organizationSchema,
  organizationSecretSchema,
  organizationSettingsSchema,
  organizationWorkspaceSchema,
  tenantConfigSourceSchema,
  type ConfigGroup,
  type OrganizationWorkspace,
} from '#core/domain/index.js';
import type {
  EffectiveTenantConfigReader,
  OrganizationAuditRepository,
  OrganizationMemberRepository,
  OrganizationRepository,
  OrganizationSecretRepository,
  OrganizationWorkspaceRepository,
  TenantConfigSourceRepository,
} from '#core/server/index.js';

import { user } from './auth-schema.js';
import type { Db } from './client.js';
import { tenantAdmins, tenantAuditEvents, tenantConfigSources, tenants } from './app-schema.js';
import { organizationAuditEvents, organizationMembers, organizationSecrets, organizations } from './organization-schema.js';

type OrganizationRow = typeof organizations.$inferSelect;

const settingsOf = (row: OrganizationRow) => organizationSettingsSchema.parse({
  legalName: row.legalName,
  legalAddress: row.legalAddress,
  invoicingProvider: row.invoicingProvider,
  ksefSubmissionMode: row.ksefSubmissionMode,
  shipxEnvironment: row.shipxEnvironment,
  shipxSender: row.shipxSender,
});

// jsonb does not keep key order, so stored and submitted objects are compared with sorted keys.
const canonical = (value: unknown): string => JSON.stringify(value, (_key, nested: unknown) =>
  typeof nested === 'object' && nested !== null && !Array.isArray(nested)
    ? Object.fromEntries(Object.entries(nested).toSorted(([left], [right]) => left.localeCompare(right)))
    : nested);

const differs = <T>(next: T | undefined, stored: unknown): next is T =>
  next !== undefined && canonical(next) !== canonical(stored);

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
  findSettings: async (organizationId) => {
    const rows = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
    return rows[0] === undefined ? null : settingsOf(rows[0]);
  },
  updateSettings: async (organizationId, { update, updatedAt, audit }) => db.transaction(async (tx) => {
    const rows = await tx.select().from(organizations).where(eq(organizations.id, organizationId)).for('no key update');
    const current = rows[0];
    if (current === undefined) return null;
    const changes = {
      ...(differs(update.name, current.name) ? { name: update.name } : {}),
      ...(differs(update.legalName, current.legalName) ? { legalName: update.legalName } : {}),
      ...(differs(update.legalAddress, current.legalAddress) ? { legalAddress: update.legalAddress } : {}),
      ...(differs(update.invoicingProvider, current.invoicingProvider) ? { invoicingProvider: update.invoicingProvider } : {}),
      ...(differs(update.ksefSubmissionMode, current.ksefSubmissionMode) ? { ksefSubmissionMode: update.ksefSubmissionMode } : {}),
      ...(differs(update.shipxEnvironment, current.shipxEnvironment) ? { shipxEnvironment: update.shipxEnvironment } : {}),
      ...(differs(update.shipxSender, current.shipxSender) ? { shipxSender: update.shipxSender } : {}),
    };
    const fields = Object.keys(changes);
    if (fields.length === 0) {
      return { organization: organizationSchema.parse(current), settings: settingsOf(current), changed: false };
    }
    const updated = await tx.update(organizations).set({ ...changes, updatedAt })
      .where(eq(organizations.id, organizationId)).returning();
    if (updated[0] === undefined) return null;
    await tx.insert(organizationAuditEvents).values({ ...audit, organizationId, data: { fields } });
    return { organization: organizationSchema.parse(updated[0]), settings: settingsOf(updated[0]), changed: true };
  }),
});

const secretRow = (organizationId: string, key: string) =>
  and(eq(organizationSecrets.organizationId, organizationId), eq(organizationSecrets.key, key));

export const createOrganizationSecretRepository = (db: Db): OrganizationSecretRepository => ({
  listByOrganization: async (organizationId) => (await db.select().from(organizationSecrets)
    .where(eq(organizationSecrets.organizationId, organizationId))
    .orderBy(asc(organizationSecrets.key)))
    .map((row) => organizationSecretSchema.parse(row)),
  set: async (organizationId, { secret, group, audit }) => db.transaction(async (tx) => {
    const rows = await tx.insert(organizationSecrets).values({ ...secret, organizationId })
      .onConflictDoUpdate({
        target: [organizationSecrets.organizationId, organizationSecrets.key],
        set: {
          ciphertext: secret.ciphertext,
          iv: secret.iv,
          authTag: secret.authTag,
          maskedPreview: secret.maskedPreview,
          updatedAt: secret.updatedAt,
        },
      })
      .returning();
    if (rows[0] === undefined) throw new Error('organization_secrets upsert returned no row');
    await tx.insert(organizationAuditEvents).values({
      ...audit, organizationId, data: { key: secret.key, group },
    });
    return organizationSecretSchema.parse(rows[0]);
  }),
  delete: async (organizationId, { key, group, audit }) => db.transaction(async (tx) => {
    const rows = await tx.select().from(organizationSecrets).where(secretRow(organizationId, key)).for('update');
    const current = rows[0];
    if (current === undefined) return { status: 'not_found' } as const;
    const inheriting = await tx.select({ tenantId: tenantConfigSources.tenantId }).from(tenantConfigSources)
      .innerJoin(tenants, eq(tenants.id, tenantConfigSources.tenantId))
      .where(and(eq(tenants.organizationId, organizationId), eq(tenantConfigSources.configGroup, group)))
      .limit(1);
    if (inheriting.length > 0) return { status: 'config_inherited' } as const;
    await tx.delete(organizationSecrets).where(secretRow(organizationId, key));
    await tx.insert(organizationAuditEvents).values({
      ...audit, organizationId, data: { key, group },
    });
    return { status: 'deleted', secret: organizationSecretSchema.parse(current) } as const;
  }),
});

export const createTenantConfigSourceRepository = (db: Db): TenantConfigSourceRepository => ({
  listByTenant: async (tenantId) => (await db.select().from(tenantConfigSources)
    .where(eq(tenantConfigSources.tenantId, tenantId))
    .orderBy(asc(tenantConfigSources.configGroup)))
    .map((row) => tenantConfigSourceSchema.parse({
      tenantId: row.tenantId,
      group: row.configGroup,
      source: row.source,
      updatedAt: row.updatedAt,
      updatedByUserId: row.updatedByUserId,
    })),
});

const sourceRow = (tenantId: string, group: ConfigGroup) =>
  and(eq(tenantConfigSources.tenantId, tenantId), eq(tenantConfigSources.configGroup, group));

export const createEffectiveTenantConfigReader = (db: Db): EffectiveTenantConfigReader => ({
  findInheritedSecret: async (tenantId, key) => {
    const rows = await db.select({ secret: organizationSecrets }).from(tenantConfigSources)
      .innerJoin(tenants, eq(tenants.id, tenantConfigSources.tenantId))
      .leftJoin(organizationSecrets, and(eq(organizationSecrets.organizationId, tenants.organizationId), eq(organizationSecrets.key, key)))
      .where(sourceRow(tenantId, ORGANIZATION_SECRET_GROUP[key]))
      .limit(1);
    const row = rows[0];
    if (row === undefined) return { source: 'workspace' };
    return { source: 'organization', value: row.secret === null ? null : organizationSecretSchema.parse(row.secret) };
  },
  findInheritedSettings: async (tenantId, group) => {
    const rows = await db.select({ organization: organizations }).from(tenantConfigSources)
      .innerJoin(tenants, eq(tenants.id, tenantConfigSources.tenantId))
      .leftJoin(organizations, eq(organizations.id, tenants.organizationId))
      .where(sourceRow(tenantId, group))
      .limit(1);
    const row = rows[0];
    if (row === undefined) return { source: 'workspace' };
    return { source: 'organization', value: row.organization === null ? null : settingsOf(row.organization) };
  },
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
  find: async (organizationId, userId) => {
    const rows = await db.select().from(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, userId)))
      .limit(1);
    return rows[0] === undefined ? null : organizationMemberSchema.parse(rows[0]);
  },
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

const lockWorkspace = async (tx: Db, tenantId: string) => {
  const [row] = await tx.select({ ...workspaceColumns, organizationId: tenants.organizationId })
    .from(tenants).where(eq(tenants.id, tenantId)).for('update');
  if (row === undefined) return null;
  const { organizationId, ...workspace } = row;
  return { organizationId, workspace: organizationWorkspaceSchema.parse(workspace) };
};

const holdsDirectOwnerGrant = async (tx: Db, tenantId: string, userId: string) => (await tx.select({ id: tenantAdmins.id })
  .from(tenantAdmins).where(and(
    eq(tenantAdmins.tenantId, tenantId),
    eq(tenantAdmins.userId, userId),
    eq(tenantAdmins.role, 'owner'),
  )).for('share')).length === 1;

const holdsOrganizationOwnership = async (tx: Db, organizationId: string, userId: string) => (await tx
  .select({ id: organizationMembers.id }).from(organizationMembers).where(and(
    eq(organizationMembers.organizationId, organizationId),
    eq(organizationMembers.userId, userId),
    eq(organizationMembers.role, 'owner'),
  )).for('share')).length === 1;

const hasConfigSources = async (tx: Db, tenantId: string) => (await tx.select({ tenantId: tenantConfigSources.tenantId })
  .from(tenantConfigSources).where(eq(tenantConfigSources.tenantId, tenantId)).limit(1)).length > 0;

const checkWorkspaceChange = async (
  tx: Db,
  tenantId: string,
  input: { organizationId: string; actorUserId: string },
): Promise<WorkspaceChangeCheck> => {
  const locked = await lockWorkspace(tx, tenantId);
  const directOwner = await holdsDirectOwnerGrant(tx, tenantId, input.actorUserId);
  if (locked === null || !directOwner) return { status: 'workspace_owner_required' };
  if (!await holdsOrganizationOwnership(tx, input.organizationId, input.actorUserId)) return { status: 'organization_owner_required' };
  return { status: 'allowed', ...locked };
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
    const locked = await lockWorkspace(tx, tenantId);
    if (!await holdsOrganizationOwnership(tx, input.organizationId, input.actorUserId)) {
      return { status: 'organization_owner_required' } as const;
    }
    if (locked === null) return { status: 'not_in_organization' } as const;
    if (locked.organizationId !== input.organizationId) {
      // Without a direct grant the caller must not learn whether a workspace outside the organization exists or where it is linked.
      if (!await holdsDirectOwnerGrant(tx, tenantId, input.actorUserId)) return { status: 'not_in_organization' } as const;
      return locked.organizationId === null
        ? { status: 'not_linked', workspace: locked.workspace } as const
        : { status: 'linked_elsewhere' } as const;
    }
    if (await hasConfigSources(tx, tenantId)) return { status: 'config_sources_present' } as const;
    await tx.update(tenants).set({ organizationId: null }).where(eq(tenants.id, tenantId));
    await tx.insert(organizationAuditEvents).values({ ...input.organizationAudit, organizationId: input.organizationId });
    await tx.insert(tenantAuditEvents).values({ ...input.tenantAudit, tenantId });
    return { status: 'unlinked', workspace: locked.workspace } as const;
  }),
  unlinkAsWorkspaceOwner: async (tenantId, input) => db.transaction(async (tx) => {
    const locked = await lockWorkspace(tx, tenantId);
    if (locked === null || !await holdsDirectOwnerGrant(tx, tenantId, input.actorUserId)) {
      return { status: 'workspace_owner_required' } as const;
    }
    const { organizationId, workspace } = locked;
    if (organizationId === null) return { status: 'not_linked', workspace } as const;
    if (await hasConfigSources(tx, tenantId)) return { status: 'config_sources_present' } as const;
    await tx.update(tenants).set({ organizationId: null }).where(eq(tenants.id, tenantId));
    await tx.insert(organizationAuditEvents).values({ ...input.organizationAudit, organizationId });
    await tx.insert(tenantAuditEvents).values({ ...input.tenantAudit, tenantId, reason: organizationId });
    return { status: 'unlinked', workspace, organizationId } as const;
  }),
  list: async (organizationId) => (await db.select(workspaceColumns).from(tenants)
    .where(eq(tenants.organizationId, organizationId))
    .orderBy(asc(tenants.slug)))
    .map((row) => organizationWorkspaceSchema.parse(row)),
});
