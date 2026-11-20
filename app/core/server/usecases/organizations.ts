import {
  err,
  notFound,
  ok,
  type AppError,
  type Organization,
  type OrganizationAuditEvent,
  type OrganizationAuditEventListQuery,
  type OrganizationMemberAccount,
  type OrganizationMembership,
  type OrganizationRole,
  type Result,
} from '#core/domain/index.js';

import { authorize, authorizeOrganization } from '../authorize.js';
import type { Ctx, OrganizationCtx } from '../context.js';
import type { OrganizationAuditRepository, OrganizationMemberRepository, OrganizationRepository } from '../ports.js';

export interface OrganizationReadDeps {
  organizations: Pick<OrganizationRepository, 'findById'>;
  organizationMembers: Pick<OrganizationMemberRepository, 'listAccounts' | 'listForUser'>;
  organizationAudit: Pick<OrganizationAuditRepository, 'list'>;
}

export const listOrganizations = async (
  ctx: Ctx,
  deps: Pick<OrganizationReadDeps, 'organizations' | 'organizationMembers'>,
): Promise<Result<{ organizations: OrganizationMembership[] }, AppError>> => {
  const denial = authorize(ctx, 'tenant:list-own');
  if (denial !== null) return err(denial);
  const memberships = await deps.organizationMembers.listForUser(ctx.identity.userId);
  const organizations = await Promise.all(memberships.map(async (membership) => {
    const organization = await deps.organizations.findById(membership.organizationId);
    return organization === null ? [] : [{
      id: organization.id, slug: organization.slug, name: organization.name, status: organization.status, role: membership.role,
    }];
  }));
  return ok({ organizations: organizations.flat() });
};

export const getOrganization = async (
  octx: OrganizationCtx,
  input: { organizationId: string },
  deps: Pick<OrganizationReadDeps, 'organizations'>,
): Promise<Result<{ organization: Organization; role: OrganizationRole }, AppError>> => {
  const access = authorizeOrganization(octx, input.organizationId, 'organization:read');
  if (!access.ok) return access;
  const organization = await deps.organizations.findById(access.value.organizationId);
  if (organization === null) return err(notFound('Organization not found'));
  return ok({ organization, role: access.value.role });
};

export const listOrganizationMembers = async (
  octx: OrganizationCtx,
  input: { organizationId: string },
  deps: Pick<OrganizationReadDeps, 'organizationMembers'>,
): Promise<Result<{ members: OrganizationMemberAccount[] }, AppError>> => {
  const access = authorizeOrganization(octx, input.organizationId, 'organization:member:read');
  if (!access.ok) return access;
  return ok({ members: await deps.organizationMembers.listAccounts(access.value.organizationId) });
};

export const listOrganizationAuditEvents = async (
  octx: OrganizationCtx,
  input: { organizationId: string } & OrganizationAuditEventListQuery,
  deps: Pick<OrganizationReadDeps, 'organizationAudit'>,
): Promise<Result<{ events: OrganizationAuditEvent[] }, AppError>> => {
  const access = authorizeOrganization(octx, input.organizationId, 'organization:audit:read');
  if (!access.ok) return access;
  return ok({ events: await deps.organizationAudit.list(access.value.organizationId, { limit: input.limit }) });
};
