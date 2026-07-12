import {
  err,
  normalizeEmail,
  notFound,
  ok,
  type AppError,
  type Result,
} from '@core/domain/index.js';

import type { AuthPort, Clock, IdGenerator, ProductRepository, PurchaseRepository } from '../ports.js';

export interface SimulatePurchaseResult {
  memberId: string;
  productId: string;
  alreadyOwned: boolean;
}

export interface SimulatePurchaseDeps {
  products: ProductRepository;
  purchases: PurchaseRepository;
  authPort: AuthPort;
  ids: IdGenerator;
  clock: Clock;
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

  const normalizedEmail = normalizeEmail(email);
  const { userId } = await deps.authPort.ensureUser(normalizedEmail);

  const purchase = await deps.purchases.createMemberGrant({
    tenantId,
    userId,
    email: normalizedEmail,
    memberId: deps.ids.nextId(),
    grantId: deps.ids.nextId(),
    productId,
    createdAt: deps.clock.nowIso(),
  });
  return ok({ memberId: purchase.member.id, productId, alreadyOwned: !purchase.grantCreated });
};
