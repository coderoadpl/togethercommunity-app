import {
  err,
  notFound,
  ok,
  updateOrganizationInputSchema,
  validation,
  type AppError,
  type Organization,
  type OrganizationAuditEvent,
  type OrganizationAuditEventListQuery,
  type OrganizationMemberAccount,
  type OrganizationMembership,
  type OrganizationRole,
  type OrganizationSettings,
  type Result,
  type UpdateOrganizationInput,
} from '#core/domain/index.js';

import { authorize, authorizeOrganization, organizationSuspendedError } from '../authorize.js';
import type { Ctx, OrganizationCtx } from '../context.js';
import type { Clock, IdGenerator, OrganizationAuditRepository, OrganizationMemberRepository, OrganizationRepository } from '../ports.js';

export interface OrganizationReadDeps {
  organizations: Pick<OrganizationRepository, 'findById' | 'findSettings'>;
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
): Promise<Result<{ organization: Organization; settings: OrganizationSettings; role: OrganizationRole }, AppError>> => {
  const access = authorizeOrganization(octx, input.organizationId, 'organization:read');
  if (!access.ok) return access;
  const organization = await deps.organizations.findById(access.value.organizationId);
  const settings = await deps.organizations.findSettings(access.value.organizationId);
  if (organization === null || settings === null) return err(notFound('Organization not found'));
  return ok({ organization, settings, role: access.value.role });
};

export interface OrganizationSettingsDeps {
  organizations: Pick<OrganizationRepository, 'updateSettings'>;
  ids: IdGenerator;
  clock: Clock;
}

export const updateOrganization = async (
  octx: OrganizationCtx,
  input: { organizationId: string; update: UpdateOrganizationInput },
  deps: OrganizationSettingsDeps,
): Promise<Result<{ organization: Organization; settings: OrganizationSettings; changed: boolean }, AppError>> => {
  const access = authorizeOrganization(octx, input.organizationId, 'organization:settings:write');
  if (!access.ok) return access;
  const parsed = updateOrganizationInputSchema.safeParse(input.update);
  if (!parsed.success) return err(validation('Invalid organization settings', parsed.error.flatten()));
  const at = deps.clock.nowIso();
  const result = await deps.organizations.updateSettings(access.value.organizationId, {
    update: parsed.data,
    updatedAt: at,
    audit: {
      id: deps.ids.nextId(), kind: 'organization.updated', actorUserId: octx.identity.userId, actorEmail: octx.identity.email,
      actorKeyId: null, subjectTenantId: null, subjectUserId: null, at,
    },
  });
  if (result === null) return err(notFound('Organization not found'));
  if (result.status === 'organization_suspended') return err(organizationSuspendedError());
  const { organization, settings, changed } = result;
  return ok({ organization, settings, changed });
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
