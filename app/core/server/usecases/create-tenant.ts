import {
  appError,
  err,
  forbidden,
  isReservedTenantSlug,
  ok,
  slugReserved,
  tenantSchema,
  validation,
  type AppError,
  type Result,
  type Tenant,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import { authorize } from '../authorize.js';
import type { Clock, IdGenerator, TenantRepository } from '../ports.js';

const slugPattern = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

export interface CreateTenantDeps {
  tenants: TenantRepository;
  ids: IdGenerator;
  clock: Clock;
  tenantCreationMode: TenantCreationMode;
}

export type TenantCreationMode = 'open' | 'bootstrap' | 'closed';

export type TenantCreationPolicy = {
  available: true;
  allowUnverifiedEmail: boolean;
  requireEmpty: boolean;
  unavailableMessage: null;
} | {
  available: false;
  allowUnverifiedEmail: true;
  requireEmpty: false;
  unavailableMessage: string;
};

export const tenantCreationPolicy = (
  mode: TenantCreationMode,
  hasAnyTenant: boolean,
  emailVerified: boolean,
): TenantCreationPolicy => {
  if (mode === 'closed') {
    return {
      available: false,
      allowUnverifiedEmail: true,
      requireEmpty: false,
      unavailableMessage: 'Tenant creation is closed on this instance',
    };
  }
  if (mode === 'bootstrap' && hasAnyTenant) {
    return {
      available: false,
      allowUnverifiedEmail: true,
      requireEmpty: false,
      unavailableMessage: 'Tenant creation is closed after the first workspace',
    };
  }
  return {
    available: true,
    allowUnverifiedEmail: !hasAnyTenant,
    requireEmpty: mode === 'bootstrap' || (!emailVerified && !hasAnyTenant),
    unavailableMessage: null,
  };
};

export const createTenant = async (
  ctx: Ctx,
  input: { slug: string; name: string },
  deps: CreateTenantDeps,
): Promise<Result<Tenant, AppError>> => {
  const hasAnyTenant = deps.tenantCreationMode === 'closed' ? false : await deps.tenants.hasAny();
  const policy = tenantCreationPolicy(
    deps.tenantCreationMode,
    hasAnyTenant,
    ctx.identity.emailVerified,
  );
  const denial = authorize(ctx, 'tenant:create', {
    allowUnverifiedEmail: policy.allowUnverifiedEmail,
  });
  if (denial !== null) return err(denial);
  if (!policy.available) return err(forbidden(policy.unavailableMessage));

  const slug = input.slug.trim().toLowerCase();
  const parsedName = tenantSchema.shape.name.safeParse(input.name);

  if (!slugPattern.test(slug)) {
    return errValidation('Tenant slug must be 3-63 lowercase letters, numbers or hyphens');
  }
  if (isReservedTenantSlug(slug)) return err(slugReserved(`Tenant slug "${slug}" is reserved`));
  if (!parsedName.success) return errValidation('Tenant name must be 1-100 characters');

  const existing = await deps.tenants.findBySlug(slug);
  if (existing) return err(appError('conflict', `Tenant "${slug}" already exists`));

  const tenantId = deps.ids.nextId();
  const tenant = await deps.tenants.createTenantWithOwnerGrant(
    {
      tenant: {
        id: tenantId,
        slug,
        name: parsedName.data,
        createdAt: deps.clock.nowIso(),
      },
      ownerGrant: {
        id: deps.ids.nextId(),
        userId: ctx.identity.userId,
        staffRole: 'owner',
      },
    },
    { requireEmpty: policy.requireEmpty },
  );

  if (tenant === null) {
    return err(forbidden(
      ctx.identity.emailVerified
        ? 'Tenant creation is closed after the first workspace'
        : 'tenant:create requires a verified email address',
    ));
  }

  return ok(tenant);
};

const errValidation = (message: string): Result<Tenant, AppError> => err(validation(message));
