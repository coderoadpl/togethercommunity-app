import type { AppError, Result } from '#core/domain/index.js';
import type { PurchaseSmokeTransaction, PurchaseSmokeWriteDeps } from '#core/server/purchase-smoke-ports.js';

import { createEffectiveTenantSecretResolver } from '../crypto/effective-tenant-secret-resolver.js';
import { createTenantSecretResolver } from '../crypto/tenant-secret-resolver.js';
import type { Db } from './client.js';
import { createEffectiveTenantConfigReader } from './organizations.js';
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
  external: Pick<PurchaseSmokeWriteDeps, 'payment' | 'secretCrypto' | 'ids' | 'clock'>,
): PurchaseSmokeTransaction => ({
  run: async (tenantId, operation) => {
    let rejected: Result<never, AppError> | null = null;
    try {
      return await db.transaction(async (tx) => {
        await lockSmokeFixture(tx, tenantId);
        const tenantSecrets = createTenantSecretRepository(tx);
        const effectiveConfig = createEffectiveTenantConfigReader(tx);
        const secretResolver = createEffectiveTenantSecretResolver(
          createTenantSecretResolver(tenantSecrets, external.secretCrypto), effectiveConfig, external.secretCrypto,
        );
        const result = await operation({
          ...external,
          tenantSecrets,
          effectiveConfig,
          secretResolver,
          tenants: createTenantRepository(tx),
          products: createProductRepository(tx),
          prices: createProductPriceRepository(tx),
          orders: createOrderRepository(tx),
          members: createMemberRepository(tx),
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
