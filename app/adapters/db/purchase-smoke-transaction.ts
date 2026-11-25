import type { AppError, Result } from '#core/domain/index.js';
import type { PurchaseSmokeTransaction, PurchaseSmokeWriteDeps } from '#core/server/purchase-smoke-ports.js';

import type { Db } from './client.js';
import { createCheckoutSnapshotRepository } from './checkout-snapshots.js';
import { createPurchaseSmokeRepository } from './purchase-smoke.js';
import { createSalesLinkRepository } from './sales-links.js';
import { createShopManagementKeyRepository } from './shop-management-keys.js';
import { lockSmokeFixture } from './smoke-fixture-lock.js';
import {
  createCheckoutConsentCaptureRepository, createMemberRepository, createOrderRepository,
  createProductPriceRepository, createProductRepository, createTenantRepository, createTenantSecretRepository,
} from './repositories.js';

export const createPurchaseSmokeTransaction = (
  db: Db,
  external: Pick<PurchaseSmokeWriteDeps, 'payment' | 'secretCrypto' | 'secretResolver' | 'ids' | 'clock'>,
): PurchaseSmokeTransaction => ({
  run: async (tenantId, operation) => {
    let rejected: Result<never, AppError> | null = null;
    try {
      return await db.transaction(async (tx) => {
        await lockSmokeFixture(tx, tenantId);
        const result = await operation({
          ...external,
          tenants: createTenantRepository(tx),
          products: createProductRepository(tx),
          prices: createProductPriceRepository(tx),
          orders: createOrderRepository(tx),
          members: createMemberRepository(tx),
          tenantSecrets: createTenantSecretRepository(tx),
          shopManagementKeys: createShopManagementKeyRepository(tx),
          purchaseSmoke: createPurchaseSmokeRepository(tx),
          salesLinks: createSalesLinkRepository(tx),
          checkoutSnapshots: createCheckoutSnapshotRepository(tx),
          checkoutConsentCaptures: createCheckoutConsentCaptureRepository(tx),
        });
        if (!result.ok) {
          rejected = result;
          tx.rollback();
        }
        return result;
      });
    } catch (cause) {
      if (rejected !== null) return rejected;
      throw cause;
    }
  },
});
