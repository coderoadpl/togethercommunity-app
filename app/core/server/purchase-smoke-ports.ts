import type { AppError, PurchaseSmokeCheckout, PurchaseSmokeResult, PurchaseSmokeStart, Result } from '#core/domain/index.js';

import type { CheckoutConsentCaptureRepository, Clock, IdGenerator, MemberRepository, ShopManagementKeyRepository, TenantRepository, ProductRepository, ProductPriceRepository, PaymentProvider, OrderRepository, TenantSecretRepository, SecretCrypto, SalesLinkRepository, TenantSecretResolver, EffectiveTenantConfigReader, PurchaseSmokeEventRepository } from './ports.js';
import type { CheckoutSnapshotRepository } from './checkout-snapshot-ports.js';

export interface PurchaseSmokeRepository extends PurchaseSmokeEventRepository {
  findRun(tenantId: string, apiKeyId: string, input: PurchaseSmokeStart): Promise<PurchaseSmokeCheckout | null>;
  countSince(tenantId: string, since: string): Promise<number>;
  create(tenantId: string, apiKeyId: string, checkout: PurchaseSmokeCheckout, createdAt: string): Promise<void>;
  result(tenantId: string, apiKeyId: string, reference: string): Promise<PurchaseSmokeResult | null>;
}

export interface PurchaseSmokeWriteDeps {
  products: ProductRepository;
  prices: ProductPriceRepository;
  payment: PaymentProvider;
  orders: OrderRepository;
  tenantSecrets: TenantSecretRepository;
  secretCrypto: SecretCrypto;
  secretResolver: TenantSecretResolver;
  effectiveConfig: Pick<EffectiveTenantConfigReader, 'findInheritedSecret'>;
  salesLinks: SalesLinkRepository;
  checkoutSnapshots: CheckoutSnapshotRepository;
  tenants: TenantRepository;
  members: MemberRepository;
  shopManagementKeys: Pick<ShopManagementKeyRepository, 'findByHash'>;
  purchaseSmoke: PurchaseSmokeRepository;
  checkoutConsentCaptures: CheckoutConsentCaptureRepository;
  ids: IdGenerator;
  clock: Clock;
}

export interface PurchaseSmokeTransaction {
  run<T>(tenantId: string, operation: (deps: PurchaseSmokeWriteDeps) => Promise<Result<T, AppError>>): Promise<Result<T, AppError>>;
}
