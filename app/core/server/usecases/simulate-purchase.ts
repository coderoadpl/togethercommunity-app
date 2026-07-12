import {
  err,
  notFound,
  ok,
  type AppError,
  type ProductGrant,
  type Result,
} from '@core/domain/index.js';

import type { ProductGrantRepository, ProductRepository } from '../ports.js';
import { ensureMember, type EnsureMemberDeps } from './ensure-member.js';

export interface SimulatePurchaseResult {
  memberId: string;
  productId: string;
  alreadyOwned: boolean;
}

export interface SimulatePurchaseDeps extends EnsureMemberDeps {
  products: ProductRepository;
  grants: ProductGrantRepository;
}

export const simulatePurchase = async (
  tenantId: string,
  email: string,
  productId: string,
  deps: SimulatePurchaseDeps,
): Promise<Result<SimulatePurchaseResult, AppError>> => {
  const product = await deps.products.findById(tenantId, productId);
  if (!product || !product.published) {
    return err(notFound(`No published product "${productId}" in this tenant`));
  }

  const member = await ensureMember(tenantId, email, deps);
  if (!member.ok) return member;

  const existingGrant = await deps.grants.findGrant(tenantId, member.value.id, productId);
  if (existingGrant) {
    return ok({ memberId: member.value.id, productId, alreadyOwned: true });
  }

  const grant: ProductGrant = {
    id: deps.ids.nextId(),
    tenantId,
    memberId: member.value.id,
    productId,
    source: 'simulated',
    createdAt: deps.clock.nowIso(),
  };
  await deps.grants.createGrant(tenantId, grant);
  return ok({ memberId: member.value.id, productId, alreadyOwned: false });
};
