import type { Organization, OrganizationAuditEvent, OrganizationMember } from '#core/domain/index.js';

import type { OrganizationAuditRepository, OrganizationMemberRepository, OrganizationRepository } from '../ports.js';

export interface OrganizationFakeAccount {
  userId: string;
  email: string;
  emailVerified: boolean;
}

export const createOrganizationFakes = (accounts: OrganizationFakeAccount[] = []) => {
  const organizationRows: Organization[] = [];
  const memberRows: OrganizationMember[] = [];
  const auditRows: OrganizationAuditEvent[] = [];
  const isVerified = (userId: string) => accounts.some((account) => account.userId === userId && account.emailVerified);

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
  };

  const organizationAudit: OrganizationAuditRepository = {
    record: async (organizationId, event) => { auditRows.push({ ...event, organizationId }); },
    list: async (organizationId, query) => auditRows
      .filter((row) => row.organizationId === organizationId)
      .toSorted((left, right) => right.at.localeCompare(left.at) || right.id.localeCompare(left.id))
      .slice(0, query.limit),
  };

  const authPort = {
    findUserByEmail: async (email: string) => {
      const account = accounts.find((candidate) => candidate.email === email);
      return account === undefined ? null : { userId: account.userId, emailVerified: account.emailVerified };
    },
  };

  return { repositories: { organizations, organizationMembers, organizationAudit }, authPort, organizationRows, memberRows, auditRows };
};
