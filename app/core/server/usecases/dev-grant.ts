import {
  err,
  notFound,
  ok,
  type AppError,
  type DevGrantInput,
  type ProductGrant,
  type Result,
} from '@core/domain/index.js';

import type { ProductGrantRepository, ProductRepository } from '../ports.js';
import { ensureMember, type EnsureMemberDeps } from './ensure-member.js';

export interface DevGrantDeps extends EnsureMemberDeps {
  products: ProductRepository;
  grants: ProductGrantRepository;
}

export interface DevGrantResult {
  memberId: string;
  productId: string;
  granted: boolean;
  expiresAt: string | null;
}

export const devGrantProduct = async (
  tenantId: string,
  input: DevGrantInput,
  deps: DevGrantDeps,
): Promise<Result<DevGrantResult, AppError>> => {
  const product = await deps.products.findById(tenantId, input.productId);
  if (!product) return err(notFound(`No product "${input.productId}" in this tenant`));

  const member = await ensureMember(tenantId, input.email, deps);
  if (!member.ok) return member;

  const now = deps.clock.nowIso();
  const grant: ProductGrant = {
    id: deps.ids.nextId(),
    tenantId,
    memberId: member.value.id,
    productId: input.productId,
    source: 'manual',
    startsAt: input.startsAt ?? now,
    expiresAt: input.expiresAt ?? null,
    legacyId: null,
    createdAt: now,
  };
  const granted = await deps.grants.createGrant(tenantId, grant);
  return ok({ memberId: member.value.id, productId: input.productId, granted, expiresAt: grant.expiresAt });
};
