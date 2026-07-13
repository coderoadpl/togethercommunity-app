import type { ProductGrant } from '@core/domain/index.js';

import type { Clock, IdGenerator, ProductGrantRepository } from '../ports.js';

export interface GrantWindowDeps {
  grants: ProductGrantRepository;
  ids: IdGenerator;
  clock: Clock;
}

export interface GrantWindowResult {
  grantId: string;
  renewed: boolean;
}

const isActive = (grant: ProductGrant, now: string): boolean =>
  grant.startsAt <= now && (grant.expiresAt === null || grant.expiresAt >= now);

export const createOrRenewGrant = async (
  tenantId: string,
  input: { memberId: string; productId: string; expiresAt: string | null },
  deps: GrantWindowDeps,
): Promise<GrantWindowResult> => {
  const now = deps.clock.nowIso();
  const existing = await deps.grants.findGrant(tenantId, input.memberId, input.productId);

  if (existing && isActive(existing, now)) {
    await deps.grants.setGrantWindow(tenantId, existing.id, {
      startsAt: existing.startsAt,
      expiresAt: input.expiresAt,
    });
    return { grantId: existing.id, renewed: true };
  }

  if (existing) {
    await deps.grants.setGrantWindow(tenantId, existing.id, { startsAt: now, expiresAt: input.expiresAt });
    return { grantId: existing.id, renewed: false };
  }

  const grant: ProductGrant = {
    id: deps.ids.nextId(),
    tenantId,
    memberId: input.memberId,
    productId: input.productId,
    source: 'manual',
    startsAt: now,
    expiresAt: input.expiresAt,
    legacyId: null,
    createdAt: now,
  };
  await deps.grants.createGrant(tenantId, grant);
  return { grantId: grant.id, renewed: false };
};
