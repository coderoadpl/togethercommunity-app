import {
  err,
  forbidden,
  ok,
  tenantNotFound,
  unauthorized,
  type AppError,
  type Identity,
  type Result,
} from '@core/domain/index.js';

import type { AuthenticatedUser, TenantAccessReader, TenantDomainRepository, TenantRepository } from '../ports.js';
import { resolveTenant, tenantNotFoundMessage } from './resolve-tenant.js';

export interface TenantRequestInfo {
  /** Host header, may include a port. */
  host: string;
  /** Value of the X-Tenant header, if any. */
  tenantHeader: string | null;
}

export interface ResolveIdentityDeps {
  tenantDomains: TenantDomainRepository;
  tenantAccess: TenantAccessReader;
  tenants: TenantRepository;
  /** e.g. "localhost" in dev, "together.com" in prod. */
  baseDomain: string;
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
    tenantId: null,
    tenantSlug: null,
    tenantName: null,
    staffRole: null,
    memberId: null,
  };

  if (!tenant.value) return ok(base);

  const staffGrant = await deps.tenantAccess.findStaffGrant(user.userId, { tenantId: tenant.value.tenant.id });
  const member = await deps.tenantAccess.findMember(user.userId, tenant.value.tenant.id);

  if (!staffGrant && !member) {
    return tenant.value.source === 'custom-domain'
      ? err(forbidden('You do not have access to this tenant'))
      : err(tenantNotFound(tenantNotFoundMessage(tenant.value.tenant.slug)));
  }

  return ok({
    ...base,
    tenantId: tenant.value.tenant.id,
    tenantSlug: tenant.value.tenant.slug,
    tenantName: tenant.value.tenant.name,
    staffRole: staffGrant?.staffRole ?? null,
    memberId: member?.id ?? null,
  });
};
