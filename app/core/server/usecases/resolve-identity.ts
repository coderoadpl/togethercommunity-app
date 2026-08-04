import {
  err,
  forbidden,
  ok,
  unauthorized,
  type AppError,
  type Identity,
  type Result,
} from '#core/domain/index.js';

import type {
  AuthenticatedUser,
  MemberRepository,
  TenantAccessReader,
  TenantDomainRepository,
  TenantRepository,
} from '../ports.js';
import { resolveTenant } from './resolve-tenant.js';

export interface TenantRequestInfo {
  /** Host header, may include a port. */
  host: string;
  /** Value of the X-Tenant header, if any. */
  tenantHeader: string | null;
}

export interface ResolveIdentityDeps {
  tenantDomains: TenantDomainRepository;
  tenantAccess: TenantAccessReader;
  members: MemberRepository;
  tenants: TenantRepository;
  /** e.g. "localhost" in dev, "together.example" in prod. */
  baseDomain: string;
  platformHost: string | null;
  singleTenantMode: boolean;
}

export const resolveIdentity = async (
  user: AuthenticatedUser | null,
  request: TenantRequestInfo,
  deps: ResolveIdentityDeps,
): Promise<Result<Identity, AppError>> => {
  if (!user) return err(unauthorized());

  const tenant = await resolveTenant(request.host, request.tenantHeader, deps);
  if (!tenant.ok) return tenant;

  const base: Identity = {
    userId: user.userId,
    email: user.email,
    name: user.name,
    emailVerified: user.emailVerified,
    tenantId: null,
    tenantSlug: null,
    tenantName: null,
    staffRole: null,
    memberId: null,
    memberBannedAt: null,
  };

  if (!tenant.value) return ok(base);

  const staffGrant = await deps.tenantAccess.findStaffGrant(user.userId, { tenantId: tenant.value.tenant.id });
  let member = await deps.tenantAccess.findMember(tenant.value.tenant.id, user.userId);

  if (member && member.email !== user.email) {
    const refreshedMember = await deps.members.updateEmail(tenant.value.tenant.id, member.id, user.email);
    member = refreshedMember ?? { ...member, email: user.email };
  }

  if (!staffGrant && !member) {
    return err(forbidden('You do not have access to this tenant'));
  }

  return ok({
    ...base,
    tenantId: tenant.value.tenant.id,
    tenantSlug: tenant.value.tenant.slug,
    tenantName: tenant.value.tenant.name,
    staffRole: staffGrant?.staffRole ?? null,
    memberId: member?.id ?? null,
    memberBannedAt: member?.bannedAt ?? null,
  });
};
