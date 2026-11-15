import type {
  Organization,
  OrganizationAuditEvent,
  OrganizationMember,
  OrganizationSecret,
  OrganizationSettings,
  OrganizationWorkspace,
  TenantAuditEventInput,
  TenantConfigSource,
} from '#core/domain/index.js';

import type {
  OrganizationAuditRepository,
  OrganizationMemberRepository,
  OrganizationRepository,
  OrganizationSecretRepository,
  OrganizationWorkspaceRepository,
  TenantConfigSourceRepository,
} from '../ports.js';

const keep = <T>(next: T | undefined, stored: T): T => next === undefined ? stored : next;

const defaultSettings: OrganizationSettings = {
  legalName: null,
  legalAddress: null,
  invoicingProvider: null,
  ksefSubmissionMode: 'automatic',
  shipxEnvironment: 'sandbox',
  shipxSender: null,
};

export interface OrganizationFakeAccount {
  userId: string;
  email: string;
  emailVerified: boolean;
}

export interface OrganizationFakeWorkspace extends OrganizationWorkspace {
  organizationId: string | null;
  grants: Array<{ userId: string; role: 'owner' | 'admin' }>;
}

export const createOrganizationFakes = (
  accounts: OrganizationFakeAccount[] = [],
  workspaces: OrganizationFakeWorkspace[] = [],
) => {
  const organizationRows: Organization[] = [];
  const memberRows: OrganizationMember[] = [];
  const auditRows: OrganizationAuditEvent[] = [];
  const workspaceRows = workspaces.map((workspace) => ({ ...workspace, grants: [...workspace.grants] }));
  const tenantAuditRows: TenantAuditEventInput[] = [];
  const settingsRows = new Map<string, OrganizationSettings>();
  const secretRows: OrganizationSecret[] = [];
  const configSourceRows: TenantConfigSource[] = [];
  const isVerified = (userId: string) => accounts.some((account) => account.userId === userId && account.emailVerified);
  const isOwner = (organizationId: string, userId: string) =>
    memberRows.some((row) => row.organizationId === organizationId && row.userId === userId && row.role === 'owner');
  const ownerCount = (organizationId: string) =>
    memberRows.filter((row) => row.organizationId === organizationId && row.role === 'owner').length;
  const accountOf = (row: OrganizationMember) => ({
    userId: row.userId,
    email: accounts.find((account) => account.userId === row.userId)?.email ?? row.userId,
    role: row.role,
    createdAt: row.createdAt,
  });

  const organizations: OrganizationRepository = {
    create: async (organization) => {
      if (organizationRows.some((row) => row.slug === organization.slug)) return null;
      organizationRows.push(organization);
      return organization;
    },
    createWithOwner: async ({ organization, owner, audit }) => {
      if (!isVerified(owner.userId)) return { status: 'owner_unverified' };
      const existing = organizationRows.find((row) => row.slug === organization.slug);
      if (existing !== undefined) {
        return memberRows.some((row) => row.organizationId === existing.id && row.userId === owner.userId && row.role === 'owner')
          ? { status: 'existing', organization: existing }
          : { status: 'conflict' };
      }
      organizationRows.push(organization);
      memberRows.push({ ...owner, organizationId: organization.id });
      auditRows.push(...audit.map((event) => ({ ...event, organizationId: organization.id })));
      return { status: 'created', organization };
    },
    findById: async (organizationId) => organizationRows.find((row) => row.id === organizationId) ?? null,
    findBySlug: async (slug) => organizationRows.find((row) => row.slug === slug) ?? null,
    setMaxWorkspaces: async (organizationId, { maxWorkspaces, updatedAt, audit }) => {
      const index = organizationRows.findIndex((row) => row.id === organizationId);
      const current = organizationRows[index];
      if (current === undefined) return null;
      const updated = { ...current, maxWorkspaces, updatedAt };
      organizationRows[index] = updated;
      auditRows.push({ ...audit, organizationId });
      return updated;
    },
    findSettings: async (organizationId) => organizationRows.some((row) => row.id === organizationId)
      ? settingsRows.get(organizationId) ?? defaultSettings
      : null,
    updateSettings: async (organizationId, { update, updatedAt, audit }) => {
      const index = organizationRows.findIndex((row) => row.id === organizationId);
      const current = organizationRows[index];
      if (current === undefined) return null;
      const settings = settingsRows.get(organizationId) ?? defaultSettings;
      const nextSettings: OrganizationSettings = {
        legalName: keep(update.legalName, settings.legalName),
        legalAddress: keep(update.legalAddress, settings.legalAddress),
        invoicingProvider: keep(update.invoicingProvider, settings.invoicingProvider),
        ksefSubmissionMode: keep(update.ksefSubmissionMode, settings.ksefSubmissionMode),
        shipxEnvironment: keep(update.shipxEnvironment, settings.shipxEnvironment),
        shipxSender: keep(update.shipxSender, settings.shipxSender),
      };
      const before = new Map(Object.entries(settings));
      const fields = [
        ...(update.name !== undefined && update.name !== current.name ? ['name'] : []),
        ...Object.entries(nextSettings)
          .filter(([field, value]) => JSON.stringify(value) !== JSON.stringify(before.get(field)))
          .map(([field]) => field),
      ];
      if (fields.length === 0) return { organization: current, settings, changed: false };
      const organization = { ...current, name: update.name ?? current.name, updatedAt };
      organizationRows[index] = organization;
      settingsRows.set(organizationId, nextSettings);
      auditRows.push({ ...audit, organizationId, data: { fields } });
      return { organization, settings: nextSettings, changed: true };
    },
  };

  const organizationMembers: OrganizationMemberRepository = {
    add: async (organizationId, member) => {
      if (memberRows.some((row) => row.organizationId === organizationId && row.userId === member.userId)) return false;
      memberRows.push({ ...member, organizationId });
      return true;
    },
    find: async (organizationId, userId) =>
      memberRows.find((row) => row.organizationId === organizationId && row.userId === userId) ?? null,
    list: async (organizationId) => memberRows.filter((row) => row.organizationId === organizationId),
    listAccounts: async (organizationId) => memberRows
      .filter((row) => row.organizationId === organizationId)
      .flatMap((row) => {
        const account = accounts.find((candidate) => candidate.userId === row.userId);
        return account === undefined ? [] : [{ userId: row.userId, email: account.email, role: row.role, createdAt: row.createdAt }];
      }),
    listForUser: async (userId) => memberRows.filter((row) => row.userId === userId),
    addAccount: async (organizationId, { actorUserId, member, audit }) => {
      if (!isOwner(organizationId, actorUserId)) return { status: 'organization_owner_required' };
      if (!isVerified(member.userId)) return { status: 'account_unverified' };
      const existing = memberRows.find((row) => row.organizationId === organizationId && row.userId === member.userId);
      if (existing !== undefined) return { status: 'already_member', member: accountOf(existing) };
      const added = { ...member, organizationId };
      memberRows.push(added);
      auditRows.push({ ...audit, organizationId, data: { role: member.role } });
      return { status: 'added', member: accountOf(added) };
    },
    changeRole: async (organizationId, { actorUserId, userId, role, audit }) => {
      if (!isOwner(organizationId, actorUserId)) return { status: 'organization_owner_required' };
      const index = memberRows.findIndex((row) => row.organizationId === organizationId && row.userId === userId);
      const current = memberRows[index];
      if (current === undefined) return { status: 'not_member' };
      if (current.role === role) return { status: 'unchanged', member: accountOf(current) };
      if (current.role === 'owner' && ownerCount(organizationId) === 1) return { status: 'last_owner' };
      const updated = { ...current, role };
      memberRows[index] = updated;
      auditRows.push({ ...audit, organizationId, data: { from: current.role, to: role } });
      return { status: 'changed', member: accountOf(updated) };
    },
    remove: async (organizationId, { actorUserId, userId, audit }) => {
      if (!isOwner(organizationId, actorUserId)) return { status: 'organization_owner_required' };
      const index = memberRows.findIndex((row) => row.organizationId === organizationId && row.userId === userId);
      const current = memberRows[index];
      if (current === undefined) return { status: 'not_member' };
      if (current.role === 'owner' && ownerCount(organizationId) === 1) return { status: 'last_owner' };
      memberRows.splice(index, 1);
      auditRows.push({ ...audit, organizationId, data: { role: current.role } });
      return { status: 'removed', member: accountOf(current) };
    },
  };

  const organizationAudit: OrganizationAuditRepository = {
    record: async (organizationId, event) => { auditRows.push({ ...event, organizationId }); },
    list: async (organizationId, query) => auditRows
      .filter((row) => row.organizationId === organizationId)
      .toSorted((left, right) => right.at.localeCompare(left.at) || right.id.localeCompare(left.id))
      .slice(0, query.limit),
  };

  const workspaceOf = ({ id, slug, name, status }: OrganizationFakeWorkspace): OrganizationWorkspace => ({ id, slug, name, status });
  const holdsDirectOwnerGrant = (workspace: OrganizationFakeWorkspace, userId: string) =>
    workspace.grants.some((grant) => grant.userId === userId && grant.role === 'owner');
  const checkChange = (tenantId: string, organizationId: string, actorUserId: string) => {
    const workspace = workspaceRows.find((row) => row.id === tenantId);
    if (workspace === undefined || !holdsDirectOwnerGrant(workspace, actorUserId)) {
      return { status: 'workspace_owner_required' } as const;
    }
    if (!memberRows.some((row) => row.organizationId === organizationId && row.userId === actorUserId && row.role === 'owner')) {
      return { status: 'organization_owner_required' } as const;
    }
    return { status: 'allowed', workspace } as const;
  };

  const organizationWorkspaces: OrganizationWorkspaceRepository = {
    link: async (tenantId, { organizationId, actorUserId, organizationAudit, tenantAudit }) => {
      const checked = checkChange(tenantId, organizationId, actorUserId);
      if (checked.status !== 'allowed') return checked;
      const { workspace } = checked;
      if (workspace.organizationId === organizationId) return { status: 'already_linked', workspace: workspaceOf(workspace) };
      if (workspace.organizationId !== null) return { status: 'linked_elsewhere' };
      const organization = organizationRows.find((row) => row.id === organizationId);
      if (organization === undefined) return { status: 'organization_owner_required' };
      if (workspaceRows.filter((row) => row.organizationId === organizationId).length >= organization.maxWorkspaces) {
        return { status: 'workspace_quota_exceeded' };
      }
      workspace.organizationId = organizationId;
      auditRows.push({ ...organizationAudit, organizationId });
      tenantAuditRows.push({ ...tenantAudit, tenantId });
      return { status: 'linked', workspace: workspaceOf(workspace) };
    },
    unlink: async (tenantId, { organizationId, actorUserId, organizationAudit, tenantAudit }) => {
      const workspace = workspaceRows.find((row) => row.id === tenantId);
      if (!isOwner(organizationId, actorUserId)) return { status: 'organization_owner_required' };
      if (workspace === undefined) return { status: 'not_in_organization' };
      if (workspace.organizationId !== organizationId) {
        if (!holdsDirectOwnerGrant(workspace, actorUserId)) return { status: 'not_in_organization' };
        return workspace.organizationId === null ? { status: 'not_linked', workspace: workspaceOf(workspace) } : { status: 'linked_elsewhere' };
      }
      if (configSourceRows.some((row) => row.tenantId === tenantId)) return { status: 'config_sources_present' };
      workspace.organizationId = null;
      auditRows.push({ ...organizationAudit, organizationId });
      tenantAuditRows.push({ ...tenantAudit, tenantId });
      return { status: 'unlinked', workspace: workspaceOf(workspace) };
    },
    unlinkAsWorkspaceOwner: async (tenantId, { actorUserId, organizationAudit, tenantAudit }) => {
      const workspace = workspaceRows.find((row) => row.id === tenantId);
      if (workspace === undefined || !holdsDirectOwnerGrant(workspace, actorUserId)) return { status: 'workspace_owner_required' };
      const { organizationId } = workspace;
      if (organizationId === null) return { status: 'not_linked', workspace: workspaceOf(workspace) };
      if (configSourceRows.some((row) => row.tenantId === tenantId)) return { status: 'config_sources_present' };
      workspace.organizationId = null;
      auditRows.push({ ...organizationAudit, organizationId });
      tenantAuditRows.push({ ...tenantAudit, tenantId, reason: organizationId });
      return { status: 'unlinked', workspace: workspaceOf(workspace), organizationId };
    },
    list: async (organizationId) => workspaceRows
      .filter((row) => row.organizationId === organizationId)
      .toSorted((left, right) => left.slug.localeCompare(right.slug))
      .map(workspaceOf),
  };

  const organizationSecrets: OrganizationSecretRepository = {
    listByOrganization: async (organizationId) => secretRows
      .filter((row) => row.organizationId === organizationId)
      .toSorted((left, right) => left.key.localeCompare(right.key)),
    set: async (organizationId, { secret, group, audit }) => {
      const index = secretRows.findIndex((row) => row.organizationId === organizationId && row.key === secret.key);
      const existing = secretRows[index];
      const stored = existing === undefined ? { ...secret, organizationId } : { ...secret, id: existing.id, organizationId };
      if (existing === undefined) secretRows.push(stored);
      else secretRows[index] = stored;
      auditRows.push({ ...audit, organizationId, data: { key: secret.key, group } });
      return stored;
    },
    delete: async (organizationId, { key, group, audit }) => {
      const index = secretRows.findIndex((row) => row.organizationId === organizationId && row.key === key);
      const current = secretRows[index];
      if (current === undefined) return { status: 'not_found' };
      const inheriting = configSourceRows.some((row) => row.group === group
        && workspaceRows.some((workspace) => workspace.id === row.tenantId && workspace.organizationId === organizationId));
      if (inheriting) return { status: 'config_inherited' };
      secretRows.splice(index, 1);
      auditRows.push({ ...audit, organizationId, data: { key, group } });
      return { status: 'deleted', secret: current };
    },
  };

  const tenantConfigSources: TenantConfigSourceRepository = {
    listByTenant: async (tenantId) => configSourceRows
      .filter((row) => row.tenantId === tenantId)
      .toSorted((left, right) => left.group.localeCompare(right.group)),
  };

  const authPort = {
    findUserByEmail: async (email: string) => {
      const account = accounts.find((candidate) => candidate.email === email);
      return account === undefined ? null : { userId: account.userId, emailVerified: account.emailVerified };
    },
  };

  return {
    repositories: { organizations, organizationMembers, organizationAudit, organizationWorkspaces, organizationSecrets, tenantConfigSources },
    authPort,
    organizationRows,
    memberRows,
    auditRows,
    workspaceRows,
    tenantAuditRows,
    settingsRows,
    secretRows,
    configSourceRows,
  };
};
