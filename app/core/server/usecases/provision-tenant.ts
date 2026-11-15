import {
  appError,
  err,
  isReservedTenantSlug,
  ok,
  provisionTenantInputSchema,
  slugReserved,
  validation,
  type ProvisionTenantInput,
} from '#core/domain/index.js';

import { authorize } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { AuthPort, Clock, IdGenerator, TenantRepository } from '../ports.js';
import { getOperatorTenantReadiness, type OperatorTenantReadinessDeps } from './operator-tenant-readiness.js';

export interface ProvisionTenantDeps extends OperatorTenantReadinessDeps {
  tenants: TenantRepository;
  authPort: Pick<AuthPort, 'findUserByEmail'>;
  ids: IdGenerator;
  clock: Clock;
}

export const provisionTenant = async (
  ctx: Ctx,
  input: ProvisionTenantInput,
  deps: ProvisionTenantDeps,
) => {
  const denial = authorize(ctx, 'tenant:provision');
  if (denial !== null) return err(denial);
  const parsed = provisionTenantInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid tenant provisioning payload'));
  const { slug, name, ownerEmail, defaultLanguage } = parsed.data;
  if (isReservedTenantSlug(slug)) return err(slugReserved('Tenant slug is reserved'));
  const owner = await deps.authPort.findUserByEmail(ownerEmail);
  if (owner === null || !owner.emailVerified) {
    return err(validation('Owner account not found or not verified'));
  }
  const id = deps.ids.nextId();
  const at = deps.clock.nowIso();
  const tenant = await deps.tenants.createTenantWithOwnerGrant({
    tenant: { id, slug, name, createdAt: at, ...(defaultLanguage === undefined ? {} : { defaultLanguage }) },
    ownerGrant: { id: deps.ids.nextId(), userId: owner.userId, staffRole: 'owner' },
    provisionAudit: {
      id: deps.ids.nextId(), tenantId: id, kind: 'tenant_provisioned',
      actorUserId: 'operator-secret', actorEmail: 'operator@together.invalid',
      subjectMemberId: null, reason: null, at,
    },
  }, { requireEmpty: false, idempotentOwner: true });
  if (tenant === null) {
    const currentOwner = await deps.authPort.findUserByEmail(ownerEmail);
    if (currentOwner === null || !currentOwner.emailVerified || currentOwner.userId !== owner.userId) {
      return err(validation('Owner account not found or not verified'));
    }
    return err(appError('conflict', 'Tenant slug belongs to another owner'));
  }
  const readiness = await getOperatorTenantReadiness(ctx, { slug }, deps);
  if (!readiness.ok) return readiness;
  return ok({
    tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
    created: tenant.id === id,
    ownerUserId: owner.userId,
    readiness: readiness.value,
  });
};
